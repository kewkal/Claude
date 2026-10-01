// Client-safe flight types (normalized from SerpApi's Google Flights responses).

export type TripType = "round_trip" | "one_way" | "multi_city";
export type Cabin = "economy" | "premium_economy" | "business" | "first";

export interface Travelers {
  adults: number;
  children: number;
  infantsInSeat: number;
  infantsOnLap: number;
}

export interface FlightLegInput {
  from: string; // IATA code(s), comma separated allowed
  to: string;
  date: string; // yyyy-mm-dd
}

export interface FlightSearchInput {
  tripType: TripType;
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  /** multi-city only */
  legs?: FlightLegInput[];
  travelers: Travelers;
  cabin: Cabin;
  /** server-side filters (passed to Google to keep result sets relevant) */
  stops?: "any" | "nonstop" | "max1" | "max2";
  maxPrice?: number;
  outboundTimes?: [number, number]; // departure hour window 0-23
  returnTimes?: [number, number];
  bags?: number; // carry-on bags
  excludeBasic?: boolean;
}

export interface FlightSegment {
  from: { code: string; name: string; time: string };
  to: { code: string; name: string; time: string };
  durationMin: number;
  airline: string;
  airlineLogo?: string;
  flightNumber?: string;
  airplane?: string;
  travelClass?: string;
  legroom?: string;
  extensions: string[];
  overnight: boolean;
  oftenDelayed: boolean;
}

export interface Layover {
  code: string;
  name: string;
  durationMin: number;
  overnight: boolean;
}

export type FlightFlagKind =
  | "red_eye"
  | "short_layover"
  | "long_layover"
  | "overnight_layover"
  | "self_transfer"
  | "basic_economy"
  | "no_carry_on"
  | "often_delayed";

export interface FlightFlag {
  kind: FlightFlagKind;
  label: string;
  detail: string;
  severity: "warn" | "danger" | "info";
}

export interface FlightOption {
  id: string;
  segments: FlightSegment[];
  layovers: Layover[];
  totalDurationMin: number;
  stops: number;
  /** Total price for all travelers as returned by Google Flights (USD). null when Google omits it. */
  priceTotal: number | null;
  /** priceTotal divided by paying travelers (adults + children + infants in seat). */
  pricePerPerson: number | null;
  carbon?: { thisFlightKg: number; typicalKg: number | null; differencePct: number | null };
  airlines: string[];
  isBudgetCarrier: boolean;
  flags: FlightFlag[];
  departureToken?: string;
  bookingToken?: string;
  /** "Round trip", "One way", ... as Google labels it */
  typeLabel?: string;
  extensions: string[];
  best: boolean;
}

export interface PriceInsights {
  lowestPrice: number | null;
  priceLevel: "low" | "typical" | "high" | null;
  typicalRange: [number, number] | null;
}

export interface FlightSearchResult {
  options: FlightOption[];
  priceInsights: PriceInsights | null;
  googleFlightsUrl: string | null;
  fetchedAt: string;
  cached: boolean;
  travelersPaying: number;
  /** true if Google returned nothing for this query */
  empty: boolean;
}

export interface BookingOption {
  seller: string;
  price: number | null;
  optionTitle?: string;
  extensions: string[];
  bookingRequest?: { url: string; postData?: string };
  baggage?: string[];
}
