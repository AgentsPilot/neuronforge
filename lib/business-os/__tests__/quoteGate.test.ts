/**
 * When the drawer may say an owner owes a price.
 *
 * Three real defects are pinned here. The journey used to flip to "your move"
 * the moment a consultation's start time passed — asserting a meeting that may
 * never have happened — a no-show closed the job entirely, contradicting the
 * drawer's own comment that only cancelling means the work is off, and the
 * `closed` branch became UNREACHABLE for any held booking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THIRD ONE, AND WHY THESE INPUTS CHANGED SHAPE
 *
 * The gate used to read everything off `bookingStatus`. It cannot: cancelling a
 * booking whose meeting was already marked preserves `completed`, because
 * overwriting it would erase the fact the meeting happened, and the
 * cancellation goes to `cancel_reason` / `cancelled_by` instead. So
 * `bookingStatus === 'cancelled'` was never true for exactly the bookings that
 * needed it, and the create-quote button survived the cancellation. Five rows
 * in production are in that state.
 *
 * Two inputs now carry what one column could not:
 *   · `calledOff`     — is the JOB off, from `jobCalledOff(booking)`
 *   · `meetingStatus` — what happened at the APPOINTMENT, its own column
 *
 * `bookingStatus` is still passed, and still drives nothing but the clock
 * states. The cases below assert both halves separately, because conflating
 * them is the whole defect.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { quoteGate, quoteWaitingOn, type QuoteGateInput } from '../quoteGate';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const BEFORE = new Date('2026-10-04T09:30:00.000Z');
const AFTER = new Date('2026-10-05T09:30:00.000Z');

const base: QuoteGateInput = {
  bookingStatus: 'confirmed',
  calledOff: false,
  meetingStatus: null,
  startTime: AFTER,
  isUnscheduled: false,
  proposalStatus: null,
  now: NOW,
};

describe('before the meeting', () => {
  it('waits, and nobody owes anything', () => {
    expect(quoteGate(base)).toBe('ahead');
    expect(quoteWaitingOn('ahead')).toBe('meeting');
  });
});

describe('the time has passed and nothing is marked', () => {
  it('asks, rather than claiming the meeting happened', () => {
    expect(quoteGate({ ...base, startTime: BEFORE })).toBe('unmarked');
    expect(quoteWaitingOn('unmarked')).toBe('unmarked');
  });

  it('is the same for a booking still sitting at pending', () => {
    expect(quoteGate({ ...base, bookingStatus: 'pending', startTime: BEFORE })).toBe('unmarked');
  });
});

describe('once the owner says what happened at the MEETING', () => {
  it('held means the owner may quote', () => {
    expect(quoteGate({ ...base, meetingStatus: 'held', startTime: BEFORE })).toBe('open');
    expect(quoteWaitingOn('open')).toBe('owner');
  });

  it('missed keeps the job ALIVE — it does not close it', () => {
    // The defect: `no_show` was folded in with `cancelled`, so a client who
    // missed a site visit took the quote button away with them.
    expect(quoteGate({ ...base, meetingStatus: 'no_show', startTime: BEFORE })).toBe('missed');
    expect(quoteWaitingOn('missed')).toBe('noshow');
  });

  it('a meeting cancelled in advance leaves the QUOTE as the owner\'s move', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * This expected `unmarked` — the step that ASKS what happened — and that
     * was right while cancelling a meeting and cancelling the job were one
     * gesture, so a cancelled meeting most likely meant the work was off too.
     *
     * "Cancel the meeting" is now its own action, and it exists for the case
     * where the owner and the client agree to proceed WITHOUT meeting: the site
     * visit is off, the quote still gets written. Asking what happened at an
     * appointment both parties called off has no answer, and it blocked the
     * only move left.
     *
     * Still deliberately not `closed`. The JOB being called off is a separate
     * fact, carried by `calledOff` and asserted below.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(quoteGate({ ...base, meetingStatus: 'cancelled', startTime: BEFORE })).toBe('open');
    expect(quoteWaitingOn('open')).toBe('owner');
  });

  it('and calling off the JOB still closes it, cancelled meeting or not', () => {
    /* The distinction the action depends on: one cancels an appointment, the
       other ends the work. */
    expect(
      quoteGate({ ...base, meetingStatus: 'cancelled', startTime: BEFORE, calledOff: true })
    ).toBe('closed');
  });

  it('the booking status no longer drives any of this', () => {
    /*
     * The regression guard for the whole change. A held consultation whose job
     * was cancelled keeps `status = 'completed'`, so anything reading that
     * column would call this `open` and leave the quote button up.
     */
    expect(
      quoteGate({ ...base, bookingStatus: 'completed', meetingStatus: null, startTime: BEFORE })
    ).toBe('unmarked');
  });
});

