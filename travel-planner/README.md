# TripPlanner

Personal, single-user, mobile-first trip planner. It pulls real-time flights, hotels, places, events, and weather, then builds Lean / Balanced / Splurge day-by-day plans around your budget.

**Grounding rule:**
- Every fact shown comes from a source: Google Flights, Google Hotels, Google Maps, Tripadvisor, Google Events (via SerpApi), or Open-Meteo. Each fact links back to its source and shows when it was fetched.
- Claude only *schedules* items by reference ID, and the server strips any ID that isn't in the fetched data.
- All money math is done in code, never by the AI.
- AI-written text is always labeled **AI suggestion**.

## Stack

- Next.js 16 (App Router, `proxy.ts` gate) + TypeScript + Tailwind v4, on Vercel Hobby.
- Supabase free tier (Postgres), reached server-side over its REST API with plain `fetch`, so there's no client library.
- Runtime dependencies: `next`, `react`, `@anthropic-ai/sdk`, `leaflet` (maps on free OpenStreetMap tiles), `server-only`.

## Setup (about 15 minutes)

1. **Supabase.** Create a free project, then open **SQL Editor**, paste [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
   - The script is safe to re-run.
   - Row Level Security is on with no policies, so the public anon key can't touch anything.
2. **Keys.**
   - SerpApi: <https://serpapi.com/manage-api-key>
   - Anthropic: <https://platform.claude.com/settings/keys>. In the Claude Console, also set a monthly spend limit as a backstop.
3. **Env vars.** Copy `.env.example` to `.env.local` for local dev, and add the same vars in Vercel under **Project → Settings → Environment Variables**:

   | Var | Value |
   |---|---|
   | `APP_PASSWORD` | your login password |
   | `SESSION_SECRET` | `openssl rand -hex 32` |
   | `SERPAPI_API_KEY` | SerpApi key |
   | `SERPAPI_MONTHLY_QUOTA` | `250` on the free plan, `1000` on Starter |
   | `ANTHROPIC_API_KEY` | Anthropic key |
   | `ANTHROPIC_MODEL` | `claude-sonnet-5-5` (current Sonnet per platform.claude.com/docs models overview, 10/01/2026) |
   | `CLAUDE_MONTHLY_BUDGET_USD` | e.g. `15` |
   | `SUPABASE_URL` | Project Settings → API → Project URL |
   | `SUPABASE_SECRET_KEY` | Project Settings → API keys → **secret** key (`sb_secret_…`) or the legacy `service_role` key |
   | `CRON_SECRET` | any random string. Vercel Cron sends it to `/api/cron/keepalive` daily so the free Supabase project never pauses. |

4. **Run locally.**
   ```bash
   cd travel-planner
   npm install
   npm run dev            # http://localhost:3000
   ```
   - With no `SUPABASE_*` vars, local dev falls back to an in-memory store, and the Settings page warns you.
   - For UI work that uses no quota at all, set `DATA_MODE=fixtures`. A yellow **FIXTURE MODE** banner then shows on every page, and all data is sample data.
5. **Deploy to Vercel.**
   - Import the GitHub repo and set **Root Directory** to `travel-planner`.
   - Add the env vars from step 3 and deploy.
   - The cron in `vercel.json` registers automatically.

## Checks

```bash
npm test               # 69 tests, all on saved fixtures. fetch is stubbed to throw, so tests can't reach the network.
npm run typecheck
npm run lint
npm run build && npm run check:bundle   # proves no secrets reach the browser (see below)
npm run live-check -- --yes flights     # ONE approved live SerpApi call (uses 1 search)
```

### How "no API keys in the client bundle" is verified

1. Every module that reads a secret imports `server-only`. If a client component ever imports one, the build fails.
2. `src/` has no `NEXT_PUBLIC_` variables. The check script fails if one appears.
3. `scripts/check-client-bundle.mjs` scans every file in `.next/static` (everything a browser can download) for:
   - the actual values of each secret env var set at build time;
   - the `sk-ant-` and `sb_secret_` key prefixes;
   - server-only endpoints (`serpapi.com/search`, `api.anthropic.com`, `/rest/v1`).

On 10/01/2026, the build was done with canary values for all 7 secrets. Result: **PASS** on 30 client files. A planted fake key was correctly flagged (negative control).

## Quota and cost control

- **One gate.** Every SerpApi request goes through `src/lib/serpapi/client.ts` in this order: normalize params → Supabase cache lookup → quota gate → fetch → cache write → usage log. Identical concurrent requests share one paid search.
- **Cache lifetimes:**

  | Data | TTL |
  |---|---|
  | Flights | 30 min |
  | Hotels | 6 hrs |
  | Places, reviews, photos, directions, Tripadvisor | 7 days |
  | YouTube | 7 days |
  | Events | 24 hrs |
  | Airport lookup | 30 days |
  | Open-Meteo (free) | 3 hrs forecast, 30 days history |

- **Quota meter** (Settings page):
  - Warns at 80% and stops new paid calls at 100%. Cached results keep working.
  - **Override** allows calls until the end of the month, and each over-quota call asks you to confirm.
  - "Sync with SerpApi" pulls SerpApi's own billing-cycle count through the free Account API.
- **Claude spend** is calculated from the token counts on each response. Sonnet 5.5: $2 per million input tokens, $10 per million output tokens.
- **Lazy loading:**
  - Reviews, photos, videos, popular times, return flights, booking options, and live directions are fetched only when you open or ask for them.
  - The planner shows its search count before it spends anything.

### Paid calls per action

| Action | SerpApi searches (first time; repeats are cached) | Claude calls |
|---|---|---|
| Flight search | 1 (+1 to see return flights, +1 for booking sellers) | – |
| ±3-day flex check | up to 7 | – |
| Hotel search | 1 (+1 reviews when opened, +1 "more photos") | – |
| Explore a category | 1–2 (Google Maps + Tripadvisor, shared across categories) | – |
| Open a place | up to 4 (Google reviews, Tripadvisor reviews, photos, YouTube) | – |
| Build a trip (1 destination, fixed dates) | about 10 | 3 |
| Flexible dates | +up to 7 | – |
| Compare N destinations | about 10 each | 0 until you pick one |
| Regenerate one day | 0 | 1 |
| Upgrades | 0 rule-based; Claude ideas 1 | 0–1 |
| Live travel times for a day | 1 per leg | – |

### Monthly cost estimate (as of 10/01/2026)

| Item | Dev | Production |
|---|---|---|
| SerpApi | Free plan (250 searches): $0 | Starter (1,000 searches): **$25** |
| Claude Sonnet 5.5 | about $1–3 | about **$5–10**. Roughly $0.20–0.35 per 3-version plan (~5k input + ~6k output/thinking tokens per call), ~20–25 plans/mo plus day regenerations and upgrade ideas. |
| Supabase free | $0 | $0 (daily keep-alive cron prevents pausing) |
| Vercel Hobby | $0 | $0 |
| **Total** | **≈ $1–3** | **≈ $30–35**, under the $50 cap |

1,000 searches is enough for about 60 fresh single-destination plans a month, or about 35 plans plus regular Explore use.

## Data notes and assumptions to confirm on the first live call

Run `npm run live-check -- --yes flights` and compare the result against Google Flights. Things to confirm:

- **Flight prices.** Google Flights' `price` is treated as the **total for all travelers**. Per-person = total ÷ (adults + children + infants in seat). The live-check output prints the number to compare.
- **Basic economy, carry-on limits, and self-transfer** are detected from Google's text labels, so they appear only "when detectable."
- **Budget vs. full-service airline** comes from a carrier list in `src/lib/flights/carriers.ts`, because Google doesn't label carrier type. Mixed itineraries show "Part budget."
- **Hotel tiers** come from price terciles within each search. Star class overrides that: 5★ is always Luxury, 1–2★ always Budget. The rule is shown in a tooltip.
- **Food and local transport** are your Settings assumptions, always labeled **Estimate**. Activity costs use listed USD prices only. Non-USD or missing prices show **"Price not listed"** and count as $0, and those items are listed under the cost table.
- **Travel times** are labeled **est.** (straight-line × 1.3; walking at 3 mph up to 1 mile, otherwise driving at 18 mph + 8 min). Tap **Live time(s)** for Google Maps Directions.
- **Weather** comes from the Open-Meteo forecast when the trip is within 16 days. Otherwise it's a 5-year historical average for the same dates, labeled as such.

## Project layout

```
src/proxy.ts                  password gate (everything except /login, /share/*, cron)
src/lib/serpapi/              cached + metered SerpApi client
src/lib/{flights,hotels,places}/  normalizers (pure) + services (server-only)
src/lib/planner/              dataset builder, budget engine, prompt, validator, trips store
src/lib/upgrades/             rule-based upgrade engine + validated Claude ideas
src/lib/claude.ts             structured-output call, refusal fallback, cost logging
src/app/(app)/                Plan, Flights, Hotels, Explore, Saved, Settings, trip pages
src/app/share/[token]         public read-only snapshot (makes no API calls)
fixtures/                     saved SerpApi + Open-Meteo JSON used by tests and DATA_MODE=fixtures
supabase/schema.sql           tables, RLS, cache purge function
```
