/**
 * Unit tests for GoogleCalendarPluginExecutor — 8 actions
 */

import { GoogleCalendarPluginExecutor } from '@/lib/server/google-calendar-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult, expectFetchCalledWith } from '../common/test-helpers';
import { mockFetchSuccess, mockFetchError, mockFetchSequence, getAllFetchCalls, restoreFetch } from '../common/mock-fetch';
import { runStandardErrorScenarios } from '../common/error-scenarios';

const PLUGIN_KEY = 'google-calendar';
const USER_ID = 'test-user-id';

describe('GoogleCalendarPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(GoogleCalendarPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('[smoke]', () => {
    // ---- list_events ----
    describe('list_events', () => {
      it('should list events within time range', async () => {
        mockFetchSuccess({
          items: [
            {
              id: 'evt-1',
              summary: 'Meeting',
              start: { dateTime: '2026-03-27T10:00:00Z' },
              end: { dateTime: '2026-03-27T11:00:00Z' },
              htmlLink: 'https://calendar.google.com/event?id=evt-1',
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'list_events', {
          time_min: '2026-03-27T00:00:00Z',
          time_max: '2026-03-28T00:00:00Z',
        });

        expectSuccessResult(result);
        expect(result.data.events).toHaveLength(1);
        expect(result.data.events[0].summary).toBe('Meeting');
        expectFetchCalledWith('calendar/v3/calendars/primary/events');
      });
    });

    // ---- create_event ----
    describe('create_event', () => {
      it('should create event with attendees', async () => {
        mockFetchSuccess({
          id: 'new-evt',
          summary: 'New Event',
          start: { dateTime: '2026-04-01T09:00:00Z' },
          end: { dateTime: '2026-04-01T10:00:00Z' },
          htmlLink: 'https://calendar.google.com/event?id=new-evt',
          attendees: [{ email: 'bob@example.com' }],
        });

        const result = await executor.executeAction(USER_ID, 'create_event', {
          summary: 'New Event',
          start_time: '2026-04-01T09:00:00Z',
          end_time: '2026-04-01T10:00:00Z',
          attendees: ['bob@example.com'],
        });

        expectSuccessResult(result);
        expect(result.data.event_id).toBe('new-evt');
        expect(result.data.attendee_count).toBe(1);
        expectFetchCalledWith('calendar/v3/calendars/primary/events', 'POST');
      });
    });

    // ---- update_event ----
    describe('update_event', () => {
      it('should get existing event then PUT updated version', async () => {
        mockFetchSequence([
          // GET existing event
          {
            body: {
              id: 'evt-upd',
              summary: 'Old Title',
              start: { dateTime: '2026-04-01T09:00:00Z' },
              end: { dateTime: '2026-04-01T10:00:00Z' },
            },
          },
          // PUT updated event
          {
            body: {
              id: 'evt-upd',
              summary: 'Updated Title',
              start: { dateTime: '2026-04-01T09:00:00Z' },
              end: { dateTime: '2026-04-01T10:00:00Z' },
              htmlLink: 'https://link',
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'update_event', {
          event_id: 'evt-upd',
          summary: 'Updated Title',
        });

        expectSuccessResult(result);
        expect(result.data.summary).toBe('Updated Title');
      });
    });

    // ---- delete_event ----
    describe('delete_event', () => {
      it('should DELETE event and handle 204 No Content', async () => {
        // Calendar DELETE returns 204 with empty body; our mock returns 200 with empty body
        // The executor checks response.ok and returns structured result
        mockFetchSuccess('', 204);

        const result = await executor.executeAction(USER_ID, 'delete_event', {
          event_id: 'evt-del',
        });

        expectSuccessResult(result);
        expect(result.data.deleted).toBe(true);
        expect(result.data.event_id).toBe('evt-del');
        expectFetchCalledWith('calendar/v3/calendars/primary/events/evt-del', 'DELETE');
      });
    });

    // ---- get_event_details ----
    describe('get_event_details', () => {
      it('should return full event details', async () => {
        mockFetchSuccess({
          id: 'evt-detail',
          summary: 'Detailed Event',
          description: 'Full description',
          location: 'Office',
          start: { dateTime: '2026-04-01T09:00:00Z' },
          end: { dateTime: '2026-04-01T10:00:00Z' },
          htmlLink: 'https://calendar.google.com/event?id=evt-detail',
          attendees: [
            { email: 'a@b.com', responseStatus: 'accepted', displayName: 'Alice' },
          ],
          organizer: { email: 'org@b.com', displayName: 'Organizer' },
          status: 'confirmed',
        });

        const result = await executor.executeAction(USER_ID, 'get_event_details', {
          event_id: 'evt-detail',
        });

        expectSuccessResult(result);
        expect(result.data.summary).toBe('Detailed Event');
        expect(result.data.attendees).toHaveLength(1);
        expect(result.data.organizer.email).toBe('org@b.com');
      });
    });

    // ---- get_free_busy ----
    describe('get_free_busy', () => {
      it('should POST to /freeBusy and parse per-calendar busy intervals (start/end only)', async () => {
        mockFetchSuccess({
          calendars: {
            primary: {
              busy: [
                {
                  start: '2026-03-27T10:00:00Z',
                  end: '2026-03-27T11:00:00Z',
                  // Privacy check: even if Google ever leaked detail, the executor must drop it.
                  summary: 'SHOULD NOT LEAK',
                },
              ],
            },
          },
        });

        const result = await executor.executeAction(USER_ID, 'get_free_busy', {
          calendar_ids: ['primary'],
          time_min: '2026-03-27T00:00:00Z',
          time_max: '2026-03-28T00:00:00Z',
        });

        expectSuccessResult(result);
        expect(result.data.calendars).toHaveLength(1);
        expect(result.data.calendars[0].calendar_id).toBe('primary');
        expect(result.data.calendars[0].busy).toEqual([
          { start: '2026-03-27T10:00:00Z', end: '2026-03-27T11:00:00Z' },
        ]);
        // Privacy invariant: only start/end are surfaced — no event detail keys.
        expect(Object.keys(result.data.calendars[0].busy[0])).toEqual(['start', 'end']);
        expectFetchCalledWith('/calendar/v3/freeBusy', 'POST');
      });
    });

    // ---- list_available_slots (happy path) ----
    describe('list_available_slots', () => {
      it('should POST to /freeBusy and return computed slots', async () => {
        // Busy block on the primary calendar; the pure slot-math subtracts it.
        mockFetchSuccess({
          calendars: {
            primary: {
              busy: [{ start: '2026-08-03T14:00:00Z', end: '2026-08-03T14:30:00Z' }],
            },
          },
        });

        const result = await executor.executeAction(USER_ID, 'list_available_slots', {
          range_start: '2026-08-03T00:00:00Z',
          range_end: '2026-08-05T00:00:00Z',
          slot_duration_minutes: 30,
          working_hours: {
            time_zone: 'America/New_York',
            windows: [{ days: ['monday'], start: '09:00', end: '12:00' }],
          },
          calendar_ids: ['primary'],
        });

        expectSuccessResult(result);
        expect(Array.isArray(result.data.slots)).toBe(true);
        expect(result.data.slot_count).toBe(result.data.slots.length);
        expect(result.data.time_zone).toBe('America/New_York');
        // Every emitted slot is a UTC 'Z' instant with start/end only.
        for (const slot of result.data.slots) {
          expect(Object.keys(slot).sort()).toEqual(['end', 'start']);
          expect(slot.start.endsWith('Z')).toBe(true);
        }
        expectFetchCalledWith('/calendar/v3/freeBusy', 'POST');
      });
    });

    // ---- list_calendars ----
    describe('list_calendars', () => {
      it('should GET calendarList and map items + total_found', async () => {
        mockFetchSuccess({
          items: [
            {
              id: 'primary',
              summary: 'John Doe',
              timeZone: 'America/New_York',
              primary: true,
              accessRole: 'owner',
            },
            {
              id: 'team@example.com',
              summary: 'Team Calendar',
              timeZone: 'UTC',
              accessRole: 'reader',
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'list_calendars', {});

        expectSuccessResult(result);
        expect(result.data.total_found).toBe(2);
        expect(result.data.calendars[0].id).toBe('primary');
        expect(result.data.calendars[0].access_role).toBe('owner');
        expect(result.data.calendars[0].time_zone).toBe('America/New_York');
        expectFetchCalledWith('calendar/v3/users/me/calendarList');
      });
    });
  });

  describe('[full]', () => {
    // ---- list_events error ----
    describe('list_events', () => {
      it('should handle 400 error for invalid time format', async () => {
        mockFetchError(400, JSON.stringify({
          error: { code: 400, message: 'Invalid timeMin value', status: 'INVALID_ARGUMENT' },
        }));

        const result = await executor.executeAction(USER_ID, 'list_events', {
          time_min: 'not-a-date',
        });

        expectErrorResult(result);
      });
    });

    // ---- delete_event error ----
    describe('delete_event', () => {
      it('should handle 404 when event not found', async () => {
        mockFetchError(404, 'Not Found');

        const result = await executor.executeAction(USER_ID, 'delete_event', {
          event_id: 'nonexistent',
        });

        expectErrorResult(result);
      });
    });

    // ---- get_free_busy: auth failure + invalid input + safety (S1) + partial-error (S2) ----
    describe('get_free_busy', () => {
      it('should return an error on 401 (auth failure)', async () => {
        mockFetchError(401, { error: { code: 401, message: 'Invalid Credentials' } });

        const result = await executor.executeAction(USER_ID, 'get_free_busy', {
          calendar_ids: ['primary'],
          time_min: '2026-03-27T00:00:00Z',
          time_max: '2026-03-28T00:00:00Z',
        });

        expectErrorResult(result);
      });

      it('should reject a request missing time_max (invalid input) with no network call', async () => {
        mockFetchSuccess({ calendars: {} });

        const result = await executor.executeAction(USER_ID, 'get_free_busy', {
          calendar_ids: ['primary'],
          time_min: '2026-03-27T00:00:00Z',
        });

        expectErrorResult(result);
        // Required-param validation blocks before any fetch.
        expect(getAllFetchCalls()).toHaveLength(0);
      });

      // S1: inverted/degenerate window must be rejected BEFORE any network call.
      it('S1: rejects an inverted window (time_min >= time_max) before any fetch', async () => {
        mockFetchSuccess({ calendars: {} });

        const result = await executor.executeAction(USER_ID, 'get_free_busy', {
          calendar_ids: ['primary'],
          time_min: '2026-03-28T00:00:00Z',
          time_max: '2026-03-27T00:00:00Z',
        });

        expectErrorResult(result);
        expect(getAllFetchCalls()).toHaveLength(0);
      });

      // S2: per-calendar errors inside a 200 = PARTIAL SUCCESS — surface, do not throw.
      it('S2: surfaces per-calendar errors and busy intervals together (partial success)', async () => {
        mockFetchSuccess({
          calendars: {
            primary: {
              busy: [{ start: '2026-03-27T10:00:00Z', end: '2026-03-27T11:00:00Z' }],
            },
            'missing@example.com': {
              errors: [{ domain: 'global', reason: 'notFound' }],
            },
          },
        });

        const result = await executor.executeAction(USER_ID, 'get_free_busy', {
          calendar_ids: ['primary', 'missing@example.com'],
          time_min: '2026-03-27T00:00:00Z',
          time_max: '2026-03-28T00:00:00Z',
        });

        // Partial errors do NOT fail the action.
        expectSuccessResult(result);

        const good = result.data.calendars.find((c: any) => c.calendar_id === 'primary');
        const bad = result.data.calendars.find((c: any) => c.calendar_id === 'missing@example.com');

        expect(good.busy).toEqual([{ start: '2026-03-27T10:00:00Z', end: '2026-03-27T11:00:00Z' }]);
        expect(bad.errors).toEqual([{ domain: 'global', reason: 'notFound' }]);
      });

      // CR-4 regression: after extracting the shared fetchBusyIntervals helper,
      // get_free_busy's mapped output contract must be UNCHANGED — privacy map
      // (start/end only), per-calendar errors passthrough, and the echoed
      // window/time_zone/queried_at wrapper.
      it('CR-4 regression: get_free_busy output contract is unchanged after helper extraction', async () => {
        mockFetchSuccess({
          calendars: {
            primary: {
              busy: [
                { start: '2026-03-27T10:00:00Z', end: '2026-03-27T11:00:00Z', summary: 'LEAK' },
              ],
            },
            'missing@example.com': {
              errors: [{ domain: 'global', reason: 'notFound' }],
            },
          },
        });

        const result = await executor.executeAction(USER_ID, 'get_free_busy', {
          calendar_ids: ['primary', 'missing@example.com'],
          time_min: '2026-03-27T00:00:00Z',
          time_max: '2026-03-28T00:00:00Z',
          time_zone: 'UTC',
        });

        expectSuccessResult(result);

        const good = result.data.calendars.find((c: any) => c.calendar_id === 'primary');
        const bad = result.data.calendars.find((c: any) => c.calendar_id === 'missing@example.com');

        // Privacy invariant preserved: start/end only, no leaked detail.
        expect(good.busy).toEqual([{ start: '2026-03-27T10:00:00Z', end: '2026-03-27T11:00:00Z' }]);
        expect(Object.keys(good.busy[0])).toEqual(['start', 'end']);
        // Per-calendar errors still surfaced.
        expect(bad.errors).toEqual([{ domain: 'global', reason: 'notFound' }]);
        // Echoed wrapper + guaranteed timestamp unchanged.
        expect(result.data.time_min).toBe('2026-03-27T00:00:00Z');
        expect(result.data.time_max).toBe('2026-03-28T00:00:00Z');
        expect(result.data.time_zone).toBe('UTC');
        expect(typeof result.data.queried_at).toBe('string');
      });
    });

    // ---- list_available_slots: auth failure + invalid input ----
    describe('list_available_slots', () => {
      const validSlotParams = {
        range_start: '2026-08-03T00:00:00Z',
        range_end: '2026-08-05T00:00:00Z',
        slot_duration_minutes: 30,
        working_hours: {
          time_zone: 'America/New_York',
          windows: [{ days: ['monday'], start: '09:00', end: '17:00' }],
        },
        calendar_ids: ['primary'],
      };

      it('should return an error on 401 (auth failure)', async () => {
        mockFetchError(401, { error: { code: 401, message: 'Invalid Credentials' } });

        const result = await executor.executeAction(USER_ID, 'list_available_slots', validSlotParams);

        expectErrorResult(result);
      });

      it('should reject a request missing range_end (invalid input) with no network call', async () => {
        mockFetchSuccess({ calendars: {} });

        const { range_end, ...missingEnd } = validSlotParams;
        const result = await executor.executeAction(USER_ID, 'list_available_slots', missingEnd);

        expectErrorResult(result);
        // Pre-fetch validation blocks before any freebusy call.
        expect(getAllFetchCalls()).toHaveLength(0);
      });
    });

    // ---- list_calendars: auth failure + invalid input ----
    describe('list_calendars', () => {
      it('should return an error on 401 (auth failure)', async () => {
        mockFetchError(401, { error: { code: 401, message: 'Invalid Credentials' } });

        const result = await executor.executeAction(USER_ID, 'list_calendars', {});

        expectErrorResult(result);
      });

      // NOTE: min_access_role is a string enum, but neither the schema validator
      // (no enum check — plugin-manager-v2 validateSchema) nor the param-constraint
      // guard (invalid enum with no `default` → passthrough, never throws) rejects a
      // bad enum VALUE pre-fetch; Google enforces minAccessRole server-side (400).
      // The genuine pre-fetch invalid-input rejection available here is a TYPE
      // violation, which validateSchema does catch. (Flagged to SA.)
      it('should reject a non-string min_access_role (invalid input) with no network call', async () => {
        mockFetchSuccess({ items: [] });

        const result = await executor.executeAction(USER_ID, 'list_calendars', {
          min_access_role: 123 as any,
        });

        expectErrorResult(result);
        expect(getAllFetchCalls()).toHaveLength(0);
      });
    });

    // ---- P3-T2: Standard error scenarios ----
    runStandardErrorScenarios(
      () => executor,
      GoogleCalendarPluginExecutor,
      PLUGIN_KEY,
      'list_events',
      { time_min: '2026-03-27T00:00:00Z' }
    );

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles response missing items field', async () => {
        mockFetchSuccess({});
        const result = await executor.executeAction(USER_ID, 'list_events', {
          time_min: '2026-03-27T00:00:00Z',
        });
        expect(result).toBeDefined();
      });

      it('handles null response body', async () => {
        mockFetchSuccess(null);
        const result = await executor.executeAction(USER_ID, 'list_events', {
          time_min: '2026-03-27T00:00:00Z',
        });
        expect(result).toBeDefined();
      });
    });

    // ---- P3-T4: Authentication edge cases ----
    describe('authentication edge cases', () => {
      it('handles empty access_token', async () => {
        const ctx = await createTestExecutor(GoogleCalendarPluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });
        const result = await ctx.executor.executeAction(USER_ID, 'list_events', {
          time_min: '2026-03-27T00:00:00Z',
        });
        expectErrorResult(result);
      });
    });
  });
});
