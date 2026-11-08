"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/settings-shared";

let cached: AppSettings | null = null;

/** App settings for display logic (value of time, verified threshold...). Falls back to defaults. */
export function useSettings(): AppSettings {
  const [s, setS] = useState<AppSettings>(cached ?? DEFAULT_SETTINGS);
  useEffect(() => {
    if (cached) return;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.settings) {
          cached = d.settings;
          setS(d.settings);
        }
      })
      .catch(() => undefined);
  }, []);
  return s;
}

/** Remember form state for this browser tab (convenience only). */
export function loadSession<T>(key: string, fallback: T): T {
  try {
    const v = sessionStorage.getItem(key);
    return v ? ({ ...fallback, ...JSON.parse(v) } as T) : fallback;
  } catch {
    return fallback;
  }
}
export function saveSession(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}
