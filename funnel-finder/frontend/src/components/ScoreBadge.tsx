export function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80
      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
      : score >= 50
      ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
      : 'bg-slate-500/20 text-slate-400 border-slate-500/30'

  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${color}`}>
      {score.toFixed(0)}
    </span>
  )
}
