import { NextRequest, NextResponse } from "next/server";
import { MOCK_KEYWORDS } from "@/app/lib/mockData";

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
    return NextResponse.json({ keywords: MOCK_KEYWORDS });
  }

  try {
    const res = await fetch(`${DFS_BASE}/dataforseo_labs/google/domain_intersection/live`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          target1: domain,
          target2: domain,
          location_code: locationCode,
          language_code: languageCode,
          paid: true,
          limit: 100,
        },
      ]),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `DataForSEO error: ${text}` }, { status: res.status });
    }

    const data = await res.json();
    const items = data?.tasks?.[0]?.result?.[0]?.items ?? [];

    const keywords = items.map((item: Record<string, unknown>) => {
      const metrics = (item.keyword_data as Record<string, unknown>)?.keyword_info as Record<string, unknown>;
      return {
        keyword: item.keyword,
        searchVolume: metrics?.search_volume ?? 0,
        cpc: metrics?.cpc ?? 0,
        competition: metrics?.competition ?? 0,
        domain1Pos: (item.first_domain_serp_element as Record<string, unknown>)?.rank_absolute ?? null,
      };
    });

    return NextResponse.json({ keywords });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
