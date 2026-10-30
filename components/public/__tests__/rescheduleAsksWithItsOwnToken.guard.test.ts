/**
 * A client rescheduling is not asked to sign in as the business.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported as "in some cases the open hours are not showing up, no hours
 * available", and the "some cases" is the whole diagnosis.
 *
 * The panel asked `website/scheduling/availability` with a service id and a
 * date and nothing else. That endpoint resolves the business three ways:
 *
 *     subdomain  →  the public site
 *     user_code  →  a smart link
 *     neither    →  getUser(), the SIGNED-IN USER
 *
 * A client following their own booking link is signed in as nobody, so they
 * were answered 401. The panel then rendered a refusal and a genuinely full
 * diary identically, under a comment that said so outright: "No slots is a
 * legitimate answer; a failed lookup renders the same way."
 *
 * The owner, testing in a browser already signed in to their own account, saw
 * slots every single time. That is why it looked intermittent instead of
 * broken for every client who ever tried.
 *
 * Two things fix it and both are pinned here: ask the route that already holds
 * the client's credential, and stop drawing a failure as an answer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/** Comments stripped: these files necessarily quote what they forbid. */
const strip = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const panel = strip(read('components/public/ReschedulePanel.tsx'));
const route = strip(read('app/api/book/manage/[token]/reschedule/route.ts'));
const shared = strip(read('lib/scheduling/availableSlots.ts'));

describe('where the portal gets its times', () => {
  it('asks the route the booking token authenticates', () => {
    expect(panel).toMatch(/\/api\/book\/manage\/\$\{token\}\/reschedule\?date=/);
  });

  it('never asks the anonymous endpoint, which would want a session', () => {
    /*
     * The exact call that produced the bug. The endpoint is fine; asking it
     * from a page whose visitor is not the business is not.
     */
    expect(panel).not.toMatch(/website\/scheduling\/availability/);
  });

  it('tells a failure apart from a day with nothing free', () => {
    /* Trying again is right for one and useless for the other. */
    expect(panel).toMatch(/setSlotsFailed\(true\)/);
    expect(panel).toMatch(/slotsFailed \?/);
    expect(panel).toMatch(/timesCouldNotLoad/);
    expect(panel).toMatch(/noTimesAvailable/);
  });
});

