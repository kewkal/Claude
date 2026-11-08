import "server-only";
import { badInput } from "@/lib/errors";
import { daysBetween } from "@/lib/format";
import type { SerpParams } from "@/lib/serpapi/cache-key";
import { serpSearch } from "@/lib/serpapi/client";
import { normalizeHotelReviews, normalizeHotels, normalizePhotos } from "./normalize";
import type { HotelSearchInput, HotelSearchResult, Photo, Review } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SORT = { relevance: undefined, lowest_price: 3, highest_rating: 8, most_reviewed: 13 } as const;
const RATING = { 3.5: 7, 4: 8, 4.5: 9 } as const;

export function buildHotelParams(input: HotelSearchInput): SerpParams {
  const ages = input.children > 0 ? (input.childAges?.length ? input.childAges : []).slice(0, input.children) : [];
  return {
    q: input.destination,
    check_in_date: input.checkIn,
    check_out_date: input.checkOut,
    adults: input.adults,
    children: input.children || undefined,
    children_ages: ages.length ? ages.join(",") : undefined,
    min_price: input.minPrice || undefined,
    max_price: input.maxPrice || undefined,
    hotel_class: input.hotelClasses?.length ? [...input.hotelClasses].sort().join(",") : undefined,
    rating: input.minRating ? RATING[input.minRating] : undefined,
    vacation_rentals: input.vacationRentals ? "true" : undefined,
    free_cancellation: input.freeCancellation ? "true" : undefined,
    sort_by: input.sort ? SORT[input.sort] : undefined,
    currency: "USD",
    hl: "en",
    gl: "us",
  };
}

function validate(input: HotelSearchInput) {
  if (!input.destination?.trim()) throw badInput("Destination is required.");
  if (!DATE_RE.test(input.checkIn) || !DATE_RE.test(input.checkOut)) throw badInput("Check-in and check-out dates are required.");
  if (input.checkOut <= input.checkIn) throw badInput("Check-out must be after check-in.");
  if (!input.adults || input.adults < 1) throw badInput("At least one adult is required.");
  if (input.children > 0 && (input.childAges?.length ?? 0) < input.children) throw badInput("Enter an age for each child (hotels price by age).");
  if (!input.rooms || input.rooms < 1) throw badInput("At least one room is required.");
}

export async function searchHotels(input: HotelSearchInput): Promise<HotelSearchResult> {
  validate(input);
  const res = await serpSearch("google_hotels", buildHotelParams(input));
  const { hotels, googleHotelsUrl } = normalizeHotels(res.data);
  return {
    hotels,
    nights: daysBetween(input.checkIn, input.checkOut),
    rooms: input.rooms,
    googleHotelsUrl,
    fetchedAt: res.fetchedAt,
    cached: res.cached,
    empty: hotels.length === 0,
  };
}

export async function hotelReviews(propertyToken: string): Promise<{ reviews: Review[]; fetchedAt: string }> {
  if (!propertyToken) throw badInput("propertyToken is required.");
  const res = await serpSearch("google_hotels_reviews", { property_token: propertyToken, hl: "en" });
  return { reviews: normalizeHotelReviews(res.data), fetchedAt: res.fetchedAt };
}

export async function hotelPhotos(propertyToken: string): Promise<{ photos: Photo[]; fetchedAt: string }> {
  if (!propertyToken) throw badInput("propertyToken is required.");
  const res = await serpSearch("google_hotels_photos", { property_token: propertyToken, hl: "en" });
  return { photos: normalizePhotos(res.data), fetchedAt: res.fetchedAt };
}
