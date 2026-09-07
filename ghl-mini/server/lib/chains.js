/**
 * Franchises and chains are wasted dials. Corporate owns the website,
 * the person answering cannot buy anything, and the marketing budget is
 * set three states away. Four signals catch them:
 *
 *   1. A known brand name.
 *   2. The same business name in more than one city.
 *   3. The same root domain across several listings.
 *   4. Franchise language on their own website ("independently owned
 *      and operated" is the legally required disclosure).
 *
 * Signals 2 and 3 are the important ones — they catch regional chains
 * that no hardcoded list would ever know about.
 */

/** National brands a website seller actually runs into, by trade. */
const BRANDS = [
  // Plumbing, HVAC, electrical
  'roto-rooter', 'roto rooter', 'mr. rooter', 'mr rooter', 'benjamin franklin plumbing',
  'ars/rescue rooter', 'rescue rooter', 'one hour heating', 'one hour air', 'aire serv',
  'mister sparky', 'mr. electric', 'mr electric', 'horizon services',
  'blue dot', 'four seasons heating', 'service experts',
  'precision door', 'precision garage door', 'overhead door', 'garage door doctor',
  // Restoration, cleaning
  'servpro', 'servicemaster', 'service master', 'paul davis', 'belfor', 'puroclean', 'rainbow international',
  'chem-dry', 'chem dry', 'stanley steemer', 'zerorez', 'coit', 'oxi fresh',
  'molly maid', 'merry maids', 'the maids', 'maid brigade', 'two maids', 'jan-pro', 'jani-king',
  'anago', 'coverall', 'vanguard cleaning', 'stratus building',
  // Lawn, pest, exterior
  'trugreen', 'tru green', 'lawn doctor', 'weed man', 'scotts lawn', 'lawn love', 'grounds guys',
  'terminix', 'orkin', 'rollins', 'aptive', 'mosquito joe', 'mosquito squad', 'mosquito shield',
  'truly nolen', 'arrow exterminators', 'massey services', 'hawx pest',
  'window genie', 'fish window cleaning', 'shack shine', 'men in kilts',
  // Handyman, remodel, home
  'mr. handyman', 'mr handyman', 'handyman connection', 'ace handyman', 'house doctors',
  'budget blinds', 'kitchen tune-up', 'kitchen tune up', 'reface', 'bath fitter', 're-bath', 'rebath',
  'renewal by andersen', 'champion windows', 'window world', 'pella', 'leaffilter', 'leaf filter',
  'leafguard', 'gutter helmet', 'closet factory', 'california closets', 'tailored living',
  'floor coverings international', 'cleaning authority', 'granite transformations',
  // Roofing, solar
  'erie home', 'erie construction', 'power home remodeling', 'sunrun', 'sunpower', 'trinity solar',
  'tesla energy', 'momentum solar', 'blue raven solar', 'freedom forever',
  // Moving, junk
  '1-800-got-junk', '800-got-junk', 'got junk', 'college hunks', 'junk king', 'junkluggers',
  'two men and a truck', 'all my sons', 'bekins', 'mayflower', 'united van lines', 'pods',
  // Auto
  'jiffy lube', 'valvoline', 'midas', 'meineke', 'aamco', 'firestone', 'goodyear', 'les schwab',
  'discount tire', 'america\'s tire', 'big o tires', 'tires plus', 'ntb', 'mavis',
  'christian brothers automotive', 'take 5', 'grease monkey', 'precision tune', 'monro',
  'caliber collision', 'maaco', 'ziebart', 'safelite',
  // Health, dental, vet
  'aspen dental', 'western dental', 'heartland dental', 'pacific dental', 'smile brands',
  'comfort dental', 'dental care alliance', 'sono bello', 'lasik plus', 'clearchoice',
  'banfield', 'vca animal', 'vca hospital', 'thrive pet', 'petiq',
  // Fitness, retail, food that shows up in local searches
  'anytime fitness', 'planet fitness', 'orangetheory', 'f45', 'crunch fitness', 'gold\'s gym',
  'snap fitness', 'club pilates', 'stretchlab', 'massage envy', 'hand and stone', 'european wax',
  'great clips', 'sport clips', 'supercuts', 'fantastic sams',
  'home depot', 'lowe\'s', 'ace hardware', 'sherwin-williams', 'sherwin williams', 'benjamin moore',
  'menards', 'tractor supply', 'harbor freight', 'napa auto', 'o\'reilly auto', 'autozone',
  'u-haul', 'uhaul', 'penske truck', 'public storage', 'extra space storage', 'cubesmart',
];

