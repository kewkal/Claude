"""
Google Ads Transparency Center scraper using Playwright.
Browses https://adstransparency.google.com directly — no API key needed.
"""
import asyncio
import re
from datetime import datetime
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

TRANSPARENCY_URL = "https://adstransparency.google.com"

CHROMIUM_PATH = "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"


def _days_active(text: str) -> int:
    """Extract days active from date strings like 'Nov 1, 2024'."""
    try:
        match = re.search(r'(\w{3} \d+, \d{4})', text)
        if match:
            dt = datetime.strptime(match.group(1), "%b %d, %Y")
            return max(0, (datetime.utcnow() - dt).days)
    except Exception:
        pass
    return 0


def _first_seen(text: str) -> datetime | None:
    try:
        match = re.search(r'(\w{3} \d+, \d{4})', text)
        if match:
            return datetime.strptime(match.group(1), "%b %d, %Y")
    except Exception:
        pass
    return None


async def _launch_browser(pw):
    import platform
    is_windows = platform.system() == "Windows"
    if is_windows:
        # Use system Playwright install on Windows
        return await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
    return await pw.chromium.launch(
        headless=True,
        executable_path=CHROMIUM_PATH,
        args=["--no-sandbox", "--disable-dev-shm-usage"],
    )


async def _scrape(query: str, query_type: str, max_results: int = 30) -> list[dict]:
    ads: list[dict] = []

    # Build search URL
    if query_type == "keyword":
        url = f"{TRANSPARENCY_URL}/?region=US&query={query.replace(' ', '+')}"
    elif query_type == "domain":
        url = f"{TRANSPARENCY_URL}/?region=US&domain={query}"
    elif query_type == "advertiser":
        url = f"{TRANSPARENCY_URL}/?region=US&query={query.replace(' ', '+')}"
    else:
        url = f"{TRANSPARENCY_URL}/?region=US&query=shop+now"

    async with async_playwright() as pw:
        browser = await _launch_browser(pw)
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            locale="en-US",
        )
        page = await ctx.new_page()
        await page.route("**/*.{woff,woff2,ttf,otf}", lambda r: r.abort())

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=25000)
            await asyncio.sleep(4)

            # Scroll to load more
            for _ in range(3):
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await asyncio.sleep(2)

            # Get all ad cards — Google Transparency uses material cards
            cards = await page.query_selector_all(
                "mat-card, "
                "[class*='creative-card'], "
                "[class*='ad-card'], "
                "div[role='listitem']"
            )

            if not cards:
                # Fallback: grab all substantial text blocks
                cards = await page.query_selector_all("article, section > div")

            for card in cards[:max_results]:
                try:
                    text = await card.inner_text()
                    lines = [l.strip() for l in text.split('\n') if l.strip()]
                    if not lines or len(text) < 20:
                        continue

                    advertiser = lines[0]
                    creative_text = next(
                        (l for l in lines[1:] if len(l) > 30 and not re.search(r'\d{4}', l)),
                        None
                    )

                    date_line = next((l for l in lines if re.search(r'\w{3} \d+, \d{4}', l)), "")
                    days = _days_active(date_line)
                    seen = _first_seen(date_line)

                    img = await card.query_selector("img")
                    img_url = await img.get_attribute("src") if img else None

                    link = await card.query_selector("a[href]")
                    link_url = await link.get_attribute("href") if link else None

                    if advertiser:
                        ads.append({
                            "external_id": None,
                            "platform": "google",
                            "advertiser_name": advertiser,
                            "page_id": None,
                            "creative_text": creative_text,
                            "creative_image_url": img_url,
                            "ad_snapshot_url": url,
                            "landing_page_url": link_url,
                            "days_active": days,
                            "variation_count": 1,
                            "first_seen": seen,
                            "last_seen": datetime.utcnow(),
                            "raw_data": {"scraped_text": text[:500]},
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


async def search_by_keyword(query: str, max_results: int = 30) -> list[dict]:
    return await _scrape(query, "keyword", max_results)


async def search_by_advertiser(name: str, max_results: int = 30) -> list[dict]:
    return await _scrape(name, "advertiser", max_results)


async def search_by_domain(domain: str, max_results: int = 30) -> list[dict]:
    return await _scrape(domain, "domain", max_results)


async def get_trending(max_results: int = 30) -> list[dict]:
    keywords = ["shop now", "limited offer", "free trial"]
    all_ads: list[dict] = []
    per_kw = max(5, max_results // len(keywords))
    for kw in keywords:
        try:
            ads = await _scrape(kw, "keyword", per_kw)
            all_ads.extend(ads)
            await asyncio.sleep(3)
        except Exception:
            continue
    return all_ads[:max_results]
