import "server-only";
import { getDb } from "@/lib/db";
import { badInput } from "@/lib/errors";
import { isLatLng } from "@/lib/geo";
import type { Pin } from "@/lib/pins-shared";

export type { Pin };

const KEY = "pins";
const MAX_PINS = 50;

export async function listPins(): Promise<Pin[]> {
  return (await getDb().getSetting<Pin[]>(KEY)) ?? [];
}

export async function addPin(pin: Omit<Pin, "addedAt">): Promise<Pin[]> {
  if (!pin.id || !pin.name || !isLatLng(pin)) throw badInput("Pin needs id, name, lat, lng.");
  const pins = (await listPins()).filter((p) => p.id !== pin.id);
  const next = [{ ...pin, addedAt: new Date().toISOString() }, ...pins].slice(0, MAX_PINS);
  await getDb().setSetting(KEY, next);
  return next;
}

export async function removePin(id: string): Promise<Pin[]> {
  const next = (await listPins()).filter((p) => p.id !== id);
  await getDb().setSetting(KEY, next);
  return next;
}
