/**
 * A booking with no date still has something to lead with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The portal's lead tile is built around the day of the month: a 6xl numeral,
 * the full date under it, the hours under that. All three are correctly gated
 * on `start`, because a product purchase has no date and must not be given one.
 *
 * What nothing supplied was a replacement. A booking with `start_time: null` —
 * a product, or a payment plan bought on its own — rendered none of the three
 * and fell straight through to the facts list, so the largest thing on the card
 * was the status chip and the card read as half loaded beside any dated
 * booking. Reported from a live portal as "the booking card info is not like
 * other bookings".
 *
 * Nothing errored and nothing was missing: every field the card had was drawn.
 * The card just had no subject.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO HALVES THAT HAVE TO STAY TOGETHER
 *
 * The service becomes the lead where there is no date, AND stops being a row
 * in the facts list below — or the card states the same name twice, once as a
 * heading and once as a fact, which is the other way this reads as broken.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const page = fs.readFileSync(
  path.join(process.cwd(), 'app/book/manage/[token]/page.tsx'),
  'utf8'
);

/** Comments explain the fix; only code can undo it. */
const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('an undated booking leads with what it is for', () => {
  it('names the service where the date would be', () => {
    expect(code).toMatch(
      /\{!showDate && subjectService && \([\s\S]{0,400}<bdi>\{subjectService\}<\/bdi>/
    );
  });

  it('does not then repeat it as a fact', () => {
    // `showDate &&`, not a bare truthiness check: the row is for the bookings
    // that lead with a date, where the name is not already the heading.
    expect(code).toMatch(/\{showDate && subjectService && \(/);
  });

  it('still refuses to invent a date', () => {
    /*
     * The half that must not change. The numeral, the date and the hours stay
     * gated — a product given a date would be the page telling a client to
     * turn up to something that was never scheduled.
     */
    expect(code).toMatch(/\{showDate && \(\s*<>/);
  });

  it('reads one subject, so the card cannot describe two bookings', () => {
    /*
     * A package session HAS a date, and the lead card must not use it: the
     * subject is the booking the package was SOLD from, which the route
     * resolves through `proposals.package_booking_id`. Every field on the
     * card comes off that one subject — date, zone, service, duration,
     * status — because taking the date from one booking and the status from
     * another is exactly what produced "23 October" above a list of all six
     * sessions.
     */
    expect(code).toMatch(/const subject = booking\.parent \?\? null;/);
    for (const field of ['subjectZone', 'subjectService', 'subjectDuration', 'subjectStatus']) {
      expect(code).toContain(field);
    }
    expect(code).toMatch(/const showDate = start !== null;/);
  });
});
