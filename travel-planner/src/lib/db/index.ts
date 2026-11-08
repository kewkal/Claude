import "server-only";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { createMemoryDb } from "./memory";
import { createSupabaseDb } from "./supabase";
import type { Db } from "./types";

export type { Db } from "./types";

const g = globalThis as unknown as { __tpDb?: Db };

export function getDb(): Db {
  if (g.__tpDb) return g.__tpDb;
  const url = env.supabaseUrl;
  const key = env.supabaseSecretKey;
  if (url && key) {
    const base = normalizeSupabaseUrl(url);
    if (!base) {
      throw new AppError(
        "DB_NOT_CONFIGURED",
        `SUPABASE_URL should look like https://yourprojectid.supabase.co. Current value (${url.length} chars): "${url.slice(0, 60)}".`,
      );
    }
    g.__tpDb = createSupabaseDb(base, key);
  } else {
    if (process.env.NODE_ENV === "production" && !env.fixtureMode) {
      throw new AppError("DB_NOT_CONFIGURED", "Database not configured: SUPABASE_URL and SUPABASE_SECRET_KEY must both be set in Vercel, then redeploy.");
    }
    console.warn("[db] Supabase not configured — using in-memory store (data resets on restart).");
    g.__tpDb = createMemoryDb();
  }
  return g.__tpDb;
}

/**
 * Accepts what people actually paste — trailing slash, "/rest/v1", quotes, spaces, any case —
 * and returns "https://<ref>.supabase.co", or null if no project URL is in there at all.
 */
export function normalizeSupabaseUrl(raw: string): string | null {
  const m = /(?:https?:\/\/)?([a-z0-9-]+)\.supabase\.(co|in)\b/i.exec(raw.trim().replace(/^["'\s]+|["'\s]+$/g, ""));
  return m ? `https://${m[1].toLowerCase()}.supabase.${m[2].toLowerCase()}` : null;
}

// Tests swap in their own store.
export function setDbForTests(db: Db | undefined) {
  g.__tpDb = db;
}
