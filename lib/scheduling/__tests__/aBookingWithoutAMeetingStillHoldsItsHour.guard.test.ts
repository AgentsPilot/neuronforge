/**
 * A booking with no meeting row still holds its hour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT HAPPENED
 *
 * `busyMeetings` reads `scheduling_meetings`, on a stated assumption: a
 * slot-holding booking always has a meeting, so reading one is reading the
 * other. That was measured true at the time — "zero disagreements with
 * holdsSlot(), and zero in the future".
 *
 * It stopped being true. Measured 2026-10-26: booking 5160bd88, `confirmed`,
 * 09:00 local on the 28th, with no row in `scheduling_meetings` at all. The
 * planner could not see it, so the owner's dialog offered that hour as free —
 * and the slot suggester went further and RECOMMENDED it, "the hour Tal chose
 * in the previous 2 meetings · opens a new day in an empty calendar".
 *
 * The owner picked it and the save was refused, because
 * `scheduling_bookings_no_overlap` reads the BOOKING's own columns and needs
 * no meeting to exist. So the database was right and the planner was wrong,
 * which is the one shape `busyMeetings` names as unacceptable: "a slot wrongly
 * free is two clients in one room".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS
 *
 * That the reader asks the BOOKINGS too, with the constraint's own predicate.
 * The constraint's comment requires it to stay in step with `holdsSlot()` and
 * `MEETING_HOLDS_SLOT_FILTER`; nothing enforced the reverse direction, so this
 * does.
 *
 * Source-level, like its sibling `busyMeetings.guard`: the behaviour needs a
 * database to exercise and the predicate is what drifts.
 */

import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const busy = read('lib/scheduling/busyMeetings.ts');
const constraint = read('supabase/migrations/20261084_no_overlap_reads_the_meeting.sql');

/** Comments stripped, so prose about the rule is never mistaken for the rule. */
const code = busy.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the reader asks the bookings, not only the meetings', () => {
  it('reads scheduling_bookings as well', () => {
    expect(code).toContain("from('scheduling_bookings')");
  });

  it('keeps only the bookings that have no meeting', () => {
    /*
     * The embedded relation is what distinguishes them. Counting every
     * slot-holding booking would double every ordinary appointment — harmless
     * for an overlap test, but it would also override a MOVED meeting, whose
     * hour differs from the booking row it belongs to.
     */
    expect(code).toContain('scheduling_meetings(id)');
    expect(code).toMatch(/scheduling_meetings.*\?\?\s*\[\]\).length/s);
  });
});

describe('it uses the constraint’s predicate, not one of its own', () => {
  it('the same three statuses', () => {
    expect(code).toContain("'confirmed', 'pending', 'completed'");
    expect(constraint).toContain("status IN ('confirmed', 'pending', 'completed')");
  });

  it('NULL or held, and never written as a NOT IN', () => {
    /*
     * `NULL NOT IN (…)` is NULL in SQL and `null` fails an inequality in
     * PostgREST just as quietly: written the other way, every unmarked future
     * appointment would vanish and the whole diary would read as free. The
     * sibling guard pins this for the meetings filter; this is the booking one.
     */
    expect(code).toContain('meeting_status.is.null,meeting_status.eq.held');
    expect(code).not.toMatch(/meeting_status.*not\.in/);

    expect(constraint).toContain("meeting_status IS NULL OR meeting_status = 'held'");
  });

  it('honours the same exclusion the meetings query does', () => {
    /* Rescheduling reads the diary while its own hour is in it. Without this
       the booking being edited blocks the only slot the owner wants. */
    expect(code).toMatch(/orphans = orphans\.neq\('id', excludeBookingId\)/);
  });
});

describe('a failure here frees nothing', () => {
  it('falls back to the meetings rather than to an empty diary', () => {
    /*
     * Returning [] on this read would report every hour free — the exact fault
     * being fixed, arrived at from the other side. The meetings are already a
     * correct answer for every booking that has one.
     */
    const branch = code.slice(code.indexOf('bookingError'), code.indexOf('withoutMeeting'));
    expect(branch).toContain('return meetings;');
    expect(branch).not.toMatch(/return\s*\[\]/);
  });
});
