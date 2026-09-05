/**
 * Turns a PreliminaryLead into an EnrichedLead by crawling the business website
 * and merging what the parser found.
 *
 * The merge rules are where the "prefer null over questionable data" principle
 * actually bites: an owner needs a title, an owner email is either the owner's
 * own published address or an explicitly-general company inbox, and revenue
 * comes from the estimator or not at all.
 */

import type {
  DiscoveredEmail,
  EnrichedLead,
  LeadStatus,
  OwnerCandidate,
  PreliminaryLead,
  RevenueSignals,
  SocialLinks,
  WebsiteFindings,
} from '../types/lead.js';
import type { BrowserPool } from '../utils/browser.js';
import type { HostPacer } from '../utils/concurrency.js';
import { describeError } from '../utils/logger.js';
import { canonicaliseUrl, classifyEmail, uniqueCaseInsensitive } from '../utils/normalise.js';
import {
  extractEmails,
  extractOwner,
  extractPhones,
  extractRevenueSignals,
  extractServices,
  extractSocials,
} from '../parsers/htmlParser.js';
import { crawlSite } from './siteCrawler.js';
import { estimateRevenue } from './revenueEstimator.js';

export interface EnrichOptions {
  maxPages: number;
  pacer: HostPacer;
  browser: BrowserPool;
  region: string | null;
  vertical: string;
  signal?: AbortSignal;
}

/** Merge the per-page revenue signals, keeping the largest explicit figure of each kind. */
function mergeRevenueSignals(target: RevenueSignals, incoming: RevenueSignals): RevenueSignals {
  return {
    publishedRevenueUsd: target.publishedRevenueUsd ?? incoming.publishedRevenueUsd ?? null,
    employeeCount: Math.max(target.employeeCount ?? 0, incoming.employeeCount ?? 0) || null,
    locationCount: Math.max(target.locationCount ?? 0, incoming.locationCount ?? 0) || null,
    vertical: target.vertical ?? incoming.vertical ?? null,
  };
}

/** Crawl the site and collect everything the parser can find, page by page. */
export async function gatherWebsiteFindings(
  website: string,
  businessName: string,
  options: EnrichOptions,
): Promise<WebsiteFindings> {
  const findings: WebsiteFindings = {
    canonicalWebsite: null,
    services: [],
    emails: [],
    socials: {},
    owner: null,
    phone: null,
    revenueSignals: { publishedRevenueUsd: null, employeeCount: null, locationCount: null, vertical: options.vertical },
    pagesCrawled: [],
    errors: [],
  };

  const crawl = await crawlSite(website, {
    maxPages: options.maxPages,
    pacer: options.pacer,
    browser: options.browser,
    signal: options.signal,
  });

  findings.canonicalWebsite = crawl.canonicalWebsite;
  findings.errors.push(...crawl.errors);
  findings.pagesCrawled = crawl.pages.map((page) => page.url);

  const services: string[] = [];
  const emails = new Map<string, DiscoveredEmail>();
  const socials: SocialLinks = {};
  const owners: OwnerCandidate[] = [];
  const phones: string[] = [];

  for (const page of crawl.pages) {
    try {
      services.push(
        ...extractServices(page.doc, { isServicePage: page.isServicePage, businessName }),
      );

      for (const email of extractEmails(page.doc, page.url)) {
        if (!emails.has(email.address)) emails.set(email.address, email);
      }

      const pageSocials = extractSocials(page.doc);
      for (const [platform, url] of Object.entries(pageSocials) as [keyof SocialLinks, string][]) {
        socials[platform] ??= url;
      }

      // About/team/leadership pages are where ownership is actually stated.
      const owner = extractOwner(page.doc, page.url, businessName, page.isPeoplePage ? 10 : 0);
      if (owner) owners.push(owner);

      phones.push(...extractPhones(page.doc, options.region));

      findings.revenueSignals = mergeRevenueSignals(
        findings.revenueSignals,
        extractRevenueSignals(page.doc),
      );
    } catch (error) {
      findings.errors.push(`parse failed for ${page.url}: ${describeError(error)}`);
    }
  }

  findings.services = uniqueCaseInsensitive(services);
  findings.emails = [...emails.values()];
  findings.socials = socials;
  findings.owner = owners.sort((a, b) => b.confidence - a.confidence)[0] ?? null;
  findings.phone = phones[0] ?? null;

  return findings;
}

