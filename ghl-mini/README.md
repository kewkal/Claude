# ghl-mini

A self-hosted CRM that does the parts of GoHighLevel you actually use, plus six
Claude Code agents that do the work. Runs on one Node process and a SQLite file.

**Zero npm dependencies.** No Postgres, no Redis, no Docker, no build step.
Node 22.5+ and nothing else.

## What it costs

| | Per month |
|---|---|
| Hosting | $0 (runs on your laptop or a $5 VPS) |
| Software | $0 |
| Claude Code | your existing plan |
| Google Maps Places API | $0 for the first ~11,000 lookups on the free credit |
| Twilio (optional) | ~$1 for a number, ~$0.013 a minute |
| Email (optional) | $0 on Resend's free tier (3,000/mo) |

GoHighLevel starts at $97 and runs to $497.

## Getting started

**Windows:** double-click `start.bat`.

**Mac / Linux:** double-click `start.sh`, or in a terminal:

```bash
cd ghl-mini
./start.sh
```

That's the whole thing. First boot writes a `.env`, creates the database, ten
starter scripts, Mon-Fri business hours and a few demo leads — then prints your
login in a box:

```
  ┌──────────────────────────────────────────────────────────┐
  │ FIRST RUN — write these down.                            │
  ├──────────────────────────────────────────────────────────┤
  │ Open      http://localhost:4000                          │
  │ Email     owner@localhost                                │
  │ Password  anchor-pebble-lantern-693                      │
  └──────────────────────────────────────────────────────────┘
```

Open that address, sign in, and change the password in Settings.

### Locked out?

The owner account is created once, on first boot. Editing `OWNER_EMAIL` or
`OWNER_PASSWORD` in `.env` afterwards changes nothing, so it is easy to lock
yourself out. To recover:

```bash
node server/account.js                          # which accounts exist
node server/account.js you@example.com          # set a random password
node server/account.js you@example.com hunter2  # set a specific one
```

### You don't need to edit .env

Everything except the first login is settable in **Settings** inside the app —
API keys included, and they are encrypted in the database rather than sitting in
a plain text file.

## The nine screens

**Daily HQ** — hours worked against target, calls against target, today's list,
follow-ups that are due, what's on the calendar, and a 14-day history. Autosaves
as you type.

**Agents** — the six agents, what each one does, and every run they've made.

**Leads** — the database. Scrape from Google Maps, import CSV, filter, bulk-edit,
export. Every lead carries a 0-100 score based on how badly they need what you sell.

**Check websites** opens each lead's site and reads what is running on it:

| Signal | What it tells you |
|---|---|
| Meta Pixel / Google Ads tag | They pay for traffic. The budget is proven. |
| Google Tag Manager / GA4 | Somebody is measuring. Probably has an agency. |
| No tags at all | Live site, zero measurement. They cannot tell you what it earns. |
| Wix / GoDaddy / Weebly / Duda | DIY build. Nobody is maintaining it. |
| No mobile viewport | You can demo the problem on their own phone. |
| Unreachable or 404 | Their site is down and they almost certainly do not know. |

Each scanned lead gets a one-line `pitch_angle` — the reason to pick up the phone —
and the score is adjusted: an ad spender on a DIY site outranks a business with a
polished, tracked website, because one has money and a problem and the other has
neither. Filter chips on the Leads screen slice by all of it, and the CSV export
carries every column.

These are ordinary page visits, not API calls, so scanning costs nothing. It runs
five at a time to stay polite.

### Franchises are left out

A chain is a dead call: corporate owns the website, the marketing budget is set
three states away, and whoever answers cannot buy anything. Scraping leaves them
out by default, on four signals:

1. **A known brand** — Roto-Rooter, Mr. Rooter, ServPro, TruGreen, Terminix,
   Jiffy Lube, Aspen Dental and a few hundred more, by trade.
2. **The same name in several cities** — catches regional chains no list knows.
3. **Three or more listings behind one domain** — a corporate site covering
   multiple locations.
4. **Franchise wording on their own site** — "independently owned and operated"
   is the disclosure a franchise is legally obliged to publish.

