'use client';

/**
 * AI cost & usage's KPI strip (Admin Layout Standard §7.5, SA re-check R-13).
 *
 * Business OS scope: Total spend, Calls, Tokens, Avg cost per call. All scope:
 * Total spend and the four AgentsPilot categories. Every linked tile is the
 * shared same-page filter tile (Q-14, R-7): a real link to the filtered view
 * whose plain click applies the same patch through the page's filter hook.
 *
 * Colour (K-5, T-6, T-7): the only status is Total spend's amber "Needs a look"
 * while the 1,000-call cap was hit, a condition the page already flags with its
 * amber notice. The "vs previous period" change is plain text (no red-up /
 * green-down, a page-invented signal); the categories are neutral, and the
 * selected one is shown by the purple ring and `aria-current`.
 */

import { KpiStrip, KpiTile, type KpiTileFilter } from '@/app/admin/components/layout/KpiStrip';
import { formatCount } from '@/app/admin/components/layout/adminFormat';

import type { AnalyticsFilters } from '../analyticsFilters';
import { formatCost, formatNumber, type CategoryTotals, type PeriodComparison, type Scope } from '../analyticsTypes';

export interface AnalyticsTotals {
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface AnalyticsKpisProps {
  scope: Scope;
  totals: AnalyticsTotals;
  categoryTotals: CategoryTotals | null;
  comparison: PeriodComparison | null;
  possiblyIncomplete: boolean;
  /** The applied category ('all' when none). */
  category: string;
  /** No successful read yet: the K-10 placeholders. */
  firstLoad: boolean;
  /** The link and the click action for a patch (the page's `hrefFor` and `setFilters`). */
  tile: (patch: Partial<AnalyticsFilters>) => Omit<KpiTileFilter, 'current'>;
}

const CATEGORY_TILES = [
  { key: 'creation', label: 'Creation', description: 'Intent, Semantic Plan, IR' },
  { key: 'execution', label: 'Execution', description: 'Agent runs, LLM decisions' },
  { key: 'memory', label: 'Memory', description: 'Embeddings, summarization' },
  { key: 'system', label: 'System', description: 'Platform, calibration' },
] as const;

function changeText(comparison: PeriodComparison | null): string | null {
  if (!comparison) return null;
  const pct = comparison.changes.costPct;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}% vs previous period`;
}

export function AnalyticsKpis({
  scope,
  totals,
  categoryTotals,
  comparison,
  possiblyIncomplete,
  category,
  firstLoad,
  tile,
}: AnalyticsKpisProps) {
  if (firstLoad) return <KpiStrip loading placeholderCount={scope === 'bos' ? 4 : 5} />;

  // In the All scope there is no Tokens tile, so the total token figure stays
  // on Total spend (SA M-2: no figure leaves the page).
  const totalSub = [
    scope === 'all' ? `${formatNumber(totals.tokens)} tokens` : null,
    changeText(comparison),
    possiblyIncomplete ? 'may be incomplete' : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  const totalSpend = (
    <KpiTile
      testId="category-card-total"
      label="Total spend"
      value={formatCost(totals.cost)}
      sub={totalSub || null}
      status={possiblyIncomplete ? 'amber' : null}
      filter={tile({ groupBy: 'provider' })}
    />
  );

  if (scope === 'bos') {
    return (
      <KpiStrip>
        {totalSpend}
        <KpiTile testId="kpi-calls" label="Calls" value={formatCount(totals.calls)} filter={tile({ groupBy: 'activity' })} />
        <KpiTile
          testId="kpi-tokens"
          label="Tokens"
          value={formatNumber(totals.tokens)}
          sub={`${formatNumber(totals.inputTokens)} in · ${formatNumber(totals.outputTokens)} out`}
          filter={tile({ groupBy: 'model' })}
        />
        {/* No target (K-6): an average has no view of its own. */}
        <KpiTile
          testId="kpi-avg-cost"
          label="Avg cost per call"
          value={totals.calls > 0 ? formatCost(totals.cost / totals.calls) : '—'}
        />
      </KpiStrip>
    );
  }

  const totalCategoryCost = categoryTotals
    ? categoryTotals.creation.cost + categoryTotals.execution.cost + categoryTotals.memory.cost + categoryTotals.system.cost
    : totals.cost;
  const pctOf = (cost: number) => (totalCategoryCost === 0 ? 0 : Math.round((cost / totalCategoryCost) * 100));

  return (
    <KpiStrip>
      {totalSpend}
      {CATEGORY_TILES.map(({ key, label, description }) => {
        const figures = categoryTotals?.[key] ?? { cost: 0, tokens: 0, calls: 0 };
        const isApplied = category === key;
        return (
          <KpiTile
            key={key}
            testId={`category-card-${key}`}
            label={label}
            value={formatCost(figures.cost)}
            sub={`${pctOf(figures.cost)}% of spend · ${formatNumber(figures.tokens)} tokens · ${description}`}
            // A toggle: a click on the applied category goes back to all.
            filter={{ ...tile({ category: isApplied ? 'all' : key }), current: isApplied }}
          />
        );
      })}
    </KpiStrip>
  );
}
