import type { LatLng } from "@/lib/geo";

export interface HotelSearchInput {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childAges?: number[];
  rooms: number;
  /** server-side filters */
  minPrice?: number;
  maxPrice?: number;
  hotelClasses?: number[]; // 2..5
  minRating?: 3.5 | 4 | 4.5;
  vacationRentals?: boolean;
  freeCancellation?: boolean;
  sort?: "relevance" | "lowest_price" | "highest_rating" | "most_reviewed";
}

export type HotelTier = "Budget" | "Mid" | "Luxury";

export interface HotelOption {
  id: string;
  propertyToken?: string;
  name: string;
  type: "hotel" | "vacation_rental";
  description?: string;
  link?: string;
  gps?: LatLng;
  checkInTime?: string;
  checkOutTime?: string;
  /** Lowest nightly rate as Google displays it (normally includes taxes & fees). */
  ratePerNight: number | null;
  ratePerNightBeforeTaxes: number | null;
  /** Whole stay, one room, as Google returns it. */
  totalRate: number | null;
  totalBeforeTaxes: number | null;
  hotelClass: number | null;
  rating: number | null;
  reviews: number | null;
  locationRating: number | null;
  images: { thumb: string; full: string }[];
  amenities: string[];
  nearbyPlaces: { name: string; transport: string[] }[];
  freeCancellation: boolean;
  sponsored: boolean;
  ecoCertified: boolean;
  tier: HotelTier;
  tierReason: string;
}

export interface HotelSearchResult {
  hotels: HotelOption[];
  nights: number;
  rooms: number;
  googleHotelsUrl: string | null;
  fetchedAt: string;
  cached: boolean;
  empty: boolean;
}

export interface Review {
  author: string;
  source: string;
  rating: number | null;
  bestRating: number | null;
  date: string | null;
  text: string;
  link?: string;
}

export interface Photo {
  thumb: string;
  full: string;
  caption?: string;
}
