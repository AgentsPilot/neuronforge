'use client';

/**
 * The AI cost page's KPI strip, A-K1 to A-K5 (Money MK-3, KPI restructure
 * review §4.1 and §5; LL-1 to LL-5; USD-1 to USD-6). Replaces the Charge
 * checks strip (`CostsKpis`, L-9a / MK-2). Five tiles, no more, each with
 * MK-0's leading / lagging pill and its one definition (LL-4). Every value
 * comes from the report already read: no read of its own.
 *
 *   A-K1 Charged AI cost         chargedInWindow.costUsd    lagging   #costs-charged
 *   A-K2 Recorded AI cost        recorded.recordedUsd       lagging   AI calls & usage (MK-3b: the Calls tab)
 *   A-K3 Recorded above charged  recorded.aboveCharged      leading   #costs-leak
 *   A-K4 Billing periods not matching                       leading   #costs-periods (red above 0)
 *   A-K5 Fallback-priced charges, "n reconciled"            leading   #costs-fallback
 *
 * Money: the two amounts print through Finance's `formatUsdSign` with four
 * decimals, the very call F-K3 makes, so A-K1 and F-K3 print the same text for
 * the same value (SA-Q-MK3-7, SA-Q-MK3-8). AI cost is USD by definition
 * (CUR-5): no other currency can reach a tile (USD-5). If the formatter ever
 * refused, the tile would read Unknown, never another figure.
 *
 * Exactness (SA-CR-MK2 Q-R1, SA-WP-MK3 condition 4): A-K1 is a plain total,
 * so an unreadable amount or the ledger ceiling makes it "At least $x", never
 * Unknown; only a failed read is Unknown. A-K2 is "At least" when its read
 * stopped short. A-K3 is Finance's own difference: Unknown when either side is
 * not exact (R4-9), "Not available" before charging began.
 *
 * Colour: only A-K4 has a rule, red while a period disagrees (unchanged from
 * Charge checks). Anchors are links only while their section is drawn (K-6);
 * the Leak check (A-K3's target) is always drawn.
 *
 * Money MK-3a (SA-WP-MK3 condition 5): A-K2 opens the real AI calls & usage
 * page on the same whole UTC days and business, never an address that relies
 * on a redirect. MK-3b retargets it to the Calls tab with the redirect.
 */

import { KpiStrip, KpiTile } from '@/app/admin/components/layout/KpiStrip';
// Finance owns the `$` formatter and the "At least" form (SA-Q-MK3-8: imported, not copied).
import { atLeast, formatUsdSign } from '@/app/admin/finance/financeFormat';

import { formatCount } from '../../costFormat';
import {
  AI_COST_KPI_DEFINITIONS,
  chargedAboveLine,
  KPI_ABOVE,
  KPI_ABOVE_NONE,
  KPI_ABOVE_NOT_AVAILABLE,
  KPI_ABOVE_NOT_AVAILABLE_SUB,
  KPI_CHARGED,
  KPI_FALLBACK,
  KPI_MAY_BE_INCOMPLETE,
  KPI_NOT_CHECKED,
  KPI_OF_CHECKED,
  KPI_PERIODS,
  KPI_RECONCILED,
  KPI_RECORDED,
  KPI_RECORDED_SCOPE,
  KPI_UNKNOWN,
} from '../../costCopy';
import type { CostReportPayload } from '../../costTypes';

export interface AiCostKpisProps {
  report: CostReportPayload | null;
  /** The first read (or the first after an error) is in flight: the K-10 placeholders. */
  firstLoad: boolean;
  /** The report's sections are on screen, so the anchor tiles have somewhere to go. */
  sectionsShown: boolean;
}

const PLACEHOLDERS = 5;
const US_DOLLAR_CODE = 'USD';

/** `$` with four decimals, Finance's F-K3 call; null only if the formatter refuses. */
const dollars = (amount: number) => formatUsdSign({ currency: US_DOLLAR_CODE, amount }, { maxDecimals: 4 });

/** The parts that are present, joined; null when none is. */
function subLine(...parts: Array<string | null>): string | null {
  return parts.filter((part): part is string => part !== null).join('; ') || null;
}

/**
 * A-K2's target while the Calls tab does not exist (MK-3a): AI calls & usage on
 * the report's own whole UTC days, as a custom range (that page's 7d and 30d are
 * rolling), and the business when one is picked. Literal keys, that page's own.
 */
export function recordedCallsLink(window: { from: string; to: string }, accountId: string | null): `/${string}` {
  const params = new URLSearchParams({ range: 'custom', from: window.from, to: window.to });
  if (accountId) params.set('account', accountId);
  return `/admin/analytics?${params.toString()}`;
}

