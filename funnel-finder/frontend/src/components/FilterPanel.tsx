interface Props {
  minScore: number
  platform: string
  sortBy: string
  onChange: (key: string, value: string | number) => void
}

export function FilterPanel({ minScore, platform, sortBy, onChange }: Props) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
      <h3 className="text-sm font-semibold text-white">Filters</h3>

      <div>
        <label className="text-xs text-slate-400 block mb-1">
          Min Winning Score: <span className="text-accent font-bold">{minScore}</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          value={minScore}
          onChange={(e) => onChange('minScore', Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1">Platform</label>
        {['both', 'facebook', 'google'].map((p) => (
          <button
            key={p}
            onClick={() => onChange('platform', p)}
            className={`block w-full text-left text-sm px-3 py-1.5 rounded-lg mb-1 transition-colors ${
              platform === p ? 'bg-accent text-white' : 'text-slate-400 hover:bg-slate-700/50'
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1">Sort By</label>
        {[
          { value: 'score', label: 'Winning Score' },
          { value: 'longevity', label: 'Days Active' },
          { value: 'date', label: 'Most Recent' },
        ].map((s) => (
          <button
            key={s.value}
            onClick={() => onChange('sortBy', s.value)}
            className={`block w-full text-left text-sm px-3 py-1.5 rounded-lg mb-1 transition-colors ${
              sortBy === s.value ? 'bg-accent text-white' : 'text-slate-400 hover:bg-slate-700/50'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
