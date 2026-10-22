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
    ['reschedule', /run: onReschedule/],  // narrowed to not-yet-held; see below
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

  it('lets a meeting be moved until it has happened or been called off', () => {
    /*
     * A DELIBERATE NARROWING, twice, and the one exception to "same actions,
     * same rows" above.
     *
     * It was unconditional, on the reasoning that rebooking corrects a
     * mistaken outcome. It does not: nothing in this menu undoes "held", so
     * changing the date never un-held anything. And on a package billed per
     * meeting, marking one held RAISES AND EMAILS ITS INVOICE — moving the
     * date afterwards leaves the booking and the client's invoice on two
     * different days.
     *
     * Then CALLED OFF was separated from MISSED, which this file previously
     * treated as one case. They are not: a missed session is nobody's
     * decision and another attempt at it is the ordinary next move, while a
     * called-off one is the owner's decision that the hour is not happening —
     * already announced to the client — and offering to move it invites
     * undoing that through a control that says something else.
     */
    expect(actions).toMatch(/const held = status === 'completed' \|\| meetingStatus === 'held'/);
    // Wrapped and three-termed since the package cascade: a meeting on a
    // CANCELLED BOOKING is called off too, so `|| bookingCancelled` joined it.
    // The rule held here is that both status columns are consulted, not the
    // exact line break or the full list of terms.
    expect(actions).toMatch(
      /const calledOff =\s*\n?\s*status === 'cancelled' \|\| meetingStatus === 'cancelled'/
    );
    expect(actions).toMatch(/if \(onReschedule && !held && !calledOff\)/);
  });

  it('but a MISSED one still moves', () => {
    /* The client did not turn up; rebooking is what happens next. */
    const gate = actions.slice(actions.indexOf('const held = status'));
    expect(gate.slice(0, gate.indexOf('items.push'))).not.toContain("'no_show'");
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
    /*
     * Bounded by the TABLE's own end, not by a character count.
     *
     * It was `start + 4200`, twice widened by hand — each time because a
     * comment had been written between this anchor and the markup, and the
     * window no longer reached it. The third time it failed over thirty lines
     * of notes explaining a layout fix, with the table itself untouched.
     *
     * A count of characters is not a description of anything. The element is,
     * and it cannot go stale: whatever is added above the table, the span from
     * the anchor to `</table>` still contains the container, its className and
     * the table.
     */
    const closed = tab.indexOf('</table>', start);
    expect(closed).toBeGreaterThan(-1);
    const container = tab.slice(start, closed);

    /*
     * Stated as the rule rather than as one exact className: the list has been
     * restyled since — rows carry their own separators and the head and foot
     * round their own corners — and pinning the string failed on a change that
     * kept the guarantee. What must never come back is the clipping.
     */
    /*
     * The list is a `<table>` now — six separate grids could never share a
     * column width — but the rule is unchanged and is the only thing pinned:
     * no clipping ancestor, or the ⋯ menu is cut to a strip.
     */
    expect(container).toMatch(/<table/);
    expect(container).not.toMatch(/className="[^"]*overflow-hidden/);
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

describe('the series reads as a table', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * It was six CSS grids, one per row, and an `auto` column sizes itself from
   * the row it is in — so every row put its state and its figure at a
   * different x, and the header's empty leading cells collapsed to nothing
   * while the rows' dot and number did not. Columns share a width only when
   * they share a grid, or a table.
   *
   * `flex-wrap` before that let a row drop its money to a second line, each at
   * a different moment. Both are the same complaint: six meetings reading as
   * six differently-shaped sentences.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('is one table, not a grid per row', () => {
    expect(tab).toMatch(/<table/);
    expect(tab).toContain('borderCollapse');
    expect(tab).not.toContain("grid-cols-[auto_auto_auto_minmax(0,1fr)_auto_1.75rem]");
  });

  it('gives the session row real cells', () => {
    const anchor = tab.indexOf('key={row.id}');
    expect(anchor).toBeGreaterThan(-1);

    const openedAt = tab.lastIndexOf('<tr', anchor);
    expect(openedAt).toBeGreaterThan(-1);
    /* Past the row's own className and style, to its first cell. */
    expect(tab.slice(openedAt, anchor + 1400)).toContain('<td');
  });

  it('keeps the date on one line, and lets only the money wrap', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * Both cells were pinned as `whitespace-nowrap`, and the table has since
     * been given `table-layout: fixed` — so a column can no longer widen for
     * its content, and a cell that may not wrap draws OUTSIDE its own box
     * instead. That is what sent this table off the end of the drawer, and
     * what made the headings look misaligned in Hebrew while the head was
     * blameless.
     *
     * The DATE still may not wrap, and this still says so: `truncate` is
     * `white-space: nowrap` plus an ellipsis, so it keeps the guarantee this
     * test was written for and adds an end to it.
     *
     * The MONEY is now the one cell allowed a second line. Its length has no
     * ceiling — a partial refund names what was charged AND what came back —
     * so it was the cell least able to promise one line. A wrap changes a
     * row's height; it cannot move a column, which is what made the old
     * flex-wrap version unreadable and is the thing actually worth guarding.
     * ───────────────────────────────────────────────────────────────────────
     */
    expect(tab).toContain('truncate px-1 py-2.5 align-middle text-[12.5px]');
    expect(tab).toContain('px-1 py-2.5 text-end align-middle text-[11.5px] tabular-nums');
    expect(tab).not.toContain('whitespace-nowrap px-1 py-2.5 text-end');
  });

  it('names its columns once, at the top', () => {
    expect(tab).toContain('crm.booking.package.col_when');
    expect(tab).toContain('crm.booking.package.col_state');
    expect(tab).toContain('crm.booking.package.col_payment');
    expect(tab).toContain('<thead>');
  });

  it('separates rows with a hairline rather than a gap', () => {
    expect(tab).toContain('meetingIndex === 0');
    expect(tab).toContain("'1px solid var(--v2-border)'");
  });

  it('keeps the actions column even on a row with no menu', () => {
    /*
     * A cancelled session has no ⋯ at all. A cell that collapses for it steps
     * the row's right edge in, so rows end on different edges — which is what
     * a fixed width on that column prevents.
     */
    /*
     * The number moved from `w-7` to `w-14` to `w-[64px]` as the list was
     * rebuilt, and this assertion stayed on the first of them, so it has been
     * red through two rewrites of the thing it guards.
     *
     * The current figure is binding in a way the earlier ones were not: under
     * `table-layout: fixed` the declared width IS the column, and
     * `box-sizing: border-box` takes the `px-3` out of it, so 64 leaves 40 for
     * the menu button. What matters, and what this still pins, is that the
     * cell is always there with a width of its own.
     */
    expect(tab).toContain('className="w-[64px] px-3 py-2.5 align-middle"');
  });

  it('names the columns in every language', () => {
    for (const file of ['en', 'he', 'es']) {
      const dict = read(`lib/business-os/translations/${file}.ts`);
      expect(dict).toContain('crm.booking.package.col_when');
      expect(dict).toContain('crm.booking.package.col_payment');
    }
  });
});

