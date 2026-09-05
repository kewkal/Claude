/**
 * All HTML -> data extraction. Pure functions: HTML string in, plain data out.
 * No fetching, no navigation, no side effects — which is exactly what makes
 * this file the one worth testing hard.
 *
 * Extraction order of preference throughout:
 *   1. structured data (JSON-LD, microdata-ish attributes)
 *   2. explicit HTML relationships (href, adjacent siblings, containers)
 *   3. text patterns
 * Regex is one tool here, not the strategy.
 */

import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

import {
  GENERIC_SERVICE_PHRASES,
  GENERIC_SERVICE_SUBSTRINGS,
  NON_HTML_EXTENSIONS,
  NON_OWNER_TITLES,
  OWNER_TITLES,
  SERVICE_CONTAINER_HINTS,
  SERVICE_RULES,
} from '../config.js';
import type {
  DiscoveredEmail,
  OwnerCandidate,
  RevenueSignals,
  SocialLinks,
  SocialPlatform,
} from '../types/lead.js';
import {
  canonicaliseUrl,
  deobfuscateEmails,
  detectSocialPlatform,
  foldCase,
  isGenericEmail,
  isValidEmail,
  normaliseEmail,
  normalisePhone,
  normaliseWhitespace,
  normaliseSocialUrl,
  tidyServiceLabel,
  unique,
  uniqueCaseInsensitive,
} from '../utils/normalise.js';

export type Doc = CheerioAPI;

export function parseHtml(html: string): Doc {
  return cheerio.load(html);
}

/** Visible-ish text with script/style/noscript stripped. */
export function pageText($: Doc): string {
  const clone = $.root().clone();
  clone.find('script, style, noscript, template, svg').remove();
  return normaliseWhitespace(clone.text());
}

/* ------------------------------------------------------------------ *
 * Structured data
 * ------------------------------------------------------------------ */

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Flatten JSON-LD blocks, expanding `@graph` and nested arrays into one list. */
export function extractJsonLd($: Doc): JsonObject[] {
  const out: JsonObject[] = [];

  const visit = (value: JsonValue, depth: number): void => {
    if (depth > 6) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!isJsonObject(value)) return;
    out.push(value);
    const graph = value['@graph'];
    if (graph !== undefined) visit(graph, depth + 1);
    for (const key of ['founder', 'owner', 'employee', 'member', 'author', 'publisher', 'parentOrganization']) {
      const nested = value[key];
      if (nested !== undefined) visit(nested, depth + 1);
    }
  };

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).text().trim();
    if (raw === '') return;
    try {
      visit(JSON.parse(raw) as JsonValue, 0);
    } catch {
      // Malformed JSON-LD is extremely common; skip silently.
    }
  });

  return out;
}

function jsonLdTypes(node: JsonObject): string[] {
  const raw = node['@type'];
  if (typeof raw === 'string') return [raw.toLowerCase()];
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase());
  return [];
}

export function jsonLdOfType(nodes: readonly JsonObject[], ...types: string[]): JsonObject[] {
  const wanted = types.map((t) => t.toLowerCase());
  return nodes.filter((node) => jsonLdTypes(node).some((type) => wanted.includes(type)));
}

function asString(value: JsonValue | undefined): string | null {
  if (typeof value === 'string') return normaliseWhitespace(value) || null;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = asString(item);
      if (found) return found;
    }
  }
  if (isJsonObject(value)) return asString(value['name']);
  return null;
}

function asNumber(value: JsonValue | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.]/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  if (isJsonObject(value)) return asNumber(value['value'] ?? value['minValue']);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = asNumber(item);
      if (found !== null) return found;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Business name
 * ------------------------------------------------------------------ */