const BRAND_RE = new RegExp(
  `\\b(${BRANDS.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i'
);

/** Language a franchise is legally obliged to put on its site. */
const FRANCHISE_COPY = [
  /independently owned and operated/i,
  /each (?:franchise|location|office) is independently/i,
  /franchise opportunit/i,
  /franchises? available/i,
  /own a franchise/i,
  /\bfranchisee\b/i,
];

/**
 * Strip the bits that differ between locations of the same brand so two
 * listings can be compared: "Mr. Rooter of Tampa #42" -> "mr rooter".
 */
export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[&+]/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(of|at|in|the|inc|llc|ltd|co|corp|company|group|services|service|solutions|systems)\b/g, ' ')
    .replace(/\b(north|south|east|west|central|greater|metro|downtown|uptown)\b/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The registrable part of a domain, so www and subdomains do not confuse it. */
export function rootDomain(url) {
  if (!url) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`).hostname.toLowerCase();
    const parts = host.replace(/^www\./, '').split('.');
    if (parts.length <= 2) return parts.join('.');
    // Handle co.uk, com.au and friends.
    const twoPart = /^(co|com|net|org|gov|edu|ac)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
    return parts.slice(twoPart ? -3 : -2).join('.');
  } catch {
    return null;
  }
}

/** Signal 1: a name we already know belongs to a national brand. */
export function matchesKnownBrand(name) {
  const m = String(name || '').match(BRAND_RE);
  return m ? m[1] : null;
}

/** Signal 4: franchise disclosure text on their own site. */
export function hasFranchiseCopy(html) {
  return FRANCHISE_COPY.some((re) => re.test(String(html || '')));
}

/**
 * Words every business in a trade shares. A name made only of these
 * carries no identity: "The Roofing Company" and "Florida Roofing Corp"
 * are different businesses that happen to describe themselves the same
 * way, and must never be treated as branches of one chain.
 */
export const GENERIC_TOKENS = new Set([
  // trades
  'roofing', 'roofer', 'roofers', 'roof', 'plumbing', 'plumber', 'plumbers',
  'hvac', 'air', 'conditioning', 'heating', 'cooling', 'electric', 'electrical',
  'electrician', 'landscaping', 'landscape', 'lawn', 'care', 'pest', 'control',
  'cleaning', 'cleaners', 'fencing', 'fence', 'pool', 'pools', 'spa', 'dental',
  'dentistry', 'dentist', 'orthodontics', 'contracting', 'contractor', 'contractors',
  'construction', 'remodeling', 'restoration', 'repair', 'repairs', 'installation',
  'install', 'maintenance', 'painting', 'painters', 'flooring', 'windows', 'window',
  'doors', 'door', 'garage', 'gutter', 'gutters', 'siding', 'concrete', 'paving',
  'moving', 'movers', 'storage', 'towing', 'auto', 'automotive', 'tire', 'tires',
  'home', 'homes', 'house', 'residential', 'commercial', 'exterior', 'interior',
  'sewer', 'drain', 'water', 'energy', 'solar', 'security', 'roofing', 'mechanical',
  // filler
  'pro', 'pros', 'professional', 'professionals', 'expert', 'experts', 'specialist',
  'specialists', 'quality', 'best', 'top', 'premier', 'affordable', 'discount',
  'family', 'brothers', 'sons', 'and', 'plus', 'first', 'all', 'american', 'usa',
  // US places that show up constantly in business names
  'florida', 'texas', 'california', 'georgia', 'arizona', 'nevada', 'carolina',
  'tampa', 'orlando', 'jacksonville', 'miami', 'austin', 'dallas', 'houston',
  'phoenix', 'scottsdale', 'denver', 'atlanta', 'chicago', 'seattle', 'portland',
  'bay', 'coast', 'gulf', 'valley', 'city', 'county', 'state', 'national', 'local',
]);

