// US airports for suggestions, free city -> airport lookup, and "nearby airports" expansion.
// Includes secondary airports where low-cost carriers (Avelo, Allegiant, Breeze, Spirit, Frontier,
// Sun Country) often fly. Coordinates are approximate (±2 mi), only used to measure distance.
// Any airport code or city typed in still works: unknown text falls back to Google's airport lookup.

export interface Airport {
  code: string;
  city: string; // "City, ST"
  name: string;
  lat: number;
  lng: number;
}

export const US_AIRPORTS: Airport[] = [
  { code: "ATL", city: "Atlanta, GA", name: "Hartsfield-Jackson", lat: 33.64, lng: -84.43 },
  { code: "LAX", city: "Los Angeles, CA", name: "Los Angeles Intl", lat: 33.94, lng: -118.41 },
  { code: "ORD", city: "Chicago, IL", name: "O'Hare", lat: 41.98, lng: -87.9 },
  { code: "MDW", city: "Chicago, IL", name: "Midway", lat: 41.79, lng: -87.75 },
  { code: "DFW", city: "Dallas/Fort Worth, TX", name: "DFW Intl", lat: 32.9, lng: -97.04 },
  { code: "DAL", city: "Dallas, TX", name: "Love Field", lat: 32.85, lng: -96.85 },
  { code: "DEN", city: "Denver, CO", name: "Denver Intl", lat: 39.86, lng: -104.67 },
  { code: "JFK", city: "New York, NY", name: "John F. Kennedy", lat: 40.64, lng: -73.78 },
  { code: "LGA", city: "New York, NY", name: "LaGuardia", lat: 40.78, lng: -73.87 },
  { code: "EWR", city: "Newark, NJ", name: "Newark Liberty", lat: 40.69, lng: -74.17 },
  { code: "SFO", city: "San Francisco, CA", name: "San Francisco Intl", lat: 37.62, lng: -122.38 },
  { code: "OAK", city: "Oakland, CA", name: "Oakland Intl", lat: 37.71, lng: -122.22 },
  { code: "SJC", city: "San Jose, CA", name: "San Jose Intl", lat: 37.36, lng: -121.93 },
  { code: "SEA", city: "Seattle, WA", name: "Seattle-Tacoma", lat: 47.45, lng: -122.31 },
  { code: "LAS", city: "Las Vegas, NV", name: "Harry Reid Intl", lat: 36.08, lng: -115.15 },
  { code: "MCO", city: "Orlando, FL", name: "Orlando Intl", lat: 28.43, lng: -81.31 },
  { code: "MIA", city: "Miami, FL", name: "Miami Intl", lat: 25.79, lng: -80.29 },
  { code: "FLL", city: "Fort Lauderdale, FL", name: "Fort Lauderdale-Hollywood", lat: 26.07, lng: -80.15 },
  { code: "CLT", city: "Charlotte, NC", name: "Charlotte Douglas", lat: 35.21, lng: -80.94 },
  { code: "PHX", city: "Phoenix, AZ", name: "Sky Harbor", lat: 33.43, lng: -112.01 },
  { code: "IAH", city: "Houston, TX", name: "George Bush Intercontinental", lat: 29.98, lng: -95.34 },
  { code: "HOU", city: "Houston, TX", name: "Hobby", lat: 29.65, lng: -95.28 },
  { code: "BOS", city: "Boston, MA", name: "Logan", lat: 42.36, lng: -71.01 },
  { code: "MSP", city: "Minneapolis, MN", name: "Minneapolis-St. Paul", lat: 44.88, lng: -93.22 },
  { code: "DTW", city: "Detroit, MI", name: "Detroit Metro", lat: 42.21, lng: -83.35 },
  { code: "PHL", city: "Philadelphia, PA", name: "Philadelphia Intl", lat: 39.87, lng: -75.24 },
  { code: "BWI", city: "Baltimore, MD", name: "Baltimore/Washington", lat: 39.18, lng: -76.67 },
  { code: "DCA", city: "Washington, DC", name: "Reagan National", lat: 38.85, lng: -77.04 },
  { code: "IAD", city: "Washington, DC", name: "Dulles", lat: 38.95, lng: -77.46 },
  { code: "SLC", city: "Salt Lake City, UT", name: "Salt Lake City Intl", lat: 40.79, lng: -111.98 },
  { code: "SAN", city: "San Diego, CA", name: "San Diego Intl", lat: 32.73, lng: -117.19 },
  { code: "TPA", city: "Tampa, FL", name: "Tampa Intl", lat: 27.98, lng: -82.53 },
  { code: "PDX", city: "Portland, OR", name: "Portland Intl", lat: 45.59, lng: -122.6 },
  { code: "BNA", city: "Nashville, TN", name: "Nashville Intl", lat: 36.12, lng: -86.68 },
  { code: "AUS", city: "Austin, TX", name: "Austin-Bergstrom", lat: 30.19, lng: -97.67 },
  { code: "SAT", city: "San Antonio, TX", name: "San Antonio Intl", lat: 29.53, lng: -98.47 },
  { code: "STL", city: "St. Louis, MO", name: "St. Louis Lambert", lat: 38.75, lng: -90.37 },
  { code: "MCI", city: "Kansas City, MO", name: "Kansas City Intl", lat: 39.3, lng: -94.71 },
  { code: "RDU", city: "Raleigh-Durham, NC", name: "Raleigh-Durham Intl", lat: 35.88, lng: -78.79 },
  { code: "SMF", city: "Sacramento, CA", name: "Sacramento Intl", lat: 38.7, lng: -121.59 },
  { code: "MSY", city: "New Orleans, LA", name: "Louis Armstrong", lat: 29.99, lng: -90.26 },
  { code: "IND", city: "Indianapolis, IN", name: "Indianapolis Intl", lat: 39.72, lng: -86.29 },
  { code: "CLE", city: "Cleveland, OH", name: "Cleveland Hopkins", lat: 41.41, lng: -81.85 },
  { code: "CMH", city: "Columbus, OH", name: "John Glenn Columbus", lat: 40.0, lng: -82.89 },
  { code: "PIT", city: "Pittsburgh, PA", name: "Pittsburgh Intl", lat: 40.49, lng: -80.23 },
  { code: "CVG", city: "Cincinnati, OH", name: "Cincinnati/N. Kentucky", lat: 39.05, lng: -84.66 },
  { code: "MKE", city: "Milwaukee, WI", name: "Milwaukee Mitchell", lat: 42.95, lng: -87.9 },
  { code: "JAX", city: "Jacksonville, FL", name: "Jacksonville Intl", lat: 30.49, lng: -81.69 },
  { code: "RSW", city: "Fort Myers, FL", name: "Southwest Florida Intl", lat: 26.54, lng: -81.76 },
  { code: "PBI", city: "West Palm Beach, FL", name: "Palm Beach Intl", lat: 26.68, lng: -80.1 },
  { code: "SNA", city: "Santa Ana, CA", name: "John Wayne (Orange County)", lat: 33.68, lng: -117.87 },
  { code: "BUR", city: "Burbank, CA", name: "Hollywood Burbank", lat: 34.2, lng: -118.36 },
  { code: "ONT", city: "Ontario, CA", name: "Ontario Intl", lat: 34.06, lng: -117.6 },
  { code: "LGB", city: "Long Beach, CA", name: "Long Beach", lat: 33.82, lng: -118.15 },
  { code: "HNL", city: "Honolulu, HI", name: "Daniel K. Inouye", lat: 21.32, lng: -157.92 },
  { code: "OGG", city: "Kahului, HI", name: "Kahului (Maui)", lat: 20.9, lng: -156.43 },
  { code: "KOA", city: "Kona, HI", name: "Ellison Onizuka Kona", lat: 19.74, lng: -156.05 },
  { code: "LIH", city: "Lihue, HI", name: "Lihue (Kauai)", lat: 21.98, lng: -159.34 },
  { code: "ANC", city: "Anchorage, AK", name: "Ted Stevens Anchorage", lat: 61.17, lng: -149.99 },
  { code: "ABQ", city: "Albuquerque, NM", name: "Albuquerque Sunport", lat: 35.04, lng: -106.61 },
  { code: "ELP", city: "El Paso, TX", name: "El Paso Intl", lat: 31.81, lng: -106.38 },
  { code: "TUS", city: "Tucson, AZ", name: "Tucson Intl", lat: 32.12, lng: -110.94 },
  { code: "OKC", city: "Oklahoma City, OK", name: "Will Rogers", lat: 35.39, lng: -97.6 },
  { code: "TUL", city: "Tulsa, OK", name: "Tulsa Intl", lat: 36.2, lng: -95.89 },
  { code: "OMA", city: "Omaha, NE", name: "Eppley Airfield", lat: 41.3, lng: -95.89 },
  { code: "MEM", city: "Memphis, TN", name: "Memphis Intl", lat: 35.04, lng: -89.98 },
  { code: "SDF", city: "Louisville, KY", name: "Louisville Muhammad Ali", lat: 38.17, lng: -85.74 },
  { code: "BHM", city: "Birmingham, AL", name: "Birmingham-Shuttlesworth", lat: 33.56, lng: -86.75 },
  { code: "RIC", city: "Richmond, VA", name: "Richmond Intl", lat: 37.51, lng: -77.32 },
  { code: "ORF", city: "Norfolk, VA", name: "Norfolk Intl", lat: 36.89, lng: -76.2 },
  { code: "CHS", city: "Charleston, SC", name: "Charleston Intl", lat: 32.9, lng: -80.04 },
  { code: "SAV", city: "Savannah, GA", name: "Savannah/Hilton Head", lat: 32.13, lng: -81.2 },
  { code: "GSP", city: "Greenville, SC", name: "Greenville-Spartanburg", lat: 34.9, lng: -82.22 },
  { code: "BDL", city: "Hartford, CT", name: "Bradley Intl", lat: 41.94, lng: -72.68 },
  { code: "PVD", city: "Providence, RI", name: "T.F. Green", lat: 41.72, lng: -71.43 },
  { code: "BUF", city: "Buffalo, NY", name: "Buffalo Niagara", lat: 42.94, lng: -78.73 },
  { code: "ALB", city: "Albany, NY", name: "Albany Intl", lat: 42.75, lng: -73.8 },
  { code: "DSM", city: "Des Moines, IA", name: "Des Moines Intl", lat: 41.53, lng: -93.66 },
  { code: "MSN", city: "Madison, WI", name: "Dane County Regional", lat: 43.14, lng: -89.34 },
  { code: "GRR", city: "Grand Rapids, MI", name: "Gerald R. Ford", lat: 42.88, lng: -85.52 },
  { code: "BOI", city: "Boise, ID", name: "Boise Airport", lat: 43.56, lng: -116.22 },
  { code: "RNO", city: "Reno, NV", name: "Reno-Tahoe", lat: 39.5, lng: -119.77 },
  { code: "SJU", city: "San Juan, PR", name: "Luis Muñoz Marín", lat: 18.44, lng: -66.0 },
  // Secondary airports often served by low-cost carriers
  { code: "ILG", city: "Wilmington, DE", name: "Wilmington (Greater Philly)", lat: 39.68, lng: -75.61 },
  { code: "HVN", city: "New Haven, CT", name: "Tweed-New Haven", lat: 41.26, lng: -72.89 },
  { code: "HGR", city: "Hagerstown, MD", name: "Hagerstown Regional", lat: 39.71, lng: -77.73 },
  { code: "ACY", city: "Atlantic City, NJ", name: "Atlantic City Intl", lat: 39.46, lng: -74.58 },
  { code: "TTN", city: "Trenton, NJ", name: "Trenton-Mercer", lat: 40.28, lng: -74.81 },
  { code: "ISP", city: "Islip, NY", name: "Long Island MacArthur", lat: 40.8, lng: -73.1 },
  { code: "HPN", city: "White Plains, NY", name: "Westchester County", lat: 41.07, lng: -73.71 },
  { code: "SWF", city: "Newburgh, NY", name: "New York Stewart", lat: 41.5, lng: -74.1 },
  { code: "MHT", city: "Manchester, NH", name: "Manchester-Boston Regional", lat: 42.93, lng: -71.44 },
  { code: "PSM", city: "Portsmouth, NH", name: "Portsmouth Intl at Pease", lat: 43.08, lng: -70.82 },
  { code: "PWM", city: "Portland, ME", name: "Portland Intl Jetport", lat: 43.65, lng: -70.31 },
  { code: "ORH", city: "Worcester, MA", name: "Worcester Regional", lat: 42.27, lng: -71.88 },
  { code: "SFB", city: "Sanford, FL", name: "Orlando Sanford", lat: 28.78, lng: -81.24 },
  { code: "PIE", city: "St. Petersburg, FL", name: "St. Pete-Clearwater", lat: 27.91, lng: -82.69 },
  { code: "LAL", city: "Lakeland, FL", name: "Lakeland Linder", lat: 27.99, lng: -82.02 },
  { code: "SRQ", city: "Sarasota, FL", name: "Sarasota-Bradenton", lat: 27.4, lng: -82.55 },
  { code: "PGD", city: "Punta Gorda, FL", name: "Punta Gorda", lat: 26.92, lng: -81.99 },
  { code: "MLB", city: "Melbourne, FL", name: "Melbourne Orlando Intl", lat: 28.1, lng: -80.65 },
  { code: "USA", city: "Concord, NC", name: "Concord-Padgett", lat: 35.39, lng: -80.71 },
  { code: "MYR", city: "Myrtle Beach, SC", name: "Myrtle Beach Intl", lat: 33.68, lng: -78.93 },
  { code: "AZA", city: "Mesa, AZ", name: "Phoenix-Mesa Gateway", lat: 33.31, lng: -111.66 },
  { code: "PVU", city: "Provo, UT", name: "Provo Airport", lat: 40.22, lng: -111.72 },
  { code: "BLI", city: "Bellingham, WA", name: "Bellingham Intl", lat: 48.79, lng: -122.54 },
];

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", missouri: "MO",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "puerto rico": "PR",
  "rhode island": "RI", "south carolina": "SC", tennessee: "TN", texas: "TX", utah: "UT", virginia: "VA",
  washington: "WA", "washington dc": "DC", "washington, dc": "DC", "d.c.": "DC", dc: "DC", wisconsin: "WI",
};

