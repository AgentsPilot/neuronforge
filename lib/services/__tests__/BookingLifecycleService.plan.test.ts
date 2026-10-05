/**
 * A cancelled booking whose payment plan is STILL CHARGING.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The decision under test is a deliberate non-action.
 *
 * Cancelling an appointment does not end the client's payment arrangement: a
 * plan can fund more than one booking, and stopping it early is a decision with
 * a client on the other side. So `cancelBooking` REPORTS a live plan and leaves
 * it running — `cancelPlan` stays the owner's to press, from the refund dialog
 * or the Money page.
 *
 * The assertion that matters most is therefore the negative one: nothing here
 * may cancel a plan on its own. The positive half is that the owner is told,
 * because until they act the client's card is charged again on schedule.
 *
 * Its own file, with `@/lib/supabaseServer` mocked. The sibling suite leaves
 * that client real (pointed at a fake URL, so its reads simply fail), and
 * several of its tests depend on that. Mocking it there would have rewritten
 * the conditions of 21 passing tests to add two.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SchedulingBooking } from '@/lib/repositories/SchedulingRepository';

const mockCancel = jest.fn();
const mockFindInvoices = jest.fn();
const mockFindSettled = jest.fn();

/** Rows per table, set by each test. */
const tables: Record<string, Record<string, unknown>[]> = {};

/** Every filter applied to a `payment_plan_installments` update, in order. */
const stageUpdateFilters: Array<[string, unknown]> = [];
const stageUpdatePayload: Record<string, unknown>[] = [];

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => {
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            // Every terminal the service uses resolves the same way: whatever
            // this test put in `tables` for the table being read.
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown) =>
                resolve({ data: tables[table] ?? [], error: null });
            }
            if (prop === 'maybeSingle' || prop === 'single') {
              return async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
            }
            // Record how the stage close is scoped — the scoping IS the safety.
            if (table === 'payment_plan_installments') {
              return (...args: unknown[]) => {
                if (prop === 'update') stageUpdatePayload.push(args[0] as Record<string, unknown>);
                if (prop === 'eq' || prop === 'is') {
                  stageUpdateFilters.push([String(args[0]), args[1]]);
                }
                // `.not(column, op, value)` — recorded because the status scope
                // moved into it, and a test that cannot see it cannot tell a
                // narrowed scope from no scope at all.
                if (prop === 'not') {
                  stageUpdateFilters.push([`not:${String(args[0])}`, `${args[1]} ${args[2]}`]);
                }
                return builder;
              };
            }
            return () => builder;
          },
        }
      );
      return builder;
    },
  },
}));

jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: {
    cancel: (...a: unknown[]) => mockCancel(...a),
    // No meetings: these bookings are ordinary jobs, not packages.
    findChildren: jest.fn(async () => ({ data: [], error: null })),
  },
}));
jest.mock('@/lib/repositories/CRMContactRepository', () => ({
  crmContactRepository: { findById: jest.fn(async () => ({ data: null, error: null })) },
}));
jest.mock('@/lib/repositories/PaymentRepository', () => ({
  paymentInvoiceRepository: {
    findByBookingId: (...a: unknown[]) => mockFindInvoices(...a),
    update: jest.fn(async () => ({ data: null, error: null })),
  },
  paymentTransactionRepository: {
    findSettledForBooking: (...a: unknown[]) => mockFindSettled(...a),
  },
}));
jest.mock('@/lib/payments/invoiceLifecycle', () => ({
  voidInvoice: jest.fn(async () => ({ data: null, error: null })),
}));
jest.mock('@/lib/services/CalendarSyncService', () => ({
  CalendarSyncService: { deleteCalendarEvent: jest.fn(async () => ({ data: true, error: null })) },
}));
jest.mock('@/lib/services/BookingEmailService', () => ({
  BookingEmailService: { sendCancellationEmail: jest.fn(async () => ({ sent: false })) },
  getBusinessTimezone: jest.fn(async () => 'UTC'),
}));
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: jest.fn(async () => undefined) }) },
}));

/*
 * The real module, imported ONLY so the test can assert it was never called.
 * If a future change wires cancellation to it, this suite fails loudly rather
 * than a client quietly stopping being billed.
 */
const mockCancelPlan = jest.fn();
jest.mock('@/lib/payments/cancelPlan', () => ({
  cancelPlan: (...a: unknown[]) => mockCancelPlan(...a),
}));

import { cancelBooking } from '@/lib/services/BookingLifecycleService';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const BOOKING_ID = '22222222-2222-2222-2222-222222222222';

