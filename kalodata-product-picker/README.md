# Kalodata Product Picker

Find products on Kalodata → run them through the **Hook Archetype SOP** and the **Copy Framework** → get a ranked list of
what's worth making organic Instagram/Facebook Reels for, plus the script and captions for the winners.

This runs on Claude Code. Open this folder in Claude Code and use the slash commands below.

## Quick start
1. On Kalodata, screenshot a product page (or copy the details: name, price, revenue, units, growth, creators, videos).
2. Drop the screenshots in `inbox/`, or paste the details straight into chat.
3. Run:

| Command | What it does |
|---|---|
| `/triage` | Batch: kill gate + quick score for everything in `inbox/` (or a pasted list). Tells you which to analyze fully. |
| `/analyze <product>` | Full analysis: kill gate, top-3 hook archetypes, copy intake, 0–100 score, verdict. Saves to `products/`. |
| `/leaderboard` | Rebuilds `leaderboard.md`: RUN / TEST / NEEDS DATA / live / winners / killed. |
| `/copy <product>` | 30–40s Reel script on the Rank-1 archetype, on-screen text, IG + FB captions, Higgsfield shot list, checklist. |
| `/results <product> <numbers>` | Log shares/DM-sends/sales after 10–14 days → winner / iterate / kill, and calibrate the rubric. |

## How a product gets scored
1. **Kill gate** (Hook SOP §2): payload, sound-off clarity, claim honesty, under $25 at 3x margin. Any fail = dead.
2. **Score /100:** Hook potential 45 · Copy potential 30 · Kalodata market signal 15 · Organic IG/FB fit 10 · ± saturation.
3. **Verdict:** RUN (80+) · TEST (65–79) · BENCH (50–64) · PASS (<50) · KILL · NEEDS DATA.

Full details in [`rubric/scoring.md`](rubric/scoring.md). The weights are a first guess. Tune them once real results come in.

## Layout
```
CLAUDE.md                 instructions Claude follows every session
sops/                     the two SOPs (markdown + original PDFs)
rubric/                   scoring weights, saturation modifiers, changelog
docs/organic-ig-fb.md     how the TikTok-derived SOP adapts to IG/FB
templates/product.md      the per-product file format
.claude/commands/         the slash commands
inbox/                    drop Kalodata screenshots here
products/                 one file per analyzed product (+ assets/)
leaderboard.md            ranked list, rebuilt by /leaderboard
triage-log.md             record of every batch triaged
```

## Updating the SOPs
Edit the PDF version in your docs, export it into `sops/originals/`, and ask Claude to "re-sync the SOP markdown from
the PDF." Category saturation changes go in `rubric/saturation.md`.
