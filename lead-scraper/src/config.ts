/**
 * Tunable knobs and word lists.
 *
 * Everything vertical-specific lives here so the crawler itself stays generic:
 * nothing in src/ outside this file knows what "roofing" or "dental" means.
 */

export const DEFAULTS = {
  limit: 100,
  concurrency: 3,
  headless: true,
  maxPagesPerSite: 6,
  source: 'auto',
  outputDir: 'output',
} as const;

export const HTTP = {
  /** Per-request timeout for plain HTTP fetches. */
  requestTimeoutMs: 15_000,
  /** Playwright navigation timeout. */
  navigationTimeoutMs: 25_000,
  /** Retries after the first attempt. Permanent errors are never retried. */
  maxRetries: 2,
  backoffBaseMs: 800,
  backoffMaxMs: 10_000,
  /** A Retry-After longer than this is treated as "come back another day". */
  maxHonouredRetryAfterMs: 30_000,
  /** Minimum gap between requests to the same host. */
  perHostDelayMs: 1_000,
  /** Cap on how much of a response body we will read. */
  maxBodyBytes: 3_000_000,
  userAgent:
    'b2b-lead-scraper/1.0 (+https://github.com/kewkal/claude; public-data lead research; contact via repository)',
} as const;

/** Discovery-source pacing. Overpass and Nominatim ask for <= 1 request/second. */
export const SOURCE_PACING = {
  overpassDelayMs: 1_100,
  nominatimDelayMs: 1_100,
  googlePlacesDelayMs: 200,
} as const;

/** URL/anchor keywords that make a page worth crawling, highest value first. */
export const PAGE_PRIORITY_KEYWORDS: readonly { keyword: string; score: number }[] = [
  { keyword: 'about-us', score: 100 },
  { keyword: 'about', score: 90 },
  { keyword: 'our-team', score: 95 },
  { keyword: 'team', score: 85 },
  { keyword: 'leadership', score: 95 },
  { keyword: 'meet-the-team', score: 95 },
  { keyword: 'our-story', score: 80 },
  { keyword: 'who-we-are', score: 80 },
  { keyword: 'company', score: 70 },
  { keyword: 'contact-us', score: 90 },
  { keyword: 'contact', score: 85 },
  { keyword: 'services', score: 95 },
  { keyword: 'solutions', score: 80 },
  { keyword: 'what-we-do', score: 90 },
  { keyword: 'our-services', score: 95 },
  { keyword: 'staff', score: 70 },
  { keyword: 'doctors', score: 70 },
  { keyword: 'management', score: 70 },
  { keyword: 'locations', score: 60 },
];

/** Path fragments that make a URL not worth crawling. */
export const PAGE_EXCLUDE_PATTERNS: readonly string[] = [
  '/blog',
  '/news',
  '/article',
  '/category',
  '/tag/',
  '/author/',
  '/archive',
  '/privacy',
  '/terms',
  '/tos',
  '/legal',
  '/disclaimer',
  '/accessibility',
  '/sitemap',
  '/cart',
  '/checkout',
  '/basket',
  '/login',
  '/signin',
  '/sign-in',
  '/register',
  '/signup',
  '/sign-up',
  '/account',
  '/my-account',
  '/wp-admin',
  '/wp-login',
  '/wp-json',
  '/feed',
  '/rss',
  '/calendar',
  '/events/',
  '/booking',
  '/appointments/',
  '/search',
  '/careers',
  '/jobs',
  '/press',
  '/gallery',
  '/portfolio',
  '/reviews',
  '/testimonials',
  '/faq',
  '/downloads',
  '/documents',
];

/** File extensions we never fetch as HTML. */
export const NON_HTML_EXTENSIONS: readonly string[] = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.zip',
  '.rar',
  '.gz',
  '.tar',
  '.csv',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.mp4',
  '.mp3',
  '.webm',
  '.avi',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.dmg',
  '.exe',
];

/** Query params stripped during canonicalisation (tracking noise, not content). */
export const TRACKING_PARAMS: readonly string[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  'referrer',
  'source',
  'igshid',
  '_ga',
  '_gl',
  'yclid',
  'ttclid',
];

