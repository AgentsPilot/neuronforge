'use client';

/**
 * "Our revenue" (S1-FR-25 to S1-FR-27). Three branches, all words: none yet,
 * recorded (a live paid row exists), or could not check. Never a $0 figure and
 * never a chart.
 */

import type { FinanceRevenueSection } from '@/lib/business-os/finance/financeTypes';
import {
  REVENUE_COULD_NOT_CHECK,
  REVENUE_NONE_YET,
  REVENUE_RECORDED,
  REVENUE_SUBTITLE,
  REVENUE_TITLE,
} from '../financeCopy';

const TEXT: Record<FinanceRevenueSection['state'], string> = {
  none_yet: REVENUE_NONE_YET,
  recorded: REVENUE_RECORDED,
  unknown: REVENUE_COULD_NOT_CHECK,
};

export function RevenuePanel({ revenue }: { revenue: FinanceRevenueSection }) {
  return (
    <section
      aria-labelledby="revenue-heading"
      data-testid="section-revenue"
      data-state={revenue.state}
      className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 space-y-1"
    >
      <h2 id="revenue-heading" className="text-base font-semibold text-white">
        {REVENUE_TITLE}
      </h2>
      <p className="text-xs text-slate-400">{REVENUE_SUBTITLE}</p>
      <p className="text-sm text-slate-200" data-testid="revenue-text">
        {TEXT[revenue.state]}
      </p>
    </section>
  );
}