/** Does this name carry a word that actually identifies a business? */
function hasDistinctiveToken(normalized) {
  return normalized.split(' ').some((t) => t.length >= 3 && !GENERIC_TOKENS.has(t));
}

/**
 * Hosts that many unrelated businesses sit on: site builders, link
 * shorteners, parked pages. Sharing one of these says nothing about
 * ownership.
 */
const SHARED_HOST_PATTERNS = [
  'wixsite', 'wix\\.com', 'weebly', 'business\\.site', 'godaddysites', 'godaddy',
  'squarespace', 'blogspot', 'wordpress\\.com', 'webflow\\.io', 'netlify\\.app',
  'vercel\\.app', 'github\\.io', 'site123', 'jimdo', 'strikingly', 'carrd',
  'linktr\\.ee', 'ueniweb', 'ueni\\.com', 'company\\.site', 'mybusiness',
  'bit\\.ly', 'parkingcrew', 'sedoparking',
  '\\.top$', '\\.xyz$', '\\.click$', '\\.link$',
];
const SHARED_HOSTS = new RegExp(SHARED_HOST_PATTERNS.join('|'), 'i');

/**
 * Signals 2 and 3, across a set of leads. Returns a Map of lead id to the
 * reason it looks like a chain. Needs `minLocations` matches before it
 * calls anything — two unrelated businesses can share a generic name.
 */
export function findMultiLocation(leads, { minLocations = 2 } = {}) {
  const byName = new Map();
  const byDomain = new Map();

  for (const lead of leads) {
    const key = normalizeName(lead.name);
    // A generic key like "roofing" belongs to half the trade. Only names
    // with something identifying in them can prove a shared brand.
    if (key.length >= 5 && hasDistinctiveToken(key)) {
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(lead);
    }
    const domain = rootDomain(lead.website);
    if (domain && !SHARED_HOSTS.test(domain)) {
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain).push(lead);
    }
  }

  const flagged = new Map();

  for (const [key, group] of byName) {
    const cities = new Set(group.map((l) => (l.city || '').toLowerCase()).filter(Boolean));
    // Same name in several cities is a chain. Same name, one city, is one
    // business that Google listed twice.
    if (group.length >= minLocations && cities.size >= minLocations) {
      for (const lead of group) {
        flagged.set(lead.id, `"${key}" appears in ${cities.size} cities`);
      }
    }
  }

  for (const [domain, group] of byDomain) {
    // Two locations behind one domain is a local business with two vans,
    // and the owner still answers the phone. Three or more is a chain.
    if (group.length < 3) continue;
    for (const lead of group) {
      if (!flagged.has(lead.id)) flagged.set(lead.id, `${group.length} listings share ${domain}`);
    }
  }

  return flagged;
}

/** The one-shot check used at scrape time, before anything is stored. */
export function looksLikeChain(lead) {
  const brand = matchesKnownBrand(lead.name);
  if (brand) return `known brand: ${brand}`;
  // "Something of Tampa" is how franchises name their territories.
  if (/\bof\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)?$/.test(String(lead.name || '').trim())
      && /\b(plumbing|heating|air|electric|roofing|cleaning|pest|lawn|restoration|handyman|painting)\b/i.test(lead.name)) {
    return 'named like a franchise territory';
  }
  return null;
}

export { BRANDS };
