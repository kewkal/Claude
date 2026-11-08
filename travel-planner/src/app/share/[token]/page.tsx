import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSharedTrip } from "@/lib/planner/trips";
import { VERSION_KEYS, type VersionKey } from "@/lib/planner/types";
import { PrintView } from "@/components/trip/PrintView";

export const metadata: Metadata = { title: "Shared trip", robots: { index: false, follow: false } };

// Public, read-only. Renders the saved snapshot only; makes no API calls, so it can't use quota.
export default async function SharePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ v?: string }> }) {
  const { token } = await params;
  const { v } = await searchParams;
  const trip = await getSharedTrip(token);
  if (!trip) notFound();
  const version = VERSION_KEYS.includes(v as VersionKey) ? (v as VersionKey) : "balanced";
  return <PrintView trip={trip} version={version} shared />;
}
