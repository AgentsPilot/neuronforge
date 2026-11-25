/**
 * A step the owner reopened must hand the dialog back when they answer it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 * "Adding service and client, trying to change the client — the client can be
 * changed, but the operation can not be approved, the Create Booking button is
 * gray off."
 *
 * On screen: Service ✓, Client ✓ with a Change link, and Date & Time and
 * Details both greyed. The footer named the service, the duration and the
 * client. The button was correctly disabled — there was no hour — and there
 * was no way to give it one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A DEAD END AND NOT AN ANNOYANCE
 *
 * Three facts compose into a trap, and each is reasonable alone:
 *
 *   1. `planBookingSteps` resolves the open step as `reopened ?? natural`, so
 *      a pinned step beats the first-unanswered rule for as long as it is set
 *   2. `openedStep` is written by the Change link and cleared by almost
 *      nothing
 *   3. a step the plan calls `pending` renders as a flat, half-opacity row
 *      with NO click handler — deliberately, so nobody jumps ahead
 *
 * So once the pin is stuck on a step before `when`, Date & Time can never be
 * opened, `start_time` is never set, and the button is disabled for ever with
 * nothing on screen to act on. Quitting the dialog is the only way out.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO WAYS IN, AND ONLY ONE WAS EVER CLOSED
 *
 * `handleServiceChange` ends with `setOpenedStep(null)` and carries a comment
 * explaining this exact failure for the SERVICE step. The rule was never
 * applied anywhere else:
 *
 *   · choosing a client      `selectContact` updated the form and left the pin
 *   · re-picking the SAME    Radix raises `onValueChange` only when the value
 *     service               differs, so the one release never fired
 *
 * The second is what the reported screenshot shows: Service expanded, pinned,
 * with the service already chosen.
 *
 * The rule this protects: ANSWERING RELEASES. Handing the choice back costs
 * nothing when the answer is poor, because `planBookingSteps` reopens the very
 * same step by itself if it is unanswered or in error — which is what makes
 * releasing always safe and holding on never safe.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const MODAL = 'components/scheduling/SchedulingBookingModal.tsx';
const STEP = 'components/scheduling/BookingStep.tsx';
const PLAN = 'lib/scheduling/bookingSteps.ts';

/** Source with comments removed, so these notes cannot satisfy a match. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the trap these fixes exist for', () => {
  it('a pinned step outranks the natural order', () => {
    /* `reopened ?? natural`. Correct, and the reason a stuck pin is fatal
       rather than untidy. */
    expect(code(read(PLAN))).toContain('const open = facts.settled ? null : (reopened ?? natural);');
  });

  it('and a pending step cannot be opened by hand', () => {
    /*
     * Deliberate — nobody should jump to Details before choosing a service —
     * and it is what removes the escape hatch. If a click handler is ever added
     * here this suite's reasoning softens, but the releases below stay right.
     */
    const step = code(read(STEP));
    const pending = step.slice(step.indexOf("if (state === 'pending')"), step.indexOf('return (', step.indexOf("if (state === 'pending')") + 400));

    expect(pending).toContain('opacity-50');
    expect(pending).not.toContain('onClick');
  });
});

describe('answering releases the step', () => {
  const modal = code(read(MODAL));

  it('choosing a service does', () => {
    /* The original, and the only one that ever worked. */
    const handler = modal.slice(
      modal.indexOf('const handleServiceChange'),
      modal.indexOf('const handleStartTimeChange')
    );

    expect(handler).toContain('setOpenedStep(null);');
  });

  it('choosing a client does', () => {
    const handler = modal.slice(
      modal.indexOf('const selectContact = (contact: CRMContact) => {'),
      modal.indexOf('const clearSelectedContact')
    );

    expect(handler).toContain('setOpenedStep(null);');
  });

  it('and so does closing the service picker, changed or not', () => {
    /*
     * Radix raises `onValueChange` only on a DIFFERENT value, so re-picking the
     * service already selected released nothing. Shutting the picker is the end
     * of answering the question either way.
     */
    expect(modal).toMatch(/onOpenChange=\{open => \{\s*if \(!open\) setOpenedStep\(null\);/);
  });

  it('and choosing a client clears the refusals that would re-pin it', () => {
    /*
     * A released pin is not enough on its own: `errors.client` makes the step
     * unanswered, so the natural order would hand it straight back. A name and
     * an email have just arrived from a CRM record, so a message saying they
     * are missing is stale.
     */
    const handler = modal.slice(
      modal.indexOf('const selectContact = (contact: CRMContact) => {'),
      modal.indexOf('const clearSelectedContact')
    );

    expect(handler).toContain("client_first_name: ''");
    expect(handler).toContain("client_email: ''");
  });
});

describe('what must NOT change', () => {
  const modal = code(read(MODAL));

  it('clearing the client leaves the step open', () => {
    /*
     * The opposite act. `clearSelectedContact` empties the fields, so the step
     * is genuinely unanswered and the plan opens it on the natural rule. A
     * release here would be harmless but a RE-PIN would be wrong, and neither
     * belongs.
     */
    const handler = modal.slice(
      modal.indexOf('const clearSelectedContact'),
      modal.indexOf('const clearSelectedContact') + 600
    );

    expect(handler).not.toContain("setOpenedStep('client')");
  });

  it('the Change link still pins the step it names', () => {
    /* Releasing on answer is only safe while reopening still works: that is
       the whole of how an owner revisits a settled answer. */
    expect(modal).toContain('() => setOpenedStep(key);');
  });

  it('and a plan still reopens a step it is refusing', () => {
    /*
     * The property that makes releasing always safe. If `answered` ever stops
     * testing `errors`, a released step with a bad answer would be skipped
     * silently and the booking would fail at the validator instead.
     */
    expect(code(read(PLAN))).toContain(
      'Boolean(summaryOf(key)) && !facts.errors?.[key]'
    );
  });
});
