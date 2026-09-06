/**
 * Cross-run lead memory.
 *
 * The in-run deduper forgets everything when the process exits, so without this
 * a second run of the same vertical and location re-scrapes — and re-surfaces —
 * every business you already have. The ledger records the dedupe keys of every
 * lead actually written to a CSV, so later runs can skip them.
 *
 * Storage is append-only JSONL. A rewritten JSON blob would risk losing the
 * whole history to a crash mid-write, and appending costs O(1) per lead in a
 * pipeline that already streams its output.
 *
 * The keys stored here come from `dedupeKeys()` in scraper.ts — there is
 * deliberately no second dedupe implementation for the two to drift apart.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { PreliminaryLead } from '../types/lead.js';
import { log } from './logger.js';

/** One line of the ledger file. */
interface LedgerEntry {
  /** The lead's dedupe keys. A hit on any one of them means "seen before". */
  keys: string[];
  /** Human-readable fields, for inspecting the file. Never read back. */
  name: string;
  firstSeen: string;
  vertical: string;
  location: string;
}

export interface LedgerContext {
  vertical: string;
  location: string;
}

export class LeadLedger {
  private readonly seen = new Set<string>();
  private entries = 0;

  private constructor(readonly path: string) {}

  /**
   * Load the ledger at `path`, or start an empty one when the file does not
   * exist yet. Malformed lines are skipped rather than throwing: a truncated
   * final line from an interrupted run must not make the whole history unusable.
   */
  static open(path: string): LeadLedger {
    const ledger = new LeadLedger(path);

    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        log.warn(`could not read lead ledger at ${path}: ${String(error)}`);
      }
      return ledger;
    }

    let skipped = 0;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const entry = JSON.parse(trimmed) as Partial<LedgerEntry>;
        if (!Array.isArray(entry.keys)) {
          skipped += 1;
          continue;
        }
        for (const key of entry.keys) {
          if (typeof key === 'string' && key !== '') ledger.seen.add(key);
        }
        ledger.entries += 1;
      } catch {
        skipped += 1;
      }
    }

    if (skipped > 0) log.debug(`lead ledger: skipped ${skipped} unreadable line(s)`);
    return ledger;
  }

  /** Leads recorded across all previous runs. */
  get size(): number {
    return this.entries;
  }

  /** Distinct keys held, for debug logging. */
  get keyCount(): number {
    return this.seen.size;
  }

  /**
   * True when any of these keys has been seen before. Matching on *any* key is
   * deliberate: a shared domain alone is enough to call it the same business,
   * exactly as within-run dedupe treats it.
   */
  has(keys: readonly string[]): boolean {
    return keys.some((key) => this.seen.has(key));
  }

  /**
   * Record a lead. Called only once its CSV row has been written, so a run that
   * dies partway through leaves its unwritten leads eligible next time.
   */
  record(lead: PreliminaryLead, keys: readonly string[], context: LedgerContext): void {
    if (keys.length === 0) return;

    const entry: LedgerEntry = {
      keys: [...keys],
      name: lead.businessName,
      firstSeen: new Date().toISOString(),
      vertical: context.vertical,
      location: context.location,
    };

    try {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (error) {
      // A ledger we cannot write is a degraded run, not a failed one: the CSV
      // row is already safely on disk.
      log.warn(`could not append to lead ledger at ${this.path}: ${String(error)}`);
      return;
    }

    for (const key of keys) this.seen.add(key);
    this.entries += 1;
  }
}