const EARTH_MI = 3958.8;
function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.sqrt(h));
}

/**
 * "San Juan" -> "SJU", "Chicago" -> "ORD,MDW", "Dallas, TX" -> "DFW,DAL", "Maryland" -> "BWI,HGR".
 * Free, no API call. Returns null when the text isn't a known city or state, so the caller falls
 * back to Google's airport lookup.
 */
export function airportsForCity(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
  if (!t || /^[a-z]{3}$/.test(t)) return null;
  const state = STATE_NAMES[t];
  // "Washington" alone means the state; "Washington, DC" / "DC" mean the city.
  const codes = state
    ? US_AIRPORTS.filter((a) => a.city.endsWith(`, ${state}`)).map((a) => a.code)
    : US_AIRPORTS.filter((a) => {
        const [cityPart, st = ""] = a.city.toLowerCase().split(", ");
        const names = [cityPart, ...cityPart.split("/")];
        return names.some((n) => t === n || t === `${n}, ${st}` || t === `${n} ${st}`);
      }).map((a) => a.code);
  return codes.length ? [...new Set(codes)].slice(0, 3).join(",") : null;
}

export const NEARBY_RADIUS_MI = 100;
export const MAX_ORIGIN_AIRPORTS = 6;

/**
 * Add airports within `radius` miles of the given ones (closest first), up to `max` total.
 * "BWI" -> "BWI,DCA,IAD,ILG,PHL". Google Flights searches them all in ONE request, so this
 * catches low-cost carriers at nearby secondary airports (e.g. Avelo from Wilmington, DE)
 * without costing extra searches. Unknown codes and Google place ids pass through unchanged.
 */
