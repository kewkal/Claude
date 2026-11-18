# Kalodata Product Picker

Picks the best products found on Kalodata to run **organically on Instagram and Facebook Reels**, by putting each one through
our two SOPs and a scoring rubric.

## The source of truth
- `sops/hook-archetype-sop.md` — kill gate, mechanic/subject/enablers, the 10 hook archetypes, decision matrix.
- `sops/copy-framework-sop.md` — product intake, 3 core questions, headline rules, style rules, build order, checklist.
- `sops/originals/*.pdf` — the original documents. If a markdown SOP and its PDF disagree, the PDF wins; fix the markdown.
- `rubric/scoring.md` — how the SOPs turn into a 0–100 score and a verdict. `rubric/saturation.md` — live category modifiers.
- `docs/organic-ig-fb.md` — how the TikTok-derived SOP adapts to IG/FB (CTA, captions, audience).

**Always re-read the relevant SOP and rubric files before analyzing.** Don't score from memory.

## Input rule: AliExpress links (standing rule, set 2026-11-17)
**The user sends AliExpress listing links. That is the standard input.** They find proven products on Kalodata
(already $20–50k in sales) and send the AliExpress supplier link for each. Scrape every link with Firecrawl, following
`docs/aliexpress-scraping.md`. Don't ask for screenshots or pasted data unless a scrape fails completely.
Screenshots and pasted data still work as a fallback.

**Scrape settings (quick reference; full method in `docs/aliexpress-scraping.md`):**
- Links look like `a.aliexpress.com/_xxxx`, usually numbered and mixed with junk text. Pull out every link.
- Firecrawl: `formats:["query"]`, `proxy:"stealth"`, `waitFor:6000`, US location.
- If the body comes back empty, retry once on `https://www.aliexpress.us/item/<ID>.html` with `waitFor:9000`.
- The title is always in `ogTitle`. Budget ~5 credits per scrape.
- AliExpress blocks Firecrawl intermittently (4 of 10 full scrapes failed in batch 1). The built-in browser renders
  these pages reliably.

**Price traps:**
- A $0.99–$1.99 price with a $10–20 "original" is a new-user Welcome Deal, not your cost. Treat the real cost as roughly
  40–60% of the "original."
- Landed cost = real unit cost + shipping. G4 passes only if `3 × landed ≤ $25` (landed ≤ ~$8.30).

## Verify in the browser before any RUN (standing rule)
Before giving any product a RUN verdict, open the listing in the built-in browser: read the real price, look at the
gallery photos, and read the reviews. Title-only analysis is for triage only. This rule exists because title-only
analysis was wrong twice in batch 1 (see Lessons learned).

## Current focus (set 2026-11-17, until the user says otherwise)
Work only on: `hat-sweat-liners`, `electric-bbq-grill-brush`, `cob-magnetic-work-light`. All other products are parked.
Don't analyze, re-score, or suggest them unless the user asks. New batches of links are still fine to triage.

### Focus status (verified in the browser 2026-11-17)
| Product | Score | Verdict | Listing | The problem / the fix |
|---|---|---|---|---|
| COB Magnetic Work Light | 79 | **TEST**, strongest of the three | `_mNFLjsF` (item 3256810477733317, NEWBIRTH Light Store, 4.8★/11 reviews, 78 sold, $14.97 "original") | Soft payload (light, not filth); the "HOLD IT WHERE I'M WORKING!" dad meme has to carry it. Hook: #8 Intervention adapted, *"Go inside, sweetie. Dad — catch."* A $7.50 / 4.9★ / 1,000+ sold comparable supports the G4 pass. Order from this listing, not `_m0YhEwj` (same D92-red unit, worse reviews). |
| Hat Sweat Liners (10pk) | 84 → **64** | **BENCH** (this supplier) | `_mqTROaj` (item 3256812187846247, 3.7★/3 reviews, 51 sold, $11.94 "original") | Pads are **black foam** (hide the sweat, which kills the stained-liner extraction hook), and a review says it "doesn't absorb anything" (G3 risk). Fix: find a white/light, 4.5★+ disposable liner; then #8 Intervention (*"Do NOT put that on your head. Give it to me."*) scores ~84 again. |
| Electric BBQ Grill Brush | 84 → **KILL G4** (this supplier) | KILL | `_mM0m0Z1` (item 3256812843303392, FENUN Store, ships from US) | Costs **$40.01** (~$120 retail at 3x). Has **steel wire bristles**: never use a "no wire bristles" angle (G3). Revives only at ≤ $8.30 landed (related listings were $17–30, still fail). Hook is textbook #8 (*"Put the wire brush down. Right now."*). Grilling is off-season, so lead with gift-for-dad if it comes back. |

