---
description: Rebuild leaderboard.md from every analyzed product's frontmatter
---

Rebuild `leaderboard.md` from the frontmatter of every file in `products/*.md`.

Sections, in this order:
1. **Run now** — verdict RUN, sorted by score (desc). Apply the tie-breaker from `rubric/scoring.md`.
2. **Test** — verdict TEST, sorted by score.
3. **Needs data** — verdict NEEDS DATA, with what's missing.
4. **In production / live** — status in-production or live, with date added.
5. **Winners** — status winner, with their results summary.
6. **Bench / Pass** — collapsed, one line each.
7. **Killed** — count only, plus the last 10 with gate + reason.

Each table row: Product (linked to its file) · Score · Rank-1 archetype · Price · Category · Date added · One-line why.

Put "Last updated: <today's date>" at the top. Then reply with the top 5 in chat.
