/**
 * What must be true every time a booking is cancelled.
 *
 * These tests exist because of a real bug: the chat cancelled bookings by
 * calling the repository's `cancel` directly, which is only a status update. The
 * row said cancelled, the appointment stayed in the owner's calendar, and the
 * client was never told — so they arrived. The route did the full sequence; the
 * chat did a third of it.
 *
 * So the assertions below are less about the happy path than about the two ways
 * this goes wrong:
 *
 *   1. A cancellation that does not reach the calendar or the client.
 *   2. A cancellation that did NOT happen, but tells the client it did.
 *
 * Every collaborator is faked — this never touches Supabase, Google Calendar or
 * an email provider.
 */

import type { SchedulingBooking } from '@/lib/repositories/SchedulingRepository';

const mockCancel = jest.fn();
const mockFindContact = jest.fn();
const mockDeleteCalendarEvent = jest.fn();
const mockSendCancellationEmail = jest.fn();
const mockAuditLog = jest.fn();

/** No invoices unless a test says otherwise — the ordinary unpaid booking. */
const mockFindInvoices = jest.fn();
const mockUpdateInvoice = jest.fn();
const mockVoidInvoice = jest.fn();
const mockFindSettled = jest.fn();

jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: {
    cancel: (...args: unknown[]) => mockCancel(...args),
  },
}));

jest.mock('@/lib/repositories/CRMContactRepository', () => ({
  crmContactRepository: {
    findById: (...args: unknown[]) => mockFindContact(...args),
  },
}));

jest.mock('@/lib/repositories/PaymentRepository', () => ({
  paymentInvoiceRepository: {
    findByBookingId: (...args: unknown[]) => mockFindInvoices(...args),
    update: (...args: unknown[]) => mockUpdateInvoice(...args),
  },
  /*
   * Held money comes from the PAYMENTS, not the invoices: a booking paid online
   * through the widget has a transaction carrying its `booking_id` and no
   * invoice at all, and an invoice-only sum reported nothing held for it.
   */
  paymentTransactionRepository: {
    findSettledForBooking: (...args: unknown[]) => mockFindSettled(...args),
  },
}));

/*
 * Cancelling a chaseable invoice goes through the lifecycle module, not a bare
 * status write — that is what voids it at Stripe as well, so the hosted invoice
 * page stops being payable. Mocked here so the assertion is about WHICH path
 * was taken, which is the part that was wrong.
 */
jest.mock('@/lib/payments/invoiceLifecycle', () => ({
  voidInvoice: (...args: unknown[]) => mockVoidInvoice(...args),
}));

jest.mock('@/lib/services/CalendarSyncService', () => ({
  CalendarSyncService: {
    deleteCalendarEvent: (...args: unknown[]) => mockDeleteCalendarEvent(...args),
  },
}));

jest.mock('@/lib/services/BookingEmailService', () => ({
  BookingEmailService: {
    sendCancellationEmail: (...args: unknown[]) => mockSendCancellationEmail(...args),
  },
}));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({ log: (...args: unknown[]) => mockAuditLog(...args) }),
  },
}));

import { cancelBooking } from '@/lib/services/BookingLifecycleService';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const BOOKING_ID = '22222222-2222-2222-2222-222222222222';

function booking(overrides: Partial<SchedulingBooking> = {}): SchedulingBooking {
  return {
    id: BOOKING_ID,
    user_id: USER_ID,
    contact_id: '33333333-3333-3333-3333-333333333333',
    status: 'cancelled',
    external_calendar_event_id: 'gcal-event-1',
    calendar_sync_provider: 'google_calendar',
    ...overrides,
  } as SchedulingBooking;
}

beforeEach(() => {
  jest.clearAllMocks();

  mockCancel.mockResolvedValue({ data: booking(), error: null });
  mockFindContact.mockResolvedValue({
    data: { first_name: 'Ofir', last_name: 'Omer' },
    error: null,
  });
  mockDeleteCalendarEvent.mockResolvedValue({ success: true });
  mockSendCancellationEmail.mockResolvedValue({ sent: true });
  mockAuditLog.mockResolvedValue(undefined);
  mockFindInvoices.mockResolvedValue({ data: [], error: null });
  mockUpdateInvoice.mockResolvedValue({ data: null, error: null });
  mockVoidInvoice.mockResolvedValue({ data: { voidedAtProcessor: true }, error: null });
  mockFindSettled.mockResolvedValue({ data: [], error: null });
});

