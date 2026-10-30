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

const mockFindChildren = jest.fn();

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MOCKS BELOW ARE WHAT MAKES THIS SUITE OFFLINE.
 *
 * `cancelBooking` and `deleteBooking` used to query `proposals`,
 * `payment_plan_subscriptions`, `payment_plan_installments`,
 * `scheduling_services` and `scheduling_bookings` through a module-scope
 * `supabaseServer` — past every collaborator a test could stub. This file was
 * fully mocked and still made 202 real HTTP calls per run to a host that does
 * not resolve, each one swallowed by a `catch` that logs. The suite passed, and
 * nothing in it showed that it had left the machine. A lost DNS query cost a
 * ~5 s resolver retry, which is Jest's per-test budget, so an unrelated test in
 * another file failed on a timeout; that turned two PRs red.
 *
 * Those reads and writes now go through repositories, so every one of them has
 * a seam here.
 *
 * A mock below must carry a key for EVERY method the paths these tests exercise
 * actually call, because a missing key is not a missing call — it is a
 * TypeError inside a `try` whose catch only logs, which looks exactly like a
 * passing test and asserts nothing. The `SchedulingRepository` factory is
 * deliberately partial (it omits `delete`, `update`, `create`, `checkOverlap`
 * and the whole of `schedulingServiceRepository.findById`): those belong to
 * paths no test here reaches, and the delete tests all refuse before `delete`.
 * Extending these tests past that point means extending the factory first.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const mockFindById = jest.fn();
const mockFindCancellationState = jest.fn();
const mockLinkPaymentPlan = jest.fn();
const mockFindSaleMode = jest.fn();

jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: {
    cancel: (...args: unknown[]) => mockCancel(...args),
    /*
     * A package's meetings, which cancelling the purchase now takes with it.
     * Empty by default: every other booking in this file is an ordinary one,
     * and that is what "no children" means.
     */
    findChildren: (...args: unknown[]) => mockFindChildren(...args),
    /* Is the package already off? Both columns, because `status` alone misses
       a booking whose outcome was already recorded. */
    findCancellationState: (...args: unknown[]) => mockFindCancellationState(...args),
    linkPaymentPlan: (...args: unknown[]) => mockLinkPaymentPlan(...args),
    /* `deleteBooking` reads the row before destroying anything. */
    findById: (...args: unknown[]) => mockFindById(...args),
  },
  schedulingServiceRepository: {
    /* `sale_mode`: whether cancelling the booking must also reach a quote. */
    findSaleMode: (...args: unknown[]) => mockFindSaleMode(...args),
  },
}));

const mockFindAcceptedQuotes = jest.fn();
const mockStopAcceptedQuotes = jest.fn();
const mockFindPackageQuotes = jest.fn();
const mockWithdrawOpenQuotes = jest.fn();

jest.mock('@/lib/repositories/ProposalRepository', () => ({
  OPEN_PROPOSAL_STATUSES: ['draft', 'sent', 'viewed'],
  proposalRepository: {
    findAcceptedForBooking: (...args: unknown[]) => mockFindAcceptedQuotes(...args),
    stopAccepted: (...args: unknown[]) => mockStopAcceptedQuotes(...args),
    findPackageQuotesForBooking: (...args: unknown[]) => mockFindPackageQuotes(...args),
    withdrawOpenForBooking: (...args: unknown[]) => mockWithdrawOpenQuotes(...args),
  },
}));

const mockFindLivePlan = jest.fn();
const mockFindAnyPlan = jest.fn();

jest.mock('@/lib/repositories/PaymentPlanSubscriptionRepository', () => ({
  paymentPlanSubscriptionRepository: {
    /* Two deliberately different questions — see the repository. `cancelBooking`
       asks "is it still charging"; `deleteBooking` asks "is ANY row attached",
       because that is what ON DELETE RESTRICT counts. */
    findLiveForBooking: (...args: unknown[]) => mockFindLivePlan(...args),
    findAnyForBooking: (...args: unknown[]) => mockFindAnyPlan(...args),
  },
}));

