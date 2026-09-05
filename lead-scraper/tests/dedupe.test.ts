import { describe, expect, it } from 'vitest';

import { dedupeKeys } from '../src/scraper.js';
import type { PreliminaryLead } from '../src/types/lead.js';

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

/** Mirrors the Deduper in scraper.ts, which is intentionally private. */
function dedupe(leads: readonly PreliminaryLead[]): PreliminaryLead[] {
  const seen = new Set<string>();
  const kept: PreliminaryLead[] = [];
  for (const lead of leads) {
    const keys = dedupeKeys(lead);
    if (keys.length > 0 && keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    kept.push(lead);
  }
  return kept;
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

describe('deduplication', () => {
  it('collapses records sharing a canonical domain', () => {
    const kept = dedupe([
      preliminary({ website: 'https://smithroofing.com' }),
      preliminary({ businessName: 'Smith Roofing LLC', website: 'http://www.smithroofing.com/', phone: null }),
    ]);
    expect(kept).toHaveLength(1);
  });

  it('collapses records sharing a phone line in different formats', () => {
    const kept = dedupe([
      preliminary({ website: null, phone: '+15125550142' }),
      preliminary({ businessName: 'Smith Roofing Co', website: null, phone: '5125550142' }),
    ]);
    expect(kept).toHaveLength(1);
  });

  it('collapses records sharing a normalised name and locality', () => {
    const kept = dedupe([
      preliminary({ website: null, phone: null, businessName: 'Smith Roofing, LLC' }),
      preliminary({ website: null, phone: null, businessName: 'Smith Roofing Inc.' }),
    ]);
    expect(kept).toHaveLength(1);
  });

  it('keeps genuinely separate establishments apart', () => {
    const kept = dedupe([
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
    expect(kept).toHaveLength(2);
  });

  it('keeps different businesses apart', () => {
    const kept = dedupe([
      preliminary(),
      preliminary({ businessName: 'Northside Air', website: 'https://northsideair.com', phone: '+17135550111' }),
    ]);
    expect(kept).toHaveLength(2);
  });
});
