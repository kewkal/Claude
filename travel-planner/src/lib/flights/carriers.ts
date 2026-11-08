// Google Flights doesn't label carrier type, so "budget vs. full-service" is a fixed list we maintain.
// Low-cost / ultra-low-cost carriers (typically charge for carry-ons, seats, or both). Edit freely.
export const BUDGET_CARRIERS = [
  // US / Canada / Mexico
  "Spirit",
  "Frontier",
  "Allegiant",
  "Sun Country",
  "Breeze",
  "Avelo",
  "Southwest",
  "Volaris",
  "Viva Aerobus",
  "VivaAerobus",
  "Flair",
  "Lynx",
  // Europe
  "Ryanair",
  "easyJet",
  "Wizz Air",
  "Vueling",
  "Transavia",
  "Eurowings",
  "Jet2",
  "Norse",
  "PLAY",
  "Volotea",
  "Level",
  "French bee",
  "Pegasus",
  // Asia / Pacific
  "AirAsia",
  "Scoot",
  "Jetstar",
  "Cebu Pacific",
  "Peach",
  "ZIPAIR",
  "IndiGo",
  "VietJet",
];

const NORMALIZED = BUDGET_CARRIERS.map((c) => c.toLowerCase());

export function isBudgetCarrier(airline: string): boolean {
  const a = airline.toLowerCase();
  return NORMALIZED.some((c) => a === c || a.startsWith(`${c} `) || a.includes(c));
}
