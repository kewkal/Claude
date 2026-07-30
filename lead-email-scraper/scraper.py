#!/usr/bin/env python3
"""
Lead-generation email scraper for home-service company websites.

Pipeline: input.csv (urls and/or company names) -> resolve websites via
Google Places (for names) -> crawl a handful of pages per site -> extract
and classify emails -> DNS MX sanity check -> output.csv.
"""

import argparse
import csv
import logging
import os
import random
import re
import sys
import time
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

try:
    import dns.resolver
except ImportError:
    dns = None

USER_AGENT = "Mozilla/5.0 (compatible; LeadGenEmailScraper/1.0; +https://example.com/bot)"
REQUEST_TIMEOUT = 10
MIN_DELAY = 1.0
MAX_DELAY = 2.0
MAX_PAGES_PER_SITE = 5
TARGET_PAGE_KEYWORDS = ["contact", "about", "team", "staff", "our-team", "meet"]

JUNK_DOMAINS = {"example.com", "sentry.io", "wixpress.com"}
JUNK_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp")

ROLE_KEYWORDS = {
    "info", "sales", "contact", "support", "admin", "office", "service",
    "services", "help", "hello", "team", "staff", "careers", "jobs", "hr",
    "marketing", "billing", "accounts", "accounting", "webmaster",
    "noreply", "no-reply", "enquiries", "inquiries", "quotes", "quote",
    "dispatch", "scheduling", "booking", "bookings", "appointments",
    "general", "mail", "email", "sale", "customerservice", "cs",
    "frontdesk", "reception", "orders", "order", "hiring", "recruiting",
}

# Small heuristic list used only to split unseparated "firstlast" style
# local-parts (e.g. "johnsmith"). Best-effort only, not exhaustive.
COMMON_FIRST_NAMES = {
    "james", "john", "robert", "michael", "william", "david", "richard",
    "joseph", "thomas", "charles", "chris", "christopher", "daniel", "matt",
    "matthew", "anthony", "mark", "donald", "steven", "andrew", "paul",
    "joshua", "kenneth", "kevin", "brian", "george", "edward", "ronald",
    "timothy", "jason", "jeff", "jeffrey", "ryan", "jacob", "gary", "nicholas",
    "eric", "jonathan", "stephen", "larry", "justin", "scott", "brandon",
    "benjamin", "samuel", "gregory", "frank", "alexander", "raymond",
    "patrick", "jack", "dennis", "jerry", "tyler", "aaron", "jose", "adam",
    "nathan", "henry", "zachary", "douglas", "peter", "kyle", "walter",
    "ethan", "jeremy", "harold", "carl", "keith", "roger", "gerald",
    "christian", "terry", "sean", "austin", "arthur", "noah", "lawrence",
    "jesse", "joe", "bryan", "billy", "jordan", "albert", "dylan", "bruce",
    "willie", "gabriel", "alan", "juan", "logan", "wayne", "ralph", "roy",
    "eugene", "randy", "vincent", "russell", "elijah", "louis", "bobby",
    "philip", "johnny", "mike", "dave", "steve", "rick", "bill", "kaleb",
    "caleb", "mary", "patricia", "jennifer", "linda", "elizabeth", "barbara",
    "susan", "jessica", "sarah", "karen", "lisa", "nancy", "betty", "sandra",
    "margaret", "ashley", "kimberly", "emily", "donna", "michelle", "amanda",
    "melissa", "deborah", "stephanie", "rebecca", "laura", "sharon", "cynthia",
    "kathleen", "amy", "shirley", "angela", "helen", "anna", "brenda",
    "pamela", "nicole", "samantha", "katherine", "christine", "debra",
    "rachel", "carolyn", "janet", "maria", "heather", "diane", "julie",
    "joyce", "victoria", "kelly", "christina", "lauren", "joan", "evelyn",
    "olivia", "judith", "megan", "cheryl", "martha", "andrea", "frances",
    "hannah", "jacqueline", "ann", "gloria", "jean", "kathryn", "alice",
}

EMAIL_REGEX = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")

PLACES_TEXTSEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
PLACES_FINDPLACE_URL = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
PLACES_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"

log = logging.getLogger("lead_scraper")


