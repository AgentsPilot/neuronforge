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
  labels: { total: string; collected: string; outstanding: string };
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
  const collected = stages
    .filter(stage => stage.status === 'paid')
    .reduce((sum, stage) => sum + Number(stage.amount || 0), 0);

  return { total, collected, outstanding: Math.max(total - collected, 0) };
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
  className,
}: PaymentPlanTotalsProps) {
  if (!stages.length) return null;

  const { total, collected, outstanding } = planTotals(stages, totalAmount);

  const money = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      // Whole amounts lose their `.00`. Three figures side by side are read as
      // a comparison, and trailing zeros are noise in that reading.
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);

  const compact = size === 'compact';

  const cells = [
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

  return (
    <div
      className={`grid grid-cols-3 gap-px overflow-hidden ${className ?? ''}`}
      style={{
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