/**
 * Choose the owner email.
 *
 * Preference order:
 *   1. a published address that demonstrably belongs to the identified owner
 *   2. a published general company inbox, flagged internally as generic
 *   3. null
 * An address is never constructed from a name and a domain.
 */
export function selectOwnerEmail(
  emails: readonly DiscoveredEmail[],
  ownerName: string | null,
): { address: string | null; isGeneric: boolean } {
  if (emails.length === 0) return { address: null, isGeneric: false };

  const classified = emails.map((email) => ({
    ...email,
    kind: classifyEmail(email.address, ownerName),
  }));

  const personal = classified.find((email) => email.kind === 'personal');
  if (personal) return { address: personal.address, isGeneric: false };

  const general = classified.find((email) => email.isGeneric);
  if (general) return { address: general.address, isGeneric: true };

  // A non-role address we cannot tie to the owner: usable as a company contact,
  // but flagged as generic so nothing downstream treats it as the owner's own.
  const fallback = classified[0];
  return fallback ? { address: fallback.address, isGeneric: true } : { address: null, isGeneric: false };
}

/** Was this enrichment good enough to call "enriched" rather than "partial"? */
function classifyStatus(lead: EnrichedLead, crawledAnything: boolean): LeadStatus {
  if (!crawledAnything) return 'failed';
  const signals = [
    lead.servicesProvided.length > 0,
    lead.ownerName !== null,
    lead.ownerEmail !== null,
    lead.instagramUrl !== null || lead.facebookUrl !== null || lead.linkedinUrl !== null,
  ].filter(Boolean).length;
  return signals >= 2 ? 'enriched' : 'partial';
}

/**
 * Full enrichment for one lead. Never throws for site-level problems: a business
 * whose website is down still produces a usable record from discovery data.
 */
export async function enrichLead(
  preliminary: PreliminaryLead,
  options: EnrichOptions,
): Promise<EnrichedLead> {
  const lead: EnrichedLead = {
    businessName: preliminary.businessName,
    website: preliminary.website ? canonicaliseUrl(preliminary.website) : null,
    phone: preliminary.phone,
    servicesProvided: [],
    reviews: preliminary.reviews,
    instagramUrl: null,
    facebookUrl: null,
    linkedinUrl: null,
    ownerName: null,
    ownerEmail: null,
    ownerEmailIsGeneric: false,
    estimatedRevenue: null,
    revenueEvidence: [],
    status: 'failed',
    sourceUrl: preliminary.sourceUrl,
    pagesCrawled: [],
    errors: [],
  };

  if (!preliminary.website) {
    lead.status = 'partial';
    lead.errors.push('no website published by the discovery source');
    return lead;
  }

  let findings: WebsiteFindings;
  try {
    findings = await gatherWebsiteFindings(preliminary.website, preliminary.businessName, options);
  } catch (error) {
    lead.status = 'failed';
    lead.errors.push(describeError(error));
    return lead;
  }

  lead.website = findings.canonicalWebsite ?? lead.website;
  lead.servicesProvided = findings.services;
  lead.instagramUrl = findings.socials.instagram ?? null;
  lead.facebookUrl = findings.socials.facebook ?? null;
  lead.linkedinUrl = findings.socials.linkedin ?? null;
  lead.ownerName = findings.owner?.name ?? null;
  lead.phone = lead.phone ?? findings.phone;
  lead.pagesCrawled = findings.pagesCrawled;
  lead.errors.push(...findings.errors);

  const ownerEmail = selectOwnerEmail(findings.emails, lead.ownerName);
  lead.ownerEmail = ownerEmail.address;
  lead.ownerEmailIsGeneric = ownerEmail.isGeneric;

  const estimate = estimateRevenue({ ...findings.revenueSignals, vertical: options.vertical });
  lead.estimatedRevenue = estimate?.bracket ?? null;
  lead.revenueEvidence = estimate?.evidence ?? [];

  lead.status = classifyStatus(lead, findings.pagesCrawled.length > 0);
  return lead;
}
