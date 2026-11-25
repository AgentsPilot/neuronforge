/**
 * A client is judged on what is unambiguously theirs, and never below the floor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO MISTAKES THIS FILE EXISTS TO PREVENT
 *
 * The product has 49 detectors and, until now, not one of them watched the
 * client's own conduct. Adding that is useful and it is also the one place
 * where being wrong is expensive: a badge in the CRM that calls somebody
 * unreliable, where the owner may well have that person beside them.
 *
 * So two rules, and they are the whole test:
 *
 *   1. A SESSION THE BUSINESS CALLED OFF IS NOT THE CLIENT'S FAULT.
 *      Measured on the reporting account: all seven of one client's
 *      cancellations are the owner's. Reading them as the client's would have
 *      put a reliable person in the worst band for the OWNER's decisions.
 *
 *      And the attribution lives in `outcome_by`, not in the column that looks
 *      like it should hold it. Of 78 cancelled meetings in production,
 *      `outcome_by` names an actor 69 times; `cancelled_by` is null on 73. The
 *      first version of this module read the wrong one.
 *
 *   2. NO BAND WITHOUT EVIDENCE. One missed session out of one is not a
 *      pattern, and a badge that said so would be the product libelling
 *      somebody on a single data point.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { buildClientProfiles, type ClientProfile } from '../clientProfile';
import { standingFor, CLIENT_STANDING } from '../clientStanding';

const NOW = new Date('2026-11-15T12:00:00.000Z');
const recently = (daysAgo: number) =>
  new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

const CONTACT = 'contact-1';
const BOOKING = 'booking-1';

/** A package booking that belongs to our client. */
const booking = (over: Record<string, unknown> = {}) =>
  ({ id: BOOKING, contact_id: CONTACT, cancelled_by: null, ...over }) as never;

const session = (status: string, over: Record<string, unknown> = {}) =>
  ({
    booking_id: BOOKING,
    meeting_status: status,
    start_time: recently(10),
    outcome_by: null,
    cancelled_by: null,
    ...over,
  }) as never;

const instalment = (over: Record<string, unknown> = {}) =>
  ({ contact_id: CONTACT, status: 'paid', due_date: recently(20), paid_at: recently(20), ...over }) as never;

function profileOf(input: {
  meetings?: unknown[];
  bookings?: unknown[];
  instalments?: unknown[];
}): ClientProfile {
  const profiles = buildClientProfiles({
    meetings: (input.meetings ?? []) as never,
    bookings: (input.bookings ?? [booking()]) as never,
    instalments: (input.instalments ?? []) as never,
    transactions: [],
    proposals: [],
    now: NOW,
    windowDays: 180,
  });
  return (
    profiles.get(CONTACT) ?? {
      contactId: CONTACT,
      sessionsSettled: 0,
      sessionsHeld: 0,
      sessionsMissed: 0,
      sessionsCancelledByClient: 0,
      sessionsCancelledByOwner: 0,
      sessionsCancelledUnknown: 0,
      instalmentsDue: 0,
      instalmentsPaidOnTime: 0,
      instalmentsPaidLate: 0,
      instalmentsOverdue: 0,
      refunds: 0,
      proposalsDeclined: 0,
      /* The two halves of the window. A client with nothing in either is
         exactly what this fallback stands for. */
      recent: { sessionsSettled: 0, sessionsMissed: 0, instalmentsDue: 0, instalmentsPaidLate: 0 },
      earlier: { sessionsSettled: 0, sessionsMissed: 0, instalmentsDue: 0, instalmentsPaidLate: 0 },
    }
  );
}

describe('who called the session off', () => {
  it('reads outcome_by, which is the column that is actually written', () => {
    const profile = profileOf({
      meetings: [
        session('cancelled', { outcome_by: 'client' }),
        session('cancelled', { outcome_by: 'owner' }),
        session('cancelled'),
      ],
    });

    expect(profile.sessionsCancelledByClient).toBe(1);
    expect(profile.sessionsCancelledByOwner).toBe(1);
    expect(profile.sessionsCancelledUnknown).toBe(1);
  });

  it('falls back to the booking when the whole job was called off by the client', () => {
    const profile = profileOf({
      meetings: [session('cancelled'), session('cancelled')],
      bookings: [booking({ cancelled_by: 'client' })],
    });

    expect(profile.sessionsCancelledByClient).toBe(2);
  });

  it('counts a no-show as theirs however the outcome was recorded', () => {
    /*
     * `outcome_by: 'owner'` on a no-show means the OWNER recorded it, which is
     * always true and says nothing about whose fault the absence was. Nobody
     * else can fail to turn up.
     */
    const profile = profileOf({ meetings: [session('no_show', { outcome_by: 'owner' })] });

    expect(profile.sessionsMissed).toBe(1);
    expect(profile.sessionsCancelledByOwner).toBe(0);
  });

  it('ignores a moved session, which is not an outcome', () => {
    const profile = profileOf({ meetings: [session('moved'), session('held')] });

    expect(profile.sessionsSettled).toBe(1);
  });
});

