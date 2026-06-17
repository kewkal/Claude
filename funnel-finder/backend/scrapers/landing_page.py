"""
Landing page scraper using Playwright.
Captures screenshot, archives HTML, and follows redirects.
"""
import asyncio
import hashlib
from pathlib import Path
from playwright.async_api import async_playwright, TimeoutError as PWTimeout
from backend.config import settings


async def analyze(url: str) -> dict:
    """
    Visit a landing page and return:
    - final_url: after all redirects
    - screenshot_path: relative path to saved PNG
    - html_path: relative path to saved HTML
    - html: raw HTML string for further analysis
    """
    result = {
        "url": url,
        "final_url": url,
        "screenshot_path": None,
        "html_path": None,
        "html": "",
        "error": None,
    }

    url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
    screenshot_file = settings.screenshots_dir / f"{url_hash}.png"
    html_file = settings.html_dir / f"{url_hash}.html"

    # Return cached result if already analyzed
    if screenshot_file.exists() and html_file.exists():
        result["screenshot_path"] = f"screenshots/{url_hash}.png"
        result["html_path"] = f"html/{url_hash}.html"
        result["html"] = html_file.read_text(errors="replace")
        result["final_url"] = url
        return result

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            ctx = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            )
            page = await ctx.new_page()

            try:
                response = await page.goto(
                    url,
                    wait_until="domcontentloaded",
                    timeout=settings.screenshot_timeout_ms,
                )
                result["final_url"] = page.url

                # Wait a bit for JS-rendered content
                await asyncio.sleep(2)

                await page.screenshot(path=str(screenshot_file), full_page=True)
                html = await page.content()
                html_file.write_text(html, encoding="utf-8")

                result["screenshot_path"] = f"screenshots/{url_hash}.png"
                result["html_path"] = f"html/{url_hash}.html"
                result["html"] = html

            except PWTimeout:
                result["error"] = "Page load timed out"
            finally:
                await browser.close()

    except Exception as e:
        result["error"] = str(e)

    return result