function chargedValue(report: CostReportPayload): string {
  const charged = report.chargedInWindow;
  if (charged.status === 'unknown' || charged.costUsd === null) return KPI_UNKNOWN;
  const text = dollars(charged.costUsd);
  return text === null ? KPI_UNKNOWN : atLeast(text, charged.status === 'ok');
}

function recordedValue(report: CostReportPayload): string {
  const recorded = report.recorded;
  if (recorded.recordedUsd === null) return KPI_UNKNOWN;
  const text = dollars(recorded.recordedUsd);
  return text === null ? KPI_UNKNOWN : atLeast(text, recorded.recordedExact);
}

function aboveTile(report: CostReportPayload): { value: string; sub: string | null } {
  const { aboveCharged, chargedAboveUsd } = report.recorded;
  if (aboveCharged.state === 'figure' && aboveCharged.usd !== null) {
    return { value: dollars(aboveCharged.usd) ?? KPI_UNKNOWN, sub: null };
  }
  if (aboveCharged.state === 'none') {
    const over = chargedAboveUsd !== null ? dollars(chargedAboveUsd) : null;
    return { value: KPI_ABOVE_NONE, sub: over ? chargedAboveLine(over) : null };
  }
  if (aboveCharged.state === 'not_available') return { value: KPI_ABOVE_NOT_AVAILABLE, sub: KPI_ABOVE_NOT_AVAILABLE_SUB };
  return { value: KPI_UNKNOWN, sub: null };
}

export function AiCostKpis({ report, firstLoad, sectionsShown }: AiCostKpisProps) {
  if (!report) return firstLoad ? <KpiStrip loading placeholderCount={PLACEHOLDERS} /> : null;

  const totalsRead = report.sections.totals !== 'failed';
  // The fallback list comes from the rows read; a rows read that failed or never ran has no count.
  const rowsRead = report.sections.rows === 'ok';
  const incomplete = report.incomplete ? KPI_MAY_BE_INCOMPLETE : null;

  const checked = report.periods.filter((period) => period.matches !== null).length;
  const noneChecked = report.periods.length > 0 && checked === 0;
  const periodsValue = !totalsRead ? KPI_UNKNOWN : noneChecked ? KPI_NOT_CHECKED : formatCount(report.mismatchedPeriods);
  const periodsSub =
    totalsRead && !noneChecked && checked < report.periods.length ? KPI_OF_CHECKED(formatCount(checked)) : null;
  const periodsRed = totalsRead && !noneChecked && report.mismatchedPeriods > 0;

  const anchor = (target: `#${string}`) => (sectionsShown ? { href: target } : {});
  const above = aboveTile(report);

  return (
    <KpiStrip>
      <KpiTile
        testId="costs-kpi-cost"
        label={KPI_CHARGED}
        value={chargedValue(report)}
        indicator={{ kind: 'lagging', definition: AI_COST_KPI_DEFINITIONS.charged }}
        {...anchor('#costs-charged')}
      />
      <KpiTile
        testId="costs-kpi-recorded"
        label={KPI_RECORDED}
        value={recordedValue(report)}
        sub={KPI_RECORDED_SCOPE}
        indicator={{ kind: 'lagging', definition: AI_COST_KPI_DEFINITIONS.recorded }}
        link={recordedCallsLink(report.window, report.accountFilter)}
      />
      <KpiTile
        testId="costs-kpi-above"
        label={KPI_ABOVE}
        value={above.value}
        sub={above.sub}
        indicator={{ kind: 'leading', definition: AI_COST_KPI_DEFINITIONS.above }}
        href="#costs-leak"
      />
      <KpiTile
        testId="costs-kpi-periods"
        label={KPI_PERIODS}
        value={periodsValue}
        sub={subLine(periodsSub, incomplete)}
        status={periodsRed ? 'red' : null}
        indicator={{ kind: 'leading', definition: AI_COST_KPI_DEFINITIONS.periods }}
        {...anchor('#costs-periods')}
      />
      <KpiTile
        testId="costs-kpi-fallback"
        label={KPI_FALLBACK}
        value={rowsRead ? formatCount(report.fallback.count) : KPI_UNKNOWN}
        sub={subLine(
          rowsRead && report.fallback.count > 0 ? KPI_RECONCILED(formatCount(report.fallback.reconciled)) : null,
          incomplete
        )}
        indicator={{ kind: 'leading', definition: AI_COST_KPI_DEFINITIONS.fallback }}
        {...anchor('#costs-fallback')}
      />
    </KpiStrip>
  );
}
