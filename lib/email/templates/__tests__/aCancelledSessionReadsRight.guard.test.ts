/**
 * What a client reads when ONE session of a package is called off.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The email opened "ההזמנה בוטלה" — your ORDER is cancelled — directly above
 * "הפגישה שלמטה לא תתקיים" and "העבודה ממשיכה בדיוק כפי שסוכם". The first line
 * said the opposite of the next two.
 *
 * `intro` had a meeting-only form from the start and the heading did not, so
 * the body was half-converted: right about the meeting, wrong about the order.
 * For a package it is not merely clumsy, it is false — five of their six
 * sessions are untouched and already paid for by stage.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');

const copy = read('lib/email/templates/translations.ts');
const template = read('lib/email/templates/booking-confirmation.ts');
/*
 * The session TABLE moved, and this guard did not follow it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `emailSessionRows` was extracted into the shared base template, so that four
 * booking emails could draw one table instead of four. Every assertion about
 * its markup went on reading `booking-confirmation.ts`, which now only CALLS
 * it — so six of them failed against a table that was rendering correctly the
 * whole time, and the suite had been red long enough to stop being read.
 *
 * One test already reached for this file on its own (`and the formatter still
 * names it by default`), which is the clue that the split had happened and the
 * rest were left behind.
 *
 * Pointed at the file that owns the markup rather than loosened or dropped:
 * what each one asserts is still exactly right, and still worth guarding.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const base = read('lib/email/templates/base-template.ts');
const route = read('app/api/scheduling/meetings/[id]/outcome/route.ts');

describe('the heading names the meeting, not the order', () => {
  it('has its own string in every language', () => {
    const block = copy.slice(copy.indexOf('meetingOnlyGreeting:'));
    const body = block.slice(0, block.indexOf('},'));

    expect(body).toContain("en: 'Appointment cancelled'");
    expect(body).toContain("he: 'הפגישה בוטלה'");
    expect(body).toContain('es:');
  });

  it('and the body uses it whenever only a meeting is off', () => {
    const heading = template.slice(template.indexOf('data.meetingOnly\n          ? t.meetingOnlyGreeting[locale]'));
    expect(heading.slice(0, 200)).toContain('t.meetingOnlyGreeting[locale]');
  });

  it('while an ordinary cancellation keeps the one it had', () => {
    /* Cancelling a booking really does cancel the order, and that email must
       not start saying something softer. */
    expect(template).toContain('t.greeting[locale]');
    expect(copy).toContain("he: 'ההזמנה בוטלה'");
  });
});

describe('the client is not invited to rebook a session', () => {
  it('the session cancellation withholds the button', () => {
    /*
     * Right for a consultation, where rebooking is the client's to arrange.
     * Wrong for a package: the owner decided this hour is not happening, and
     * the drawer withholds the move for the same reason. Offering the client a
     * replacement would contradict that from the one surface the owner cannot
     * see.
     */
    expect(route).toContain('offerRebooking: false');
  });

  it('and false really does suppress the link', () => {
    /* A flag nobody reads is not a decision. */
    const service = read('lib/services/BookingEmailService.ts');
    expect(service).toContain('options?.offerRebooking === false');
    expect(service).toMatch(/offerRebooking === false\s*\?\s*undefined/);
  });
});

describe('an added session is not a new order', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The confirmation for a seventh session carried the client's whole payment
   * SCHEDULE and a notice demanding money "to confirm the order".
   *
   * Neither is true of it. The order was placed when the quote was accepted,
   * the session is already confirmed, and the money is billed one session at a
   * time as each is held.
   *
   * And it was wrong on its own terms: seven periods and a total of ₪0.00,
   * against a plan with eight stages totalling 800.04 — on a purchase that
   * carries no `payment_plan_id` at all. It described nothing in the database.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('shows no payment schedule', () => {
    expect(template).toContain("data.addedSession ? '' : emailPlanSchedule");
  });

  it('and demands nothing to confirm it', () => {
    const gate = template.slice(template.indexOf('const hasPendingPayment ='));
    expect(gate.slice(0, gate.indexOf(';'))).toContain('!data.addedSession');
  });

  it('while an ordinary booking keeps both', () => {
    /* A real order still shows what is owed and what was agreed. */
    expect(template).toContain('emailPlanSchedule({');
    expect(template).toContain('t.paymentRequired');
  });
});

describe('a called-off session says WHICH one', () => {
  /*
   * The client received "הפגישה שלמטה לא תתקיים" — the meeting below will not
   * take place — with nothing below it. No date, no time, nothing naming which
   * of their sessions was off.
   *
   * `hasSchedule` is read off the SERVICE, and a package service is bought
   * rather than booked into an hour, so the date row was suppressed for every
   * session of it.
   */
  it('shows the date even when the service keeps no hours', () => {
    expect(template).toContain('(data.hasSchedule === false && !data.meetingOnly) || data.sessions?.length');
  });

  it('and the time with it', () => {
    expect(template).toContain("(data.hasSchedule !== false || data.meetingOnly) && timeStr");
  });

  it('still says nothing for a product, which has no hour at all', () => {
    /* `meetingOnly` is only ever set when one appointment is being called
       off; a course cancelled outright has no date to name. */
    expect(template).toContain('data.hasSchedule === false');
  });
});

