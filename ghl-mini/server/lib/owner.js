/**
 * Works out who actually owns the business, so a call opens with
 * "is Dave in?" rather than "can I speak to the owner?".
 *
 * Sources, best first:
 *
 *   1. Schema.org founder/employee markup on their own site.
 *   2. Plain English on their site: "Owner: Dave Miller", "Founded by...".
 *   3. The business name itself: "Dave's Plumbing", "Miller & Sons".
 *   4. The email local part: dave@daveplumbing.com.
 *   5. Names customers repeat in Google reviews.
 *
 * All of it is public information the business chose to publish. There is
 * deliberately no LinkedIn or Facebook here — both block automated reading
 * behind a login, and a scraper pointed at them gets your IP banned rather
 * than getting you names.
 */

import { GENERIC_TOKENS } from './chains.js';

const TITLE_WORDS = [
  'owner', 'founder', 'co-founder', 'cofounder', 'president', 'principal',
  'proprietor', 'managing director', 'director', 'ceo', 'partner',
];

/**
 * Matches a word in any casing without the /i flag. That flag would also
 * make [A-Z] match lowercase, and the capitalisation is the only thing
 * telling a name apart from the words around it — "Owner: Dave Thompson
 * has served" would capture "Dave Thompson has".
 */
const anyCase = (word) => word.replace(/[a-z]/g, (ch) => `[${ch}${ch.toUpperCase()}]`);

const TITLES = TITLE_WORDS.map(anyCase).join('|');

/** Words that look like names to a regex but are not. */
const NOT_NAMES = new Set([
  'the', 'our', 'your', 'my', 'we', 'us', 'they', 'this', 'that', 'about', 'contact',
  'home', 'services', 'service', 'team', 'staff', 'company', 'business', 'family',
  'call', 'email', 'phone', 'today', 'now', 'free', 'get', 'more', 'read', 'learn',
  'privacy', 'policy', 'terms', 'copyright', 'rights', 'reserved', 'inc', 'llc', 'ltd',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday', 'google', 'facebook', 'yelp', 'review',
  'reviews', 'star', 'stars', 'best', 'quality', 'plumbing', 'roofing', 'heating',
  'air', 'electric', 'lawn', 'pest', 'dental', 'repair', 'installation', 'emergency',
  'residential', 'commercial', 'licensed', 'insured', 'bonded', 'certified', 'thank',
  'thanks', 'hello', 'welcome', 'schedule', 'appointment', 'estimate', 'quote',
]);

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const stripTags = (html) => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
  .replace(/\s+/g, ' ');

/** Does this look like a real person's name rather than a stray phrase? */
function plausibleName(name) {
  const parts = clean(name).split(' ');
  if (parts.length < 1 || parts.length > 4) return false;
  for (const part of parts) {
    const bare = part.replace(/[^A-Za-z'-]/g, '');
    if (bare.length < 2) return false;
    if (NOT_NAMES.has(bare.toLowerCase())) return false;
    if (!/^[A-Z]/.test(bare)) return false;
  }
  return true;
}

const titleCaseName = (s) => clean(s).split(' ')
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  .join(' ');

/** 1. Schema.org markup — the most reliable thing on any site. */
function fromSchema(html) {
  const out = [];
  const blocks = String(html || '').match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    let data;
    try { data = JSON.parse(body); } catch { continue; }
    for (const node of Array.isArray(data) ? data : [data]) walk(node, out);
  }
  return out;

  function walk(node, acc, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 6) return;
    for (const key of ['founder', 'founders', 'owner', 'employee', 'employees', 'author']) {
      const value = node[key];
      if (!value) continue;
      for (const person of Array.isArray(value) ? value : [value]) {
        const name = typeof person === 'string' ? person : person?.name;
        if (name && plausibleName(name)) {
          acc.push({ name: clean(name), role: person?.jobTitle || key, source: 'schema', confidence: 95 });
        }
      }
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach((x) => walk(x, acc, depth + 1));
      else if (v && typeof v === 'object') walk(v, acc, depth + 1);
    }
  }
}

/** 2. Plain English on the page. */
function fromPageText(html) {
  const text = stripTags(html);
  const out = [];
  const patterns = [
    // "Owner: Dave Miller" / "Owner - Dave Miller"
    new RegExp(`\\b(${TITLES})\\s*[:\\-–]\\s*([A-Z][A-Za-z'\\-]+(?:\\s+[A-Z][A-Za-z'\\-]+){0,2})`, 'g'),
    // "Dave Miller, Owner"
    new RegExp(`\\b([A-Z][A-Za-z'\\-]+(?:\\s+[A-Z][A-Za-z'\\-]+){0,2}),\\s*(?:the\\s+)?(${TITLES})\\b`, 'g'),
    // "founded by Dave Miller" / "started by Dave"
    new RegExp(`\\b(?:${['founded','started','established','owned','run','led'].map(anyCase).join('|')})\\s+(?:and\\s+\\w+\\s+)?by\\s+([A-Z][A-Za-z'\\-]+(?:\\s+[A-Z][A-Za-z'\\-]+){0,2})`, 'g'),
    // "Meet Dave, our owner"
    new RegExp(`\\b[Mm]eet\\s+([A-Z][A-Za-z'\\-]+(?:\\s+[A-Z][A-Za-z'\\-]+){0,2})[,.]?\\s*(?:our|the)\\s+(${TITLES})`, 'g'),
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      // Whichever capture group is the name, not the job title.
      const candidate = new RegExp(`^(${TITLES})$`, 'i').test(m[1]) ? m[2] : m[1];
      const role = candidate === m[1] ? (m[2] || 'owner') : m[1];
      if (candidate && plausibleName(candidate)) {
        out.push({ name: clean(candidate), role: clean(role).toLowerCase(), source: 'website', confidence: 80 });
      }
    }
  }
  return out;
}

