/**
 * A missed session is rebookable by the client WHEN THE OWNER INVITED THEM.
 * A held or cancelled one never is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE MOVED ONCE, DELIBERATELY
 *
 * This file originally pinned "a missed session is always rebookable", which
 * fixed the bug described below. It was then narrowed: the owner's no-show
 * dialog offers three answers — leave it, invite the client to pick, or book a
 * make-up — and only the middle one hands the next move to the client. That
 * answer is now recorded as `rebook_invited_at`, and the client's button and
 * the client's write both key on it.
 *
 * Both rules are still here. The ORIGINAL bug — a blanket refusal of every
 * outcome — is pinned by "has no rule that refuses every outcome"; the new one
 * by "refuses a missed session only where the owner did not invite them".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ON SCREEN (ClickUp 868mqzdty)
 *
 * On a pay-as-you-go quotation the owner marks a meeting missed and picks
 * "rebook meeting". The client gets the mail, opens the link, is shown every
 * free slot, picks one, presses Confirm, and is told:
 *
 *     "This booking is no longer open for changes."
 *
 * Nothing had closed. The product had just invited them to rebook.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT: TWO COPIES OF ONE RULE, DISAGREEING
 *
 * POST carried a guard of its own, thirty lines above the real one:
 *
 *     if (session && session.meeting_status !== null) → not_reschedulable
 *
 * `!== null` refuses EVERY outcome, `no_show` included, and being first it
 * short-circuited the correct guard below. Three other places in this codebase
 * say the opposite, and two of them are in the same file:
 *
 *   · GET, same file — `held || cancelled`, with the comment "`no_show` passes
 *     deliberately — a missed appointment is unresolved, and the client picking
 *     another time is the right next move";
 *   · POST, same file, the guard that was being skipped — identical rule;
 *   · the owner's `meetings/[id]/reschedule` — "A MISSED session is
 *     deliberately not here — nobody decided anything, and another attempt at
 *     it is the ordinary next move."
 *
 * Packages only, because the dead rule was gated on `session` being present. A
 * single-meeting booking has no session row, which is why ordinary bookings
 * never showed it and why it reached a customer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND A SECOND, SMALLER GAP ON THE READ
 *
 * GET had the right rule about `no_show` but asked it of the PURCHASE, so for a
 * session already held or cancelled it drew a full calendar and let the client
 * choose before POST refused them. Same "shown the slots, then refused" shape,
 * reached by the other two statuses. Both handlers now resolve the outcome the
 * same way; POST is still the guard, GET is the courtesy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Reaching the branch for real needs a portal token, a package booking, a
 * meeting row and a settled outcome — four fixtures to assert which statuses a
 * comparison accepts. The thing that broke was textual and stays textual: a
 * second copy of a rule. This asserts there is ONE, and that it enumerates the
 * two settled states rather than testing for "any outcome".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

/** Comments stripped: this file asserts on code, and the prose repeats it. */
const code = (p: string) =>
  fs
    .readFileSync(path.join(process.cwd(), p), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const CLIENT_ROUTE = 'app/api/book/manage/[token]/reschedule/route.ts';
const OWNER_ROUTE = 'app/api/scheduling/meetings/[id]/reschedule/route.ts';

const client = code(CLIENT_ROUTE);
const owner = code(OWNER_ROUTE);

describe('the client route refuses only a settled session', () => {
  it('has no rule that refuses every outcome', () => {
    /*
     * THE BUG, as one assertion. Any test for "has an outcome at all" sweeps up
     * `no_show`, which is the one outcome that must still be movable.
     */
    expect(client).not.toMatch(/meeting_status\s*!==\s*null/);
    expect(client).not.toMatch(/meeting_status\s*!=\s*null/);
  });

  it('enumerates the two states that really are settled, in both handlers', () => {
    const settled = client.match(/=== 'held' \|\| \w+(\.\w+)? === 'cancelled'/g) ?? [];

    /* One in GET, one in POST. Both read as an enumeration, not a null test. */
    expect(settled.length).toBe(2);
  });

  it('asks the same question on the read as on the write', () => {
    /*
     * GET read the PURCHASE's status only, so on a package it drew a full
     * calendar for a meeting already held or called off and let the client
     * pick before POST refused them — the same "shown the slots, then
     * refused" shape as the no-show bug, reached by the other two statuses.
     *
     * Two occurrences: the read and the write resolve the outcome identically.
     * A surface that offers what the server will refuse is how this class of
     * defect reaches a customer.
     */
    const resolved = client.match(
      /session \? session\.meeting_status : booking\.meeting_status/g
    ) ?? [];

    expect(resolved.length).toBe(2);
  });

  it('refuses a missed session only where the owner did not invite them', () => {
    /*
     * ── THE POLICY THIS FILE USED TO PIN, AND WHY IT CHANGED ───────────────
     *
     * It asserted that a missed session is NEVER refused: the hour is
     * unresolved, so let the client pick another. True of the state, and
     * false of the decision — the owner's dialog asks what happens next, and
     * two of its three answers are "I am handling it" and "leave it for now".
     *
     * Nothing recorded that answer, so every missed session was offered a
     * Change-date button. An owner who charged for a no-show and deliberately
     * added no make-up found the client invited to rearrange an hour they had
     * already paid for.
     *
     * So the refusal is allowed now, and bounded: it must be paired with the
     * invitation, never written on `no_show` alone. That pairing IS the rule,
     * which is why it is asserted as one expression rather than as the absence
     * of a string.
     */
    expect(client).toMatch(
      /settledStatus === 'no_show' &&\s*!session\?\.rebook_invited_at/
    );

    /* And never unconditionally: a bare `no_show` in the settled test would be
       the old blanket refusal wearing the new rule's clothes. */
    expect(client).not.toMatch(/settledStatus === 'no_show'(?!\s*&&)/);
  });

  it('reads the invitation from the session row, or the guard is always true', () => {
    /* `rebook_invited_at` unselected would make every missed session look
       uninvited, which is the blanket refusal by accident. */
    expect(client).toMatch(/rebook_invited_at/);
  });

  it('routes a missed session to the make-up path instead', () => {
    /*
     * The other half of the same rule, and the reason the string above is now
     * allowed to appear. Moving a `no_show` left two live rows on one session
     * number, because `move_meeting` will not stamp `moved` over a recorded
     * outcome — so the missed row and its money disappeared from every reader.
     */
    expect(client).toMatch(/session\.meeting_status === 'no_show'/);
    expect(client).toMatch(/bookMakeUpSession\(/);
  });
});

describe("the session's own outcome is the one consulted", () => {
  it('both handlers read the session row when there is one', () => {
    /*
     * The guard used to read `booking.meeting_status` only, so even with the
     * dead rule removed a package would have been judged by its parent's
     * status rather than by the meeting the client is actually moving.
     */
    expect(client).toMatch(/session \? session\.meeting_status : booking\.meeting_status/);
  });

  it('never judges a session by its purchase', () => {
    /* The parent's own status answers a different question, and
       `booking.status !== 'confirmed'` already asks that one. */
    expect(client).not.toMatch(/booking\.meeting_status === '/);
  });

  it('answers with which state it was, for the client page to phrase', () => {
    /* `already_settled` alone cannot say "took place" versus "was cancelled";
       `ReschedulePanel` maps on this field, not on the code. */
    expect(client).toMatch(/meetingStatus: settledStatus/);
  });
});

describe('the owner and the client agree', () => {
  it('both refuse held', () => {
    expect(owner).toMatch(/meeting_status === 'held'/);
    expect(client).toMatch(/=== 'held'/);
  });

  it('both refuse cancelled', () => {
    expect(owner).toMatch(/meeting_status === 'cancelled'/);
    expect(client).toMatch(/=== 'cancelled'/);
  });

  it('the owner is never refused a missed one', () => {
    /*
     * Unchanged, and the half that still holds: the owner's menu offers to
     * rebook a missed session, and the owner's route must not refuse it.
     *
     * The CLIENT's half moved — see the settled test above. The owner decides
     * whether the client may rearrange it, which is a different question from
     * whether the owner may.
     */
    expect(owner).not.toMatch(/=== 'no_show'/);
  });
});
