/**
 * Orchestration: discovery -> bounded concurrent enrichment -> dedupe -> CSV.
 *
 * The three stages stay strictly separate. Discovery does not know about
 * websites, enrichment does not know about CSV, and persistence does not know
 * about either. A failure anywhere in one lead is contained to that lead.
 */

import { HTTP } from './config.js';
import { enrichLead } from './enrichment/websiteEnricher.js';
import type { EnrichedLead, PreliminaryLead, RunOptions, RunStats } from './types/lead.js';
import { BrowserPool } from './utils/browser.js';
import { createPool, HostPacer } from './utils/concurrency.js';
import { CsvLeadWriter } from './utils/csvWriter.js';
import { LeadLedger } from './utils/leadLedger.js';
import { describeError, isDebug, log } from './utils/logger.js';
import {
  normaliseBusinessName,
  phoneDedupeKey,
  regionFromLocation,
  registrableDomain,
} from './utils/normalise.js';
import type { SourceRegistry } from './sources/sourceAdapter.js';

export interface RunResult extends RunStats {
  outputPath: string;
  elapsedMs: number;
}

/**
 * Deduplication keys in priority order:
 *   1. registrable domain — two records on the same site are the same business
 *   2. normalised phone — a shared main line means a shared business
 *   3. normalised name + locality — the fallback when neither exists
 *
 * Separate branches of a chain keep separate rows unless they collapse onto one
 * of the above, which is the intended behaviour: distinct establishments are
 * distinct leads.
 */
export function dedupeKeys(lead: PreliminaryLead): string[] {
  const keys: string[] = [];

  const domain = registrableDomain(lead.website);
  if (domain) keys.push(`domain:${domain}`);

  const phone = phoneDedupeKey(lead.phone);
  if (phone) keys.push(`phone:${phone}`);

  const name = normaliseBusinessName(lead.businessName);
  if (name !== '') {
    const locality = lead.address ? normaliseBusinessName(lead.address) : '';
    keys.push(`name:${name}|${locality}`);
  }

  return keys;
}

export type DedupeVerdict =
  /** New lead; its keys are now claimed for this run. */
  | { accepted: true; keys: string[] }
  /** Collides with something already accepted in this run. */
  | { accepted: false; reason: 'duplicate'; keys: string[] }
  /** Already produced by an earlier run, per the ledger. */
  | { accepted: false; reason: 'previously-seen'; keys: string[] };

/**
 * In-run de-duplication, optionally backed by the cross-run ledger.
 *
 * The two reasons for rejection are reported separately because they mean very
 * different things operationally: a thin run full of `duplicate` means the
 * source returned redundant records, while one full of `previously-seen` means
 * you already have these leads and the run is working as intended.
 */
export class Deduper {
  private readonly seen = new Set<string>();

  constructor(private readonly ledger: LeadLedger | null = null) {}

  accept(lead: PreliminaryLead): DedupeVerdict {
    const keys = dedupeKeys(lead);
    // Nothing to key on (no domain, no phone, no name) — let it through rather
    // than silently dropping a lead we simply cannot identify.
    if (keys.length === 0) return { accepted: true, keys };

    if (keys.some((key) => this.seen.has(key))) {
      return { accepted: false, reason: 'duplicate', keys };
    }
    if (this.ledger?.has(keys)) {
      return { accepted: false, reason: 'previously-seen', keys };
    }

    for (const key of keys) this.seen.add(key);
    return { accepted: true, keys };
  }
}