/** 3. "Dave's Plumbing" and "Miller & Sons" put the name on the sign. */
function fromBusinessName(businessName) {
  const name = clean(businessName);
  const out = [];

  // "Tampa's Grand Span Roofing" is a city, not a person. Trade words and
  // place names never count, however possessive they look.
  const isPersonish = (word) => !GENERIC_TOKENS.has(String(word).toLowerCase());

  const possessive = name.match(/^([A-Z][a-z]{2,})(?:'s|s')\s/);
  if (possessive && isPersonish(possessive[1]) && plausibleName(possessive[1])) {
    out.push({ name: possessive[1], role: 'owner', source: 'business name', confidence: 55, firstOnly: true });
  }

  const andSons = name.match(/^([A-Z][A-Za-z'\-]{2,})\s+(?:&|and)\s+(?:[Ss]ons?|[Dd]aughters?|[Bb]rothers?|[Ff]amily)\b/);
  if (andSons && isPersonish(andSons[1]) && plausibleName(andSons[1])) {
    out.push({ name: andSons[1], role: 'owner', source: 'business name', confidence: 45, surnameOnly: true });
  }
  return out;
}

/** 4. dave@daveplumbing.com is usually Dave. */
function fromEmail(email, businessName) {
  if (!email || !email.includes('@')) return [];
  const local = email.split('@')[0].toLowerCase();
  if (/^(info|contact|hello|sales|support|admin|office|team|service|help|enquir|inquir|book|mail|no-?reply)/.test(local)) {
    return [];
  }
  const first = local.split(/[._\-+0-9]/).filter(Boolean)[0];
  if (!first || first.length < 3) return [];
  const business = clean(businessName).toLowerCase();
  if (business.includes(first)) return []; // dave@ at davesplumbing is the brand, not proof
  const name = titleCaseName(first);
  return plausibleName(name)
    ? [{ name, role: 'contact', source: 'email address', confidence: 50, firstOnly: true }]
    : [];
}

/**
 * 5. Names customers keep repeating. A name in several reviews is someone
 * who turns up on jobs — often the owner of a small outfit, sometimes an
 * employee, so it is scored lowest and always labelled.
 */
export function fromReviews(reviews = []) {
  const counts = new Map();
  for (const review of reviews) {
    const text = clean(typeof review === 'string' ? review : review?.text?.text || review?.text || '');
    if (!text) continue;
    const seen = new Set();
    // "Dave was great", "Dave came out", "thanks to Dave"
    const VERBS = ['was', 'is', 'came', 'did', 'showed', 'arrived', 'fixed', 'helped',
      'went', 'took', 'explained', 'quoted', 'installed', 'replaced'].map(anyCase).join('|');
    const LEADINS = ['thanks to', 'thank you to', 'thanks', 'ask for', 'asked for',
      'worked with', 'dealt with', 'sent'].map(anyCase).join('|');
    const re = new RegExp(
      `\\b([A-Z][a-z]{2,11})\\b(?=\\s+(?:${VERBS}|and his|and her))` +
      `|(?:${LEADINS})\\s+([A-Z][a-z]{2,11})\\b`, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const name = m[1] || m[2];
      if (!name || NOT_NAMES.has(name.toLowerCase()) || !plausibleName(name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, n]) => ({
      name, role: 'named in reviews', source: `${n} reviews`,
      confidence: Math.min(60, 30 + n * 8), firstOnly: true,
    }));
}

/**
 * Everything together. Returns the best candidate plus the rest, so the
 * dialer can show "Dave (owner)" and you can see where it came from.
 */
export function findOwner({ html = '', businessName = '', email = null, reviews = [] } = {}) {
  const candidates = [
    ...fromSchema(html),
    ...fromPageText(html),
    ...fromBusinessName(businessName),
    ...fromEmail(email, businessName),
    ...fromReviews(reviews),
  ];

  // Merge duplicates, keeping the strongest evidence and noting agreement.
  const merged = [];
  const firstOf = (name) => name.split(' ')[0].toLowerCase();

  // A first name from one source and a full name from another are the same
  // person, and two sources agreeing is stronger evidence than either alone.
  for (const c of [...candidates].sort((a, b) => b.confidence - a.confidence)) {
    const hit = merged.find((m) => {
      const a = m.name.toLowerCase();
      const b = c.name.toLowerCase();
      if (a === b) return true;
      // Only match on first name when one of them is a bare first name.
      const oneIsBare = !m.name.includes(' ') || !c.name.includes(' ');
      return oneIsBare && firstOf(m.name) === firstOf(c.name);
    });

    if (!hit) {
      merged.push({ ...c, sources: [c.source] });
      continue;
    }
    if (hit.sources.includes(c.source)) continue;
    hit.sources.push(c.source);
    hit.confidence = Math.min(99, hit.confidence + 12);
    // Prefer the fuller name: "Dave Miller" over "Dave".
    if (c.name.split(' ').length > hit.name.split(' ').length) hit.name = c.name;
  }

  const ranked = merged.sort((a, b) => b.confidence - a.confidence);
  return { best: ranked[0] || null, all: ranked };
}

export { plausibleName, stripTags };
