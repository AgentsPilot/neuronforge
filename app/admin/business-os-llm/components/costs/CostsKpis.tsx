'use client';

/**
 * The Costs & credits tab's KPI strip (Admin Layout Standard §5.4, §7.12; L-9a
 * workplan §2.5). Every value comes from the report already read (K-9): no
 * read of its own, and no margin tile (the payload has no credit price).
 *
 *   Credits charged       grandTotal.stored.creditsTotal     anchor #costs-periods
 *   Charged AI cost       chargedInWindow.costUsd            anchor #costs-charged
 *   Charges               grandTotal.stored.charges          anchor #costs-breakdowns
 *   Fallback-priced       fallback.count, "{n} reconciled"   anchor #costs-fallback
 *   Periods not matching  mismatchedPeriods, "of {n} checked" or "Not checked"
 *                                                            anchor #costs-periods
 *
 * Colour (SA M-1, Q-10): the four totals tiles are always neutral. Periods not
 * matching is red ("Needs action") when a period disagrees, incomplete report
 * included: the tab already shows that mismatch as a red chip and a red line
 * (K-5 (ii)). An incomplete report adds "may be incomplete" to every tile's
 * sub-line and turns none amber: the amber notice below already says it.
 *
 * Money MK-2 (SA-1): the cost tile is charges CREATED in the window, deleted
 * accounts included, Finance's own computation (equal for the same window).
 * Its exactness is its own: "at least" at the ledger ceiling or with an
 * unreadable amount, "Unknown" when its read failed. Credits charged and
 * Charges still read the stored whole-period totals and say so (D-1).
 *
 * Anchors are links only while their section is rendered (an empty report or
 * failed totals render no sections); otherwise the tile has no target (K-6).
 */

import { KpiStrip, KpiTile } from '@/app/admin/components/layout/KpiStrip';

import { formatCount, formatCredits, formatUsd } from '../../costFormat';
import {
  KPI_CHARGES,
  KPI_COST_USD,
  KPI_AT_LEAST,
  KPI_CREDITS,
  KPI_FALLBACK,
  KPI_MAY_BE_INCOMPLETE,
  KPI_NOT_CHECKED,
  KPI_OF_CHECKED,
  KPI_PERIODS,
  KPI_RECONCILED,
  KPI_UNKNOWN,
  KPI_WHOLE_PERIODS,
} from '../../costCopy';
import type { CostReportPayload } from '../../costTypes';

export interface CostsKpisProps {
  report: CostReportPayload | null;
  /** The first read (or the first after an error) is in flight: the K-10 placeholders. */
  firstLoad: boolean;
  /** The four sections are on screen, so the anchor tiles have somewhere to go. */
  sectionsShown: boolean;
}

const PLACEHOLDERS = 5;

/** The parts that are present, joined; null when none is. */
function subLine(...parts: Array<string | null>): string | null {
  return parts.filter((part): part is string => part !== null).join('; ') || null;
}

export function CostsKpis({ report, firstLoad, sectionsShown }: CostsKpisProps) {
  if (!report) return firstLoad ? <KpiStrip loading placeholderCount={PLACEHOLDERS} /> : null;

  const totalsRead = report.sections.totals !== 'failed';
  // The fallback list comes from the rows read; a rows read that failed or never ran has no count.
  const rowsRead = report.sections.rows === 'ok';
  const incomplete = report.incomplete ? KPI_MAY_BE_INCOMPLETE : null;
  const stored = report.grandTotal.stored;
  const charged = report.chargedInWindow;
  const chargedKnown = charged.status !== 'unknown' && charged.costUsd !== null;

  const checked = report.periods.filter((period) => period.matches !== null).length;
  const noneChecked = report.periods.length > 0 && checked === 0;
  const periodsValue = !totalsRead
    ? KPI_UNKNOWN
    : noneChecked
      ? KPI_NOT_CHECKED
      : formatCount(report.mismatchedPeriods);
  const periodsSub =
    totalsRead && !noneChecked && checked < report.periods.length ? KPI_OF_CHECKED(formatCount(checked)) : null;
  const periodsRed = totalsRead && !noneChecked && report.mismatchedPeriods > 0;

  const anchor = (target: `#${string}`) => (sectionsShown ? { href: target } : {});

  return (
    <KpiStrip>
      <KpiTile
        testId="costs-kpi-credits"
        label={KPI_CREDITS}
        value={totalsRead ? formatCredits(stored.creditsTotal) : KPI_UNKNOWN}
        sub={subLine(KPI_WHOLE_PERIODS, incomplete)}
        {...anchor('#costs-periods')}
      />
      <KpiTile
        testId="costs-kpi-cost"
        label={KPI_COST_USD}
        value={chargedKnown ? formatUsd(charged.costUsd) : KPI_UNKNOWN}
        sub={chargedKnown && charged.status === 'partial' ? KPI_AT_LEAST : null}
        {...anchor('#costs-charged')}
      />
      <KpiTile
        testId="costs-kpi-charges"
        label={KPI_CHARGES}
        value={totalsRead ? formatCount(stored.charges) : KPI_UNKNOWN}
        sub={subLine(KPI_WHOLE_PERIODS, incomplete)}
        {...anchor('#costs-breakdowns')}
      />
      <KpiTile
        testId="costs-kpi-fallback"
        label={KPI_FALLBACK}
        value={rowsRead ? formatCount(report.fallback.count) : KPI_UNKNOWN}
        sub={subLine(
          rowsRead && report.fallback.count > 0 ? KPI_RECONCILED(formatCount(report.fallback.reconciled)) : null,
          incomplete,
        )}
        {...anchor('#costs-fallback')}
      />
      <KpiTile
        testId="costs-kpi-periods"
        label={KPI_PERIODS}
        value={periodsValue}
        sub={subLine(periodsSub, incomplete)}
        status={periodsRed ? 'red' : null}
        {...anchor('#costs-periods')}
      />
    </KpiStrip>
  );
}
