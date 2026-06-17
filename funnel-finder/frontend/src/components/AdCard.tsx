import { useNavigate } from 'react-router-dom'
import type { Ad } from '../api/client'
import { ScoreBadge } from './ScoreBadge'

const PLATFORM_COLORS: Record<string, string> = {
  facebook: 'bg-blue-600/20 text-blue-400',
  google: 'bg-red-600/20 text-red-400',
}

export function AdCard({ ad }: { ad: Ad }) {
  const nav = useNavigate()

  return (
    <div
      onClick={() => nav(`/ad/${ad.id}`)}
      className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-accent transition-colors group"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${PLATFORM_COLORS[ad.platform] ?? 'bg-slate-700 text-slate-300'}`}>
            {ad.platform}
          </span>
          <span className="text-sm font-semibold text-white truncate">{ad.advertiser_name}</span>
        </div>
        <ScoreBadge score={ad.winning_score} />
      </div>

      {/* Creative image */}
      {ad.creative_image_url && (
        <img
          src={ad.creative_image_url}
          alt="Ad creative"
          className="w-full h-40 object-cover rounded-lg mb-3 bg-slate-800"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}

      {/* Landing page screenshot (thumbnail) */}
      {!ad.creative_image_url && ad.landing_page?.screenshot_path && (
        <img
          src={`/data/${ad.landing_page.screenshot_path}`}
          alt="Landing page"
          className="w-full h-40 object-cover object-top rounded-lg mb-3 bg-slate-800"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}

      {/* Ad copy */}
      {ad.creative_text && (
        <p className="text-slate-300 text-sm line-clamp-3 mb-3">{ad.creative_text}</p>
      )}

      {/* Landing page headline */}
      {ad.landing_page?.headline && (
        <p className="text-white text-sm font-medium line-clamp-2 mb-3">
          "{ad.landing_page.headline}"
        </p>
      )}

      {/* Tech chips */}
      {ad.landing_page?.tech_stack && (
        <div className="flex flex-wrap gap-1 mb-3">
          {(ad.landing_page.tech_stack.tools as string[] | undefined)?.slice(0, 4).map((t) => (
            <span key={t} className="text-xs bg-slate-700/50 text-slate-400 px-1.5 py-0.5 rounded">
              {t}
            </span>
          ))}
          {ad.landing_page.has_vsl && (
            <span className="text-xs bg-purple-700/30 text-purple-400 px-1.5 py-0.5 rounded">VSL</span>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span>{ad.days_active}d active</span>
        {ad.variation_count > 1 && <span>{ad.variation_count} variants</span>}
        {ad.landing_page_url && (
          <span className="truncate text-slate-600">{new URL(ad.landing_page_url).hostname}</span>
        )}
      </div>
    </div>
  )
}
