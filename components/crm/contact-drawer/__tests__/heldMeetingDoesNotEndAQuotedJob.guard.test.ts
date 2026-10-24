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
    /* Takes the BOOKING now, not a bare status: held and no-show write
       `meeting_status` and leave the job alone, so a predicate reading the
       status would go on offering 'mark it held' to an owner who just did. */
    expect(code).toMatch(/function attendanceRecorded\(booking: \{/);
    expect(code).toContain('booking.meeting_status != null');
  });

  it('leaves a direct service exactly as it was', () => {
    /* The appointment IS the job there. A change in that behaviour would be a
       regression dressed as a fix.
       Inlined when `calledOff` was added, and the SET is what matters: the same
       three statuses end a direct service's job, plus the called-off signal
       that is only ever true on a booking already in one of them. */
    /* The SET is what matters, not the spelling. `meeting_status` joined it
       because the outcome moved there — `complete()` no longer writes
       `status`, so without it a direct service's job never ended and its
       action strip never retired. The old statuses stay for pre-split rows. */
    expect(code).toMatch(/const settled =[\s\S]{0,260}input\.meeting_status === 'held'/);
    expect(code).toMatch(/const settled =[\s\S]{0,260}input\.meeting_status === 'no_show'/);
    expect(code).toMatch(/const settled =[\s\S]{0,260}input\.status === 'completed'/);
    expect(code).toMatch(/const settled =[\s\S]{0,260}input\.status === 'no_show'/);
    expect(code).toContain('return cancelled || settled;');
  });
});

describe('the strip outlives the consultation', () => {
  it('is gated on the job, not the booking status', () => {
    /* `meeting_status` sits between them now, so the two lines are no longer
       adjacent. Asserting both arguments are passed, not their order. */
    const from = code.indexOf('!jobIsOver({');
    const call = code.slice(from, code.indexOf('})', from) + 2);

    expect(call).toContain('status: booking.status');
    expect(call).toContain('meeting_status: booking.meeting_status');
    expect(call).toContain('isQuoted');
  });

  it('no longer tests the three statuses directly', () => {
    /* The exact condition that took Cancel away. */
    expect(code).not.toMatch(
      /booking\.status !== 'completed' &&\s*\n\s*booking\.status !== 'cancelled' &&\s*\n\s*booking\.status !== 'no_show'/
    );
  });

  /**
   * The card-level strip, which is now one control wide.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * BOUNDED BY CODE, NOT BY A COMMENT.
   *
   * `code` has its comments stripped — the file's own note at the top says why.
   * An earlier version of this helper ended the slice at the "Expanded content"
   * comment, which therefore did not exist: `indexOf` returned -1, the slice ran
   * to the end of the file, and it swept in both the status badges and the
   * journey's own controls. The assertions then described the whole component
   * rather than the strip.
   *
   * `{isExpanded && (` is real code and sits immediately after the strip.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const strip = () => {
    const start = code.indexOf('!jobIsOver({');
    expect(start).toBeGreaterThan(-1);
    /*
     * To the END of the component, because the strip is now the last thing in
     * the card. It used to be bounded by `{isExpanded && (`, which sat after
     * it; the strip has since moved BELOW the journey, so that bound now runs
     * backwards and returns nothing.
     */
    return code.slice(start);
  };

  it('sits below the journey, not in the header', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * ASKED FOR DIRECTLY: "cancel booking and complete need to move below as
     * the mockup", "not in the header".
     *
     * In the header it put the most destructive control on the card directly
     * under its title, and placed a decision about the WHOLE JOB above the
     * stages it cascades through. You read what happened, then you decide.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(code.indexOf('{isExpanded && (')).toBeLessThan(code.indexOf('!jobIsOver({'));
  });

  it('holds the JOB action and nothing else', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * ASKED FOR DIRECTLY: "move the meeting buttons/actions to the journey step
     * where we have the meeting".
     *
     * Held and no-show are facts about an APPOINTMENT. Cancel is a decision
     * about the WORK, and it cascades through the meeting, the quote and the
     * money. Having all three in one row with nothing to separate them is what
     * produced "is the button related to the booking or to the meeting?".
     *
     * The meeting's two now live on the meeting's own step, where the row that
     * names the time can say what happened at it. What is asserted here is that
     * they did not come back.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(strip()).toContain("t('crm.booking.action.cancel_booking')");
    expect(strip()).not.toContain("onSetBookingStatus(booking.id, 'completed')");
    expect(strip()).not.toContain("onSetBookingStatus(booking.id, 'no_show')");
  });

  it('labels it with an instruction, never a status', () => {
    /*
     * Reported as "they are not buttons but like a title". Every label was a
     * `crm.booking.status.*` key, so the cancel control read "בוטלה" — "it WAS
     * cancelled" — a statement about a state the card is already in, sitting
     * beside a real status badge of the same shape. The owner's correction was
     * exact: "בוטלה need to be בטל הזמנה".
     */
    expect(strip()).not.toContain("t('crm.booking.status.cancelled')");
  });

  it('renders it as a control, not a capsule', () => {
    /*
     * `rounded-full` is the status badge's shape in this drawer — "מאושרת" sits
     * on the same card wearing it, which is why a row of actions read as a row
     * of states. Actions use the house `Button` primitive instead.
     */
    expect(strip()).not.toContain('rounded-full');
    expect(strip()).toMatch(/<Button\s+size="sm"\s+variant="outline"/);
  });
});

