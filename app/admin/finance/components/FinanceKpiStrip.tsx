'use client';

/**
 * The Finance KPI strip (Money MK-5, KPI restructure review §3.1; MK-5a §3.4),
 * on the shared admin `KpiStrip` / `KpiTile` (Admin Layout Standard §5.4).
 *
 * Five tiles, in BD-35's order (revenue, cost, then users):
 *   F-K1 Revenue received ($, the window)            lagging  → Revenue
 *   F-K2 MRR now ($, current Stripe key)             leading  → Revenue, Recurring now
 *   F-K3 Charged AI cost (this month vs last month)  lagging  → AI cost summary
 *   F-K4 AI margin ($, the window)                   lagging  → the Accounts tab
 *   F-K5 Paying accounts (%)                         lagging  → Plans & subscriptions
 * Each carries MK-0's leading / lagging icon, its tooltip line 1 from ONE copy
 * constant per KPI (`FINANCE_KPIS`, LL-4). K-2, K-3 and K-4 are in their blocks
 * (MK-1 Credits, MK-5 Plan mix), with the same rules.
 *
 * Every status is the payload's (standard K-5 (i)): F-K1 keeps K-5's (the K-6
 * dispute red), F-K3 keeps K-1's (BD-11 amber and red). F-K2, F-K4 and F-K5
 * have no colour rule.
 *
 * MONEY (USD-1 to USD-6, SA-9): a tile's value is the US-dollar line ONLY,
 * printed through `formatUsdSign`, which refuses any other currency. Other
 * currencies are a count in a note ("plus n payments in other currencies, not
 * converted"), never an amount and never part of the value. Nothing here adds
 * two money figures; the counts in the notes are counts. F-K4's figure is the
 * server's (`platformMargin`, or `accountMargin` with a business picked).
 *
 * The test-key label shows on F-K2 only, from the one allowed copy constant
 * (C-4, MK-4). F-K5 keeps a slot for MK-5b's "Converted this month"; nothing
 * is rendered for it yet.
 */

import { KpiStrip, KpiTile, type KpiTileFilter, type KpiTileStatus } from '@/app/admin/components/layout/KpiStrip';
import type { FinanceAccountMargin, FinanceMrrSection, FinancePayload, FinancePaying, FinanceRevenueSection, FinanceTile } from '@/lib/business-os/finance/financeTypes';
import {
  FINANCE_KPIS,
  k1SubLine,
  KPI_MARGIN_WORDS,
  KPI_MRR_NONE,
  KPI_NONE_IN_DOLLARS,
  KPI_PAYING_ONE,
  KPI_PAYING_ONE_SUB,
  KPI_UNKNOWN,
  kpiMarginAfterFees,
  kpiMrrPastDue,
  kpiOtherPayments,
  kpiOtherSubscriptions,
  kpiPayingCount,
  kpiPayingPartial,
  REVENUE_RECURRING_TEST_KEY_LABEL,
} from '../financeCopy';
import { atLeast, formatCount, formatUsdSign } from '../financeFormat';

/** The sections a tile can jump to (their DOM ids). */
export type FinanceTileSection = 'credits' | 'accounts' | 'revenue' | 'revenue-mrr' | 'ai-cost';

/** A same-page anchor where the section is on screen, else the shared filter mode (another tab). */
export type FinanceTileTarget = { href: `#${FinanceTileSection}` } | { filter: KpiTileFilter };

/** The tab a tile opens: the shared filter mode (a real link, a plain click writes once); none with a business picked. */
export type FinanceTabTarget = { filter: KpiTileFilter } | Record<string, never>;

const USD = 'USD';
const isUsd = (currency: string | null) => currency !== null && currency.trim().toUpperCase() === USD;

/** The payload's status as the shared tile's: `neutral` is no status (K-4); the rest pass through. */
function tileStatus(status: FinanceTile['status']): KpiTileStatus | null {
  return status === 'neutral' ? null : status;
}

const joinLines = (parts: Array<string | null>) => parts.filter((part): part is string => part !== null).join(' · ') || null;