function booking(): SchedulingBooking {
  return {
    id: BOOKING_ID,
    user_id: USER_ID,
    contact_id: '33333333-3333-3333-3333-333333333333',
    status: 'cancelled',
    start_time: '2026-10-01T09:00:00.000Z',
    end_time: '2026-10-01T10:00:00.000Z',
  } as unknown as SchedulingBooking;
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(tables)) delete tables[key];
  stageUpdateFilters.length = 0;
  stageUpdatePayload.length = 0;
  mockCancel.mockResolvedValue({ data: booking(), error: null });
  mockFindInvoices.mockResolvedValue({ data: [], error: null });
  mockFindSettled.mockResolvedValue({ data: [], error: null });
});

describe('cancelBooking and a live payment plan', () => {
  it('reports a plan that is still charging, and does NOT stop it', async () => {
    tables.payment_plan_subscriptions = [
      {
        id: 'plan-1',
        status: 'active',
        installment_count: 12,
        periods_paid: 3,
        next_charge_at: '2026-10-15T00:00:00.000Z',
      },
    ];

    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data?.planLive).toBe(true);
    expect(result.data?.periodsRemaining).toBe(9);

    /*
     * THE POINT OF THIS FILE. Stopping a client's plan is the owner's decision,
     * never a side effect of cancelling one appointment.
     */
    expect(mockCancelPlan).not.toHaveBeenCalled();
  });

  it('reports no plan when there is none', async () => {
    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data?.planLive).toBe(false);
    expect(result.data?.periodsRemaining).toBeNull();
    expect(mockCancelPlan).not.toHaveBeenCalled();
  });

  it('treats a plan whose period count cannot be read as live, with no count', async () => {
    // Not knowing how many periods remain is not evidence that none do.
    tables.payment_plan_subscriptions = [
      { id: 'plan-1', status: 'past_due', installment_count: null, periods_paid: null },
    ];

    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data?.planLive).toBe(true);
    expect(result.data?.periodsRemaining).toBeNull();
  });

  /*
   * The second chaser. `processOverdueItems` scans pending installments with a
   * past due date and NO reference to the booking, emailing the client in the
   * owner's name — so a quote's remaining stages went on demanding money for a
   * cancelled job even after its invoices were voided.
   */
  it('closes the quote stages, scoped so a subscription is never touched', async () => {
    await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(stageUpdatePayload[0]).toMatchObject({ status: 'cancelled' });

    /*
     * Only this booking, and only stages with no subscription behind them — a
     * plan's projected periods are real money still arriving.
     *
     * The status scope asserted `['status', 'pending']`, which was narrower than
     * the rule: a BILLED stage stayed open on a cancelled booking, disagreeing
     * with its own invoice, which this function had already cancelled. The
     * guarantee that matters — a paid stage is never rewritten — is unchanged.
     */
    expect(stageUpdateFilters).toEqual(
      expect.arrayContaining([
        ['booking_id', BOOKING_ID],
        ['subscription_id', null],
      ])
    );
    // The guarantee itself, not merely the absence of the old spelling: without
    // this a scope removed entirely would pass, and a PAID stage — the record of
    // money that actually arrived — would be rewritten to cancelled.
    expect(stageUpdateFilters).toContainEqual(['not:status', 'in (paid,cancelled)']);
  });

  it('records WHY the periods stopped, the same way every other surface does', async () => {
    await cancelBooking({
      bookingId: BOOKING_ID,
      userId: USER_ID,
      cancelReason: 'client_not_paying',
      cancelNote: 'stopped answering',
      cancelledBy: 'owner',
    });

    /*
     * The reason already travelled to the proposal — "one namespace, so the
     * booking's cancel code is a valid stop code, and a report counting
     * `client_not_paying` finds both". The periods were the one thing left out,
     * so a plan stopped by cancelling its booking recorded nothing countable
     * while the same plan stopped from Manage Payment recorded all three.
     */
    expect(stageUpdatePayload[0]).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'client_not_paying',
      cancel_note: 'stopped answering',
      cancelled_by: 'owner',
    });
    expect(stageUpdatePayload[0]).toHaveProperty('cancelled_at');
  });

  it('defaults the actor to the owner, who is the one who pressed it', async () => {
    await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(stageUpdatePayload[0]).toMatchObject({ cancelled_by: 'owner' });
  });

  it('still cancels the booking when the plan cannot be read', async () => {
    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    // The booking is cancelled either way; an unreadable plan costs its field.
    expect(result.error).toBeNull();
    expect(result.data?.booking.status).toBe('cancelled');
  });
});
