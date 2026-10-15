/**
 * A payment plan's card shows the periods it is actually billed from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * This file had TWO card builders. One assembled the plan; the other built its
 * `paymentData` with `amount: servicePrice` and no `plan` field at all — from
 * rows it already had in scope and handed to `packageSessionPayment` two
 * statements earlier.
 *
 * With no plan, the card's "schedule not written yet" fallback synthesises a
 * SINGLE stage worth the whole price and marks it paid from
 * `booking.payment_status` — which flips to `paid` on the FIRST instalment. A
 * live ₪800 plan with one ₪400 period paid reported:
 *
 *     Total ₪800 · Collected ₪800 · Outstanding ₪0
 *
 * Neither period was listed, the ₪400 still to come was invisible, and the
 * ₪400 that had arrived could not be refunded, because refunds hang off the
 * stage rows that were never drawn.
 *
 * `buildSessionPlan` is now the single source both builders call, and these
 * tests pin the arithmetic that strip reads: `planTotals` sums the stage
 * statuses, so getting the stages right is what makes the figures right.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { buildSessionPlan } from '@/components/crm/contact-drawer/CRMContactDrawerV2';
import { planTotals } from '@/components/payments/PaymentPlanTotals';

const SERVICE = {
  payment_type: 'installments',
  installment_count: 2,
  installment_frequency: 'weekly',
};

/** The reported booking: ₪800 over two weekly periods, the first one paid. */
const PERIODS = [
  {
    id: 'p1',
    installment_number: 1,
    amount: 400,
    status: 'paid',
    due_date: '2026-10-15',
    paid_at: '2026-10-15T03:03:44.421+00:00',
    invoice_id: null,
    label: null,
    trigger: 'date' as const,
  },
  {
    id: 'p2',
    installment_number: 2,
    amount: 400,
    status: 'pending',
    due_date: '2026-10-22',
    paid_at: null,
    invoice_id: null,
    label: null,
    trigger: 'date' as const,
  },
];

const build = (periods = PERIODS, collected = 400) =>
  buildSessionPlan({
    planPeriods: periods,
    service: SERVICE,
    servicePrice: 800,
    serviceCurrency: 'ILS',
    collected,
  });

describe('the reported booking', () => {
  it('is recognised as a plan', () => {
    expect(build()).toBeDefined();
  });

  it('carries BOTH periods, so both get a row', () => {
    /*
     * The owner's actual request: see both payments, refund the one that was
     * paid, deal with the one still to come. `StageRowActions` hangs off these.
     */
    expect(build()!.stages).toHaveLength(2);
  });

  it('keeps each period on its own due date', () => {
    expect(build()!.stages!.map(s => s.dueDate)).toEqual(['2026-10-15', '2026-10-22']);
  });

  it('reports one of two paid, not a finished plan', () => {
    expect(build()!.periodsPaid).toBe(1);
    expect(build()!.installmentCount).toBe(2);
  });

  it('totals the periods, and the strip reads 800 / 400 / 400', () => {
    /*
     * The figures the owner asked to be accurate. `planTotals` is the real
     * function the strip uses, so this is the arithmetic that reaches the
     * screen — not a restatement of it.
     */
    const plan = build()!;
    const totals = planTotals(plan.stages!, plan.totalAmount);

    expect(totals).toMatchObject({ total: 800, collected: 400, outstanding: 400, cancelled: 0 });
  });

  it('names the period the plan is ON, not the one already paid', () => {
    expect(build()!.installmentAmount).toBe(400);
  });
});

describe('once the future period is called off', () => {
  it('the ₪400 moves to stopped and stops being outstanding', () => {
    /*
     * What the strip shows after the remaining period is cancelled: the money
     * is accounted for without asking the owner to collect it. Four cells, and
     * they still add up to the total.
     */
    const cancelled = [PERIODS[0], { ...PERIODS[1], status: 'cancelled' }];
    const plan = build(cancelled)!;
    const totals = planTotals(plan.stages!, plan.totalAmount);

    expect(totals).toMatchObject({ total: 800, collected: 400, cancelled: 400, outstanding: 0 });
  });

  it('the cancelled period keeps its row', () => {
    /* Dropping it would make the card add up only by hiding the other half. */
    const cancelled = [PERIODS[0], { ...PERIODS[1], status: 'cancelled' }];

    expect(build(cancelled)!.stages).toHaveLength(2);
  });
});

