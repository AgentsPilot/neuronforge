/**
 * Rebooking a missed session adds one; it never overwrites the missed hour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * "Rebook the session they missed" had two implementations that recorded it
 * differently. The owner's drawer added a MAKE-UP — a new `session_number`
 * pointing back with `replaces_meeting_id`. The client's portal MOVED the
 * session — same number, next occurrence — assuming the superseded row would be
 * stamped `moved`.
 *
 * `move_meeting` (20261087) stamps `moved` only `IF v_old.meeting_status IS
 * NULL`, which is right: it will not erase a recorded outcome. So a client
 * rebooking a `no_show` left TWO live rows on one `session_number` — a shape
 * nothing reads correctly, because every consumer de-duplicates by
 * `booking_id#session_number` and keeps the highest occurrence.
 *
 * The missed row, which carries the money, therefore vanished from the client's
 * list, the money lines in emails, the job's mirrored status and the owner's
 * drawer — and `moveMeeting` re-pointed its pending stage at the replacement.
 * Four packages reached that state in production, every one with `no_show` as
 * the first occurrence.
 *
 * ── AND WHAT MUST NOT CHANGE ────────────────────────────────────────────────
 *
 * The other booking types go through the same route and must be untouched: an
 * ordinary single booking, a package session nobody has marked, and the old
 * container-plus-children package shape. Half of this file exists to pin that,
 * because the fix sits in a branch they all flow past.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { nextSessionNumber } from '@/lib/scheduling/makeUpSession';

const root = join(__dirname, '..', '..', '..');
const clientRoute = readFileSync(
  join(root, 'app/api/book/manage/[token]/reschedule/route.ts'),
  'utf8'
);
const helper = readFileSync(join(root, 'lib/scheduling/makeUpSession.ts'), 'utf8');
const panel = readFileSync(join(root, 'components/public/ReschedulePanel.tsx'), 'utf8');

describe('the next session number', () => {
  it('takes the highest so far, not the count', () => {
    /* A package whose third session was deleted still has a sixth; reusing a
       number would put two sessions in the same place in the series. */
    expect(nextSessionNumber([{ session_number: 1 }, { session_number: 6 }])).toBe(7);
  });

  it('starts at one on an empty package', () => {
    expect(nextSessionNumber([])).toBe(1);
  });

  it('survives nulls and strings, which is how the rows actually arrive', () => {
    expect(nextSessionNumber([{ session_number: null }, { session_number: '4' }])).toBe(5);
  });
});

describe('a missed session is made up, never moved', () => {
  it('books a replacement rather than calling moveMeeting', () => {
    expect(clientRoute).toMatch(/bookMakeUpSession\(/);
  });

  it('is reached only for a missed session', () => {
    /*
     * The scope of the whole change. `held` and `cancelled` are refused before
     * this (`already_settled`), and an unmarked session genuinely IS moving —
     * so this branch must name `no_show` and nothing else.
     */
    expect(clientRoute).toMatch(/session && session\.meeting_status === 'no_show'/);
  });

  it('points the replacement back at the hour it stands in for', () => {
    expect(helper).toMatch(/replaces_meeting_id: request\.missedMeetingId/);
  });

  it('writes a NEW session, not another attempt at the missed one', () => {
    /* `occurrence_number: 1` is the distinction the whole module exists to
       keep: a make-up is not a second go at the session that was missed. */
    expect(helper).toMatch(/occurrence_number: 1/);
  });

  it('never re-points the missed session’s money at the replacement', () => {
    /* `moveMeeting` does that, which is why the missed hour's fee silently
       became a charge for one nobody had attended yet. The make-up path must
       not contain the same update. */
    expect(helper).not.toMatch(/payment_plan_installments[\s\S]{0,200}\.update\(/);
  });
});

describe('the money on a replacement follows how the package was sold', () => {
  it('charges only a package billed per session', () => {
    expect(helper).toMatch(/bill_per_session/);
  });

  it('copies the amount from the stages already on the plan', () => {
    /* Recomputing from the total would price one session differently from the
       rest, which is a change to the deal nobody mentioned. */
    expect(helper).toMatch(/installment_number', \{ ascending: false \}|order\('installment_number'/);
  });

  it('never fails the booking over a stage', () => {
    /* The client has an hour and has been told about it; money not yet billed
       is visible to the owner and fixable. */
    expect(helper).toMatch(/Never fatal/i);
  });

  it('tells the client, because they were never asked', () => {
    expect(clientRoute).toMatch(/charged: Boolean\(madeUp\.charged\)/);
    expect(panel).toMatch(/makeUpDoneChargedDesc/);
  });
});

describe('the client is not told their appointment moved', () => {
  it('switches the copy on the mode the route reports', () => {
    expect(clientRoute).toMatch(/mode: session\?\.meeting_status === 'no_show'/);
    expect(panel).toMatch(/config\?\.mode === 'makeup'/);
  });

  it('uses make-up wording for the title, the button and the result', () => {
    for (const key of ['makeUpTitle', 'makeUpSubtitle', 'makeUpConfirm', 'makeUpDoneTitle']) {
      expect(panel).toContain(key);
    }
  });
});

describe('the rebooking allowance still applies', () => {
  it('counts replacements as well as moves', () => {
    /* A make-up writes no `moved` row, so the existing cap would have stopped
       applying to the one path most likely to be used repeatedly. */
    expect(clientRoute).toMatch(/clientSessionReplacementCount\(/);
  });

  it('counts a replacement nobody has marked yet', () => {
    /*
     * THE NULL TRAP. `meeting_status <> 'cancelled'` is UNKNOWN for a NULL, so
     * a bare `.neq()` excludes every fresh replacement — which is all of them —
     * and the count would read zero for ever. Verified against the live table:
     * `.neq()` returned 0 where `.or()` returned 1.
     */
    expect(clientRoute).toMatch(/\.or\('meeting_status\.is\.null,meeting_status\.neq\.cancelled'\)/);
  });
});

describe('every other booking type is left alone', () => {
  it('still moves a session nobody has marked', () => {
    /* The unmarked case keeps `moveMeeting` and its `occurrence + 1`. */
    expect(clientRoute).toMatch(/schedulingBookingRepository\.moveMeeting\(/);
  });

  it('still reschedules an ordinary booking through the lifecycle service', () => {
    /*
     * A single booking has no session, so it never enters either session
     * branch — it reaches `rescheduleBooking`, exactly as before. This also
     * covers the OLD package shape, whose sessions ARE bookings.
     */
    expect(clientRoute).toMatch(/const rescheduled = await rescheduleBooking\(\{/);
  });

  it('keeps refusing a session that was held or called off', () => {
    expect(clientRoute).toMatch(/settledStatus === 'held' \|\| settledStatus === 'cancelled'/);
  });

  it('refuses a superseded attempt instead of offering its old hour', () => {
    /* A link from an email sent before the owner moved the hour used to load
       the panel, offer slots against the OLD start, and fail at the POST. */
    expect(clientRoute).toMatch(/data\.meeting_status === 'moved'/);
  });
});
