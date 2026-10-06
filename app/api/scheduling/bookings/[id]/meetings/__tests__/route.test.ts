/**
 * Adding a meeting to a package that is already running.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A block of six is agreed, approved and under way, and then a seventh date is
 * needed: the client missed one, or the course ran long. What has to be true:
 *
 *   · it joins the PURCHASE — the drawer groups by `parent_booking_id`, and a
 *     meeting with none is a separate job again;
 *   · it is NUMBERED after the last one, not by counting: a package whose third
 *     meeting was deleted still has a sixth, and reusing that number would put
 *     two meetings in the same place in the series;
 *   · it raises no invoice of its own — a package's money is the purchase's;
 *   · the MONEY is the owner's answer. Billed like the others only where the
 *     client is already paying session by session, and refused outright on a
 *     package paid up front, where charging more is selling something else.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockFindById = jest.fn();
const mockFindChildren = jest.fn();
jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: {
    findById: (...args: unknown[]) => mockFindById(...args),
    findChildren: (...args: unknown[]) => mockFindChildren(...args),
  },
}));

const mockCreateBooking = jest.fn();
class BookingSlotUnavailableError extends Error {}
class BookingOnClosedDayError extends Error {
  constructor(
    readonly kind: string,
    readonly dateKey: string,
    readonly closedReason: string | null,
    readonly hours?: { start: string; end: string }
  ) {
    super('closed');
  }
}
jest.mock('@/lib/services/BookingLifecycleService', () => ({
  createBooking: (...args: unknown[]) => mockCreateBooking(...args),
  BookingSlotUnavailableError,
  BookingOnClosedDayError,
}));

const mockCreateInstallments = jest.fn();
jest.mock('@/lib/repositories/PaymentPlanRepository', () => ({
  paymentPlanRepository: { createInstallments: (...args: unknown[]) => mockCreateInstallments(...args) },
}));

/** Rows per table, set by each test. */
const tables: Record<string, Record<string, unknown> | null> = {};
const planUpdates: Array<Record<string, unknown>> = [];

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => ({
      select: () => {
        const chain: Record<string, unknown> = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
        };
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        if (table === 'payment_plans') planUpdates.push(payload);
        const chain: Record<string, unknown> = { eq: () => chain, then: (r: (v: unknown) => unknown) => r({ error: null }) };
        return chain;
      },
    }),
  },
}));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: jest.fn().mockResolvedValue(undefined) }) },
}));

import { POST } from '../route';

const CONTAINER = {
  id: 'container-1',
  user_id: 'user-1',
  service_id: 'service-1',
  contact_id: 'contact-1',
  timezone: 'America/New_York',
  status: 'confirmed',
  parent_booking_id: null,
  start_time: null,
};

/** Six meetings, the third of which was deleted — so the last number is 6. */
const SIBLINGS = [1, 2, 4, 5, 6].map(n => ({ id: `m${n}`, occurrence_number: n }));

