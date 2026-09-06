# B2B Lead Scraper

Asynchronous B2B lead discovery and website enrichment. Finds businesses in a vertical and location, crawls a handful of pages on each business website, extracts prospecting data, de-duplicates, and streams results into a timestamped CSV.

The governing principle is **null over questionable**. The extractor will leave a field empty rather than guess: no invented owner names, no email addresses constructed from a person's name and a domain, no revenue figures conjured from a slick website.

---

## Setup

Requires Node.js 20.11 or newer.

```bash
cd lead-scraper
npm install
npx playwright install chromium   # only needed if Chromium isn't already present
```

## Running

```bash
npm run scrape -- --vertical "HVAC Contractors" --location "Houston, TX" --limit 100 --concurrency 4
```

Your four targets:

```bash
npm run scrape -- --vertical "HVAC Contractors" --location "Houston, TX" --limit 100 --concurrency 4
npm run scrape -- --vertical "HVAC Contractors" --location "Dallas, TX"  --limit 100 --concurrency 4
npm run scrape -- --vertical "Dental Practices" --location "Houston, TX" --limit 100 --concurrency 4
npm run scrape -- --vertical "Dental Practices" --location "Dallas, TX"  --limit 100 --concurrency 4
```

### Flags

| Flag | Default | Notes |
|---|---|---|
| `--vertical` | *required* | e.g. `"HVAC Contractors"` |
| `--location` | *required* | e.g. `"Houston, TX"` |
| `--limit` | `100` | maximum businesses processed |
| `--concurrency` | `3` | businesses enriched in parallel (1–20) |
| `--headless` | `true` | `--headless false` to watch the browser |
| `--max-pages-per-site` | `6` | pages crawled per business website (1–50) |
| `--source` | `auto` | `auto`, `overpass`, `google-places`, `fixture` |
| `--output-dir` | `output` | where the CSV lands |
| `--include-seen` | off | re-scrape businesses previous runs already produced |
| `--ledger` | `<output-dir>/.lead-ledger.jsonl` | where cross-run lead memory lives |
| `--debug` | off | verbose diagnostics on stderr |

All inputs are validated before any network call is made.

`SIGINT`/`SIGTERM` stops scheduling new work, lets in-flight leads finish, flushes the CSV and prints the summary. A second interrupt exits immediately.

---

## Discovery sources

Discovery sits behind a `SourceAdapter` interface, so adding another permitted directory means adding one file in `src/sources/` — the enrichment pipeline never changes.

**OpenStreetMap / Overpass** (default, no key). Genuinely open data, automated querying is permitted, no bot defences. OSM carries **no ratings**, so `reviews` is always empty on this source, and roughly half of records publish a website or phone.

**Google Places API v1** (optional). Set `GOOGLE_PLACES_API_KEY` and `auto` uses it instead. This is the official documented API, not scraped Maps HTML, and it is the **only** source that populates `reviews`.

```bash
export GOOGLE_PLACES_API_KEY="..."
npm run scrape -- --vertical "Dental Practices" --location "Dallas, TX"
```

**Fixture** (`--source fixture`). Reads a local JSON manifest; used by the smoke test and for offline development.

Google Maps and Yelp HTML scraping is deliberately **not** implemented: it violates their terms and is CAPTCHA-walled, and defeating access controls is out of scope by design. If a target blocks automated access the failure is recorded and the run continues.

---

## Output

`output/leads-<vertical-slug>-<location-slug>-<YYYYMMDD-HHmmss>.csv`, written incrementally as each lead finishes, so an interrupted run still leaves usable rows on disk.

| Column | Notes |
|---|---|
| `business_name` | as published |
| `website` | canonical URL after redirects |
| `phone` | E.164 where parseable; international numbers preserved |
| `services_provided` | JSON array of specific services |
| `reviews` | `{"rating":4.8,"count":127}`, Google Places only |
| `instagram_url` / `facebook_url` / `linkedin_url` | business profiles only |
| `owner_name` | only with an explicit qualifying title |
| `owner_email` | owner's own published address, else a general company inbox |
| `estimated_revenue` | conservative bracket, or empty |

`null` is written as an empty field.

---

## Cross-run memory

Runs remember what they produced. Every lead written to a CSV has its dedupe keys appended to `output/.lead-ledger.jsonl`, and later runs skip anything already in there — so running the same vertical and location twice gives you the *new* businesses, not the same list again.

```
[LEDGER] 84 lead(s) remembered from previous runs (output\.lead-ledger.jsonl)
[DISCOVERY] Found 91 candidate businesses (7 to process, 0 duplicate, 84 previously seen)
```

The summary reports in-run duplicates and previously-seen leads separately, because they mean different things: lots of `duplicate` means the source returned redundant records, lots of `previously seen` means the memory is doing its job.

Memory is **global** — one ledger across every vertical and location. A firm surfaced by a Houston run is skipped by the Dallas run, which is what you want when the output feeds outreach: one business, one contact.