export function extractBusinessName($: Doc): string | null {
  const nodes = extractJsonLd($);
  const org = jsonLdOfType(nodes, 'Organization', 'LocalBusiness', 'Dentist', 'HVACBusiness', 'HomeAndConstructionBusiness', 'ProfessionalService')[0];
  const fromJsonLd = org ? asString(org['name']) : null;
  if (fromJsonLd) return fromJsonLd;

  const ogSiteName = normaliseWhitespace($('meta[property="og:site_name"]').attr('content') ?? '');
  if (ogSiteName !== '') return ogSiteName;

  const h1 = normaliseWhitespace($('h1').first().text());
  if (h1 !== '' && h1.length <= 80) return h1;

  const title = normaliseWhitespace($('title').first().text());
  if (title !== '') {
    // Titles are usually "Brand | Tagline"; the brand is the shortest leading part.
    // Malformed markup can swallow a whole page into <title>, so cap the length.
    const head = normaliseWhitespace(title.split(/\s*[|–—:·-]\s*/)[0] ?? title);
    if (head.length >= 2 && head.length <= 80) return head;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Links
 * ------------------------------------------------------------------ */

export interface PageLink {
  url: string;
  text: string;
}

/** All resolvable http(s) anchors on the page, with their anchor text. */
export function extractLinks($: Doc, pageUrl: string): PageLink[] {
  const seen = new Set<string>();
  const links: PageLink[] = [];

  $('a[href]').each((_, element) => {
    const node = $(element);
    const href = node.attr('href');
    if (!href) return;
    const url = canonicaliseUrl(href, pageUrl);
    if (!url) return;

    const lower = url.toLowerCase();
    if (NON_HTML_EXTENSIONS.some((extension) => lower.split('?')[0]?.endsWith(extension))) return;

    const text = normaliseWhitespace(node.text()) || normaliseWhitespace(node.attr('title') ?? '') ||
      normaliseWhitespace(node.attr('aria-label') ?? '');
    const key = `${url}\u0000${foldCase(text)}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ url, text });
  });

  return links;
}

/* ------------------------------------------------------------------ *
 * Emails
 * ------------------------------------------------------------------ */

/**
 * Emails from mailto hrefs (highest trust), JSON-LD, then page text
 * including simple human obfuscations. Never constructed from a name.
 */
export function extractEmails($: Doc, pageUrl: string): DiscoveredEmail[] {
  const found = new Map<string, DiscoveredEmail>();

  const add = (raw: string): void => {
    const address = normaliseEmail(raw);
    if (!isValidEmail(address) || found.has(address)) return;
    found.set(address, {
      address,
      kind: 'unknown',
      foundOn: pageUrl,
      isGeneric: isGenericEmail(address),
    });
  };

  $('a[href^="mailto:" i]').each((_, element) => {
    const href = $(element).attr('href') ?? '';
    const address = href.replace(/^mailto:/i, '').split('?')[0] ?? '';
    for (const part of address.split(/[,;]/)) add(decodeURIComponent(part.trim()));
  });

  for (const node of extractJsonLd($)) {
    const email = asString(node['email']);
    if (email) add(email.replace(/^mailto:/i, ''));
  }

  $('[itemprop="email"]').each((_, element) => {
    add(normaliseWhitespace($(element).attr('content') ?? $(element).text()));
  });

  for (const address of deobfuscateEmails(pageText($))) add(address);

  return [...found.values()];
}

/* ------------------------------------------------------------------ *
 * Phones
 * ------------------------------------------------------------------ */

/** Phones from tel: links and structured data, normalised. Text is not scraped
 *  for phone-shaped digits — too noisy, and the discovery source usually has one. */
export function extractPhones($: Doc, defaultRegion: string | null): string[] {
  const numbers: string[] = [];

  $('a[href^="tel:" i]').each((_, element) => {
    const normalised = normalisePhone($(element).attr('href') ?? '', defaultRegion);
    if (normalised) numbers.push(normalised);
  });

  for (const node of extractJsonLd($)) {
    const raw = asString(node['telephone']);
    const normalised = raw ? normalisePhone(raw, defaultRegion) : null;
    if (normalised) numbers.push(normalised);
  }

  $('[itemprop="telephone"]').each((_, element) => {
    const raw = normaliseWhitespace($(element).attr('content') ?? $(element).text());
    const normalised = normalisePhone(raw, defaultRegion);
    if (normalised) numbers.push(normalised);
  });

  return unique(numbers);
}

/* ------------------------------------------------------------------ *
 * Socials
 * ------------------------------------------------------------------ */

/**
 * Social profiles, taken from anchor hrefs only. Share widgets, login URLs and
 * platform homepages are rejected by the normaliser. First valid link per
 * platform wins, since header/footer profile links come before share buttons.
 */
export function extractSocials($: Doc): SocialLinks {
  const socials: SocialLinks = {};

  const consider = (raw: string | undefined): void => {
    if (!raw) return;
    const platform: SocialPlatform | null = detectSocialPlatform(raw);
    if (!platform || socials[platform]) return;
    const normalised = normaliseSocialUrl(raw, platform);
    if (normalised) socials[platform] = normalised;
  };

  $('a[href]').each((_, element) => consider($(element).attr('href')));

  // `sameAs` is the most authoritative source we have. Accept it from any node
  // that carries one: schema.org has dozens of LocalBusiness subtypes
  // (RoofingContractor, HVACBusiness, Dentist, ...) and whitelisting them is a
  // losing game.
  for (const node of extractJsonLd($)) {
    const sameAs = node['sameAs'];
    if (sameAs === undefined) continue;
    const values = Array.isArray(sameAs) ? sameAs : [sameAs];
    for (const value of values) {
      const url = asString(value);
      if (url) consider(url);
    }
  }

  return socials;
}

/* ------------------------------------------------------------------ *
 * Owner / executive
 * ------------------------------------------------------------------ */

const HONORIFICS = /^(dr|doctor|mr|mrs|ms|miss|prof|professor|sir|rev)\.?\s+/i;
const CREDENTIALS = /[,\s]+(dds|dmd|md|do|dvm|phd|pe|cpa|esq|mba|rn|jr|sr|ii|iii|iv)\.?$/i;

/**
 * Words that disqualify a string from being a personal name. Two capitalised
 * words is a weak signal on its own — "Roof Replacement" and "Drain Cleaning"
 * look exactly like "James Smith" — so trade and commerce vocabulary is
 * excluded explicitly.
 */
const NON_NAME_WORDS = new Set([
  // structural / navigational
  'the', 'and', 'our', 'your', 'we', 'us', 'inc', 'llc', 'ltd', 'company', 'services', 'service',
  'team', 'staff', 'about', 'contact', 'home', 'welcome', 'meet', 'call', 'today', 'now', 'here',
  'group', 'associates', 'partners', 'clinic', 'center', 'centre', 'office', 'solutions',
  'read', 'more', 'learn', 'view', 'click', 'get', 'free', 'quote', 'estimate',
  // trades and sectors
  'roofing', 'roof', 'roofs', 'plumbing', 'heating', 'cooling', 'dental', 'dentistry', 'hvac',
  'air', 'construction', 'electrical', 'landscaping', 'mechanical', 'remodeling', 'remodelling',
  // service nouns
  'repair', 'repairs', 'replacement', 'replacements', 'installation', 'installations', 'install',
  'maintenance', 'cleaning', 'inspection', 'inspections', 'detection', 'removal', 'restoration',
  'tune', 'up', 'upgrade', 'upgrades', 'emergency', 'storm', 'damage', 'leak', 'leaks',
  'drain', 'drains', 'sewer', 'furnace', 'boiler', 'heater', 'heaters', 'duct', 'ducts',
  'gutter', 'gutters', 'siding', 'windows', 'doors', 'water', 'slab', 'commercial', 'residential',
  'whitening', 'implants', 'veneers', 'crowns', 'braces', 'aligners', 'cleanings', 'checkup',
  'orthodontics', 'endodontics', 'periodontics', 'extraction', 'extractions', 'filling', 'fillings',
]);

/** Strip honorifics/credentials and return a clean personal name, or null. */
export function cleanPersonName(raw: string): string | null {
  let value = normaliseWhitespace(raw)
    .replace(/["'“”‘’]/g, '')
    .replace(/^[\s\-–—•*|,]+/, '')
    .replace(/[\s\-–—•*|,]+$/, '');
  value = value.replace(HONORIFICS, '');
  // Credentials can stack: "Jane Doe, DDS, MBA".
  for (let i = 0; i < 3; i += 1) value = value.replace(CREDENTIALS, '');
  value = normaliseWhitespace(value);
  return value === '' ? null : value;
}

/**
 * A conservative personal-name test. Two to four capitalised tokens, no digits,
 * no business/service vocabulary. Deliberately rejects one-word names — a lone
 * "James" is not enough to publish as an owner.
 */
export function isPersonName(raw: string): boolean {
  const name = cleanPersonName(raw);
  if (!name) return false;
  if (name.length < 4 || name.length > 60) return false;
  if (/\d|@|https?:|\/|\(|\)/.test(name)) return false;

  const tokens = name.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 4) return false;

  const particles = new Set(['van', 'von', 'de', 'del', 'della', 'di', 'da', 'du', 'la', 'le', 'den', 'der', 'bin', 'al']);
  let capitalised = 0;

  for (const token of tokens) {
    const bare = token.replace(/[.'’-]/g, '');
    if (bare.length === 0 || bare.length > 20) return false;
    if (NON_NAME_WORDS.has(bare.toLowerCase())) return false;
    if (!/^[\p{L}][\p{L}'’.-]*$/u.test(token)) return false;
    if (particles.has(bare.toLowerCase())) continue;
    if (/^\p{Lu}/u.test(token)) capitalised += 1;
    else return false;
  }
  return capitalised >= 2;
}

interface TitleMatch {
  title: string;
  confidence: number;
}

/** Find the strongest ownership title in a string, or null if it disqualifies. */
export function matchOwnerTitle(text: string): TitleMatch | null {
  const haystack = foldCase(text);
  if (haystack === '') return null;

  for (const excluded of NON_OWNER_TITLES) {
    // "Office Manager" must not match on the "manager" inside "Managing Partner",
    // so exclusions are checked as whole phrases first and win outright.
    if (new RegExp(`\\b${excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack)) {
      return null;
    }
  }

  let best: TitleMatch | null = null;
  for (const { pattern, confidence } of OWNER_TITLES) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+');
    if (!new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(haystack)) continue;
    if (!best || confidence > best.confidence) best = { title: pattern, confidence };
  }
  return best;
}

/** Try to pull `name` + `title` out of a single string using explicit separators. */
function splitNameAndTitle(text: string): { name: string; title: string } | null {
  const value = normaliseWhitespace(text);
  if (value === '' || value.length > 140) return null;

  // "James Smith — Founder & Owner" / "James Smith, Owner" / "James Smith | CEO"
  const separated = value.split(/\s*(?:[—–|·]|,|\s-\s|\s:\s)\s*/).filter((part) => part.trim() !== '');
  if (separated.length >= 2) {
    const [first, ...rest] = separated;
    const tail = rest.join(', ');
    if (first && isPersonName(first) && matchOwnerTitle(tail)) return { name: first, title: tail };
    // Reversed: "Owner: James Smith"
    const last = separated[separated.length - 1];
    const head = separated.slice(0, -1).join(', ');
    if (last && isPersonName(last) && matchOwnerTitle(head)) return { name: last, title: head };
  }

  // "Founded by James Smith" / "Meet our founder, Jane Doe" / "owned by Jane Doe"
  const introduced = /\b(founded|established|started|owned|led|run)\s+by\s+([^.,;()]{3,60})/i.exec(value);
  if (introduced?.[2] && isPersonName(introduced[2])) {
    return { name: introduced[2], title: `${introduced[1]?.toLowerCase() ?? 'founded'} by` };
  }
  const meet = /\b(?:meet\s+(?:our|the)\s+)?(founder|owner|co-founder|co-owner|president|ceo|proprietor)[,:]?\s+([A-Z][^.,;()]{3,60})/i.exec(value);
  if (meet?.[1] && meet[2] && isPersonName(meet[2]) && matchOwnerTitle(meet[1])) {
    return { name: meet[2], title: meet[1] };
  }

  // "James Smith is the owner of ..." / "Jane Doe, who founded ..."
  const predicate = /^([A-Z][^.,;()]{3,60}?)\s+(?:is|was)\s+(?:the|a|our)\s+([^.,;()]{3,60})/.exec(value);
  if (predicate?.[1] && predicate[2] && isPersonName(predicate[1]) && matchOwnerTitle(predicate[2])) {
    return { name: predicate[1], title: predicate[2] };
  }

  // "CEO James Smith" — title immediately preceding a name.
  const prefixed = /^(founder|co-founder|owner|co-owner|president|ceo|proprietor|managing director|managing partner)\s+([A-Z][^.,;()]{3,60})$/i.exec(value);
  if (prefixed?.[1] && prefixed[2] && isPersonName(prefixed[2])) {
    return { name: prefixed[2], title: prefixed[1] };
  }

  return null;
}

function ownerFromJsonLd(nodes: readonly JsonObject[], pageUrl: string): OwnerCandidate[] {
  const candidates: OwnerCandidate[] = [];

  const addPerson = (person: JsonValue | undefined, impliedTitle: string | null, bonus: number): void => {
    if (Array.isArray(person)) {
      for (const item of person) addPerson(item, impliedTitle, bonus);
      return;
    }
    const name = typeof person === 'string' ? person : isJsonObject(person) ? asString(person['name']) : null;
    if (!name || !isPersonName(name)) return;

    const jobTitle = isJsonObject(person) ? asString(person['jobTitle']) : null;
    const title = jobTitle ?? impliedTitle;
    if (!title) return;
    const match = matchOwnerTitle(title);
    if (!match) return;

    candidates.push({
      name: cleanPersonName(name) ?? name,
      title: normaliseWhitespace(title),
      confidence: Math.min(100, match.confidence + bonus),
      foundOn: pageUrl,
      evidence: `JSON-LD ${impliedTitle ? `Organization.${impliedTitle}` : 'Person.jobTitle'} = "${title}"`,
    });
  };

  for (const node of nodes) {
    const types = jsonLdTypes(node);
    if (types.some((type) => ['organization', 'localbusiness', 'dentist', 'professionalservice', 'homeandconstructionbusiness', 'hvacbusiness', 'corporation'].includes(type))) {
      addPerson(node['founder'], 'founder', 10);
      addPerson(node['founders'], 'founder', 10);
      addPerson(node['owner'], 'owner', 10);
    }
    if (types.includes('person')) addPerson(node, null, 5);
  }

  return candidates;
}

/**
 * Owner extraction from the DOM: a person's name plus a qualifying title,
 * either in the same element or in an immediately adjacent one (the classic
 * team-card shape: <h3>Name</h3><p>Title</p>).
 */
function ownerFromDom($: Doc, pageUrl: string, businessName: string | null): OwnerCandidate[] {
  const candidates: OwnerCandidate[] = [];
  const businessKey = businessName ? foldCase(businessName) : null;

  const push = (name: string, title: string, confidence: number, evidence: string): void => {
    const clean = cleanPersonName(name);
    if (!clean || !isPersonName(clean)) return;
    if (businessKey && foldCase(clean) === businessKey) return;
    candidates.push({ name: clean, title: normaliseWhitespace(title), confidence, foundOn: pageUrl, evidence });
  };

  // 1. Single element containing both name and title.
  $('h1, h2, h3, h4, h5, h6, p, li, td, figcaption, span, div, strong, em, b').each((_, element) => {
    const node = $(element);
    // Only look at elements whose own text is short; a whole <div> page body is noise.
    const text = normaliseWhitespace(node.text());
    if (text === '' || text.length > 140) return;
    if (node.children('p, div, section, ul, table').length > 0) return;

    const split = splitNameAndTitle(text);
    if (!split) return;
    const match = matchOwnerTitle(split.title);
    if (!match) return;
    push(split.name, split.title, match.confidence, `same element: "${text}"`);
  });

  // 2. Name in a heading, title in the next sibling (team/leadership cards).
  $('h1, h2, h3, h4, h5, h6, strong, b').each((_, element) => {
    const heading = $(element);
    const name = normaliseWhitespace(heading.text());
    if (!isPersonName(name)) return;

    const siblings: Cheerio<AnyNode>[] = [heading.next(), heading.next().next()];
    const parentNext = heading.parent().next();
    if (parentNext.length > 0) siblings.push(parentNext);

    for (const sibling of siblings) {
      if (sibling.length === 0) continue;
      const titleText = normaliseWhitespace(sibling.text());
      if (titleText === '' || titleText.length > 100) continue;
      const match = matchOwnerTitle(titleText);
      if (!match) continue;
      // The sibling must read as a title, not a paragraph that happens to say "owner".
      if (titleText.split(/\s+/).length > 8) continue;
      push(name, titleText, match.confidence - 3, `adjacent element: "${name}" / "${titleText}"`);
      break;
    }
  });

  // 3. Sentences in body copy: "Founded by James Smith in 2008."
  const sentences = pageText($).split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    if (sentence.length > 220) continue;
    const split = splitNameAndTitle(sentence);
    if (!split) continue;
    const match = matchOwnerTitle(split.title);
    if (!match) continue;
    push(split.name, split.title, match.confidence - 8, `sentence: "${normaliseWhitespace(sentence).slice(0, 120)}"`);
  }

  return candidates;
}

