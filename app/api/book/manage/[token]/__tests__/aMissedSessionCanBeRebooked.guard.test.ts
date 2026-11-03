/**
 * A missed session is rebookable by the client. A held or cancelled one is not.
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

  it('never names no_show as a reason to refuse', () => {
    /* The product's position in three places. A refusal on it would contradict
       the mail the owner just sent. */
    expect(client).not.toMatch(/=== 'no_show'/);
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

  it('neither refuses a missed one', () => {
    /*
     * The two halves of the same journey. The owner's menu offers "rebook
     * meeting" on a missed session; this is what makes the link it sends
     * actually work.
     */
    expect(owner).not.toMatch(/=== 'no_show'/);
    expect(client).not.toMatch(/=== 'no_show'/);
  });
});