Two guards stop it eating good leads. A name has to keep a **distinctive word**
after the filler is stripped, so "The Roofing Company" and "Florida Roofing Corp"
are never treated as branches of each other. And site builders and link
shorteners are ignored as shared domains — four roofers on UENI or Wix are four
businesses, not one chain.

Two locations behind one domain is *not* flagged: that is a local operator with
two vans, and the owner still answers the phone.

**Find chains in my list** applies all of it to leads you already have, and any
lead wrongly flagged has a *This one is independent* button that rescores it.

**Dialer** — a call queue sorted by who's most likely to close, the lead's history,
a live-rendered script with their details filled in, one-click outcome logging and a
call timer. Twilio click-to-call if you connect it, `tel:` links if you don't.

**Scripts** — call scripts, cold email, SMS, voicemail and objection handling.
Tokens like `{{name}}` and `{{review_count}}` fill from the lead at send time. Each
script tracks its own booking rate so you know which one actually works.

**Call history** — every call, filterable, with connect rate, booking rate and a
14-day chart.

**Calendar** — month view, bookings, availability rules, a public booking page at
`/book`, and an `.ics` feed you can subscribe to from any calendar app.

**Onboarding** — shareable forms. The client fills it out once, and you get a
complete build brief written to `briefs/` that the Site Builder agent works from.

**Automations** — the four automations, your drip sequences, what's queued to
send, and every text in and out.

**Settings** — every connection in one place with a Test button, plus targets,
password and the email outbox.

## The automations

A scheduler runs every minute and drives four things:

| | What it does |
|---|---|
| **Missed-call text-back** | Someone rings you and doesn't get through, so they get a text within seconds. Unknown callers get captured as leads automatically. |
| **Appointment reminder** | Texts and emails the client before the call. Book on short notice and the reminder still goes, just sooner. |
| **No-show recovery** | Marks the booking and offers two new times. A call logged near the slot counts as held, not missed. |
| **Drip sequences** | Multi-day email and text follow-ups that run themselves. |

Every sequence stops on its own the moment the lead replies, books, or texts STOP.

### Texting people responsibly

This is built in, not optional:

- **STOP is honored instantly** and belongs to the phone number, not the lead
  row. Text STOP before you're in the database and you stay opted out even if
  that number gets scraped in later.
- **Quiet hours** default to 8am–9pm in your timezone. Anything due outside the
  window is held until it opens, never dropped and never sent at 3am.
- **Do-not-call leads are never texted**, by any automation.
- **A real reply stops the drip** and moves the lead to callback, so nobody ever
  gets an automated follow-up on top of a live conversation.

US law (TCPA) is strict about business texting. These defaults keep you inside
it, but read the rules for where you operate before you switch anything on.

### Wiring up Twilio

Reminders, no-show recovery and drips work on your laptop. Missed-call
text-back and reply handling need Twilio to reach you, which means a public
address — set `PUBLIC_URL` to your real domain, then paste these into your
Twilio number:

```
A call comes in     https://yourdomain.com/webhooks/twilio/voice
A message comes in  https://yourdomain.com/webhooks/twilio/sms
```

Both are signature-verified, so an unsigned request is rejected with a 403.

## The six agents

| Agent | What it does |
|---|---|
| 🔍 **Lead Scout** | Pulls businesses from Google Maps, drops the ones already well served, scores the rest, writes them into Leads. |
| ✍️ **Outreach Writer** | Writes the first-touch email, the two follow-ups and the SMS for a segment. Saves them as reusable scripts. |
| 📞 **Call Closer** | Builds call scripts, objection tables and per-lead prep sheets. Reads the history so you never open cold. |
| 📅 **Booking Agent** | Confirmations, day-before reminders, no-show recovery, and every overdue follow-up flagged. |
| 📋 **Onboarding Agent** | Turns a submitted form into a build brief with the gaps researched and filled. |
| 🏗️ **Site Builder** | Takes the brief and builds the client's site. Copy, pages, styling, deploy-ready. |

They live in `.claude/agents/`. Fire one from the Agents screen and it queues a task
file into `agent-queue/` and shells out to your `claude` binary. Turn the automatic
run off in Settings and the task files still get written, so you can run them by hand
in Claude Code.