/** Local parts that indicate a shared inbox rather than a person. */
export const ROLE_EMAIL_LOCAL_PARTS: readonly string[] = [
  'info',
  'office',
  'contact',
  'hello',
  'hi',
  'admin',
  'sales',
  'support',
  'help',
  'enquiries',
  'inquiries',
  'enquiry',
  'inquiry',
  'service',
  'services',
  'team',
  'mail',
  'email',
  'general',
  'reception',
  'frontdesk',
  'front.desk',
  'booking',
  'bookings',
  'appointments',
  'scheduling',
  'accounts',
  'billing',
  'careers',
  'jobs',
  'hr',
  'marketing',
  'press',
  'media',
  'webmaster',
  'noreply',
  'no-reply',
  'donotreply',
];

/** Addresses that belong to tooling, not the business. */
export const EMAIL_DOMAIN_BLOCKLIST: readonly string[] = [
  'example.com',
  'example.org',
  'example.net',
  'sentry.io',
  'wixpress.com',
  'squarespace.com',
  'godaddy.com',
  'domain.com',
  'yourdomain.com',
  'email.com',
  'sentry-next.wixpress.com',
];

/**
 * Titles that qualify someone as the owner/principal.
 * A name without one of these (or an explicit "founded by" relationship) is not an owner.
 */
export const OWNER_TITLES: readonly { pattern: string; confidence: number }[] = [
  { pattern: 'founder & owner', confidence: 100 },
  { pattern: 'owner & founder', confidence: 100 },
  { pattern: 'president & owner', confidence: 100 },
  { pattern: 'owner & president', confidence: 100 },
  { pattern: 'founder & ceo', confidence: 100 },
  { pattern: 'ceo & founder', confidence: 100 },
  { pattern: 'co-founder & ceo', confidence: 98 },
  { pattern: 'owner and operator', confidence: 96 },
  { pattern: 'founder', confidence: 95 },
  { pattern: 'co-founder', confidence: 92 },
  { pattern: 'cofounder', confidence: 92 },
  { pattern: 'owner', confidence: 95 },
  { pattern: 'co-owner', confidence: 90 },
  { pattern: 'coowner', confidence: 90 },
  { pattern: 'proprietor', confidence: 90 },
  { pattern: 'managing partner', confidence: 82 },
  { pattern: 'managing director', confidence: 80 },
  { pattern: 'president', confidence: 85 },
  { pattern: 'chief executive officer', confidence: 88 },
  { pattern: 'ceo', confidence: 88 },
  { pattern: 'principal', confidence: 78 },
];

/**
 * Titles that explicitly do NOT confer ownership. Guards against
 * "Office Manager: Jane Doe" being read as an owner.
 */
export const NON_OWNER_TITLES: readonly string[] = [
  'office manager',
  'operations manager',
  'project manager',
  'account manager',
  'service manager',
  'sales manager',
  'general manager',
  'marketing manager',
  'technician',
  'lead technician',
  'installer',
  'estimator',
  'foreman',
  'apprentice',
  'receptionist',
  'coordinator',
  'assistant',
  'hygienist',
  'dental assistant',
  'associate dentist',
  'associate',
  'consultant',
  'advisor',
  'specialist',
  'representative',
  'supervisor',
  'dispatcher',
  'bookkeeper',
];

/**
 * Phrases that look like services but say nothing concrete.
 * Matched against the whole normalised candidate, and as substrings for the vaguest ones.
 */