/**
 * Best owner candidate for one page, or null.
 * `pageBoost` lets the caller weight about/team/leadership pages above the homepage.
 */
export function extractOwner(
  $: Doc,
  pageUrl: string,
  businessName: string | null,
  pageBoost = 0,
): OwnerCandidate | null {
  const candidates = [
    ...ownerFromJsonLd(extractJsonLd($), pageUrl),
    ...ownerFromDom($, pageUrl, businessName),
  ];
  if (candidates.length === 0) return null;

  // Collapse duplicates of the same person, keeping the strongest evidence.
  const byName = new Map<string, OwnerCandidate>();
  for (const candidate of candidates) {
    const key = foldCase(candidate.name);
    const existing = byName.get(key);
    const boosted = { ...candidate, confidence: candidate.confidence + pageBoost };
    if (!existing || boosted.confidence > existing.confidence) byName.set(key, boosted);
  }

  return [...byName.values()].sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

/* ------------------------------------------------------------------ *
 * Services
 * ------------------------------------------------------------------ */

const GENERIC_WORDS = new Set([
  'quality', 'professional', 'affordable', 'trusted', 'expert', 'experts', 'best', 'top',
  'leading', 'premier', 'reliable', 'solutions', 'solution', 'services', 'service', 'care',
  'excellence', 'satisfaction', 'guaranteed', 'complete', 'full', 'our', 'we', 'your', 'the',
  'and', 'for', 'of', 'in', 'a', 'all', 'more', 'new', 'great', 'superior', 'exceptional',
  'outstanding', 'friendly', 'fast', 'local', 'licensed', 'insured', 'certified', 'award',
  'winning', 'about', 'us', 'home', 'contact', 'info', 'help', 'options', 'work', 'works',
]);

/** Would this string be a credible, specific service label? */
export function isLikelyService(candidate: string, businessName: string | null = null): boolean {
  const value = tidyServiceLabel(candidate);
  if (value === '') return false;
  if (value.length < SERVICE_RULES.minChars || value.length > SERVICE_RULES.maxChars) return false;

  const folded = foldCase(value);
  if (GENERIC_SERVICE_PHRASES.includes(folded)) return false;
  if (GENERIC_SERVICE_SUBSTRINGS.some((fragment) => folded.includes(fragment))) return false;
  if (businessName && folded === foldCase(businessName)) return false;

  if (/[@]|https?:|\d{3}[-.\s]?\d{3,}/.test(value)) return false;
  if (/[!?]$/.test(value)) return false;
  if (/^\d+$/.test(folded)) return false;

  const words = folded.split(/\s+/).filter((word) => word !== '');
  if (words.length < SERVICE_RULES.minWords || words.length > SERVICE_RULES.maxWords) return false;

  // Marketing filler is generic words all the way down; a real service names a thing.
  const specific = words.filter((word) => !GENERIC_WORDS.has(word.replace(/[^a-z]/g, '')));
  if (specific.length === 0) return false;

  // Team pages put staff names in exactly the same headings services live in.
  // Only two-token candidates are ambiguous enough to reject here ("James Smith"
  // vs "Roof Replacement"); longer phrases like "Root Canal Therapy" are services
  // far more often than names, and team containers are excluded structurally in
  // extractServices.
  if (words.length === 2 && isPersonName(value)) return false;

  // A single generic-ish word ("Repairs") is too thin unless it is a real noun of length.
  if (words.length === 1 && (words[0]?.length ?? 0) < 6) return false;

  return true;
}

function collectHeadingsFrom($: Doc, selection: Cheerio<AnyNode>, out: string[]): void {
  selection.find('h2, h3, h4, .card-title, .service-title, [class*="title" i]').each((_, element) => {
    out.push($(element).text());
  });
  selection.find('a').each((_, element) => {
    out.push($(element).text());
  });
  selection.find('> ul > li, > ol > li').each((_, element) => {
    const node = $(element);
    if (node.children('ul, ol').length > 0) return;
    out.push(node.text());
  });
}

/**
 * Concrete services, gathered from structured data, service-ish containers,
 * service-page headings and navigation, then filtered hard.
 *
 * `isServicePage` relaxes the container requirement: on `/services` the page's
 * own headings are the services.
 */
/** Containers that hold people, not services. Their headings are names. */
const PEOPLE_CONTAINER_SELECTOR = [
  '[class*="team" i]',
  '[id*="team" i]',
  '[class*="staff" i]',
  '[id*="staff" i]',
  '[class*="bio" i]',
  '[class*="member" i]',
  '[class*="person" i]',
  '[class*="doctor" i]',
  '[class*="leadership" i]',
].join(', ');

export function extractServices($: Doc, options: { isServicePage?: boolean; businessName?: string | null } = {}): string[] {
  const raw: string[] = [];
  const businessName = options.businessName ?? extractBusinessName($);

  /**
   * Structural guard: a heading inside a team card is a person, not a service.
   * Checked per element rather than by pruning the tree, because the same
   * document is reused for owner extraction.
   */
  const inPeopleContainer = (element: AnyNode): boolean =>
    $(element).closest(PEOPLE_CONTAINER_SELECTOR).length > 0;

  // 1. Structured data — the most trustworthy source available.
  for (const node of extractJsonLd($)) {
    const types = jsonLdTypes(node);
    if (types.includes('service') || types.includes('offer')) {
      const name = asString(node['name']) ?? asString(node['serviceType']);
      if (name) raw.push(name);
    }
    for (const key of ['hasOfferCatalog', 'makesOffer', 'itemOffered', 'itemListElement', 'serviceType', 'availableService']) {
      const value = node[key];
      if (value === undefined) continue;
      const stack: JsonValue[] = [value];
      let guard = 0;
      while (stack.length > 0 && guard < 200) {
        guard += 1;
        const current = stack.pop();
        if (current === undefined) continue;
        if (typeof current === 'string') {
          raw.push(current);
        } else if (Array.isArray(current)) {
          stack.push(...current);
        } else if (isJsonObject(current)) {
          const name = asString(current['name']);
          if (name) raw.push(name);
          for (const nestedKey of ['itemOffered', 'itemListElement', 'offers']) {
            const nested = current[nestedKey];
            if (nested !== undefined) stack.push(nested);
          }
        }
      }
    }
  }

  // 2. Containers that identify themselves as being about services.
  const hintSelector = SERVICE_CONTAINER_HINTS.flatMap((hint) => [
    `section[id*="${hint}" i]`,
    `section[class*="${hint}" i]`,
    `div[id*="${hint}" i]`,
    `div[class*="${hint}" i]`,
    `ul[class*="${hint}" i]`,
    `nav[class*="${hint}" i]`,
  ]).join(', ');
  $(hintSelector).each((_, element) => {
    if (inPeopleContainer(element)) return;
    collectHeadingsFrom($, $(element), raw);
  });

  // 3. Navigation entries that hang off a services menu item.
  $('nav a, header a, .menu a, [role="navigation"] a').each((_, element) => {
    const node = $(element);
    const href = node.attr('href') ?? '';
    const hrefIsService = SERVICE_CONTAINER_HINTS.some((hint) => href.toLowerCase().includes(`/${hint}`));
    if (!hrefIsService || inPeopleContainer(element)) return;
    // The menu root ("Services") is filtered out later as a generic phrase.
    raw.push(node.text());
  });

  // 4. On a services page, the page's own headings are the services.
  if (options.isServicePage) {
    $('h1, h2, h3').each((_, element) => {
      if (inPeopleContainer(element)) return;
      raw.push($(element).text());
    });
    $('main li, article li, .content li').each((_, element) => {
      if (inPeopleContainer(element)) return;
      const node = $(element);
      if (node.children('ul, ol').length > 0) return;
      raw.push(node.text());
    });
  }

  const tidied = raw.map(tidyServiceLabel).filter((value) => isLikelyService(value, businessName));
  return uniqueCaseInsensitive(tidied).slice(0, SERVICE_RULES.maxServices);
}

/* ------------------------------------------------------------------ *
 * Revenue signals (extraction only — the estimate itself lives elsewhere)
 * ------------------------------------------------------------------ */

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  mm: 1_000_000,
  million: 1_000_000,
  b: 1_000_000_000,
  bn: 1_000_000_000,
  billion: 1_000_000_000,
};