describe('the total comes from the periods, never the service price', () => {
  it('a client who bought at a since-raised price keeps their own total', () => {
    /*
     * `scheduling_services.price` is the live figure and `payment_plans` is a
     * per-service template with no `booking_id` — one row serves every booking
     * of that service. Neither records what a particular client agreed to; the
     * installments do.
     */
    const cheaper = [
      { ...PERIODS[0], amount: 100 },
      { ...PERIODS[1], amount: 100 },
    ];
    const plan = buildSessionPlan({
      planPeriods: cheaper,
      service: SERVICE,
      servicePrice: 800,
      serviceCurrency: 'ILS',
      collected: 100,
    })!;

    expect(plan.totalAmount).toBe(200);
    expect(planTotals(plan.stages!, plan.totalAmount)).toMatchObject({
      total: 200,
      collected: 100,
      outstanding: 100,
    });
  });
});

describe('billed in full', () => {
  it('is believed when no periods exist to contradict it', () => {
    /*
     * A path that ignored the plan and charged the whole price leaves exactly
     * this trace, and the card must follow the money rather than the service's
     * configuration.
     */
    expect(
      buildSessionPlan({
        planPeriods: [],
        service: SERVICE,
        servicePrice: 800,
        serviceCurrency: 'ILS',
        collected: 800,
      })
    ).toBeUndefined();
  });

  it('is NOT believed over the periods themselves', () => {
    /*
     * The guard that matters here. A plan whose last period is paid has
     * `collected === servicePrice`, and reading that alone made it stop being
     * a plan on the very screen that reports it — the owner losing the
     * schedule and every refund button at the moment the history matters most.
     *
     * Two ₪400 periods are direct evidence the ₪800 was not billed in one go.
     */
    const bothPaid = PERIODS.map(p => ({ ...p, status: 'paid' }));
    const plan = buildSessionPlan({
      planPeriods: bothPaid,
      service: SERVICE,
      servicePrice: 800,
      serviceCurrency: 'ILS',
      collected: 800,
    });

    expect(plan).toBeDefined();
    expect(plan!.stages).toHaveLength(2);
    expect(planTotals(plan!.stages!, plan!.totalAmount)).toMatchObject({
      total: 800,
      collected: 800,
      outstanding: 0,
    });
  });
});

describe('not a plan', () => {
  it('a single-payment service gets no plan object', () => {
    expect(
      buildSessionPlan({
        planPeriods: [],
        service: { payment_type: 'full', installment_count: 1 },
        servicePrice: 800,
        serviceCurrency: 'ILS',
        collected: 0,
      })
    ).toBeUndefined();
  });

  it('nor does a one-period "plan"', () => {
    expect(
      buildSessionPlan({
        planPeriods: [],
        service: { payment_type: 'installments', installment_count: 1 },
        servicePrice: 800,
        serviceCurrency: 'ILS',
        collected: 0,
      })
    ).toBeUndefined();
  });

  it('nor a free service', () => {
    expect(
      buildSessionPlan({
        planPeriods: [],
        service: SERVICE,
        servicePrice: 0,
        serviceCurrency: 'ILS',
        collected: 0,
      })
    ).toBeUndefined();
  });
});

describe('before the schedule is written', () => {
  it('falls back to the service price and omits the list', () => {
    /*
     * The window between booking and the processor confirming. The totals are
     * real; drawing projected rows with invented dates would have the card
     * assert a schedule nobody has agreed to.
     */
    const plan = buildSessionPlan({
      planPeriods: [],
      service: SERVICE,
      servicePrice: 800,
      serviceCurrency: 'ILS',
      collected: 0,
    })!;

    expect(plan.totalAmount).toBe(800);
    expect(plan.stages).toBeUndefined();
    expect(plan.periodsPaid).toBeUndefined();
  });
});
