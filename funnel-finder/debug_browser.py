"""Debug test — takes a screenshot of what Playwright actually sees."""
import asyncio
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False)  # visible window
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        page = await ctx.new_page()

        print("Loading Google Ads Transparency...")
        await page.goto(
            "https://adstransparency.google.com/",
            wait_until="domcontentloaded",
            timeout=30000,
        )
        await asyncio.sleep(3)

        # Type into the search box using the known class
        search_input = await page.query_selector("input.input-area")
        if search_input:
            print("Found search input, typing...")
            await search_input.click()
            await page.keyboard.type("weight loss supplement", delay=80)
            await page.keyboard.press("Enter")
            print("Typed and submitted, waiting for results...")
            await asyncio.sleep(6)
        else:
            print("Search input NOT found")
        await asyncio.sleep(2)
        await page.screenshot(path="debug_google.png", full_page=False)

        # Print all tag names and class names of top-level children
        tags = await page.evaluate("""() => {
            const all = document.querySelectorAll('body > * > *');
            return Array.from(all).slice(0, 20).map(el => ({
                tag: el.tagName,
                cls: el.className?.toString().slice(0, 80),
                text: el.innerText?.slice(0, 60)
            }));
        }""")
        print("Page elements found:")
        for t in tags:
            print(f"  <{t['tag']}> class='{t['cls']}' text='{t['text']}'")

        print("\nSaved screenshot to debug_google.png")
        await browser.close()


asyncio.run(main())
