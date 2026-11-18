---
description: Log a live product's IG/FB performance after the 10–14 day window, decide keep/kill, and check rubric calibration
argument-hint: [product slug] [views, shares, DM-sends, saves, sales...]
---

Log results for: $ARGUMENTS

1. Find the product file in `products/`. Fill in `## Results` with date, platform(s), days live, views, **shares**,
   **DM-sends**, saves, comments, link clicks, sales — whatever the user gave. The SOP metric is shares + DM-sends, not likes.
2. Apply the SOP kill rule: 10–14 days, no exceptions. Recommend one of: **winner** (scale — more archetype variants,
   re-skins), **iterate** (try the Rank-2 hook once), or **killed**. Update `status` in the frontmatter.
3. Count products with results. If there are 5 or more, compare each one's predicted score with its actual
   shares + DM-sends and say which rubric criteria look over- or under-weighted. **Suggest** weight changes — don't change
   `rubric/scoring.md` without the user saying yes. If they agree, log the change in `rubric/CHANGELOG.md`.
4. Rebuild `leaderboard.md`.