function post(body: unknown, id = 'container-1') {
  return [
    new Request(`http://localhost/api/scheduling/bookings/${id}/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as Parameters<typeof POST>[0],
    { params: { id } },
  ] as const;
}

const WHEN = '2026-12-31T14:30:00.000Z';

beforeEach(() => {
  jest.clearAllMocks();
  planUpdates.length = 0;
  mockGetUser.mockResolvedValue({ id: 'user-1' });
  mockFindById.mockResolvedValue({ data: CONTAINER, error: null });
  mockFindChildren.mockResolvedValue({ data: SIBLINGS, error: null });
  mockCreateBooking.mockResolvedValue({
    data: { booking: { id: 'm7' }, clientNotified: true },
    error: null,
  });
  mockCreateInstallments.mockResolvedValue({ data: [{ id: 'stage-7' }], error: null });

  tables.proposals = {
    id: 'prop-1',
    title: 'Six coaching sessions',
    currency: 'ILS',
    created_plan_id: 'plan-1',
    contact_id: 'contact-1',
    sessions: { dates: [], duration_minutes: 50, bill_per_session: true },
  };
  tables.payment_plan_installments = { amount: 83.33, currency: 'ILS', installment_number: 6 };
  tables.payment_plans = { total_amount: 500, installment_count: 6 };
});

describe('the meeting itself', () => {
  it('joins the purchase, numbered after the last one', async () => {
    const response = await POST(...post({ start_time: WHEN }));

    expect(response.status).toBe(200);
    const [params] = mockCreateBooking.mock.calls[0];
    expect(params.parentBookingId).toBe('container-1');
    // Six is the highest, even though only five meetings exist.
    expect(params.occurrenceNumber).toBe(7);
  });

  it('raises no invoice of its own', async () => {
    await POST(...post({ start_time: WHEN }));

    expect(mockCreateBooking.mock.calls[0][0].createInvoice).toBe(false);
  });

  it('runs for the length the package was sold at', async () => {
    await POST(...post({ start_time: WHEN }));

    const { startTime, endTime } = mockCreateBooking.mock.calls[0][0];
    expect(new Date(endTime).getTime() - new Date(startTime).getTime()).toBe(50 * 60_000);
  });

  it('follows the purchase into pending while it is unpaid', async () => {
    mockFindById.mockResolvedValue({ data: { ...CONTAINER, status: 'pending' }, error: null });

    await POST(...post({ start_time: WHEN }));

    expect(mockCreateBooking.mock.calls[0][0].status).toBe('pending');
  });
});

describe('the money', () => {
  it('bills nothing unless the owner says so', async () => {
    const response = await POST(...post({ start_time: WHEN }));
    const body = await response.json();

    expect(mockCreateInstallments).not.toHaveBeenCalled();
    expect(body.charged).toBe(false);
  });

  it('adds a stage at the rate the client has been paying', async () => {
    const response = await POST(...post({ start_time: WHEN, charge: true }));
    const body = await response.json();

    const [[rows]] = mockCreateInstallments.mock.calls;
    expect(rows[0]).toMatchObject({
      booking_id: 'm7',
      amount: 83.33,
      trigger: 'manual',
      due_date: null,
      status: 'pending',
      installment_number: 7,
    });
    expect(body.charged).toBe(true);
  });

  it('grows the plan with it, so the total and the stages agree', async () => {
    await POST(...post({ start_time: WHEN, charge: true }));

    expect(planUpdates[0]).toMatchObject({ total_amount: 583.33, installment_count: 7 });
  });

  it('refuses to charge for a package that was paid up front', async () => {
    tables.proposals = { ...tables.proposals, sessions: { dates: [], duration_minutes: 50 } };

    const response = await POST(...post({ start_time: WHEN, charge: true }));
    const body = await response.json();

    // The client paid one agreed sum. Billing more is selling them something
    // else, which is a quote and not a button.
    expect(response.status).toBe(400);
    expect(body.code).toBe('cannot_charge_upfront_package');
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it('still adds the meeting to an up-front package, free', async () => {
    tables.proposals = { ...tables.proposals, sessions: { dates: [], duration_minutes: 50 } };

    const response = await POST(...post({ start_time: WHEN }));

    expect(response.status).toBe(200);
    expect(mockCreateInstallments).not.toHaveBeenCalled();
  });
});

describe('what it refuses', () => {
  it('a caller with no session', async () => {
    mockGetUser.mockResolvedValue(null);
    const response = await POST(...post({ start_time: WHEN }));
    expect(response.status).toBe(401);
  });

  it('a booking that is itself a meeting', async () => {
    mockFindById.mockResolvedValue({
      data: { ...CONTAINER, parent_booking_id: 'container-1' },
      error: null,
    });

    const response = await POST(...post({ start_time: WHEN }));
    expect((await response.json()).code).toBe('not_a_package');
  });

  it('an ordinary booking that owns no meetings', async () => {
    mockFindChildren.mockResolvedValue({ data: [], error: null });

    const response = await POST(...post({ start_time: WHEN }));
    expect((await response.json()).code).toBe('not_a_package');
  });

  it('a date that is not a date', async () => {
    const response = await POST(...post({ start_time: 'next Tuesday' }));
    expect(response.status).toBe(400);
  });
});

describe('when the hour cannot be had', () => {
  it('reports a clash as one', async () => {
    mockCreateBooking.mockResolvedValue({
      data: null,
      error: new BookingSlotUnavailableError('taken'),
    });

    const response = await POST(...post({ start_time: WHEN }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('slot_taken');
  });

  it('reports a closed day with its reason, so the owner can insist', async () => {
    mockCreateBooking.mockResolvedValue({
      data: null,
      error: new BookingOnClosedDayError('all_day', '2026-12-31', 'New Year'),
    });

    const response = await POST(...post({ start_time: WHEN }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('closed_day');
    expect(body.closed).toMatchObject({ date: '2026-12-31', reason: 'New Year' });
  });

  it('passes the owner’s answer through when they do', async () => {
    await POST(...post({ start_time: WHEN, allow_closed_day: true }));

    expect(mockCreateBooking.mock.calls[0][0].allowClosedDay).toBe(true);
  });
});
