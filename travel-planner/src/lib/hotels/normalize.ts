import type { HotelOption, HotelTier, Photo, Review } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const TIER_RULE =
  "Tier = where this nightly price falls among this search's results (bottom third Budget, middle Mid, top third Luxury). Star class overrides: 5-star is always Luxury, 1–2 star is always Budget.";

export function assignTiers(hotels: Omit<HotelOption, "tier" | "tierReason">[]): HotelOption[] {
  const prices = hotels.map((h) => h.ratePerNight).filter((p): p is number => p !== null).sort((a, b) => a - b);
  const q = (f: number) => (prices.length ? prices[Math.min(prices.length - 1, Math.floor(prices.length * f))] : null);
  const lowCut = q(1 / 3);
  const highCut = q(2 / 3);

  return hotels.map((h) => {
    let tier: HotelTier = "Mid";
    let tierReason = "Middle third of prices in this search";
    if (h.hotelClass !== null && h.hotelClass >= 5) {
      tier = "Luxury";
      tierReason = "5-star hotel";
    } else if (h.hotelClass !== null && h.hotelClass <= 2) {
      tier = "Budget";
      tierReason = `${h.hotelClass}-star hotel`;
    } else if (h.ratePerNight !== null && lowCut !== null && highCut !== null) {
      if (h.ratePerNight < lowCut) {
        tier = "Budget";
        tierReason = "Bottom third of prices in this search";
      } else if (h.ratePerNight >= highCut) {
        tier = "Luxury";
        tierReason = "Top third of prices in this search";
      }
    } else if (h.ratePerNight === null) {
      tierReason = "No price returned; defaulted to Mid";
    }
    return { ...h, tier, tierReason };
  });
}

function normalizeProperty(p: Raw): Omit<HotelOption, "tier" | "tierReason"> {
  const name = str(p.name) || "Unnamed property";
  const gps = num(p.gps_coordinates?.latitude) !== null && num(p.gps_coordinates?.longitude) !== null
    ? { lat: p.gps_coordinates.latitude, lng: p.gps_coordinates.longitude }
    : undefined;
  const text = JSON.stringify(p);
  return {
    id: str(p.property_token) || `name:${name}`,
    propertyToken: str(p.property_token) || undefined,
    name,
    type: /vacation/i.test(str(p.type)) ? "vacation_rental" : "hotel",
    description: str(p.description) || undefined,
    link: str(p.link) || undefined,
    gps,
    checkInTime: str(p.check_in_time) || undefined,
    checkOutTime: str(p.check_out_time) || undefined,
    ratePerNight: num(p.rate_per_night?.extracted_lowest),
    ratePerNightBeforeTaxes: num(p.rate_per_night?.extracted_before_taxes_fees),
    totalRate: num(p.total_rate?.extracted_lowest),
    totalBeforeTaxes: num(p.total_rate?.extracted_before_taxes_fees),
    hotelClass: num(p.extracted_hotel_class),
    rating: num(p.overall_rating),
    reviews: num(p.reviews),
    locationRating: num(p.location_rating),
    images: (Array.isArray(p.images) ? p.images : [])
      .map((i: Raw) => ({ thumb: str(i.thumbnail), full: str(i.original_image) || str(i.thumbnail) }))
      .filter((i: Photo) => i.thumb),
    amenities: Array.isArray(p.amenities) ? p.amenities.map(String) : [],
    nearbyPlaces: (Array.isArray(p.nearby_places) ? p.nearby_places : []).map((n: Raw) => ({
      name: str(n.name),
      transport: (Array.isArray(n.transportations) ? n.transportations : []).map((t: Raw) => `${str(t.duration)} by ${str(t.type).toLowerCase()}`),
    })),
    freeCancellation: p.free_cancellation === true || /free cancellation/i.test(text),
    sponsored: p.sponsored === true,
    ecoCertified: p.eco_certified === true,
  };
}

export function normalizeHotels(data: Raw): { hotels: HotelOption[]; googleHotelsUrl: string | null } {
  const props = Array.isArray(data.properties) ? data.properties : [];
  const seen = new Set<string>();
  const list = props.map(normalizeProperty).filter((h: { id: string }) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
  return { hotels: assignTiers(list), googleHotelsUrl: str(data.search_metadata?.google_hotels_url) || null };
}

export function normalizeHotelReviews(data: Raw): Review[] {
  const list = Array.isArray(data.reviews) ? data.reviews : [];
  return list.map((r: Raw) => ({
    author: str(r.user?.name) || "Anonymous",
    source: str(r.source) || "Google",
    rating: num(r.rating),
    bestRating: num(r.best_rating) ?? 5,
    date: str(r.date) || null,
    text: str(r.snippet) || str(r.text),
    link: str(r.link) || str(r.user?.link) || undefined,
  })).filter((r: Review) => r.text);
}

export function normalizePhotos(data: Raw): Photo[] {
  const list = Array.isArray(data.photos) ? data.photos : [];
  return list
    .map((p: Raw) => ({ thumb: str(p.thumbnail), full: str(p.original) || str(p.image) || str(p.thumbnail), caption: str(p.title) || undefined }))
    .filter((p: Photo) => p.thumb);
}