/** F-K1: the US-dollar line of Our revenue, and the count of payments in other currencies (USD-3). */
function revenueTile(k5: FinanceTile, revenue: FinanceRevenueSection): { value: string | null; note: string | null } {
  const money = k5.money;
  if (!money || money.kind === 'none') return { value: null, note: null };
  if (money.kind === 'unknown' || revenue.totals === null) return { value: KPI_UNKNOWN, note: null };
  const usd = revenue.totals.find((line) => isUsd(line.currency));
  const value = !usd ? KPI_NONE_IN_DOLLARS : usd.total === null ? KPI_UNKNOWN : formatUsdSign({ currency: usd.currency, amount: usd.total });
  // Counts, never amounts: plan payments and boost purchases on every other currency's line.
  let others = 0;
  for (const line of revenue.plans.lines ?? []) if (!isUsd(line.currency)) others += line.payments;
  for (const line of revenue.boosts.lines ?? []) if (!isUsd(line.currency)) others += line.purchases;
  return { value: value ?? KPI_UNKNOWN, note: others > 0 ? kpiOtherPayments(others) : null };
}

/** F-K2: the US-dollar MRR line; past due shown apart (BQ-P8a-4); subscriptions in other currencies as a count. */
function mrrTile(mrr: FinanceMrrSection | undefined): { value: string | null; pastDue: string | null; note: string | null } {
  if (!mrr) return { value: null, pastDue: null, note: null };
  if (mrr.status === 'unknown') return { value: KPI_UNKNOWN, pastDue: null, note: null };
  const usd = mrr.lines.find((line) => isUsd(line.currency));
  let others = 0;
  for (const line of mrr.lines) if (!isUsd(line.currency)) others += line.subscriptions;
  const note = others > 0 ? kpiOtherSubscriptions(others) : null;
  if (!usd) return { value: mrr.lines.length === 0 ? KPI_MRR_NONE : KPI_NONE_IN_DOLLARS, pastDue: null, note };
  // Integer hundredths from the one MRR rule, divided once for display.
  const value = usd.overflow ? KPI_UNKNOWN : formatUsdSign({ currency: usd.currency, amount: usd.totalHundredths / 100 });
  const pastDueText = usd.pastDueHundredths > 0 ? formatUsdSign({ currency: usd.currency, amount: usd.pastDueHundredths / 100 }) : null;
  return { value: value ?? KPI_UNKNOWN, pastDue: pastDueText ? kpiMrrPastDue(pastDueText) : null, note };
}

/** F-K4: the server's margin, or its word. */
function marginTile(margin: FinanceAccountMargin | null | undefined): { value: string | null; afterFees: string | null } {
  if (!margin) return { value: null, afterFees: null };
  if (margin.margin.kind !== 'figure') return { value: KPI_MARGIN_WORDS[margin.margin.kind], afterFees: null };
  const value = formatUsdSign({ currency: USD, amount: margin.margin.marginUsd });
  const fees =
    margin.marginAfterFees.kind === 'figure'
      ? formatUsdSign({ currency: margin.marginAfterFees.currency, amount: margin.marginAfterFees.afterFeesUsd })
      : null;
  return { value: value ?? KPI_UNKNOWN, afterFees: fees ? kpiMarginAfterFees(fees) : null };
}

/** F-K5: "18%" with "9 of 50 accounts"; "at least" when cut off; Unknown, never 0%; a picked business pays or not. */
function payingTile(paying: FinancePaying | undefined): { value: string | null; sub: string | null } {
  if (!paying) return { value: null, sub: null };
  if (paying.scope === 'one') {
    if (paying.status === 'unknown' || paying.paying === null) return { value: KPI_UNKNOWN, sub: KPI_PAYING_ONE_SUB };
    return { value: paying.paying ? KPI_PAYING_ONE.yes : KPI_PAYING_ONE.no, sub: KPI_PAYING_ONE_SUB };
  }
  if (paying.status === 'unknown' || paying.paying === null || paying.accounts === null) return { value: KPI_UNKNOWN, sub: null };
  if (paying.status === 'partial') {
    return { value: atLeast(formatCount(paying.paying), false), sub: kpiPayingPartial(formatCount(paying.paying), formatCount(paying.accounts)) };
  }
  const percent = paying.accounts === 0 ? null : Math.round((paying.paying / paying.accounts) * 100);
  return {
    value: percent === null ? KPI_UNKNOWN : `${percent}%`,
    sub: kpiPayingCount(formatCount(paying.paying), formatCount(paying.accounts)),
  };
}

