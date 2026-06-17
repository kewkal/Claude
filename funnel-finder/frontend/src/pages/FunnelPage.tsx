import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, type Ad } from '../api/client'
import { ScoreBadge } from '../components/ScoreBadge'

const PLATFORM_COLORS: Record<string, string> = {
  facebook: 'bg-blue-600/20 text-blue-400',
  google: 'bg-red-600/20 text-red-400',
}

export function FunnelPage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const [ad, setAd] = useState<Ad | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!id) return
    api.getAd(Number(id)).then(setAd).catch(() => setErr('Failed to load ad'))
  }, [id])

  if (err) return <div className="text-red-400 p-8">{err}</div>
  if (!ad) return <div className="text-slate-500 p-8">Loading…</div>

  const lp = ad.landing_page
  const tech = lp?.tech_stack as Record<string, unknown> | null
  const tools = (tech?.tools as string[]) ?? []

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-4">
        <button onClick={() => nav(-1)} className="text-slate-400 hover:text-white text-sm">← Back</button>
        <span className="text-white font-semibold">{ad.advertiser_name}</span>
        <span className={`text-xs px-2 py-0.5 rounded ${PLATFORM_COLORS[ad.platform]}`}>{ad.platform}</span>
        <ScoreBadge score={ad.winning_score} />
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left — Ad creative */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Ad Creative</h2>

          {ad.creative_image_url && (
            <img src={ad.creative_image_url} alt="Ad" className="w-full rounded-xl bg-card" />
          )}

          {ad.creative_text && (
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-sm text-slate-300 leading-relaxed">{ad.creative_text}</p>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Days Active" value={`${ad.days_active}d`} />
            <Stat label="Variants" value={String(ad.variation_count)} />
            <Stat label="Score" value={`${ad.winning_score}/100`} highlight />
          </div>

          {ad.ad_snapshot_url && (
            <a
              href={ad.ad_snapshot_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-sm text-accent hover:underline"
            >
              View original ad →
            </a>
          )}
        </div>

        {/* Right — Landing page */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Landing Page</h2>

          {lp?.screenshot_path ? (
            <a href={lp.final_url ?? lp.url} target="_blank" rel="noopener noreferrer">
              <img
                src={`/data/${lp.screenshot_path}`}
                alt="Landing page"
                className="w-full rounded-xl border border-border hover:border-accent transition-colors"
              />
            </a>
          ) : (
            <div className="w-full h-48 bg-card border border-border rounded-xl flex items-center justify-center text-slate-600 text-sm">
              No screenshot available
            </div>
          )}

          {/* Copy */}
          {(lp?.headline || lp?.subheadline) && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              {lp.headline && <p className="text-white font-bold">{lp.headline}</p>}
              {lp.subheadline && <p className="text-slate-400 text-sm">{lp.subheadline}</p>}
            </div>
          )}

          {/* CTAs */}
          {lp?.ctas && lp.ctas.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-2 uppercase tracking-wide">CTAs found</p>
              <div className="flex flex-wrap gap-2">
                {lp.ctas.map((cta, i) => (
                  <span key={i} className="bg-accent/20 text-accent text-sm px-3 py-1 rounded-lg border border-accent/30">
                    {cta}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Offer angle */}
          {lp?.offer_angle && (
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide">Offer Angle</p>
              <p className="text-sm text-slate-300 leading-relaxed">{lp.offer_angle}</p>
            </div>
          )}

          {/* Tech stack */}
          {tools.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Tech Stack</p>
              <div className="flex flex-wrap gap-2">
                {lp?.has_vsl && (
                  <span className="bg-purple-700/30 text-purple-400 text-xs px-2.5 py-1 rounded-lg border border-purple-700/40">
                    VSL
                  </span>
                )}
                {tools.map((t) => (
                  <span key={t} className="bg-slate-700/50 text-slate-300 text-xs px-2.5 py-1 rounded-lg border border-border">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* HTML download */}
          {lp?.html_path && (
            <a
              href={`/data/${lp.html_path}`}
              download
              className="block text-center text-sm bg-card border border-border text-slate-300 px-4 py-2 rounded-lg hover:border-accent transition-colors"
            >
              Download full HTML archive
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3 text-center">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${highlight ? 'text-accent' : 'text-white'}`}>{value}</p>
    </div>
  )
}
