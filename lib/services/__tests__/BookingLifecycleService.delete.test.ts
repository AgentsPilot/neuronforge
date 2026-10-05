/**
 * What must be true every time a booking is DELETED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * These exist because of a real bug, the same shape as the one
 * `BookingLifecycleService.test.ts` records for cancelling: a booking emails its
 * client a confirmation the moment it is made, and deleting it removed every
 * trace on this side while the client went on expecting to be seen. Nothing
 * notified them. Nothing removed the calendar event either, so the platform
 * offered the freed slot to somebody new while the owner's own calendar still
 * showed them busy in it.
 *
 * So the assertions below are about the three ways this goes wrong:
 *
 *   1. A delete that does not reach the calendar or the client.
 *   2. A delete that tells the client, having NOT actually happened.
 *   3. A delete that goes ahead while money is still held, or while a payment
 *      plan is still charging.
 *
 * ORDERING IS THE SUBJECT OF HALF OF THEM. `sendCancellationEmail` re-reads the
 * booking by id, so a call placed after the row is deleted returns
 * `{ sent: false, error: 'Booking not found' }` — it compiles, it runs, and it
 * sends nothing. Several tests below pin the order rather than just the calls.
 *
 * Every collaborator is faked: no Supabase, no Google Calendar, no email.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SchedulingBooking } from '@/lib/repositories/SchedulingRepository';

const mockFindById = jest.fn();
const mockDelete = jest.fn();
const mockFindInvoices = jest.fn();
const mockFindSettled = jest.fn();
const mockDeleteInvoice = jest.fn();
const mockDeleteCalendarEvent = jest.fn();
const mockSendCancellationEmail = jest.fn();
const mockAuditLog = jest.fn();
const mockPlanMaybeSingle = jest.fn();

/** Call order across collaborators, which is what several tests assert. */
const calls: string[] = [];

jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: {
    findById: (...args: unknown[]) => mockFindById(...args),
    delete: (...args: unknown[]) => {
      calls.push('delete');
      return mockDelete(...args);
    },
  },
}));

jest.mock('@/lib/repositories/CRMContactRepository', () => ({
  crmContactRepository: { findById: jest.fn() },
}));

jest.mock('@/lib/repositories/PaymentRepository', () => ({
  paymentInvoiceRepository: {
    findByBookingId: (...args: unknown[]) => mockFindInvoices(...args),
    update: jest.fn(),
  },
  paymentTransactionRepository: {
    findSettledForBooking: (...args: unknown[]) => mockFindSettled(...args),
  },
}));

/*
 * The invoice goes through the lifecycle module, which voids it at the processor
 * BEFORE dropping the row — so the hosted page stops being payable. The route
 * used to carry its own copy of that; this asserts which path is taken.
 */
jest.mock('@/lib/payments/invoiceLifecycle', () => ({
  deleteInvoice: (...args: unknown[]) => {
    calls.push('deleteInvoice');
    return mockDeleteInvoice(...args);
  },
  voidInvoice: jest.fn(),
}));

jest.mock('@/lib/services/CalendarSyncService', () => ({
  CalendarSyncService: {
    deleteCalendarEvent: (...args: unknown[]) => {
      calls.push('calendar');
      return mockDeleteCalendarEvent(...args);
    },
  },
}));

jest.mock('@/lib/services/BookingEmailService', () => ({
  BookingEmailService: {
    sendCancellationEmail: (...args: unknown[]) => {
      calls.push('email');
      return mockSendCancellationEmail(...args);
    },
  },
  getBusinessTimezone: jest.fn(),
}));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({ log: (...args: unknown[]) => mockAuditLog(...args) }),
  },
}));

/*
 * The payment-plan guard reads `payment_plan_subscriptions` through
 * `supabaseServer`. Mocked because the real client points at a fake URL in
 * tests and would attempt network I/O — and because the guard REFUSES on a read
 * error rather than guessing, so an unmocked query would block every delete.
 */
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: () => ({ maybeSingle: (...a: unknown[]) => mockPlanMaybeSingle(...a) }),
            not: () => ({ maybeSingle: (...a: unknown[]) => mockPlanMaybeSingle(...a) }),
          }),
        }),
      }),
    }),
    // `cancelBooking`'s quote-withdrawal pass, unused here but imported.
    rpc: jest.fn(),
  },
}));

import {
  deleteBooking,
  BookingPaidError,
  BookingHasPlanError,
} from '@/lib/services/BookingLifecycleService';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const BOOKING_ID = '22222222-2222-2222-2222-222222222222';

/** An hour from now, so the meeting is still ahead and the email applies. */
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

function booking(overrides: Partial<SchedulingBooking> = {}): SchedulingBooking {
  return {
    id: BOOKING_ID,
    user_id: USER_ID,
    contact_id: '33333333-3333-3333-3333-333333333333',
    status: 'confirmed',
    start_time: FUTURE,
    external_calendar_event_id: 'gcal-event-1',
    calendar_sync_provider: 'google_calendar',
    client_first_name: 'Ofir',
    client_last_name: 'Omer',
    client_email: 'client@example.com',
    ...overrides,
  } as SchedulingBooking;
}

