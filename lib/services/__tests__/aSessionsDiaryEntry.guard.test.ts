/**
 * One session, one entry in the owner's diary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT GOES WRONG WITHOUT THIS
 *
 * A package is one booking with N meetings. The booking has ONE set of calendar
 * columns, so six sessions syncing through it leave the sixth event id on the
 * row and nothing recorded for the other five — and the next sync, finding no
 * event for them, creates them all again. Six appointments, twelve entries.
 *
 * And `calendar_sync_provider` was missing from `scheduling_meetings` until
 * 20261087, so a session's event could be CREATED and never changed: both the
 * update and the delete look the event up by provider. Moving a session left a
 * stale entry at the old hour while the client had been told a new one;
 * cancelling one left all six standing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');

const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const sync = code('lib/services/CalendarSyncService.ts');

/** One method's body, by the next `async ` at method indentation. */
const method = (name: string) => {
  const from = sync.indexOf(`async ${name}(`);
  const rest = sync.slice(from + 1);
  const to = rest.indexOf('\n  async ');
  return to === -1 ? rest : rest.slice(0, to);
};

describe('every path can be pointed at a session instead of a booking', () => {
  for (const name of ['syncBookingToCalendar', 'updateCalendarEvent', 'deleteCalendarEvent']) {
    it(`${name} takes the meeting`, () => {
      /*
       * All three, not just create. An event that can be made and not changed
       * is worse than one that was never made: it sits in the diary at an hour
       * nobody is coming to.
       */
      expect(method(name)).toMatch(/meeting(Id)?\??:/);
    });
  }

  it('reads the event off the meeting where there is one', () => {
    /* The booking carries no event id for a package, so looking there finds
       nothing and the update quietly does nothing. */
    expect(method('updateCalendarEvent')).toContain('meeting ?? booking');
    expect(method('deleteCalendarEvent')).toContain('meeting ?? booking');
  });

  it('records the event on the meeting, not on the booking', () => {
    /* Six events writing to one column keep only the last. */
    expect(method('syncBookingToCalendar')).toContain('updateMeetingCalendarSync');
  });

  it('records WHICH calendar wrote it', () => {
    /*
     * The update and delete paths look the event up by provider. Without it
     * recorded, a session's event could be created and then never touched —
     * which is exactly what 20261087 added the column for.
     */
    expect(method('syncBookingToCalendar')).toContain('calendar_sync_provider: provider');
  });

  it('clears it off the meeting when the event is deleted', () => {
    /*
     * Clearing the BOOKING's columns for a session would say the package has
     * no events at all, and the next sync would create five duplicates.
     */
    const del = method('deleteCalendarEvent');
    expect(del).toContain('updateMeetingCalendarSync');
    expect(del).toContain('external_calendar_event_id: null');
  });

  it('leaves an ordinary booking exactly as it was', () => {
    /* One booking, one appointment, one event, recorded where it always was. */
    expect(method('syncBookingToCalendar')).toContain('updateCalendarSync');
    expect(method('deleteCalendarEvent')).toContain('clearCalendarSync');
  });
});

describe('the migration that made it possible', () => {
  const sql = read('supabase/migrations/20261087_moving_a_meeting_is_one_step.sql');

  it('adds the provider column a session needs', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS calendar_sync_provider');
  });
});

describe('a moved session keeps ONE entry, at the new hour', () => {
  const route = code('app/api/scheduling/meetings/[id]/reschedule/route.ts');

  it('updates the existing event rather than creating a second', () => {
    /* Creating one would leave the hour the client was moved off sitting in
       the diary forever. */
    expect(route).toContain('updateCalendarEvent');
  });

  it('carries the event onto the attempt that now holds the hour', () => {
    /*
     * The event belongs to the appointment, not to the attempt. Left on the
     * superseded row, the NEXT move would find no event and create a second
     * entry.
     */
    const after = route.slice(route.indexOf('updateCalendarEvent'));
    expect(after).toContain('updateMeetingCalendarSync(newMeetingId');
    expect(after).toContain('external_calendar_event_id: null');
  });
});
