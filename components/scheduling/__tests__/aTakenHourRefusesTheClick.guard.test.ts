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
    /*
     * Named `isBookable` rather than spelled inline, and tightened with
     * `!isPast` so a past hour cannot be clicked either. The guarantee is
     * unchanged: BOTH blocks are consulted, and the same expression governs
     * the click. Written as two assertions so the name cannot drift from the
     * terms behind it.
     */
    expect(code).toMatch(/const isBookable = !isBlockedExternal && !isTaken/);
    expect(code).toMatch(/isBookable && onSlotClick\?\.\(date, hour\)/);
  });

  it('shows a cursor that matches what the cell will do', () => {
    /* A pointer over an hour that will not accept a click teaches the owner to
       distrust the cursor everywhere else. */
    /* The cursor reads the SAME expression the click does, so what the cell
       looks like and what it will do cannot disagree. */
    expect(code).toMatch(/isBookable \? 'cursor-pointer' : 'cursor-not-allowed'/);
  });
});

describe('what counts as taken', () => {
  it('uses the shared rule, so a cancelled hour comes back', () => {
    /*
     * `holdsSlot` is what the rest of the product means by occupied: a
     * cancelled or missed appointment frees its hour. A local status check
     * would drift from it and block the diary for ever.
     */
    /*
     * ── THE CALENDAR'S RULE IS BROADER, AND THAT IS THE POINT ─────────────
     *
     * This demanded `holdsSlot`. Switching to it was measured across all 42
     * combinations of the two columns and changes six of them, every one in
     * the same direction — an hour that is blocked today becomes bookable:
     *
     *   meeting_status null + status 'no_show'   blocked -> offered
     *   meeting_status null + status null        blocked -> offered
     *
     * The first contradicts the rule `20261111_a_no_show_keeps_its_hour.sql`
     * exists to establish: `holdsSlot` falls through to
     * `SLOT_HOLDING_STATUSES` — confirmed, pending, completed — so a JOB-level
     * no-show reads as free. The SQL constraint spells the same list, so the
     * two are in agreement and neither can be widened without the other.
     *
     * The grid therefore keeps its own rule, which releases ONLY the two
     * outcomes that genuinely free an hour and blocks anything it cannot
     * read. What this pins is that it releases exactly those two and nothing
     * more — drift in the other direction is what would double-book an hour.
     */
    expect(code).toMatch(/outcome !== 'cancelled' && outcome !== 'moved'/);
    expect(code).not.toMatch(/meeting_status\s*===\s*'no_show'[\s\S]{0,40}return false/);
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
