"use client";

import type { TripRecord } from "@/lib/planner/types";
import { TripView } from "./TripView";
import { UpgradesPanel } from "./UpgradesPanel";

export function TripClient({ trip, threshold }: { trip: TripRecord; threshold: number }) {
  return (
    <TripView
      initial={trip}
      threshold={threshold}
      upgrades={(t, version, setTrip) => <UpgradesPanel trip={t} version={version} onTrip={setTrip} />}
    />
  );
}
