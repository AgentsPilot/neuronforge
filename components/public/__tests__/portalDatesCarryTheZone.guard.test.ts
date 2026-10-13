/**
 * Every portal surface that prints a date prints it on a named clock.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD AS WELL AS THE BEHAVIOURAL ONE
 *
 * `publicDateOnBusinessClock.test.ts` proves `formatPublicDate` honours the
 * zone it is handed. It cannot prove anybody hands it one — and that was the
 * entire bug. The zone was always available: `PortalRail` already held it and
 * passed it to its other child, `AppointmentCard` already used it for the TIME
 * one row under the date, and the reschedule page already passed it and
 * commented why. Five call sites simply omitted it.
 *
 * So the thing to hold is not "the formatter works". It is "no portal date is
 * formatted without a zone", and that is a property of the call sites.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE DELIBERATE OMISSION
 *
 * `reschedule/page.tsx` has a second call, `formatDisplayDate`, which builds
 * `new Date(\`${dateStr}T12:00:00\`)` from a day the client tapped in a calendar
 * grid. That is a CALENDAR DAY, anchored at local noon precisely so no zone can
 * move it, and pinning a zone onto it would reintroduce the shift it is written
 * to avoid. It is excluded by name rather than by accident.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/**
 * The file with its comments removed.
 *
 * The prose in these files discusses UTC at length — it has to, to explain why
 * the dates are formatted the way they are — so a search for the string would
 * match the explanation and never reach the code.
 *
 * Block comments first, then line comments, and the line pass deliberately
 * requires whitespace or a line start before the `//`: a `//` inside a URL or
 * inside `'https://…'` is not a comment, and eating from there to the end of
 * the line has already swallowed working code in a sibling guard.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;,({[])\/\/[^\n]*/g, '$1');

/** Each portal file that formats a date, and what the zone must come from. */
const SURFACES: Array<{ file: string; zone: RegExp }> = [
  // The meetings rail — the list that disagreed with the contact drawer.
  { file: 'components/public/PortalMeetings.tsx', zone: /timeZone\s*\)/ },
  // The appointment card: the date must use the same zone as the time beside it.
  { file: 'components/public/AppointmentCard.tsx', zone: /undefined,\s*timeZone\s*\)/ },
  // The portal header's "next is …" subtitle.
  /*
   * `subjectZone`, not `booking.timezone`: for a package session the card
   * describes the booking the package was SOLD from, and its clock has to come
   * off the same booking as its date. Reading this session's zone put one
   * booking's hours under another booking's date — and did it visibly, on a
   * package whose second session had been rescheduled into UTC.
   */
  { file: 'app/book/manage/[token]/page.tsx', zone: /undefined,\s*subjectZone\s*\)/ },
];

describe('portal dates are formatted on a named clock', () => {
  it.each(SURFACES)('$file passes a zone to formatPublicDate', ({ file, zone }) => {
    expect(read(file)).toMatch(zone);
  });

  it('the rail actually receives the zone it needs', () => {
    /*
     * `PortalMeetings` cannot pass a zone it was never given, and this is the
     * handoff that was missing — the prop existed on `PortalRail` and went to
     * `BusinessInfoPanel` only.
     */
    /*
      The handoff moved. `PortalRail` grouped these cards into a sidebar and
      passed the zone down; the portal index renders them itself now, in its
      own two columns, so it is the file that has to pass it.
    */
    expect(read('app/book/manage/[token]/page.tsx')).toMatch(
      /<PortalMeetings[^>]*timeZone=\{portal\.timeZone\}/
    );
  });

  it('a due date goes through the DAY formatter, which takes no zone', () => {
    /*
     * `due_date` is a SQL DATE — a day, with no time and no zone in it.
     *
     * This used to assert `'UTC'`, because pushing the value through
     * `new Date(...)` invents midnight UTC and the zone argument undid the
     * invention. It worked, but UTC is an artefact of the parse rather than
     * the day's clock, and it put UTC into a surface whose rule is that every
     * date and time a client reads is the business's.
     *
     * `formatPublicDay` reads the parts and constructs no instant, so there is
     * no clock to get wrong. Asserted separately from the instants below so a
     * sweep that "makes them all consistent" by handing this one a zone fails
     * here instead of shipping a deadline that is a day out.
     */
    const card = read('components/public/AppointmentCard.tsx');

    expect(card).toMatch(/formatPublicDay\(payment\.dueDate/);
    expect(card).not.toMatch(/payment\.dueDate[\s\S]{0,160}'UTC'/);
  });

  it('no client-facing portal file names UTC at all', () => {
    /*
     * The standing rule: a client reads the BUSINESS's clock, never UTC.
     *
     * `ReschedulePanel` is in here by name — it defaulted its zone state to
     * `'UTC'`, and because the zone is only set `if (booking.timezone)`, a
     * booking that never captured one kept the default and the page told the
     * client "times shown in UTC" about hours that were not.
     */
    for (const file of [
      'components/public/AppointmentCard.tsx',
      'components/public/ReschedulePanel.tsx',
      'app/book/manage/[token]/page.tsx',
    ]) {
      expect(code(read(file))).not.toMatch(/'UTC'/);
    }
  });

  it('no portal file formats a date with no third or fourth argument at all', () => {
    /*
     * The shape of the original defect: `formatPublicDate(start, locale)` and
     * nothing more. Legal, compiles, and silently uses the reader's clock.
     *
     * Excludes the calendar-day call documented in this file's header, which
     * takes its options but deliberately takes no zone.
     */
    for (const file of [
      'components/public/PortalMeetings.tsx',
      'components/public/AppointmentCard.tsx',
      'app/book/manage/[token]/page.tsx',
    ]) {
      expect(read(file)).not.toMatch(/formatPublicDate\([^,]+,\s*[A-Za-z.]+\s*\)/);
    }
  });
});
