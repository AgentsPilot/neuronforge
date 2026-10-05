'use client';

/**
 * A payment plan as the dated list a client is actually agreeing to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The dialog described a plan as a row of dots, "Due today: ₪100", "Then:
 * 1 × ₪100, weekly" and a total. It never said WHEN. A client could not see the
 * dates they were committing to, and the business had nothing to point back at.
 *
 * Worse, "Due today" was a claim rather than a fact: a plan whose first payment
 * is deferred charges nothing at checkout — the subscription runs a trial and
 * Stripe collects on the agreed day — and the dialog said "Due today: ₪100"
 * over the top of it.
 *
 * Dates come from `planDisplaySchedule`, which is built on the same
 * `planStartDate` and `planSchedule` the server hands Stripe. The list a client
 * reads and the charges that follow therefore come from one calculation rather
 * than two that happen to agree.
 *
 * Rendered in all three places a plan is shown — the service details, the
 * payment step and the confirmation — so they cannot describe the same plan
 * differently.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { planDisplaySchedule, type DisplayablePlan } from '@/lib/payments/planDisplaySchedule';

export interface PlanPaymentListLabels {
  paymentPlan: string;
  dueToday: string;
  planTotal: string;
  /** Shown instead of a "due today" row when the plan starts later. */
  nothingDueToday: string;
  free: string;
}

interface Props {
  plan: DisplayablePlan;
  labels: PlanPaymentListLabels;
  locale: string;
  primaryColor: string;
  formatAmount: (amount: number | null, currency: string, locale: string, freeLabel: string) => string;
  /**
   * Fixed by the caller at render time.
   *
   * A plan's dates are relative to "now", and reading the clock inside would
   * make the three places this appears disagree by whatever time passed between
   * them — and make it untestable without freezing the clock.
   */
  now: Date;
  /**
   * Cap the rows, with a summary line for the rest.
   *
   * A twelve-month plan on the details card is a wall of dates; on the payment
   * step, where the client is committing, every row is worth showing.
   */
  maxRows?: number;
}

export function PlanPaymentList({
  plan,
  labels,
  locale,
  primaryColor,
  formatAmount,
  now,
  maxRows,
}: Props) {
  const schedule = planDisplaySchedule(plan, now);
  const shown = maxRows ? schedule.payments.slice(0, maxRows) : schedule.payments;
  const hidden = schedule.payments.length - shown.length;

  const formatDate = (date: Date) =>
    date.toLocaleDateString(locale === 'he' ? 'he-IL' : locale === 'es' ? 'es-ES' : 'en-US', {
      day: 'numeric',
      month: 'short',
    });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium ap-ink-3">{labels.paymentPlan}</span>
        {/*
          Said once, at the top, rather than as a badge that would have to be
          absent from every row — which is how "Due today" survived on a plan
          that charges nothing today.
        */}
        {schedule.deferred && (
          <span className="text-xs ap-ink-3">{labels.nothingDueToday}</span>
        )}
      </div>

      <ul className="space-y-1">
        {shown.map(payment => (
          <li key={payment.number} className="flex items-baseline justify-between gap-3">
            <span className="text-sm ap-ink-2 flex items-baseline gap-2">
              <span className="tabular-nums">{payment.number}.</span>
              <span className="tabular-nums">{formatDate(payment.dueDate)}</span>
              {payment.dueToday && (
                <span className="text-xs font-medium" style={{ color: primaryColor }}>
                  {labels.dueToday}
                </span>
              )}
            </span>
            <span
              className="text-sm tabular-nums whitespace-nowrap"
              style={payment.dueToday ? { color: primaryColor, fontWeight: 600 } : undefined}
            >
              {formatAmount(payment.amount, schedule.currency, locale, labels.free)}
            </span>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        // The count, never a bare ellipsis: a client should be able to tell how
        // many payments they have agreed to without opening anything.
        <p className="text-xs ap-ink-3 tabular-nums">+{hidden}</p>
      )}

      <div className="flex items-baseline justify-between gap-3 pt-1.5 border-t ap-line">
        <span className="text-sm ap-ink-2">{labels.planTotal}</span>
        <span className="text-sm font-semibold ap-ink tabular-nums whitespace-nowrap">
          {formatAmount(schedule.total, schedule.currency, locale, labels.free)}
        </span>
      </div>
    </div>
  );
}
