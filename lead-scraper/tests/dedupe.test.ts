import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Deduper, dedupeKeys } from '../src/scraper.js';
import type { PreliminaryLead } from '../src/types/lead.js';
import { LeadLedger } from '../src/utils/leadLedger.js';

function preliminary(overrides: Partial<PreliminaryLead> = {}): PreliminaryLead {
  return {
    businessName: 'Smith Roofing',
    website: 'https://smithroofing.com',
    phone: '+15125550142',
    reviews: null,
    address: '1200 Congress Ave, Austin',
    sourceUrl: 'https://example.test/1',
    sourceName: 'test',
    ...overrides,
  };
}

/** Run leads through the real Deduper and report what survived and why. */
function run(leads: readonly PreliminaryLead[], ledger: LeadLedger | null = null) {
  const deduper = new Deduper(ledger);
  const kept: PreliminaryLead[] = [];
  let duplicates = 0;
  let previouslySeen = 0;

  for (const lead of leads) {
    const verdict = deduper.accept(lead);
    if (verdict.accepted) kept.push(lead);
    else if (verdict.reason === 'previously-seen') previouslySeen += 1;
    else duplicates += 1;
  }

  return { kept, duplicates, previouslySeen };
}

describe('dedupeKeys', () => {
  it('keys on domain, phone and name+locality', () => {
    const keys = dedupeKeys(preliminary());
    expect(keys).toContain('domain:smithroofing.com');
    expect(keys).toContain('phone:5125550142');
    expect(keys.some((key) => key.startsWith('name:smith roofing|'))).toBe(true);
  });

  it('ignores www and subdomains when keying on domain', () => {
    expect(dedupeKeys(preliminary({ website: 'http://www.smithroofing.com/about' }))).toContain(
      'domain:smithroofing.com',
    );
  });

  it('produces no domain or phone key when neither is published', () => {
    const keys = dedupeKeys(preliminary({ website: null, phone: null }));
    expect(keys.some((key) => key.startsWith('domain:'))).toBe(false);
    expect(keys.some((key) => key.startsWith('phone:'))).toBe(false);
    expect(keys.some((key) => key.startsWith('name:'))).toBe(true);
  });
});

describe('in-run deduplication', () => {
  it('collapses records sharing a canonical domain', () => {
    const result = run([
      preliminary({ website: 'https://smithroofing.com' }),
      preliminary({ businessName: 'Smith Roofing LLC', website: 'http://www.smithroofing.com/', phone: null }),
    ]);
    expect(result.kept).toHaveLength(1);
    expect(result.duplicates).toBe(1);
  });

  it('collapses records sharing a phone line in different formats', () => {
    const result = run([
      preliminary({ website: null, phone: '+15125550142' }),
      preliminary({ businessName: 'Smith Roofing Co', website: null, phone: '5125550142' }),
    ]);
    expect(result.kept).toHaveLength(1);
  });

  it('collapses records sharing a normalised name and locality', () => {
    const result = run([
      preliminary({ website: null, phone: null, businessName: 'Smith Roofing, LLC' }),
      preliminary({ website: null, phone: null, businessName: 'Smith Roofing Inc.' }),
    ]);
    expect(result.kept).toHaveLength(1);
  });

  it('keeps genuinely separate establishments apart', () => {
    const result = run([
      preliminary({
        businessName: 'Bluebonnet Dental',
        website: null,
        phone: '+17135550100',
        address: '100 Main St, Houston',
      }),
      preliminary({
        businessName: 'Bluebonnet Dental',
        website: null,
        phone: '+19725550200',
        address: '900 Elm St, Dallas',
      }),
    ]);
    expect(result.kept).toHaveLength(2);
  });

  it('keeps different businesses apart', () => {
    const result = run([
      preliminary(),
      preliminary({ businessName: 'Northside Air', website: 'https://northsideair.com', phone: '+17135550111' }),
    ]);
    expect(result.kept).toHaveLength(2);
  });

  it('lets through a lead with nothing to key on rather than dropping it', () => {
    const unkeyable = preliminary({ businessName: '', website: null, phone: null, address: null });
    const result = run([unkeyable, unkeyable]);
    expect(result.kept).toHaveLength(2);
  });
});

describe('cross-run deduplication', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dedupe-ledger-'));
    path = join(dir, '.lead-ledger.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips leads a previous run already produced', () => {
    const lead = preliminary();
    const ledger = LeadLedger.open(path);
    ledger.record(lead, dedupeKeys(lead), { vertical: 'HVAC', location: 'Houston, TX' });

    const result = run([lead], LeadLedger.open(path));
    expect(result.kept).toHaveLength(0);
    expect(result.previouslySeen).toBe(1);
    expect(result.duplicates).toBe(0);
  });

  it('counts in-run duplicates and previously-seen leads separately', () => {
    const known = preliminary();
    const ledger = LeadLedger.open(path);
    ledger.record(known, dedupeKeys(known), { vertical: 'HVAC', location: 'Houston, TX' });

    const fresh = preliminary({
      businessName: 'Northside Air',
      website: 'https://northsideair.com',
      phone: '+17135550111',
      address: '5 North Rd, Houston',
    });

    const result = run([known, fresh, fresh], LeadLedger.open(path));
    expect(result.kept).toHaveLength(1);
    expect(result.previouslySeen).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it('still admits everything when no ledger is supplied', () => {
    const lead = preliminary();
    const ledger = LeadLedger.open(path);
    ledger.record(lead, dedupeKeys(lead), { vertical: 'HVAC', location: 'Houston, TX' });

    // This is what --include-seen does: construct the Deduper without a ledger.
    const result = run([lead], null);
    expect(result.kept).toHaveLength(1);
    expect(result.previouslySeen).toBe(0);
  });
});
