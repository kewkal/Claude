import { describe, expect, it } from "vitest";
import { createSessionToken, passwordMatches, SESSION_TTL_MS, verifySessionToken } from "@/lib/auth";

describe("session tokens", () => {
  it("verifies a fresh token and rejects tampering, wrong secret, and expiry", async () => {
    const now = 1_800_000_000_000;
    const t = await createSessionToken("s3cret", now);
    expect(await verifySessionToken(t, "s3cret", now)).toBe(true);
    expect(await verifySessionToken(t, "other", now)).toBe(false);
    const [exp, sig] = t.split(".");
    expect(await verifySessionToken(`${Number(exp) + 1}.${sig}`, "s3cret", now)).toBe(false);
    expect(await verifySessionToken(t, "s3cret", now + SESSION_TTL_MS + 1)).toBe(false);
    expect(await verifySessionToken(undefined, "s3cret", now)).toBe(false);
    expect(await verifySessionToken("garbage", "s3cret", now)).toBe(false);
  });

  it("compares passwords", async () => {
    expect(await passwordMatches("hunter2", "hunter2", "k")).toBe(true);
    expect(await passwordMatches("hunter3", "hunter2", "k")).toBe(false);
    expect(await passwordMatches("", "hunter2", "k")).toBe(false);
  });
});
