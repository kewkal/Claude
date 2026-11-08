// Settings shape + defaults (safe to import from client components; no secrets here).

export interface AppSettings {
  /** An item is "Verified" when any one source shows a rating with at least this many reviews. */
  verifiedReviewThreshold: number;
  /** Used by the flight "best value" score and the upgrade ranker. */
  valueOfTimeUsdPerHour: number;
  /** Per-person, per-meal food ESTIMATE by Google price level ($ .. $$$$). Shown as an estimate everywhere. */
  mealCostByPriceLevel: { 1: number; 2: number; 3: number; 4: number };
  /** Group-level local transport ESTIMATE per day (rideshare/transit). */
  localTransportUsdPerDay: number;
  defaultOrigin: "IAH" | "HOU";
  /** When set and in the future, SerpApi calls past 100% of quota are allowed (each one confirmed). */
  serpOverrideUntil: string | null;
  /** Same, for the Claude monthly budget. */
  claudeOverrideUntil: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  verifiedReviewThreshold: 100,
  valueOfTimeUsdPerHour: 25,
  mealCostByPriceLevel: { 1: 15, 2: 30, 3: 60, 4: 110 },
  localTransportUsdPerDay: 35,
  defaultOrigin: "IAH",
  serpOverrideUntil: null,
  claudeOverrideUntil: null,
};
