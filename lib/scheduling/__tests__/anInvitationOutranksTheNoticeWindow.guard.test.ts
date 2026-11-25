/**
 * A rebooking the owner asked for is not refused on the owner's behalf.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT QA RAISED
 *
 * "In case the owner decides to mark as no-show and let the client set [a new
 * time], we apply the 24h cannot-reschedule. The problem — if the owner is
 * offering to reschedule the restriction should not exist. If the customer
 * does, 24h is ok to apply."
 *
 * That is the whole rule, and it is right. The notice window exists to stop a
 * CLIENT moving an appointment the business is already planning around. It has
 * no business standing between an owner and a client the owner has just
 * invited to pick another hour — and the owner's own reschedule route has no
 * notice rule at all, so applying one here refuses on their behalf something
 * they have already agreed to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND A SECOND FAULT UNDERNEATH IT, WHICH IS WHY THE ERRORS VARIED
 *
 * A mailed link carries no meeting id, so the route falls back to "the hour
 * this booking currently means". That read `ORDER BY occurrence_number DESC
 * LIMIT 1` — the NEWEST row — which is the right answer for an ordinary link
 * and the wrong one for this mail.
 *
 * A missed hour stays where it is in the sequence. Anything that happens on the
 * booking afterwards becomes newer than it, so the link comes to mean a meeting
 * the client was never written to about. Live case, booking 9619d707 ("GYM time
 * multi PAY", paid, 24h notice):
 *
 *   occurrence 1   Wed 18 Nov 12:00   no_show   ← what the mail was about
 *   occurrence 2   Thu 19 Nov 10:00   held      ← what the link resolved to
 *
 * Every rule below is then measured against the wrong meeting, which is why one
 * report says "that meeting has already taken place" and another says "you must
 * give 24 hours' notice" — about an appointment nobody is trying to move. Both
 * are the same defect wearing whatever the newest row happened to be.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE PIECES, AND WHY NONE OF THEM WORKS ALONE
 *
 *   1. the no-show route STAMPS `rebook_invited_at` when the owner chooses
 *      "let the client pick a time" — without it there is no invitation to read
 *   2. the portal RESOLVES the link to the stamped hour, not the newest one
 *   3. the notice window STANDS ASIDE for a stamped hour
 *
 * Fix 3 alone leaves the link pointing at the wrong meeting. Fix 2 alone leaves
 * the client refused for 24 hours' notice on the hour they were invited to
 * rearrange. Fix 1 alone leaves both of the others with nothing to read.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const PORTAL = 'app/api/book/manage/[token]/reschedule/route.ts';
const NO_SHOW = 'app/api/scheduling/bookings/[id]/no-show/route.ts';
const OWNER = 'app/api/scheduling/meetings/[id]/reschedule/route.ts';

/** Source with comments removed, so these notes cannot satisfy a match. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the invitation is recorded', () => {
  const noShow = code(read(NO_SHOW));

  it('when the owner chooses to let the client pick a time', () => {
    expect(noShow).toContain('rebook_invited_at: new Date().toISOString()');
  });

  it('and only then', () => {
    /* `notifyClient` IS the owner's answer. Stamping unconditionally would
       open a missed hour the owner is handling themselves, or has already
       charged for. */
    const guarded = noShow.slice(noShow.indexOf('if (notifyClient) {'));
    expect(guarded).toContain('rebook_invited_at: new Date().toISOString()');
  });
});

describe('the link means the hour the mail was about', () => {
  const portal = code(read(PORTAL));

  const fallback = portal.slice(
    portal.indexOf('async function currentHourOf('),
    portal.indexOf('export async function GET(')
  );

  it('an invited missed hour is looked for first', () => {
    expect(fallback).toContain(".eq('meeting_status', 'no_show')");
    expect(fallback).toContain(".not('rebook_invited_at', 'is', null)");
    expect(fallback).toContain('if (invited?.[0]) return invited[0] as Record<string, unknown>;');
  });

  it('BEFORE the newest-row fallback, which is what it corrects', () => {
    /*
     * Order is the fix. Newest-first run first would return the `held` meeting
     * on the live booking above and the invitation would never be reached.
     */
    expect(fallback.indexOf(".not('rebook_invited_at', 'is', null)")).toBeLessThan(
      fallback.indexOf(".not('meeting_status', 'eq', 'moved')")
    );
  });

  it('and the ordinary link still resolves exactly as it did', () => {
    /* A booking with no invitation falls through to the original query, so
       every link that worked before this still means the same hour. */
    expect(fallback).toContain(".not('meeting_status', 'eq', 'moved')");
    expect(fallback).toContain(".order('occurrence_number', { ascending: false })");
  });

  it('reading `occurrence_number`, which it orders by', () => {
    /* It ordered by a column it did not select. Harmless in PostgREST and a
       trap for the next reader, who cannot see what the order is on. */
    expect(fallback).toContain('occurrence_number, rebook_invited_at');
  });
});

describe('the notice window stands aside for an invitation', () => {
  const portal = code(read(PORTAL));

  it('in BOTH handlers, because either can be the one that refuses', () => {
    /*
     * GET draws the diary and POST commits the move. A client exempted by one
     * and refused by the other is shown every free hour and turned away at the
     * last step — which is a worse experience than a clean refusal.
     */
    const exempted = portal.match(
      /if \(!invitedByOwner && hoursUntilBooking > 0 && hoursUntilBooking < noticeHours\) \{/g
    );
    expect(exempted ?? []).toHaveLength(2);
  });

  it('read from the hour being rearranged, not from the booking', () => {
    const reads = portal.match(/const invitedByOwner = Boolean\(session\?\.rebook_invited_at\);/g);
    expect(reads ?? []).toHaveLength(2);
  });

  it('while an uninvited client still gives notice', () => {
    /*
     * The narrow half, and the one worth protecting. Dropping the window
     * outright would let any client move any appointment at any time — the
     * behaviour this rule exists to prevent, and NOT what QA asked for:
     * "if the customer does, 24h is ok to apply".
     */
    expect(portal).toContain('hoursUntilBooking > 0 && hoursUntilBooking < noticeHours');
    expect(portal).not.toMatch(/if \(false[\s\S]{0,40}noticeHours\)/);
  });

  it('and the window is still the service’s own, not a hardcoded day', () => {
    expect(portal).toContain('min_notice_hours ?? 24');
  });
});

describe('the asymmetry this rests on', () => {
  it('the owner’s own reschedule has no notice rule at all', () => {
    /*
     * This is what makes the exemption coherent rather than a hole: the owner
     * may move an appointment whenever they like, so a rebooking they asked
     * for being refused for notice is the portal contradicting the rest of the
     * product. If a notice rule is ever added there, this reasoning changes
     * and the exemption must be revisited rather than quietly kept.
     */
    const owner = code(read(OWNER));

    expect(owner).not.toContain('min_notice_hours');
    expect(owner).not.toContain('too_late');
  });
});
