---
description: Triage a batch of AliExpress links (the standard input) — scrape, kill gate + quick score, ranked
argument-hint: [AliExpress links, any format]
---

Triage a batch of products so we only spend full analysis time on the best ones.

Input: $ARGUMENTS
These are normally AliExpress links (`a.aliexpress.com/_xxxx`). If there are none, fall back to screenshots and text in `inbox/`.

1. Read `sops/hook-archetype-sop.md` (Sections 1, 2, 4), `rubric/scoring.md`, `rubric/saturation.md`, and
   `docs/aliexpress-scraping.md`.
2. Scrape every link per `docs/aliexpress-scraping.md` (run them in parallel). For each one, collect the title, what it does,
   price, shipping, specs, orders, rating, and reviews. Assume proven $20–50k sales unless the user says otherwise.
3. Run the Kill Gate (G1–G4). Killed products get one line: `KILL — [gate], [reason]`.
4. For survivors, do a **quick score** — same rubric, but estimate each block without writing full copy or shot lists.
   Mark it as `quick` so nobody confuses it with a full analysis.
5. Output one ranked table:

   | # | Product | Price | Gate | Rank-1 archetype | Quick score | Verdict | Why (one line) |

   Then a short list: "**Run full /analyze on:**" the top 3 non-killed products (or fewer if fewer deserve it).
6. Append the batch to `triage-log.md` (create it if missing) with today's date, so we have a record of what we looked at and killed.
   Don't create product files for triaged items — that's what `/analyze` is for.
7. Leave screenshots in `inbox/` so `/analyze` can use them.

Be blunt and fast. Most products should die here.
