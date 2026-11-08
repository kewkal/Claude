import asyncio
import httpx
import json

async def test():
    url = "https://adstransparency.google.com/api/trpc/creative.list"
    input_data = {"region": "US", "searchQuery": "weight loss", "pageSize": 5}
    params = {"input": json.dumps({"0": input_data})}
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://adstransparency.google.com/",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(follow_redirects=True) as client:
        r = await client.get(url, params=params, headers=headers, timeout=15)
        print("Status:", r.status_code)
        print("Response:", r.text[:500])

asyncio.run(test())