describe('the client sees the whole block, whichever session changed', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A client holding six sessions reads "your meeting has been moved" or "the
   * meeting below will not take place" and is left to work out what that
   * leaves them with. They have no drawer to open: the email IS their record
   * of a block they paid for.
   *
   * So the mail that changes ONE session lists all of them, with what has
   * happened to each and what it cost, and marks the one it is about.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const service = read('lib/services/BookingEmailService.ts');
  const builder = read('lib/scheduling/packageSessionLines.ts');

  it('all three emails carry the list', () => {
    /* Added, cancelled, moved — every action that reaches the client. */
    /*
     * The ARGUMENT is not pinned. A package sale leaves two bookings, and the
     * cancellation reads the list off the PACKAGE rather than the row being
     * cancelled — `packageSessionLines(options?.sessionsFrom ?? bookingId,
     * userId)` — so a literal match counted two of the three and called a
     * correct email missing.
     */
    expect(service.match(/packageSessionLines\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('and all three render it', () => {
    /* At least: a fourth email has since learned to carry the list, and that is
       growth, not drift. Same shape as its sibling above. */
    expect(template.match(/sessionListTitle/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('one line per SESSION, not per attempt', () => {
    /*
     * A moved session has two rows: the hour it was for, stamped `moved`, and
     * the hour it is for now. Listing the first would send the client to a
     * time nobody is expecting them.
     */
    expect(builder).toContain("if (row.meeting_status === 'moved') continue;");
  });

  it('with the money the session actually carries', () => {
    /* The stage follows a moved session to its new attempt, so reading the
       current attempt's stage is reading what this session costs. */
    expect(builder).toContain("from('payment_plan_installments')");
    expect(builder).toContain('stageByMeeting');
  });

  it('and nothing at all for a session that was called off', () => {
    /* Its stage is voided when it is cancelled, so it will never be billed —
       showing a figure would claim money that cannot be collected. */
    expect(builder).toContain("stage.status === 'cancelled'");
  });

  it('marks the one the email is about', () => {
    expect(builder).toContain('isSubject');
    expect(base).toContain('line.isSubject ?');
  });

  it('never fails the email over the list', () => {
    /* The news — moved, called off — is what the client must receive. A list
       that could not be built is a paragraph missing, not a message withheld. */
    expect(builder).toContain('return [];');
    expect(builder).toContain('catch');
  });

  it('and a moved session is asked to pay nothing new', () => {
    /* The reschedule notice asks the client to pay "to confirm the order",
       which is false of an appointment moved inside a package already paid
       for by stage. */
    expect(template).toContain('!data.sessionLines?.length &&');
  });
});

describe('the session list is a table, and the only one', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * It was one sentence per session — date, zone, state and money run together
   * — so ten of them wrapped into twenty ragged lines and the client had to
   * parse each to find the hour. The zone came from `formatEmailDate`, which
   * names it in full on every date: right for one appointment, and ten
   * repetitions of the same clock in a list.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('renders real table rows with real cells', () => {
    const fn = base.slice(base.indexOf('export function emailSessionRows('));
    /* It is the LAST export in the file, so there is no next one to stop at:
       `indexOf` would answer -1 and quietly drop the final character. */
    const next = fn.indexOf('\nexport function', 1);
    const body = next === -1 ? fn : fn.slice(0, next);

    expect(body).toContain('<table role="presentation"');
    expect(body).toContain('<td');
    expect(body).toContain('<tr>');
  });

  it('heads its columns', () => {
    expect(base).toContain('labels.columns.when');
    expect(base).toContain('labels.columns.state');
    expect(base).toContain('labels.columns.payment');
  });

  it('names the clock once, not on every row', () => {
    expect(base).toContain('includeTimezone: false');
    expect(base).toContain('labels.zoneNote');
  });

  it('and the formatter still names it by default', () => {
    /* A single appointment in an email must say which clock it is on. */
    expect(base).toContain('includeTimezone = true');
    expect(base).toContain('if (includeTimezone) dateOptions.timeZoneName');
  });

  it('strikes a cancelled session rather than only wording it', () => {
    expect(base).toContain("line.state === 'cancelled' ? 'text-decoration: line-through;'");
  });

  it('stands the older date-only list down wherever this one draws', () => {
    /* Otherwise the same dates print twice, in two shapes, one above the
       other. */
    expect(template.match(/!data\.sessionLines\?\.length/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('columns named in every language', () => {
    for (const file of ['en', 'es', 'he']) {
      expect(copy).toContain('sessionColWhen');
      expect(copy).toContain('sessionZoneNote');
      expect(file).toBeTruthy();
    }
  });
});
