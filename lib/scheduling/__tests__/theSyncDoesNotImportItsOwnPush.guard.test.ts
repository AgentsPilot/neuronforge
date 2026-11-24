/**
 * The calendar sync does not import the events it just exported.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW IT WAS FOUND, WHICH IS THE INTERESTING PART
 *
 * An owner pointed at a grey "busy" band on their diary and asked: "is this
 * from the synced calendar or the platform meeting?" For the band they were
 * pointing at the answer was the synced calendar — a genuine Google event
 * called "Quotation Offering time" that no booking here had ever touched.
 *
 * But the question was better than the example. Checking it turned up a
 * DIFFERENT appointment on the same account that really was both:
 *
 *   "Clean office multi payment based invoice  - Tal Omer", 23 Nov 08:15Z
 *     · `scheduling_bookings` 494bc8cd — the owner's own appointment
 *     · `external_calendar_events` anogmsqsu5nv… — the same hour, again
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LOOP
 *
 * The sync runs both ways and the two halves did not know about each other:
 *
 *   PUSH  a booking made here is written to the owner's Google or Outlook
 *         calendar, and the id it comes back with is kept on the booking — or,
 *         for a package, on each session in `scheduling_meetings`
 *   PULL  every blocking event in that calendar is imported into
 *         `external_calendar_events`
 *
 * Nothing in the pull excluded what the push had put there. So an appointment
 * came home as if it were somebody else's commitment, and was drawn a second
 * time as a grey band over the very card that created it. Availability counted
 * the hour twice for the same reason, which is the half nobody can see.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SKIPPING IS RIGHT, AND WHY IT DOES NOT FREE THE HOUR
 *
 * `external_calendar_events` has exactly one job — "is this hour taken by
 * something OTHER than this product". The booking itself already holds its
 * hour, through `scheduling_meetings`, which is what availability reads first.
 * Importing our own event adds nothing and asserts the hour twice.
 *
 * Skipping rather than storing-and-ignoring also repairs the table: the sync
 * deletes every stored event missing from the pass, so rows already duplicated
 * disappear on the next run with no cleanup to write. That is the same shape
 * the `blocksTime` skip above it uses, deliberately.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const SERVICE = 'lib/services/CalendarSyncService.ts';
const SCHEDULING = 'lib/repositories/SchedulingRepository.ts';

/** Source with comments removed, so these notes cannot satisfy a match. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the pull knows what the push wrote', () => {
  const service = code(read(SERVICE));

  it('asks which events are ours before importing any', () => {
    expect(service).toContain('getOwnCalendarEventIds(userId)');
  });

  it('and skips them', () => {
    expect(service).toContain('if (ownEventIds.has(eventId)) {');
  });

  it('before the row is built, not after', () => {
    /* After `eventsToUpsert.push` the duplicate is already written; after
       `newEventIds.add` it also survives the delete pass, which is what would
       make the row permanent. */
    const loop = service.slice(
      service.indexOf('for (const event of externalEvents) {'),
      service.indexOf('if (ours > 0) {')
    );

    expect(loop.indexOf('if (ownEventIds.has(eventId)) {')).toBeLessThan(
      loop.indexOf('newEventIds.add(eventId);')
    );
    expect(loop.indexOf('if (ownEventIds.has(eventId)) {')).toBeLessThan(
      loop.indexOf('eventsToUpsert.push(')
    );
  });

  it('by skipping, so the rows already duplicated are deleted on the next run', () => {
    /*
     * The self-repair, and it only works because the skip keeps the id OUT of
     * `newEventIds`. A fix that imported-then-filtered-on-read would leave
     * every existing duplicate in the table for ever.
     */
    expect(service).toContain('const eventsToRemove = Array.from(existingEventIds).filter(id => !newEventIds.has(id));');
  });

  it('and says so in the log, rather than silently dropping them', () => {
    /* A sync that quietly imports fewer events than the calendar holds is
       indistinguishable from a broken sync when somebody comes to read it. */
    expect(service).toMatch(/logger\.info\([\s\S]{0,120}ours[\s\S]{0,200}pushed were not re-imported/);
  });
});

describe('what counts as ours', () => {
  const scheduling = code(read(SCHEDULING));

  const method = scheduling.slice(
    scheduling.indexOf('async getOwnCalendarEventIds('),
    scheduling.indexOf('async getBookingsWithCalendarEvents(')
  );

  it('both tables, because a package keeps its hours on its sessions', () => {
    /*
     * A single-session booking carries its own event id; a package carries one
     * per session and none on the container. Reading only `scheduling_bookings`
     * would leave every package session duplicating itself — which is the
     * majority of this owner's synced appointments.
     */
    expect(method).toContain("from('scheduling_bookings')");
    expect(method).toContain("from('scheduling_meetings')");
  });

  it('scoped to the owner, both times', () => {
    /* CLAUDE.md rule 4. A missing filter here would let one business's event
       ids suppress another's imports. */
    expect((method.match(/\.eq\('user_id', userId\)/g) ?? []).length).toBe(2);
  });

  it('and only rows that actually carry one', () => {
    expect((method.match(/\.not\('external_calendar_event_id', 'is', null\)/g) ?? []).length).toBe(2);
  });

  it('returned as a set, which is what the loop tests against', () => {
    expect(method).toContain('const ids = new Set<string>();');
  });

  it('and a failure to read it does not suppress the whole sync', () => {
    /*
     * An empty set means "none of these are ours", so a transient failure
     * imports the duplicates again — annoying, self-correcting, and far better
     * than a sync that stops. `?? new Set<string>()` is that choice; a throw
     * here would take the whole pull down.
     */
    const service = code(read(SERVICE));
    expect(service).toContain('?? new Set<string>()');
  });
});
