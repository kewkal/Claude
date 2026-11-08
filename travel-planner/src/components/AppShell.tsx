"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { UsageSummary } from "@/lib/usage";

const NAV = [
  { href: "/", label: "Plan", icon: "M12 3l9 7-1.5 1.5L18 10.3V20h-4v-6h-4v6H6v-9.7L4.5 11.5 3 10z" },
  { href: "/flights", label: "Flights", icon: "M21 15.5l-8-4.5V5.5a1.5 1.5 0 00-3 0V11l-8 4.5v2l8-2.5v4l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-4l8 2.5z" },
  { href: "/hotels", label: "Hotels", icon: "M3 20V6h2v8h6V8h7a3 3 0 013 3v9h-2v-3H5v3zm5-7a2 2 0 110-4 2 2 0 010 4z" },
  { href: "/explore", label: "Explore", icon: "M12 2a10 10 0 100 20 10 10 0 000-20zm3.5 6.5l-2 5-5 2 2-5z" },
  { href: "/saved", label: "Saved", icon: "M6 3h12v18l-6-4-6 4z" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/trips");
  return pathname.startsWith(href);
}

export function AppShell({ children, fixtureMode = false }: { children: ReactNode; fixtureMode?: boolean }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col">
      <header className="no-print sticky top-0 z-40 flex items-center justify-between border-b border-border bg-bg/90 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-lg font-extrabold tracking-tight">
          Trip<span className="text-accent">Planner</span>
        </Link>
        <Link
          href="/settings"
          aria-label="Settings and usage"
          className={`rounded-lg p-2 ${pathname.startsWith("/settings") ? "bg-accent-soft text-accent" : "text-muted"}`}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
            <path d="M19.4 13a7.6 7.6 0 000-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 00-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 00-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 000 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z" />
          </svg>
        </Link>
      </header>
      {fixtureMode && (
        <p className="no-print bg-warn px-4 py-1.5 text-center text-xs font-bold text-white">
          FIXTURE MODE — sample test data, not real prices or places (DATA_MODE=fixtures)
        </p>
      )}
      <UsageBanner />
      <main className="flex-1 px-4 pb-28 pt-4">{children}</main>
      <nav
        aria-label="Primary"
        className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <ul className="mx-auto flex max-w-5xl">
          {NAV.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <li key={n.href} className="flex-1">
                <Link
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col items-center gap-0.5 py-2 text-[0.7rem] font-semibold ${active ? "text-accent" : "text-muted"}`}
                >
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden>
                    <path d={n.icon} />
                  </svg>
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function UsageBanner() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const load = useCallback(() => {
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSummary(d.summary))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    window.addEventListener("tp:usage-changed", load);
    return () => window.removeEventListener("tp:usage-changed", load);
  }, [load]);
  if (!summary) return null;

  const msgs: { tone: "warn" | "danger"; text: string }[] = [];
  const s = summary.serpapi;
  if (s.state === "blocked") msgs.push({ tone: "danger", text: `SerpApi quota hit (${s.used}/${s.limit}). New searches are paused; cached results still work.` });
  else if (s.state === "override") msgs.push({ tone: "danger", text: `Over SerpApi quota (${s.used}/${s.limit}). Override is on: each new search asks first.` });
  else if (s.state === "warn") msgs.push({ tone: "warn", text: `SerpApi at ${Math.round(s.pct * 100)}% of monthly quota (${s.used}/${s.limit}).` });
  const c = summary.claude;
  if (c.state === "blocked") msgs.push({ tone: "danger", text: `Claude budget hit ($${c.spentUsd.toFixed(2)}/$${c.budgetUsd}). AI planning is paused.` });
  else if (c.state === "warn") msgs.push({ tone: "warn", text: `Claude spend at ${Math.round(c.pct * 100)}% of budget ($${c.spentUsd.toFixed(2)}/$${c.budgetUsd}).` });
  if (!msgs.length) return null;

  return (
    <div className="no-print space-y-1 px-4 pt-3">
      {msgs.map((m) => (
        <Link
          key={m.text}
          href="/settings"
          className={`block rounded-lg px-3 py-2 text-sm font-semibold ${m.tone === "danger" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"}`}
        >
          {m.text}
        </Link>
      ))}
    </div>
  );
}
