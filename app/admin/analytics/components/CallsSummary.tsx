'use client';

/**
 * The Calls tab's summary cards (Money MK-3b, KPI restructure review §4.2 and
 * §6 item 27, SA-Q-MK3-6). They replace this tab's own KPI strip
 * (`AnalyticsKpis`, deleted): a page has one strip of at most five tiles, the
 * AI cost page's A-K1 to A-K5, and its A-K2 is the Business OS recorded AI
 * cost. These cards describe THIS VIEW (the scope, the window and every drill
 * filter applied), so the total is labelled "this view" and never mistaken
 * for A-K2.
 *
 *   Business OS scope: Recorded AI cost, this view; Calls; Tokens; Avg cost per call.
 *   All products scope: Recorded AI cost, this view; and the four categories,
 *   as filter links (a toggle: the applied one is `aria-current`).
 *
 * The links keep the old tiles' contract (Q-14, R-7): a real link to the
 * filtered view, whose plain left click applies the same patch in place
 * through the page's one URL hook. Cards are cards, not tiles: no status
 * colour, no indicator pill. The test ids are the old tiles', so the old cases
 * read the same figures.
 */

import type { MouseEvent, ReactNode } from 'react';

import { isPlainLeftClick } from '@/app/admin/components/layout/KpiStrip';
import { formatCount } from '@/app/admin/components/layout/adminFormat';

import type { AnalyticsFilters } from '../analyticsFilters';
import { formatCost, formatNumber, type CategoryTotals, type PeriodComparison, type Scope } from '../analyticsTypes';
import type { AnalyticsTotals } from './AnalyticsTable';

export interface CallsSummaryLink {
  href: string;
  apply: () => void;
}

export interface CallsSummaryProps {
  scope: Scope;
  totals: AnalyticsTotals;
  categoryTotals: CategoryTotals | null;
  comparison: PeriodComparison | null;
  possiblyIncomplete: boolean;
  /** The applied category ('all' when none). */
  category: string;
  /** The link and the click action for a patch (the page's `hrefFor` and `setFilters`). */
  link: (patch: Partial<AnalyticsFilters>) => CallsSummaryLink;
}

const CATEGORY_CARDS = [
  { key: 'creation', label: 'Creation', description: 'Intent, Semantic Plan, IR' },
  { key: 'execution', label: 'Execution', description: 'Agent runs, LLM decisions' },
  { key: 'memory', label: 'Memory', description: 'Embeddings, summarization' },
  { key: 'system', label: 'System', description: 'Platform, calibration' },
] as const;

/** The first card's label: this view's total, never the strip's A-K2. */
export const CALLS_VIEW_TOTAL_LABEL = 'Recorded AI cost, this view';

const CARD = 'block rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-left';
const LINK_CARD = `${CARD} hover:border-purple-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500`;
const CURRENT = 'border-purple-400 ring-1 ring-purple-400';

function changeText(comparison: PeriodComparison | null): string | null {
  if (!comparison) return null;
  const pct = comparison.changes.costPct;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}% vs previous period`;
}

function Body({ label, value, sub }: { label: string; value: string; sub: string | null }) {
  return (
    <>
      <span className="block text-xs text-slate-400">{label}</span>
      <span className="mt-1 block text-lg font-semibold tabular-nums text-white">{value}</span>
      {sub && <span className="mt-0.5 block text-[11px] text-slate-400">{sub}</span>}
    </>
  );
}

/** A card that is a real link; a plain left click applies the patch in place. */
function LinkCard({
  testId,
  target,
  current,
  label,
  value,
  sub,
}: {
  testId: string;
  target: CallsSummaryLink;
  current?: boolean;
  label: string;
  value: string;
  sub: string | null;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(event)) return;
    event.preventDefault();
    target.apply();
  };
  return (
    <a
      href={target.href}
      onClick={onClick}
      data-testid={testId}
      aria-current={current ? 'true' : undefined}
      aria-label={`${label}, ${value}`}
      className={`${LINK_CARD} ${current ? CURRENT : ''}`}
    >
      <Body label={label} value={value} sub={sub} />
    </a>
  );
}

function PlainCard({ testId, label, value, sub }: { testId: string; label: string; value: string; sub: string | null }) {
  return (
    <div role="group" data-testid={testId} aria-label={`${label}, ${value}`} className={CARD}>
      <Body label={label} value={value} sub={sub} />
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="calls-summary">
      {children}
    </div>
  );
}

export function CallsSummary({ scope, totals, categoryTotals, comparison, possiblyIncomplete, category, link }: CallsSummaryProps) {
  // In the All scope there is no Tokens card, so the total token figure stays on the total (SA M-2).
  const totalSub =
    [
      scope === 'all' ? `${formatNumber(totals.tokens)} tokens` : null,
      changeText(comparison),
      possiblyIncomplete ? 'may be incomplete' : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' · ') || null;

  const total = (
    <LinkCard
      testId="category-card-total"
      target={link({ groupBy: 'provider' })}
      label={CALLS_VIEW_TOTAL_LABEL}
      value={formatCost(totals.cost)}
      sub={totalSub}
    />
  );

  if (scope === 'bos') {
    return (
      <Grid>
        {total}
        <LinkCard testId="kpi-calls" target={link({ groupBy: 'activity' })} label="Calls" value={formatCount(totals.calls)} sub={null} />
        <LinkCard
          testId="kpi-tokens"
          target={link({ groupBy: 'model' })}
          label="Tokens"
          value={formatNumber(totals.tokens)}
          sub={`${formatNumber(totals.inputTokens)} in · ${formatNumber(totals.outputTokens)} out`}
        />
        {/* No target: an average has no view of its own. */}
        <PlainCard
          testId="kpi-avg-cost"
          label="Avg cost per call"
          value={totals.calls > 0 ? formatCost(totals.cost / totals.calls) : '—'}
          sub={null}
        />
      </Grid>
    );
  }

  const totalCategoryCost = categoryTotals
    ? categoryTotals.creation.cost + categoryTotals.execution.cost + categoryTotals.memory.cost + categoryTotals.system.cost
    : totals.cost;
  const pctOf = (cost: number) => (totalCategoryCost === 0 ? 0 : Math.round((cost / totalCategoryCost) * 100));

  return (
    <Grid>
      {total}
      {CATEGORY_CARDS.map(({ key, label, description }) => {
        const figures = categoryTotals?.[key] ?? { cost: 0, tokens: 0, calls: 0 };
        const isApplied = category === key;
        return (
          <LinkCard
            key={key}
            testId={`category-card-${key}`}
            // A toggle: a click on the applied category goes back to all.
            target={link({ category: isApplied ? 'all' : key })}
            current={isApplied}
            label={label}
            value={formatCost(figures.cost)}
            sub={`${pctOf(figures.cost)}% of recorded cost · ${formatNumber(figures.tokens)} tokens · ${description}`}
          />
        );
      })}
    </Grid>
  );
}