beforeEach(() => {
  jest.clearAllMocks();
  calls.length = 0;

  mockFindById.mockResolvedValue({ data: booking(), error: null });
  mockDelete.mockResolvedValue({ data: null, error: null });
  mockFindInvoices.mockResolvedValue({ data: [], error: null });
  mockFindSettled.mockResolvedValue({ data: [], error: null });
  mockDeleteInvoice.mockResolvedValue({ data: { voidedAtProcessor: true }, error: null });
  mockDeleteCalendarEvent.mockResolvedValue({ success: true });
  mockSendCancellationEmail.mockResolvedValue({ sent: true });
  mockAuditLog.mockResolvedValue(undefined);
  // No plan behind it, which is the ordinary booking.
  mockPlanMaybeSingle.mockResolvedValue({ data: null, error: null });
});

describe('deleteBooking — the client is told', () => {
  it('deletes, clears the calendar and tells the client', async () => {
    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      bookingId: BOOKING_ID,
      deletedInvoices: [],
      clientNotified: true,
      calendarEventRemoved: true,
    });

    expect(mockSendCancellationEmail).toHaveBeenCalledWith(BOOKING_ID, USER_ID);
    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith(booking(), USER_ID);
    expect(mockDelete).toHaveBeenCalledWith(BOOKING_ID, USER_ID);
  });

  /*
   * THE ORDERING BUG, pinned.
   *
   * `sendCancellationEmail(bookingId, userId)` re-reads the booking with
   * `findById` and returns `{ sent: false, error: 'Booking not found' }` when
   * the row has gone. An email sent after the delete therefore sends nothing at
   * all, silently, while logging that it did not.
   */
  it('emails BEFORE the row is deleted, or the email would find nothing', async () => {
    await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(calls.indexOf('email')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('delete')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('email')).toBeLessThan(calls.indexOf('delete'));
  });

  /*
   * And the calendar event too: `external_calendar_event_id` lives ON the
   * booking, so after the delete there is nothing left to read it from.
   */
  it('removes the calendar event before the row is deleted', async () => {
    await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });
    expect(calls.indexOf('calendar')).toBeLessThan(calls.indexOf('delete'));
  });

  /*
   * Invoices first. Invoice deletion returns early on failure, and a client
   * told their appointment is cancelled when the delete then failed is worse
   * than one told a moment later.
   */
  it('retires the invoices before telling anyone', async () => {
    mockFindInvoices.mockResolvedValue({
      data: [{ id: 'inv-1', invoice_number: 'INV-001', status: 'sent', amount: 100 }],
      error: null,
    });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data!.deletedInvoices).toEqual(['INV-001']);
    expect(calls.indexOf('deleteInvoice')).toBeLessThan(calls.indexOf('email'));
  });

  it('does not email about a meeting that has already happened', async () => {
    mockFindById.mockResolvedValue({
      data: booking({ start_time: new Date(Date.now() - 86_400_000).toISOString() }),
      error: null,
    });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(mockSendCancellationEmail).not.toHaveBeenCalled();
    expect(result.data!.clientNotified).toBe(false);
    // Still deleted — only the email is skipped.
    expect(mockDelete).toHaveBeenCalled();
  });

  it('reports a failed send rather than claiming the client was told', async () => {
    mockSendCancellationEmail.mockResolvedValue({ sent: false, error: 'No client email' });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.error).toBeNull();
    expect(result.data!.clientNotified).toBe(false);
    // The owner asked for it gone: a mail problem must not leave it standing.
    expect(mockDelete).toHaveBeenCalled();
  });

  it('still deletes when the email throws', async () => {
    mockSendCancellationEmail.mockRejectedValue(new Error('smtp down'));

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.error).toBeNull();
    expect(result.data!.clientNotified).toBe(false);
    expect(mockDelete).toHaveBeenCalled();
  });

  it('reports a calendar failure without failing the delete', async () => {
    mockDeleteCalendarEvent.mockResolvedValue({ success: false, error: 'revoked' });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data!.calendarEventRemoved).toBe(false);
    expect(mockDelete).toHaveBeenCalled();
  });

  it('skips the calendar when the booking never reached one', async () => {
    mockFindById.mockResolvedValue({
      data: booking({ external_calendar_event_id: null }),
      error: null,
    });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
    expect(result.data!.calendarEventRemoved).toBe(false);
  });

  it('names the audit entry for the client, from the row it already had', async () => {
    await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SCHEDULING_BOOKING_DELETED',
        resourceName: 'Booking for Ofir Omer',
        details: expect.objectContaining({ clientNotified: true, calendarEventRemoved: true }),
      })
    );
  });
});

