---
description: Full SOP analysis of one product (AliExpress link, or an existing product slug) → kill gate, archetype ranking, copy intake, score, verdict
argument-hint: [AliExpress link or product slug]
---

Analyze one product for organic Instagram/Facebook Reels using our two SOPs.

Product input: $ARGUMENTS
If it's an AliExpress link, scrape it per `docs/aliexpress-scraping.md`. If it's a slug, read the existing file in `products/`
and deepen it. Screenshots in `inbox/` are a fallback.

## Do this, in order

1. **Read the rules first** (every time, don't work from memory):
   - `sops/hook-archetype-sop.md`
   - `sops/copy-framework-sop.md`
   - `rubric/scoring.md` and `rubric/saturation.md`

2. **Extract the data.** Pull everything usable from the paste/screenshots: name, what it does, retail price, landed cost
   (if given), revenue, units, growth, creators, videos, commission, category. Write down what's **missing** — don't invent numbers.
   If landed cost is missing, estimate margin only if the user gave a supplier price; otherwise G4 = UNKNOWN.

3. **Kill Gate (G1–G5).** Be harsh on G3. If G1–G4 fails: verdict KILL, score 0, write the one-line reason, skip to step 7.

4. **Hook classification** — follow the SOP Section 5 output format exactly: mechanic, subject, enablers, surface count with
   the list, Rank 1/2/3 archetypes (Rank 1 with cast, hook line, money shot, montage), DO NOT USE, BIGGEST RISK.
   Use the Section 4 decision matrix. On ties, default to #8 The Intervention.

5. **Copy intake** — answer the Copy Framework Section 1 customer questions and the 3 core questions. Draft the single best
   headline and run it through the 4-question Headline Test.

6. **Score** with `rubric/scoring.md`, line by line, with a short note per line. Apply the saturation modifier. Assign the verdict.

7. **Save** the result as `products/<YYYY-MM-DD>-<slug>.md` using `templates/product.md` (fill in the frontmatter, so the
   leaderboard can read it). Move any screenshots used from `inbox/` into `products/assets/<slug>/` and link them.

8. **Update `leaderboard.md`** (same logic as `/leaderboard`).

9. **Reply** with: verdict + score, the one-line why, the Rank-1 archetype and hook line, the biggest risk, and the missing
   data that would change the score. Keep it short — the details are in the file.

## Tone
Blunt. The SOP says: if the product is weak, say it's weak. Don't manufacture enthusiasm.
