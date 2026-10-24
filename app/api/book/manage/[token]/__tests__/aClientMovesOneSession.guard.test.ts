/**
 * A client moving ONE session of a package.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS MISSING
 *
 * Under the old shape each session of a package was its own booking, so it had
 * its own portal link and a client could move or cancel any of them. A package
 * is now one booking with N meetings, and a session has no booking — so the
 * reschedule route, which takes a booking id, could not reach one. The
 * capability was lost in the split.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHY THE TOKEN STILL NAMES THE PURCHASE
 *
 * A session has no token of its own. Minting one for a meeting id would make a
 * second kind of credential that `resolvePortalAccess` would have to learn,
 * and every surface that trades a token for a grant cookie with it.
 *
 * So the token goes on naming the BOOKING — one this request has proved the
 * caller holds a link to — and the session travels beside it. The route checks
 * the meeting belongs to that booking, which is what stops a link to one
 * package reaching another's hours. That check is the whole security property
 * and is what this file is mostly about.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');

/** Comments stripped: this file asserts on code, and the prose repeats it. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const route = code('app/api/book/manage/[token]/reschedule/route.ts');

describe('the session has to belong to the booking the token names', () => {
  const check = route.slice(route.indexOf('async function sessionOf'));
  const body = check.slice(0, check.indexOf('\n}'));

  it('reads the meeting scoped to the owner — CLAUDE.md rule 4', () => {
    expect(body).toContain(".eq('user_id', userId)");
  });

  it('refuses a meeting that is not this booking\'s', () => {
    /*
     * THE security property. Without it, any client holding any portal link
     * could move any session in the business by passing its id.
     */
    expect(body).toContain('String(data.booking_id) !== bookingId');
  });

  it('answers the same as a missing booking, so nothing is leaked', () => {
    /* Telling a caller that an id exists but is not theirs is an answer about
       somebody else's data. */
    expect(body).toContain('notMine: true');
  });

  it('and both handlers act on that answer', () => {
    /* A check nobody reads is not a check. Both the GET that lists slots and
       the POST that writes must 404 on it. */
    const refusals = route.split("if (notMine)").length - 1;
    expect(refusals).toBe(2);
  });
});

describe('moving the session, not its purchase', () => {
  const post = route.slice(route.indexOf('export async function POST'));

  it('moves the MEETING when one was named', () => {
    /*
     * `rescheduleBooking` changes a booking's clock. A package's booking is
     * the purchase and has none, so for a session it would move nothing and
     * report success.
     */
    expect(post).toContain('moveMeeting(');
  });

  it('records the client as the one who moved it', () => {
    /* The journey said "you changed the time" for every move, including the
       ones a client made themselves (20261082). */
    expect(post).toMatch(/moveMeeting\([\s\S]{0,200}'client'/);
  });

  it('still moves an ordinary booking the way it always did', () => {
    /* Every booking that is not a package session reaches the same call. */
    expect(post).toContain('rescheduleBooking({');
  });

  it('measures the notice window against the SESSION, not the purchase', () => {
    /*
     * A purchase has no clock, so `new Date(undefined)` is Invalid Date and
     * every comparison against it is false — which would let a client move an
     * hour starting in ten minutes.
     */
    expect(post).toContain("session ? String(session.start_time)");
  });

  it('refuses a session whose outcome is already recorded', () => {
    /* The row says what happened at an hour; moving it would lose that. */
    expect(post).toContain('session.meeting_status !== null');
  });

  it('tells the client the hour is gone rather than reporting a fault', () => {
    expect(post).toContain('isSlotTakenError');
    expect(post).toContain("code: 'slot_taken'");
  });
});

describe('the panel and the row that reach it', () => {
  const panel = code('components/public/ReschedulePanel.tsx');
  const rows = code('components/public/PortalMeetings.tsx');

  it('the panel carries the session on both the read and the write', () => {
    /* Reading without it loads the purchase's clock — there is none — and
       writing without it moves nothing. */
    expect(panel).toContain('meeting_id=');
    expect(panel).toContain('{ meetingId }');
  });

  it('the panel reloads when the session changes', () => {
    /* Opening session four's panel after session two's must not keep session
       two's slots, or a client moves the hour they were not looking at. */
    expect(panel).toContain('[token, meetingId]');
  });

  it('a moved session can report its new hour without a booking', () => {
    /* There is no booking whose time changed, so `data.booking.startTime`
       threw and left the client on a failed screen after a successful move. */
    expect(panel).toContain('data.newStartTime');
  });

  it('a session row opens the purchase, with the session named', () => {
    expect(rows).toContain('task=reschedule&session=');
  });

  it('and is not offered at all when it cannot be moved', () => {
    /* `canModify` carries the same three conditions the route enforces, so the
       page never offers a change that is about to be refused. */
    expect(rows).toContain('!meeting.meetingId || meeting.canModify');
  });
});
