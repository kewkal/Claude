import { useState } from 'react'
import type { SearchRequest } from '../api/client'

const TABS: { type: SearchRequest['query_type']; label: string; placeholder: string }[] = [
  { type: 'keyword', label: 'Keyword', placeholder: 'e.g. weight loss supplement' },
  { type: 'domain', label: 'Domain', placeholder: 'e.g. competitor.com' },
  { type: 'advertiser', label: 'Advertiser', placeholder: 'e.g. Brand Name' },
  { type: 'trending', label: 'Trending', placeholder: 'Browse top performing ads' },
]

interface Props {
  onSearch: (req: SearchRequest) => void
  loading: boolean
}

export function SearchBar({ onSearch, loading }: Props) {
  const [tab, setTab] = useState<SearchRequest['query_type']>('keyword')
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState<SearchRequest['platform']>('both')

  const current = TABS.find((t) => t.type === tab)!

  const submit = () => {
    onSearch({ query: tab === 'trending' ? '' : query, query_type: tab, platform })
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.type}
            onClick={() => setTab(t.type)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t.type ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Input row */}
      <div className="flex gap-2">
        {tab !== 'trending' && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={current.placeholder}
            className="flex-1 bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent"
          />
        )}

        {/* Platform toggle */}
        <div className="flex border border-border rounded-lg overflow-hidden">
          {(['both', 'facebook', 'google'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                platform === p ? 'bg-accent text-white' : 'text-slate-400 hover:bg-slate-700/50'
              }`}
            >
              {p === 'both' ? 'Both' : p === 'facebook' ? 'FB' : 'GG'}
            </button>
          ))}
        </div>

        <button
          onClick={submit}
          disabled={loading || (tab !== 'trending' && !query.trim())}
          className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors"
        >
          {loading ? 'Searching…' : 'Find Funnels'}
        </button>
      </div>
    </div>
  )
}
