/**
 * A make-up the client books is billed only where the missed hour was not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE CLIENT WAS CHARGED TWICE FOR
 *
 * A quotation sold session by session. The owner marks one missed, and the
 * no-show dialog asks the only money question there is: charge for it, or
 * waive it. They choose CHARGE — the hour was held, nobody came — and tick the
 * box that lets the client pick their own replacement date.
 *
 * The client picks a date. A stage is created against the new session, priced
 * like the ones beside it. The client now owes for the hour they missed AND
 * for the hour that replaces it: two payments, one delivered session, and
 * nothing on either screen saying so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ONLY THIS PATH HAD IT
 *
 * There are two ways a make-up gets booked, and they had different rules.
 *
 * The OWNER's dialog mirrors the waiver — `missedHourWasWaived` in
 * `CRMContactDrawerV2`, added when it was caught doing the opposite and giving
 * sessions away free. Charged means the make-up is a gift; waived means the
 * make-up is what gets billed.
 *
 * The CLIENT's path derived the charge from how the package was SOLD and
 * nothing else, on the reasoning that the sale is a fact while billing is a
 * decision the client must never be asked to make. True as far as it goes —
 * but the decision had ALREADY been made, by the owner, and was sitting on the
 * missed session's own stage. Reading the sale and not the stage is what
 * produced the second charge.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE, WHICH BOTH PATHS NOW SHARE
 *
 *   missed stage BILLED  →  make-up carries NO stage
 *   missed stage VOIDED  →  make-up is billed, if the package bills per session
 *
 * Exactly one payment per hour the client actually receives.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const createMeeting = jest.fn();
const createInstallments = jest.fn();

/** Rows the fake `supabaseServer` should answer with, per table. */
const tables: Record<string, unknown[]> = {};

jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: {
    createMeeting: (...args: unknown[]) => createMeeting(...args),
  },
}));

/* The module the function imports dynamically, not the barrel. */
jest.mock('@/lib/repositories/PaymentPlanRepository', () => ({
  paymentPlanRepository: {
    createInstallments: (...args: unknown[]) => createInstallments(...args),
  },
}));

/**
 * The thinnest PostgREST shape this module uses: `.from().select().eq()…` then
 * either awaited directly or via `.maybeSingle()`.
 */
jest.mock('@/lib/supabaseServer', () => {
  const build = (table: string) => {
    const rows = () => (tables[table] ?? []) as unknown[];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
    };
    return chain;
  };
  return { supabaseServer: { from: (table: string) => build(table) } };
});

import { bookMakeUpSession } from '@/lib/scheduling/makeUpSession';

const MISSED = 'missed-meeting-id';

const request = {
  userId: 'user-1',
  containerId: 'container-1',
  missedMeetingId: MISSED,
  startTime: '2026-12-01T10:00:00Z',
  endTime: '2026-12-01T11:00:00Z',
  timezone: 'Asia/Jerusalem',
  siblings: [{ session_number: 1 }, { session_number: 2 }],
};

/** A package sold session by session, with one existing stage to copy. */
function soldPerSession() {
  tables.proposals = [
    {
      id: 'p1',
      title: 'Coaching block',
      currency: 'ILS',
      created_plan_id: 'plan-1',
      /* `sessions` is an OBJECT carrying the billing shape, not a list — the
         flag `perSession` actually reads. */
      sessions: { bill_per_session: true },
      contact_id: 'c1',
    },
  ];
  tables.payment_plan_installments = [
    { id: 's1', status: 'pending', amount: 300, currency: 'ILS', installment_number: 2, label: 'Session 2' },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(tables)) delete tables[key];
  createMeeting.mockResolvedValue({ data: { id: 'new-meeting' }, error: null });
  createInstallments.mockResolvedValue({ data: [{ id: 'new-stage' }], error: null });
});

describe('the owner charged for the missed hour', () => {
  it('does not bill the make-up as well', async () => {
    /*
     * THE BUG, AS ONE ASSERTION. The client paid for the hour they missed;
     * billing the replacement charges them twice for one session.
     */
    soldPerSession();
    tables.payment_plan_installments = [
      { id: 'missed-stage', status: 'pending', amount: 300, currency: 'ILS', installment_number: 2 },
    ];

    const result = await bookMakeUpSession(request as never);

    expect(result.id).toBe('new-meeting');
    expect(result.charged).toBe(false);
    expect(createInstallments).not.toHaveBeenCalled();
  });

  it.each(['pending', 'sent', 'paid', 'overdue'])(
    'treats a %s stage as money the client already owes for that hour',
    async status => {
      soldPerSession();
      tables.payment_plan_installments = [{ id: 'missed-stage', status, amount: 300 }];

      const result = await bookMakeUpSession(request as never);

      expect(result.charged).toBe(false);
    }
  );

  it('still books the session — the money rule must never cost the client their hour', async () => {
    soldPerSession();
    tables.payment_plan_installments = [{ id: 'missed-stage', status: 'paid', amount: 300 }];

    const result = await bookMakeUpSession(request as never);

    expect(result.error).toBeNull();
    expect(createMeeting).toHaveBeenCalledTimes(1);
  });
});

describe('the owner waived the missed hour', () => {
  it('bills the make-up, so a delivered session is not given away', async () => {
    /* `cancelled` is how a waiver is recorded. Nothing was charged for the
       missed hour, so the replacement is what carries the money. */
    soldPerSession();
    tables.payment_plan_installments = [
      { id: 'missed-stage', status: 'cancelled', amount: 300, currency: 'ILS', installment_number: 2 },
    ];

    const result = await bookMakeUpSession(request as never);

    expect(result.charged).toBe(true);
    expect(createInstallments).toHaveBeenCalledTimes(1);
  });
});

describe('what the mirror must not change', () => {
  it('a missed hour with no stage at all leaves the make-up unbilled', async () => {
    /* Nothing to mirror. The package may not bill per session, or the session
       may carry no money of its own — either way there is no decision here. */
    soldPerSession();
    tables.payment_plan_installments = [];

    const result = await bookMakeUpSession(request as never);

    expect(result.charged).toBe(false);
  });

  it('bills nothing when the stage cannot be read, rather than risk a second charge', async () => {
    /*
     * The asymmetry that decides the default. An unbilled make-up is money the
     * owner can still raise and can see; a duplicate charge has already
     * reached the client and needs a refund to undo.
     */
    soldPerSession();
    const { supabaseServer } = jest.requireMock('@/lib/supabaseServer');
    const original = supabaseServer.from;
    supabaseServer.from = (table: string) =>
      table === 'payment_plan_installments'
        ? {
            select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }),
          }
        : original(table);

    const result = await bookMakeUpSession(request as never);

    expect(result.charged).toBe(false);
    expect(result.id).toBe('new-meeting');

    supabaseServer.from = original;
  });
});