There are slash commands too: `/morning`, `/scrape roofers in Tampa FL`,
`/build-client 7`, `/pipeline`.

## The money loop

1. **Lead Scout** scrapes a trade in a city. Businesses with reviews and no website
   score highest.
2. **Outreach Writer** writes the sequence for that segment.
3. You work the **Dialer** with the script **Call Closer** wrote. Log each outcome
   in one click.
4. A booked call lands on the **Calendar**. **Booking Agent** chases the reminders.
5. They pay. You send the onboarding link.
6. **Onboarding Agent** turns their answers into a brief. **Site Builder** builds it.

You sell and collect. The agents do the rest.

## Connecting the integrations

All optional. All in Settings, all with a Test button.

**Google Maps** — Google Cloud Console, enable the Places API, make a key. This is
what fills the Leads table. Set a quota cap so a runaway scrape can't surprise you.

**Email** — Resend, Mailgun or Postmark. Resend is the fastest to set up. Without it,
everything still gets written to the outbox so nothing is lost.

**Twilio** — a number, the SID and the auth token. Without it the dialer works as a
log-and-track tool and you dial from your phone.

**Claude Code** — point `claude_bin` at your binary. That's the agent runtime.

Secrets are encrypted at rest with AES-256-GCM using `GHL_SECRET`, and the API only
ever returns them masked.

## API

Every screen is backed by JSON endpoints, so the agents drive the same app you do.

```
GET    /api/leads?status=new&has_website=0&sort=score
POST   /api/leads/scrape        {"query":"roofers in Tampa FL","pages":3}
POST   /api/leads/bulk          {"action":"status","ids":[1,2],"status":"queued"}
GET    /api/leads/export.csv

GET    /api/calls/queue         who to dial next
POST   /api/calls               log an outcome
POST   /api/calls/dial          Twilio click-to-call
GET    /api/calls/stats

GET    /api/scripts?kind=call
POST   /api/scripts/:id/render  {"lead_id":142}   fills the tokens

GET    /api/bookings
GET    /api/slots?days=14
GET    /api/calendar.ics

GET    /api/onboarding/responses
POST   /api/onboarding/responses/:id/brief

GET    /api/daily?day=2026-09-04
PUT    /api/daily

GET    /api/agents
POST   /api/agents/:id/run
GET    /api/agents/runs

GET    /api/automations         the four, plus scheduler health
POST   /api/automations/tick    run a pass right now
POST   /api/automations/:id/test
GET    /api/sequences
POST   /api/sequences/:id/enroll  {"lead_ids":[1,2,3]}
GET    /api/enrollments
GET    /api/jobs                what is scheduled
GET    /api/messages            texts in and out
POST   /api/messages            send one

GET    /api/settings
POST   /api/settings/test/:integration
```

Public, no session needed: `/f/:slug` (onboarding form), `/book` (booking page),
`/health`, and `/webhooks/twilio/*` (signature-verified).

## Data

One SQLite file at `data/ghl.db`. Back it up by copying it.

```bash
sqlite3 data/ghl.db "SELECT status, COUNT(*) FROM leads GROUP BY status;"
cp data/ghl.db backups/ghl-$(date +%F).db
```

## Deploying it

It's one process. Anything that runs Node works.

```bash
# systemd
sudo tee /etc/systemd/system/ghl-mini.service <<'UNIT'
[Unit]
Description=ghl-mini
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/opt/ghl-mini
ExecStart=/usr/bin/node server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl enable --now ghl-mini
```

Put it behind Caddy or nginx for TLS, and set `PUBLIC_URL` to the real domain so your
form and booking links are right.

## What this is not

It isn't GoHighLevel. There's no funnel builder, no membership sites, no white-label
reseller layer, no review-request automation, no built-in payments, and no visual
workflow builder — sequences are a list of steps, not a flowchart. If you need
those, pay for the real thing.

What it does have is the loop that actually makes the money: find leads, call them,
book them, onboard them, build the thing. Own the database, pay for the API calls,
and keep the difference.

## License

MIT. Do whatever you want with it.
