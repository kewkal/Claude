import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

// Vercel Cron hits this daily so the free Supabase project never pauses for inactivity.
export async function GET(req: Request) {
  const secret = env.cronSecret;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await getDb().ping();
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