describe('the table totals what is left to collect', () => {
  /*
   * A package stops adding up the moment a session is called off: six at
   * 133.33 was 800, and with three off it is 533.34. Nothing on the card said
   * so — the owner had to read six rows, notice which were struck through, and
   * do the arithmetic.
   */
  it('is a row of the same table, sharing its columns', () => {
    /*
     * A line underneath would not sit beneath the figures it sums. As a row of
     * the table it cannot drift: the columns are the table's.
     */
    const block = tab.slice(0, tab.indexOf('left_to_collect'));
    expect(block.lastIndexOf('<tr')).toBeGreaterThan(block.lastIndexOf('</table>'));
    expect(tab).toContain('colSpan={2}');
  });

  it('counts only what can still bill', () => {
    /* A called-off session has no stage left to show, so it contributes
       nothing rather than being subtracted. */
    expect(tab).toContain("p.status !== 'paid' && p.status !== 'refunded'");
  });

  it('says how many were called off, when any were', () => {
    expect(tab).toContain('sessions_off');
    /*
     * Counted from the sessions actually CALLED OFF, not by subtracting the
     * billable ones from the total. The subtraction counted every session with
     * no stage to bill — including ones nobody had cancelled and nobody was
     * being charged for — and reported them to the owner as cancellations. The
     * code already says so above `dropped`; this had not caught up.
     */
    expect(tab).toContain("m.booking.meeting_status === 'cancelled'");
    expect(tab).not.toContain('session.meetings.length - money.length');
  });

  it('shows nothing for a package that is not billed per session', () => {
    /* No figures above means nothing to total, and an empty row would read as
       a missing number. */
    expect(tab).toContain('if (money.length === 0) return null;');
  });

  it('names the sum in every language', () => {
    for (const file of ['en', 'he', 'es']) {
      const dict = read(`lib/business-os/translations/${file}.ts`);
      expect(dict).toContain('crm.booking.package.left_to_collect');
      expect(dict).toContain('crm.booking.package.sessions_off');
    }
  });
});
