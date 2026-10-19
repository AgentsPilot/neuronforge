'use client';

/**
 * Revenue → "Recurring now (MRR)" (Money MK-4; KPI restructure review §3.2,
 * F-K2, BQ-P8a-4). MRR now beside the cash received in the window, never
 * added to it.
 *
 * MONEY: one line per currency, in integer hundredths from the one MRR rule;
 * shown through `formatMoney` like the rest of the panel (the `$`-only display
 * is MK-5's). Past due is counted and shown apart; cancelling is shown apart.
 * A failed read says "Unknown", never 0. With a test key the line carries the
 * "Stripe test mode" chip (C-4, SA-CR-MK4 CR-2) from the one allowed copy
 * constant; with a live key, or no figure, it carries none. Every string from
 * `financeCopy.ts`.
 */

import type { FinanceMrrLine, FinanceMrrSection } from '@/lib/business-os/finance/financeTypes';
import { formatCount } from '@/app/admin/components/layout/adminFormat';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import {
  REVENUE_RECURRING_CANCELLING,
  REVENUE_RECURRING_DISCOUNT,
  REVENUE_RECURRING_HEADING,
  REVENUE_RECURRING_NONE,
  REVENUE_RECURRING_NOT_EXACT,
  REVENUE_RECURRING_NOTE,
  REVENUE_RECURRING_PAST_DUE,
  REVENUE_RECURRING_PAST_DUE_NOT_COUNTED,
  REVENUE_RECURRING_SUBSCRIPTIONS,
  REVENUE_RECURRING_TEST_KEY_LABEL,
  REVENUE_RECURRING_UNKNOWN,
  REVENUE_RECURRING_UNPRICED,
} from '../financeCopy';
import { formatMoney } from '../financeFormat';

const SUBHEAD = 'text-sm font-medium text-slate-200';
const NOTE = 'text-[11px] text-slate-400';

/** Hundredths to the panel's money text; integer hundredths only ever divided once, for display. */
const shown = (hundredths: number, currency: string | null) => formatMoney(hundredths / 100, currency);

function lineParts(line: FinanceMrrLine): string {
  const parts = [REVENUE_RECURRING_SUBSCRIPTIONS(line.subscriptions, formatCount(line.subscriptions))];
  if (line.pastDueHundredths > 0) parts.push(REVENUE_RECURRING_PAST_DUE(shown(line.pastDueHundredths, line.currency)));
  if (line.cancellingHundredths > 0) parts.push(REVENUE_RECURRING_CANCELLING(shown(line.cancellingHundredths, line.currency)));
  if (line.overflow) parts.push(REVENUE_RECURRING_NOT_EXACT);
  return parts.join(' · ');
}

export function RecurringNowPart({ mrr, stripeMode }: { mrr: FinanceMrrSection; stripeMode: 'test' | 'live' | null }) {
  return (
    <div className="space-y-2" data-testid="revenue-recurring" data-status={mrr.status}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={SUBHEAD}>{REVENUE_RECURRING_HEADING}</h3>
        {stripeMode === 'test' && mrr.status === 'ok' && (
          <StatusChip tone="neutral" testId="revenue-recurring-key">
            {REVENUE_RECURRING_TEST_KEY_LABEL}
          </StatusChip>
        )}
      </div>
      {mrr.status === 'unknown' ? (
        <p className="text-sm text-slate-300" data-testid="revenue-recurring-unknown">{REVENUE_RECURRING_UNKNOWN}</p>
      ) : mrr.lines.length === 0 ? (
        <p className="text-sm text-slate-300" data-testid="revenue-recurring-none">{REVENUE_RECURRING_NONE}</p>
      ) : (
        <ul className="space-y-1">
          {mrr.lines.map((line) => (
            <li key={line.currency ?? 'unknown'} className="text-sm text-white" data-testid={`revenue-recurring-${line.currency ?? 'unknown'}`}>
              <span className="font-semibold tabular-nums" data-money="mrr">{shown(line.totalHundredths, line.currency)}</span>{' '}
              <span className="text-xs text-slate-400">{lineParts(line)}</span>
            </li>
          ))}
        </ul>
      )}
      {mrr.status === 'ok' && !mrr.pastDueCounted && <p className={NOTE}>{REVENUE_RECURRING_PAST_DUE_NOT_COUNTED}</p>}
      {mrr.status === 'ok' && mrr.unpriced > 0 && <p className={NOTE}>{REVENUE_RECURRING_UNPRICED(formatCount(mrr.unpriced))}</p>}
      {mrr.status === 'ok' && mrr.discountUnknown > 0 && <p className={NOTE}>{REVENUE_RECURRING_DISCOUNT(formatCount(mrr.discountUnknown))}</p>}
      <p className={NOTE}>{REVENUE_RECURRING_NOTE}</p>
    </div>
  );
}
