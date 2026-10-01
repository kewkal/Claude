import { notFound } from "next/navigation";
import { getTrip } from "@/lib/planner/trips";
import { getSettings } from "@/lib/settings";
import { TripClient } from "@/components/trip/TripClient";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trip = await getTrip(id).catch(() => null);
  if (!trip) notFound();
  const settings = await getSettings();
  return <TripClient trip={trip} threshold={settings.verifiedReviewThreshold} />;
}
