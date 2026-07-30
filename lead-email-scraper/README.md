# Lead Email Scraper

Scrapes publicly listed business contact emails (Contact/About/Team pages)
from home-service company websites for lead-generation outreach.

## Install

```bash
cd lead-email-scraper
python3 -m venv .venv && source .venv/bin/activate   # optional but recommended
pip install -r requirements.txt
```

## Set the Google Places API key (optional but required for `type=name` rows and `--places-query`)

```bash
export GOOGLE_PLACES_API_KEY="your-key-here"
```

If the key isn't set, the script prints a warning and skips name resolution /
Places search — `type=url` rows in `input.csv` still work with no key at all.

Never hardcode the key in the script or commit it to source control.

## Input format (`input.csv`)

Two columns, `type` and `value`:

```csv
type,value
url,https://www.acmehvac.com
url,someplumber.com
name,Cool Breeze Air Conditioning Houston
name,Reliable Plumbing Co Austin
```

- `type=url` — `value` is a website to scrape directly.
- `type=name` — `value` is a company name; it's resolved to a website via
  the Google Places "Find Place" API first, then scraped.

See `input.example.csv` for a working sample.

## Google Places search mode

Instead of (or in addition to) `input.csv`, you can pull leads directly from
a Places text search:

```bash
python scraper.py --places-query "HVAC contractors Houston TX" --limit 50
```

Business name + website results from the search feed into the same
scrape/extract/verify pipeline as `input.csv` rows.

## Example commands

Test batch of 50 sites from `input.csv`:

```bash
python scraper.py --input input.csv --output output.csv --limit 50
```

Places-search-driven run:

```bash
export GOOGLE_PLACES_API_KEY="your-key-here"
python scraper.py --places-query "plumbers Dallas TX" --output output.csv --limit 50
```

Mix both sources in one run (rows from `input.csv` plus a Places search,
capped by `--limit` total):

```bash
python scraper.py --input input.csv --places-query "HVAC contractors Houston TX" --limit 50
```

## Output (`output.csv`)

Written incrementally (flushed after every site), so a crash mid-run keeps
everything already scraped. Columns:

| column        | meaning                                                              |
|---------------|-----------------------------------------------------------------------|
| `email`       | the email address                                                     |
| `email_type`  | `personal` or `role-based` (e.g. `info@`, `sales@`)                   |
| `company`     | from `input.csv`, or the name resolved via Places                     |
| `source_url`  | the exact page the email was found on                                 |
| `guessed_name`| best-effort "First Last" guess for personal emails, blank for role-based |
| `mx_valid`    | `True`/`False` — whether the domain has usable MX records             |

Notes:
- Emails are deduped globally across the whole run.
- Obvious noise is filtered: `example.com`, `sentry.io`, `wixpress.com`
  addresses, and regex false-positives ending in image extensions
  (`.png`, `.jpg`, etc.).
- `guessed_name` is simple string heuristics (separators like `first.last`,
  plus a small built-in common-first-name list for unseparated
  `firstlast` addresses). It will not correctly split every name — e.g.
  `jsmith@` is left as `Jsmith` rather than guessed as `J. Smith`, since
  there's no reliable way to find the split point without a name API.
- `mx_valid` is a DNS MX record check only (deliverability sanity check),
  not a live SMTP handshake — it won't catch a full mailbox, just confirms
  the domain can receive mail at all.

## Behavior / politeness

- Real `User-Agent`, 10s timeout, and a 1–2s randomized delay between
  requests to the same domain.
- Checks `robots.txt` before fetching anything on a domain; disallowed
  paths are skipped and logged.
- Fetches at most ~5 pages per site: the homepage plus up to 4 internal
  links whose text/href mentions contact, about, team, staff, our-team,
  or meet.
- Every network call is wrapped in `try/except` — one dead or slow site
  never aborts the run.
- Progress and per-site status (pages fetched, emails found/kept, skips,
  errors) are logged to both the console and `run.log`.

## Scaling beyond the test batch

The pipeline (`resolve_website` → `get_target_pages` → `extract_emails` →
`check_mx`) has no hardcoded batch-size assumptions; `--limit` is just a
cap. For larger runs, raise `--limit`, and consider adding basic
concurrency (e.g. a thread pool keyed by domain, keeping the per-domain
delay) if I/O wait time becomes the bottleneck — the current version is
intentionally single-threaded/sequential to keep the ~50-site test run
simple and easy to reason about.
