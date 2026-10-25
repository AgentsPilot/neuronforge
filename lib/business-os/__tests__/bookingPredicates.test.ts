/**
 * One definition per question, and the shapes that break the obvious answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE EXIST AS FUNCTIONS AT ALL
 *
 * `jobIsOver` in the booking card and `quoteGate` ask the same question — is
 * this job off — and disagreed for months, because each assembled its own
 * answer. `jobIsOver` was given the full union when the preserve-attendance
 * behaviour landed; `quoteGate` was not, so its `closed` branch quietly became
 * unreachable and the create-quote button survived a cancellation.
 *
 * Three production rows carry the shape that caused it: `status = 'completed'`,
 * `meeting_status = 'held'`, `cancel_reason` set. A job thoroughly called off
 * whose status says it was completed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  jobCalledOff,
  meetingHeld,
  meetingMissed,
  meetingOff,
  meetingUnmarked,
  isMeetingStatus,
  MEETING_STATUSES,
} from '../bookingStatus';

/** The real row shape, from production booking f4944490. */
const HELD_THEN_CANCELLED = {
  status: 'completed',
  meeting_status: 'held',
  cancel_reason: 'client_unresponsive',
  cancelled_by: 'owner',
};

describe('jobCalledOff', () => {
  it('is true for a booking cancelled before its meeting', () => {
    expect(jobCalledOff({ status: 'cancelled' })).toBe(true);
  });

  it('is true for a HELD consultation whose job was cancelled', () => {
    /*
     * The whole reason this function exists. `status` reads `completed` here
     * and always will: overwriting it would erase that the meeting happened.
     */
    expect(jobCalledOff(HELD_THEN_CANCELLED)).toBe(true);
  });

  it('is true on either structured column alone', () => {
    // Rows differ in which of the two got written, depending on the path.
    expect(jobCalledOff({ status: 'completed', cancel_reason: 'duplicate' })).toBe(true);
    expect(jobCalledOff({ status: 'completed', cancelled_by: 'client' })).toBe(true);
  });

  it('keeps the bare status in the union, for rows older than those columns', () => {
    expect(jobCalledOff({ status: 'cancelled', cancel_reason: null, cancelled_by: null })).toBe(true);
  });

  it('is false for a live booking, whatever its meeting says', () => {
    expect(jobCalledOff({ status: 'confirmed' })).toBe(false);
    expect(jobCalledOff({ status: 'completed', meeting_status: 'held' })).toBe(false);
    expect(jobCalledOff({ status: 'no_show', meeting_status: 'no_show' })).toBe(false);
  });

  it('is false on empty strings, which are not a cancellation', () => {
    // `cancel_note` is trimmed to null for exactly this reason; the sibling
    // columns must not treat '' as a recorded fact either.
    expect(jobCalledOff({ status: 'confirmed', cancel_reason: '', cancelled_by: '' })).toBe(false);
  });

  it('does NOT know about a stopped quote', () => {
    /*
     * Deliberate. Stopping a quote touches no booking — a bookingless quote has
     * no appointment to cancel — so no column here can see it. The caller holding
     * the proposal adds that clause; `quoteGate` has it as `proposalStatus`.
     */
    expect(jobCalledOff({ status: 'confirmed' })).toBe(false);
  });
});

describe('the meeting predicates', () => {
  it('each answers only its own value', () => {
    expect(meetingHeld({ meeting_status: 'held' })).toBe(true);
    expect(meetingMissed({ meeting_status: 'no_show' })).toBe(true);
    expect(meetingOff({ meeting_status: 'cancelled' })).toBe(true);
  });

  it('a missed meeting is not an off one, and neither is held', () => {
    // They were the same column as the job's state until 20261072, which is
    // how "they did not turn up" and "we called it off" became one fact.
    expect(meetingOff({ meeting_status: 'no_show' })).toBe(false);
    expect(meetingMissed({ meeting_status: 'cancelled' })).toBe(false);
    expect(meetingHeld({ meeting_status: 'cancelled' })).toBe(false);
  });

  it('reads the meeting column, never the booking status', () => {
    /*
     * A held consultation on a cancelled job: the job is off AND the meeting
     * was held, both true at once. Nothing here may infer one from the other.
     */
    expect(meetingHeld(HELD_THEN_CANCELLED)).toBe(true);
    expect(jobCalledOff(HELD_THEN_CANCELLED)).toBe(true);
  });

  it('does not treat a completed booking as held without the column', () => {
    // Pre-backfill rows, or any row the app has not touched since.
    expect(meetingHeld({ status: 'completed' })).toBe(false);
  });
});

describe('meetingUnmarked', () => {
  it('is true when nobody has said yet', () => {
    expect(meetingUnmarked({ status: 'confirmed' })).toBe(true);
    expect(meetingUnmarked({ status: 'confirmed', meeting_status: null })).toBe(true);
  });

  it('treats undefined and null alike', () => {
    /*
     * A narrow `.select()` that omits the column yields `undefined`, a full row
     * yields `null`. Readers that must only act BEFORE a meeting is settled —
     * the reminder, the intake chase — cannot have those mean different things.
     */
    expect(meetingUnmarked({})).toBe(true);
  });

  it('is false once any outcome is recorded', () => {
    for (const status of MEETING_STATUSES) {
      expect(meetingUnmarked({ meeting_status: status })).toBe(false);
    }
  });
});

describe('isMeetingStatus', () => {
  it('accepts every declared value and null', () => {
    for (const status of MEETING_STATUSES) expect(isMeetingStatus(status)).toBe(true);
    expect(isMeetingStatus(null)).toBe(true);
  });

  it('rejects a booking status that is not a meeting outcome', () => {
    // `completed` is the booking's word for it; the meeting's is `held`.
    expect(isMeetingStatus('completed')).toBe(false);
    expect(isMeetingStatus('confirmed')).toBe(false);
    expect(isMeetingStatus(undefined)).toBe(false);
  });
});
