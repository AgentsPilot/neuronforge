/**
 * Which bookings count as "appointments today", and which deliberately do not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A product decision, not an implementation detail:
 *
 *   cancelled  OUT — the slot was handed back. Counting it would fill the day
 *              with work that will not happen.
 *   no_show    IN  — the client DID book. The hour was held and it is gone.
 *
 * The same line the verdict card already draws — see
 * `app/api/business-os/stats/__tests__/bookedThisWeek.guard.test.ts`, decided
 * with the owner on 2026-09-23 against live data.
 *
 * The briefing drew it differently, and nothing caught that until the no-show
 * fact was added. 2026-09-27 on a real account held a cancellation at 09:00, a
 * no-show at 09:30 and a finished session at 11:00, and the brief read:
 *
 *     One appointment today: אופיר עומר at 11:00, already done.
 *     אופיר עומר didn't turn up.
 *
 * Two lines that are individually true and together say the 11:00 was the one
 * nobody attended.
 *
 * A SOURCE-LEVEL GUARD: the partition sits inside a function that needs the
 * bookings repository, the invoice repository, the payment tables and the gap
 * registry mocked before it will run. This cannot prove the count is right; it
 * can prove nobody quietly changed which statuses make it up.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(join(__dirname, '..', 'BriefingFactsService.ts'), 'utf8');

/** The one line that decides what `total` counts. */
const liveLine = source.split('\n').find(line => line.includes('const live = ['));

describe("the day's appointment count", () => {
  it('has the line this guard is about', () => {
    expect(liveLine).toBeDefined();
  });

  it('counts a no-show, because the client booked', () => {
    expect(liveLine).toContain('noShows');
  });

  it('never counts a cancellation', () => {
    // The slot came back. A briefing that counted it would describe a day the
    // owner does not have.
    expect(liveLine).not.toContain('cancelled');
  });

  it('keeps a no-show out of the finished count', () => {
    /*
     * `completed` is what happened, and a no-show did not happen. It reaches
     * the reader as its own line — "somebody didn't turn up" — which is
     * different news from a session that ran.
     */
    const doneLine = source.split('\n').find(line => line.includes('const done = rows.filter'));
    expect(doneLine).toContain("'completed'");
    expect(doneLine).not.toContain('no_show');
  });

  it('keeps a no-show out of the ready count', () => {
    // `ready` means nothing is outstanding on an appointment still to come.
    // Nothing is outstanding on one that is already over, either way.
    const readyLine = source.split('\n').find(line => line.includes('const ready = '));
    expect(readyLine).toContain('confirmed.length');
  });
});