### Parked / killed (don't work on these unless asked)
- LED Work Light Bar (`_m0YhEwj`): 67, superseded by the COB light. Its "Big-1PC" variant is a 52cm bar with brightness complaints.
- Window Insulation Film (`_mLujMDt`): KILL G4 ($6.55 + $8.70 shipping = $15.25 landed). **Revivable** at landed ≤ $8.30;
  it has a real payload (the candle-flame draft test).
- KILL G1 (no visible payload): 4-in-1 Warming Tray (`_mNdWSGP`), Food Warmer Tray (`_mKSl9Rp`), Heated Car Seat
  Cushion (`_mLaW1MT`), Men's Winter Gloves (`_mKfOCTV`), Christmas Door Banner (`_mKHuAtZ`).

## Workflow
1. User sends AliExpress links (numbered list is fine, junk text around the links is fine).
2. `/triage <links>` — scrape, batch kill gate + quick score; most products die here.
3. `/analyze <product>` — full analysis → `products/<YYYY-MM-DD>-<slug>.md`.
4. `/leaderboard` — rebuild `leaderboard.md`.
5. `/copy <product>` — Reel script, on-screen text, captions, Higgsfield shot list for RUN/TEST products.
6. `/results <product> ...` — log performance after 10–14 days; calibrate the rubric.

## Rules
- **Kill gate first, always.** G1 visible payload, G2 sound-off in 3s, G3 claim honesty (amplification, not
  fabrication), G4 under $25 retail at 3x margin. If G1–G4 fails, stop. No scoring, no copy.
- **Verify in the browser before any RUN.** Title-only is triage only (see above).
- **G3 (claim honesty) is the one that costs money.** Be harsh. Nothing in a script may show more than the product really does.
- **Be blunt.** If a product is weak, say so. Don't manufacture enthusiasm.
- **Never invent Kalodata numbers.** If a metric isn't in the paste/screenshot, mark it unknown and use the rubric's
  "unknown" value.
- Product files must keep the frontmatter from `templates/product.md` so the leaderboard can be rebuilt.
- Don't change rubric weights without the user's OK. Log every change in `rubric/CHANGELOG.md`. Don't invent ad-hoc
  penalties.
- Product data comes from AliExpress pages scraped with Firecrawl (see `docs/aliexpress-scraping.md`). Kalodata data
  only comes from what the user tells us. By default, assume each product has proven sales ($20–50k).

## Lessons learned (batch 1, 2026-11-17)
- **6 of 10 proven $20–50k sellers failed the SOP.** They sell on search, gift or seasonal demand, not on a demo hook.
  High sales don't mean a product fits this hook format, which is why the kill gate comes first.
- **Title-only analysis was wrong twice** (black liners; a $40 brush with wire bristles). Verify in the browser before RUN.
- **AliExpress listings bundle different products as variants** (listing `_m0YhEwj` held both a 52cm bar and a
  handheld). Check which variant the specs actually describe.
- **AliExpress blocks Firecrawl intermittently** (4 of 10 full scrapes in batch 1). The built-in browser renders the
  pages reliably.

## Where this project lives
This folder is the Kalodata Product Picker, moved into the `kewkal/Claude` monorepo on 2026-11-18 from
`kewkal/kalodata-product-picker` (the original repo is kept as-is). Open Claude Code **in this folder** so the slash
commands in `.claude/commands/` load and the relative paths above resolve.
