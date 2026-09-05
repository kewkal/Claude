/**
 * Pure normalisation helpers. No I/O, no side effects — everything here is
 * directly unit-testable and is the shared vocabulary for dedupe and extraction.
 */

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { getDomain, parse as parseHost } from 'tldts';

import { EMAIL_DOMAIN_BLOCKLIST, ROLE_EMAIL_LOCAL_PARTS, TRACKING_PARAMS } from '../config.js';
import type { EmailKind, SocialPlatform } from '../types/lead.js';

/** Collapse all whitespace runs (including NBSP and newlines) to single spaces. */
export function normaliseWhitespace(value: string): string {
  return value.replace(/[\s\u00a0\u200b\u2028\u2029]+/g, ' ').trim();
}

/** Lowercase + whitespace-collapsed, for case-insensitive comparisons. */
export function foldCase(value: string): string {
  return normaliseWhitespace(value).toLowerCase();
}

/** URL-safe slug used in output filenames. */
export function slugify(value: string): string {
  const slug = normaliseWhitespace(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'unknown';
}

/** `20260904-131502` — filesystem-safe, sortable, local time. */
export function timestampSlug(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Turn anything vaguely URL-shaped into an absolute https URL, or null.
 * Accepts bare hosts ("acme.com") and protocol-relative URLs.
 */
export function toAbsoluteUrl(raw: string | null | undefined, base?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || /^(mailto:|tel:|javascript:|data:|#)/i.test(trimmed)) return null;

  const candidates: string[] = [];
  if (trimmed.startsWith('//')) {
    candidates.push(`https:${trimmed}`);
  } else if (/^https?:\/\//i.test(trimmed)) {
    candidates.push(trimmed);
  } else if (base) {
    candidates.push(trimmed);
  } else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?)/i.test(trimmed)) {
    candidates.push(`https://${trimmed}`);
  } else {
    return null;
  }

  for (const candidate of candidates) {
    try {
      const url = base ? new URL(candidate, base) : new URL(candidate);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url.toString();
    } catch {
      // fall through
    }
  }
  return null;
}

/**
 * Canonical form used for crawl de-duplication and lead dedupe:
 * https, lowercase host, no `www.`, no fragment, tracking params stripped,
 * remaining params sorted, trailing slash removed from non-root paths.
 */
export function canonicaliseUrl(raw: string | null | undefined, base?: string): string | null {
  const absolute = toAbsoluteUrl(raw, base);
  if (!absolute) return null;

  let url: URL;
  try {
    url = new URL(absolute);
  } catch {
    return null;
  }

  // http and https of the same public site are one site, so normalise the scheme
  // for dedupe. Loopback keeps its scheme: a local server is usually http-only.
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (!isLoopback) url.protocol = 'https:';
  url.hash = '';
  url.username = '';
  url.password = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (url.hostname === '') return null;
  if (
    (url.port === '80' && url.protocol === 'http:') ||
    (url.port === '443' && url.protocol === 'https:')
  ) {
    url.port = '';
  }

  for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
  const sorted = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [key, value] of sorted) url.searchParams.append(key, value);

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');

  return url.toString();
}

/** Registrable domain (`shop.acme.co.uk` -> `acme.co.uk`), or null. */
export function registrableDomain(rawUrlOrHost: string | null | undefined): string | null {
  if (!rawUrlOrHost) return null;
  const input = rawUrlOrHost.includes('://') ? rawUrlOrHost : `https://${rawUrlOrHost}`;
  const domain = getDomain(input, { allowPrivateDomains: false });
  return domain ? domain.toLowerCase() : null;
}

/** True when both URLs sit on the same registrable domain. */
export function isSameRegistrableDomain(a: string, b: string): boolean {
  const domainA = registrableDomain(a);
  const domainB = registrableDomain(b);
  return domainA !== null && domainA === domainB;
}

/**
 * The crawler's "stay on this site" test. Registrable domain where one exists,
 * falling back to an exact host match for hosts that have none (loopback).
 */
export function isSameSite(a: string, b: string): boolean {
  if (isSameRegistrableDomain(a, b)) return true;
  try {
    const hostA = new URL(a);
    const hostB = new URL(b);
    if (registrableDomain(a) !== null || registrableDomain(b) !== null) return false;
    return hostA.host.toLowerCase() === hostB.host.toLowerCase();
  } catch {
    return false;
  }
}

/** True when the host is a real public hostname (not an IP or an unlisted TLD). */
export function isPublicHost(rawUrl: string): boolean {
  const parsed = parseHost(rawUrl, { allowPrivateDomains: false });
  return parsed.domain !== null && parsed.isIp !== true;
}

/**
 * True when the crawler is willing to fetch this host.
 *
 * Public hostnames, plus loopback so the whole pipeline can be exercised
 * against a local fixture server. A real discovery source never returns
 * loopback, so allowing it costs nothing in production.
 */
