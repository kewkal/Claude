import { notFound } from "next/navigation";
import { getTrip } from "@/lib/planner/trips";
import { VERSION_KEYS, type VersionKey } from "@/lib/planner/types";
import { getSettings } from "@/lib/settings";
import { PrintView } from "@/components/trip/PrintView";

export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  const { v } = await searchParams;
  const trip = await getTrip(id).catch(() => null);
  if (!trip) notFound();
  const version = VERSION_KEYS.includes(v as VersionKey) ? (v as VersionKey) : "balanced";
  const settings = await getSettings();
  return <PrintView trip={trip} version={version} threshold={settings.verifiedReviewThreshold} backHref={`/trips/${id}`} />;
}
