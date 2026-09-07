# ghl-mini

A self-hosted mini CRM: leads, dialer, scripts, calendar, onboarding forms and six agents.
Zero npm dependencies. Node 22.5+ only, using built-in `node:sqlite` and `node:http`.

## Running it

```bash
node server/index.js     # http://localhost:4000
npm run dev              # same, with --watch
npm run seed             # starter scripts, hours and demo leads
npm run reset            # wipe the database and re-seed
```

## Layout

| Path | What's in it |
|---|---|
| `server/index.js` | HTTP server, routing, public pages, auth gate |
| `server/lib/db.js` | SQLite connection, schema, `all` / `get` / `run` / `tx` |
| `server/lib/agents.js` | The six agent definitions and the run queue |
| `server/lib/scheduler.js` | The every-minute tick that drives all automations |
| `server/lib/automations.js` | The four automations plus the sequence engine |
| `server/lib/messaging.js` | SMS send/receive, opt-out, quiet hours, token rendering |
| `server/api/webhooks.js` | Twilio voice and SMS webhooks, signature-verified |
| `server/lib/maps.js` | Google Places scraping and lead scoring |
| `server/lib/sitescan.js` | Reads a lead's website: ad pixels, analytics, platform, mobile |
| `server/lib/chains.js` | Franchise and chain detection: brands, multi-location, shared domains |
| `server/lib/owner.js` | Works out who owns the business, from site, name, email, reviews |
| `server/lib/version.js` | Notices when the code on disk is newer than the running process |
| `server/lib/telephony.js` | Twilio calls and SMS |
| `server/lib/email.js` | Resend / Mailgun / Postmark over HTTP |
| `server/api/*.js` | One router per surface |
| `web/assets/views/*.js` | One view per screen, vanilla ES modules |
| `.claude/agents/*.md` | The six subagent definitions |
| `briefs/` | Build briefs written from onboarding responses |
| `agent-queue/` | Queued agent tasks as markdown, runnable by hand |

## Working with the database

```bash
sqlite3 data/ghl.db "SELECT status, COUNT(*) FROM leads GROUP BY status;"
sqlite3 -json data/ghl.db "SELECT * FROM leads WHERE id = 1;"
```

Tables: `leads`, `calls`, `scripts`, `bookings`, `availability`, `onboarding_forms`,
`onboarding_responses`, `daily_logs`, `tasks`, `agent_runs`, `email_outbox`, `activity`,
`settings`, `users`, `messages`, `sequences`, `sequence_steps`, `enrollments`, `scheduled_jobs`.

## Automations

The scheduler ticks every 60s (`SCHEDULER_TICK_MS` to change it). Each pass queues
newly due work, then runs whatever is due. Everything is idempotent, so a missed
tick or a restart mid-pass costs nothing — `scheduled_jobs.dedupe_key` is what
makes repeat sweeps safe.

Rules that must not be weakened:

- Every automated SMS goes through `sendMessage()` in `messaging.js`. That is
  where do-not-call, per-number STOP suppression and quiet hours are enforced.
  Never call `sendSms()` from telephony.js directly for an automated send.
- Quiet-hours jobs are **deferred**, never dropped — `runJob()` pushes `run_at`
  forward instead of failing.
- Any inbound reply stops that lead's active enrollments.

## Conventions

- No dependencies. If something needs a library, it probably needs rethinking first.
- Every API route lives in `server/api/` and returns JSON via the `json()` helper.
- Errors throw `HttpError` (or the `bad` / `notFound` / `unauthorized` shorthands). The server turns them into the right status.
- Frontend uses the `h` tagged template, which escapes interpolations. Use `raw()` only for HTML you built yourself.
- Secrets go through `SECRET_KEYS` in `server/lib/settings.js` so they are encrypted at rest and masked in the API.
- SQLite timestamps are UTC without a zone marker. Parse them with `toDate()` on the frontend, never `new Date(str)`.
- Columns added after the first release go in `LATER_COLUMNS` in `db.js`, which
  runs `ALTER TABLE ADD COLUMN` and swallows the error when it is already there.
  Never edit `SCHEMA` for a new column — existing databases do not re-run it.
- The router picks the **most specific** matching route, not the first registered,
  so `/api/leads/export.csv` wins over `/api/leads/:id` regardless of order.
- Chain detection must stay conservative — a false positive deletes a real lead.
  Two rules protect it: a normalized name needs a token outside `GENERIC_TOKENS`
  before it can prove a shared brand, and hosts in `SHARED_HOST_PATTERNS` (site
  builders, shorteners, parked domains) never count as a shared corporate domain.
- Build regexes with more than a couple of alternatives from an array and
  `new RegExp(list.join('|'))`. A regex literal cannot span lines, and writing
  one that does fails at import time, not where you are looking.
- Never put the `/i` flag on a pattern that uses `[A-Z]` to find a proper noun.
  It makes `[A-Z]` match lowercase too, so "Owner: Dave Thompson has served"
  captures "Dave Thompson has". Use `anyCase()` in `owner.js` to make the
  surrounding keywords case-flexible while the name stays case-sensitive.

## Agents

Six subagents in `.claude/agents/`: `lead-scout`, `outreach-writer`, `call-closer`,
`booking-agent`, `onboarding-agent`, `site-builder`.

The app queues runs by writing a markdown task file to `agent-queue/` and, when
`agents_enabled` is on, shelling out to the `claude` CLI. Agent output is stored on the
`agent_runs` row.
