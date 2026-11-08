import { describe, expect, it } from "vitest";
import { withApi } from "@/lib/api";
import { getDb, setDbForTests } from "@/lib/db";
import { explainSupabaseError } from "@/lib/db/supabase";

describe("database error messages say what to fix", () => {
  it("maps Supabase failures to actionable messages", () => {
    expect(explainSupabaseError(401, '{"message":"Invalid API key"}', "GET /settings").message).toContain("SUPABASE_SECRET_KEY");
    expect(explainSupabaseError(404, '{"code":"PGRST205","message":"Could not find the table public.settings"}', "GET /settings").message).toContain("schema.sql");
    expect(explainSupabaseError(403, '{"message":"permission denied for table trips"}', "GET /trips").code).toBe("DB_ERROR");
    expect(explainSupabaseError(500, "boom", "GET /x").message).toContain("Database error 500");
  });

  it("rejects a malformed SUPABASE_URL with a clear message", () => {
    setDbForTests(undefined);
    process.env.SUPABASE_URL = "https://abc.supabase.co/rest/v1";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_x";
    try {
      expect(() => getDb()).toThrow(/nothing after \.co/);
    } finally {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SECRET_KEY;
    }
  });

  it("surfaces the real reason for unexpected server errors", async () => {
    const handler = withApi(async () => {
      throw new Error("kaboom detail");
    });
    const res = await handler(new Request("http://x/api/test"), {});
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Server error: kaboom detail");
  });
});
