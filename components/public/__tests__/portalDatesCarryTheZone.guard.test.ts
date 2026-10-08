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

/** Each portal file that formats a date, and what the zone must come from. */
const SURFACES: Array<{ file: string; zone: RegExp }> = [
  // The meetings rail — the list that disagreed with the contact drawer.
  { file: 'components/public/PortalMeetings.tsx', zone: /timeZone\s*\)/ },
  // The appointment card: the date must use the same zone as the time beside it.
  { file: 'components/public/AppointmentCard.tsx', zone: /undefined,\s*timeZone\s*\)/ },
  // The portal header's "next is …" subtitle.
  { file: 'app/book/manage/[token]/page.tsx', zone: /undefined,\s*booking\.timezone\s*\)/ },
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

  it('a due date is pinned to UTC, not to the business zone', () => {
    /*
     * `due_date` is a SQL DATE. The business's zone fixes it east of UTC and
     * breaks it west; UTC is right everywhere because UTC is what it was
     * written as. Asserted separately so a well-meaning sweep that "makes them
     * all consistent" fails here instead of shipping.
     */
    const card = read('components/public/AppointmentCard.tsx');

    expect(card).toMatch(/payment\.dueDate\)[\s\S]{0,160}'UTC'/);
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
