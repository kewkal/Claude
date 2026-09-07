/**
 * Finds a real person's email address on a business website.
 *
 * The point is the owner, not the inbox. info@, contact@ and hello@ go to
 * a receptionist, a shared queue, or nobody at all, and a pitch sent
 * there is competing with every other pitch sent there. dave@ goes to
 * Dave. So generic addresses are collected but never presented as the
 * owner's, and anything matching the owner's known name wins outright.
 */

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b/g;

/** Addresses belonging to the web stack rather than the business. */
const JUNK_DOMAIN = /@(?:example|sentry|wixpress|squarespace|godaddy|shopify|cloudflare|wordpress|w3\.org|schema\.org|jquery|gstatic|googleapis|bootstrapcdn|fontawesome|sentry\.io|domain|yourdomain|email)\b/i;
const JUNK_LOCAL = /^(?:no-?reply|donotreply|postmaster|abuse|webmaster|hostmaster|privacy|legal|dmca|unsubscribe|bounce|mailer-daemon|test|user|name|email|your-?name|someone|example|firstname|username)$/i;

/**
 * Shared inboxes. Useful to know about, never the answer to "who do I
 * email". These are exactly the catch-alls to keep out of the way.
 */
const GENERIC_LOCALS = new Set([
  'info', 'information', 'contact', 'contactus', 'hello', 'hi', 'hey', 'mail',
  'email', 'inbox', 'general', 'enquiries', 'enquiry', 'inquiries', 'inquiry',
  'admin', 'administration', 'office', 'reception', 'frontdesk', 'team',
  'sales', 'newsales', 'estimate', 'estimates', 'quote', 'quotes', 'quoting',
  'service', 'services', 'support', 'help', 'helpdesk', 'customerservice',
  'dispatch', 'scheduling', 'schedule', 'booking', 'bookings', 'appointments',
  'billing', 'accounts', 'accounting', 'accountspayable', 'ar', 'ap', 'invoices',
  'careers', 'career', 'jobs', 'hr', 'recruiting', 'recruitment', 'apply',
  'marketing', 'press', 'media', 'partners', 'vendors', 'suppliers',
  'orders', 'shop', 'store', 'web', 'website', 'webmaster', 'it',
]);

/** Titles that ARE a person, even though they read like a role. */
const OWNER_LOCALS = new Set([
  'owner', 'founder', 'president', 'principal', 'proprietor', 'ceo', 'md',
  'director', 'gm', 'generalmanager', 'boss',
]);

const FREE_MAIL = /@(?:gmail|yahoo|hotmail|outlook|live|aol|icloud|me|comcast|verizon|att|sbcglobal|bellsouth|cox|msn)\./i;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const stripTags = (html) => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

/** Undo the usual "hide it from bots" spellings. */
function deobfuscate(text) {
  return String(text || '')
    .replace(/\s*[\[({<]\s*(?:at|@)\s*[\])}>]\s*/gi, '@')
    .replace(/\s+at\s+(?=[a-z0-9-]+\s*(?:\.|\[dot\]|\(dot\)|\sdot\s))/gi, '@')
    .replace(/\s*[\[({<]\s*dot\s*[\])}>]\s*/gi, '.')
    .replace(/\s+dot\s+/gi, '.');
}

