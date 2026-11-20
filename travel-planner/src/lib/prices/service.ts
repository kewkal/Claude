import "server-only";
import { claudeJson } from "@/lib/claude";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildHotelParams } from "@/lib/hotels/service";
import { hotelInput } from "@/lib/planner/dataset";
import { recomputeVersion } from "@/lib/planner/generate";
import { findRef, VERSION_KEYS, type RefPlace, type TripPlan, type TripRecord, type TripStyle } from "@/lib/planner/types";
import type { SerpParams } from "@/lib/serpapi/cache-key";
import { countUncached, serpSearch } from "@/lib/serpapi/client";
import { buildSources } from "@/lib/savings/verify";
import { getSettings } from "@/lib/settings";
import { fmtMoney, parseHotelOffers, parseMoney, parseTripadvisorPrice, priceLines, verifyWebsitePrice } from "./extract";
import { firecrawlConfigured, readPage, type PageRead } from "./firecrawl";
import { usdRate } from "./fx";
import { validatePicks, type RawPick } from "./picks";
import type { FoundPrice, HotelPriceCheck, NotFound, PriceCheck, PriceCheckPlan } from "./types";

const MAX_HOTELS = 3;
const MAX_TRIPADVISOR = 6;
const MAX_WEBSITES = 8;

const STYLE_TERMS: Record<TripStyle, string> = {
  cinematic: "scenic viewpoints",
  cultural: "museums history",
  adventure: "hiking adventure",
  luxury: "luxury experiences",
  relaxation: "relaxing beaches",
  foodie: "food spots",
  nightlife: "nightlife bars",
  romantic: "romantic",
};

type Req = { engine: string; params: SerpParams };

/** Place refs used in any version's itinerary, balanced first. */
function plannedPlaces(trip: TripRecord): RefPlace[] {
  const out: RefPlace[] = [];
  const seen = new Set<string>();
  for (const k of ["balanced", "lean", "splurge"] as const)
    for (const d of trip.plan.versions[k].days)
      for (const b of d.blocks)
        for (const it of b.items) {
          if (seen.has(it.ref)) continue;
          seen.add(it.ref);
          const r = findRef(trip.dataset, it.ref);
          if (r?.kind === "place") out.push(r.item);
        }
  return out;
}

const hasUsd = (p: RefPlace) => p.price.minUsd !== null || p.price.maxUsd !== null;

export function picksQueries(destination: string, styles: TripStyle[], saver: boolean): Req[] {
  const d = destination.trim();
  const terms = styles.map((s) => STYLE_TERMS[s]).join(" ");
  const q: Req[] = [{ engine: "google", params: { q: `site:reddit.com best things to do in ${d} ${terms}`.trim(), hl: "en", gl: "us", num: "10" } }];
  if (!saver) q.push({ engine: "google", params: { q: `site:tripadvisor.com ${d} forum must do ${terms}`.trim(), hl: "en", gl: "us", num: "10" } });
  return q;
}

function hotelReq(trip: TripRecord, propertyToken: string): Req {
  const ds = trip.dataset;
  return { engine: "google_hotels", params: { ...buildHotelParams(hotelInput(trip.inputs, ds.destination, ds.startDate, ds.endDate)), property_token: propertyToken } };
}

const taReq = (id: string): Req => ({ engine: "tripadvisor_place", params: { place_id: id, hl: "en" } });

