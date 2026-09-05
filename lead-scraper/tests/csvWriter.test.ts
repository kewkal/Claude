import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CSV_COLUMNS, type EnrichedLead } from '../src/types/lead.js';
import { buildOutputPath, CsvLeadWriter, serialiseRows, toCsvRow } from '../src/utils/csvWriter.js';

function lead(overrides: Partial<EnrichedLead> = {}): EnrichedLead {
  return {
    businessName: 'Smith Roofing',
    website: 'https://smithroofing.com/',
    phone: '+15125550142',
    servicesProvided: ['Roof Replacement', 'Emergency Roof Repair'],
    reviews: { rating: 4.8, count: 127 },
    instagramUrl: 'https://www.instagram.com/smithroofing',
    facebookUrl: null,
    linkedinUrl: null,
    ownerName: 'James Smith',
    ownerEmail: 'office@smithroofing.com',
    ownerEmailIsGeneric: true,
    estimatedRevenue: '$1m-$5m',
    revenueEvidence: ['12 employees'],
    status: 'enriched',
    sourceUrl: 'https://example.test/1',
    pagesCrawled: [],
    errors: [],
    ...overrides,
  };
}

describe('toCsvRow', () => {
  it('serialises services and reviews as JSON', () => {
    const row = toCsvRow(lead());
    expect(row.services_provided).toBe('["Roof Replacement","Emergency Roof Repair"]');
    expect(row.reviews).toBe('{"rating":4.8,"count":127}');
  });

  it('renders every null as an empty field', () => {
    const row = toCsvRow(
      lead({
        website: null,
        phone: null,
        servicesProvided: [],
        reviews: null,
        instagramUrl: null,
        facebookUrl: null,
        linkedinUrl: null,
        ownerName: null,
        ownerEmail: null,
        estimatedRevenue: null,
      }),
    );
    expect(row.website).toBe('');
    expect(row.phone).toBe('');
    expect(row.services_provided).toBe('');
    expect(row.reviews).toBe('');
    expect(row.owner_name).toBe('');
    expect(row.estimated_revenue).toBe('');
  });
});

describe('CSV serialisation', () => {
  it('writes the exact columns in the specified order', async () => {
    const csv = await serialiseRows([toCsvRow(lead())]);
    const header = csv.split('\n')[0] ?? '';
    expect(header).toBe(CSV_COLUMNS.map((column) => `"${column}"`).join(','));
  });

  it('escapes commas and quotes inside fields', async () => {
    const csv = await serialiseRows([
      toCsvRow(lead({ businessName: 'Smith, Jones & Co "The Roofers"', servicesProvided: ['Repair, Large'] })),
    ]);
    expect(csv).toContain('"Smith, Jones & Co ""The Roofers"""');
    // The comma inside the service must not create an extra column.
    expect(csv.trimEnd().split('\n')).toHaveLength(2);
  });

  it('quotes a field containing a real newline rather than breaking the row', async () => {
    const csv = await serialiseRows([toCsvRow(lead({ businessName: 'Smith Roofing\nAustin Branch' }))]);
    // The newline survives inside the quoted field, so a naive line split sees three parts...
    expect(csv.trimEnd().split('\n')).toHaveLength(3);
    // ...but it is quoted, which is what makes the file valid CSV.
    expect(csv).toContain('"Smith Roofing\nAustin Branch"');
  });

  it('escapes newlines inside the JSON-encoded services cell', async () => {
    const csv = await serialiseRows([toCsvRow(lead({ servicesProvided: ['Line\nBreak'] }))]);
    // JSON encoding turns the newline into the two characters \ and n, and CSV
    // then doubles the JSON's own quotes.
    expect(csv).toContain(String.raw`"[""Line\nBreak""]"`);
    expect(csv.trimEnd().split('\n')).toHaveLength(2);
  });

  it('round-trips unicode', async () => {
    const csv = await serialiseRows([toCsvRow(lead({ businessName: 'Café Ñandú 屋根' }))]);
    expect(csv).toContain('Café Ñandú 屋根');
  });
});

describe('buildOutputPath', () => {
  it('builds a timestamped, slugged filename', () => {
    const path = buildOutputPath('output', 'HVAC Contractors', 'Houston, TX', new Date(2026, 8, 4, 13, 5, 2));
    expect(path).toBe('output/leads-hvac-contractors-houston-tx-20260904-130502.csv');
  });
});

describe('CsvLeadWriter', () => {
  it('creates the directory, writes a header once and streams records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lead-csv-'));
    try {
      const writer = CsvLeadWriter.create(join(dir, 'nested'), 'HVAC', 'Houston, TX');
      await writer.write(lead());
      await writer.write(lead({ businessName: 'Second Business', reviews: null }));
      await writer.close();

      const content = readFileSync(writer.path, 'utf8');
      const lines = content.trimEnd().split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('business_name');
      expect(content.match(/business_name/g)).toHaveLength(1);
      expect(writer.recordsWritten).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is safe to close more than once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lead-csv-'));
    try {
      const writer = CsvLeadWriter.create(dir, 'HVAC', 'Dallas, TX');
      await writer.write(lead());
      await writer.close();
      await expect(writer.close()).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
