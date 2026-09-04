---
description: Run the morning sweep — overdue follow-ups, today's calls, and what needs doing
---

Run the morning sweep for ghl-mini. Use `sqlite3 data/ghl.db` directly.

1. **Overdue follow-ups** — leads whose `next_action_at` has passed and are not won, lost or do-not-call. Sort oldest first.
2. **Today's bookings** — with name, time, phone and the outcome of the last call with that lead.
3. **New onboarding responses** — anything with `status = 'new'`.
4. **Yesterday's numbers** — calls made, connect rate, bookings set.
5. **Agent runs** — anything that failed or is stuck running.

Finish with the three things that matter most today, ranked. Be blunt about what is being neglected.
