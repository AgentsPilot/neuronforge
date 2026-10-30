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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT HAS TO NAME THE *RIGHT* BOOKING
 *
 * The note at the top of this file is still true — the token names a booking,
 * not a meeting. What it did not cover is WHICH booking, because when it was
 * written the portal read one container and there was only ever one answer.
 *
 * It now reads several (`.in('booking_id', containerIds)`), so a consultation
 * can hand over more than one package. The token was still minted from the
 * PAGE's container, so any session living in a sold container was handed a
 * token naming booking A beside a `meetingId` belonging to booking B — and
 * `sessionOf`, whose entire job is to refuse exactly that pairing, refused it.
 *
 * The client saw "could not reschedule, please try again" on every attempt, on
 * a refusal no retry could ever clear. The security property is unchanged and
 * was never the thing at fault; the caller was simply naming the wrong booking.
 */
describe('the token names the session\'s own container', () => {
  const manage = code('app/api/book/manage/[token]/route.ts');

  /* The block that builds a SESSION row — the one `.in(...)` feeds. */
  const sessionRows = manage.slice(manage.indexOf("in('booking_id', containerIds)"));
  const built = sessionRows.slice(0, sessionRows.indexOf('isCurrent: false'));

  it('mints it from the row\'s own booking, not the page\'s container', () => {
    expect(built).toContain('generateBookingToken(String(row.booking_id)');
  });

  it('never mints a session token from the page\'s container', () => {
    /* The regression in one line: `containerId` is the booking whose link the
       client opened, which is not necessarily the one holding this session. */
    expect(built).not.toContain('generateBookingToken(containerId');
  });

  it('still sends the session beside it, so the route can check the pair', () => {
    expect(built).toContain('meetingId: row.id');
  });
});

describe('a refusal says which refusal it is', () => {
  /* Every `success: false` the panel cannot name falls through
     `rescheduleErrorText` to "please try again" — advice that is wrong for
     every one of them. The booking-mismatch 404 carried no `code` at all. */
  it('the not-mine 404 carries a code', () => {
    const notMine = route.slice(route.indexOf('if (notMine)'));
    expect(notMine.slice(0, notMine.indexOf('}'))).toContain("code: 'not_found'");
  });

  it('and does so on both the read and the write path', () => {
    expect(route.match(/if \(notMine\)/g)?.length).toBe(2);
    expect(route.match(/code: 'not_found'/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE MOVE LIMIT REACHES A SESSION AT ALL
 *
 * `CLIENT_RESCHEDULE_LIMIT` is counted from `crm_activities`, and the session
 * branch of the POST answers and returns BEFORE the activity write the booking
 * path ends with. So the count read zero however many times a client had moved
 * a package session, and the limit — the thing standing between a client and
 * pushing an appointment until the invoice is never chased — did nothing at
 * all for packages.
 *
 * The meetings table already held the answer: a move marks the old row `moved`
 * and stamps `moved_by`, and the portal names `'client'`. So this is counted
 * there, per session, with no new column and nothing to migrate.
 */
describe('a client cannot move one session forever', () => {
  const count = route.slice(route.indexOf('async function clientSessionMoveCount'));
  const body = count.slice(0, count.indexOf('\n}'));

  it('counts the attempts on the meetings table, not the timeline', () => {
    expect(body).toContain("from('scheduling_meetings')");
    expect(body).toContain("eq('meeting_status', 'moved')");
  });

  it('counts THIS session, not the whole purchase', () => {
    /* The difference from the booking rule: three appointments sold together
       get an allowance each, not two shared and a frozen third. */
    expect(body).toContain("eq('booking_id', bookingId)");
    expect(body).toContain("eq('session_number', sessionNumber)");
  });

  it('counts the CLIENT only — the owner may move it as often as they like', () => {
    expect(body).toContain("eq('moved_by', 'client')");
  });

  it('is scoped to the owner — CLAUDE.md rule 4', () => {
    expect(body).toContain(".eq('user_id', userId)");
  });

  it('fails open, like the booking count it sits beside', () => {
    expect(body).toContain('return 0;');
  });

  it('both the page that states the rule and the write that enforces it ask once', () => {
    /* Two call sites, one answer. A GET that leads with "you have moves left"
       and a POST that then refuses is the rudest shape this can take. */
    expect(route.match(/await movesUsed\(/g)?.length).toBe(2);
    expect(route).toMatch(/const usedMoves = await movesUsed\(/);
    expect(route).toMatch(/const movesSoFar = await movesUsed\(/);
  });

  it('and a booking with no session keeps the rule it always had', () => {
    const picker = route.slice(route.indexOf('async function movesUsed'));
    expect(picker.slice(0, picker.indexOf('\n}'))).toContain('return clientMoveCount(userId, bookingId);');
  });
});

describe('what the client is told when the limit is reached', () => {
  const copy = read('lib/i18n/public-pages.ts');

  it('calls it an appointment, which a session also is', () => {
    /* "This booking has already been moved" is wrong for a package session —
       a session is not a booking, and no client would call it one. */
    expect(copy).toContain('This appointment has already been moved {limit} times');
    expect(copy).not.toContain('This booking has already been moved {limit} times');
  });

  it('says it in all three languages', () => {
    expect(copy).toContain('Esta cita ya se ha movido {limit} veces');
    expect(copy).toContain('כבר העברת את הפגישה הזאת {limit} פעמים');
  });

  it('and the number comes from the server, not a guess', () => {
    const panel = code('components/public/ReschedulePanel.tsx');
    expect(panel).toContain("t('rescheduleLimit', { limit: String(data.limit");
  });
});
