/**
 * Unit tests for GoogleCalendarPluginExecutor — 5 actions
 */

import { GoogleCalendarPluginExecutor } from '@/lib/server/google-calendar-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult, expectFetchCalledWith } from '../common/test-helpers';
import { mockFetchSuccess, mockFetchError, mockFetchSequence, restoreFetch } from '../common/mock-fetch';
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