- **Re-scrape everything anyway:** `--include-seen`
- **Separate memories per campaign:** `--ledger output\hvac-ledger.jsonl`
- **Start over:** delete `output\.lead-ledger.jsonl`

A lead is recorded only once its CSV row is written, so a run interrupted halfway leaves the rest eligible next time.

---

## How enrichment works

**Crawling** is a hybrid. Plain HTTP + Cheerio handles ordinary business sites; Playwright is used only when the HTTP response comes back looking like an unrendered SPA shell. One browser is shared across the whole run with an isolated context per page — a run of server-rendered sites never launches Chromium at all.

Pages are scored by URL and anchor text (`about`, `team`, `leadership`, `contact`, `services`, `what-we-do`, …), capped at `--max-pages-per-site`, restricted to the same registrable domain, and filtered against blog archives, privacy/terms pages, carts, logins, calendars and document archives. `robots.txt` is fetched and honoured, including `Crawl-delay`.

**Extraction** prefers structured data (JSON-LD, `sameAs`, `hasOfferCatalog`) over explicit HTML relationships, and explicit relationships over loose text.

- **Emails** come from `mailto:` links, JSON-LD, then page text including obfuscations like `office [at] example [dot] com`. Syntax is validated. Addresses are never constructed.
- **Owner** requires a name **plus** a qualifying title (`Founder`, `Owner`, `President`, `CEO`, `Founded by …`). "Office Manager" and "Associate Dentist" explicitly disqualify. Appearing on a team page is not evidence of ownership.
- **Owner email** prefers an address demonstrably belonging to the identified owner; otherwise a general inbox (`info@`, `office@`) is used and internally flagged as generic.
- **Services** come from structured data, service containers, service-page headings and service navigation, filtered against marketing filler (`Quality Solutions`, `Serving Austin`) and against staff names in team cards.

**Revenue** is a separate module that only sees deterministic signals: a published revenue figure, an explicit headcount times a configurable revenue-per-employee factor, or several operating locations times a conservative floor. It cannot see review counts, ad copy or site quality. Employee-derived figures are treated as a range and rounded down when they straddle a bracket boundary. Weak evidence returns null, and the evidence used is retained for `--debug` logging.

Tuning lives in `src/config.ts`: keyword lists, blacklists, revenue factors, OSM tag mappings, timeouts and pacing.

---

## Resilience

Bounded concurrency via `p-limit`, plus a per-host pacer enforcing a minimum gap between requests (raised by `Crawl-delay` or a `429`). Request and navigation timeouts. Bounded retries with exponential backoff and jitter, honouring `Retry-After`. `404`/`403` are permanent and never retried; CAPTCHA/access-control pages abandon the host rather than looping. One failing business never ends the run — it still produces a row from discovery data.

---

## Development

```bash
npm run typecheck   # tsc, strict
npm run lint        # eslint, type-aware, no-floating-promises
npm test            # vitest
npm run smoke       # end-to-end against a local fixture site
npm run build       # emit to dist/
```

`npm run smoke` boots a static server on loopback, runs the real CLI against it through the fixture adapter, and asserts the CSV's filename, headers, de-duplication, extraction and null-handling. It needs no internet access.

### Layout

```
src/
  index.ts                       CLI parsing, validation, signals
  scraper.ts                     orchestration, dedupe, summary
  config.ts                      all tunables and word lists
  types/lead.ts                  domain types and the CSV contract
  sources/                       sourceAdapter.ts + overpass / googlePlaces / fixture
  enrichment/                    siteCrawler.ts, websiteEnricher.ts, revenueEstimator.ts
  parsers/htmlParser.ts          all HTML -> data extraction (pure)
  utils/                         http, browser, csvWriter, normalise, concurrency, logger
tests/                           unit tests, HTML fixtures, e2e smoke harness
output/                          generated CSVs (git-ignored)
```

---

## Known limitations

- **Coverage depends on the source.** OSM publishes a website for roughly half its business records; no website means a discovery-only row.
- **`reviews` needs a Google Places key.** OSM has no ratings and none are invented.
- **`estimated_revenue` will be empty for most small businesses.** Few publish headcount or revenue. That is the honest answer, not a bug — loosening it would mean fabricating numbers.
- **Only public company LinkedIn pages are captured.** Personal `/in/` profiles are rejected as they are not the business.
- **Deduplication is conservative.** Separate branches of a chain stay separate rows unless they share a domain or phone line.
- **Cross-run memory has no expiry.** A lead scraped a year ago is still skipped. Enrichment data does rot, so a "refresh anything older than N days" flag is the natural next feature; for now, `--include-seen` re-scrapes everything.
- **Some sites will refuse automation.** Those are recorded as failures; no evasion is attempted.
- **No live external run has been performed from the development container** — its egress is restricted to package registries, so every host returns 403. Unit tests and the local end-to-end smoke test both pass; validate against real sites on a machine with normal network access.
