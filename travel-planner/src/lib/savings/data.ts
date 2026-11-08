// Money-saving tips computed from the trip's own fetched data. Pure (no I/O, no AI): every number
// here comes from a fetched price or your Settings, and each tip names the items it's based on.
import { airportLabel, airportsForCity } from "@/lib/airports";
import { fmtDuration, fmtUsd } from "@/lib/format";
import { lodgingCost } from "@/lib/planner/budget";
import { findRef, type Dataset, type PlanInput, type PlanVersion, type RefFlight, type RefHotel } from "@/lib/planner/types";
import type { DataTip } from "./types";

const MIN_SAVING = 25;

export function computeDataTips(ds: Dataset, v: PlanVersion, input: Pick<PlanInput, "origin" | "travelers">): DataTip[] {
  const tips: DataTip[] = [];
  const flights = (ds.flights?.options ?? []).filter((f) => f.priceTotal !== null) as (RefFlight & { priceTotal: number })[];
  const cur = v.flightRef ? findRef(ds, v.flightRef) : null;
  const curFlight = cur?.kind === "flight" && cur.item.priceTotal !== null ? (cur.item as RefFlight & { priceTotal: number }) : null;

  // Flights: Google's own read on whether these fares are cheap.
  const pi = ds.flights?.priceInsights;
  if (pi?.priceLevel) {
    const range = pi.typicalRange ? ` Typical for this route: ${fmtUsd(pi.typicalRange[0])}–${fmtUsd(pi.typicalRange[1])}.` : "";
    const advice =
      pi.priceLevel === "high"
        ? " Try shifting dates with the ±3-day check on the Flights tab before booking."
        : pi.priceLevel === "low"
          ? " That's a good time to book."
          : "";
    tips.push({ id: "price-level", category: "flights", text: `Google Flights rates fares for these dates as ${pi.priceLevel}.${range}${advice}`, saveUsd: null, refs: [] });
  }

  if (flights.length && curFlight) {
    const cheapest = [...flights].sort((a, b) => a.priceTotal - b.priceTotal)[0];
    const diff = curFlight.priceTotal - cheapest.priceTotal;
    if (diff >= MIN_SAVING && cheapest.ref !== curFlight.ref) {
      const longer = cheapest.totalDurationMin - curFlight.totalDurationMin;
      const catches = cheapest.flags.map((f) => f.label.toLowerCase());
      tips.push({
        id: `cheapest-flight-${cheapest.ref}`,
        category: "flights",
        text: `The cheapest fetched flight (${cheapest.airlines.join(" + ")}) is ${fmtUsd(diff)} less than this plan's.${longer > 30 ? ` It takes ${fmtDuration(longer)} longer.` : ""}${catches.length ? ` Watch for: ${catches.join(", ")}.` : ""}`,
        saveUsd: diff,
        refs: [cheapest.ref],
      });
    }

    // Low-cost carrier vs. the cheapest full-service fare.
    const budget = flights.filter((f) => f.hasBudgetCarrier).sort((a, b) => a.priceTotal - b.priceTotal)[0];
    const full = flights.filter((f) => !f.hasBudgetCarrier).sort((a, b) => a.priceTotal - b.priceTotal)[0];
    if (budget && full && full.priceTotal - budget.priceTotal >= MIN_SAVING) {
      const noBag = budget.flags.some((f) => f.kind === "no_carry_on" || f.kind === "basic_economy");
      tips.push({
        id: `budget-carrier-${budget.ref}`,
        category: "flights",
        text: `${budget.airlines.join(" + ")} is ${fmtUsd(full.priceTotal - budget.priceTotal)} cheaper than the cheapest full-service option (${full.airlines.join(" + ")}).${noBag ? " Its fare doesn't include a full-size carry-on, so add bag fees before comparing." : " Low-cost carriers often charge for bags and seats, so check the total at checkout."}`,
        saveUsd: full.priceTotal - budget.priceTotal,
        refs: [budget.ref, full.ref],
      });
    }

    // Nearby airport vs. the airport you typed.
    const typed = input.origin.trim();
    const homeCodes = /^[a-z]{3}$/i.test(typed) ? [typed.toUpperCase()] : (airportsForCity(typed)?.split(",") ?? []);
    const home = homeCodes.join("/");
    const fromHome = flights.filter((f) => homeCodes.includes(f.segments[0]?.from.code ?? "")).sort((a, b) => a.priceTotal - b.priceTotal)[0];
    const fromOther = flights.filter((f) => f.segments[0] && !homeCodes.includes(f.segments[0].from.code)).sort((a, b) => a.priceTotal - b.priceTotal)[0];
    if (homeCodes.length && fromHome && fromOther && fromHome.priceTotal - fromOther.priceTotal >= MIN_SAVING) {
      const code = fromOther.segments[0].from.code;
      tips.push({
        id: `nearby-airport-${code}`,
        category: "flights",
        text: `Flying from ${code}${airportLabel(code) ? ` (${airportLabel(code)})` : ""} instead of ${home} saves ${fmtUsd(fromHome.priceTotal - fromOther.priceTotal)} on ${fromOther.airlines.join(" + ")}. Factor in getting to that airport.`,
        saveUsd: fromHome.priceTotal - fromOther.priceTotal,
        refs: [fromOther.ref, fromHome.ref],
      });
    }
  }

  // Hotels: cheapest well-rated stay vs. this plan's.
  const hotels = (ds.hotels?.options ?? []).filter((h) => h.ratePerNight !== null);
  const curH = v.hotelRef ? findRef(ds, v.hotelRef) : null;
  const curHotel = curH?.kind === "hotel" ? curH.item : null;
  if (hotels.length && curHotel) {
    const cost = (h: RefHotel) => lodgingCost(h, ds).amount;
    const goodCheap = hotels.filter((h) => (h.rating ?? 0) >= 4 && h.ref !== curHotel.ref).sort((a, b) => cost(a) - cost(b))[0];
    if (goodCheap && cost(curHotel) - cost(goodCheap) >= MIN_SAVING) {
      tips.push({
        id: `cheaper-hotel-${goodCheap.ref}`,
        category: "hotels",
        text: `${goodCheap.name} is rated ${goodCheap.rating} on Google and costs ${fmtUsd(cost(curHotel) - cost(goodCheap))} less for your stay than ${curHotel.name}.`,
        saveUsd: Math.round(cost(curHotel) - cost(goodCheap)),
        refs: [goodCheap.ref],
      });
    }
    const kitchens = hotels.filter((h) => h.amenities.some((a) => /kitchen/i.test(a)));
    if (kitchens.length) {
      const k = [...kitchens].sort((a, b) => (a.ratePerNight ?? 0) - (b.ratePerNight ?? 0))[0];
      tips.push({
        id: "kitchen",
        category: "food",
        text: `${k.name} (${fmtUsd(k.ratePerNight)}/night) lists a kitchen. Making breakfast there cuts a meal a day from the food budget.`,
        saveUsd: null,
        refs: [k.ref],
      });
    }
    const freeCancel = hotels.filter((h) => h.freeCancellation);
    if (freeCancel.length && !curHotel.freeCancellation) {
      tips.push({
        id: "free-cancel",
        category: "hotels",
        text: `${freeCancel.length} of the fetched stays offer free cancellation (e.g. ${freeCancel[0].name}). Booking one lets you rebook if prices drop.`,
        saveUsd: null,
        refs: freeCancel.slice(0, 3).map((h) => h.ref),
      });
    }
  }

  // Food: well-rated budget restaurants and markets from Google Maps.
  const cheapEats = ds.places
    .filter((p) => p.category === "food" && p.price.level === 1 && p.sources.some((s) => (s.rating ?? 0) >= 4.3))
    .sort((a, b) => Math.max(...b.sources.map((s) => s.reviews ?? 0)) - Math.max(...a.sources.map((s) => s.reviews ?? 0)));
  if (cheapEats.length) {
    tips.push({
      id: "cheap-eats",
      category: "food",
      text: `Highly rated $ spots nearby: ${cheapEats.slice(0, 3).map((p) => p.name).join(", ")} (Google Maps, 4.3+ stars).`,
      saveUsd: null,
      refs: cheapEats.slice(0, 3).map((p) => p.ref),
    });
  }
  const markets = ds.places.filter((p) => p.category === "food" && p.types.some((t) => /market|food court|food hall/i.test(t)));
  if (markets.length) {
    tips.push({
      id: "markets",
      category: "food",
      text: `Markets and food halls usually beat sit-down prices: ${markets.slice(0, 2).map((p) => p.name).join(", ")}.`,
      saveUsd: null,
      refs: markets.slice(0, 2).map((p) => p.ref),
    });
  }

  // Free things to do (listed free by a source, or marked free by you).
  const free = ds.places.filter((p) => p.price.minUsd === 0 || ds.userPrices?.[p.ref] === 0);
  if (free.length) {
    tips.push({
      id: "free-things",
      category: "general",
      text: `Free to visit: ${free.slice(0, 4).map((p) => p.name).join(", ")}.`,
      saveUsd: null,
      refs: free.slice(0, 4).map((p) => p.ref),
    });
  }

  return tips;
}