describe('deleteBooking — money and plans refuse BEFORE anything is destroyed', () => {
  /** A succeeded payment with nothing refunded: money still held. */
  const heldPayment = { id: 'tx-1', status: 'succeeded', amount: 180, refunded_amount: 0, currency: 'ILS' };

  it('refuses a booking that is still holding money, and tells nobody', async () => {
    mockFindSettled.mockResolvedValue({ data: [heldPayment], error: null });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(BookingPaidError);
    expect((result.error as BookingPaidError).paidAmount).toBe(180);

    // Nothing destroyed and nothing claimed.
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDeleteInvoice).not.toHaveBeenCalled();
    expect(mockSendCancellationEmail).not.toHaveBeenCalled();
    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
  });

  /*
   * THE BUG THE ROUTE CARRIED. Its own copy of this guard asked
   * `payment_status === 'refunded'` and then refused on
   * `settledPayments.length > 0`, which subtracts no refunds at all — so a
   * fully refunded booking could not be deleted, and the error told the owner
   * to "refund the payment first" about money they had just returned.
   */
  it('allows a FULLY REFUNDED booking to be deleted', async () => {
    mockFindSettled.mockResolvedValue({
      data: [{ ...heldPayment, refunded_amount: 180 }],
      error: null,
    });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.error).toBeNull();
    expect(mockDelete).toHaveBeenCalled();
    expect(result.data!.clientNotified).toBe(true);
  });

  it('still refuses a PARTIALLY refunded booking, which is holding the rest', async () => {
    mockFindSettled.mockResolvedValue({
      data: [{ ...heldPayment, amount: 100, refunded_amount: 40 }],
      error: null,
    });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.error).toBeInstanceOf(BookingPaidError);
    expect((result.error as BookingPaidError).paidAmount).toBe(60);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  /*
   * `payment_plan_subscriptions.booking_id` is ON DELETE RESTRICT, so the
   * database refuses this anyway — but at the LAST step, by which point the
   * invoices, the calendar event and the email have already gone. Asked up
   * front so none of that happens, and so the owner gets a reason instead of a
   * flat 500.
   */
  it('refuses a booking with a live payment plan, destroying nothing', async () => {
    mockPlanMaybeSingle.mockResolvedValue({ data: { id: 'plan-1', status: 'active' }, error: null });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.error).toBeInstanceOf(BookingHasPlanError);
    expect((result.error as BookingHasPlanError).planLive).toBe(true);
    expect(result.error!.message).toContain('Stop the payment plan first');

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDeleteInvoice).not.toHaveBeenCalled();
    expect(mockSendCancellationEmail).not.toHaveBeenCalled();
  });

  /*
   * RESTRICT is status-agnostic: a FINISHED plan blocks the delete just as
   * firmly. Reporting it as live would tell the owner to stop a plan that
   * stopped months ago, so the advice differs — cancelling is the only way past
   * this one.
   */
  it.each([['completed'], ['cancelled']])(
    'refuses a booking whose plan is %s, and does not advise stopping it',
    async (status) => {
      mockPlanMaybeSingle.mockResolvedValue({ data: { id: 'plan-1', status }, error: null });

      const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

      expect(result.error).toBeInstanceOf(BookingHasPlanError);
      expect((result.error as BookingHasPlanError).planLive).toBe(false);
      expect(result.error!.message).not.toContain('Stop the payment plan first');
      expect(mockDelete).not.toHaveBeenCalled();
    }
  );

  /*
   * Refuse rather than guess. Proceeding on an unreadable plan check would hit
   * RESTRICT at the last step — after the invoices, the calendar and the email
   * are already gone and unrecoverable.
   */
  it('refuses when the plan check itself fails', async () => {
    mockPlanMaybeSingle.mockResolvedValue({ data: null, error: new Error('pg down') });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.error).toBeTruthy();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockSendCancellationEmail).not.toHaveBeenCalled();
  });

  it('refuses a booking it cannot find, before any side effect', async () => {
    mockFindById.mockResolvedValue({ data: null, error: null });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.error!.message).toBe('Booking not found');
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockSendCancellationEmail).not.toHaveBeenCalled();
  });

  /*
   * A settled invoice is left alone even when the delete goes ahead: deleting a
   * paid-then-refunded record would erase financial history. Only OPEN invoices
   * go with the booking.
   */
  it('retires only the open invoices, never a settled one', async () => {
    mockFindInvoices.mockResolvedValue({
      data: [
        { id: 'inv-open', invoice_number: 'INV-OPEN', status: 'sent', amount: 100 },
        { id: 'inv-paid', invoice_number: 'INV-PAID', status: 'paid', amount: 100 },
      ],
      error: null,
    });
    /*
     * Paid then fully refunded, so nothing is held and the delete proceeds.
     *
     * `invoice_id` matters: `heldOnBooking` counts a settled invoice on its own
     * ONLY when no payment references it — an invoice marked paid by hand is
     * real money. Here the payment is the authority for `INV-PAID`, and it has
     * all gone back.
     */
    mockFindSettled.mockResolvedValue({
      data: [{ ...heldPayment, invoice_id: 'inv-paid', amount: 100, refunded_amount: 100 }],
      error: null,
    });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.error).toBeNull();
    expect(result.data!.deletedInvoices).toEqual(['INV-OPEN']);
    expect(mockDeleteInvoice).toHaveBeenCalledTimes(1);
    expect(mockDeleteInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv-open' })
    );
  });
});
