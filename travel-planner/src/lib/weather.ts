import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { addDays, daysBetween } from "@/lib/format";
import type { LatLng } from "@/lib/geo";
import type { DayWeather } from "@/lib/weather-shared";

export type { DayWeather };

const FORECAST_DAYS = 16;
const HIST_YEARS = 5;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

// Open-Meteo is free and keyless; we still cache responses (forecast 3 hrs, history 30 days) to be polite and fast.
async function cachedJson(url: string, ttlSeconds: number, fixture: string): Promise<Raw> {
  if (env.fixtureMode) {
    return JSON.parse(await readFile(path.join(process.cwd(), "fixtures", "open-meteo", `${fixture}.json`), "utf8"));
  }
  const db = getDb();
  const key = `open_meteo:${url}`;
  const hit = await db.cacheGet(key);
  if (hit && Date.parse(hit.expires_at) > Date.now()) return hit.response as Raw;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = (await res.json()) as Raw;
  const now = new Date();
  await db.cachePut({ key, engine: "open_meteo", params: { url }, response: data, fetched_at: now.toISOString(), expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString() });
  return data;
}

// WMO weather interpretation codes (Open-Meteo docs).
const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Snow showers",
  95: "Thunderstorms",
  96: "Thunderstorms with hail",
  99: "Thunderstorms with hail",
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const timeOf = (iso: unknown) => (typeof iso === "string" && iso.includes("T") ? iso.split("T")[1].slice(0, 5) : null);

export function normalizeForecast(d: Raw, dates: string[]): DayWeather[] {
  const daily = d.daily ?? {};
  const idx = new Map<string, number>((daily.time ?? []).map((t: string, i: number) => [t, i]));
  return dates.map((date) => {
    const i = idx.get(date);
    if (i === undefined) return { date, kind: "none" as const, highF: null, lowF: null, precipChance: null, precipIn: null, summary: null, sunrise: null, sunset: null, source: "Open-Meteo" };
    const code = daily.weather_code?.[i];
    return {
      date,
      kind: "forecast" as const,
      highF: daily.temperature_2m_max?.[i] ?? null,
      lowF: daily.temperature_2m_min?.[i] ?? null,
      precipChance: daily.precipitation_probability_max?.[i] ?? null,
      precipIn: daily.precipitation_sum?.[i] ?? null,
      summary: typeof code === "number" ? WMO[code] ?? null : null,
      sunrise: timeOf(daily.sunrise?.[i]),
      sunset: timeOf(daily.sunset?.[i]),
      source: "Open-Meteo forecast",
    };
  });
}

/** Average the same calendar dates over past years. Rain chance = share of those years with ≥ 0.01 in. */
export function normalizeHistory(years: Raw[], dates: string[]): DayWeather[] {
  return dates.map((date) => {
    const md = date.slice(5);
    const hi: number[] = [];
    const lo: number[] = [];
    const pr: number[] = [];
    let sunset: string | null = null;
    let sunrise: string | null = null;
    for (const y of years) {
      const daily = y.daily ?? {};
      const i = (daily.time ?? []).findIndex((t: string) => t.slice(5) === md);
      if (i < 0) continue;
      if (typeof daily.temperature_2m_max?.[i] === "number") hi.push(daily.temperature_2m_max[i]);
      if (typeof daily.temperature_2m_min?.[i] === "number") lo.push(daily.temperature_2m_min[i]);
      if (typeof daily.precipitation_sum?.[i] === "number") pr.push(daily.precipitation_sum[i]);
      sunset = timeOf(daily.sunset?.[i]) ?? sunset;
      sunrise = timeOf(daily.sunrise?.[i]) ?? sunrise;
    }
    const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
    return {
      date,
      kind: hi.length ? ("historical" as const) : ("none" as const),
      highF: avg(hi) !== null ? r1(avg(hi)!) : null,
      lowF: avg(lo) !== null ? r1(avg(lo)!) : null,
      precipChance: pr.length ? Math.round((pr.filter((p) => p >= 0.01).length / pr.length) * 100) : null,
      precipIn: avg(pr) !== null ? r1(avg(pr)!) : null,
      summary: null,
      sunrise,
      sunset,
      source: `${hi.length}-yr historical average (Open-Meteo)`,
    };
  });
}

export async function weatherFor(center: LatLng, startDate: string, endDate: string, today = new Date().toISOString().slice(0, 10)): Promise<DayWeather[]> {
  const n = daysBetween(startDate, endDate) + 1;
  const dates = Array.from({ length: n }, (_, i) => addDays(startDate, i));
  const lat = center.lat.toFixed(3);
  const lng = center.lng.toFixed(3);
  const units = "temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto";

  const lastForecastDay = addDays(today, FORECAST_DAYS - 1);
  if (endDate <= lastForecastDay && startDate >= today) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset&start_date=${startDate}&end_date=${endDate}&${units}`;
    return normalizeForecast(await cachedJson(url, 3 * 3600, "forecast"), dates);
  }

  // Same calendar dates in the most recent past years that have fully happened.
  const years: Raw[] = [];
  for (let k = 1; years.length < HIST_YEARS && k <= HIST_YEARS + 2; k++) {
    const shift = (d: string) => {
      const y = Number(d.slice(0, 4)) - k;
      const md = d.slice(5) === "02-29" && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? "02-28" : d.slice(5);
      return `${y}-${md}`;
    };
    const s = shift(startDate);
    const e = shift(endDate);
    if (e >= today) continue;
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset&start_date=${s}&end_date=${e}&${units}`;
    try {
      years.push(await cachedJson(url, 30 * 86400, "archive"));
    } catch (err) {
      console.warn("[weather] archive year failed", (err as Error).message);
    }
  }
  return normalizeHistory(years, dates);
}