export function isCrawlableHost(rawUrl: string): boolean {
  if (isPublicHost(rawUrl)) return true;
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Normalise a phone number, preferring E.164.
 * `defaultRegion` is derived from the run's location; unparseable input falls back
 * to a digits-only form so dedupe still has something stable to work with.
 */
export function normalisePhone(
  raw: string | null | undefined,
  defaultRegion?: string | null,
): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^tel:/i, '').replace(/\s*(ext|x|extension)\.?\s*\d+$/i, '');
  if (!/\d/.test(cleaned)) return null;

  const region = defaultRegion && /^[A-Z]{2}$/.test(defaultRegion) ? (defaultRegion as CountryCode) : undefined;
  const parsed = parsePhoneNumberFromString(cleaned, region);
  if (parsed?.isValid()) return parsed.number;

  const digits = cleaned.replace(/[^\d+]/g, '');
  const digitCount = digits.replace(/\D/g, '').length;
  if (digitCount < 7 || digitCount > 15) return null;
  return digits.startsWith('+') ? digits : digits.replace(/^0+/, '');
}

/** Digits-only key for dedupe; last 10 digits, which survives country-code noise. */
export function phoneDedupeKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

/** Best-effort ISO-3166 alpha-2 region from a free-text location string. */
export function regionFromLocation(location: string): string | null {
  const text = ` ${foldCase(location)} `;
  const US_STATES =
    /\b(a[lkzr]|c[aot]|de|fl|ga|hi|i[adln]|k[sy]|la|m[adeinost]|n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|t[nx]|ut|v[at]|w[aivy])\b/;
  if (/\b(usa|u\.s\.a\.|united states|us)\b/.test(text)) return 'US';
  if (/\b(uk|united kingdom|england|scotland|wales|northern ireland)\b/.test(text)) return 'GB';
  if (/\b(canada|ontario|quebec|alberta|british columbia)\b/.test(text)) return 'CA';
  if (/\b(australia|nsw|victoria|queensland)\b/.test(text)) return 'AU';
  if (/\b(ireland|eire)\b/.test(text)) return 'IE';
  if (/\b(new zealand)\b/.test(text)) return 'NZ';
  if (US_STATES.test(text)) return 'US';
  return null;
}

/** Loose but standards-shaped email validation. Rejects known placeholder domains. */
export function isValidEmail(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (value.length < 6 || value.length > 254) return false;
  if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return false;
  if (/\.\./.test(value)) return false;
  if (/^[._%+-]|[._%+-]@/.test(value)) return false;

  const domain = value.slice(value.lastIndexOf('@') + 1);
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (tld.length < 2 || /\d/.test(tld)) return false;
  if (EMAIL_DOMAIN_BLOCKLIST.includes(domain)) return false;
  // Image filenames dragged in by loose text matching.
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/.test(value)) return false;
  return true;
}

export function normaliseEmail(address: string): string {
  return address.trim().toLowerCase().replace(/^mailto:/, '').split('?')[0] ?? '';
}

/** True when the local part reads as a shared inbox rather than a person. */
export function isGenericEmail(address: string): boolean {
  const local = normaliseEmail(address).split('@')[0] ?? '';
  const bare = local.replace(/[._-]/g, '');
  return ROLE_EMAIL_LOCAL_PARTS.some((role) => {
    const roleBare = role.replace(/[._-]/g, '');
    return local === role || bare === roleBare || bare.startsWith(roleBare);
  });
}

/**
 * Decide whether an address plausibly belongs to a specific person.
 * Requires a real overlap with the person's name — never the reverse
 * (we do not derive a person from an address).
 */
export function classifyEmail(address: string, personName: string | null): EmailKind {
  if (isGenericEmail(address)) return 'role';
  if (!personName) return 'unknown';

  const local = (normaliseEmail(address).split('@')[0] ?? '').replace(/[^a-z]/g, '');
  if (local.length < 3) return 'unknown';

  const parts = foldCase(personName)
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z]/g, ''))
    .filter((part) => part.length >= 2);
  if (parts.length === 0) return 'unknown';

  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';

  const matches =
    (first.length >= 3 && local === first) ||
    (last.length >= 3 && local === last) ||
    (first.length >= 2 && last.length >= 2 &&
      (local === `${first}${last}` ||
        local === `${last}${first}` ||
        local === `${first[0] ?? ''}${last}` ||
        local === `${first}${last[0] ?? ''}`));

  return matches ? 'personal' : 'unknown';
}

/** Strip common human obfuscations so a real address can be recovered. */
export function deobfuscateEmails(text: string): string[] {
  const normalised = text
    .replace(/\s*[[({<]\s*at\s*[\])}>]\s*/gi, '@')
    .replace(/\s*[[({<]\s*dot\s*[\])}>]\s*/gi, '.')
    .replace(/\s+at\s+(?=[a-z0-9._%+-]+\s+dot\s+)/gi, '@')
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s*&#64;\s*/g, '@')
    .replace(/\s*%40\s*/gi, '@');

  const matches = normalised.match(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) ?? [];
  return unique(matches.map(normaliseEmail).filter(isValidEmail));
}

