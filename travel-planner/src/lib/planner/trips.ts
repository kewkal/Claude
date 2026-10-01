import "server-only";
import { getDb } from "@/lib/db";
import { AppError, badInput } from "@/lib/errors";
import { fmtDate } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { recomputeVersion } from "./generate";
import { refsInDays } from "./validate";
import { findRef, SLOTS, VERSION_KEYS, type Dataset, type PlanInput, type PlanVersion, type TripEdit, type TripPlan, type TripRecord, type UpgradeSet } from "./types";

export type { TripEdit };

export function defaultTripName(ds: Dataset): string {
  return `${ds.destination} · ${fmtDate(ds.startDate)}–${fmtDate(ds.endDate)}`;
}

export async function createTrip(input: PlanInput, ds: Dataset, plan: TripPlan, name?: string): Promise<TripRecord> {
  const row = await getDb().insertTrip({ name: name ?? defaultTripName(ds), inputs: input, dataset: ds, plan, upgrades: null, share_token: null });
  return row as unknown as TripRecord;
}

export async function getTrip(id: string): Promise<TripRecord> {
  if (!/^[\w-]{8,64}$/.test(id)) throw new AppError("NOT_FOUND", "Trip not found.");
  const t = await getDb().getTrip(id);
  if (!t) throw new AppError("NOT_FOUND", "Trip not found.");
  return t as unknown as TripRecord;
}

export async function getSharedTrip(token: string): Promise<TripRecord | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  return (await getDb().getTripByShareToken(token)) as unknown as TripRecord | null;
}

export async function listTrips() {
  return getDb().listTrips();
}

export async function deleteTrip(id: string) {
  await getTrip(id);
  await getDb().deleteTrip(id);
}

export async function duplicateTrip(id: string): Promise<TripRecord> {
  const t = await getTrip(id);
  return createTrip(t.inputs, t.dataset, t.plan, `${t.name} (copy)`);
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Buffer.from(bytes).toString("base64url");
}

export async function setSharing(id: string, on: boolean): Promise<TripRecord> {
  await getTrip(id);
  const t = await getDb().updateTrip(id, { share_token: on ? randomToken() : null });
  return t as unknown as TripRecord;
}

export async function saveVersion(trip: TripRecord, v: PlanVersion): Promise<TripRecord> {
  const plan: TripPlan = { ...trip.plan, versions: { ...trip.plan.versions, [v.key]: v } };
  const t = await getDb().updateTrip(trip.id, { plan });
  return t as unknown as TripRecord;
}

export async function saveUpgrades(trip: TripRecord, upgrades: UpgradeSet): Promise<TripRecord> {
  return (await getDb().updateTrip(trip.id, { upgrades })) as unknown as TripRecord;
}

/** Apply one user edit. Every ref is checked against the trip's dataset; costs and travel are recomputed. */
export async function editTrip(id: string, edit: TripEdit): Promise<TripRecord> {
  const trip = await getTrip(id);
  if (edit.op === "rename") {
    const name = (edit.name ?? "").trim().slice(0, 120);
    if (!name) throw badInput("Name can't be empty.");
    return (await getDb().updateTrip(id, { name })) as unknown as TripRecord;
  }
  if (!VERSION_KEYS.includes(edit.version)) throw badInput("Unknown version.");
  const ds = trip.dataset;
  const v: PlanVersion = structuredClone(trip.plan.versions[edit.version]);
  const day = (date: string) => {
    const d = v.days.find((x) => x.date === date);
    if (!d) throw badInput("That date isn't part of this trip.");
    return d;
  };
  const placeRef = (ref: string) => {
    const r = findRef(ds, ref);
    if (!r || r.kind !== "place") throw badInput("That item isn't in this trip's fetched data.");
    return r.item;
  };

  switch (edit.op) {
    case "remove_item": {
      const d = day(edit.date);
      d.blocks = d.blocks.map((b) => ({ ...b, items: b.items.filter((i) => i.ref !== edit.ref) }));
      break;
    }
    case "add_item": {
      if (!SLOTS.includes(edit.slot)) throw badInput("Unknown time slot.");
      const p = placeRef(edit.ref);
      if (refsInDays(v.days).includes(edit.ref)) throw badInput(`${p.name} is already in this itinerary.`);
      if (p.event?.startDate && p.event.startDate !== edit.date) throw badInput(`${p.name} happens on ${fmtDate(p.event.startDate)}.`);
      day(edit.date).blocks.find((b) => b.slot === edit.slot)!.items.push({ ref: edit.ref });
      break;
    }
    case "move_item": {
      if (!SLOTS.includes(edit.toSlot)) throw badInput("Unknown time slot.");
      const p = placeRef(edit.ref);
      if (p.event?.startDate && p.event.startDate !== edit.toDate) throw badInput(`${p.name} happens on ${fmtDate(p.event.startDate)}.`);
      let moved: PlanVersion["days"][number]["blocks"][number]["items"][number] | undefined;
      for (const d of v.days)
        for (const b of d.blocks) {
          const i = b.items.findIndex((x) => x.ref === edit.ref);
          if (i >= 0) moved = b.items.splice(i, 1)[0];
        }
      if (!moved) throw badInput("That item isn't in this itinerary.");
      const target = day(edit.toDate).blocks.find((b) => b.slot === edit.toSlot)!;
      const idx = edit.toIndex === undefined ? target.items.length : Math.max(0, Math.min(edit.toIndex, target.items.length));
      target.items.splice(idx, 0, moved);
      break;
    }
    case "set_flight": {
      const r = findRef(ds, edit.ref);
      if (!r || r.kind !== "flight") throw badInput("That flight isn't in this trip's fetched data.");
      v.flightRef = edit.ref;
      break;
    }
    case "set_hotel": {
      const r = findRef(ds, edit.ref);
      if (!r || r.kind !== "hotel") throw badInput("That hotel isn't in this trip's fetched data.");
      v.hotelRef = edit.ref;
      break;
    }
    case "swap_days": {
      const a = day(edit.a);
      const b = day(edit.b);
      for (const d of [a, b])
        for (const blk of d.blocks)
          for (const it of blk.items) {
            const ev = findRef(ds, it.ref);
            if (ev?.kind === "place" && ev.item.event?.startDate) throw badInput(`${ev.item.name} is fixed to its date; move it first.`);
          }
      const [ab, at, ati] = [a.blocks, a.theme, a.tip];
      a.blocks = b.blocks;
      a.theme = b.theme;
      a.tip = b.tip;
      b.blocks = ab;
      b.theme = at;
      b.tip = ati;
      break;
    }
    case "reorder_day": {
      const d = day(edit.date);
      const current = d.blocks.flatMap((b) => b.items.map((i) => ({ ...i, slot: b.slot })));
      if (edit.order.length !== current.length || !edit.order.every((r) => current.some((c) => c.ref === r))) throw badInput("New order must contain the same stops.");
      // Keep each block's size; fill in the new order.
      const sizes = d.blocks.map((b) => b.items.length);
      const items = edit.order.map((r) => current.find((c) => c.ref === r)!);
      let k = 0;
      d.blocks = d.blocks.map((b, bi) => ({ ...b, items: items.slice(k, (k += sizes[bi])).map(({ ref, note }) => ({ ref, note })) }));
      break;
    }
    default:
      throw badInput("Unknown edit.");
  }

  const settings = await getSettings();
  return saveVersion(trip, recomputeVersion(v, ds, trip.inputs, settings));
}