describe('cancelBooking', () => {
  it('cancels, clears the calendar and tells the client', async () => {
    const result = await cancelBooking({
      bookingId: BOOKING_ID,
      userId: USER_ID,
      reason: 'client is ill',
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      booking: booking(),
      calendarEventRemoved: true,
      clientNotified: true,
      // Nothing was invoiced, so there is nothing to close and nothing held.
      invoicesCancelled: 0,
      amountHeld: 0,
      heldCurrency: null,
      // And no payment plan behind it, which is the ordinary booking.
      planLive: false,
      periodsRemaining: null,
      // No quote stages either, so none to close.
      stagesClosed: 0,
    });

    // The three steps that make a cancellation real.
    expect(mockCancel).toHaveBeenCalledWith(BOOKING_ID, USER_ID, 'client is ill');
    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith(booking(), USER_ID);
    expect(mockSendCancellationEmail).toHaveBeenCalledWith(BOOKING_ID, USER_ID, 'client is ill', {
      offerRebooking: undefined,
    });
  });

  it('records the reason on the audit entry', async () => {
    // Under `metadata` it was silently dropped: AuditLogInput has no such field.
    await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID, reason: 'double booked' });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SCHEDULING_BOOKING_CANCELLED',
        entityId: BOOKING_ID,
        userId: USER_ID,
        details: { reason: 'double booked' },
      })
    );
  });

  describe('when the cancellation itself fails', () => {
    it('does not tell the client a booking was cancelled', async () => {
      mockCancel.mockResolvedValue({ data: null, error: new Error('db down') });

      const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

      expect(result.error).toEqual(new Error('db down'));
      expect(result.data).toBeNull();
      // The whole point: no email and no calendar change for a cancellation
      // that never happened.
      expect(mockSendCancellationEmail).not.toHaveBeenCalled();
      expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
    });

    it('reports a missing booking without side effects', async () => {
      mockCancel.mockResolvedValue({ data: null, error: null });

      const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

      expect(result.error?.message).toBe('Booking not found');
      expect(mockSendCancellationEmail).not.toHaveBeenCalled();
      expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
    });
  });

  describe('when a side effect fails', () => {
    it('still cancels, and says the calendar was not cleared', async () => {
      // Reported, not thrown — a try/catch alone would call this a success.
      mockDeleteCalendarEvent.mockResolvedValue({ success: false, error: 'token expired' });

      const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

      expect(result.error).toBeNull();
      expect(result.data?.calendarEventRemoved).toBe(false);
      expect(result.data?.clientNotified).toBe(true);
    });

    it('still cancels, and says the client was not notified', async () => {
      mockSendCancellationEmail.mockResolvedValue({ sent: false, error: 'no email on file' });

      const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

      expect(result.error).toBeNull();
      expect(result.data?.clientNotified).toBe(false);
    });

    it('survives a collaborator that throws rather than reports', async () => {
      mockDeleteCalendarEvent.mockRejectedValue(new Error('network'));
      mockSendCancellationEmail.mockRejectedValue(new Error('smtp'));

      const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

      expect(result.error).toBeNull();
      expect(result.data?.calendarEventRemoved).toBe(false);
      expect(result.data?.clientNotified).toBe(false);
    });

    it('cancels even when the contact lookup fails', async () => {
      // The name is for the audit line only; losing it must not lose the cancel.
      mockFindContact.mockResolvedValue({ data: null, error: new Error('gone') });

      const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

      expect(result.error).toBeNull();
      expect(result.data?.clientNotified).toBe(true);
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ resourceName: 'Booking for Client' })
      );
    });
  });

  it('skips the calendar for a booking that never reached one', async () => {
    mockCancel.mockResolvedValue({
      data: booking({ external_calendar_event_id: null }),
      error: null,
    });

    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
    expect(result.data?.calendarEventRemoved).toBe(false);
    // The client is still told — the email does not depend on a calendar event.
    expect(result.data?.clientNotified).toBe(true);
  });

  it('cancels without a reason', async () => {
    await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(mockCancel).toHaveBeenCalledWith(BOOKING_ID, USER_ID, undefined);
    // Undefined, not false: an ordinary cancellation still invites the client
    // to book again. Only a closing business suppresses that.
    expect(mockSendCancellationEmail).toHaveBeenCalledWith(BOOKING_ID, USER_ID, undefined, {
      offerRebooking: undefined,
    });
  });

  it('suppresses the rebooking invitation when the business is closing', async () => {
    /*
     * Account deletion cancels every future booking through here. "Book Again"
     * would contradict an email saying the business has ceased operating, and
     * would point at a page that is about to stop existing.
     */
    await cancelBooking({
      bookingId: BOOKING_ID,
      userId: USER_ID,
      reason: 'This business has ceased operating',
      offerRebooking: false,
    });

    expect(mockSendCancellationEmail).toHaveBeenCalledWith(
      BOOKING_ID,
      USER_ID,
      'This business has ceased operating',
      { offerRebooking: false }
    );
  });
});

/**
 * The money side of a cancellation.
 *
 * An unpaid invoice used to survive untouched, and the overdue scan reads
 * `status in ('sent','overdue')` with no reference to the booking — so the
 * platform went on chasing the client on days 1, 3 and 7 past due, in the
 * owner's name, for an appointment that had been cancelled.
 */
