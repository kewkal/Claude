/**
 * Streaming CSV output.
 *
 * Records are written as each lead finishes, so a run that dies at lead 300 of
 * 400 still leaves 299 usable rows on disk. Nothing accumulates in memory.
 */

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { stringify, type Stringifier } from 'csv-stringify';

import { CSV_COLUMNS, type CsvRow, type EnrichedLead } from '../types/lead.js';
import { slugify, timestampSlug } from './normalise.js';

/** `null`/`undefined` become empty CSV fields; everything else is stringified. */
function cell(value: string | null | undefined): string {
  return value === null || value === undefined ? '' : value;
}

/** Map the rich internal record onto the flat, exact output contract. */
export function toCsvRow(lead: EnrichedLead): CsvRow {
  return {
    business_name: cell(lead.businessName),
    website: cell(lead.website),
    phone: cell(lead.phone),
    services_provided: lead.servicesProvided.length > 0 ? JSON.stringify(lead.servicesProvided) : '',
    reviews: lead.reviews ? JSON.stringify(lead.reviews) : '',
    instagram_url: cell(lead.instagramUrl),
    facebook_url: cell(lead.facebookUrl),
    linkedin_url: cell(lead.linkedinUrl),
    owner_name: cell(lead.ownerName),
    owner_email: cell(lead.ownerEmail),
    estimated_revenue: cell(lead.estimatedRevenue),
  };
}

export function buildOutputPath(
  outputDir: string,
  vertical: string,
  location: string,
  now: Date = new Date(),
): string {
  return join(outputDir, `leads-${slugify(vertical)}-${slugify(location)}-${timestampSlug(now)}.csv`);
}

export class CsvLeadWriter {
  private readonly stringifier: Stringifier;
  private readonly fileStream: WriteStream;
  private finished: Promise<void> | null = null;
  private count = 0;

  constructor(readonly path: string) {
    this.stringifier = stringify({
      header: true,
      columns: [...CSV_COLUMNS],
      quoted_string: true,
      bom: false,
      record_delimiter: '\n',
    });
    this.fileStream = createWriteStream(path, { encoding: 'utf8' });
    this.stringifier.pipe(this.fileStream);
  }

  static create(
    outputDir: string,
    vertical: string,
    location: string,
    now: Date = new Date(),
  ): CsvLeadWriter {
    mkdirSync(outputDir, { recursive: true });
    return new CsvLeadWriter(buildOutputPath(outputDir, vertical, location, now));
  }

  get recordsWritten(): number {
    return this.count;
  }

  /** Write one record, respecting backpressure. */
  async write(lead: EnrichedLead): Promise<void> {
    const row = toCsvRow(lead);
    const ok = this.stringifier.write(row);
    this.count += 1;
    if (!ok) {
      await new Promise<void>((resolve) => this.stringifier.once('drain', resolve));
    }
  }

  /** Flush and close. Safe to call more than once. */
  close(): Promise<void> {
    this.finished ??= new Promise<void>((resolve, reject) => {
      this.fileStream.once('error', reject);
      this.fileStream.once('finish', resolve);
      this.stringifier.once('error', reject);
      this.stringifier.end();
    });
    return this.finished;
  }
}

/** In-memory serialisation, used by tests to assert escaping behaviour. */
export function serialiseRows(rows: readonly CsvRow[]): Promise<string> {
  return new Promise((resolve, reject) => {
    stringify(
      [...rows],
      { header: true, columns: [...CSV_COLUMNS], quoted_string: true, record_delimiter: '\n' },
      (error, output) => {
        if (error) reject(error);
        else resolve(output);
      },
    );
  });
}
