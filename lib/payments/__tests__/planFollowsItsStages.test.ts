/**
 * A plan follows the stages that can still be collected.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS SUITE EXISTS: THE GUARD THAT A FAILED READ TURNED OFF
 *
 * `payment_plans.total_amount` and `installment_count` are STORED, so whoever
 * cancels stages has to bring them down. But some plan rows are shared: a
 * service sold on instalments has ONE plan that every booking of that service
 * hangs its stages off, and for those rows the two numbers are the TERMS — 800
 * over 2 — not one client's balance. Decrementing a shared row takes one
 * client's cancellation off everybody else's terms, and the next booking of
 * that service quotes a price the owner never set.
 *
 * The only thing standing between the update and that outcome is one read:
 * count the bookings named by the plan's stages, and skip the plan if there is
 * more than one. That read discarded its error.
 *
 *     const { data: siblings } = await db.from('payment_plan_installments')…
 *
 * So on a failed read `siblings ?? []` is an empty set, an empty set is not
 * `> 1`, and the guard waved through exactly the row it exists to protect —
 * silently, and compounding with every cancellation.
 *
 * Three callers reach this: `cancelQuoteStages`, `BookingLifecycleService` and
 * `SchedulingRepository`, two of them passing the service-role client. The
 * function takes its client as an argument, which is why these tests need no
 * module mocking — the seam is the parameter.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const loggerErrorMock = jest.fn();
const loggerInfoMock = jest.fn();

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => loggerInfoMock(...args),
    warn: jest.fn(),
    error: (...args: unknown[]) => loggerErrorMock(...args),
  }),
}));

import { lowerPlansForCancelledStages } from '../planFollowsItsStages';

/** What the database answers, per plan id. */
interface PlanCase {
  /** Stage rows naming their booking — more than one distinct id means shared. */
  siblings?: Array<{ booking_id: string | null }>;
  siblingsError?: unknown;
  plan?: { total_amount: number | null; installment_count: number | null } | null;
  planError?: unknown;
  updateError?: unknown;
}

/**
 * The client the function is handed.
 *
 * `any` on the builder (CLAUDE.md rule 6): it is self-referential — every
 * method returns it — so there is no type to annotate it with that exists
 * before it does. The same shape the repository suites use.
 */
function fakeDb(cases: Record<string, PlanCase>) {
  const updates: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const reads: string[] = [];

  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;

      /* Resolved lazily: the plan id arrives through `.eq()`, after `.from()`. */
      const planCase = () =>
        cases[String(filters['payment_plan_id'] ?? filters['id'] ?? '')] ?? {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        select(cols: string) {
          reads.push(table + ':' + cols);
          return builder;
        },
        update(next: Record<string, unknown>) {
          patch = next;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        maybeSingle: async () => {
          const c = planCase();
          return c.planError
            ? { data: null, error: c.planError }
            : { data: c.plan ?? null, error: null };
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          const c = planCase();

          if (patch) {
            updates.push({ patch, filters: { ...filters } });
            return Promise.resolve({ data: null, error: c.updateError ?? null }).then(
              resolve,
              reject
            );
          }

          return Promise.resolve(
            c.siblingsError
              ? { data: null, error: c.siblingsError }
              : { data: c.siblings ?? [], error: null }
          ).then(resolve, reject);
        },
      };

      return builder;
    },
  };

  return { db, updates, reads };
}

const USER = 'owner-1';

/** A plan of its own, as a quote's acceptance creates: its stages name one booking. */
const DEDICATED: PlanCase = {
  siblings: [{ booking_id: 'bk-1' }, { booking_id: 'bk-1' }],
  plan: { total_amount: 800, installment_count: 4 },
};

beforeEach(() => {
  loggerErrorMock.mockReset();
  loggerInfoMock.mockReset();
});

const loggedErrors = () => loggerErrorMock.mock.calls.map(c => String(c[1])).join(' | ');

describe('a dedicated plan follows its stages down', () => {
  it('takes the cancelled amount and count off the plan', async () => {
    const { db, updates } = fakeDb({ 'plan-1': DEDICATED });

    await lowerPlansForCancelledStages(db, USER, [
      { payment_plan_id: 'plan-1', amount: 200 },
      { payment_plan_id: 'plan-1', amount: 200 },
    ]);

    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toEqual({ total_amount: 400, installment_count: 2 });
    /* Both filters, or one tenant's cancellation edits another's plan. */
    expect(updates[0].filters).toMatchObject({ id: 'plan-1', user_id: USER });
  });

  it('reads and writes once for a plan whose six stages went at once', async () => {
    /*
     * Grouped first, so the arithmetic happens on one number instead of being
     * applied six times to a value moving underneath it.
     */
    const { db, updates } = fakeDb({
      'plan-1': { ...DEDICATED, plan: { total_amount: 600, installment_count: 6 } },
    });

    await lowerPlansForCancelledStages(
      db,
      USER,
      Array.from({ length: 6 }, () => ({ payment_plan_id: 'plan-1', amount: 100 }))
    );

    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toEqual({ total_amount: 0, installment_count: 0 });
  });

  it('never drives a drifted plan negative', async () => {
    /* The stages are the truth and these two numbers cache them. A plan reading
       -133.33 would be read as a credit by anything summing it. */
    const { db, updates } = fakeDb({
      'plan-1': { ...DEDICATED, plan: { total_amount: 100, installment_count: 1 } },
    });

    await lowerPlansForCancelledStages(db, USER, [
      { payment_plan_id: 'plan-1', amount: 250 },
      { payment_plan_id: 'plan-1', amount: 250 },
    ]);

    expect(updates[0].patch).toEqual({ total_amount: 0, installment_count: 0 });
  });
});

