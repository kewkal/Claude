import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeBookingOptions, normalizeFlights } from "@/lib/flights/normalize";
import { buildFlightParams, flexCost, nextLegFlights, searchFlights } from "@/lib/flights/service";
import { DEFAULT_FLIGHT_FILTERS, emptyHint, filterFlights, sortFlights, valueScore } from "@/lib/flights/sort";
import type { FlightSearchInput } from "@/lib/flights/types";

const load = (n: string) => JSON.parse(readFileSync(path.join(__dirname, `../fixtures/serpapi/${n}.json`), "utf8"));
const { options, priceInsights, googleFlightsUrl } = normalizeFlights(load("google_flights"), 2);
const byNum = (fn: string) => options.find((o) => o.segments.some((s) => s.flightNumber === fn))!;
const kinds = (fn: string) => byNum(fn).flags.map((f) => f.kind).sort();

const input: FlightSearchInput = {
  tripType: "round_trip",
  origin: "IAH",
  destination: "LIS",
  departDate: "2026-11-12",
  returnDate: "2026-11-17",
  travelers: { adults: 2, children: 0, infantsInSeat: 0, infantsOnLap: 0 },
  cabin: "economy",
};

describe("normalizeFlights", () => {
  it("merges best + other flights with prices, per-person split, and carbon", () => {
    expect(options).toHaveLength(6);
    const ua = byNum("UA 64");
    expect(ua.best).toBe(true);
    expect(ua.priceTotal).toBe(1684);
    expect(ua.pricePerPerson).toBe(842);
    expect(ua.stops).toBe(1);
    expect(ua.carbon).toEqual({ thisFlightKg: 612, typicalKg: 655, differencePct: -7 });
    expect(ua.departureToken).toBe("FIXTURE_DEP_UA");
    expect(priceInsights).toEqual({ lowestPrice: 998, priceLevel: "typical", typicalRange: [1150, 1700] });
    expect(googleFlightsUrl).toContain("google.com/travel/flights");
  });

  it("flags red-eyes, tight/long/overnight layovers, self-transfer, basic economy, no carry-on, delays", () => {
    expect(kinds("UA 64")).toEqual(["red_eye"]);
    expect(kinds("TP 202")).toEqual(["often_delayed", "red_eye"]);
    expect(kinds("AC 832")).toEqual(["basic_economy", "no_carry_on", "red_eye", "short_layover"]);
    expect(kinds("NK 1432")).toEqual(["long_layover", "no_carry_on", "red_eye", "self_transfer"]);
    expect(kinds("LH 441")).toEqual(["red_eye"]);
    expect(byNum("AA 46").stops).toBe(2);
  });

  it("distinguishes all-budget from part-budget itineraries", () => {
    expect(byNum("NK 1432").isBudgetCarrier).toBe(false); // Spirit + TAP
    expect(byNum("NK 1432").hasBudgetCarrier).toBe(true);
    expect(byNum("UA 64").isBudgetCarrier).toBe(false);
  });

  it("parses booking options", () => {
    const b = normalizeBookingOptions(load("google_flights_booking"));
    expect(b[0]).toMatchObject({ seller: "United", price: 1684 });
    expect(b[0].bookingRequest?.postData).toBe("u=FIXTURE");
  });
});

describe("sorting and filtering", () => {
  it("sorts cheapest, fastest, and best value", () => {
    expect(sortFlights(options, "cheapest", 25)[0].priceTotal).toBe(998);
    expect(sortFlights(options, "fastest", 25)[0].totalDurationMin).toBe(650);
    // value = per-person price + 25 * hours. AC: 649 + 25*10.83 = 919.8 beats TP 706 + 25*13.08 = 1033
    expect(sortFlights(options, "value", 25)[0].segments[0].flightNumber).toBe("AC 1188");
    expect(valueScore(byNum("AC 832"), 25)).toBeCloseTo(649 + 25 * (650 / 60), 5);
  });

  it("filters by stops, carrier, price, layover, and time windows", () => {
    const f = DEFAULT_FLIGHT_FILTERS;
    expect(filterFlights(options, { ...f, stops: { nonstop: false, one: false, twoPlus: true } })).toHaveLength(1);
    expect(filterFlights(options, { ...f, maxPriceTotal: 1300 }).map((o) => o.priceTotal).sort()).toEqual([1298, 998]);
    expect(filterFlights(options, { ...f, maxLayoverMin: 240 }).every((o) => o.layovers.every((l) => l.durationMin <= 240))).toBe(true);
    expect(filterFlights(options, { ...f, departWindow: [12, 18] }).every((o) => /1[2-8]:/.test(o.segments[0].from.time))).toBe(true);
    expect(filterFlights(options, { ...f, carrier: "budget" })).toHaveLength(1);
    expect(filterFlights(options, { ...f, carrier: "full_service" })).toHaveLength(5);
  });

  it("explains empty results", () => {
    const nonstopOnly = { ...DEFAULT_FLIGHT_FILTERS, stops: { nonstop: true, one: false, twoPlus: false } };
    expect(filterFlights(options, nonstopOnly)).toHaveLength(0);
    expect(emptyHint(options, nonstopOnly)).toBe("No nonstops found — show 1-stop?");
  });
});

describe("flight service", () => {
  it("builds Google Flights params", () => {
    expect(buildFlightParams({ ...input, cabin: "business", stops: "nonstop", outboundTimes: [6, 12], bags: 1 })).toMatchObject({
      type: 1,
      travel_class: 3,
      adults: 2,
      stops: 1,
      departure_id: "IAH",
      arrival_id: "LIS",
      outbound_date: "2026-11-12",
      return_date: "2026-11-17",
      outbound_times: "6,12",
      bags: 1,
      currency: "USD",
    });
    const mc = buildFlightParams({ ...input, tripType: "multi_city", legs: [{ from: "iah", to: "lis", date: "2026-11-12" }, { from: "OPO", to: "IAH", date: "2026-11-18" }] });
    expect(mc.type).toBe(3);
    expect(JSON.parse(String(mc.multi_city_json))).toEqual([
      { departure_id: "IAH", arrival_id: "LIS", date: "2026-11-12" },
      { departure_id: "OPO", arrival_id: "IAH", date: "2026-11-18" },
    ]);
  });

  it("searches, resolves a city name via autocomplete, and loads return flights (fixtures)", async () => {
    const r = await searchFlights({ ...input, destination: "Lisbon" });
    expect(r.options.length).toBe(6);
    expect(r.travelersPaying).toBe(2);
    const ret = await nextLegFlights(input, "FIXTURE_DEP_UA");
    expect(ret.options[0].bookingToken).toBe("FIXTURE_BOOK_UA");
  });

  it("validates input", async () => {
    await expect(searchFlights({ ...input, returnDate: "2026-11-01" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    await expect(searchFlights({ ...input, travelers: { adults: 1, children: 0, infantsInSeat: 0, infantsOnLap: 2 } })).rejects.toMatchObject({ code: "BAD_INPUT" });
  });

  it("previews flex-date cost (7 dates)", async () => {
    const c = await flexCost({ ...input, departDate: "2027-03-10", returnDate: "2027-03-15" });
    expect(c.total).toBe(7);
  });
});