export function withNearbyAirports(ids: string, radius = NEARBY_RADIUS_MI, max = MAX_ORIGIN_AIRPORTS): string {
  const parts = ids.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.every((p) => /^[A-Za-z]{3}$/.test(p))) return ids;
  const codes = parts.map((p) => p.toUpperCase());
  const anchors = codes.map((c) => US_AIRPORTS.find((a) => a.code === c)).filter((a): a is Airport => !!a);
  if (!anchors.length) return codes.join(",");
  const nearby = US_AIRPORTS.filter((a) => !codes.includes(a.code))
    .map((a) => ({ code: a.code, miles: Math.min(...anchors.map((x) => milesBetween(x, a))) }))
    .filter((x) => x.miles <= radius)
    .sort((a, b) => a.miles - b.miles)
    .map((x) => x.code);
  return [...codes, ...nearby].slice(0, Math.max(max, codes.length)).join(",");
}

/** Miles from the first airport in `from` to airport `code` (for "From ILG · 62 mi" labels). */
export function milesFrom(from: string, code: string): number | null {
  const a = US_AIRPORTS.find((x) => x.code === from.split(",")[0]?.trim().toUpperCase());
  const b = US_AIRPORTS.find((x) => x.code === code.toUpperCase());
  return a && b ? Math.round(milesBetween(a, b)) : null;
}

export function airportLabel(code: string): string | null {
  const a = US_AIRPORTS.find((x) => x.code === code.trim().toUpperCase());
  return a ? `${a.city} · ${a.name}` : null;
}
