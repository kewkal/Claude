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

        # Look for ad cards deep inside the Angular root
        cards = await page.evaluate("""() => {
            // Try many selectors to find ad cards
            const selectors = [
                'creative-card',
                '[class*="creative-card"]',
                'mat-card',
                '[class*="card"]',
                'advertiser-preview',
                '[class*="advertiser"]',
                'li[role="listitem"]',
                '[role="listitem"]',
                '[role="list"] > *',
                '[class*="result"]',
            ];
            for (const sel of selectors) {
                const els = document.querySelectorAll(sel);
                if (els.length > 0) {
                    return {
                        selector: sel,
                        count: els.length,
                        samples: Array.from(els).slice(0, 3).map(el => ({
                            tag: el.tagName,
                            cls: el.className?.toString().slice(0, 100),
                            text: el.innerText?.slice(0, 120)
                        }))
                    };
                }
            }
            // Fallback: dump all custom elements (Angular components)
            const custom = document.querySelectorAll('*');
            const angular = Array.from(custom).filter(el =>
                el.tagName.includes('-') || el.tagName === 'ROOT'
            ).slice(0, 15);
            return {
                selector: 'angular-components',
                count: angular.length,
                samples: angular.map(el => ({
                    tag: el.tagName,
                    cls: el.className?.toString().slice(0, 100),
                    text: el.innerText?.slice(0, 120)
                }))
            };
        }""")
        print(f"\nAd cards via selector '{cards['selector']}' — found {cards['count']}:")
        for s in cards['samples']:
            print(f"  <{s['tag']}> cls='{s['cls']}'")
            print(f"    text: {repr(s['text'])}")

        # Also dump the full inner structure of the ROOT element
        root_children = await page.evaluate("""() => {
            const root = document.querySelector('[class*="_nghost"]');
            if (!root) return [];
            return Array.from(root.querySelectorAll(':scope > * > *')).slice(0, 20).map(el => ({
                tag: el.tagName,
                cls: el.className?.toString().slice(0, 100),
                text: el.innerText?.slice(0, 80)
            }));
        }""")
        print(f"\nChildren of _nghost root ({len(root_children)}):")
        for r in root_children:
            print(f"  <{r['tag']}> cls='{r['cls']}' | {repr(r['text'])}")

        print("\nSaved screenshot to debug_google.png")
        await browser.close()


asyncio.run(main())
