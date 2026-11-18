# Scraping AliExpress links with Firecrawl

Learned on 2026-11-17 from the first batch of 10 links.

## Method
1. **Pull every `https://a.aliexpress.com/_xxxx` short link** out of the user's message. Ignore the surrounding text
   ("I just found this on AliExpress:", names, timestamps).
2. **First pass: scrape the short link** with Firecrawl `formats: ["query"]`, `proxy: "stealth"`, `waitFor: 6000`,
   `location: {country: "US"}`, and this query prompt:
   > Return: product title; current sale price and original price in USD (and price range across variants); variant names;
   > key specs and features from the description/specifications; number sold/orders; star rating and review count; up to 5
   > short review snippets (especially complaints); shipping cost to US. Say 'not shown' for anything missing.
3. **The title is always in the metadata** (`ogTitle`) even when the page body comes back empty. The resolved URL holds
   the item ID: `aliexpress.us/item/<ID>.html`.
4. **If the body came back empty, retry once on the direct URL** `https://www.aliexpress.us/item/<ID>.html` with
   `waitFor: 9000`. Don't retry more than once per link: AliExpress blocks intermittently, and each stealth scrape
   costs about 5 credits.
5. **If it's still empty, analyze from the title.** That's enough for the hook and copy analysis. Mark price as
   `not scraped` and estimate G4 from comparable products (see the rubric).

Don't use plain `markdown` format. AliExpress renders client-side, and markdown returns only the nav bar. No Alexandria
provider covers AliExpress (checked 2026-11-17).

## Verify in the browser before calling anything RUN
Learned 2026-11-17: two products analyzed from the title alone were badly wrong. One supplier's liner was black, not
white, and had a "doesn't absorb" review. The grill brush cost $40, not ~$8, and had wire bristles. **Before a product
gets RUN, open the listing in the built-in browser** (it renders pages Firecrawl can't), read the price, look at the
gallery photos, and read the reviews. Title-only analysis is fine for triage, never for a final verdict.

## Reading the price
- **Prices like $0.99–$1.99 with an "original" of $10–20 are usually Welcome Deal / new-user prices.** That's not your
  real restock cost. Treat the real cost as roughly 40–60% of the "original" price unless the user says otherwise.
- **Add shipping.** "Free shipping" is common. When shipping is listed (e.g. $8.70), it counts toward landed cost for G4.
- G4 test with landed cost `L`: pass if `3 × L ≤ $25`, i.e. landed cost ≤ ~$8.30.

## Cost
About 5 credits per stealth scrape, so roughly 5–10 credits per link including a retry. A 10-link batch is about
60–90 credits.
