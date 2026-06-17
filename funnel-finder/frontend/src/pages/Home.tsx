import { useEffect, useRef, useState } from 'react'
import { api, type Ad, type Job, type SearchRequest } from '../api/client'
import { AdCard } from '../components/AdCard'
import { FilterPanel } from '../components/FilterPanel'
import { SearchBar } from '../components/SearchBar'

export function Home() {
  const [ads, setAds] = useState<Ad[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [filters, setFilters] = useState({ minScore: 0, platform: 'both', sortBy: 'score' })
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load trending on mount
  useEffect(() => {
    api.getTrending().then((res) => {
      setAds(res.items)
      setTotal(res.total)
    }).catch(() => {})
  }, [])

  const handleSearch = async (req: SearchRequest) => {
    setLoading(true)
    setAds([])
    setTotal(0)
    setPage(1)
    try {
      const j = await api.search(req)
      setJob(j)
      pollRef.current = setInterval(async () => {
        const updated = await api.getJob(j.id)
        setJob(updated)
        if (updated.status === 'done' || updated.status === 'failed') {
          clearInterval(pollRef.current!)
          setLoading(false)
          if (updated.status === 'done') {
            loadAds(j.id, 1)
          }
        }
      }, 2000)
    } catch (e) {
      setLoading(false)
    }
  }

  const loadAds = async (jobId: number, p: number) => {
    const res = await api.getAds({
      job_id: jobId,
      platform: filters.platform !== 'both' ? filters.platform : undefined,
      min_score: filters.minScore || undefined,
      sort_by: filters.sortBy,
      page: p,
      limit: 20,
    })
    setAds(p === 1 ? res.items : (prev) => [...prev, ...res.items])
    setTotal(res.total)
    setPage(p)
  }

  const handleFilterChange = (key: string, value: string | number) => {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <span className="text-xl font-bold text-white">Winning Funnel Finder</span>
        <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded">BETA</span>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <SearchBar onSearch={handleSearch} loading={loading} />

        {/* Job progress */}
        {job && job.status === 'running' && (
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-slate-400">Scanning ads… </span>
              <span className="text-accent font-medium">{job.progress}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-1.5">
              <div
                className="bg-accent h-1.5 rounded-full transition-all"
                style={{ width: `${job.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {job?.error && (
          <div className="bg-red-900/20 border border-red-800 text-red-400 rounded-xl p-4 text-sm">
            {job.error}
          </div>
        )}

        <div className="flex gap-6">
          {/* Sidebar */}
          <aside className="w-56 flex-shrink-0">
            <FilterPanel
              minScore={filters.minScore}
              platform={filters.platform}
              sortBy={filters.sortBy}
              onChange={handleFilterChange}
            />
          </aside>

          {/* Results */}
          <div className="flex-1">
            {total > 0 && (
              <p className="text-slate-500 text-sm mb-4">{total} funnels found</p>
            )}
            {ads.length === 0 && !loading && (
              <div className="text-center py-20 text-slate-600">
                <p className="text-lg">Search for a keyword, domain, or advertiser to find winning funnels.</p>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {ads.map((ad) => <AdCard key={ad.id} ad={ad} />)}
            </div>
            {job && ads.length < total && (
              <div className="mt-6 text-center">
                <button
                  onClick={() => loadAds(job.id, page + 1)}
                  className="bg-card border border-border text-slate-300 px-6 py-2.5 rounded-lg hover:border-accent transition-colors text-sm"
                >
                  Load more
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