describe('a shared plan is left alone', () => {
  it('does not touch the terms of a plan several bookings hang off', async () => {
    const { db, updates } = fakeDb({
      'plan-1': {
        siblings: [{ booking_id: 'bk-1' }, { booking_id: 'bk-2' }],
        plan: { total_amount: 800, installment_count: 2 },
      },
    });

    await lowerPlansForCancelledStages(db, USER, [{ payment_plan_id: 'plan-1', amount: 400 }]);

    expect(updates).toHaveLength(0);
  });

  it('refuses when it could not tell whether the plan is shared', async () => {
    /*
     * THE ASSERTION THAT CARRIES THE FIX.
     *
     * Before it, a failed read produced an empty sibling set, which is not
     * `> 1`, so this wrote 400 over 1 across the terms of a plan that may be
     * serving ten other bookings.
     */
    const { db, updates } = fakeDb({
      'plan-1': {
        siblingsError: new Error('57014'),
        plan: { total_amount: 800, installment_count: 2 },
      },
    });

    await lowerPlansForCancelledStages(db, USER, [{ payment_plan_id: 'plan-1', amount: 400 }]);

    expect(updates).toHaveLength(0);
    expect(loggedErrors()).toContain('shared');
  });

  it('carries on with the other plans in the batch', async () => {
    /*
     * One unreadable plan must not strand the rest: these stages were already
     * cancelled, and every plan still totalling them is a dashboard wrong by a
     * different amount.
     */
    const { db, updates } = fakeDb({
      'plan-1': { siblingsError: new Error('57014') },
      'plan-2': DEDICATED,
    });

    await lowerPlansForCancelledStages(db, USER, [
      { payment_plan_id: 'plan-1', amount: 400 },
      { payment_plan_id: 'plan-2', amount: 200 },
    ]);

    expect(updates).toHaveLength(1);
    expect(updates[0].filters).toMatchObject({ id: 'plan-2' });
  });
});

describe('what it says when it cannot finish', () => {
  it('distinguishes a plan that is gone from one it could not read', async () => {
    /*
     * `!plan` already skipped both, so this changes no behaviour — it is the
     * difference between an ordinary missing row and a total left standing that
     * nobody meant to leave.
     */
    const gone = fakeDb({ 'plan-1': { siblings: [{ booking_id: 'bk-1' }], plan: null } });

    await lowerPlansForCancelledStages(gone.db, USER, [{ payment_plan_id: 'plan-1', amount: 50 }]);

    expect(gone.updates).toHaveLength(0);
    expect(loggerErrorMock).not.toHaveBeenCalled();

    const failed = fakeDb({
      'plan-1': { siblings: [{ booking_id: 'bk-1' }], planError: new Error('boom') },
    });

    await lowerPlansForCancelledStages(failed.db, USER, [
      { payment_plan_id: 'plan-1', amount: 50 },
    ]);

    expect(failed.updates).toHaveLength(0);
    expect(loggedErrors()).toContain('Could not read the plan');
  });

  it('reports a write that did not land, without throwing', async () => {
    /* Never throws: a plan left overstating is wrong on a dashboard, while a
       throw here would fail the cancellation the owner actually asked for. */
    const { db } = fakeDb({ 'plan-1': { ...DEDICATED, updateError: new Error('boom') } });

    await expect(
      lowerPlansForCancelledStages(db, USER, [{ payment_plan_id: 'plan-1', amount: 200 }])
    ).resolves.toBeUndefined();

    expect(loggedErrors()).toContain('still totals them');
  });

  it('asks the database nothing when no stages were cancelled', async () => {
    const { db, reads } = fakeDb({});

    await lowerPlansForCancelledStages(db, USER, []);

    expect(reads).toHaveLength(0);
  });

  it('skips a cancelled stage that belongs to no plan', async () => {
    /* A one-off invoice has no plan behind it. */
    const { db, reads } = fakeDb({});

    await lowerPlansForCancelledStages(db, USER, [{ amount: 200, payment_plan_id: null }]);

    expect(reads).toHaveLength(0);
  });
});
