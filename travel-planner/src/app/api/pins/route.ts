import { readJson, withApi } from "@/lib/api";
import { addPin, listPins, removePin, type Pin } from "@/lib/pins";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => ({ pins: await listPins() }));

export const POST = withApi(async (req) => {
  const pin = await readJson<Omit<Pin, "addedAt">>(req);
  return { pins: await addPin(pin) };
});

export const DELETE = withApi(async (req) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return { pins: await removePin(id) };
});
