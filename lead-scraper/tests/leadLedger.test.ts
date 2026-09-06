import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dedupeKeys } from '../src/scraper.js';
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

const CONTEXT = { vertical: 'HVAC Contractors', location: 'Houston, TX' };

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lead-ledger-'));
  path = join(dir, '.lead-ledger.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('LeadLedger', () => {
  it('starts empty when the file does not exist', () => {
    const ledger = LeadLedger.open(join(dir, 'nowhere', 'ledger.jsonl'));
    expect(ledger.size).toBe(0);
    expect(ledger.has(['domain:smithroofing.com'])).toBe(false);
  });

  it('round-trips a recorded lead across a reopen', () => {
    const lead = preliminary();
    const keys = dedupeKeys(lead);

    const first = LeadLedger.open(path);
    first.record(lead, keys, CONTEXT);
    expect(first.size).toBe(1);

    const second = LeadLedger.open(path);
    expect(second.size).toBe(1);
    for (const key of keys) {
      expect(second.has([key])).toBe(true);
    }
  });

  it('creates the containing directory when recording', () => {
    const nested = join(dir, 'deep', 'ledger.jsonl');
    const ledger = LeadLedger.open(nested);
    ledger.record(preliminary(), dedupeKeys(preliminary()), CONTEXT);
    expect(readFileSync(nested, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('does not report unseen leads as seen', () => {
    const ledger = LeadLedger.open(path);
    ledger.record(preliminary(), dedupeKeys(preliminary()), CONTEXT);

    const other = preliminary({
      businessName: 'Northside Air',
      website: 'https://northsideair.com',
      phone: '+17135550111',
      address: '5 North Rd, Houston',
    });
    expect(ledger.has(dedupeKeys(other))).toBe(false);
  });

  it('treats a match on any single key as seen', () => {
    const ledger = LeadLedger.open(path);
    ledger.record(preliminary(), dedupeKeys(preliminary()), CONTEXT);

    // Same site, different name and phone — still the same business.
    const sameDomain = preliminary({
      businessName: 'Smith Roofing of Austin',
      phone: '+15125559999',
      address: 'Somewhere else',
    });
    expect(ledger.has(dedupeKeys(sameDomain))).toBe(true);

    // Same phone line, nothing else in common.
    const samePhone = preliminary({
      businessName: 'Totally Different Co',
      website: 'https://different.com',
      address: 'Elsewhere',
    });
    expect(ledger.has(dedupeKeys(samePhone))).toBe(true);
  });

  it('records nothing for a lead with no usable keys', () => {
    const ledger = LeadLedger.open(path);
    const unkeyable = preliminary({ businessName: '', website: null, phone: null, address: null });
    ledger.record(unkeyable, dedupeKeys(unkeyable), CONTEXT);
    expect(ledger.size).toBe(0);
  });

  it('skips malformed lines and still loads the good ones', () => {
    writeFileSync(
      path,
      [
        JSON.stringify({ keys: ['domain:first.com'], name: 'First' }),
        '{ this is not json',
        JSON.stringify({ name: 'No keys field' }),
        '',
        JSON.stringify({ keys: ['domain:last.com'], name: 'Last' }),
        '{"keys":["domain:truncated.com"', // interrupted mid-write
      ].join('\n'),
      'utf8',
    );

    const ledger = LeadLedger.open(path);
    expect(ledger.size).toBe(2);
    expect(ledger.has(['domain:first.com'])).toBe(true);
    expect(ledger.has(['domain:last.com'])).toBe(true);
    expect(ledger.has(['domain:truncated.com'])).toBe(false);
  });

  it('appends rather than rewriting, so history survives', () => {
    const first = LeadLedger.open(path);
    first.record(preliminary(), dedupeKeys(preliminary()), CONTEXT);

    const second = LeadLedger.open(path);
    const other = preliminary({
      businessName: 'Northside Air',
      website: 'https://northsideair.com',
      phone: '+17135550111',
    });
    second.record(other, dedupeKeys(other), CONTEXT);

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(LeadLedger.open(path).size).toBe(2);
  });

  it('stores human-readable context for inspection', () => {
    const ledger = LeadLedger.open(path);
    ledger.record(preliminary(), dedupeKeys(preliminary()), CONTEXT);

    const entry = JSON.parse(readFileSync(path, 'utf8').trim()) as Record<string, unknown>;
    expect(entry['name']).toBe('Smith Roofing');
    expect(entry['vertical']).toBe('HVAC Contractors');
    expect(entry['location']).toBe('Houston, TX');
    expect(typeof entry['firstSeen']).toBe('string');
  });
});
