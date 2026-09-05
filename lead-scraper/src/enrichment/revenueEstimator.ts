/**
 * Revenue estimation, kept deliberately dumb and deliberately separate from
 * extraction.
 *
 * The whole point of this module is what it refuses to do. It cannot see the
 * website, the review count, the ad copy or how slick the design is — it only
 * sees the handful of deterministic signals the parser was allowed to collect.
 * When those are weak, it returns null. A null here is a correct answer.
 */

import { REVENUE_PER_EMPLOYEE_USD, REVENUE_RULES, VERTICAL_KEYWORD_MAP } from '../config.js';
import type { RevenueBracket, RevenueEstimate, RevenueSignals } from '../types/lead.js';

interface BracketRange {
  bracket: RevenueBracket;
  min: number;
  /** Exclusive upper bound; Infinity for the top bracket. */
  max: number;
}

const BRACKETS: readonly BracketRange[] = [
  { bracket: '<$500k', min: 0, max: 500_000 },
  { bracket: '$500k-$1m', min: 500_000, max: 1_000_000 },
  { bracket: '$1m-$5m', min: 1_000_000, max: 5_000_000 },
  { bracket: '$5m-$10m', min: 5_000_000, max: 10_000_000 },
  { bracket: '$10m-$25m', min: 10_000_000, max: 25_000_000 },
  { bracket: '$25m+', min: 25_000_000, max: Number.POSITIVE_INFINITY },
];

/** Which bracket does an exact USD figure fall in? */
export function bracketFor(amountUsd: number): RevenueBracket {
  for (const range of BRACKETS) {
    if (amountUsd >= range.min && amountUsd < range.max) return range.bracket;
  }
  return '$25m+';
}

function bracketIndex(bracket: RevenueBracket): number {
  return BRACKETS.findIndex((range) => range.bracket === bracket);
}

/** Revenue-per-employee factor for a vertical, falling back to the generic figure. */
export function revenuePerEmployee(vertical: string | null | undefined): number {
  const fallback = REVENUE_PER_EMPLOYEE_USD['default'] ?? 150_000;
  if (!vertical) return fallback;
  const haystack = vertical.toLowerCase();
  for (const { keywords, key } of VERTICAL_KEYWORD_MAP) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return REVENUE_PER_EMPLOYEE_USD[key] ?? fallback;
    }
  }
  return fallback;
}

/**
 * Estimate a revenue bracket from deterministic signals, or return null.
 *
 * Precedence:
 *   1. A revenue figure the business published itself — used as-is.
 *   2. An explicit headcount x a configured revenue-per-employee factor,
 *      treated as a range and rounded down to the lower bracket when the
 *      range straddles a boundary.
 *   3. Several operating locations x a conservative per-location floor.
 * Anything else -> null.
 */
export function estimateRevenue(signals: RevenueSignals): RevenueEstimate | null {
  const evidence: string[] = [];

  const published = signals.publishedRevenueUsd ?? null;
  if (published !== null && published > 0) {
    const bracket = bracketFor(published);
    evidence.push(`published revenue figure of $${Math.round(published).toLocaleString('en-US')}`);
    return { bracket, evidence };
  }

  let employeeBracket: RevenueBracket | null = null;
  const employees = signals.employeeCount ?? null;
  if (employees !== null && employees >= REVENUE_RULES.minEmployeesForEstimate) {
    const factor = revenuePerEmployee(signals.vertical);
    const midpoint = employees * factor;
    const low = midpoint * (1 - REVENUE_RULES.employeeEstimateSpread);
    const high = midpoint * (1 + REVENUE_RULES.employeeEstimateSpread);

    const lowBracket = bracketFor(low);
    const highBracket = bracketFor(high);
    // Straddling a boundary means we do not actually know; take the lower side.
    employeeBracket = lowBracket === highBracket ? lowBracket : lowBracket;

    evidence.push(
      `${employees} employees x $${factor.toLocaleString('en-US')}/employee ` +
        `(${signals.vertical ?? 'generic'} factor) = $${Math.round(low).toLocaleString('en-US')}-$${Math.round(high).toLocaleString('en-US')}`,
    );
    if (lowBracket !== highBracket) {
      evidence.push(`range straddles a bracket boundary; took the lower bracket "${lowBracket}"`);
    }
  }

  let locationBracket: RevenueBracket | null = null;
  const locations = signals.locationCount ?? null;
  if (locations !== null && locations >= REVENUE_RULES.minLocationsForEstimate) {
    const floor = locations * REVENUE_RULES.floorPerLocationUsd;
    locationBracket = bracketFor(floor);
    evidence.push(
      `${locations} operating locations x $${REVENUE_RULES.floorPerLocationUsd.toLocaleString('en-US')} ` +
        `conservative floor = $${floor.toLocaleString('en-US')} lower bound`,
    );
  }

  if (employeeBracket === null && locationBracket === null) return null;

  // Where both signals exist, the stronger lower bound wins.
  let bracket: RevenueBracket;
  if (employeeBracket !== null && locationBracket !== null) {
    bracket = bracketIndex(locationBracket) > bracketIndex(employeeBracket) ? locationBracket : employeeBracket;
    evidence.push(`two signals available; used the higher lower-bound bracket "${bracket}"`);
  } else {
    bracket = (employeeBracket ?? locationBracket) as RevenueBracket;
  }

  return { bracket, evidence };
}