describe('the job being called off', () => {
  it('closes the step, whatever the meeting was marked', () => {
    expect(
      quoteGate({ ...base, calledOff: true, meetingStatus: 'held', startTime: BEFORE })
    ).toBe('closed');
    expect(quoteWaitingOn('closed')).toBe('closed');
  });

  it('closes it for a booking that still reads completed — THE REPORTED BUG', () => {
    /*
     * Production rows f4944490, 01a55f77 and d7319cd2: `status = 'completed'`,
     * `meeting_status = 'held'`, `cancel_reason` set. Before this, the gate
     * returned `open` and the create-quote button stayed on screen for a job
     * the owner had cancelled.
     */
    expect(
      quoteGate({
        ...base,
        bookingStatus: 'completed',
        meetingStatus: 'held',
        calledOff: true,
        startTime: BEFORE,
      })
    ).toBe('closed');
  });

  it('still closes a booking cancelled before its meeting', () => {
    // `cancel()` writes `status = 'cancelled'` on this path, and `jobCalledOff`
    // keeps that in its union for rows older than the structured columns.
    expect(
      quoteGate({ ...base, bookingStatus: 'cancelled', calledOff: true, startTime: BEFORE })
    ).toBe('closed');
  });
});

describe('a quote that already exists', () => {
  it('drives the step itself, whatever the meeting was marked', () => {
    // Quoting from the van: a price sent before anyone ticked the appointment
    // must not be re-gated on that tick.
    expect(quoteGate({ ...base, startTime: BEFORE, proposalStatus: 'sent' })).toBe('open');
    expect(quoteWaitingOn('open', 'sent')).toBe('client');
  });

  it('puts the ball back with the owner when it was declined', () => {
    expect(quoteWaitingOn('open', 'declined')).toBe('owner');
  });

  it("the WORD 'none' is not a quote", () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * REPORTED AS: "the banner of create proposal is appearing but the meeting
     * never held or marked".
     *
     * The journey step carries `proposal?.status ?? 'none'` — a literal word
     * meaning there is no quote. This branch was a truthiness test, so the word
     * passed it, the gate returned `'open'` without reaching the meeting checks
     * at all, and an owner was told to price a consultation nobody had marked.
     *
     * The meeting's time has passed here and nothing is marked, so the honest
     * answer is the one that ASKS.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(quoteGate({ ...base, startTime: BEFORE, proposalStatus: 'none' })).toBe('unmarked');
  });

  it("'none' does not override a meeting still ahead either", () => {
    expect(quoteGate({ ...base, proposalStatus: 'none' })).toBe('ahead');
  });

  it('but a STOPPED quote closes the job, with no booking involved', () => {
    // Stopping a quote touches no booking, so the booking status can never see
    // it — a bookingless quote has no appointment to cancel.
    expect(
      quoteGate({ ...base, bookingStatus: 'confirmed', startTime: null, proposalStatus: 'stopped' })
    ).toBe('closed');
  });

  it('and a called-off job beats a live quote', () => {
    expect(
      quoteGate({ ...base, calledOff: true, startTime: BEFORE, proposalStatus: 'sent' })
    ).toBe('closed');
  });
});

describe('when there is no meeting to wait for', () => {
  it('an unscheduled service is the owner\'s move at once', () => {
    expect(quoteGate({ ...base, isUnscheduled: true, startTime: null })).toBe('open');
  });

  it('so is a quote sent cold, with no booking behind it', () => {
    // `proposals.booking_id` is nullable and the create route defaults it to
    // null, so this is an ordinary case rather than a broken row.
    expect(quoteGate({ ...base, startTime: null })).toBe('open');
  });

  it('and an unusable date does not strand the step', () => {
    expect(quoteGate({ ...base, startTime: new Date('nonsense') })).toBe('open');
  });
});

describe('the clock', () => {
  it('turns at the start time, not at the end of the day', () => {
    const start = new Date('2026-10-04T11:59:59.000Z');
    expect(quoteGate({ ...base, startTime: start, now: NOW })).toBe('unmarked');

    const soon = new Date('2026-10-04T12:00:01.000Z');
    expect(quoteGate({ ...base, startTime: soon, now: NOW })).toBe('ahead');
  });
});
