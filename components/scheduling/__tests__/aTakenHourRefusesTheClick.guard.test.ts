/**
 * The calendar does not offer an hour that is already somebody's.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER DID
 *
 * Clicked 10:00 on Tuesday 10 November in their own calendar, chose a service,
 * chose a client, pressed Create, and was told:
 *
 *     This time overlaps an existing booking
 *
 * It did. The public booking page for that day starts its list at 11:30,
 * because 10:00 was taken — the client-facing surface knew and the owner's did
 * not. Three steps of work, then a refusal that was right from the first
 * click.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE CELL LET IT THROUGH
 *
 * One condition guarded the click, and it was about the owner's OTHER calendar:
 *
 *     onClick={() => !isBlockedExternal && onSlotClick?.(date, hour)}
 *
 * An hour holding one of our own bookings had nothing stopping it and looked
 * identical to a free one. `isHourAvailable` sat two lines above, computed and
 * unused for this — and it answers a different question anyway: whether the
 * hour is inside the working day, not whether anyone is in it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS
 *
 * That occupancy is consulted, that it uses the shared `holdsSlot` rule so a
 * cancelled appointment gives its hour back, and that the cursor agrees with
 * the behaviour — a pointer over an hour that refuses the click is its own
 * small lie.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SOURCE = 'components/scheduling/SchedulingCalendarView.tsx';

const source = fs
  .readFileSync(path.join(process.cwd(), SOURCE), 'utf8')
  .replace(/\r\n/g, '\n');

/** Comments stripped: this file asserts on code, and the prose repeats it. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the click is refused on a taken hour', () => {
  it('asks whether the hour is taken at all', () => {
    /* THE BUG, AS ONE ASSERTION. Nothing used to ask. */
    expect(code).toContain('const isHourTaken = (date: Date, hour: number): boolean =>');
  });

  it('guards the click with it, beside the external-calendar guard', () => {
    expect(code).toMatch(/!isBlockedExternal && !isTaken && onSlotClick\?\.\(date, hour\)/);
  });

  it('shows a cursor that matches what the cell will do', () => {
    /* A pointer over an hour that will not accept a click teaches the owner to
       distrust the cursor everywhere else. */
    expect(code).toMatch(/isBlockedExternal \|\| isTaken\s*\n?\s*\?\s*'cursor-not-allowed'/);
  });
});

describe('what counts as taken', () => {
  it('uses the shared rule, so a cancelled hour comes back', () => {
    /*
     * `holdsSlot` is what the rest of the product means by occupied: a
     * cancelled or missed appointment frees its hour. A local status check
     * would drift from it and block the diary for ever.
     */
    expect(code).toContain("import { holdsSlot } from '@/lib/business-os/bookingStatus'");
    expect(code).toMatch(/if \(!holdsSlot\(booking\)\) return false;/);
  });

  it('overlaps the way the server does, not by equal start times', () => {
    /* A 90-minute booking at 09:30 occupies the 10:00 cell. Comparing start
       times alone would miss it and reopen the whole defect. */
    expect(code).toMatch(/start < cellEnd\.getTime\(\) && end > cellStart\.getTime\(\)/);
  });

  it('ignores a booking whose times cannot be read', () => {
    /* An unparseable date must not silently block an hour. */
    expect(code).toMatch(/Number\.isNaN\(start\) \|\| Number\.isNaN\(end\)/);
  });

  it('is not confused with being inside working hours', () => {
    /*
     * `isHourAvailable` answers "is this within the hours they keep" and is
     * deliberately NOT the guard: an owner booking outside their usual hours
     * is ordinary, and blocking that would be a worse bug than the one fixed.
     */
    expect(code).not.toMatch(/!isAvailable && onSlotClick/);
  });
});
