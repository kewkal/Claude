import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeDirections, liveDirections } from "@/lib/directions";
import { estimateTravel, haversineMiles } from "@/lib/geo";
import { assignTiers, normalizeHotelReviews, normalizeHotels } from "@/lib/hotels/normalize";
import { buildHotelParams, hotelReviews, searchHotels } from "@/lib/hotels/service";
import type { HotelSearchInput } from "@/lib/hotels/types";
import { addPin, listPins, removePin } from "@/lib/pins";

const load = (n: string) => JSON.parse(readFileSync(path.join(__dirname, `../fixtures/serpapi/${n}.json`), "utf8"));
const input: HotelSearchInput = { destination: "Lisbon", checkIn: "2026-11-13", checkOut: "2026-11-18", adults: 2, children: 0, rooms: 1 };

describe("hotels", () => {
  const { hotels } = normalizeHotels(load("google_hotels"));
  const byName = (n: string) => hotels.find((h) => h.name.includes(n))!;

  it("normalizes price with/without taxes, rating, class, gps, images, amenities", () => {
    expect(hotels).toHaveLength(8);
    const h = byName("Chiado");
    expect(h).toMatchObject({ ratePerNight: 238, ratePerNightBeforeTaxes: 214, totalRate: 1190, hotelClass: 4, rating: 4.6, reviews: 2140, freeCancellation: true });
    expect(h.gps).toEqual({ lat: 38.7106, lng: -9.1426 });
    expect(h.images[0].full).toContain("1200");
    expect(byName("Apartment").type).toBe("vacation_rental");
  });

  it("assigns Budget/Mid/Luxury tiers by price terciles with star overrides", () => {
    expect(byName("Grand Palace").tier).toBe("Luxury"); // 5-star
    expect(byName("Alfama").tier).toBe("Budget"); // 2-star
    expect(byName("Hostel").tier).toBe("Budget"); // cheapest, unrated class
    expect(byName("Chiado").tier).toBe("Luxury"); // top third by price
    const t = assignTiers([{ ...byName("Chiado"), hotelClass: null, ratePerNight: null }]);
    expect(t[0].tier).toBe("Mid");
  });

  it("builds Google Hotels params", () => {
    expect(
      buildHotelParams({ ...input, children: 1, childAges: [7], hotelClasses: [5, 4], minRating: 4, freeCancellation: true, vacationRentals: true, sort: "lowest_price", maxPrice: 300 }),
    ).toMatchObject({ q: "Lisbon", check_in_date: "2026-11-13", adults: 2, children: 1, children_ages: "7", hotel_class: "4,5", rating: 8, free_cancellation: "true", vacation_rentals: "true", sort_by: 3, max_price: 300, currency: "USD" });
  });

  it("searches via fixtures and validates", async () => {
    const r = await searchHotels(input);
    expect(r.nights).toBe(5);
    expect(r.hotels.length).toBe(8);
    await expect(searchHotels({ ...input, checkOut: "2026-11-13" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    await expect(searchHotels({ ...input, children: 2, childAges: [5] })).rejects.toMatchObject({ code: "BAD_INPUT" });
  });

  it("returns reviews with source and date", async () => {
    const r = await hotelReviews("FIXTURE_PROP_0");
    expect(r.reviews.map((x) => x.source)).toEqual(["Google", "Tripadvisor", "Expedia"]);
    expect(r.reviews[1].date).toBe("Sep 2026");
    expect(normalizeHotelReviews({ reviews: [{ snippet: "" }] })).toHaveLength(0);
  });
});

describe("geo + directions", () => {
  it("computes haversine distance and labeled estimates", () => {
    const baixa = { lat: 38.711, lng: -9.139 };
    const belem = { lat: 38.697, lng: -9.206 };
    expect(haversineMiles(baixa, belem)).toBeCloseTo(3.7, 1);
    const e = estimateTravel(baixa, belem);
    expect(e.mode).toBe("drive");
    expect(e.estimated).toBe(true);
    expect(estimateTravel(baixa, { lat: 38.7106, lng: -9.1426 }).mode).toBe("walk");
  });

  it("normalizes live directions", async () => {
    const d = await liveDirections({ lat: 38.71, lng: -9.14 }, { lat: 38.7, lng: -9.13 });
    expect(d).toMatchObject({ minutes: 19, mode: "walking", miles: 0.9 });
    expect(normalizeDirections({ directions: [{ formatted_distance: "3.2 km", formatted_duration: "1 hr 5 min" }] })).toMatchObject({ miles: 2, minutes: 65 });
    expect(normalizeDirections({})).toMatchObject({ minutes: null });
  });
});

describe("pins", () => {
  it("adds, dedupes and removes", async () => {
    await addPin({ id: "a", name: "A", lat: 1, lng: 2 });
    await addPin({ id: "a", name: "A2", lat: 1, lng: 2 });
    expect((await listPins()).map((p) => p.name)).toEqual(["A2"]);
    await removePin("a");
    expect(await listPins()).toEqual([]);
    await expect(addPin({ id: "x", name: "bad", lat: NaN, lng: 0 })).rejects.toMatchObject({ code: "BAD_INPUT" });
  });
});
