import { NextResponse } from "next/server";
import { createSessionToken, passwordMatches, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth";
import { env } from "@/lib/env";

export async function POST(req: Request) {
  const password = env.appPassword;
  const secret = env.sessionSecret;
  if (!password || !secret) {
    return NextResponse.json({ error: "APP_PASSWORD and SESSION_SECRET must be set.", code: "UNAUTHORIZED" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  // Fixed delay blunts brute-force attempts without needing a rate-limit store.
  await new Promise((r) => setTimeout(r, 400));
  if (!body.password || !(await passwordMatches(body.password, password, secret))) {
    return NextResponse.json({ error: "Wrong password.", code: "UNAUTHORIZED" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