const mockCancelStages = jest.fn();
const mockStampFirstPeriod = jest.fn();

/*
 * Bringing the plan's stored totals into line with the stages just closed.
 *
 * Reached by dynamic `import()` only when stages actually close — which, until
 * these repositories had seams, never happened in a test, because the stage
 * close itself failed first. It takes a Supabase client as a parameter (three
 * callers each pass their own), so it stays a live query until mocked here.
 */
const mockLowerPlans = jest.fn();
jest.mock('@/lib/payments/planFollowsItsStages', () => ({
  lowerPlansForCancelledStages: (...args: unknown[]) => mockLowerPlans(...args),
}));

jest.mock('@/lib/repositories/PaymentPlanRepository', () => ({
  paymentPlanRepository: {
    cancelOpenStagesForBooking: (...args: unknown[]) => mockCancelStages(...args),
    stampFirstPeriodInvoice: (...args: unknown[]) => mockStampFirstPeriod(...args),
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

import {
  cancelBooking,
  deleteBooking,
  BookingHasPlanError,
} from '@/lib/services/BookingLifecycleService';

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
  // An ordinary booking owns no meetings; the package test sets its own.
  mockFindChildren.mockImplementation(async () => ({ data: [], error: null }));
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

  /*
   * The repository defaults: "an ordinary booking with no quote and no plan".
   *
   * Every one returns the real `{ data, error }` shape, because the subject
   * destructures it. The tests that care about a quote or a plan override the
   * one mock they are about, so a default that drifted would be visible rather
   * than silently making half the file pass for the wrong reason.
   */
  mockFindSaleMode.mockResolvedValue({ data: { sale_mode: 'direct' }, error: null });
  mockFindCancellationState.mockResolvedValue({ data: null, error: null });
  mockLinkPaymentPlan.mockResolvedValue({ data: null, error: null });
  mockFindAcceptedQuotes.mockResolvedValue({ data: [], error: null });
  mockStopAcceptedQuotes.mockResolvedValue({ data: [], error: null });
  mockFindPackageQuotes.mockResolvedValue({ data: [], error: null });
  mockWithdrawOpenQuotes.mockResolvedValue({ data: [], error: null });
  mockFindLivePlan.mockResolvedValue({ data: null, error: null });
  mockFindAnyPlan.mockResolvedValue({ data: null, error: null });
  mockCancelStages.mockResolvedValue({ data: [], error: null });
  mockStampFirstPeriod.mockResolvedValue({ data: null, error: null });
  mockLowerPlans.mockResolvedValue(undefined);
  mockFindById.mockResolvedValue({ data: booking({ status: 'confirmed' }), error: null });
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
      // And no meetings: an ordinary booking is not a package's purchase.
      meetingsCancelled: 0,
    });

    // The three steps that make a cancellation real.
    /*
     * The prose reason AND the structured fourth argument.
     *
     * `cancellation_reason` still carries the sentence — the `booking_cancelled`
     * gap and `CashCancelledUnrefundedDetector` parse `CLIENT_CANCELLED_PREFIX`
     * out of it — and the structured columns are written alongside. This caller
     * passed no code, so they are null rather than guessed.
     */
    expect(mockCancel).toHaveBeenCalledWith(BOOKING_ID, USER_ID, 'client is ill', {
      code: null,
      note: null,
      cancelledBy: null,
    });
    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith(booking(), USER_ID);
    expect(mockSendCancellationEmail).toHaveBeenCalledWith(BOOKING_ID, USER_ID, 'client is ill', {
      offerRebooking: undefined,
      /*
       * Zero here because this fixture was never paid for. The figure is passed
       * whatever it is: the client's email says what is still held, and it is the
       * same number the owner is asked to refund, worked out once above.
       */
      amountHeld: 0,
      heldCurrency: null,
      /* Added by the package-cancel cascade: the package whose sessions were
         called off with this booking, and whether the owner's note is shared.
         Null / undefined on an ordinary booking, which sells no sessions. */
      sessionsFrom: null,
      shareNoteWithClient: undefined,
      paidAmount: 0,
      refundedAmount: 0,
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

    expect(mockCancel).toHaveBeenCalledWith(BOOKING_ID, USER_ID, undefined, {
      code: null,
      note: null,
      cancelledBy: null,
    });
    // Undefined, not false: an ordinary cancellation still invites the client
    // to book again. Only a closing business suppresses that.
    expect(mockSendCancellationEmail).toHaveBeenCalledWith(BOOKING_ID, USER_ID, undefined, {
      offerRebooking: undefined,
      amountHeld: 0,
      heldCurrency: null,
      /* Added by the package-cancel cascade: the package whose sessions were
         called off with this booking, and whether the owner's note is shared.
         Null / undefined on an ordinary booking, which sells no sessions. */
      sessionsFrom: null,
      shareNoteWithClient: undefined,
      paidAmount: 0,
      refundedAmount: 0,
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
      {
          offerRebooking: false,
          sessionsFrom: null,
          shareNoteWithClient: undefined,
          amountHeld: 0,
          heldCurrency: null,
          paidAmount: 0,
          refundedAmount: 0,
        }
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

describe('the email does not contradict the reason', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE EMAIL THAT PROMPTED THIS said, in one message: we no longer offer this
   * service, and — would you like to book it again? With a button pointing at
   * the page for the thing just withdrawn.
   *
   * `offerRebooking` predates reason codes and only ever meant "the business is
   * closing down", so no caller was in a position to suppress it. The reason now
   * decides.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const rebookingOffered = () =>
    mockSendCancellationEmail.mock.calls[0][3].offerRebooking;

  it.each(['service_discontinued', 'rescheduled', 'duplicate', 'test_booking'])(
    'does not invite them back after %s',
    async code => {
      await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID, cancelReason: code });
      expect(rebookingOffered()).toBe(false);
    }
  );

  it.each(['client_cancelled', 'client_no_show', 'client_not_paying', 'owner_unavailable'])(
    'still invites them back after %s',
    async code => {
      /*
       * Deliberately including the awkward ones. A client who did not pay or did
       * not turn up is someone a business may well want to see again, and that is
       * the owner's call rather than a lookup table's.
       */
      await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID, cancelReason: code });
      expect(rebookingOffered()).not.toBe(false);
    }
  );

  it('lets an explicit choice win over the reason', async () => {
    // The closing-business path has thought about it and is better informed than
    // any table here.
    await cancelBooking({
      bookingId: BOOKING_ID,
      userId: USER_ID,
      cancelReason: 'client_cancelled',
      offerRebooking: false,
    });
    expect(rebookingOffered()).toBe(false);
  });

  it('leaves it undefined when there is no code, so nothing changes for old callers', async () => {
    await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });
    expect(rebookingOffered()).toBeUndefined();
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * CANCELLING A PACKAGE.
 *
 * Nothing cascades on a status change the way `ON DELETE` does on a delete, and
 * a per-session package's stages hang off the MEETINGS rather than the
 * purchase — so cancelling the purchase left six confirmed appointments in the
 * diary, six live stages, and a client still being reminded about every one of
 * them.
 *
 * Each meeting is now cancelled as a booking in its own right, which is what
 * voids its invoice, closes its stage, clears its calendar event and tells the
 * client about its own date.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('cancelBooking on a package', () => {
  const meetings = [
    { id: 'm1', status: 'confirmed', occurrence_number: 1 },
    { id: 'm2', status: 'confirmed', occurrence_number: 2 },
    { id: 'm3', status: 'completed', occurrence_number: 3 },
    { id: 'm4', status: 'cancelled', occurrence_number: 4 },
  ];

  it('cancels every meeting that is still standing', async () => {
    // Only the CONTAINER owns meetings. Answering the same list for every id is
    // what sent the first version of this into infinite recursion.
    mockFindChildren.mockImplementation(async (id: string) => ({
      data: id === 'container-1' ? meetings : [],
      error: null,
    }));

    const result = await cancelBooking({ bookingId: 'container-1', userId: 'user-1' });

    // Two of the four: a meeting already held is a record, and one already
    // cancelled is done. Rewriting either would erase what happened.
    expect(result.data?.meetingsCancelled).toBe(2);

    const cancelled = mockCancel.mock.calls.map(call => call[0]);
    expect(cancelled).toContain('m1');
    expect(cancelled).toContain('m2');
    expect(cancelled).not.toContain('m3');
    expect(cancelled).not.toContain('m4');
  });

  it('cancels them BEFORE the purchase itself', async () => {
    mockFindChildren.mockImplementation(async (id: string) => ({
      data: id === 'container-1' ? meetings : [],
      error: null,
    }));

    await cancelBooking({ bookingId: 'container-1', userId: 'user-1' });

    // The other order leaves a cancelled purchase whose appointments are all
    // still live and still reminding the client.
    const order = mockCancel.mock.calls.map(call => call[0]);
    expect(order[order.length - 1]).toBe('container-1');
  });

  it('leaves the purchase open if a meeting cannot be cancelled', async () => {
    mockFindChildren.mockImplementation(async (id: string) => ({
      data: id === 'container-1' ? [meetings[0]] : [],
      error: null,
    }));
    mockCancel.mockResolvedValue({ data: null, error: new Error('db down') });

    const result = await cancelBooking({ bookingId: 'container-1', userId: 'user-1' });

    expect(result.error).toBeTruthy();
    // One attempt, for the meeting. The purchase was never touched.
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('tells the client ONCE, with every cancelled date', async () => {
    mockFindChildren.mockImplementation(async (id: string) => ({
      data:
        id === 'container-1'
          ? [
              { ...meetings[0], start_time: '2026-10-08T13:30:00.000Z' },
              { ...meetings[1], start_time: '2026-10-22T13:30:00.000Z' },
              { ...meetings[2], start_time: '2026-11-05T14:30:00.000Z' },
              { ...meetings[3], start_time: '2026-11-19T14:30:00.000Z' },
            ]
          : [],
      error: null,
    }));

    await cancelBooking({ bookingId: 'container-1', userId: 'user-1' });

    /*
     * One email, not four: six separate cancellations arriving together is six
     * times the alarm for one piece of news, and leaves the client working out
     * whether anything survived.
     */
    expect(mockSendCancellationEmail).toHaveBeenCalledTimes(1);

    const [bookingId, , , options] = mockSendCancellationEmail.mock.calls[0];
    // Sent from one of the meetings, because the email reads the service and
    // the client from a booking — and the purchase has no hour of its own.
    expect(bookingId).toBe('m1');
    // Only the ones actually cancelled: m3 was held and m4 was already off.
    expect(options.sessions).toHaveLength(2);
    expect(options.sessions[0].toISOString()).toBe('2026-10-08T13:30:00.000Z');
  });

  it('states what TOOK PLACE as well as what is off', async () => {
    /*
     * A block of six cancelled after two is not six cancellations. The client
     * has had two sessions and paid for them, and an email naming only the four
     * that are off reads as though the whole thing was undone — which is the
     * version a dispute would be argued from.
     */
    mockFindChildren.mockImplementation(async (id: string) => ({
      data:
        id === 'container-1'
          ? [
              { id: 'm1', status: 'completed', occurrence_number: 1, start_time: '2026-10-08T13:30:00.000Z' },
              { id: 'm2', status: 'completed', occurrence_number: 2, start_time: '2026-10-22T13:30:00.000Z' },
              { id: 'm3', status: 'confirmed', occurrence_number: 3, start_time: '2026-11-05T14:30:00.000Z' },
              { id: 'm4', status: 'confirmed', occurrence_number: 4, start_time: '2026-11-19T14:30:00.000Z' },
            ]
          : [],
      error: null,
    }));

    await cancelBooking({ bookingId: 'container-1', userId: 'user-1' });

    const [, , , options] = mockSendCancellationEmail.mock.calls[0];

    expect(options.heldSessions).toHaveLength(2);
    expect(options.heldSessions[0].toISOString()).toBe('2026-10-08T13:30:00.000Z');
    expect(options.sessions).toHaveLength(2);
    expect(options.sessions[0].toISOString()).toBe('2026-11-05T14:30:00.000Z');
  });

  it('counts the money of every meeting, not only the purchase', async () => {
    /*
     * On a package billed per session the money sits on each MEETING's invoice.
     * Read from the purchase alone, the email would tell a client who had paid
     * for two sessions that nothing was ever collected.
     */
    mockFindChildren.mockImplementation(async (id: string) => ({
      data:
        id === 'container-1'
          ? [
              { id: 'm1', status: 'completed', occurrence_number: 1, start_time: '2026-10-08T13:30:00.000Z' },
              { id: 'm2', status: 'confirmed', occurrence_number: 2, start_time: '2026-11-05T14:30:00.000Z' },
            ]
          : [],
      error: null,
    }));

    mockFindInvoices.mockImplementation(async (id: string) => ({
      data: id === 'm1' ? [{ id: 'inv-1', status: 'paid' }] : [],
      error: null,
    }));

    mockFindSettled.mockImplementation(async (id: string) => ({
      data:
        id === 'm1'
          ? [{ id: 'tx-1', amount: 83.33, refunded_amount: 0, status: 'succeeded', currency: 'ILS' }]
          : [],
      error: null,
    }));

    await cancelBooking({ bookingId: 'container-1', userId: 'user-1' });

    const [, , , options] = mockSendCancellationEmail.mock.calls[0];
    expect(options.paidAmount).toBe(83.33);
    expect(options.heldCurrency).toBe('ILS');
  });

  it('carries the reason down to each meeting', async () => {
    mockFindChildren.mockImplementation(async (id: string) => ({
      data: id === 'container-1' ? [meetings[0]] : [],
      error: null,
    }));

    await cancelBooking({
      bookingId: 'container-1',
      userId: 'user-1',
      reason: 'Client moved away',
      cancelReason: 'client_not_paying',
    });

    // The client is told the same thing about each date, and the code is what
    // a report counts.
    const [, , reason, codes] = mockCancel.mock.calls[0];
    expect(reason).toBe('Client moved away');
    expect(codes).toMatchObject({ code: 'client_not_paying' });
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PATHS THAT WERE UNREACHABLE FROM A TEST.
 *
 * Everything below exercises a read or write that used to go straight to
 * `supabaseServer`. None of it could be driven before: the call left the
 * machine, failed, and landed in a `catch` that logs — so the only assertions
 * this file made about these outcomes were the all-zero, all-false defaults of
 * the swallowed failure. The 202 real HTTP calls bought no coverage whatever.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('a booking with a payment plan still charging', () => {
  it('reports the plan live and what is left to collect, without stopping it', async () => {
    /*
     * READ ONLY, on purpose. The platform does not end somebody's payment
     * arrangement because an appointment was called off — `cancelPlan` is
     * reached from the refund dialog and the Money page and stays the owner's
     * to press.
     */
    mockFindLivePlan.mockResolvedValue({
      data: {
        id: 'plan-1',
        status: 'active',
        installment_count: 11,
        periods_paid: 4,
        next_charge_at: '2026-11-01T00:00:00Z',
      },
      error: null,
    });

    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data!.planLive).toBe(true);
    expect(result.data!.periodsRemaining).toBe(7);
  });

  it('treats unknown counts as unknown, never as nothing left to charge', async () => {
    /*
     * `Number(null)` is 0, so reading these without the null check reported
     * "0 periods remaining" for a plan whose counts could not be read — which
     * says "nothing left to charge" about a plan that is still charging. Not
     * knowing how many are left is not evidence that none are.
     */
    mockFindLivePlan.mockResolvedValue({
      data: { id: 'plan-1', status: 'active', installment_count: null, periods_paid: null },
      error: null,
    });

    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data!.planLive).toBe(true);
    expect(result.data!.periodsRemaining).toBeNull();
  });

  it('never reports a negative remainder', async () => {
    // More paid than the plan says it has periods: bad data, but "-2 left to
    // pay" is not an answer anyone can act on.
    mockFindLivePlan.mockResolvedValue({
      data: { id: 'plan-1', status: 'active', installment_count: 3, periods_paid: 5 },
      error: null,
    });

    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data!.periodsRemaining).toBe(0);
  });

  it('cancels the booking anyway when the plan cannot be read', async () => {
    // Its own statement and its own failure: an unreadable plan must not cost
    // the cancellation the owner asked for.
    mockFindLivePlan.mockResolvedValue({ data: null, error: new Error('plan unreadable') });

    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.error).toBeNull();
    expect(result.data!.planLive).toBe(false);
    expect(mockCancel).toHaveBeenCalled();
  });
});

describe('the quote stages of a cancelled booking', () => {
  it('closes them and carries the reason, the note and the owner', async () => {
    /*
     * THE REASON TRAVELS. A plan stopped this way used to record nothing
     * countable, while the same plan stopped from Manage Payment recorded a
     * code, a note and an owner — so one report could not union them.
     */
    mockCancelStages.mockResolvedValue({
      data: [
        { id: 'stage-1', amount: 400, payment_plan_id: 'plan-1' },
        { id: 'stage-2', amount: 400, payment_plan_id: 'plan-1' },
      ],
      error: null,
    });

    const result = await cancelBooking({
      bookingId: BOOKING_ID,
      userId: USER_ID,
      cancelReason: 'client_not_paying',
      cancelNote: 'they stopped replying',
      cancelledBy: 'owner',
    });

    expect(result.data!.stagesClosed).toBe(2);
    expect(mockCancelStages).toHaveBeenCalledWith(BOOKING_ID, USER_ID, {
      reason: 'client_not_paying',
      note: 'they stopped replying',
      by: 'owner',
    });
  });
});

describe('the quotes behind a cancelled booking', () => {
  it('withdraws the open ones when the service is sold by quote', async () => {
    /* The default fixture names no service, so the read is skipped — see the
       nullable-`service_id` test below. This one is about a booking that has
       one. */
    mockCancel.mockResolvedValue({ data: booking({ service_id: 'service-1' }), error: null });
    mockFindSaleMode.mockResolvedValue({ data: { sale_mode: 'proposal' }, error: null });
    mockWithdrawOpenQuotes.mockResolvedValue({ data: ['quote-1', 'quote-2'], error: null });

    await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(mockWithdrawOpenQuotes).toHaveBeenCalledWith(BOOKING_ID, USER_ID);
  });

  it('leaves them alone when the service is not sold by quote', async () => {
    // On a directly booked service there is no quote to withdraw, and asking
    // would be a write nobody asked for.
    mockCancel.mockResolvedValue({ data: booking({ service_id: 'service-1' }), error: null });
    mockFindSaleMode.mockResolvedValue({ data: { sale_mode: 'direct' }, error: null });

    await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(mockFindSaleMode).toHaveBeenCalledWith('service-1', USER_ID);
    expect(mockWithdrawOpenQuotes).not.toHaveBeenCalled();
  });

  it('does not ask about the service when the booking arrives without one', async () => {
    /*
     * The column is `uuid NOT NULL` and typed `string`, so this is not a
     * nullable-column case — it is the ABSENT case, which is what every
     * fixture in this file is and what the baseline probe actually caught:
     * `scheduling_services?select=sale_mode&id=eq.undefined`. The read this
     * replaced passed the value straight into `.eq('id', …)`, and that is a
     * PostgREST error rather than an empty result — swallowed by the enclosing
     * catch, so it read as "not a quoted service" rather than as a failed
     * query.
     *
     * Cast, because the type correctly forbids what the fixture is doing; the
     * point of the test is that the guard holds when the type is wrong about
     * reality.
     */
    const withoutService = booking();
    delete (withoutService as { service_id?: string }).service_id;
    mockCancel.mockResolvedValue({ data: withoutService, error: null });

    const result = await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.error).toBeNull();
    expect(mockFindSaleMode).not.toHaveBeenCalled();
  });

  it('stops an accepted quote, which withdrawal cannot touch', async () => {
    /*
     * An accepted quote is deliberately not withdrawable — money was created
     * against it. Without this it sat reading `accepted` over stages that had
     * just been closed: indistinguishable from a job that finished and was paid
     * in full.
     */
    mockCancelStages.mockResolvedValue({
      data: [{ id: 'stage-1', amount: 400, payment_plan_id: 'plan-1' }],
      error: null,
    });
    mockFindAcceptedQuotes.mockResolvedValue({
      data: [{ id: 'quote-1', package_booking_id: null }],
      error: null,
    });
    mockStopAcceptedQuotes.mockResolvedValue({
      data: [{ id: 'quote-1', package_booking_id: null }],
      error: null,
    });

    await cancelBooking({
      bookingId: BOOKING_ID,
      userId: USER_ID,
      cancelReason: 'client_not_paying',
    });

    expect(mockFindAcceptedQuotes).toHaveBeenCalledWith(BOOKING_ID, USER_ID);
    expect(mockStopAcceptedQuotes).toHaveBeenCalledWith(['quote-1'], USER_ID, {
      reason: 'client_not_paying',
      note: undefined,
    });
  });
});

describe('cancelling the package a quote sold', () => {
  it('does not run the cascade again on a package already called off', async () => {
    /*
     * BOTH columns decide this. `cancel()` writes `status` and `meeting_status`
     * together EXCEPT on a booking whose outcome was already recorded, where it
     * writes neither — so a package whose sessions were all held keeps
     * `status: 'confirmed'` after being called off. A guard reading only
     * `status` would rewrite its `outcome_at` and re-fire its side effects.
     */
    mockFindPackageQuotes.mockResolvedValue({
      data: [{ id: 'quote-1', package_booking_id: 'package-1' }],
      error: null,
    });
    mockFindCancellationState.mockResolvedValue({
      data: { status: 'confirmed', meeting_status: 'cancelled' },
      error: null,
    });

    await cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(mockFindCancellationState).toHaveBeenCalledWith('package-1', USER_ID);
    // The package itself is never re-cancelled; only the booking asked for.
    expect(mockCancel.mock.calls.map(call => call[0])).toEqual([BOOKING_ID]);
  });
});

describe('deleting a booking with a payment plan attached', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ANY plan row refuses the delete, live or finished, because that is what
   * `ON DELETE RESTRICT` enforces — and the refusal has to arrive HERE.
   *
   * The database would refuse it too, but at the very LAST step: by then the
   * invoices are voided and deleted, the calendar event is gone and the client
   * has been emailed that their appointment is cancelled, for a booking that
   * then survives. Every one of those is unrecoverable, and the email is a lie
   * the moment the delete fails.
   *
   * None of this had a test. The read was a direct `supabaseServer` call, so
   * the guard could not be driven from one.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('refuses, and says the plan is still live', async () => {
    mockFindAnyPlan.mockResolvedValue({
      data: { id: 'plan-1', status: 'active' },
      error: null,
    });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(BookingHasPlanError);
    expect((result.error as InstanceType<typeof BookingHasPlanError>).planLive).toBe(true);
    // By booking and owner. That it applies NO status filter is asserted on the
    // repository, where the query lives.
    expect(mockFindAnyPlan).toHaveBeenCalledWith(BOOKING_ID, USER_ID);
  });

  it('refuses for a STOPPED plan too, the case a live-only filter would miss', async () => {
    mockFindAnyPlan.mockResolvedValue({
      data: { id: 'plan-1', status: 'cancelled' },
      error: null,
    });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.error).toBeInstanceOf(BookingHasPlanError);
    // Refused, but the owner is told it is finished rather than still charging.
    expect((result.error as InstanceType<typeof BookingHasPlanError>).planLive).toBe(false);
  });

  it('refuses rather than guessing when the plan cannot be read', async () => {
    // Proceeding would hit RESTRICT at the last step, after the invoices, the
    // calendar and the email are already gone.
    mockFindAnyPlan.mockResolvedValue({ data: null, error: new Error('plan unreadable') });

    const result = await deleteBooking({ bookingId: BOOKING_ID, userId: USER_ID });

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error).not.toBeInstanceOf(BookingHasPlanError);
  });
});
