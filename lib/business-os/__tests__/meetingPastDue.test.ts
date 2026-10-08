/**
 * A meeting whose time has passed stops calling itself upcoming.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `'crm.booking.status.confirmed'` reads "Upcoming", and that label was picked
 * by the status alone. Nothing marks a booking past, so a confirmed meeting
 * from three weeks ago still said "Upcoming" on the contact drawer — the screen
 * an owner reads to decide what needs doing today.
 *
 * The note is ADDED, never substituted: "Awaiting payment" names what is
 * missing, which is the more useful half for an owner, so the money keeps its
 * word and the clock joins it.
 *
 * Every case pins `now`. A test that used the real clock would start failing on
 * a date nobody chose.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { isMeetingPastDue } from '@/lib/business-os/quoteGate';

/** The moment every case is judged against. */
const NOW = new Date('2026-10-06T12:00:00Z');

const HOUR = 60 * 60 * 1000;
const past = new Date(NOW.getTime() - 3 * HOUR);
const future = new Date(NOW.getTime() + 3 * HOUR);

describe('an unmarked meeting that has passed is past due', () => {
  it('is past due when confirmed and behind', () => {
    // The bug, stated plainly: this is the card that said "Upcoming".
    expect(isMeetingPastDue({ status: 'confirmed', startTime: past, now: NOW })).toBe(true);
  });

  it('is past due when still pending and behind', () => {
    /*
     * The decision the owner made: a booking awaiting payment gets the note
     * too. It keeps saying "Awaiting payment" AND says the meeting is behind —
     * losing the money signal to gain a date would be a bad trade.
     */
    expect(isMeetingPastDue({ status: 'pending', startTime: past, now: NOW })).toBe(true);
  });

  it('is not past due while the meeting is still ahead', () => {
    expect(isMeetingPastDue({ status: 'confirmed', startTime: future, now: NOW })).toBe(false);
  });
});

describe('a mark the owner has applied settles the question', () => {
  it.each(['completed', 'cancelled', 'no_show'])('%s is never past due', status => {
    /*
     * These are the three marks an owner can apply, and each answers "did this
     * happen". Adding the note to them would nag about a question already
     * answered — and on `cancelled` it would be flatly wrong, because a
     * cancelled meeting was never going to happen.
     */
    expect(isMeetingPastDue({ status, startTime: past, now: NOW })).toBe(false);
  });
});

describe('nothing scheduled is never late', () => {
  it('a booking with no start time is not past due', () => {
    /*
     * A quoted service bought without an appointment. There is no meeting to be
     * late for, and the badge already reads `unscheduled_confirmed` for these.
     */
    expect(isMeetingPastDue({ status: 'confirmed', startTime: null, now: NOW })).toBe(false);
  });

  it('an unparseable start time is not past due', () => {
    // Guessing would put a false note on a row whose data is simply broken.
    expect(
      isMeetingPastDue({ status: 'confirmed', startTime: new Date('nonsense'), now: NOW })
    ).toBe(false);
  });

  it('an absent status is not past due', () => {
    // `status` is typed nullable on the row; absent is not "confirmed".
    expect(isMeetingPastDue({ status: null, startTime: past, now: NOW })).toBe(false);
  });

  it('a status nobody has taught it about is not past due', () => {
    /*
     * The open statuses are named rather than inferred from "not one of the
     * marks", so a value added to the schema later renders no claim until
     * somebody decides what it means. The drawer's quoted badge learned this
     * the expensive way: `stopped` was added without a branch, fell through a
     * catch-all, and told owners a job they had just stopped was awaiting a
     * quote.
     *
     * This test is the tripwire. If a real new open status appears, it fails
     * here and gets added deliberately — which is the point.
     */
    expect(isMeetingPastDue({ status: 'rescheduled', startTime: past, now: NOW })).toBe(false);
  });
});

describe('the boundary', () => {
  it('is past due the instant the start time is reached', () => {
    /*
     * `<=`, not `<`. A meeting due to start exactly now has started, and
     * leaving it "upcoming" for the duration of its own slot is the window in
     * which an owner is most likely to be looking at the card.
     */
    expect(isMeetingPastDue({ status: 'confirmed', startTime: NOW, now: NOW })).toBe(true);
  });

  it('is not past due one millisecond before', () => {
    expect(
      isMeetingPastDue({
        status: 'confirmed',
        startTime: new Date(NOW.getTime() + 1),
        now: NOW,
      })
    ).toBe(false);
  });
});

describe('it is not the quote gate', () => {
  it('stays past due even though a quote has been sent', () => {
    /*
     * The reason this is its own function. `quoteGate` returns 'open' as soon
     * as a proposal exists — right for "may the owner quote?", wrong here: a
     * meeting nobody marked is still unmarked whether or not a price went out
     * from the van afterwards.
     *
     * This function takes no proposal status at all, which is what makes that
     * impossible to get wrong by accident.
     */
    expect(isMeetingPastDue({ status: 'confirmed', startTime: past, now: NOW })).toBe(true);
  });
});