/** K-10: the first read is in flight. Outside the `kpi-strip` wrapper, so a wait for the strip means figures. */
export function FinanceKpiPlaceholders() {
  return <KpiStrip loading placeholderCount={5} />;
}

export function FinanceKpiStrip({
  data,
  windowLabel,
  targetFor,
  accountsTab,
  plansTab,
}: {
  data: Pick<FinancePayload, 'tiles' | 'revenue' | 'mrr' | 'stripeMode' | 'paying' | 'platformMargin' | 'accountMargin' | 'accountId'>;
  /** The filter window, for the captions. */
  windowLabel: string;
  /** Where a section tile goes on the current view. */
  targetFor: (section: FinanceTileSection) => FinanceTileTarget;
  /** F-K4's target: the Accounts tab; empty with a business picked (no tabs). */
  accountsTab: FinanceTabTarget;
  /** F-K5's target: the Plans & subscriptions tab; empty with a business picked. */
  plansTab: FinanceTabTarget;
}) {
  const { k1, k5 } = data.tiles;
  const revenue = revenueTile(k5, data.revenue);
  const mrr = mrrTile(data.mrr);
  const margin = marginTile(data.accountId === null ? data.platformMargin : data.accountMargin);
  const paying = payingTile(data.paying);
  const testKey = data.stripeMode === 'test' && data.mrr?.status === 'ok' ? REVENUE_RECURRING_TEST_KEY_LABEL : null;
  const aiCostNow = k1.value ? formatUsdSign({ currency: USD, amount: k1.value.value }, { maxDecimals: 4 }) : null;
  const aiCostBefore = k1.previous ? formatUsdSign({ currency: USD, amount: k1.previous.value }, { maxDecimals: 4 }) : null;

  return (
    <div data-testid="kpi-strip">
      <KpiStrip>
        <KpiTile
          testId="tile-fk1_revenue"
          label={FINANCE_KPIS.revenue.label}
          value={revenue.value}
          sub={FINANCE_KPIS.revenue.sub(windowLabel)}
          status={tileStatus(k5.status)}
          detail={joinLines([k5.headline, revenue.note])}
          indicator={{ kind: 'lagging', definition: FINANCE_KPIS.revenue.definition }}
          {...targetFor('revenue')}
        />
        <KpiTile
          testId="tile-fk2_mrr"
          label={FINANCE_KPIS.mrr.label}
          value={mrr.value}
          sub={joinLines([FINANCE_KPIS.mrr.sub, mrr.pastDue])}
          detail={joinLines([testKey, mrr.note])}
          indicator={{ kind: 'leading', definition: FINANCE_KPIS.mrr.definition }}
          {...targetFor('revenue-mrr')}
        />
        <KpiTile
          testId="tile-fk3_ai_cost"
          label={FINANCE_KPIS.aiCost.label}
          value={aiCostNow && k1.value ? atLeast(aiCostNow, k1.value.exact) : null}
          sub={k1SubLine(aiCostBefore && k1.previous ? atLeast(aiCostBefore, k1.previous.exact) : null)}
          status={tileStatus(k1.status)}
          detail={k1.headline}
          indicator={{ kind: 'lagging', definition: FINANCE_KPIS.aiCost.definition }}
          {...targetFor('ai-cost')}
        />
        <KpiTile
          testId="tile-fk4_ai_margin"
          label={FINANCE_KPIS.aiMargin.label}
          value={margin.value}
          sub={FINANCE_KPIS.aiMargin.sub(windowLabel)}
          detail={margin.afterFees}
          indicator={{ kind: 'lagging', definition: FINANCE_KPIS.aiMargin.definition }}
          {...accountsTab}
        />
        {/* MK-5b's "Converted this month" joins this tile (a second, leading figure); not built here. */}
        <KpiTile
          testId="tile-fk5_paying"
          label={FINANCE_KPIS.paying.label}
          value={paying.value}
          sub={paying.sub}
          indicator={{ kind: 'lagging', definition: FINANCE_KPIS.paying.definition }}
          {...plansTab}
        />
      </KpiStrip>
    </div>
  );
}
