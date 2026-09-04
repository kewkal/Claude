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
| `server/lib/maps.js` | Google Places scraping and lead scoring |
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
`onboarding_responses`, `daily_logs`, `tasks`, `agent_runs`, `email_outbox`, `activity`, `settings`, `users`.

## Conventions

- No dependencies. If something needs a library, it probably needs rethinking first.
- Every API route lives in `server/api/` and returns JSON via the `json()` helper.
- Errors throw `HttpError` (or the `bad` / `notFound` / `unauthorized` shorthands). The server turns them into the right status.
- Frontend uses the `h` tagged template, which escapes interpolations. Use `raw()` only for HTML you built yourself.
- Secrets go through `SECRET_KEYS` in `server/lib/settings.js` so they are encrypted at rest and masked in the API.
- SQLite timestamps are UTC without a zone marker. Parse them with `toDate()` on the frontend, never `new Date(str)`.

## Agents

Six subagents in `.claude/agents/`: `lead-scout`, `outreach-writer`, `call-closer`,
`booking-agent`, `onboarding-agent`, `site-builder`.

The app queues runs by writing a markdown task file to `agent-queue/` and, when
`agents_enabled` is on, shelling out to the `claude` CLI. Agent output is stored on the
`agent_runs` row.
