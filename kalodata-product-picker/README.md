# Kalodata Product Picker

Find products on Kalodata → run them through the **Hook Archetype SOP** and the **Copy Framework** → get a ranked list of
what's worth making organic Instagram/Facebook Reels for, plus the script and captions for the winners.

This runs on Claude Code. Open this folder in Claude Code and use the slash commands below.

> Moved here from `kewkal/kalodata-product-picker` on 2026-11-18 (the original repo is kept as-is). Open Claude Code in
> this folder, not the repo root, so the slash commands load.

## Quick start
1. On Kalodata, find products already proven at $20–50k in sales.
2. For each one, grab the **AliExpress supplier link** (`a.aliexpress.com/_xxxx`).
3. Paste the links into chat. A numbered list is fine, and junk text around the links is fine. Claude scrapes each
   listing with Firecrawl (method in [`docs/aliexpress-scraping.md`](docs/aliexpress-scraping.md)). You don't need
   screenshots. They're only a fallback if a scrape fails completely: drop them in `inbox/` or paste the details.
4. Run:

| Command | What it does |
|---|---|
| `/triage <links>` | Batch: scrape every link, kill gate + quick score, ranked. Most products die here. Tells you which to analyze fully. |
| `/analyze <link or slug>` | Full analysis: kill gate, top-3 hook archetypes, copy intake, 0–100 score, verdict. Saves to `products/`. |
| `/leaderboard` | Rebuilds `leaderboard.md`: RUN / TEST / NEEDS DATA / live / winners / killed. |
| `/copy <product>` | 30–40s Reel script on the Rank-1 archetype, on-screen text, IG + FB captions, Higgsfield shot list, checklist. |
| `/results <product> <numbers>` | Log shares/DM-sends/sales after 10–14 days → winner / iterate / kill, and calibrate the rubric. |

## How a product gets scored
1. **Kill gate** (Hook SOP §2): payload, sound-off clarity, claim honesty, under $25 at 3x margin. Any fail = dead.
2. **Score /100:** Hook potential 45 · Copy potential 30 · Kalodata market signal 15 · Organic IG/FB fit 10 · ± saturation.
3. **Verdict:** RUN (80+) · TEST (65–79) · BENCH (50–64) · PASS (<50) · KILL · NEEDS DATA.
4. **Before any RUN:** open the listing in the browser and check the real price, the gallery photos and the reviews.
   Title-only analysis is for triage only. It was wrong twice in batch 1.

**Price trap:** a $0.99–$1.99 price next to a $10–20 "original" is a new-user Welcome Deal. Treat the real cost as
roughly 40–60% of the "original," add shipping, and G4 passes only if landed cost ≤ ~$8.30 (`3 × landed ≤ $25`).

Full details in [`rubric/scoring.md`](rubric/scoring.md). The weights are a first guess. Tune them once real results come in.

## Layout
```
CLAUDE.md                 instructions Claude follows every session
sops/                     the two SOPs (markdown + original PDFs)
rubric/                   scoring weights, saturation modifiers, changelog
docs/organic-ig-fb.md     how the TikTok-derived SOP adapts to IG/FB
docs/aliexpress-scraping.md  how to scrape AliExpress links, price traps, browser check
templates/product.md      the per-product file format
.claude/commands/         the slash commands
inbox/                    fallback only: screenshots if a scrape fails
products/                 one file per analyzed product (+ assets/)
leaderboard.md            ranked list, rebuilt by /leaderboard
triage-log.md             record of every batch triaged
```

## Updating the SOPs
Edit the PDF version in your docs, export it into `sops/originals/`, and ask Claude to "re-sync the SOP markdown from
the PDF." Category saturation changes go in `rubric/saturation.md`.
