import "server-only";
import { env } from "@/lib/env";
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
    g.__tpDb = createSupabaseDb(url, key);
  } else {
    if (process.env.NODE_ENV === "production" && !env.fixtureMode) {
      throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required in production.");
    }
    console.warn("[db] Supabase not configured — using in-memory store (data resets on restart).");
    g.__tpDb = createMemoryDb();
  }
  return g.__tpDb;
}

// Tests swap in their own store.
export function setDbForTests(db: Db | undefined) {
  g.__tpDb = db;
}
