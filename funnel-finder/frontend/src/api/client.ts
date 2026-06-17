const BASE = '/api'

export interface SearchRequest {
  query: string
  query_type: 'keyword' | 'domain' | 'advertiser' | 'trending'
  platform: 'facebook' | 'google' | 'both'
}

export interface Job {
  id: number
  query: string
  query_type: string
  platform: string
  status: string
  progress: number
  results_count: number
  error: string | null
  created_at: string
}

export interface LandingPage {
  id: number
  url: string
  final_url: string | null
  screenshot_path: string | null
  headline: string | null
  subheadline: string | null
  ctas: string[] | null
  tech_stack: Record<string, unknown> | null
  offer_angle: string | null
  has_vsl: boolean
}

export interface Ad {
  id: number
  platform: 'facebook' | 'google'
  advertiser_name: string
  creative_text: string | null
  creative_image_url: string | null
  ad_snapshot_url: string | null
  landing_page_url: string | null
  days_active: number
  variation_count: number
  winning_score: number
  first_seen: string | null
  last_seen: string | null
  landing_page: LandingPage | null
}

export interface AdList {
  total: number
  page: number
  limit: number
  items: Ad[]
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export const api = {
  search: (body: SearchRequest) =>
    req<Job>('/search', { method: 'POST', body: JSON.stringify(body) }),

  getJob: (id: number) => req<Job>(`/jobs/${id}`),

  getAds: (params: {
    job_id?: number
    platform?: string
    min_score?: number
    sort_by?: string
    page?: number
    limit?: number
  }) => {
    const qs = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => v !== undefined && qs.set(k, String(v)))
    return req<AdList>(`/ads?${qs}`)
  },

  getAd: (id: number) => req<Ad>(`/ads/${id}`),

  getTrending: () => req<AdList>('/trending'),
}
