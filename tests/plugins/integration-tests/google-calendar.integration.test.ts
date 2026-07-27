/**
 * Integration tests for GoogleCalendarPluginExecutor — Phase 1 availability actions.
 *
 * Exercises the two new read-only actions against the live Google Calendar API:
 * - list_calendars (calendarList.list)
 * - get_free_busy  (freebusy.query)
 *
 * Skips gracefully when GOOGLE_CALENDAR_TEST_TOKEN is not set.
 *
 * Requires env vars:
 * - GOOGLE_CALENDAR_TEST_TOKEN: OAuth access token (calendar scope)
 * - GOOGLE_CALENDAR_TEST_CALENDAR_ID (optional): a specific calendar to query;
 *   falls back to 'primary' when absent.
 *
 * IMPORTANT: These tests are read-only and idempotent — they never mutate the
 * user's calendar.
 */

import { GoogleCalendarPluginExecutor } from '@/lib/server/google-calendar-plugin-executor';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createTestPluginManager } from '../common/mock-plugin-manager';
import {
  describeIfCredentials,
  getTestConnection,
  getCredentials,
} from './integration-config';

const PLUGIN_KEY = 'google-calendar';
const USER_ID = 'integration-test-user';

const conditionalDescribe = describeIfCredentials(PLUGIN_KEY);

conditionalDescribe('GoogleCalendarPluginExecutor [integration]', () => {
  let executor: GoogleCalendarPluginExecutor;
  let pluginManager: PluginManagerV2;
  let targetCalendarId: string;

  beforeAll(async () => {
    pluginManager = await createTestPluginManager();
    const connection = getTestConnection(PLUGIN_KEY);
    const creds = getCredentials(PLUGIN_KEY)!;
    targetCalendarId = creds.extras.calendarId || 'primary';

    const userConnections = {
      getConnection: jest.fn().mockResolvedValue(connection),
      getConnectionStatus: jest.fn().mockResolvedValue({ connected: true, reason: 'connected' }),
      getConnectedPlugins: jest.fn().mockResolvedValue(connection ? [connection] : []),
      getConnectedPluginKeys: jest.fn().mockResolvedValue([PLUGIN_KEY]),
      getAllActivePlugins: jest.fn().mockResolvedValue(connection ? [connection] : []),
      getDisconnectedPluginKeys: jest.fn().mockResolvedValue([]),
      isTokenValid: jest.fn().mockReturnValue(true),
      shouldRefreshToken: jest.fn().mockReturnValue(false),
      refreshToken: jest.fn().mockResolvedValue(connection),
    } as any;

    executor = new GoogleCalendarPluginExecutor(userConnections, pluginManager);
  });

  describe('[smoke] list_calendars', () => {
    it('lists the user calendars and includes the primary calendar', async () => {
      const result = await executor.executeAction(USER_ID, 'list_calendars', {});

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data.calendars)).toBe(true);
      expect(result.data.total_found).toBe(result.data.calendars.length);
      // Every real account has a primary calendar.
      const primary = result.data.calendars.find((c: any) => c.primary === true);
      expect(primary).toBeDefined();
      expect(typeof primary.id).toBe('string');
      expect(typeof primary.access_role).toBe('string');
    });
  });

  describe('[smoke] get_free_busy', () => {
    it('returns per-calendar busy intervals with ONLY start/end (privacy invariant)', async () => {
      const now = new Date();
      const timeMin = now.toISOString();
      const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const result = await executor.executeAction(USER_ID, 'get_free_busy', {
        calendar_ids: [targetCalendarId],
        time_min: timeMin,
        time_max: timeMax,
        time_zone: 'UTC',
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data.calendars)).toBe(true);
      expect(result.data.calendars.length).toBeGreaterThan(0);

      for (const cal of result.data.calendars) {
        expect(typeof cal.calendar_id).toBe('string');
        expect(Array.isArray(cal.busy)).toBe(true);
        for (const interval of cal.busy) {
          // Privacy invariant: busy blocks carry start/end ONLY — no event detail.
          expect(Object.keys(interval).sort()).toEqual(['end', 'start']);
          expect(typeof interval.start).toBe('string');
          expect(typeof interval.end).toBe('string');
        }
      }
    });
  });

  describe('[full] get_free_busy safety', () => {
    it('rejects an inverted time window without querying the API', async () => {
      const result = await executor.executeAction(USER_ID, 'get_free_busy', {
        calendar_ids: [targetCalendarId],
        time_min: '2026-03-28T00:00:00Z',
        time_max: '2026-03-27T00:00:00Z',
      });

      expect(result.success).toBe(false);
    });
  });
});