export const GENERIC_SERVICE_PHRASES: readonly string[] = [
  'quality solutions',
  'quality service',
  'quality services',
  'professional services',
  'professional service',
  'professional solutions',
  'our services',
  'our solutions',
  'services',
  'service',
  'solutions',
  'what we do',
  'about',
  'about us',
  'contact',
  'contact us',
  'home',
  'learn more',
  'read more',
  'get a quote',
  'free quote',
  'free estimate',
  'request a quote',
  'request an estimate',
  'book now',
  'book online',
  'schedule now',
  'schedule an appointment',
  'call us',
  'call today',
  'get started',
  'why choose us',
  'why us',
  'testimonials',
  'reviews',
  'gallery',
  'portfolio',
  'blog',
  'news',
  'careers',
  'financing',
  'specials',
  'offers',
  'coupons',
  'privacy policy',
  'terms of service',
  'terms and conditions',
  'sitemap',
  'faq',
  'faqs',
  'menu',
  'locations',
  'areas we serve',
  'service areas',
  'service area',
  'customer satisfaction',
  'trusted experts',
  'expert solutions',
  'excellence',
  'affordable prices',
  'best in class',
  'industry leading',
  'leading provider',
  'peace of mind',
  'satisfaction guaranteed',
  'licensed and insured',
  'family owned',
  'family owned and operated',
  'years of experience',
  'meet the team',
  'our team',
  'our story',
  'team',
  // Section headings that name the category, not a service within it.
  'treatments',
  'treatment',
  'procedures',
  'specialties',
  'specialities',
  'capabilities',
  'offerings',
  'what we offer',
  'our work',
  'our process',
];

/** Substrings that disqualify a service candidate wherever they appear. */
export const GENERIC_SERVICE_SUBSTRINGS: readonly string[] = [
  'serving ',
  'proudly serving',
  'click here',
  'learn more',
  'read more',
  'contact us today',
  'call now',
  'find out more',
  'see more',
  'view all',
  '©',
  'copyright',
  'all rights reserved',
];

/** Container hints that mark a region of the page as being about services. */
export const SERVICE_CONTAINER_HINTS: readonly string[] = [
  'service',
  'services',
  'offering',
  'offerings',
  'what-we-do',
  'whatwedo',
  'treatments',
  'treatment',
  'capabilities',
  'solutions',
  'specialties',
  'specialities',
  'procedures',
];

export const SERVICE_RULES = {
  minWords: 1,
  maxWords: 6,
  minChars: 4,
  maxChars: 64,
  /** Cap on services per lead so one sprawling nav cannot dominate the row. */
  maxServices: 25,
} as const;

/**
 * Revenue-per-employee factors (USD/year), used only when an explicit headcount exists.
 * Deliberately conservative and deliberately configurable: change these rather than
 * teaching the estimator new tricks.
 */
export const REVENUE_PER_EMPLOYEE_USD: Readonly<Record<string, number>> = {
  default: 150_000,
  hvac: 175_000,
  plumbing: 165_000,
  electrical: 170_000,
  roofing: 190_000,
  dental: 200_000,
  medical: 220_000,
  legal: 250_000,
  landscaping: 110_000,
  cleaning: 90_000,
  restaurant: 75_000,
  retail: 200_000,
};

export const REVENUE_RULES = {
  /** Below this headcount, a stated number is more likely parsing noise than signal. */
  minEmployeesForEstimate: 2,
  /**
   * Employee-derived figures are treated as a range, not a point. If the whole
   * range does not land inside one bracket, we take the lower bracket.
   */
  employeeEstimateSpread: 0.4,
  /**
   * A conservative revenue floor per operating location. Only used when a
   * business demonstrably runs several sites and nothing better is available.
   */
  floorPerLocationUsd: 300_000,
  minLocationsForEstimate: 3,
} as const;

/**
 * Keywords mapped onto a revenue-per-employee bucket. First match wins.
 * Matched case-insensitively against the vertical string.
 */
export const VERTICAL_KEYWORD_MAP: readonly { keywords: readonly string[]; key: string }[] = [
  { keywords: ['hvac', 'heating', 'air condition', 'furnace'], key: 'hvac' },
  { keywords: ['dental', 'dentist', 'orthodont', 'endodont', 'periodont'], key: 'dental' },
  { keywords: ['roof'], key: 'roofing' },
  { keywords: ['plumb'], key: 'plumbing' },
  { keywords: ['electric'], key: 'electrical' },
  { keywords: ['landscap', 'lawn', 'garden'], key: 'landscaping' },
  { keywords: ['clean', 'janitor', 'maid'], key: 'cleaning' },
  { keywords: ['law', 'attorney', 'solicitor', 'legal'], key: 'legal' },
  { keywords: ['doctor', 'clinic', 'medical', 'physician', 'med spa', 'medspa'], key: 'medical' },
  { keywords: ['restaurant', 'cafe', 'bakery', 'catering'], key: 'restaurant' },
  { keywords: ['shop', 'store', 'boutique', 'retail'], key: 'retail' },
];

