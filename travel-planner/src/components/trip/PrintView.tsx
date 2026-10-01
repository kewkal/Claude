"use client";

import Link from "next/link";
import { DEFAULT_SETTINGS } from "@/lib/settings-shared";
import { VERSION_KEYS, VERSION_LABEL, type TripRecord, type VersionKey } from "@/lib/planner/types";
import { TripView } from "./TripView";

/** Read-only, print-friendly trip. Used by the print page (signed in) and public share links. */
export function PrintView({
  trip,
  version,
  threshold = DEFAULT_SETTINGS.verifiedReviewThreshold,
  backHref,
  shared = false,
}: {
  trip: TripRecord;
  version: VersionKey;
  threshold?: number;
  backHref?: string;
  shared?: boolean;
}) {
  const base = shared ? `/share/${trip.share_token}` : `/trips/${trip.id}/print`;
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        {backHref && (
          <Link href={backHref} className="btn btn-ghost">
            ← Back
          </Link>
        )}
        {VERSION_KEYS.map((k) => (
          <Link key={k} href={`${base}?v=${k}`} className={`btn ${k === version ? "" : "btn-ghost"}`} aria-current={k === version ? "page" : undefined}>
            {VERSION_LABEL[k]}
          </Link>
        ))}
        <button type="button" className="btn btn-ghost ml-auto" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      {shared && <p className="no-print mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">Shared read-only trip</p>}
      <TripView key={version} initial={trip} readOnly printMode initialVersion={version} threshold={threshold} />
    </main>
  );
}
