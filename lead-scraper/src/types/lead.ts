/**
 * Domain types for the lead pipeline.
 *
 * Three stages, deliberately separate:
 *   PreliminaryLead  -> what a discovery source can tell us
 *   EnrichedLead     -> preliminary + everything learned from the business website
 *   CsvRow           -> the exact, flat output contract
 */

/** Ratings only ever come from a discovery source, never from the business's own site. */
export interface Reviews {
  rating: number;
  count: number;
}

/** Output of a SourceAdapter. Everything except name and sourceUrl may be unknown. */
export interface PreliminaryLead {
  businessName: string;
  website: string | null;
  phone: string | null;
  reviews: Reviews | null;
  /** Free-text address from the source, used as a dedupe tiebreaker. */
  address: string | null;
  /** Where this record came from, for provenance/debugging. */
  sourceUrl: string;
  sourceName: string;
}

/** How an email was found, which decides whether it may be used as an owner email. */
export type EmailKind = 'role' | 'personal' | 'unknown';

export interface DiscoveredEmail {
  address: string;
  kind: EmailKind;
  /** Page the address was found on. */
  foundOn: string;
  /** True when the local part looks like a shared inbox (info@, office@, ...). */
  isGeneric: boolean;
}

export interface OwnerCandidate {
  name: string;
  title: string;
  /** Higher is better. Used to pick between competing candidates. */
  confidence: number;
  foundOn: string;
  /** Short human-readable justification, retained for debug logging. */
  evidence: string;
}

export type SocialPlatform = 'instagram' | 'facebook' | 'linkedin';

export type SocialLinks = Partial<Record<SocialPlatform, string>>;

export const REVENUE_BRACKETS = [
  '<$500k',
  '$500k-$1m',
  '$1m-$5m',
  '$5m-$10m',
  '$10m-$25m',
  '$25m+',
] as const;

export type RevenueBracket = (typeof REVENUE_BRACKETS)[number];

/**
 * Deterministic signals the estimator is allowed to consider.
 * Anything subjective (site quality, review counts, ad copy) is deliberately absent.
 */
export interface RevenueSignals {
  /** Annual revenue in USD explicitly published by the business. */
  publishedRevenueUsd?: number | null;
  /** Employee/team headcount explicitly stated or present in structured data. */
  employeeCount?: number | null;
  /** Count of distinct operating locations evidenced by structured data. */
  locationCount?: number | null;
  /** Vertical slug, used to select a revenue-per-employee factor from config. */
  vertical?: string | null;
}

export interface RevenueEstimate {
  bracket: RevenueBracket;
  /** Retained for logging/debugging; never written to the CSV. */
  evidence: string[];
}

/** What the website crawl produced for one business. */
export interface WebsiteFindings {
  canonicalWebsite: string | null;
  services: string[];
  emails: DiscoveredEmail[];
  socials: SocialLinks;
  owner: OwnerCandidate | null;
  phone: string | null;
  revenueSignals: RevenueSignals;
  pagesCrawled: string[];
  /** Non-fatal problems worth surfacing in logs. */
  errors: string[];
}

export type LeadStatus = 'enriched' | 'partial' | 'failed';

export interface EnrichedLead {
  businessName: string;
  website: string | null;
  phone: string | null;
  servicesProvided: string[];
  reviews: Reviews | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  linkedinUrl: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerEmailIsGeneric: boolean;
  estimatedRevenue: RevenueBracket | null;
  revenueEvidence: string[];
  status: LeadStatus;
  sourceUrl: string;
  pagesCrawled: string[];
  errors: string[];
}

/** The CSV contract. Column order here is the column order on disk. */
export interface CsvRow {
  business_name: string;
  website: string;
  phone: string;
  services_provided: string;
  reviews: string;
  instagram_url: string;
  facebook_url: string;
  linkedin_url: string;
  owner_name: string;
  owner_email: string;
  estimated_revenue: string;
}

export const CSV_COLUMNS: readonly (keyof CsvRow)[] = [
  'business_name',
  'website',
  'phone',
  'services_provided',
  'reviews',
  'instagram_url',
  'facebook_url',
  'linkedin_url',
  'owner_name',
  'owner_email',
  'estimated_revenue',
] as const;

export interface RunStats {
  discovered: number;
  processed: number;
  enriched: number;
  partial: number;
  failed: number;
  /** Collisions within this run. */
  duplicatesRemoved: number;
  /** Skipped because a previous run already produced them. */
  previouslySeen: number;
  written: number;
}

export interface RunOptions {
  vertical: string;
  location: string;
  limit: number;
  concurrency: number;
  headless: boolean;
  maxPagesPerSite: number;
  source: string;
  debug: boolean;
  /** Set by the smoke test to point the fixture adapter at a local server. */
  fixtureBaseUrl?: string;
  outputDir: string;
  /** When false (`--include-seen`), leads from previous runs are scraped again. */
  useLedger: boolean;
  /** Where the cross-run lead memory lives. */
  ledgerPath: string;
}