const SOCIAL_HOSTS: Record<SocialPlatform, readonly string[]> = {
  instagram: ['instagram.com', 'instagr.am'],
  facebook: ['facebook.com', 'fb.com', 'fb.me'],
  linkedin: ['linkedin.com', 'lnkd.in'],
};

/** Path segments that are platform plumbing, never a business profile. */
const SOCIAL_REJECT_SEGMENTS: Record<SocialPlatform, readonly string[]> = {
  instagram: ['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about', 'legal'],
  facebook: [
    'sharer', 'sharer.php', 'share.php', 'share', 'dialog', 'login', 'login.php', 'plugins',
    'tr', 'help', 'policies', 'privacy', 'terms', 'events', 'groups', 'watch', 'marketplace',
    'photo', 'photo.php', 'permalink.php', 'story.php', 'profile.php', 'hashtag', 'business',
  ],
  linkedin: ['shareArticle', 'sharing', 'share-offsite', 'login', 'uas', 'feed', 'posts', 'legal', 'help', 'jobs'],
};

/**
 * Normalise a social URL to a canonical profile URL, or null when the link is
 * a share widget, a login page, a platform homepage, or otherwise not a profile.
 */
export function normaliseSocialUrl(raw: string, platform: SocialPlatform): string | null {
  const absolute = toAbsoluteUrl(raw);
  if (!absolute) return null;

  let url: URL;
  try {
    url = new URL(absolute);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^[a-z]{2}\./, (m) =>
    // keep country subdomains for linkedin (uk.linkedin.com) but drop language ones elsewhere
    platform === 'linkedin' ? m : '',
  );
  const hostRoot = registrableDomain(url.href);
  if (!hostRoot || !SOCIAL_HOSTS[platform].includes(hostRoot)) return null;
  void host;

  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  if (segments.length === 0) return null; // platform homepage

  if (platform === 'linkedin') {
    const kind = segments[0];
    // Company pages only; personal `/in/` profiles are not the business.
    if (kind !== 'company' && kind !== 'school' && kind !== 'showcase') return null;
    const slug = segments[1];
    if (!slug || SOCIAL_REJECT_SEGMENTS.linkedin.includes(slug)) return null;
    return `https://www.linkedin.com/company/${decodeURIComponent(slug).toLowerCase()}`;
  }

  const handleRaw = segments[0] ?? '';
  const handle = decodeURIComponent(handleRaw).replace(/^@/, '');
  if (handle === '' || SOCIAL_REJECT_SEGMENTS[platform].includes(handleRaw)) return null;
  if (!/^[A-Za-z0-9._-]{2,60}$/.test(handle)) return null;
  // A share widget carries the target in the query string, not the path.
  if (url.searchParams.has('u') || url.searchParams.has('url') || url.searchParams.has('text')) {
    return null;
  }

  if (platform === 'instagram') {
    return `https://www.instagram.com/${handle.toLowerCase()}`;
  }
  // Facebook vanity paths may include `/pages/Name/123`; keep the whole path there.
  if (handleRaw === 'pages' && segments.length >= 3) {
    return `https://www.facebook.com/${segments.slice(0, 3).join('/')}`;
  }
  return `https://www.facebook.com/${handle}`;
}

export function detectSocialPlatform(rawUrl: string): SocialPlatform | null {
  const domain = registrableDomain(rawUrl);
  if (!domain) return null;
  for (const [platform, hosts] of Object.entries(SOCIAL_HOSTS) as [SocialPlatform, readonly string[]][]) {
    if (hosts.includes(domain)) return platform;
  }
  return null;
}

/** Business-name key for dedupe: lowercased, legal suffixes and punctuation dropped. */
export function normaliseBusinessName(name: string): string {
  return foldCase(name)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(
      /\b(inc|incorporated|llc|l l c|ltd|limited|plc|co|corp|corporation|company|gmbh|pty|pte|llp|lp|pc|pa|dds|dmd)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Order-preserving de-duplication. */
export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** Order-preserving, case-insensitive de-duplication of strings. */
export function uniqueCaseInsensitive(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = foldCase(value);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(normaliseWhitespace(value));
  }
  return out;
}

/** Title-case a service label while leaving existing capitalisation patterns alone. */
export function tidyServiceLabel(value: string): string {
  const cleaned = normaliseWhitespace(value)
    .replace(/^[\s\-–—•*·|>»]+/, '')
    .replace(/[\s\-–—•*·|<«]+$/, '')
    .replace(/\s*[|–—]\s*.*$/, '')
    .trim();
  if (cleaned === '') return '';
  // ALL CAPS labels read badly in a CSV; convert to Title Case.
  if (cleaned === cleaned.toUpperCase() && /[A-Z]{4,}/.test(cleaned)) {
    return cleaned
      .toLowerCase()
      .replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase())
      .replace(/\bAnd\b/g, 'and');
  }
  return cleaned;
}

/** Sleep helper used for pacing and backoff. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Exponential backoff with full jitter, capped. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(exponential / 2 + Math.random() * (exponential / 2));
}