describe('the meeting is managed on the meeting step', () => {
  it('offers both outcomes there, each dropping only its own answer', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * This asserted that both buttons were gated on `!meetingSettled`, so the
     * step "never offers to re-answer a question it has answered".
     *
     * That rule was wrong in practice. `meetingSettled` goes true the moment
     * ANY outcome is recorded, so marking a no-show removed all four meeting
     * actions at once — and an owner who marked it by mistake, or whose client
     * turned up after all, had no way back from the card. The thing being
     * recorded is a judgement made in a hurry; it has to be correctable.
     *
     * Each action now drops only the answer it would repeat, and the gate is
     * the JOB: `!jobCalledOff`, because a called-off job has no appointment
     * left to judge.
     */
    /*
     * Asserted as conditions present on the branch, not as one exact string.
     * The spelling has already changed once — `&& onSetBookingStatus` was added
     * so the buttons are withheld on surfaces that pass no handler — and a
     * literal match fails on changes like that while the rule it protects is
     * untouched.
     */
    const held = code.indexOf("onSetBookingStatus(booking.id, 'completed')");
    const noShow = code.indexOf("onSetBookingStatus(booking.id, 'no_show')");
    expect(held).toBeGreaterThan(-1);
    expect(noShow).toBeGreaterThan(-1);

    /**
     * The condition guarding a button, read back from its handler.
     *
     * Wide enough to clear the button's own markup — className strings here run
     * past 300 characters on their own, which is what a narrower window caught
     * instead of the condition.
     */
    const branchBefore = (at: number) => code.slice(Math.max(0, at - 700), at);

    /* Each reads its own flag, and both flags are the job-level gate plus the
       one answer that button would repeat. */
    expect(branchBefore(held)).toContain('canMarkHeld');
    expect(branchBefore(noShow)).toContain('canMarkNoShow');

    /* Bounded by the LAST flag in the group rather than a character count. The
       count was 900, and adding one rule between the declarations pushed
       `no_show` out of the window — a guard that silently stops covering what
       it names is worse than no guard. */
    const flags = code.slice(
      code.indexOf('const meetingAnswerable'),
      code.indexOf('const canCancelMeeting') + 400
    );
    expect(flags).toContain('isScheduleStep && !jobCalledOff');
    expect(flags).toContain("booking.meeting_status !== 'held'");
    expect(flags).toContain("booking.meeting_status !== 'no_show'");

    // Only no-show needs a time to mean anything.
    expect(branchBefore(noShow)).toContain('!isUnscheduled');
  });

  it('gives the step a body whenever it offers one', () => {
    /*
     * `hasBody` decides whether the step draws a card at all. Held needs
     * neither `onEditSession` nor a scheduled service, so the old condition
     * alone would have drawn a card with its only content hidden inside it.
     */
    /* On the same gate as the buttons. Left on `!meetingSettled` the buttons
       would exist and the card would draw no body to put them in, which looks
       exactly like them being missing. */
    expect(code).toContain('(isScheduleStep && !jobCalledOff) ||');
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
    expect(code).toMatch(/const meetingSettled = attendanceRecorded\(booking\);/);
  });

  it('neither re-derives the rule inline', () => {
    /* The two definitions that existed before, written out by hand. Either
       reappearing means the drift is back. */
    expect(code).not.toMatch(/isQuoted\s*\n?\s*\? booking\.status === 'cancelled' \|\| Boolean\(quotePaid\)/);
  });
});
