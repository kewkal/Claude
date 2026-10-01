"use client";

import { fmtUsd } from "@/lib/format";
import type { CostBreakdown, CostBasis } from "@/lib/planner/types";
import { Badge, InfoTip } from "@/components/ui";

const BASIS: Record<CostBasis, { label: string; tone: "ok" | "warn" | "neutral" }> = {
  sourced: { label: "Sourced", tone: "ok" },
  estimate: { label: "Estimate", tone: "warn" },
  calculated: { label: "Calculated", tone: "neutral" },
};

export function CostTable({ costs }: { costs: CostBreakdown }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <caption className="sr-only">Cost breakdown</caption>
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">Item</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {costs.lines.map((l) => (
            <tr key={l.key} className="align-top">
              <td className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">{l.label}</span>
                  <Badge tone={BASIS[l.basis].tone}>{BASIS[l.basis].label}</Badge>
                  <InfoTip label={`How ${l.label} is calculated`}>{l.note}</InfoTip>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {l.note.length > 90 ? `${l.note.slice(0, 90)}…` : l.note}
                  {l.sourceUrl && (
                    <>
                      {" "}
                      <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent">
                        source ↗
                      </a>
                    </>
                  )}
                </p>
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtUsd(l.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-border">
          <tr>
            <td className="px-3 py-2 font-bold">Total</td>
            <td className="px-3 py-2 text-right font-extrabold tabular-nums">{fmtUsd(costs.total)}</td>
          </tr>
          <tr>
            <td className="px-3 py-1 text-muted">Your budget</td>
            <td className="px-3 py-1 text-right tabular-nums text-muted">{fmtUsd(costs.budget)}</td>
          </tr>
          <tr>
            <td className={`px-3 pb-3 pt-1 font-bold ${costs.overBudget ? "text-danger" : "text-ok"}`}>{costs.overBudget ? "Over budget by" : "Under budget by"}</td>
            <td className={`px-3 pb-3 pt-1 text-right font-bold tabular-nums ${costs.overBudget ? "text-danger" : "text-ok"}`}>{fmtUsd(Math.abs(costs.remaining))}</td>
          </tr>
        </tfoot>
      </table>
      {costs.unpricedItems.length > 0 && (
        <p className="border-t border-border px-3 py-2 text-xs text-warn">
          Price not listed (counted as $0): {costs.unpricedItems.join(", ")}
        </p>
      )}
    </div>
  );
}