describe('what the token route answers with', () => {
  it('computes the day from the booking owner, not from a caller', () => {
    expect(route).toMatch(/businessProfileRepository\.findByUserId\(booking\.user_id\)/);
  });

  it('runs the same pipeline the public booking page runs', () => {
    /*
     * Windows, less time off, less what is booked, less the external calendar.
     * Two implementations of "what can be booked" would eventually offer an
     * hour the business then refuses, which is worse than offering none.
     */
    expect(route).toMatch(/windowsForDate\(/);
    expect(route).toMatch(/schedulingTimeOffRepository\.list\(/);
    expect(route).toMatch(/busyMeetings\(/);
    expect(route).toMatch(/externalCalendarEventRepository\.getBusySlots\(/);
    expect(route).toMatch(/generateTimeSlots\(/);
  });

  it('validates the date rather than interpolating it', () => {
    /* It reaches a date constructor and a range query. */
    expect(route).toMatch(/\\d\{4\}-\\d\{2\}-\\d\{2\}/);
  });

  it('does no diary work for a day nobody has chosen', () => {
    expect(route).toMatch(/requestedDate \? await slotsForDate\(requestedDate\) : undefined/);
  });
});

describe('the trap that hid this', () => {
  const publicRoute = strip(read('app/api/website/scheduling/availability/route.ts'));

  it('says what it could not identify, rather than a bare Unauthorized', () => {
    /*
     * The fallback to the signed-in user is correct for the owner's own
     * screens and a trap for anything public. It stays, because those screens
     * legitimately ask "what are MY hours" with no identifier.
     *
     * What it may not do again is refuse in a way nobody can read. A bare 401
     * is why a client-facing panel showed an empty diary for months while the
     * owner, signed in, saw slots every time.
     */
    expect(publicRoute).toMatch(/no_business_identified/);
    expect(publicRoute).toMatch(/needs a subdomain or a user_code/);
  });

  it('still serves the owner with no identifier at all', () => {
    /* The behaviour this guard must not tighten: the CRM, the scheduling page
       and the configuration dialog all ask without one. */
    expect(publicRoute).toMatch(/ownerId = user\.id;/);
  });
});

describe('the slot maths lives in one place', () => {
  it('is a module both routes import, not a copy in each', () => {
    expect(shared).toMatch(/export function generateTimeSlots\(/);

    const publicRoute = strip(read('app/api/website/scheduling/availability/route.ts'));
    expect(publicRoute).toMatch(/from '@\/lib\/scheduling\/availableSlots'/);
    expect(route).toMatch(/from '@\/lib\/scheduling\/availableSlots'/);

    /* And neither kept its own. */
    expect(publicRoute).not.toMatch(/^function generateTimeSlots\(/m);
    expect(route).not.toMatch(/^function generateTimeSlots\(/m);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AND A DAY THE BUSINESS IS CLOSED IS NOT OFFERED
 *
 * The purchase flow has always greyed those out: its availability endpoint
 * takes a `days` window and loops it, so its calendar knows which days hold
 * anything before it paints. The portal asked one date at a time and so had
 * nothing to grey out with — every day inside the advance window looked open,
 * and a client picking a Saturday the owner has never worked got an empty
 * diary and no reason for it.
 *
 * What matters here is not that the panel greys days, but that it greys them
 * by the SAME rule that later decides whether there are hours. Two pipelines
 * would eventually disagree, and the disagreement would read as "the calendar
 * is lying" — the exact complaint this fixes.
 */
describe('which days the calendar offers', () => {
  const range = route.slice(route.indexOf('const openDatesForRange'));
  const body = range.slice(0, range.indexOf('\n    };'));

  it('decides an open day with the same helpers as the single-day diary', () => {
    expect(body).toMatch(/windowsForDate\(/);
    expect(body).toMatch(/generateTimeSlots\(/);
  });

  it('counts time off and the external calendar, not just the weekly hours', () => {
    /* A weekday rule alone would still offer a day blocked for a holiday. */
    expect(body).toMatch(/schedulingTimeOffRepository\.list\(/);
    expect(body).toMatch(/externalCalendarEventRepository\.getBusySlots\(/);
    expect(body).toMatch(/busyMeetings\(/);
  });

  it('reads those facts once for the window, not once per day', () => {
    /* `slotsForDate` in a loop is five round-trips a day. The loop that
       remains must do no I/O — everything it needs is already in hand. */
    const loop = body.slice(body.indexOf('for (let offset'));
    expect(loop).not.toMatch(/await /);
  });

  it('does no diary work unless asked, like the single-day path', () => {
    expect(route).toMatch(/openDays \? await openDatesForRange\(openDays\) : undefined/);
  });

  it('bounds the window — this is a public endpoint', () => {
    expect(route).toMatch(/Math\.min\(Number\(openDaysRaw\), 30\)/);
  });

  it('the panel asks for the window and greys the rest', () => {
    expect(panel).toMatch(/days: String\(OPEN_DAYS_AHEAD\)/);
    expect(panel).toMatch(/!config\.openDates\.includes\(dateKeyOf\(date\)\)/);
  });

  it('and still offers the day when no answer arrived', () => {
    /* Greying out everything because a request failed is the worse failure. */
    expect(panel).toMatch(/if \(config\.openDates\)/);
  });

  it('applies it to the strip as well as the grid', () => {
    /*
     * `isDateSelectable` (the month grid) and `isDateOpen` (the ten-day strip)
     * deliberately duplicate the rule, because the grid reads its month from
     * `currentMonth` and the strip crosses month boundaries. So every rule has
     * to be added twice, and a rule added once makes the strip offer a day the
     * grid has greyed — which is worse than neither doing it.
     */
    expect(panel.match(/if \(config\.openDates\)/g)?.length).toBe(2);
    expect(panel.match(/\.includes\(dateKeyOf\(/g)?.length).toBe(2);
  });
});
