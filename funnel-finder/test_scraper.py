"""Quick test — opens Google Ads Transparency and prints what it finds."""
import asyncio
from backend.scrapers import google, facebook


async def main():
    print("Testing Google scraper...")
    results = await google.search_by_keyword("weight loss", max_results=5)
    print(f"Google results: {len(results)}")
    for r in results:
        print(f"  - {r['advertiser_name']} | {r['days_active']}d | {r['creative_text'][:60] if r['creative_text'] else 'no copy'}")

    print("\nTesting Facebook scraper...")
    fb_results = await facebook.search_by_keyword("weight loss", max_results=5)
    print(f"Facebook results: {len(fb_results)}")
    for r in fb_results:
        print(f"  - {r['advertiser_name']} | {r['days_active']}d")


asyncio.run(main())
