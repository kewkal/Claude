// Pure parsing/verification for the price check. No I/O, so every rule here is unit-tested.
import type { HotelOffer } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Google Hotels property details: one offer per booking site, cheapest whole-stay total first. */
export function parseHotelOffers(data: Raw): HotelOffer[] {
  const rows: Raw[] = [...(Array.isArray(data.featured_prices) ? data.featured_prices : []), ...(Array.isArray(data.prices) ? data.prices : [])];
  const bySeller = new Map<string, HotelOffer>();
  for (const r of rows) {
    const seller = str(r.source).trim();
    if (!seller) continue;
    const offer: HotelOffer = {
      seller,
      totalUsd: num(r.total_rate?.extracted_lowest),
      perNightUsd: num(r.rate_per_night?.extracted_lowest),
      link: str(r.link) || undefined,
      official: r.official === true,
      freeCancellation: r.free_cancellation === true || /free cancellation/i.test(JSON.stringify(r.rooms ?? "")),
    };
    if (offer.totalUsd === null && offer.perNightUsd === null) continue;
    const prev = bySeller.get(seller.toLowerCase());
    if (!prev || (offer.totalUsd ?? Infinity) < (prev.totalUsd ?? Infinity)) bySeller.set(seller.toLowerCase(), offer);
  }
  return [...bySeller.values()].sort((a, b) => (a.totalUsd ?? Infinity) - (b.totalUsd ?? Infinity));
}

/** Cheapest whole-stay total across booking sites, or null. */
export function cheapestOffer(offers: HotelOffer[]): HotelOffer | null {
  return offers.find((o) => o.totalUsd !== null) ?? null;
}

// ---------- money ----------

const SYMBOLS: [RegExp, string][] = [
  [/MX\$|MXN/i, "MXN"],
  [/C\$|CAD/i, "CAD"],
  [/A\$|AUD/i, "AUD"],
  [/R\$|BRL/i, "BRL"],
  [/NZ\$|NZD/i, "NZD"],
  [/€|EUR\b|euros?\b/i, "EUR"],
  [/£|GBP/i, "GBP"],
  [/¥|JPY|yen\b/i, "JPY"],
  [/₩|KRW/i, "KRW"],
  [/₹|INR/i, "INR"],
  [/CHF/i, "CHF"],
  [/฿|THB/i, "THB"],
  [/\bkr\b|SEK|NOK|DKK/i, "SEK"],
  [/US\$|USD|\$/i, "USD"],
];

/** "€10–15" -> { currency: EUR, amount: 15 } (upper end, like the budget). null when there's no currency or number. */
export function parseMoney(text: string): { currency: string; amount: number } | null {
  const s = text.replace(/(\d),(\d{3})/g, "$1$2");
  const hit = SYMBOLS.find(([re]) => re.test(s));
  if (!hit) return null;
  let currency = hit[1];
  if (currency === "SEK") {
    if (/NOK/i.test(s)) currency = "NOK";
    else if (/DKK/i.test(s)) currency = "DKK";
  }
  const nums = [...s.matchAll(/(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1])).filter((n) => n > 0 && n < 100000);
  if (!nums.length) return null;
  return { currency, amount: Math.max(...nums) };
}

const SIGN: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", KRW: "₩", INR: "₹", THB: "฿" };

/** { EUR, 10 } -> "€10"; unknown symbols fall back to "CHF 10". */
export function fmtMoney(m: { currency: string; amount: number }): string {
  const s = SIGN[m.currency];
  return s ? `${s}${m.amount}` : `${m.currency} ${m.amount}`;
}

/** True when the text says the place is free to enter. */
export function saysFree(text: string): boolean {
  return /\b(free admission|free entry|free to enter|admission is free|entry is free|no admission fee|free of charge)\b/i.test(text) || /^free$/i.test(text.trim());
}

/** Tripadvisor Place API: the lowest listed per-person price, as shown. */
export function parseTripadvisorPrice(data: Raw): { display: string; currency: string; amount: number } | null {
  const p: Raw = data.place_result ?? data;
  const cands: { display: string; amount: number | null }[] = [];
  if (str(p.price)) cands.push({ display: str(p.price), amount: num(p.extracted_price) });
  for (const o of Array.isArray(p.price_options) ? p.price_options : []) {
    if (str(o.price)) cands.push({ display: str(o.price), amount: num(o.extracted_price) });
  }
  for (const b of Array.isArray(p.age_bands) ? p.age_bands : []) {
    if (/adult/i.test(str(b.title) || str(b.name)) && str(b.price)) cands.push({ display: str(b.price), amount: num(b.extracted_price) });
  }
  const parsed = cands
    .map((c) => {
      const m = parseMoney(c.display);
      if (!m) return null;
      return { display: c.display, currency: m.currency, amount: c.amount ?? m.amount };
    })
    .filter((x): x is { display: string; currency: string; amount: number } => !!x && x.amount > 0);
  return parsed.sort((a, b) => a.amount - b.amount)[0] ?? null;
}

// ---------- website reads ----------

const PRICE_WORDS = /admission|ticket|entry|entrance|adult|general|price|fee|rate|tour|per person|pp\b|free/i;

/** The lines of a page that talk about prices (keeps the Claude call small). */
export function priceLines(markdown: string, maxChars = 1800): string {
  const lines = markdown
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 3 && l.length < 400 && PRICE_WORDS.test(l) && (parseMoney(l) !== null || saysFree(l)));
  let out = "";
  for (const l of [...new Set(lines)]) {
    if (out.length + l.length > maxChars) break;
    out += `${l}\n`;
  }
  return out.trim();
}

const squash = (s: string) => s.replace(/[*_`#>|\\]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Accept a website price only when the quote really is on the page AND the quote itself shows that
 * price (or says free). Returns the verified money, or null.
 */
export function verifyWebsitePrice(
  claim: { quote: string; amount: number | null; free: boolean },
  markdown: string,
): { currency: string; amount: number } | null {
  const q = squash(claim.quote);
  if (q.length < 4 || !squash(markdown).includes(q)) return null;
  if (claim.free) return saysFree(claim.quote) ? { currency: "USD", amount: 0 } : null;
  const m = parseMoney(claim.quote);
  if (!m || claim.amount === null) return null;
  const inQuote = [...claim.quote.replace(/(\d),(\d{3})/g, "$1$2").matchAll(/(\d+(?:\.\d{1,2})?)/g)].some((x) => Math.abs(Number(x[1]) - claim.amount!) < 0.01);
  return inQuote ? { currency: m.currency, amount: claim.amount } : null;
}

/** Does `name` (or a close form of it) appear in this text? Used to keep community picks grounded. */
export function mentions(text: string, name: string): boolean {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const t = ` ${norm(text)} `;
  const n = norm(name).replace(/^the /, "");
  if (n.length < 3) return false;
  return t.includes(` ${n} `) || t.includes(` ${n}s `);
}