describe('cancelBooking and the invoices', () => {
  it('closes the ones that would still be chased', async () => {
    mockFindInvoices.mockResolvedValue({
      data: [
        { id: 'inv-1', status: 'sent', amount: 200, refunded_amount: 0, currency: 'ILS' },
        { id: 'inv-2', status: 'overdue', amount: 150, refunded_amount: 0, currency: 'ILS' },
        { id: 'inv-3', status: 'draft', amount: 90, refunded_amount: 0, currency: 'ILS' },
      ],
      error: null,
    });

    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data?.invoicesCancelled).toBe(3);
    // None of them was ever paid, so nothing is being held.
    expect(result.data?.amountHeld).toBe(0);

    /*
     * Through the lifecycle module, so a Stripe-issued invoice is voided at the
     * processor too. A local status write leaves Stripe still reminding the
     * client and the hosted page still payable.
     */
    expect(mockVoidInvoice).toHaveBeenCalledTimes(3);
    expect(mockVoidInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv-1', userId: USER_ID })
    );
  });

  it('does not void an invoice that was paid', async () => {
    mockFindInvoices.mockResolvedValue({
      data: [{ id: 'inv-1', status: 'paid', amount: 250, refunded_amount: 0, currency: 'ILS' }],
      error: null,
    });

    await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    // Voiding it would rewrite the record of money that actually moved.
    expect(mockVoidInvoice).not.toHaveBeenCalled();
  });

  /*
   * Money that moved is a record, not a draft. It is measured rather than
   * rewritten, and the owner is asked what to do about it.
   *
   * Measured from the PAYMENTS, which is the part that was wrong first time
   * round: the sum came off the invoices, and the commonest online sale — paid
   * through the booking widget — has a transaction and no invoice at all.
   */
  it('reports money paid against an invoice', async () => {
    mockFindInvoices.mockResolvedValue({
      data: [{ id: 'inv-1', status: 'paid', amount: 250, refunded_amount: 0, currency: 'ILS' }],
      error: null,
    });
    mockFindSettled.mockResolvedValue({
      data: [{ id: 'tx-1', status: 'succeeded', amount: 250, refunded_amount: 0, currency: 'ILS' }],
      error: null,
    });

    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data?.invoicesCancelled).toBe(0);
    expect(result.data?.amountHeld).toBe(250);
    expect(result.data?.heldCurrency).toBe('ILS');
  });

  /*
   * THE DIRECT ONLINE SALE — paid through the booking widget, no invoice
   * anywhere. An invoice-derived sum called this zero, so nothing prompted the
   * owner and the money quietly stayed with the business.
   */
  it('reports money paid online with no invoice behind it', async () => {
    mockFindInvoices.mockResolvedValue({ data: [], error: null });
    mockFindSettled.mockResolvedValue({
      data: [{ id: 'tx-1', status: 'succeeded', amount: 180, refunded_amount: 0, currency: 'USD' }],
      error: null,
    });

    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data?.amountHeld).toBe(180);
    expect(result.data?.heldCurrency).toBe('USD');
  });

  /* Both queries are asked: by booking, and by the booking's invoices. */
  it('looks for payments by booking and by invoice', async () => {
    mockFindInvoices.mockResolvedValue({
      data: [{ id: 'inv-1', status: 'paid', amount: 250, refunded_amount: 0, currency: 'ILS' }],
      error: null,
    });

    await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(mockFindSettled).toHaveBeenCalledWith(BOOKING_ID, ['inv-1'], USER_ID);
  });

  it('counts only what is still held after a partial refund', async () => {
    mockFindSettled.mockResolvedValue({
      data: [{ id: 'tx-1', status: 'succeeded', amount: 300, refunded_amount: 100, currency: 'ILS' }],
      error: null,
    });

    expect((await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID })).data?.amountHeld).toBe(200);
  });

  /*
   * An invoice called off before anyone paid it still carries its `amount`.
   * Reading the sum off the invoices counted that as money held, and the owner
   * would have been offered a refund for money that never arrived.
   */
  it('holds nothing for an invoice that was cancelled before anyone paid it', async () => {
    mockFindInvoices.mockResolvedValue({
      data: [{ id: 'inv-1', status: 'cancelled', amount: 300, refunded_amount: 0, currency: 'ILS' }],
      error: null,
    });
    mockFindSettled.mockResolvedValue({ data: [], error: null });

    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data?.amountHeld).toBe(0);
    expect(result.data?.heldCurrency).toBeNull();
  });

  it('holds nothing once it has been refunded in full', async () => {
    mockFindSettled.mockResolvedValue({
      data: [{ id: 'tx-1', status: 'succeeded', amount: 300, refunded_amount: 300, currency: 'ILS' }],
      error: null,
    });

    expect((await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID })).data?.amountHeld).toBe(0);
  });

  /* A payment that never went through is not money the business is holding. */
  it('ignores a payment that did not succeed', async () => {
    mockFindSettled.mockResolvedValue({
      data: [{ id: 'tx-1', status: 'failed', amount: 300, refunded_amount: 0, currency: 'ILS' }],
      error: null,
    });

    expect((await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID })).data?.amountHeld).toBe(0);
  });

  /*
   * The booking is already cancelled by this point. An invoice left chaseable is
   * a real problem, but failing the cancellation over it would leave the owner
   * with an appointment they have told a client is off.
   */
  it('still cancels the booking when the invoices cannot be read', async () => {
    mockFindInvoices.mockRejectedValue(new Error('database down'));

    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.error).toBeNull();
    expect(result.data?.booking).toEqual(booking());
    expect(result.data?.invoicesCancelled).toBe(0);
  });
});
