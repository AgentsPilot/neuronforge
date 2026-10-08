/**
 * A meeting row is one line, and still does everything it did.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * Each row in a package's meeting list carried four outlined buttons — held,
 * no-show, cancel, reschedule — laid out inline. Six meetings meant twenty-four
 * controls, and at drawer width every row wrapped onto a second line, so
 * meeting 2's actions sat directly under meeting 2's date and directly above
 * meeting 3 with nothing to say which owned them.
 *
 * They moved behind a primary button and a ⋯ menu. The risk in that move is
 * losing one on the way, or quietly narrowing when it applies — a reorganisation
 * that silently becomes a rule change is the worst kind, because the rows look
 * tidier and an owner finds out later that an action is gone.
 *
 * So this holds the thing the refactor must not alter: SAME ACTIONS, SAME ROWS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE OUTCOMES WAIT FOR THE MEETING
 *
 * A separate, deliberate decision — taken after the layout, so that the rule
 * change could be judged on its own rather than ridden in on a tidy-up. A block
 * of six biweekly sessions, all still ahead, used to offer "mark done" on every
 * one. On a package billed per session that button RAISES AN INVOICE, so the
 * mis-tap it invites bills a client for work nobody has done.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const actions = read('components/crm/contact-drawer/MeetingRowActions.tsx');
const tab = read('components/crm/contact-drawer/BookingsTab.tsx');

describe('every action survived the move', () => {
  it.each([
    ['held', /onSetStatus\?\.\('completed'\)/],
    ['no show', /onSetStatus\('no_show'\)/],
    ['cancel', /onSetStatus\('cancelled'\)/],
    ['reschedule', /run: onReschedule/],
  ])('still offers %s', (_name, pattern) => {
    expect(actions).toMatch(pattern);
  });

  it('offers an outcome only once there is one', () => {
    /*
     * `isMeetingPastDue` is the shared rule — the same test the badge and the
     * session card use. A second derivation here would eventually disagree, and
     * the row would offer "mark done" beside a badge saying the meeting is
     * still ahead.
     */
    expect(actions).toMatch(/isMeetingPastDue\(/);
    expect(actions).toMatch(/if \(awaiting && onSetStatus\) \{/);
    expect(actions).toMatch(/const showsPrimary = awaiting/);
  });

  it('gates BOTH outcomes, not just the visible one', () => {
    /*
     * "No show" is the same claim as "held" with the opposite sign: a meeting
     * still ahead cannot have been missed either. Gating only the primary
     * button would move the impossible action one click deeper rather than
     * removing it — the two live in one branch so they cannot drift apart.
     */
    const branch = actions.slice(
      actions.indexOf('if (awaiting && onSetStatus) {'),
      actions.indexOf('!settled && onSetStatus')
    );

    expect(branch).toMatch(/'no_show'/);
  });

  it('still lets an open meeting be called off at any time', () => {
    // Cancelling is the one action that does not depend on the meeting having
    // happened — legitimate before or after.
    expect(actions).toMatch(/if \(!settled && onSetStatus\) \{/);
  });

  it('lets any meeting be moved, including one already marked', () => {
    // Unconditional before, unconditional now: it is how a wrong outcome gets
    // corrected.
    expect(actions).toMatch(/if \(onReschedule\)/);
  });
});

describe('the row is one line', () => {
  it('BookingsTab renders the component instead of inline buttons', () => {
    expect(tab).toMatch(/<MeetingRowActions/);
  });

  it('no action button survives inline in the list', () => {
    const start = tab.indexOf('ONE LIST, NOT A STACK OF CARDS');
    expect(start).toBeGreaterThan(-1);

    const list = tab.slice(start, tab.indexOf('AddPackageMeeting', start));

    expect(list).not.toMatch(/onSetBookingStatus\(row\.id, '(completed|no_show|cancelled)'\)/);
  });

  it('one action stays in front and the rest go behind the menu', () => {
    /*
     * The shape of the fix. All four visible again would bring the wrapping
     * back; all four hidden would cost a click on the action owners perform
     * most.
     */
    expect(actions).toMatch(/showsPrimary && \(/);
    expect(actions).toMatch(/role="menu"/);
  });
});

describe('the menu is reachable where it is drawn', () => {
  it('is not clipped by the list it sits in', () => {
    /*
     * The list had `overflow-hidden` for its rounded corners, and an absolutely
     * positioned menu cannot escape a clipping ancestor: it rendered as a 40px
     * strip with every label cut off. The rows carry no background, so the
     * radius had nothing to clip anyway.
     */
    const start = tab.indexOf('ONE LIST, NOT A STACK OF CARDS');
    /* Wide enough to reach the container's className: this block is eleven
       levels deep, so most of those characters are indentation. */
    const container = tab.slice(start, start + 2600);

    expect(container).toMatch(/className="flex flex-col gap-px"/);
    expect(container).not.toMatch(/flex flex-col gap-px overflow-hidden/);
  });

  it('anchors to the inline end in both scripts', () => {
    /*
     * The trigger sits at the row's inline END — right in English, left in
     * Hebrew — so `end-0` makes the menu grow INWARD either way. The earlier
     * `isRTL ? 'start-0' : 'end-0'` grew it off the card's left edge in Hebrew,
     * which is how it came to be clipped.
     */
    expect(actions).toMatch(/absolute end-0/);
    expect(actions).not.toMatch(/isRTL \? 'start-0'/);
  });
});

describe('the primary button asks for something', () => {
  it('is the imperative, not a statement of fact', () => {
    /*
     * It read "הפגישה התקיימה" — the meeting took place — which is what the
     * card says AFTER you press it. On a control, among other controls that all
     * name actions, that describes a state rather than requesting one.
     *
     * `crm.stage.mark_done` is the imperative the payment stages already use
     * for the same gesture, so the two lists ask in one voice.
     */
    expect(actions).toMatch(/crm\.stage\.mark_done/);
    expect(actions).not.toMatch(/crm\.booking\.quoted\.meeting_held/);
  });
});
