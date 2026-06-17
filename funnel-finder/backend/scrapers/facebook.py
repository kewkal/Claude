"""
Facebook Ad Library API client.
Docs: https://developers.facebook.com/docs/marketing-api/reference/ads_archive/
Requires a Facebook Graph API token with ads_read permission.
"""
import asyncio
from datetime import datetime, timedelta
import httpx
from backend.config import settings


FB_API_BASE = "https://graph.facebook.com/v19.0/ads_archive"

AD_FIELDS = ",".join([
    "id",
    "page_name",
    "page_id",
    "ad_creative_bodies",
    "ad_creative_link_captions",
    "ad_creative_link_descriptions",
    "ad_creative_link_titles",
    "ad_snapshot_url",
    "ad_delivery_start_time",
    "ad_delivery_stop_time",
    "impressions",
    "spend",
    "currency",
    "languages",
    "publisher_platforms",
])


async def _fetch_page(client: httpx.AsyncClient, params: dict) -> dict:
    resp = await client.get(FB_API_BASE, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _parse_ad(raw: dict) -> dict:
    start_str = raw.get("ad_delivery_start_time")
    stop_str = raw.get("ad_delivery_stop_time")
    first_seen = datetime.fromisoformat(start_str) if start_str else None
    last_seen = datetime.fromisoformat(stop_str) if stop_str else datetime.utcnow()
    days_active = (last_seen - first_seen).days if first_seen else 0

    bodies = raw.get("ad_creative_bodies") or []
    creative_text = bodies[0] if bodies else None

    # Extract landing page from link captions or descriptions
    captions = raw.get("ad_creative_link_captions") or []
    landing_page_url = captions[0] if captions else None

    return {
        "external_id": raw.get("id"),
        "platform": "facebook",
        "advertiser_name": raw.get("page_name", "Unknown"),
        "page_id": raw.get("page_id"),
        "creative_text": creative_text,
        "ad_snapshot_url": raw.get("ad_snapshot_url"),
        "landing_page_url": landing_page_url,
        "days_active": days_active,
        "first_seen": first_seen,
        "last_seen": last_seen,
        "raw_data": raw,
    }


async def search_by_keyword(query: str, country: str = "US", max_results: int = 50) -> list[dict]:
    if not settings.fb_access_token:
        raise ValueError("FB_ACCESS_TOKEN not set. Copy .env.example to .env and add your token.")

    params = {
        "access_token": settings.fb_access_token,
        "search_terms": query,
        "ad_type": "ALL",
        "ad_reached_countries": f'["{country}"]',
        "fields": AD_FIELDS,
        "limit": min(max_results, 50),
    }

    ads = []
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)

    async with httpx.AsyncClient() as client:
        while len(ads) < max_results:
            data = await _fetch_page(client, params)
            for raw in data.get("data", []):
                parsed = _parse_ad(raw)
                # Only include ads active for 30+ days
                if parsed["days_active"] >= 30:
                    ads.append(parsed)

            paging = data.get("paging", {})
            next_cursor = paging.get("cursors", {}).get("after")
            if not next_cursor or not paging.get("next"):
                break
            params["after"] = next_cursor
            await asyncio.sleep(0.5)

    return ads[:max_results]


async def search_by_advertiser(page_name: str, country: str = "US", max_results: int = 50) -> list[dict]:
    if not settings.fb_access_token:
        raise ValueError("FB_ACCESS_TOKEN not set.")

    params = {
        "access_token": settings.fb_access_token,
        "search_page_ids": page_name,
        "ad_type": "ALL",
        "ad_reached_countries": f'["{country}"]',
        "fields": AD_FIELDS,
        "limit": min(max_results, 50),
    }

    # Try by page name search first
    params_name = dict(params)
    params_name.pop("search_page_ids")
    params_name["search_terms"] = page_name

    ads = []
    async with httpx.AsyncClient() as client:
        data = await _fetch_page(client, params_name)
        for raw in data.get("data", []):
            if page_name.lower() in raw.get("page_name", "").lower():
                parsed = _parse_ad(raw)
                ads.append(parsed)

    return ads[:max_results]


async def search_by_domain(domain: str, country: str = "US", max_results: int = 50) -> list[dict]:
    """Search for ads linking to a specific domain."""
    return await search_by_keyword(domain, country, max_results)


async def get_trending(country: str = "US", max_results: int = 50) -> list[dict]:
    """Fetch broadly trending ads — uses popular keywords across niches."""
    trending_keywords = ["buy now", "limited offer", "free trial", "get started", "shop now"]
    all_ads: list[dict] = []
    per_kw = max(5, max_results // len(trending_keywords))
    for kw in trending_keywords:
        try:
            ads = await search_by_keyword(kw, country, per_kw)
            all_ads.extend(ads)
        except Exception:
            continue
    return all_ads[:max_results]
