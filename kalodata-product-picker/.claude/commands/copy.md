---
description: Write the full organic IG/FB content package for an analyzed product — Reel script on the Rank-1 archetype, on-screen text, caption, and Higgsfield shot list
argument-hint: [product slug or name]
---

Build the content package for: $ARGUMENTS

1. Find the product file in `products/` (match by slug or name). If it doesn't exist or its verdict is KILL/PASS, say so and
   stop — don't write copy for products that failed. For BENCH, ask first.
2. Read `sops/hook-archetype-sop.md` (the Rank-1 archetype card + universal skeleton + rules), `sops/copy-framework-sop.md`
   (all of it), and `docs/organic-ig-fb.md`.
3. Write into the product file's `## 5. Content package` section:

   **A. Reel script (30–40s)** — beat by beat using the universal skeleton, with timestamps and % of runtime:
   HOOK (diegetic dialogue, two people, physical escalation, old way failing in frame) → MONEY SHOT (one continuous
   motion, no cut, state duration) → WITNESS BEAT → MONTAGE (3–7 contexts, escalating, ~3s each, **VO starts here**)
   → CTA. Mark the audio switch. Pick VO gender per SOP.

   **B. Voiceover copy** — follows Copy Framework style rules: small words, fragments, conjunction starts, specific about
   the problem, facts over fluff, one CTA.

   **C. On-screen text** — the opening text overlay must work as a headline (pass the 4-question Headline Test) and work
   sound-off. Give 3 options.

   **D. Caption** — Copy Framework build order compressed for a caption: headline line → problem → tease → reveal →
   3 feature→benefit bullets → proof → offer → one CTA → P.S. Write one for Instagram and one for Facebook (see
   `docs/organic-ig-fb.md` for the differences).

   **E. Higgsfield shot list** — one prompt per beat (setting, cast, action, camera, duration). Note the trend-stack slot if
   the archetype is #3.

   **F. Rank-2 alt hook** — just the hook beat + hook line, for an A/B test.

4. Run the Copy Framework **Pre-Publish Checklist** (Section 8) against B–D and show it with ✅/❌. Fix anything that fails
   before you finish. Re-check every claim against G3 — nothing in the script may show more than the product really does.
5. Set the product's `status` to `in-production`.
6. Reply with the on-screen text options, the hook line, and the checklist result. The full package is in the file.
