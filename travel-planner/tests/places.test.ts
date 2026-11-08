import { describe, expect, it } from "vitest";
import { normalizeYoutube, parseEventDate, parsePrice, sameName, youtubeId } from "@/lib/places/normalize";
import { explore, placeDetails } from "@/lib/places/service";
import { isVerified } from "@/lib/places/types";

describe("price parsing never invents numbers", () => {
  it("handles levels, ranges, free, foreign currency, and missing", () => {
    expect(parsePrice("$$", "google_maps")).toMatchObject({ display: "$$", level: 2, minUsd: null });
    expect(parsePrice("$10–20", "google_maps")).toMatchObject({ minUsd: 10, maxUsd: 20, level: null });
    expect(parsePrice("Free", "google_maps")).toMatchObject({ minUsd: 0, maxUsd: 0 });
    expect(parsePrice("€15", "google_maps")).toMatchObject({ display: "€15", minUsd: null, maxUsd: null });
    expect(parsePrice(undefined, "google_maps")).toMatchObject({ display: null, minUsd: null });
  });
});

describe("cross-source matching", () => {
  it("matches the same place across Google and Tripadvisor names", () => {
    expect(sameName("Sample Castle Viewpoint", "sample castle viewpoint")).toBe(true);
    expect(sameName("Museu Nacional do Azulejo", "National Tile Museum")).toBe(false);
    expect(sameName("Jerónimos Monastery", "Jeronimos Monastery")).toBe(true);
    expect(sameName("Time Out Market Lisboa", "Time Out Market")).toBe(true);
    expect(sameName("Cafe A", "Cafe B")).toBe(false);
  });
});

describe("explore", () => {
  it("merges Tripadvisor ratings per source and keeps Google-only items", async () => {
    const r = await explore("Lisbon", "sights");
    const castle = r.items.find((i) => i.name === "Sample Castle Viewpoint")!;
    expect(castle.sources.map((s) => s.source)).toEqual(["google_maps", "tripadvisor"]);
    expect(castle.sources[1]).toMatchObject({ rating: 4.5, reviews: 41000 });
    expect(castle.tripadvisorId).toBe("9100001");
    expect(castle.price.display).toBe("€15");
    // unmatched Tripadvisor attraction appears as its own item in sights
    expect(r.items.some((i) => i.id === "ta:9100004")).toBe(true);
    // the tour matched on Tripadvisor is not duplicated into sights
    expect(r.items.some((i) => i.name === "Sample Tram 28 Walking Tour")).toBe(false);
  });

  it("applies the Verified rule per source with a configurable threshold", async () => {
    const r = await explore("Lisbon", "sights");
    const chapel = r.items.find((i) => i.name === "Sample Tiny Chapel")!;
    expect(isVerified(chapel, 100)).toBe(false);
    expect(isVerified(chapel, 40)).toBe(true);
    const tours = await explore("Lisbon", "tours");
    expect(isVerified(tours.items.find((i) => i.name === "Sample Sunset Sailing")!, 100)).toBe(false); // 99 reviews
  });

  it("filters events to the trip window and parses dates", async () => {
    const r = await explore("Lisbon", "events", { startDate: "2026-11-13", endDate: "2026-11-17" });
    expect(r.items.map((e) => e.name)).toEqual(["Sample Jazz Night", "Sample Food Festival"]);
    expect(r.items[0].event).toMatchObject({ startDate: "2026-11-14", venue: "Sample Hall" });
    expect(r.items[0].event!.tickets[0].source).toBe("Ticketline");
    expect(r.items[0].price.display).toBeNull();
  });

  it("parses event dates across year boundaries", () => {
    expect(parseEventDate("Jan 3", "2026-12-28")).toBe("2027-01-03");
    expect(parseEventDate("Dec 30", "2027-01-02")).toBe("2026-12-30");
    expect(parseEventDate("TBD", "2026-11-01")).toBeNull();
  });

  it("food merges Tripadvisor restaurants", async () => {
    const r = await explore("Lisbon", "food");
    expect(r.items.find((i) => i.name === "Sample Tasca")!.sources).toHaveLength(2);
    expect(r.items.some((i) => i.name === "Sample Bifana Stand")).toBe(true);
  });
});

describe("item details (lazy)", () => {
  it("loads reviews from both sources, photos, videos, and popular times", async () => {
    const r = await explore("Lisbon", "sights");
    const castle = r.items.find((i) => i.name === "Sample Castle Viewpoint")!;
    const d = await placeDetails(castle, "Lisbon", ["googleReviews", "tripadvisorReviews", "photos", "videos", "popularTimes"]);
    expect(d.errors).toEqual({});
    expect(d.googleReviews![0]).toMatchObject({ source: "Google Maps", date: "2026-09-01" });
    expect(d.tripadvisorReviews![0]).toMatchObject({ source: "Tripadvisor", author: "sample_traveler" });
    expect(d.photos).toHaveLength(5);
    expect(d.videos!.map((v) => v.id)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
    expect(d.popularTimes!.days.saturday.length).toBe(12);
  });

  it("skips parts the item can't support", async () => {
    const d = await placeDetails({ name: "X", category: "events" }, "Lisbon", ["googleReviews", "tripadvisorReviews", "photos"]);
    expect(d.googleReviews).toBeUndefined();
    expect(d.tripadvisorReviews).toBeUndefined();
  });

  it("extracts YouTube ids", () => {
    expect(youtubeId("https://youtu.be/aaaaaaaaaaa")).toBe("aaaaaaaaaaa");
    expect(normalizeYoutube({ video_results: [{ link: "https://example.com" }] })).toEqual([]);
  });
});

describe("tripadvisor-only items land in the right category", () => {
  it("lists unmatched Tripadvisor tours under tours, not sights", async () => {
    const tours = await explore("Lisbon", "tours");
    const tram = tours.items.find((i) => i.name === "Sample Tram 28 Walking Tour")!;
    expect(tram.sources.map((s) => s.source)).toEqual(["google_maps", "tripadvisor"]);
  });
});
