import { afterEach, beforeEach, vi } from "vitest";
import { createMemoryDb } from "@/lib/db/memory";
import { setDbForTests } from "@/lib/db";

// Tests must never touch live APIs. Any network call fails the test loudly.
const blockedFetch = vi.fn(async (input: unknown) => {
  throw new Error(`Network access is blocked in tests (attempted: ${String(input).slice(0, 80)})`);
});

beforeEach(() => {
  vi.stubGlobal("fetch", blockedFetch);
  setDbForTests(createMemoryDb());
  process.env.DATA_MODE = "fixtures";
  process.env.SERPAPI_MONTHLY_QUOTA = "250";
  process.env.CLAUDE_MONTHLY_BUDGET_USD = "15";
});

afterEach(() => {
  vi.unstubAllGlobals();
  setDbForTests(undefined);
});
