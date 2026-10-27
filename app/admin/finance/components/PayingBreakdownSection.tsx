'use client';

/**
 * F-K5's breakdown on Plans & subscriptions (Money MK-9; KPI restructure review
 * §12 MK-9, from the superseded §11N S5B-FR-8 to FR-16; SA-WP-MK9).
 *
 * First on the tab (F-K5 opens it, MK-5): Paying as the tile counts it
 * (`payload.paying`, not recomputed, SA-Q-MK9-3); Comped split in two
 * (BQ-22); trial-to-paid (BQ-23). Every figure is the server's; this file only
 * labels it. It renders from the Overview payload, so the tab makes no new
 * request (AC-173). Unknown is said in words, never shown as 0. No billing
 * mode is named (MK9-R1).
 */

import type { FinancePaying, FinancePayingBreakdown } from '@/lib/business-os/finance/financeTypes';
import { AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { formatCount } from '@/app/admin/components/layout/adminFormat';

import { FINANCE_KPIS, PAYING_BREAKDOWN } from '../financeCopy';
import { atLeast } from '../financeFormat';
import { FinanceSection } from './FinanceSection';

const LINE = 'text-sm text-slate-200';
const NOTE = 'text-xs text-slate-400';
const SUBHEAD = 'text-sm font-medium text-slate-200';

function payingLine(paying: FinancePaying | undefined): string {
  if (!paying || paying.scope !== 'all' || paying.status === 'unknown' || paying.paying === null || paying.accounts === null) {
    return PAYING_BREAKDOWN.payingUnknown;
  }
  const exact = paying.status === 'ok';
  return PAYING_BREAKDOWN.paying(atLeast(formatCount(paying.paying), exact), atLeast(formatCount(paying.accounts), exact));
}

export function PayingBreakdownSection({
  breakdown,
  paying,
  onRetry,
}: {
  breakdown: FinancePayingBreakdown;
  paying: FinancePaying | undefined;
  onRetry: () => void;
}) {
  const { comped, trials } = breakdown;
  const exact = trials.status === 'ok';
  const n = (value: number) => atLeast(formatCount(value), exact);
  const status = trials.status === 'unknown' && comped === null ? 'unknown' : trials.status === 'partial' ? 'partial' : 'ok';
  return (
    <FinanceSection
      id="paying-breakdown"
      title={FINANCE_KPIS.paying.label}
      subtitle={PAYING_BREAKDOWN.subtitle}
      status={status}
      onRetry={onRetry}
    >
      <div className="space-y-4" data-testid="paying-breakdown-body">
        <p className={LINE} data-testid="paying-breakdown-paying">
          {payingLine(paying)}
        </p>

        <div className="space-y-1" role="group" aria-labelledby="paying-breakdown-comped-heading" data-testid="paying-breakdown-comped">
          <h3 id="paying-breakdown-comped-heading" className={SUBHEAD}>
            {PAYING_BREAKDOWN.compedHeading}
          </h3>
          {comped === null ? (
            <p className={LINE} data-testid="paying-breakdown-comped-unknown">
              {PAYING_BREAKDOWN.compedUnknown}
            </p>
          ) : (
            <p className={LINE} data-testid="paying-breakdown-comped-line">
              {PAYING_BREAKDOWN.compedTotal(formatCount(comped.total))} · {PAYING_BREAKDOWN.assigned} {formatCount(comped.assignedNoSubscription)} ·{' '}
              {PAYING_BREAKDOWN.endedOrNotPaying} {formatCount(comped.endedOrNotPaying)}
            </p>
          )}
          <p className={NOTE}>{PAYING_BREAKDOWN.note}</p>
        </div>

        <div className="space-y-1" role="group" aria-labelledby="paying-breakdown-trials-heading" data-testid="paying-breakdown-trials">
          <h3 id="paying-breakdown-trials-heading" className={SUBHEAD}>
            {PAYING_BREAKDOWN.trialsHeading}
          </h3>
          {trials.status === 'unknown' || trials.endedInWindow === null || trials.stillRunning === null ? (
            <p className={LINE} data-testid="paying-breakdown-trials-unknown">
              {PAYING_BREAKDOWN.trialsUnknown}
            </p>
          ) : (
            <>
              {!exact && <AdminNotice testId="paying-breakdown-cut-off">{PAYING_BREAKDOWN.cutOff}</AdminNotice>}
              <p className={LINE} data-testid="paying-breakdown-trials-line">
                {PAYING_BREAKDOWN.endedInWindow(n(trials.endedInWindow))} ·{' '}
                {trials.paid === null || trials.paidBeforeEnd === null
                  ? PAYING_BREAKDOWN.paidUnknown
                  : `${PAYING_BREAKDOWN.paid(n(trials.paid))} (${PAYING_BREAKDOWN.paidBeforeEnd(n(trials.paidBeforeEnd))})`}
              </p>
              {/* MK9-FU-1 (SA-Q-FU-9): with Paid unknown there is no rate; the line above already says why. */}
              {(trials.rate !== null || !exact || trials.paid !== null) && (
                <p className={LINE} data-testid="paying-breakdown-rate">
                  {trials.rate !== null
                    ? PAYING_BREAKDOWN.rate(formatCount(trials.rate.paid), formatCount(trials.rate.base), formatCount(trials.rate.percent))
                    : !exact
                      ? PAYING_BREAKDOWN.noRateCutOff
                      : PAYING_BREAKDOWN.tooFew(formatCount(trials.minimumForRate))}
                </p>
              )}
              <p className={LINE} data-testid="paying-breakdown-running">
                {PAYING_BREAKDOWN.stillRunning(n(trials.stillRunning))}
              </p>
            </>
          )}
          <p className={NOTE}>{PAYING_BREAKDOWN.limits}</p>
        </div>
      </div>
    </FinanceSection>
  );
}
