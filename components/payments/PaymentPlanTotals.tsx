'use client';

/**
 * What a payment plan is worth, what has landed, and what is still out.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 *
 * Every surface that shows a plan showed one figure from it and left the reader
 * to infer the rest. The payment dialog showed "Amount $500 / Status Paid" —
 * the deposit — directly above a button collecting a DIFFERENT $500. The
 * booking journey listed the stages with no sense of the whole. An owner could
 * read either one and not know whether a $1,000 job was half collected or
 * finished.
 *
 * Three numbers answer it, and they have to be the same three everywhere, or
 * the surfaces disagree about the same money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ARITHMETIC
 *
 * Collected is summed from the stages that are actually `paid`, never from the
 * booking's own `payment_status` — that flips to `paid` when the FIRST stage
 * lands, which is the assumption this component exists to replace.
 *
 * Total prefers the plan's agreed figure over the sum of its stages. A stage
 * list can be edited after the fact; what was agreed is what was agreed.
 *
 * @module components/payments/PaymentPlanTotals
 */

import { REFUND_HEX, refundExtent } from './refundTone';

interface PlanStage {
  status: string;
  amount: number;
}

interface PaymentPlanTotalsProps {
  stages: PlanStage[];
  currency: string;
  /** The agreed figure, when the plan carries one. */
  totalAmount?: number;
  /** Translations, so this carries no English of its own. */
  labels: {
    total: string;
    collected: string;
    outstanding: string;
    /** Shown only when a period has been called off. Omit and the cell is too. */
    cancelled?: string;
    /** Money handed back. Pair with `kept`; both are needed or neither renders. */
    refunded?: string;
    /** What the business is left with: charged minus returned. */
    kept?: string;
  };
  /**
   * How much has gone back to the client.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A REFUND IS A DIFFERENT ACCOUNT, not a smaller collection.
   *
   * With money returned, "collected ₪100 / outstanding ₪0" is true and useless:
   * it describes a settled payment and says nothing about the ₪100 that went
   * back. The questions become what was charged, what was returned, and what is
   * left — so those three replace the middle pair rather than crowding in
   * beside them.
   *
   * Absent or zero changes nothing, which is what keeps every existing caller
   * rendering exactly as it did.
   * ───────────────────────────────────────────────────────────────────────────
   */
  refunded?: number;
  locale?: string;
  /** `compact` for the booking journey, where it sits inside a timeline row. */
  size?: 'default' | 'compact';
  /**
   * Something outstanding is past its due date.
   *
   * Red rather than amber, and it renames the third cell. Overdue money is a
   * different fact from money merely not yet collected, and the installment
   * list was already making that distinction before this component existed —
   * folding it in is what let that surface adopt the shared one without losing
   * a signal the owner relies on.
   */
  overdue?: boolean;
  /** Overrides the third cell's label when something is overdue. */
  overdueLabel?: string;
  className?: string;
}

