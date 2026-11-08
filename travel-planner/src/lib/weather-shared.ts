export interface DayWeather {
  date: string;
  kind: "forecast" | "historical" | "none";
  highF: number | null;
  lowF: number | null;
  /** forecast: max probability %, historical: % of past years with rain on this date */
  precipChance: number | null;
  precipIn: number | null;
  summary: string | null;
  sunrise: string | null; // "07:12" local
  sunset: string | null;
  source: string;
}

export function weatherNote(w: DayWeather | undefined): string {
  if (!w || w.kind === "none") return "No weather data";
  const parts: string[] = [];
  if (w.summary) parts.push(w.summary);
  if (w.highF !== null && w.lowF !== null) parts.push(`${Math.round(w.highF)}°F / ${Math.round(w.lowF)}°F`);
  if (w.precipChance !== null) parts.push(w.kind === "forecast" ? `${w.precipChance}% chance of rain` : `rain on ${w.precipChance}% of past years`);
  return parts.join(" · ");
}

export function isRainy(w: DayWeather | undefined): boolean {
  return !!w && w.precipChance !== null && w.precipChance >= 50;
}
