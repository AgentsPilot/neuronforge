/**
 * "Send again" may not repeat a claim the owner has since corrected.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT HAPPENED, ON ONE LIVE BOOKING, IN FIFTY MINUTES
 *
 *   21:25  booking made, confirmation sent
 *   21:26  the owner moved the hour; the client was emailed the new time
 *   21:28  the owner marked it NO-SHOW; the client was emailed "We missed you"
 *   21:34  the owner corrected it to HELD
 *   21:37  the owner pressed "Send again" — "We missed you" went out again
 *   22:16  and again
 *
 * The client holds three missed-appointment notices for a meeting this product
 * records them as having attended, two of them sent after the correction. The
 * last is in `email_sends`: "We missed you - CleanUp office quotation", 22:16.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT WAS ALLOWED, AND WHY THE OBVIOUS FIX IS WRONG
 *
 * The resend asked three questions — is this the newest mail, is the job still
 * live, is this KIND resendable — and `missed_appointment` is on the resendable
 * list, so it passed. Nothing asked what the hour says now.
 *
 * The obvious repair is to close the resend once any outcome is recorded. That
 * gate existed and was deliberately removed, for a good reason: most of this
 * rail is DETAIL — your appointment is confirmed, here is the new time, here is
 * the intake form — and a client who lost one of those should be able to get it
 * again whatever has happened since.
 *
 * Only two of them assert what HAPPENED, and only those two can be falsified by
 * the owner changing their mind. So the rule is narrow by design, and these
 * cases exist to keep it narrow in both directions: a wider gate takes away a
 * resend owners rely on, a wider list lets the falsehood back out.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const TAB = 'components/crm/contact-drawer/BookingsTab.tsx';

/** Source with comments removed, so the notes above do not satisfy a match. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('a claim may only be repeated while it still holds', () => {
  const tab = code(read(TAB));

  it('a missed-appointment notice needs the hour to still be a no-show', () => {
    expect(tab).toMatch(/case 'missed_appointment':[\s\S]{0,120}return outcome === 'no_show';/);
  });

  it('a cancellation notice needs it to still be cancelled', () => {
    expect(tab).toMatch(/case 'meeting_cancelled':[\s\S]{0,160}return outcome === 'cancelled';/);
  });

  it('and the resend asks, rather than only asking what kind it is', () => {
    /*
     * The gate reads: newest mail, job still live, kind resendable, AND still
     * true. Dropping the last term is the regression — it is the one that was
     * missing when the client received the third "we missed you".
     */
    expect(tab).toContain('mailStillTrue(mail.kind, outcome)');
  });

  it('with the outcome as it stands NOW, from the attempt itself', () => {
    /*
     * `attempt.meeting_status` and not anything recorded on the mail: the whole
     * point is that the mail was true when it was sent and is not any more.
     * Both call sites, or the rail above the fold keeps the old behaviour.
     */
    const calls = tab.match(/renderMailRow\(mail, mail\.at === lastMailAt && isCurrentAttempt, stamp, attempt\.meeting_status\)/g);
    expect(calls ?? []).toHaveLength(2);
  });
});

describe('an appointment notice dies with the appointment', () => {
  const tab = code(read(TAB));

  it('a confirmation, a new time and an intake request need an unsettled hour', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE SECOND HALF OF THE SAME BUG, AND THE FIRST FIX WAS TOO LAX.
     *
     * These were first treated as DETAIL — a client who lost one should be
     * able to get it again — and that is true only while the appointment is
     * still coming. Each of them states an hour in the future: "your
     * appointment is confirmed", "here is the new time", "please fill this in
     * before we meet".
     *
     * Reported on the same live booking: the meeting was moved, then marked
     * no-show, and the rail still offered "Send again" on the new-time notice.
     * Pressing it would have told the client their appointment was at 11:00 on
     * a morning the product had already recorded them as missing.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(tab).toMatch(
      /case 'booking_confirmed':[\s\S]{0,120}case 'booking_rescheduled':[\s\S]{0,120}case 'intake_requested':[\s\S]{0,120}return !outcome;/
    );
  });

  it('tested by the ABSENCE of an outcome, not a list of settled ones', () => {
    /* Held, missed, called off and superseded are all settled. A list would
       let a status added later become resendable by omission. */
    expect(tab).toContain('return !outcome;');
    expect(tab).not.toMatch(/return outcome !== 'held'/);
  });

  it('and a cancellation notice needs the booking still cancelled', () => {
    expect(tab).toMatch(/case 'meeting_cancelled':[\s\S]{0,80}case 'booking_cancelled':[\s\S]{0,120}return outcome === 'cancelled';/);
  });

  it('while anything the rule does not name still passes', () => {
    /* The fallback keeps this narrow: a kind nobody has reasoned about is not
       silently withheld from an owner who needs to re-send it. */
    expect(tab).toMatch(/default:[\s\S]{0,120}return true;/);
  });

  it('the old blanket gate does not come back', () => {
    /*
     * `!attempt.outcome_at` as a resend condition is the repair that looks
     * right and takes away the resend owners actually use. Named so it cannot
     * return quietly.
     */
    expect(tab).not.toMatch(/!attempt\.outcome_at &&[\s\S]{0,80}onResendMail/);
  });
});