/** What a price check would do for this trip, and what it costs. Nothing is fetched. */
export async function planPriceCheck(trip: TripRecord): Promise<PriceCheckPlan & { requests: Req[] }> {
  const settings = await getSettings();
  const ds = trip.dataset;
  const hotelRefs = [...new Set(VERSION_KEYS.map((k) => trip.plan.versions[k].hotelRef).filter((r): r is string => !!r))];
  const hotels = hotelRefs
    .map((r) => findRef(ds, r))
    .flatMap((r) => (r?.kind === "hotel" && r.item.propertyToken ? [r.item] : []))
    .slice(0, MAX_HOTELS);

  const fc = firecrawlConfigured();
  const plan: PriceCheckPlan = { hotels: hotels.map((h) => ({ ref: h.ref, name: h.name })), tripadvisor: [], websites: [], convert: [], picksQueries: 0, searches: 0, pages: 0, firecrawlConfigured: fc };
  for (const p of plannedPlaces(trip)) {
    if (hasUsd(p) || p.category === "events") continue;
    const m = p.price.display ? parseMoney(p.price.display) : null;
    if (m && m.currency !== "USD") {
      plan.convert.push({ ref: p.ref, name: p.name, display: p.price.display! });
      continue;
    }
    if (p.category === "food") continue; // restaurants are covered by the food estimate
    if (p.tripadvisorId && plan.tripadvisor.length < MAX_TRIPADVISOR) plan.tripadvisor.push({ ref: p.ref, name: p.name });
    else if (p.website && fc && plan.websites.length < MAX_WEBSITES) plan.websites.push({ ref: p.ref, name: p.name, url: p.website });
  }
  const pq = picksQueries(ds.destination, trip.inputs.styles, settings.searchSaver);
  plan.picksQueries = pq.length;
  const requests: Req[] = [
    ...hotels.map((h) => hotelReq(trip, h.propertyToken!)),
    ...plan.tripadvisor.map((t) => taReq((findRef(ds, t.ref)!.item as RefPlace).tripadvisorId!)),
    ...pq,
  ];
  plan.searches = await countUncached(requests);
  plan.pages = plan.websites.length;
  return { ...plan, requests };
}

const WEB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "amount", "free", "quote"],
        properties: {
          ref: { type: "string" },
          amount: { type: ["number", "null"], description: "Standard adult admission/ticket price as a plain number, in the page's currency. null if the lines don't state one." },
          free: { type: "boolean", description: "true only if the lines say general admission is free" },
          quote: { type: "string", description: "The exact line (copied character for character) that states the price." },
        },
      },
    },
  },
};

const PICKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "ref", "why", "sourceIds"],
        properties: {
          name: { type: "string", description: "The place or activity name exactly as the sources write it." },
          ref: { type: ["string", "null"], description: "Matching ref from TRIP PLACES, or null if none matches." },
          why: { type: "string", description: "One short sentence on why people recommend it, from the snippets. No prices or ratings." },
          sourceIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

async function toUsd(money: { currency: string; amount: number }): Promise<{ usd: number; fx?: FoundPrice["fx"] } | null> {
  if (money.currency === "USD") return { usd: money.amount };
  const r = await usdRate(money.currency);
  if (!r) return null;
  return { usd: Math.round(money.amount * r.rate * 100) / 100, fx: { currency: money.currency, amount: money.amount, rate: r.rate, date: r.date } };
}

/** Run the price check, store it on the trip's dataset, and recompute every version's costs. */
export async function runPriceCheck(trip: TripRecord): Promise<TripRecord> {
  const settings = await getSettings();
  const ds = trip.dataset;
  const plan = await planPriceCheck(trip);
  const place = (ref: string) => findRef(ds, ref)!.item as RefPlace;
  const notes: string[] = [];
  const notFound: NotFound[] = [];
  const activities: FoundPrice[] = [];
  let searchesUsed = 0;
  let quotaError: AppError | null = null;
  let successes = 0;

  const serp = async (r: Req) => {
    try {
      const res = await serpSearch(r.engine, r.params);
      if (!res.cached) searchesUsed++;
      successes++;
      return res;
    } catch (e) {
      const err = e as AppError;
      if (err.code === "SERPAPI_QUOTA_CONFIRM") throw err; // let the app ask you, then retry (cached results are free)
      if (err.code?.startsWith("SERPAPI_QUOTA")) quotaError ??= err;
      return null;
    }
  };

  // 1) SerpApi: hotel prices by booking site, Tripadvisor ticket prices, and Reddit/Tripadvisor-forum picks.
  const pq = picksQueries(ds.destination, trip.inputs.styles, settings.searchSaver);
  const [hotelRes, taRes, picksRes] = await Promise.all([
    Promise.all(plan.hotels.map((h) => serp(hotelReq(trip, (findRef(ds, h.ref)!.item as { propertyToken: string }).propertyToken)))),
    Promise.all(plan.tripadvisor.map((t) => serp(taReq(place(t.ref).tripadvisorId!)))),
    Promise.all(pq.map(serp)),
  ]);
  if (quotaError && successes === 0) throw quotaError;
  if (quotaError) notes.push("SerpApi quota reached partway, so some items weren't checked.");

  const hotels: HotelPriceCheck[] = plan.hotels.map((h, i) => {
    const item = findRef(ds, h.ref)!.item as { totalRate: number | null };
    return { ref: h.ref, name: h.name, offers: hotelRes[i] ? parseHotelOffers(hotelRes[i]!.data) : [], headlineTotalUsd: item.totalRate, fetchedAt: hotelRes[i]?.fetchedAt ?? new Date().toISOString() };
  });

  // 2) Prices the source showed in another currency: convert at the ECB rate (no searches).
  for (const c of plan.convert) {
    const m = parseMoney(c.display)!;
    const usd = await toUsd(m);
    if (usd) activities.push({ ref: c.ref, name: c.name, usd: usd.usd, display: c.display, source: "listed", url: place(c.ref).sources.find((s) => s.source === "google_maps")?.url, fx: usd.fx, fetchedAt: new Date().toISOString() });
    else notFound.push({ ref: c.ref, name: c.name, reason: `couldn't get an exchange rate for ${m.currency}` });
  }

  // 3) Tripadvisor ticket prices; items Tripadvisor doesn't price fall back to their website.
  const websites = [...plan.websites];
  for (const [i, t] of plan.tripadvisor.entries()) {
    const p = place(t.ref);
    const res = taRes[i];
    const found = res ? parseTripadvisorPrice(res.data) : null;
    const usd = found ? await toUsd(found) : null;
    if (found && usd) {
      activities.push({ ref: p.ref, name: p.name, usd: usd.usd, display: found.display, source: "tripadvisor", url: p.sources.find((s) => s.source === "tripadvisor")?.url, fx: usd.fx, fetchedAt: res!.fetchedAt });
    } else if (p.website && plan.firecrawlConfigured && websites.length < MAX_WEBSITES) {
      websites.push({ ref: p.ref, name: p.name, url: p.website });
    } else {
      notFound.push({ ref: p.ref, name: p.name, reason: res ? "Tripadvisor lists no price" : "Tripadvisor couldn't be checked" });
    }
  }

  // 4) Official websites through Firecrawl (2 at a time — the free tier's limit).
  const pages: { w: (typeof websites)[number]; page: PageRead | null; reason?: string }[] = [];
  for (let i = 0; i < websites.length; i += 2) {
    pages.push(...(await Promise.all(websites.slice(i, i + 2).map(async (w) => ({ w, ...(await readPage(w.url)) })))));
  }
  const pagesRead = pages.filter((p) => p.page && !p.page.cached).length;
  const readable = pages.filter((p) => p.page && priceLines(p.page.markdown));
  for (const p of pages) {
    if (!p.page) notFound.push({ ref: p.w.ref, name: p.w.name, reason: p.reason ?? "couldn't read the website" });
    else if (!priceLines(p.page.markdown)) notFound.push({ ref: p.w.ref, name: p.w.name, reason: "the website doesn't list a price" });
  }
  if (!plan.firecrawlConfigured) notes.push("Add FIRECRAWL_API_KEY in Vercel to also read prices from attraction websites (free tier: 1,000 pages/month).");

  // 5) Claude, two small calls in parallel: read prices off the page lines, and pick out recommended places.
  const sources = buildSources(picksRes.filter((r) => r).map((r) => r!.data as Record<string, unknown>), null, 10);
  const placeList = ds.places.filter((p) => p.category !== "events").map((p) => ({ ref: p.ref, name: p.name }));
  const [web, picks] = await Promise.all([
    readable.length
      ? claudeJson<{ items: { ref: string; amount: number | null; free: boolean; quote: string }[] }>({
          system: `You read admission/ticket prices off lines copied from attraction websites. Only report a price a line states outright. Copy the line exactly as "quote". Use the standard adult price. If no line states it, return amount null.`,
          user: readable.map((r) => `REF ${r.w.ref} | ${r.w.name} | ${r.w.url}\n${priceLines(r.page!.markdown)}`).join("\n\n"),
          schema: WEB_SCHEMA,
          note: `price-check-web:${ds.destination}`,
          maxTokens: 6000,
          fixture: () => ({
            items: readable.map((r) => {
              const line = priceLines(r.page!.markdown).split("\n")[0] ?? "";
              const m = parseMoney(line);
              return { ref: r.w.ref, amount: m?.amount ?? null, free: false, quote: line };
            }),
          }),
        }).then((r) => r.data.items)
      : Promise.resolve([]),
    sources.length
      ? claudeJson<{ picks: RawPick[] }>({
          system: `You list places and activities that travelers on Reddit and Tripadvisor forums recommend, using ONLY these search results. Do not use outside knowledge. Name each place exactly as the sources write it, cite every source id that names it, and match it to a TRIP PLACES ref only when it is clearly the same place.

SOURCES
${sources.map((s) => `${s.id} | ${s.domain} | ${s.title}\n   ${s.snippet}`).join("\n")}

TRIP PLACES
${placeList.map((p) => `${p.ref} | ${p.name}`).join("\n")}`,
          user: `Trip styles: ${trip.inputs.styles.join(", ") || "any"}. List up to 10 recommended places/activities in ${ds.destination} that fit these styles, most-recommended first.`,
          schema: PICKS_SCHEMA,
          note: `price-check-picks:${ds.destination}`,
          maxTokens: 8000,
          fixture: () => ({
            picks: [
              { name: "Sample Castle Viewpoint", ref: placeList.find((p) => p.name === "Sample Castle Viewpoint")?.ref ?? null, why: "Travelers say go at opening to beat the crowds.", sourceIds: ["S1", "S3"] },
              { name: "Sample Hidden Courtyard", ref: null, why: "A quiet spot locals point visitors to.", sourceIds: ["S1"] },
              { name: "Made Up Place Nobody Mentions", ref: null, why: "Should be dropped.", sourceIds: ["S1"] },
            ],
          }),
        }).then((r) => validatePicks(r.data.picks, sources, placeList))
      : Promise.resolve([]),
  ]);

  for (const r of readable) {
    const claim = web.find((x) => x.ref === r.w.ref);
    const verified = claim ? verifyWebsitePrice(claim, r.page!.markdown) : null;
    const usd = verified ? await toUsd(verified) : null;
    if (verified && usd) activities.push({ ref: r.w.ref, name: r.w.name, usd: usd.usd, display: claim!.free ? "Free" : fmtMoney(verified), source: "website", url: r.w.url, quote: claim!.quote.slice(0, 240), fx: usd.fx, fetchedAt: r.page!.fetchedAt });
    else notFound.push({ ref: r.w.ref, name: r.w.name, reason: verified ? `couldn't convert ${verified.currency}` : "no price could be confirmed on the website" });
  }

  // Everything else in the plan that still has no price, and why.
  const covered = new Set([...activities.map((a) => a.ref), ...notFound.map((n) => n.ref)]);
  for (const p of plannedPlaces(trip)) {
    if (covered.has(p.ref) || hasUsd(p) || p.category === "events" || p.category === "food") continue;
    notFound.push({ ref: p.ref, name: p.name, reason: p.tripadvisorId || p.website ? "skipped to stay within this check's search limit" : "no Tripadvisor listing or website to check" });
  }

  const check: PriceCheck = { hotels, activities, notFound, picks, sources, searchesUsed, pagesRead, notes, fetchedAt: new Date().toISOString() };
  const dataset = { ...ds, priceCheck: check };
  const versions = Object.fromEntries(VERSION_KEYS.map((k) => [k, recomputeVersion(trip.plan.versions[k], dataset, trip.inputs, settings)])) as TripPlan["versions"];
  return (await getDb().updateTrip(trip.id, { dataset, plan: { ...trip.plan, versions } })) as unknown as TripRecord;
}
