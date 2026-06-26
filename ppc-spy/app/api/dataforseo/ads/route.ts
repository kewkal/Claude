import { NextRequest, NextResponse } from "next/server";
import { MOCK_ADS } from "@/app/lib/mockData";

const DFS_BASE = "https://api.dataforseo.com/v3";

function authHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error("DataForSEO credentials not configured");
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

export async function POST(req: NextRequest) {
  const { domain, locationCode = 2840, languageCode = "en" } = await req.json();

  if (!domain) return NextResponse.json({ error: "domain is required" }, { status: 400 });

  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ ads: MOCK_ADS });
  }

  try {
    const res = await fetch(`${DFS_BASE}/serp/google/ads/live/advanced`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          keyword: `site:${domain}`,
          location_code: locationCode,
          language_code: languageCode,
          depth: 10,
        },
      ]),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `DataForSEO error: ${text}` }, { status: res.status });
    }

    const data = await res.json();
    const items: Record<string, unknown>[] = data?.tasks?.[0]?.result?.[0]?.items ?? [];

    const ads = items
      .filter((item) => item.type === "paid")
      .map((item) => ({
        keyword: item.keyword ?? "",
        headline: (item.title as string) ?? "",
        description: (item.description as string) ?? "",
        displayUrl: (item.url as string) ?? "",
        position: item.rank_absolute ?? null,
      }));

    return NextResponse.json({ ads });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