/** Name tokens worth matching an address against: "Dave Miller" -> dave, miller, dmiller, davem, dave.miller */
function nameKeys(ownerName) {
  const parts = clean(ownerName).toLowerCase().replace(/[^a-z\s'-]/g, '').split(' ').filter((p) => p.length > 1);
  if (!parts.length) return [];
  const [first, ...rest] = parts;
  const last = rest[rest.length - 1];
  const keys = new Set(parts);
  if (last) {
    keys.add(first + last);
    keys.add(first + '.' + last);
    keys.add(first[0] + last);
    keys.add(first + last[0]);
    keys.add(last + first[0]);
  }
  return [...keys];
}

/**
 * What kind of address is this, and how much do we want it?
 *   owner    the owner by name, or literally owner@ / founder@
 *   personal a human first name, just not one we can confirm
 *   role     a named function: sales@, service@, billing@
 *   generic  a catch-all: info@, contact@, hello@
 */
export function classifyEmail(email, { ownerName = null, domain = null } = {}) {
  const address = String(email).toLowerCase().trim();
  const [localRaw, host] = address.split('@');
  const local = localRaw.replace(/[^a-z0-9._+-]/g, '');
  const bare = local.replace(/[._+-]/g, '');
  const onOwnDomain = Boolean(domain && host === domain);

  if (OWNER_LOCALS.has(bare)) {
    return { kind: 'owner', score: 92, why: `${local}@ is the owner's own address` };
  }

  const keys = nameKeys(ownerName);
  if (keys.length) {
    const first = clean(ownerName).toLowerCase().split(' ')[0];
    if (keys.includes(bare) || keys.includes(local)) {
      return { kind: 'owner', score: 97, why: `matches the owner, ${clean(ownerName)}` };
    }
    // dave.miller@ where we only knew "Dave" still points at Dave.
    if (bare.startsWith(first) && first.length >= 3 && !GENERIC_LOCALS.has(bare)) {
      return { kind: 'owner', score: 88, why: `starts with the owner's name, ${first}` };
    }
  }

  if (GENERIC_LOCALS.has(bare)) {
    return { kind: 'generic', score: 15, why: 'shared inbox, not a person' };
  }

  // A short alphabetic local part with no role word in it is a human.
  const looksHuman = /^[a-z]+(?:[._-][a-z]+)?$/.test(local) && bare.length >= 3 && bare.length <= 22;
  if (looksHuman) {
    return {
      kind: 'personal',
      score: onOwnDomain ? 72 : 62,
      why: 'looks like a person, but no owner name to confirm it against',
    };
  }

  return { kind: 'role', score: 35, why: 'a named function rather than a person' };
}

/** Every usable address on a page, best first, each one classified. */
export function findEmails(html, { ownerName = null, domain = null } = {}) {
  const raw = String(html || '');
  const sources = [
    ...(raw.match(/mailto:([^"'?>\s]+)/gi) || []).map((m) => m.replace(/^mailto:/i, '')),
    ...(deobfuscate(stripTags(raw)).match(EMAIL_RE) || []),
    ...(raw.match(EMAIL_RE) || []),
  ];

  const found = new Map();
  for (const item of sources) {
    let address;
    try { address = decodeURIComponent(String(item)); } catch { address = String(item); }
    address = address.trim().toLowerCase().replace(/[.,;:)\]}'"]+$/, '');

    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i.test(address)) continue;
    if (JUNK_DOMAIN.test(address)) continue;
    if (/\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i.test(address)) continue;
    const local = address.split('@')[0];
    if (JUNK_LOCAL.test(local.replace(/[._+-]/g, ''))) continue;
    if (found.has(address)) continue;

    const c = classifyEmail(address, { ownerName, domain });
    let score = c.score;
    if (domain && address.endsWith(`@${domain}`)) score += 6;
    // A free mailbox is a stronger owner signal on a small business, not
    // a weaker one — the owner often never moved off their personal one.
    if (FREE_MAIL.test(address) && c.kind === 'generic') score -= 8;
    found.set(address, { email: address, kind: c.kind, why: c.why, score: Math.max(0, Math.min(99, score)) });
  }

  return [...found.values()].sort((a, b) => b.score - a.score);
}

/**
 * The single best address to write to, and everything else kept
 * separately. Returns null for `owner` rather than handing back info@
 * dressed up as a person.
 */
export function pickOwnerEmail(emails) {
  const personal = emails.filter((e) => e.kind === 'owner' || e.kind === 'personal');
  const generic = emails.filter((e) => e.kind === 'generic' || e.kind === 'role');
  return {
    owner: personal[0] || null,
    others: personal.slice(1),
    generic,
  };
}

/** Pages where a small business puts a named person's address. */
export const CONTACT_PATHS = [
  '/contact', '/contact-us', '/contactus', '/about', '/about-us', '/aboutus',
  '/our-team', '/team', '/meet-the-team', '/staff', '/leadership', '/who-we-are',
];
