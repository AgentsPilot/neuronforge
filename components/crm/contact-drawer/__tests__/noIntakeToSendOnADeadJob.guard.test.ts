/**
 * The card stops offering to send an intake form nobody can use.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * All three send-intake affordances — the rail node, its tooltip and the button
 * in the card — asked `booking.status !== 'cancelled'`, the narrowest possible
 * reading of "is this still live". Two states walk straight through it:
 *
 *   · a job STOPPED after its consultation was held keeps `completed`, because
 *     `SchedulingBookingRepository.cancel` no longer overwrites a recorded
 *     attendance
 *   · a meeting that simply happened is `completed` too
 *
 * Both were offered **שלח טופס לקוח** — send the client a form preparing them
 * for a meeting that is over, on a job the owner had already called off. That
 * is what was reported: "why we need to resend if it stopped".
 *
 * The server side was closed first: `outcomeRecorded` now makes all three
 * public intake routes refuse the submission. This is the surface that stops
 * OFFERING it, so the owner is not invited to send something the platform will
 * then reject.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The affordances live in the per-step map of a ~4,900-line component with no
 * seam to render one card through. What is protected is that all three read ONE
 * predicate — they came to differ from each other before, and three copies of a
 * condition is how the next one gets left behind.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(
  join(process.cwd(), 'components/crm/contact-drawer/BookingsTab.tsx'),
  'utf8'
);

/** Comments quote the old condition verbatim. */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const predicate = code.slice(
  code.indexOf('const canSendIntake = Boolean('),
  code.indexOf('const canSendIntake = Boolean(') + 260
);

describe('the comment stripping works', () => {
  it('removes prose quoting the old test', () => {
    expect(SOURCE).toContain('the narrowest possible reading');
    expect(code).not.toContain('the narrowest possible reading');
  });
});

describe('one predicate, asked by all three', () => {
  it('exists', () => {
    expect(predicate).toContain('canSendIntake');
  });

  it('the rail node reads it', () => {
    expect(code).toContain('const onNodeClick =\n                                    canSendIntake');
  });

  it('the tooltip reads it', () => {
    /* A disabled node still rendered "Send intake form" as its title, which is
       a tooltip promising an action that cannot run. */
    /* Anchored on the tooltip's own text — `title={` alone matches the
       section header far above it. */
    const at = code.indexOf("t('crm.intake.send_form')");
    expect(at).toBeGreaterThan(-1);

    expect(code.slice(Math.max(0, at - 220), at)).toContain('canSendIntake');
  });

  it('the button reads it', () => {
    expect(code).toContain('{canSendIntake && (');
  });

  it('nothing still asks the old question', () => {
    /*
     * The exact condition that let a stopped job keep offering the form. Three
     * copies existed; none may survive.
     */
    expect(code).not.toContain("isIntakeStep && !hasIntake && onSendIntake && booking.status !== 'cancelled'");
  });
});

describe('what the predicate asks', () => {
  it('only on the intake step, and only while there is no response', () => {
    expect(predicate).toContain('isIntakeStep');
    expect(predicate).toContain('!hasIntake');
  });

  it('only when the parent actually gave it a sender', () => {
    expect(predicate).toContain('onSendIntake');
  });

  it('not once the appointment has an outcome', () => {
    /*
     * `meetingSettled` is `attendanceRecorded`, which covers completed,
     * cancelled and no-show — so the old `!== 'cancelled'` test is not kept
     * beside it. Nothing left to prepare for.
     */
    expect(predicate).toContain('!meetingSettled');
  });

  it('and not once the job is off, even with the meeting still ahead', () => {
    /*
     * The half the other does not imply: a quote stopped from Manage Payment
     * leaves the booking `confirmed`, so `meetingSettled` is false and the form
     * would still be offered for work nobody is doing.
     */
    expect(predicate).toContain('!jobCalledOff');
  });

  it('both halves, not either', () => {
    expect(predicate).toContain('!meetingSettled && !jobCalledOff');
  });
});

describe('it agrees with the server', () => {
  it('the routes refuse exactly the states this stops offering', () => {
    /*
     * `outcomeRecorded` covers cancelled, completed and no-show — the same set
     * `meetingSettled` covers here. An affordance the server would reject is a
     * button that reports a failure to the owner for pressing what it offered.
     */
    const statuses = readFileSync(
      join(process.cwd(), 'lib/business-os/bookingStatus.ts'),
      'utf8'
    );

    expect(statuses).toContain(
      "export const SETTLED_BOOKING_STATUSES = ['cancelled', 'completed', 'no_show'] as const;"
    );
    expect(code).toContain('const meetingSettled = attendanceRecorded(booking.status);');
  });
});