/**
 * OpenStreetMap tag filters per vertical bucket. Overpass needs concrete tags;
 * this table is the only place that mapping lives.
 * Each entry is an Overpass tag filter appended to node/way/relation queries.
 */
export const OSM_TAG_FILTERS: readonly { keywords: readonly string[]; filters: readonly string[] }[] =
  [
    {
      keywords: ['hvac', 'heating', 'air condition', 'furnace', 'ac repair'],
      filters: ['["craft"="hvac"]', '["shop"="hvac"]', '["craft"="heating_engineer"]'],
    },
    {
      keywords: ['dental', 'dentist', 'orthodont', 'endodont', 'periodont'],
      filters: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
    },
    { keywords: ['roof'], filters: ['["craft"="roofer"]'] },
    { keywords: ['plumb'], filters: ['["craft"="plumber"]', '["shop"="plumber"]'] },
    { keywords: ['electric'], filters: ['["craft"="electrician"]'] },
    { keywords: ['landscap', 'lawn', 'garden'], filters: ['["craft"="gardener"]', '["shop"="garden_centre"]'] },
    { keywords: ['law', 'attorney', 'solicitor', 'legal'], filters: ['["office"="lawyer"]'] },
    { keywords: ['veterinar', ' vet '], filters: ['["amenity"="veterinary"]'] },
    { keywords: ['pharmac', 'chemist'], filters: ['["amenity"="pharmacy"]'] },
    { keywords: ['physio', 'chiroprac'], filters: ['["healthcare"="physiotherapist"]'] },
    { keywords: ['doctor', 'clinic', 'physician', 'medical'], filters: ['["amenity"="doctors"]', '["amenity"="clinic"]'] },
    { keywords: ['optician', 'optometr'], filters: ['["shop"="optician"]'] },
    { keywords: ['accountant', 'accounting', 'bookkeep'], filters: ['["office"="accountant"]'] },
    { keywords: ['insurance'], filters: ['["office"="insurance"]'] },
    { keywords: ['estate agent', 'real estate', 'realtor'], filters: ['["office"="estate_agent"]'] },
    { keywords: ['restaurant'], filters: ['["amenity"="restaurant"]'] },
    { keywords: ['cafe', 'coffee'], filters: ['["amenity"="cafe"]'] },
    { keywords: ['bakery'], filters: ['["shop"="bakery"]'] },
    { keywords: ['hair', 'salon', 'barber'], filters: ['["shop"="hairdresser"]'] },
    { keywords: ['gym', 'fitness'], filters: ['["leisure"="fitness_centre"]'] },
    { keywords: ['car repair', 'auto repair', 'mechanic', 'garage'], filters: ['["shop"="car_repair"]'] },
    { keywords: ['builder', 'construction', 'contractor'], filters: ['["craft"="builder"]', '["office"="construction_company"]'] },
    { keywords: ['carpenter', 'joiner'], filters: ['["craft"="carpenter"]'] },
    { keywords: ['painter', 'painting', 'decorator'], filters: ['["craft"="painter"]'] },
    { keywords: ['locksmith'], filters: ['["craft"="locksmith"]'] },
    { keywords: ['pest control'], filters: ['["craft"="pest_control"]'] },
  ];

export const ENDPOINTS = {
  overpass: 'https://overpass-api.de/api/interpreter',
  nominatim: 'https://nominatim.openstreetmap.org/search',
  googlePlacesSearchText: 'https://places.googleapis.com/v1/places:searchText',
} as const;

/** Markers that a response is an access-control interstitial rather than content. */
export const ACCESS_CONTROL_MARKERS: readonly string[] = [
  'captcha',
  'are you a robot',
  'are you human',
  'unusual traffic',
  'verify you are human',
  'checking your browser',
  'cf-browser-verification',
  'ddos protection by',
  'access denied',
  '请输入验证码',
];