function summariseLead(lead: EnrichedLead): string {
  if (lead.status === 'failed') {
    return `failed — ${lead.errors[0] ?? 'unknown error'}`;
  }
  const parts = [
    `${lead.servicesProvided.length} service${lead.servicesProvided.length === 1 ? '' : 's'}`,
    lead.ownerName ? 'owner found' : 'no owner',
    lead.ownerEmail ? (lead.ownerEmailIsGeneric ? 'general email' : 'owner email') : 'no email',
  ];
  if (lead.estimatedRevenue) parts.push(`revenue ${lead.estimatedRevenue}`);
  if (lead.status === 'partial' && lead.errors.length > 0) parts.push(`partial (${lead.errors[0] ?? ''})`);
  return parts.join(', ');
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

/**
 * Run one full scrape.
 *
 * `signal` is wired to SIGINT/SIGTERM by the CLI: aborting stops new work,
 * lets in-flight leads finish, and still flushes and closes the CSV.
 */
export async function runScrape(
  options: RunOptions,
  registry: SourceRegistry,
  signal: AbortSignal,
): Promise<RunResult> {
  const startedAt = Date.now();
  const source = registry.resolve(options.source);
  const region = regionFromLocation(options.location);

  log.stage('SOURCE', `${source.name} — ${source.description}`);
  if (region) log.debug(`phone region resolved to ${region}`);

  const stats: RunStats = {
    discovered: 0,
    processed: 0,
    enriched: 0,
    partial: 0,
    failed: 0,
    duplicatesRemoved: 0,
    previouslySeen: 0,
    written: 0,
  };

  // Cross-run memory. Opened before discovery so previously-seen businesses are
  // filtered out before any crawl budget is spent on them.
  const ledger = options.useLedger ? LeadLedger.open(options.ledgerPath) : null;
  if (ledger) {
    log.stage('LEDGER', `${ledger.size} lead(s) remembered from previous runs (${ledger.path})`);
  } else {
    log.stage('LEDGER', 'disabled (--include-seen); previously-seen leads will be scraped again');
  }

  // Discovery is fully drained before enrichment starts so the progress counter
  // has a real denominator, and so we can dedupe before spending any crawl budget.
  const deduper = new Deduper(ledger);
  const queue: { lead: PreliminaryLead; keys: string[] }[] = [];

  try {
    for await (const lead of source.discover({
      vertical: options.vertical,
      location: options.location,
      limit: options.limit,
      region,
      signal,
    })) {
      stats.discovered += 1;
      const verdict = deduper.accept(lead);
      if (verdict.accepted) queue.push({ lead, keys: verdict.keys });
      else if (verdict.reason === 'previously-seen') stats.previouslySeen += 1;
      else stats.duplicatesRemoved += 1;
      if (signal.aborted) break;
    }
  } catch (error) {
    log.error(`discovery failed: ${describeError(error)}`);
    if (queue.length === 0) throw error;
  }

  log.stage(
    'DISCOVERY',
    `Found ${stats.discovered} candidate businesses (${queue.length} to process, ` +
      `${stats.duplicatesRemoved} duplicate, ${stats.previouslySeen} previously seen)`,
  );

  const writer = CsvLeadWriter.create(options.outputDir, options.vertical, options.location);
  const browser = new BrowserPool(options.headless);
  const pacer = new HostPacer(HTTP.perHostDelayMs);
  const pool = createPool(options.concurrency);

  // The CSV stream is single-writer; serialise appends behind one promise chain.
  let writeChain: Promise<void> = Promise.resolve();
  const total = queue.length;

  try {
    const tasks = queue.map(({ lead: preliminary, keys }, index) =>
      pool.run(async () => {
        const position = index + 1;
        if (signal.aborted) return;

        log.lead(position, total, preliminary.businessName, 'enriching');
        let lead: EnrichedLead;
        try {
          lead = await enrichLead(preliminary, {
            maxPages: options.maxPagesPerSite,
            pacer,
            browser,
            region,
            vertical: options.vertical,
            signal,
          });
        } catch (error) {
          // enrichLead already contains its own failures; this is the last net.
          lead = {
            businessName: preliminary.businessName,
            website: preliminary.website,
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
            errors: [describeError(error)],
          };
        }

        stats.processed += 1;
        if (lead.status === 'enriched') stats.enriched += 1;
        else if (lead.status === 'partial') stats.partial += 1;
        else stats.failed += 1;

        log.lead(position, total, lead.businessName, summariseLead(lead));
        if (isDebug()) {
          log.debug(`${lead.businessName}: crawled ${lead.pagesCrawled.length} pages`);
          for (const evidence of lead.revenueEvidence) log.debug(`  revenue evidence: ${evidence}`);
          for (const error of lead.errors) log.debug(`  issue: ${error}`);
        }

        // Every processed lead is written, including partials — a partial
        // accurate record is more useful than a dropped one.
        // Record only after the row is safely written, so a run that dies
        // partway through leaves its unwritten leads eligible next time.
        writeChain = writeChain.then(async () => {
          await writer.write(lead);
          ledger?.record(preliminary, keys, {
            vertical: options.vertical,
            location: options.location,
          });
        });
        await writeChain;
        stats.written += 1;
      }),
    );

    await Promise.allSettled(tasks);
    await writeChain;
  } finally {
    await writer.close();
    await browser.close();
  }

  return { ...stats, outputPath: writer.path, elapsedMs: Date.now() - startedAt };
}

export function printSummary(result: RunResult): void {
  log.info('');
  log.stage('SUMMARY', 'run complete');
  log.info(`  total discovered:       ${result.discovered}`);
  log.info(`  total processed:        ${result.processed}`);
  log.info(`  successfully enriched:  ${result.enriched}`);
  log.info(`  partial:                ${result.partial}`);
  log.info(`  failed:                 ${result.failed}`);
  log.info(`  duplicates removed:     ${result.duplicatesRemoved}`);
  log.info(`  previously seen:        ${result.previouslySeen}`);
  log.info(`  records written:        ${result.written}`);
  log.info(`  output file:            ${result.outputPath}`);
  log.info(`  elapsed:                ${formatDuration(result.elapsedMs)}`);
}
