"""
Facebook Ad Library public website scraper using Playwright.
No API token required — scrapes the publicly accessible search at
https://www.facebook.com/ads/library/
"""
import asyncio
import re
from datetime import datetime
from playwright.async_api import async_playwright, TimeoutError as PWTimeout


FB_LIBRARY_URL = "https://www.facebook.com/ads/library/"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]
_ua_index = 0


def _next_ua() -> str:
    global _ua_index
    ua = USER_AGENTS[_ua_index % len(USER_AGENTS)]
    _ua_index += 1
    return ua


def _parse_date_text(text: str) -> datetime | None:
    """Parse strings like 'Started running on Nov 1, 2024'."""
    try:
        match = re.search(r'(\w+ \d+, \d{4})', text)
        if match:
            return datetime.strptime(match.group(1), "%b %d, %Y")
    except Exception:
        pass
    return None


async def _scrape_library(query: str, query_type: str, max_results: int = 30) -> list[dict]:
    """Scrape Facebook Ad Library search results page."""
    ads: list[dict] = []

    # Build URL params
    params = {
        "active_status": "active",
        "ad_type": "all",
        "country": "US",
        "media_type": "all",
    }
    if query_type == "keyword":
        params["q"] = query
        params["search_type"] = "keyword_unordered"
    elif query_type in ("domain", "advertiser"):
        params["q"] = query
        params["search_type"] = "page"
    else:
        params["q"] = "shop now"
        params["search_type"] = "keyword_unordered"

    qs = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{FB_LIBRARY_URL}?{qs}"

    async with async_playwright() as pw:
        import platform
            is_windows = platform.system() == "Windows"
            launch_opts = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
            if not is_windows:
                launch_opts["executable_path"] = "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"
            browser = await pw.chromium.launch(**launch_opts)
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=_next_ua(),
            locale="en-US",
        )
        page = await ctx.new_page()

        # Block images/fonts to speed up load
        await page.route("**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf}", lambda r: r.abort())

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(3)

            # Scroll to load more ads
            for _ in range(4):
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await asyncio.sleep(2)
                if len(await page.query_selector_all('[data-testid="ad-archive-renderer"], [class*="xh8yej3"]')) >= max_results:
                    break

            # Try multiple selectors Facebook uses
            ad_elements = await page.query_selector_all(
                '[data-testid="ad-archive-renderer"], '
                'div[class*="x1yztbdb"]:has(div[class*="x1lliihq"])'
            )

            if not ad_elements:
                # Fallback: look for any card-like containers with ad content
                ad_elements = await page.query_selector_all('div:has(> div > div[role="img"])')

            for el in ad_elements[:max_results]:
                try:
                    text_content = await el.inner_text()
                    lines = [l.strip() for l in text_content.split('\n') if l.strip()]

                    # Try to find advertiser name (usually the first bold/prominent line)
                    advertiser = lines[0] if lines else "Unknown"

                    # Find date info
                    first_seen = None
                    days_active = 0
                    for line in lines:
                        if "started running" in line.lower() or "ran from" in line.lower():
                            first_seen = _parse_date_text(line)
                            if first_seen:
                                days_active = (datetime.utcnow() - first_seen).days
                            break

                    # Get ad body text (longest line that isn't a date/CTA)
                    creative_text = None
                    for line in lines[1:]:
                        if len(line) > 50 and "started running" not in line.lower():
                            creative_text = line[:500]
                            break

                    # Get image URL
                    img = await el.query_selector("img[src*='fbcdn'], img[src*='facebook']")
                    img_url = await img.get_attribute("src") if img else None

                    # Get link URL
                    link = await el.query_selector("a[href*='http']:not([href*='facebook.com/ads/library'])")
                    link_url = None
                    if link:
                        href = await link.get_attribute("href")
                        if href and not href.startswith("javascript"):
                            link_url = href

                    if advertiser and advertiser != "Unknown":
                        ads.append({
                            "external_id": None,
                            "platform": "facebook",
                            "advertiser_name": advertiser,
                            "page_id": None,
                            "creative_text": creative_text,
                            "creative_image_url": img_url,
                            "ad_snapshot_url": url,
                            "landing_page_url": link_url,
                            "days_active": max(days_active, 0),
                            "variation_count": 1,
                            "first_seen": first_seen,
                            "last_seen": datetime.utcnow(),
                            "raw_data": {"scraped_text": text_content[:1000]},
                        })
                except Exception:
                    continue

        except PWTimeout:
            pass
        except Exception:
            pass
        finally:
            await browser.close()

    return ads


async def search_by_keyword(query: str, country: str = "US", max_results: int = 30) -> list[dict]:
    return await _scrape_library(query, "keyword", max_results)


async def search_by_advertiser(page_name: str, country: str = "US", max_results: int = 30) -> list[dict]:
    return await _scrape_library(page_name, "advertiser", max_results)


async def search_by_domain(domain: str, country: str = "US", max_results: int = 30) -> list[dict]:
    return await _scrape_library(domain, "domain", max_results)


async def get_trending(country: str = "US", max_results: int = 30) -> list[dict]:
    keywords = ["shop now", "limited offer", "free shipping"]
    all_ads: list[dict] = []
    per_kw = max(5, max_results // len(keywords))
    for kw in keywords:
        try:
            ads = await _scrape_library(kw, "keyword", per_kw)
            all_ads.extend(ads)
            await asyncio.sleep(3)
        except Exception:
            continue
    return all_ads[:max_results]
