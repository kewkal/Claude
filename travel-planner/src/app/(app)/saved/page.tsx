"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { fmtDate, fmtTimestamp, fmtUsd } from "@/lib/format";
import type { PlanInput } from "@/lib/planner/types";
import { CardSkeletons, EmptyState, ErrorState } from "@/components/ui";

interface Summary {
  id: string;
  name: string;
  inputs: PlanInput;
  share_token: string | null;
  created_at: string;
  updated_at: string;
}

export default function SavedPage() {
  const [trips, setTrips] = useState<Summary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = () =>
    api<{ trips: Summary[] }>("/api/trips")
      .then((r) => setTrips(r.trips))
      .catch((e) => setError(e as ApiError));

  useEffect(() => {
    load();
  }, []);

  async function duplicate(id: string) {
    try {
      await api(`/api/trips/${id}/duplicate`, { method: "POST" });
      load();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  async function rename(t: Summary) {
    const name = window.prompt("Rename trip", t.name);
    if (!name || name === t.name) return;
    try {
      await api(`/api/trips/${t.id}`, { method: "PATCH", json: { op: "rename", name } });
      load();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  async function remove(t: Summary) {
    if (!window.confirm(`Delete "${t.name}"? This can't be undone.`)) return;
    try {
      await api(`/api/trips/${t.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Saved trips</h1>
      {error && <ErrorState message={error.message} code={error.code} />}
      {!trips && !error && <CardSkeletons count={3} height="h-20" />}
      {trips && trips.length === 0 && (
        <EmptyState title="No saved trips yet.">
          <Link href="/" className="font-semibold text-accent">
            Plan your first trip →
          </Link>
        </EmptyState>
      )}
      {trips?.map((t) => (
        <article key={t.id} className="card p-4">
          <Link href={`/trips/${t.id}`} className="block">
            <h2 className="font-bold leading-tight">{t.name}</h2>
            <p className="text-sm text-muted">
              {t.inputs.origin} → {t.inputs.destinations.join(" / ")} · budget {fmtUsd(t.inputs.budgetUsd)}
              {t.inputs.dateMode === "fixed" ? ` · ${fmtDate(t.inputs.startDate)}–${fmtDate(t.inputs.endDate)}` : ""}
            </p>
            <p className="text-xs text-muted">
              Updated {fmtTimestamp(t.updated_at)}
              {t.share_token ? " · shared" : ""}
            </p>
          </Link>
          <div className="mt-2 flex gap-4 text-sm font-semibold">
            <button type="button" className="text-accent" onClick={() => rename(t)}>
              Rename
            </button>
            <button type="button" className="text-accent" onClick={() => duplicate(t.id)}>
              Duplicate
            </button>
            <button type="button" className="text-danger" onClick={() => remove(t)}>
              Delete
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
