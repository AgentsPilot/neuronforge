'use client';

/**
 * AI cost & usage: Quick stats and the top three rows by cost, as two cards
 * below the table (Admin Layout Standard L-2b, workplan §3.6; SA Q-15, R-13).
 *
 * The same values as the old side panel. Call counts are exact, as the Calls
 * tile and the table show them (SA S-1); tokens stay compact. The top list was
 * titled "Top Token Consumers" but is sorted by cost and its share is the cost
 * share, so it says so (SA Q-8). No avatars, no decorative colour (F-51).
 */

import { formatCount } from '@/app/admin/components/layout/adminFormat';

import { formatCost, formatNumber, type DrillDownItem } from '../analyticsTypes';
import type { AnalyticsTotals } from './AnalyticsTable';

const CARD = 'rounded-xl border border-slate-700 bg-slate-800/40 p-4';
const TITLE = 'mb-3 text-sm font-semibold text-white';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right tabular-nums text-slate-200">{value}</dd>
    </div>
  );
}

export function AnalyticsSummaryCards({ items, totals }: { items: DrillDownItem[]; totals: AnalyticsTotals }) {
  const top = [...items].sort((a, b) => b.cost - a.cost).slice(0, 3);
  const hasCalls = totals.calls > 0;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="analytics-summary">
      <div className={CARD} data-testid="quick-stats">
        <h2 className={TITLE}>Quick stats</h2>
        <dl className="grid grid-cols-[1fr_max-content] gap-x-4 gap-y-1 text-sm">
          <Stat label="Calls" value={formatCount(totals.calls)} />
          <Stat label="Avg cost per call" value={hasCalls ? formatCost(totals.cost / totals.calls) : '—'} />
          <Stat label="Avg tokens per call" value={hasCalls ? formatNumber(Math.round(totals.tokens / totals.calls)) : '—'} />
          <Stat label="Input tokens" value={formatNumber(totals.inputTokens)} />
          <Stat label="Output tokens" value={formatNumber(totals.outputTokens)} />
        </dl>
      </div>

      {top.length > 0 && (
        <div className={CARD} data-testid="top-by-cost">
          <h2 className={TITLE}>Top 3 by cost</h2>
          <ol className="space-y-2 text-sm">
            {top.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-slate-200">{item.label}</span>
                <span className="flex-shrink-0 tabular-nums">
                  <span className="text-slate-200">{formatCost(item.cost)}</span>
                  <span className="ml-2 text-slate-400">{item.percentage.toFixed(0)}% of cost</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
