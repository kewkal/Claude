"use client";

import { useState, type ReactNode } from "react";
import { fmtCount, fmtTimestamp } from "@/lib/format";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function CardSkeletons({ count = 3, height = "h-28" }: { count?: number; height?: string }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={`w-full ${height}`} />
      ))}
    </div>
  );
}

const ERROR_HINTS: Record<string, string> = {
  SERPAPI_QUOTA: "Cached searches still work. You can turn on the override in Settings.",
  SERPAPI_NOT_CONFIGURED: "Add SERPAPI_API_KEY in your environment variables.",
  CLAUDE_BUDGET: "Raise CLAUDE_MONTHLY_BUDGET_USD or enable the override in Settings.",
  CLAUDE_NOT_CONFIGURED: "Add ANTHROPIC_API_KEY in your environment variables.",
};

export function ErrorState({
  message,
  code,
  action,
}: {
  message: string;
  code?: string;
  action?: ReactNode;
}) {
  const hint = code ? ERROR_HINTS[code] : undefined;
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm">
      <p className="font-semibold text-danger">{message}</p>
      {hint && <p className="mt-1 text-muted">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card p-6 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "ai";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  ai: "bg-ai-soft text-ai",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${TONES[tone]}`} title={title}>
      {children}
    </span>
  );
}

/** Marks text that Claude wrote (as opposed to sourced facts). */
export function AiText({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border-l-4 border-ai bg-ai-soft/60 px-3 py-2 text-sm ${className}`}>
      <span className="mr-1 text-[0.7rem] font-bold uppercase tracking-wide text-ai">AI suggestion</span>
      <span>{children}</span>
    </div>
  );
}

export function VerifiedBadge({ threshold }: { threshold: number }) {
  return (
    <Badge tone="ok" title={`At least one source shows ${threshold}+ reviews`}>
      ✓ Verified
    </Badge>
  );
}

/** Small "i" that reveals an explanation on tap/hover (works on touch screens). */
export function InfoTip({ children, label = "How is this calculated?" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[0.7rem] font-bold text-muted"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-6 z-30 w-64 -translate-x-1/2 rounded-lg border border-border bg-surface p-3 text-xs font-normal text-text shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}

export function Rating({ rating, reviews, source }: { rating: number | null; reviews: number | null; source?: string }) {
  if (rating === null) return <span className="text-xs text-muted">No rating{source ? ` on ${source}` : ""}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <span className="font-semibold">★ {rating.toFixed(1)}</span>
      <span className="text-muted">({fmtCount(reviews)})</span>
      {source && <span className="text-xs text-muted">· {source}</span>}
    </span>
  );
}

export function FetchedAt({ iso, source }: { iso: string; source?: string }) {
  return (
    <span className="text-[0.7rem] text-muted">
      {source ? `${source} · ` : ""}fetched {fmtTimestamp(iso)}
    </span>
  );
}

export function SourceLink({ href, children }: { href?: string | null; children: ReactNode }) {
  if (!href) return <span className="text-xs text-muted">{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-accent underline-offset-2 hover:underline">
      {children} ↗
    </a>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-semibold ${value === o.value ? "bg-surface text-text shadow-sm" : "text-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-sm">
      <span>{label}</span>
      <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-surface p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky -top-4 z-10 -mx-4 -mt-4 mb-3 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <h2 className="pr-4 text-lg font-bold leading-tight">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost btn px-3" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
