"""
Google Ads Transparency Center scraper.
Public endpoint — no API key required but subject to rate limits.
"""
import asyncio
import json
import re
from datetime import datetime
import httpx


TRANSPARENCY_SEARCH = "https://adstransparency.google.com/api/trpc/creative.list"
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]
_ua_index = 0


def _next_ua() -> str:
    global _ua_index
    ua = USER_AGENTS[_ua_index % len(USER_AGENTS)]
    _ua_index += 1
    return ua


def _build_input(query: str, query_type: str, token: str | None = None) -> dict:
    inp: dict = {
        "region": "US",
        "searchQuery": query if query_type != "domain" else None,
        "advertiserQuery": query if query_type == "advertiser" else None,
        "domainQuery": query if query_type == "domain" else None,
        "pageSize": 50,
    }
    if token:
        inp["pageToken"] = token
    # Remove None values
    return {k: v for k, v in inp.items() if v is not None}


def _parse_creative(item: dict) -> dict | None:
    try:
        advertiser = item.get("advertiser", {})
        creative = item.get("creative", {})
        dates = item.get("dateRange", {})

        first_str = dates.get("startDate", {})
        last_str = dates.get("endDate", {})

        def _parse_date(d: dict) -> datetime | None:
            if not d:
                return None
            try:
                return datetime(int(d["year"]), int(d["month"]), int(d["day"]))
            except Exception:
                return None

        first_seen = _parse_date(first_str)
        last_seen = _parse_date(last_str) or datetime.utcnow()
        days_active = (last_seen - first_seen).days if first_seen else 0

        image_url = None
        for media in creative.get("renderedCreatives", []):
            if media.get("screenshotUrl"):
                image_url = media["screenshotUrl"]
                break

        return {
            "external_id": item.get("creativeId"),
            "platform": "google",
            "advertiser_name": advertiser.get("advertiserName", "Unknown"),
            "page_id": advertiser.get("advertiserId"),
            "creative_text": creative.get("adText"),
            "creative_image_url": image_url,
            "ad_snapshot_url": f"https://adstransparency.google.com/advertiser/{advertiser.get('advertiserId')}/creative/{item.get('creativeId')}",
            "landing_page_url": creative.get("destinationUrl"),
            "days_active": days_active,
            "first_seen": first_seen,
            "last_seen": last_seen,
            "raw_data": item,
        }
    except Exception:
        return None


async def _trpc_search(client: httpx.AsyncClient, query: str, query_type: str, token: str | None = None) -> dict:
    input_data = _build_input(query, query_type, token)
    params = {"input": json.dumps({"0": input_data})}
    headers = {
        "User-Agent": _next_ua(),
        "Accept": "application/json",
        "Referer": "https://adstransparency.google.com/",
    }
    resp = await client.get(TRANSPARENCY_SEARCH, params=params, headers=headers, timeout=20)
    resp.raise_for_status()
    return resp.json()


async def _search(query: str, query_type: str, max_results: int = 50) -> list[dict]:
    ads: list[dict] = []
    next_token: str | None = None
    delay = 2.0

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for _ in range(5):
            try:
                raw = await _trpc_search(client, query, query_type, next_token)
                result = raw[0].get("result", {}).get("data", {})
                items = result.get("creatives", [])
                for item in items:
                    parsed = _parse_creative(item)
                    if parsed and parsed["days_active"] >= 7:
                        ads.append(parsed)

                next_token = result.get("nextPageToken")
                if not next_token or len(ads) >= max_results:
                    break
                await asyncio.sleep(delay)
                delay = min(delay * 1.5, 8.0)
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429:
                    await asyncio.sleep(delay * 2)
                    delay *= 2
                else:
                    break
            except Exception:
                break

    return ads[:max_results]


async def search_by_keyword(query: str, max_results: int = 50) -> list[dict]:
    return await _search(query, "keyword", max_results)


async def search_by_advertiser(name: str, max_results: int = 50) -> list[dict]:
    return await _search(name, "advertiser", max_results)


async def search_by_domain(domain: str, max_results: int = 50) -> list[dict]:
    return await _search(domain, "domain", max_results)


async def get_trending(max_results: int = 50) -> list[dict]:
    keywords = ["sale", "offer", "free", "download", "subscribe"]
    all_ads: list[dict] = []
    per_kw = max(5, max_results // len(keywords))
    for kw in keywords:
        try:
            ads = await search_by_keyword(kw, per_kw)
            all_ads.extend(ads)
            await asyncio.sleep(2)
        except Exception:
            continue
    return all_ads[:max_results]