def setup_logging(log_path):
    log.setLevel(logging.INFO)
    log.handlers.clear()

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S")

    file_handler = logging.FileHandler(log_path, mode="a", encoding="utf-8")
    file_handler.setFormatter(fmt)
    log.addHandler(file_handler)

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(fmt)
    log.addHandler(stream_handler)


# --------------------------------------------------------------------------
# Google Places integration (direct REST calls; no API key -> feature is
# skipped gracefully, URL-based scraping still works).
# --------------------------------------------------------------------------

def get_places_api_key():
    key = os.environ.get("GOOGLE_PLACES_API_KEY")
    if not key:
        log.warning(
            "GOOGLE_PLACES_API_KEY is not set. Name resolution and --places-query "
            "will be skipped; URL-based scraping still works."
        )
    return key


def get_place_website(place_id, api_key):
    try:
        params = {"place_id": place_id, "fields": "website,name", "key": api_key}
        resp = requests.get(PLACES_DETAILS_URL, params=params, timeout=REQUEST_TIMEOUT)
        data = resp.json()
        if data.get("status") == "OK":
            return data.get("result", {}).get("website")
        log.warning(f"Place details status={data.get('status')} for place_id={place_id}")
    except Exception as e:
        log.warning(f"Place details request failed for {place_id}: {e}")
    return None


def resolve_website(name, api_key):
    """Resolve a company name to a website URL via Google Places Find Place API."""
    if not api_key:
        return None
    try:
        params = {
            "input": name,
            "inputtype": "textquery",
            "fields": "place_id,name",
            "key": api_key,
        }
        resp = requests.get(PLACES_FINDPLACE_URL, params=params, timeout=REQUEST_TIMEOUT)
        data = resp.json()
        candidates = data.get("candidates", [])
        if not candidates:
            log.warning(f"No Places match for company name '{name}' (status={data.get('status')})")
            return None
        place_id = candidates[0]["place_id"]
        return get_place_website(place_id, api_key)
    except Exception as e:
        log.warning(f"resolve_website failed for '{name}': {e}")
        return None


def places_text_search(query, api_key, limit):
    """Run a Places text search (e.g. 'HVAC contractors Houston TX') and return
    a list of {"company": ..., "url": ...} dicts for results that have a website."""
    results = []
    if not api_key:
        return results
    try:
        params = {"query": query, "key": api_key}
        next_page_token = None
        while len(results) < limit:
            if next_page_token:
                time.sleep(2)  # Places API requires a short delay before a token is valid
                params = {"pagetoken": next_page_token, "key": api_key}
            resp = requests.get(PLACES_TEXTSEARCH_URL, params=params, timeout=REQUEST_TIMEOUT)
            data = resp.json()
            status = data.get("status")
            if status not in ("OK", "ZERO_RESULTS"):
                log.error(f"Places text search error: {status} - {data.get('error_message', '')}")
                break
            for place in data.get("results", []):
                if len(results) >= limit:
                    break
                name = place.get("name")
                place_id = place.get("place_id")
                website = get_place_website(place_id, api_key)
                if website:
                    results.append({"company": name, "url": website})
                else:
                    log.info(f"Skipping '{name}' from Places search: no website listed")
            next_page_token = data.get("next_page_token")
            if not next_page_token:
                break
    except Exception as e:
        log.error(f"Places text search failed for query '{query}': {e}")
    return results


# --------------------------------------------------------------------------
# Politeness: robots.txt + per-domain delay
# --------------------------------------------------------------------------