function parseMoney(amount: string, unit: string | undefined): number | null {
  const base = Number(amount.replace(/,/g, ''));
  if (!Number.isFinite(base) || base <= 0) return null;
  const multiplier = unit ? (MULTIPLIERS[unit.toLowerCase()] ?? 1) : 1;
  return base * multiplier;
}

/**
 * Deterministic, explicitly-stated signals only.
 * Anything requiring judgement (site quality, ad copy, review volume) is not collected,
 * because the estimator must not be able to reach it.
 */
export function extractRevenueSignals($: Doc): RevenueSignals {
  const text = pageText($);
  const signals: RevenueSignals = {
    publishedRevenueUsd: null,
    employeeCount: null,
    locationCount: null,
  };

  // "annual revenue of $4.2 million" / "$4.2M in annual revenue"
  const revenueForward =
    /\b(?:annual\s+)?(?:revenue|revenues|sales|turnover)\s+(?:of\s+|were\s+|was\s+|is\s+|exceeded\s+|over\s+)?(?:USD\s*)?\$\s?([\d,]+(?:\.\d+)?)\s*(k|m|mm|bn|b|thousand|million|billion)?\b/i.exec(text);
  const revenueBackward =
    /\$\s?([\d,]+(?:\.\d+)?)\s*(k|m|mm|bn|b|thousand|million|billion)?\s+(?:in\s+)?(?:annual\s+)?(?:revenue|revenues|sales|turnover)\b/i.exec(text);
  const revenueMatch = revenueForward ?? revenueBackward;
  if (revenueMatch?.[1]) {
    const value = parseMoney(revenueMatch[1], revenueMatch[2]);
    if (value !== null && value >= 10_000) signals.publishedRevenueUsd = value;
  }

  // Headcount must be attached to an explicit people noun.
  const employeeMatch =
    /\b(?:team|staff|crew|workforce)\s+of\s+(?:over\s+|more than\s+|nearly\s+)?([\d,]{1,7})\b/i.exec(text) ??
    /\b(?:over\s+|more than\s+|nearly\s+|about\s+|approximately\s+)?([\d,]{1,7})\+?\s+(?:full[-\s]time\s+)?(?:employees|staff members|team members|technicians|dentists|professionals|installers|crew members)\b/i.exec(text) ??
    /\bemploys\s+(?:over\s+|more than\s+|nearly\s+|about\s+)?([\d,]{1,7})\b/i.exec(text);
  if (employeeMatch?.[1]) {
    const count = Number(employeeMatch[1].replace(/,/g, ''));
    if (Number.isFinite(count) && count >= 1 && count <= 500_000) signals.employeeCount = count;
  }

  for (const node of extractJsonLd($)) {
    const employees = asNumber(node['numberOfEmployees']);
    if (employees !== null && employees >= 1 && employees <= 500_000) {
      signals.employeeCount = Math.max(signals.employeeCount ?? 0, employees);
    }
  }

  // Locations: distinct structured addresses beat prose, but prose is accepted.
  const addresses = new Set<string>();
  for (const node of jsonLdOfType(extractJsonLd($), 'LocalBusiness', 'Dentist', 'HVACBusiness', 'ProfessionalService', 'Organization')) {
    const address = node['address'];
    const list = Array.isArray(address) ? address : [address];
    for (const item of list) {
      if (!isJsonObject(item)) continue;
      const key = [asString(item['streetAddress']), asString(item['addressLocality']), asString(item['postalCode'])]
        .filter((part) => part !== null)
        .join('|');
      if (key !== '') addresses.add(foldCase(key));
    }
  }
  if (addresses.size > 0) signals.locationCount = addresses.size;

  const locationMatch = /\b([\d,]{1,4})\s+(?:convenient\s+)?locations\b/i.exec(text);
  if (locationMatch?.[1]) {
    const count = Number(locationMatch[1].replace(/,/g, ''));
    if (Number.isFinite(count) && count >= 1 && count <= 10_000) {
      signals.locationCount = Math.max(signals.locationCount ?? 0, count);
    }
  }

  return signals;
}

/* ------------------------------------------------------------------ *
 * Rendering heuristics
 * ------------------------------------------------------------------ */

/**
 * True when the HTML looks like an unrendered single-page-app shell, i.e. plain
 * HTTP got us nothing and it is worth paying for a real browser.
 */
export function looksLikeSpaShell(html: string): boolean {
  if (html.trim().length === 0) return true;
  const $ = parseHtml(html);
  const text = pageText($);
  const anchors = $('a[href]').length;
  const headings = $('h1, h2, h3').length;

  if (text.length > 600 && anchors >= 3) return false;
  if (text.length < 200 && anchors <= 2) return true;
  if (headings === 0 && anchors <= 3 && text.length < 800) return true;

  // Classic empty mount points.
  const mount = $('#root, #app, #__next, [data-reactroot], [ng-app], [data-vue-root]').first();
  if (mount.length > 0 && normaliseWhitespace(mount.text()).length < 120) return true;

  return false;
}
