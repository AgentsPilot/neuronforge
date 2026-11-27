/**
 * PROD-1b.2 (SA D-9, workplan 10.2): a calendar plugin answers a change it
 * refused to make, because it would email someone not on the recipient
 * allow-list, with a SUCCESS-shaped result carrying `allowlist_suppressed`.
 * Booking sync must record that as not synced, keep the stored event id, and
 * never claim a reschedule or a cancellation it did not make.
 *
 * Every module the service loads at import is mocked (SA condition 10): no
 * Supabase client is created and nothing reaches the network.
 */

const mockExecute = jest.fn();
jest.mock('@/lib/server/plugin-executer-v2', () => ({
  PluginExecuterV2: { getInstance: async () => ({ execute: mockExecute }) },
}));

const mockUpdateCalendarSync = jest.fn().mockResolvedValue({ data: null, error: null });
const mockUpdateMeetingCalendarSync = jest.fn().mockResolvedValue({ data: null, error: null });
const mockClearCalendarSync = jest.fn().mockResolvedValue({ data: null, error: null });
jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: {
    updateCalendarSync: (...args: unknown[]) => mockUpdateCalendarSync(...args),
    updateMeetingCalendarSync: (...args: unknown[]) => mockUpdateMeetingCalendarSync(...args),
    clearCalendarSync: (...args: unknown[]) => mockClearCalendarSync(...args),
  },
  schedulingServiceRepository: {},
}));
jest.mock('@/lib/repositories/ExternalCalendarEventRepository', () => ({ externalCalendarEventRepository: {} }));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({ businessProfileRepository: {} }));
jest.mock('@/lib/repositories/PluginConnectionRepository', () => ({ pluginConnectionRepository: {} }));

import { CalendarSyncService } from '@/lib/services/CalendarSyncService';
import type { SchedulingBooking, SchedulingService } from '@/lib/repositories/SchedulingRepository';

const USER_ID = 'user-1';
const NOT_SYNCED = 'Not changed: this environment only sends calendar mail to allow-listed addresses';

const booking = {
  id: 'booking-1',
  client_first_name: 'Dana',
  client_last_name: 'Client',
  client_email: 'client@customer.example',
  start_time: '2026-04-15T14:00:00Z',
  end_time: '2026-04-15T15:00:00Z',
  external_calendar_event_id: 'evt-1',
  calendar_sync_provider: 'outlook',
} as unknown as SchedulingBooking;
const service = { service_name: 'Consultation' } as unknown as SchedulingService;
const meeting = { id: 'meeting-1', external_calendar_event_id: 'evt-m', calendar_sync_provider: 'outlook' as const };

const suppressed = { success: true, data: { status: 'not_updated', allowlist_suppressed: true, note: 'n' } };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CalendarSyncService — a suppressed change is not a sync (PROD-1b.2)', () => {
  it('update returns allowlist_suppressed: not synced, the error recorded, no synced timestamp', async () => {
    mockExecute.mockResolvedValueOnce(suppressed);
    const result = await CalendarSyncService.updateCalendarEvent(booking, service, USER_ID);

    expect(result).toEqual({ success: false, error: NOT_SYNCED });
    expect(mockUpdateCalendarSync).toHaveBeenCalledTimes(1);
    expect(mockUpdateCalendarSync).toHaveBeenCalledWith('booking-1', USER_ID, { calendar_sync_error: NOT_SYNCED });
    expect(mockUpdateMeetingCalendarSync).not.toHaveBeenCalled();
  });

  it('delete returns allowlist_suppressed: not synced, the event id kept, the error recorded', async () => {
    mockExecute.mockResolvedValueOnce({ success: true, data: { event_id: 'evt-1', status: 'not_deleted', allowlist_suppressed: true } });
    const result = await CalendarSyncService.deleteCalendarEvent(booking, USER_ID);

    expect(result).toEqual({ success: false, error: NOT_SYNCED });
    expect(mockClearCalendarSync).not.toHaveBeenCalled();
    expect(mockUpdateCalendarSync).toHaveBeenCalledWith('booking-1', USER_ID, { calendar_sync_error: NOT_SYNCED });
  });

  it('a package session: the meeting row is written, not the booking, and its id is kept', async () => {
    mockExecute.mockResolvedValueOnce(suppressed);
    const updated = await CalendarSyncService.updateCalendarEvent(booking, service, USER_ID, meeting);
    expect(updated.success).toBe(false);

    mockExecute.mockResolvedValueOnce({ success: true, data: { status: 'not_deleted', allowlist_suppressed: true } });
    const deleted = await CalendarSyncService.deleteCalendarEvent(booking, USER_ID, meeting);
    expect(deleted.success).toBe(false);

    expect(mockUpdateCalendarSync).not.toHaveBeenCalled();
    expect(mockClearCalendarSync).not.toHaveBeenCalled();
    expect(mockUpdateMeetingCalendarSync).toHaveBeenCalledTimes(2);
    for (const call of mockUpdateMeetingCalendarSync.mock.calls) {
      expect(call).toEqual(['meeting-1', USER_ID, { calendar_sync_error: NOT_SYNCED }]);
    }
  });

  it('an ordinary success (the Google shape) is unchanged: synced on update, cleared on delete', async () => {
    mockExecute.mockResolvedValueOnce({ success: true, data: { event_id: 'evt-1' } });
    const updated = await CalendarSyncService.updateCalendarEvent(booking, service, USER_ID);
    expect(updated).toEqual({ success: true, eventId: 'evt-1' });
    expect(mockUpdateCalendarSync).toHaveBeenCalledWith(
      'booking-1',
      USER_ID,
      expect.objectContaining({ calendar_sync_error: null, calendar_synced_at: expect.any(String) })
    );

    mockExecute.mockResolvedValueOnce({ success: true, data: { event_id: 'evt-1', status: 'deleted' } });
    const deleted = await CalendarSyncService.deleteCalendarEvent(booking, USER_ID);
    expect(deleted).toEqual({ success: true });
    expect(mockClearCalendarSync).toHaveBeenCalledWith('booking-1', USER_ID);
  });
});