class Politeness:
    def __init__(self, session):
        self.session = session
        self.robots_cache = {}
        self.last_request = {}

    def _get_robot_parser(self, base_url):
        netloc = urlparse(base_url).netloc
        if netloc in self.robots_cache:
            return self.robots_cache[netloc]
        parsed = urlparse(base_url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        rp = RobotFileParser()
        try:
            resp = self.session.get(robots_url, timeout=REQUEST_TIMEOUT, headers={"User-Agent": USER_AGENT})
            if resp.status_code == 200:
                rp.parse(resp.text.splitlines())
            else:
                rp.parse([])  # no robots.txt found -> assume allowed
        except Exception as e:
            log.info(f"Could not fetch robots.txt for {netloc}: {e}; assuming allowed")
            rp.parse([])
        self.robots_cache[netloc] = rp
        return rp

    def allowed(self, url):
        rp = self._get_robot_parser(url)
        return rp.can_fetch(USER_AGENT, url)

    def wait_for_domain(self, url):
        domain = urlparse(url).netloc
        last = self.last_request.get(domain)
        if last is not None:
            elapsed = time.time() - last
            needed = random.uniform(MIN_DELAY, MAX_DELAY)
            if elapsed < needed:
                time.sleep(needed - elapsed)
        self.last_request[domain] = time.time()


def fetch_url(url, session, politeness):
    """Fetch a URL respecting robots.txt and per-domain delay. Returns html text or None."""
    try:
        if not politeness.allowed(url):
            log.info(f"Skipping (robots.txt disallows): {url}")
            return None
        politeness.wait_for_domain(url)
        resp = session.get(url, timeout=REQUEST_TIMEOUT, headers={"User-Agent": USER_AGENT})
        if resp.status_code >= 400:
            log.info(f"HTTP {resp.status_code} for {url}")
            return None
        return resp.text
    except Exception as e:
        log.info(f"Request failed for {url}: {e}")
        return None


# --------------------------------------------------------------------------
# Page discovery
# --------------------------------------------------------------------------

def get_target_pages(base_url, homepage_html, max_links=MAX_PAGES_PER_SITE - 1):
    """Find internal Contact/About/Team style links from the homepage HTML."""
    candidates = []
    seen = set()
    try:
        soup = BeautifulSoup(homepage_html, "html.parser")
        base_netloc = urlparse(base_url).netloc
        for a in soup.find_all("a", href=True):
            href = a["href"]
            text = a.get_text(strip=True).lower()
            href_l = href.lower()
            if any(kw in href_l or kw in text for kw in TARGET_PAGE_KEYWORDS):
                abs_url = urljoin(base_url, href).split("#")[0]
                parsed = urlparse(abs_url)
                if parsed.scheme not in ("http", "https"):
                    continue
                if parsed.netloc != base_netloc:
                    continue
                if abs_url in seen or abs_url == base_url:
                    continue
                seen.add(abs_url)
                candidates.append(abs_url)
                if len(candidates) >= max_links:
                    break
    except Exception as e:
        log.info(f"Failed parsing homepage links for {base_url}: {e}")
    return candidates


# --------------------------------------------------------------------------
# Email extraction + de-obfuscation
# --------------------------------------------------------------------------

def _decode_cfemail(encoded):
    try:
        r = int(encoded[:2], 16)
        return "".join(
            chr(int(encoded[i:i + 2], 16) ^ r) for i in range(2, len(encoded), 2)
        )
    except Exception:
        return None


def _deobfuscate_text(text):
    """Turn '[at]'/'(at)' and '[dot]'/'(dot)' style obfuscation into @ / . so the
    standard email regex can pick it up. Restricted to bracketed/parenthesized
    tokens (or literal uppercase AT/DOT) to avoid mangling normal prose."""
    text = re.sub(r"\s*[\[\(\{]\s*at\s*[\]\)\}]\s*", "@", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*[\[\(\{]\s*dot\s*[\]\)\}]\s*", ".", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*\bAT\b\s*", "@", text)
    text = re.sub(r"\s*\bDOT\b\s*", ".", text)
    return text


def extract_emails(html):
    """Extract candidate emails (unfiltered) from a page's HTML."""
    found = set()
    if not html:
        return found

    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception:
        return found

    # 1. Plain regex over raw HTML.
    for m in EMAIL_REGEX.findall(html):
        found.add(m)

    # 2. De-obfuscated visible text ("name [at] company [dot] com").
    try:
        visible_text = soup.get_text(separator=" ")
        deobfuscated = _deobfuscate_text(visible_text)
        for m in EMAIL_REGEX.findall(deobfuscated):
            found.add(m)
    except Exception:
        pass

    # 3. mailto: links.
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().startswith("mailto:"):
            addr = href[7:].split("?")[0].strip()
            if addr:
                found.add(addr)

    # 4. Cloudflare email protection: data-cfemail attribute.
    for tag in soup.find_all(attrs={"data-cfemail": True}):
        decoded = _decode_cfemail(tag["data-cfemail"])
        if decoded:
            found.add(decoded)

    # 4b. Cloudflare email protection: /cdn-cgi/l/email-protection#<hex> hrefs.
    for m in re.finditer(r"/cdn-cgi/l/email-protection#([0-9a-fA-F]+)", html):
        decoded = _decode_cfemail(m.group(1))
        if decoded:
            found.add(decoded)

    return found


def is_junk_email(email):
    email_l = email.lower()
    if email_l.endswith(JUNK_SUFFIXES):
        return True
    domain = email_l.split("@")[-1]
    if domain in JUNK_DOMAINS:
        return True
    return False


# --------------------------------------------------------------------------
# Classification + name guessing
# --------------------------------------------------------------------------

def classify_email(email):
    local = email.split("@")[0].lower()
    local_clean = re.sub(r"[0-9]+$", "", local)
    tokens = re.split(r"[._\-]+", local_clean)
    if local_clean in ROLE_KEYWORDS or any(t in ROLE_KEYWORDS for t in tokens if t):
        return "role-based"
    for kw in ROLE_KEYWORDS:
        if kw in local_clean:
            return "role-based"
    return "personal"


def guess_name(email):
    """Best-effort first/last name guess from a personal email's local-part.
    Handles first.last / first_last / first-last, and (heuristically, via a
    small common-first-name list) unseparated firstlast. Falls back to
    treating the whole local-part as a single first name."""
    local = email.split("@")[0].lower()
    local_clean = re.sub(r"[0-9]+$", "", local)
    if not local_clean:
        return ""

    for sep in (".", "_", "-"):
        if sep in local_clean:
            parts = [p for p in local_clean.split(sep) if p]
            if len(parts) >= 2:
                return " ".join(p.capitalize() for p in parts)

    if local_clean.isalpha():
        for name in sorted(COMMON_FIRST_NAMES, key=len, reverse=True):
            if local_clean.startswith(name) and len(local_clean) > len(name):
                rest = local_clean[len(name):]
                if len(rest) >= 2:
                    return f"{name.capitalize()} {rest.capitalize()}"
        return local_clean.capitalize()

    return ""


# --------------------------------------------------------------------------
# MX lookup
# --------------------------------------------------------------------------

def check_mx(domain, cache):
    """DNS MX lookup, cached per domain. True/False only, no SMTP handshake."""
    domain = domain.lower()
    if domain in cache:
        return cache[domain]
    valid = False
    if dns is not None:
        try:
            answers = dns.resolver.resolve(domain, "MX", lifetime=REQUEST_TIMEOUT)
            valid = len(answers) > 0
        except Exception as e:
            log.info(f"MX lookup failed for {domain}: {e}")
            valid = False
    else:
        log.warning("dnspython not installed; skipping MX checks (mx_valid will be False)")
    cache[domain] = valid
    return valid


# --------------------------------------------------------------------------
# Per-site pipeline
# --------------------------------------------------------------------------

def normalize_url(url):
    url = url.strip()
    if not url:
        return url
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def process_site(company, url, session, politeness, mx_cache, seen_emails, writer, csv_file):
    url = normalize_url(url)
    if not url:
        return

    log.info(f"Processing site: {company or '(unnamed)'} -> {url}")

    homepage_html = fetch_url(url, session, politeness)
    if homepage_html is None:
        log.info(f"SKIP {url}: homepage could not be fetched (dead site, blocked, or disallowed)")
        return

    pages = [(url, homepage_html)]
    target_links = get_target_pages(url, homepage_html)
    for link in target_links:
        html = fetch_url(link, session, politeness)
        if html is not None:
            pages.append((link, html))

    email_sources = {}  # email -> first page it was found on
    for page_url, html in pages:
        for email in extract_emails(html):
            if email not in email_sources:
                email_sources[email] = page_url

    kept = 0
    for email, source_url in email_sources.items():
        if is_junk_email(email):
            continue
        key = email.lower()
        if key in seen_emails:
            continue
        seen_emails.add(key)

        domain = email.split("@")[1].lower()
        mx_valid = check_mx(domain, mx_cache)
        email_type = classify_email(email)
        guessed = guess_name(email) if email_type == "personal" else ""

        writer.writerow({
            "email": email,
            "email_type": email_type,
            "company": company,
            "source_url": source_url,
            "guessed_name": guessed,
            "mx_valid": mx_valid,
        })
        csv_file.flush()
        kept += 1

    log.info(
        f"DONE {company or url}: fetched {len(pages)} page(s), "
        f"{len(email_sources)} raw email(s), {kept} kept after filtering/dedupe"
    )


# --------------------------------------------------------------------------
# Input loading
# --------------------------------------------------------------------------

def load_input_rows(input_path):
    """Read input.csv (columns: type,value) into a list of {"type","value"} dicts."""
    rows = []
    if not input_path or not os.path.exists(input_path):
        return rows
    with open(input_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_type = (row.get("type") or "").strip().lower()
            value = (row.get("value") or "").strip()
            if row_type and value:
                rows.append({"type": row_type, "value": value})
    return rows


def build_site_list(args, api_key):
    """Resolve all input rows + optional Places query into a flat list of
    {"company", "url"} dicts, ready for the crawl pipeline."""
    sites = []

    input_rows = load_input_rows(args.input)
    for row in input_rows:
        if row["type"] == "url":
            domain = urlparse(normalize_url(row["value"])).netloc.replace("www.", "")
            sites.append({"company": domain, "url": row["value"]})
        elif row["type"] == "name":
            if not api_key:
                log.warning(f"Skipping name lookup for '{row['value']}': no GOOGLE_PLACES_API_KEY set")
                continue
            website = resolve_website(row["value"], api_key)
            if website:
                sites.append({"company": row["value"], "url": website})
            else:
                log.warning(f"Could not resolve website for company name: '{row['value']}'")
        else:
            log.warning(f"Unknown input type '{row['type']}' for value '{row['value']}', skipping")

    if args.places_query:
        if not api_key:
            log.warning("Skipping --places-query: no GOOGLE_PLACES_API_KEY set")
        else:
            log.info(f"Running Places search: '{args.places_query}'")
            remaining = max(args.limit - len(sites), 0)
            found = places_text_search(args.places_query, api_key, remaining or args.limit)
            sites.extend(found)

    return sites[:args.limit]


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

OUTPUT_FIELDS = ["email", "email_type", "company", "source_url", "guessed_name", "mx_valid"]


def main():
    parser = argparse.ArgumentParser(description="Scrape business contact emails for lead generation.")
    parser.add_argument("--input", default="input.csv", help="Input CSV with columns: type,value")
    parser.add_argument("--output", default="output.csv", help="Output CSV path")
    parser.add_argument("--places-query", default=None, help='Google Places text search, e.g. "HVAC contractors Houston TX"')
    parser.add_argument("--limit", type=int, default=50, help="Max number of sites to process")
    parser.add_argument("--log", default="run.log", help="Log file path")
    args = parser.parse_args()

    setup_logging(args.log)
    log.info(f"Starting run: input={args.input} output={args.output} places_query={args.places_query!r} limit={args.limit}")

    api_key = get_places_api_key()
    sites = build_site_list(args, api_key)
    log.info(f"Resolved {len(sites)} site(s) to process")

    if not sites:
        log.warning("No sites to process. Check your input.csv or --places-query.")
        return

    session = requests.Session()
    politeness = Politeness(session)
    mx_cache = {}
    seen_emails = set()

    write_header = not os.path.exists(args.output) or os.path.getsize(args.output) == 0
    with open(args.output, "a", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=OUTPUT_FIELDS)
        if write_header:
            writer.writeheader()
            csv_file.flush()

        for site in sites:
            try:
                process_site(
                    site.get("company", ""), site["url"], session, politeness,
                    mx_cache, seen_emails, writer, csv_file,
                )
            except Exception as e:
                log.error(f"Unexpected error processing {site}: {e}")

    log.info(f"Run complete. {len(seen_emails)} unique email(s) written to {args.output}")


if __name__ == "__main__":
    main()
