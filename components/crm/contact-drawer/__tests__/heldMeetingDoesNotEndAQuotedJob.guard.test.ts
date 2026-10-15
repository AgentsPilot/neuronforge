/**
 * Holding the consultation does not end a quoted job.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The action strip was gated on the BOOKING's own status:
 *
 *     booking.status !== 'completed' && !== 'cancelled' && !== 'no_show'
 *
 * For a direct service that is right: the appointment is the job, and once it
 * has been held there is nothing left to do to it.
 *
 * For a `sale_mode: 'proposal'` booking the appointment is a CONSULTATION, and
 * holding it is where the work starts. The quote has not been sent, agreed or
 * paid. But pressing "הפגישה התקיימה" wrote `completed`, the whole strip
 * disappeared, and Cancel went with it — so an owner who had recorded that the
 * meeting happened could no longer call off a job that had never been priced,
 * while the client's proposal link stayed live and acceptable.
 *
 * The card's own state had this right already:
 *
 *     const settledStatus = isQuoted ? cancelled || quotePaid : meetingSettled;
 *
 * with a comment saying "the consultation being held ends the meeting and
 * starts the work". The strip simply asked the other question. One helper now
 * answers it for both, because derived twice they drift, and the drift reads as
 * a button that appears and disappears for no reason anyone can name.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const tab = fs.readFileSync(
  path.join(process.cwd(), 'components/crm/contact-drawer/BookingsTab.tsx'),
  'utf8'
);

/** Comments quote the old condition; assertions about code must not read them. */
const code = tab.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('two questions, one answer each', () => {
  it('asks whether the JOB is over, not the appointment', () => {
    /*
     * `cancelled` rather than `input.status === 'cancelled'` directly, since
     * `cancel` stopped overwriting a recorded attendance: a held consultation
     * keeps `completed` when its job is cancelled, so the status alone no
     * longer answers this. The union behind `cancelled` is pinned below and in
     * `jobOverAfterHeldMeeting.guard.test.ts`.
     */
    expect(code).toMatch(/function jobIsOver\(input: \{/);
    expect(code).toMatch(/if \(input\.isQuoted\) return cancelled \|\| input\.quotePaid;/);
  });

  it('still takes the booking status as one of the ways it can be off', () => {
    /* Rows cancelled by older code paths carry no `cancel_reason`, so the
       status has to stay in the union — dropping it would make those jobs read
       as live. */
    expect(code).toMatch(/const cancelled =\s*\n?\s*input\.status === 'cancelled' \|\| Boolean\(input\.calledOff\);/);
  });

  it('keeps attendance as its own, separate question', () => {
    expect(code).toMatch(/function attendanceRecorded\(status\?: string \| null\): boolean/);
  });

  it('leaves a direct service exactly as it was', () => {
    /* The appointment IS the job there. A change in that behaviour would be a
       regression dressed as a fix.
       Inlined when `calledOff` was added, and the SET is what matters: the same
       three statuses end a direct service's job, plus the called-off signal
       that is only ever true on a booking already in one of them. */
    expect(code).toMatch(
      /return cancelled \|\| input\.status === 'completed' \|\| input\.status === 'no_show';/
    );
  });
});

describe('the strip outlives the consultation', () => {
  it('is gated on the job, not the booking status', () => {
    expect(code).toMatch(/!jobIsOver\(\{\s*\n\s*status: booking\.status,\s*\n\s*isQuoted,/);
  });

  it('no longer tests the three statuses directly', () => {
    /* The exact condition that took Cancel away. */
    expect(code).not.toMatch(
      /booking\.status !== 'completed' &&\s*\n\s*booking\.status !== 'cancelled' &&\s*\n\s*booking\.status !== 'no_show'/
    );
  });

  it('hides the two attendance buttons once attendance is recorded', () => {
    /*
     * The strip staying up must not mean "mark it held" stays up: a second
     * press is meaningless, and "no show" contradicts what was just recorded.
     * Only Cancel survives.
     */
    expect(code).toMatch(/\{!attendanceRecorded\(booking\.status\) && \(/);
    expect(code).toMatch(/\{!isUnscheduled && !attendanceRecorded\(booking\.status\) && \(/);
  });

  it('leaves Cancel ungated inside the strip', () => {
    /*
     * The whole point. Cancel is the one control that must survive a held
     * consultation, so it carries no attendance condition of its own.
     */
    const strip = code.slice(code.indexOf('!jobIsOver({'));
    const cancel = strip.indexOf("onSetBookingStatus(booking.id, 'cancelled')");

    expect(cancel).toBeGreaterThan(-1);
    expect(strip.slice(0, cancel)).not.toMatch(/attendanceRecorded\(booking\.status\) && \($/);
  });
});

describe('the card and the strip cannot disagree', () => {
  it('the card-level state uses the same helper', () => {
    expect(code).toMatch(/const settledStatus = jobIsOver\(\{/);
  });

  it('and so does the appointment-level one', () => {
    expect(code).toMatch(/const meetingSettled = attendanceRecorded\(booking\.status\);/);
  });

  it('neither re-derives the rule inline', () => {
    /* The two definitions that existed before, written out by hand. Either
       reappearing means the drift is back. */
    expect(code).not.toMatch(/isQuoted\s*\n?\s*\? booking\.status === 'cancelled' \|\| Boolean\(quotePaid\)/);
  });
});