describe('the band', () => {
  /** An empty record with the counts under test written onto it. */
  const settled = (counts: Partial<ClientProfile>): ClientProfile => ({
    ...profileOf({}),
    ...counts,
  });

  it('is `new` below the evidence floor, however bad the one fact is', () => {
    /* One missed session out of one is 100% — and not a pattern. */
    const standing = standingFor(settled({ sessionsSettled: 1, sessionsMissed: 1 }));

    expect(standing.band).toBe('new');
    expect(standing.reasons).toEqual([]);
    expect(standing.missRate).toBeNull();
  });

  it('never counts a session the business called off', () => {
    /* The reporting account exactly: seven cancellations, all the owner's. */
    const standing = standingFor(
      settled({ sessionsSettled: 16, sessionsHeld: 9, sessionsCancelledByOwner: 7 })
    );

    expect(standing.band).toBe('reliable');
    expect(standing.missRate).toBe(0);
  });

  it('nor one nobody is recorded as having called off', () => {
    const standing = standingFor(
      settled({ sessionsSettled: 10, sessionsHeld: 4, sessionsCancelledUnknown: 6 })
    );

    expect(standing.band).toBe('reliable');
  });

  it('turns on what IS theirs', () => {
    const standing = standingFor(
      settled({ sessionsSettled: 10, sessionsMissed: 3, sessionsCancelledByClient: 2 })
    );

    expect(standing.missRate).toBeCloseTo(0.5);
    expect(standing.band).toBe('at_risk');
    expect(standing.reasons).toContainEqual({ key: 'missed_sessions', count: 5, of: 10 });
  });

  it('takes the worse of attendance and money, never an average of them', () => {
    /* Turns up every time, has not paid twice. "Half fine" is not an answer. */
    const standing = standingFor(
      settled({ sessionsSettled: 8, sessionsHeld: 8, instalmentsDue: 4, instalmentsOverdue: 2 })
    );

    expect(standing.band).toBe('at_risk');
  });

  it('says nothing about a rate it cannot measure', () => {
    /* Two instalments is below the floor: null, never a flattering zero. */
    const standing = standingFor(
      settled({ sessionsSettled: 6, sessionsHeld: 6, instalmentsDue: 2, instalmentsPaidOnTime: 2 })
    );

    expect(standing.lateRate).toBeNull();
    expect(standing.band).toBe('reliable');
  });

  it('keeps refunds off the reasons, because the business issued them', () => {
    const standing = standingFor(settled({ sessionsSettled: 6, sessionsHeld: 6, refunds: 30 }));

    expect(standing.reasons).toEqual([]);
    expect(standing.band).toBe('reliable');
  });
});

describe('money', () => {
  it('counts a payment made after its due date as late', () => {
    const profile = profileOf({
      instalments: [instalment({ due_date: recently(11), paid_at: recently(10) })],
    });

    expect(profile.instalmentsPaidLate).toBe(1);
    expect(profile.instalmentsPaidOnTime).toBe(0);
  });

  it('does not call a same-day payment late', () => {
    /* A due DATE is due at the end of its day: paying at 14:00 is not late. */
    const profile = profileOf({
      instalments: [instalment({ due_date: '2026-11-05', paid_at: '2026-11-05T14:00:00.000Z' })],
    });

    expect(profile.instalmentsPaidOnTime).toBe(1);
  });

  it('ignores an instalment that was cancelled, and one not yet due', () => {
    const profile = profileOf({
      instalments: [
        instalment({ status: 'cancelled', paid_at: null }),
        instalment({ status: 'pending', paid_at: null, due_date: '2027-01-01' }),
      ],
    });

    expect(profile.instalmentsDue).toBe(0);
  });
});

describe('the thresholds are readable, which is the point of a band', () => {
  it('states its floors and its lines as one constant', () => {
    expect(CLIENT_STANDING.minSettledSessions).toBeGreaterThanOrEqual(3);
    expect(CLIENT_STANDING.atRisk.missRate).toBeGreaterThan(CLIENT_STANDING.watch.missRate);
    expect(CLIENT_STANDING.atRisk.overdue).toBeGreaterThan(CLIENT_STANDING.watch.overdue);
  });
});
