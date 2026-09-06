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
    });

    // The three steps that make a cancellation real.
    expect(mockCancel).toHaveBeenCalledWith(BOOKING_ID, USER_ID, 'client is ill');
    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith(booking(), USER_ID);
    expect(mockSendCancellationEmail).toHaveBeenCalledWith(BOOKING_ID, USER_ID, 'client is ill');
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
    expect(mockSendCancellationEmail).toHaveBeenCalledWith(BOOKING_ID, USER_ID, undefined);
  });
});