/** The plan's arithmetic, exported so callers can reuse it without re-deriving. */
export function planTotals(stages: PlanStage[], totalAmount?: number) {
  const summed = stages.reduce((sum, stage) => sum + Number(stage.amount || 0), 0);
  const total = totalAmount ?? summed;

  const sumOf = (status: string) =>
    stages
      .filter(stage => stage.status === status)
      .reduce((sum, stage) => sum + Number(stage.amount || 0), 0);

  const collected = sumOf('paid');

  /*
   * A CANCELLED PERIOD IS NOT OUTSTANDING.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Outstanding was `total - collected`, which is every period that has not been
   * paid — including the ones deliberately called off. So stopping a plan
   * changed nothing the owner could see: ₪800 agreed, ₪400 collected, ₪400
   * "still to collect", for money that will never be asked for again.
   *
   * It is reported separately rather than subtracted silently, because the two
   * are different facts and the owner needs both: ₪400 arrived, ₪400 was given
   * up on. Folding the second into the first would make a stopped plan look
   * like a completed one.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const cancelled = sumOf('cancelled');

  return {
    total,
    collected,
    cancelled,
    outstanding: Math.max(total - collected - cancelled, 0),
  };
}

/**
 * What the business still holds after money went back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FROM WHAT WAS COLLECTED, NOT FROM WHAT WAS AGREED.
 *
 * The totals strip read `total - refunded`, which is the same figure only when
 * the whole plan has already been paid. On a plan half collected it credited
 * the business with money nobody has sent: ₪800 agreed, ₪400 collected, ₪200
 * returned reported ₪600 kept, when ₪200 is in hand and the other ₪400 has not
 * been charged yet.
 *
 * `collected` is gross — a partly refunded period keeps its `paid` status — so
 * subtracting the refund here is the whole of the deduction, not a second one.
 *
 * Floored at zero: a refund larger than the charge is a data fault, and a
 * negative "kept" in a summary cell reads as a debt to the client that nothing
 * else in the product would explain.
 */
export function keptAfterRefund(collected: number, refunded: number): number {
  return Math.max(collected - refunded, 0);
}

export function PaymentPlanTotals({
  stages,
  currency,
  totalAmount,
  labels,
  locale = 'en-US',
  size = 'default',
  overdue = false,
  overdueLabel,
  refunded = 0,
  className,
}: PaymentPlanTotalsProps) {
  if (!stages.length) return null;

  const { total, collected, cancelled, outstanding } = planTotals(stages, totalAmount);

  const money = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      // Whole amounts lose their `.00`. Three figures side by side are read as
      // a comparison, and trailing zeros are noise in that reading.
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);

  const compact = size === 'compact';

  /*
   * Money went back, so the account is charged / returned / kept.
   *
   * Requires both labels: a caller that has not been given the words for this
   * gets the ordinary three cells rather than an English fallback appearing in
   * a Hebrew strip.
   */
  const showsRefund = refunded > 0 && Boolean(labels.refunded && labels.kept);

  const cells = showsRefund
    ? [
        { label: labels.total, value: total, tone: 'var(--v2-text-primary)' },
        {
          label: labels.refunded!,
          /*
           * ───────────────────────────────────────────────────────────────────
           * THE FIGURE THAT HAS TO BE SEEN.
           *
           * Amber read as a note beside the total rather than as the headline
           * of the card: a job showing "₪2,000 agreed · ₪2,000 returned · ₪0
           * kept" is a job that earned nothing, and that has to register before
           * anything else on it does.
           *
           * Red only when ALL of it went back. A partial refund keeps amber —
           * the business is still holding money, and the three cells beside it
           * say how much.
           * ───────────────────────────────────────────────────────────────────
           */
          value: refunded,
          /*
           * Measured against what was COLLECTED, not what was agreed.
           *
           * A plan is refunded out of the money that actually arrived. Judging
           * the extent against the agreed total called "every penny taken has
           * gone back" a partial refund, because the periods not yet billed
           * made the denominator larger than the money in hand.
           */
          tone: REFUND_HEX[refundExtent(refunded, collected || total)],
        },
        {
          /*
           * What the business actually keeps.
           *
           * ───────────────────────────────────────────────────────────────────
           * FROM WHAT WAS COLLECTED, NOT FROM WHAT WAS AGREED.
           *
           * This read `total - refunded`, which is only the same figure when
           * the whole plan has already been paid. On a plan half collected it
           * credited the business with money nobody has sent: ₪800 agreed with
           * ₪400 collected and ₪200 returned reported ₪600 kept, when ₪200 is
           * in hand and ₪400 is still to come.
           *
           * `collected` is gross — a partly refunded period stays `paid` — so
           * subtracting the refund here is the whole of it, not a second
           * deduction.
           * ───────────────────────────────────────────────────────────────────
           *
           * Floored at zero: a refund larger than the charge is a data fault,
           * and a negative "kept" figure in a summary cell reads as a debt to
           * the client that nothing else in the product would explain.
           */
          label: labels.kept!,
          value: keptAfterRefund(collected, refunded),
          tone: keptAfterRefund(collected, refunded) > 0 ? '#22C58B' : 'var(--v2-text-muted)',
        },
      ]
    : [
        { label: labels.total, value: total, tone: 'var(--v2-text-primary)' },
        { label: labels.collected, value: collected, tone: '#22C58B' },
        {
          label: overdue && overdueLabel ? overdueLabel : labels.outstanding,
          value: outstanding,
          // Red when it is late, amber while it is merely owed, muted at zero. A
          // finished plan showing a warning colour against nothing reads as a
          // problem that is not there.
          tone: outstanding <= 0 ? 'var(--v2-text-muted)' : overdue ? '#F04438' : '#F79009',
        },
      ];

  /*
   * The fourth figure, and only when there is one.
   *
   * Without it the row does not add up — ₪800 agreed, ₪400 collected, ₪0
   * outstanding — and the reader is left to work out where the other ₪400 went.
   * Amber-brown rather than red: money given up on is not money lost to a
   * failure, and this is the same reading the cancelled-money figures use
   * elsewhere.
   */
  /*
   * Not alongside the refund trio. Those three already account for every
   * figure — charged, returned, kept — and a fourth cell for money given up on
   * would be describing a plan while the other three describe a refund.
   */
  if (!showsRefund && cancelled > 0 && labels.cancelled) {
    cells.push({ label: labels.cancelled, value: cancelled, tone: '#B54708' });
  }

  /*
   * STILL TO COLLECT, EVEN WHEN MONEY HAS GONE BACK.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The refund trio replaces the ordinary three cells, so a refund on a plan
   * that is only part collected took the outstanding figure off the screen
   * altogether: ₪800 agreed, ₪200 returned, ₪200 kept, and the ₪400 the client
   * still owes simply not mentioned. The owner reads that as a finished job.
   *
   * This is the same reasoning the cancelled cell is given above — a row the
   * reader cannot make add up is a row that invites the wrong conclusion — and
   * unlike `cancelled` it is not describing a different thing from the refund:
   * charged, returned, kept and still-to-come are four facts about one plan.
   *
   * Only when there is some. A fully collected plan shows the trio alone.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (showsRefund && outstanding > 0) {
    cells.push({
      label: overdue && overdueLabel ? overdueLabel : labels.outstanding,
      value: outstanding,
      tone: overdue ? '#F04438' : '#F79009',
    });
  }

  return (
    <div
      className={`grid gap-px overflow-hidden ${className ?? ''}`}
      style={{
        // Follows the cell count: three normally, four once a period is cancelled.
        gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`,
        borderRadius: compact ? '10px' : '12px',
        border: '1px solid var(--v2-border)',
        background: 'var(--v2-border)',
      }}
    >
      {cells.map(cell => (
        <div
          key={cell.label}
          className={compact ? 'px-2 py-1.5 text-center' : 'px-3 py-3 text-center'}
          style={{ background: 'var(--v2-surface)' }}
        >
          <div
            className={compact ? 'text-[10px]' : 'text-[11px]'}
            style={{ color: 'var(--v2-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
          >
            {cell.label}
          </div>
          <div
            className={`${compact ? 'text-[13px] mt-0.5' : 'text-base mt-1'} font-semibold tabular-nums`}
            style={{ color: cell.tone }}
          >
            {money(cell.value)}
          </div>
        </div>
      ))}
    </div>
  );
}
