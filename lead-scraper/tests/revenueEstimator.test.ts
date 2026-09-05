import { describe, expect, it } from 'vitest';

import { bracketFor, estimateRevenue, revenuePerEmployee } from '../src/enrichment/revenueEstimator.js';

describe('bracketFor', () => {
  it('maps figures onto the published brackets', () => {
    expect(bracketFor(0)).toBe('<$500k');
    expect(bracketFor(499_999)).toBe('<$500k');
    expect(bracketFor(500_000)).toBe('$500k-$1m');
    expect(bracketFor(999_999)).toBe('$500k-$1m');
    expect(bracketFor(1_000_000)).toBe('$1m-$5m');
    expect(bracketFor(5_000_000)).toBe('$5m-$10m');
    expect(bracketFor(10_000_000)).toBe('$10m-$25m');
    expect(bracketFor(25_000_000)).toBe('$25m+');
    expect(bracketFor(900_000_000)).toBe('$25m+');
  });
});

describe('revenuePerEmployee', () => {
  it('selects a vertical-specific factor and falls back to the generic one', () => {
    expect(revenuePerEmployee('HVAC Contractors')).toBe(175_000);
    expect(revenuePerEmployee('Dental Practices')).toBe(200_000);
    expect(revenuePerEmployee('Artisanal Widget Whittlers')).toBe(150_000);
    expect(revenuePerEmployee(null)).toBe(150_000);
  });
});

describe('estimateRevenue', () => {
  it('returns null when there is no deterministic evidence', () => {
    expect(estimateRevenue({})).toBeNull();
    expect(estimateRevenue({ employeeCount: null, locationCount: null, publishedRevenueUsd: null })).toBeNull();
  });

  it('uses a published revenue figure directly', () => {
    const estimate = estimateRevenue({ publishedRevenueUsd: 6_500_000 });
    expect(estimate?.bracket).toBe('$5m-$10m');
    expect(estimate?.evidence[0]).toContain('published revenue');
  });

  it('derives a bracket from an explicit headcount', () => {
    // 20 x $175k = $3.5m, range $2.1m-$4.9m, entirely inside $1m-$5m.
    const estimate = estimateRevenue({ employeeCount: 20, vertical: 'HVAC Contractors' });
    expect(estimate?.bracket).toBe('$1m-$5m');
    expect(estimate?.evidence.join(' ')).toContain('20 employees');
  });

  it('takes the lower bracket when the employee range straddles a boundary', () => {
    // 6 x $175k = $1.05m, range $630k-$1.47m, straddles $500k-$1m / $1m-$5m.
    const estimate = estimateRevenue({ employeeCount: 6, vertical: 'HVAC' });
    expect(estimate?.bracket).toBe('$500k-$1m');
    expect(estimate?.evidence.join(' ')).toContain('straddles');
  });

  it('ignores a headcount too small to be a real signal', () => {
    expect(estimateRevenue({ employeeCount: 1, vertical: 'HVAC' })).toBeNull();
  });

  it('will not estimate from too few locations', () => {
    expect(estimateRevenue({ locationCount: 2 })).toBeNull();
  });

  it('uses a conservative floor once a business runs several locations', () => {
    // 4 x $300k floor = $1.2m.
    const estimate = estimateRevenue({ locationCount: 4 });
    expect(estimate?.bracket).toBe('$1m-$5m');
    expect(estimate?.evidence.join(' ')).toContain('operating locations');
  });

  it('takes the stronger lower bound when both signals exist', () => {
    const estimate = estimateRevenue({ employeeCount: 3, locationCount: 10, vertical: 'HVAC' });
    // employees: 3 x 175k = 525k (range straddles, lower = <$500k)
    // locations: 10 x 300k = $3m -> $1m-$5m, which wins.
    expect(estimate?.bracket).toBe('$1m-$5m');
  });

  it('refuses to see anything except its allowed signals', () => {
    // Review counts, ad copy and site quality are simply not inputs.
    const signals = { vertical: 'HVAC Contractors' } as const;
    expect(estimateRevenue(signals)).toBeNull();
  });

  it('always retains evidence for whatever it does return', () => {
    const estimate = estimateRevenue({ employeeCount: 40, vertical: 'Dental' });
    expect(estimate).not.toBeNull();
    expect(estimate?.evidence.length).toBeGreaterThan(0);
  });
});
