/**
 * Where a replacement session is proposed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Cancelling or missing a session of a package offers the owner a replacement,
 * and the agreed rule is that it lands "after the last one". This is the whole
 * of that decision, so it is tested as behaviour rather than described.
 *
 * Three things it has to get right, each of which was wrong in an earlier
 * version of it:
 *
 *   THE RHYTHM, not the last gap. A block whose third session was moved has a
 *   short gap and a long one in a series that is plainly weekly.
 *
 *   A FREE hour. An hour one rhythm out may already be sold to another client
 *   entirely, and proposing it would hand the owner a booking that fails.
 *
 *   A FUTURE hour. Cancelling a session that was never held is exactly when an
 *   owner reaches for this, and the whole block may be behind us.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { nextSessionSlot, nextSessionSlots } from '@/lib/scheduling/nextSessionSlot';

/** Fixed, so none of this depends on when it runs. */
const NOW = new Date('2026-10-27T12:00:00Z');

const WEEKLY = [
  '2026-11-06T08:00:00Z',
  '2026-11-13T08:00:00Z',
  '2026-11-20T08:00:00Z',
];

const propose = (starts: Array<string | null | undefined>, options = {}) =>
  nextSessionSlot(starts, { now: NOW, durationMinutes: 60, ...options });

describe('reading the rhythm', () => {
  it('continues a weekly block', () => {
    expect(propose(WEEKLY)).toBe('2026-11-27T08:00:00.000Z');
  });

  it('continues a fortnightly one', () => {
    expect(
      propose(['2026-11-06T08:00:00Z', '2026-11-20T08:00:00Z', '2026-12-04T08:00:00Z'])
    ).toBe('2026-12-18T08:00:00.000Z');
  });

  it('ignores a gap left by a rescheduled session', () => {
    /*
     * THE ONE THAT MATTERS. Gaps of 4, 7 and 7 days: the 4 is where a session
     * was moved, not the rhythm. Reading the LAST pair would have been right
     * here by luck; reading the FIRST pair, or averaging, would not.
     */
    expect(
      propose([
        '2026-11-06T08:00:00Z',
        '2026-11-10T08:00:00Z',
        '2026-11-17T08:00:00Z',
        '2026-11-24T08:00:00Z',
      ])
    ).toBe('2026-12-01T08:00:00.000Z');
  });

  it('does not care what order it is given the dates in', () => {
    const shuffled = [WEEKLY[2], WEEKLY[0], WEEKLY[1]];

    expect(propose(shuffled)).toBe(propose(WEEKLY));
  });

  it('assumes a week when there is only one session to go on', () => {
    expect(propose(['2026-11-06T08:00:00Z'])).toBe('2026-11-13T08:00:00.000Z');
  });

  it('ignores rows that are not dates rather than giving up', () => {
    // One bad row must not cost the owner the offer.
    expect(propose(['nonsense', null, undefined, ...WEEKLY])).toBe('2026-11-27T08:00:00.000Z');
  });

  it('has nothing to say about no sessions at all', () => {
    expect(propose([])).toBeNull();
  });
});

describe('the hour has to be free', () => {
  const busy = (start: string, end: string) => ({ busy: [{ start, end }] });

  it('steps a whole rhythm when the obvious hour is taken', () => {
    expect(propose(WEEKLY, busy('2026-11-27T08:00:00Z', '2026-11-27T09:00:00Z'))).toBe(
      '2026-12-04T08:00:00.000Z'
    );
  });

  it('keeps stepping while hours stay taken', () => {
    expect(
      propose(WEEKLY, {
        busy: [
          { start: '2026-11-27T08:00:00Z', end: '2026-11-27T09:00:00Z' },
          { start: '2026-12-04T08:00:00Z', end: '2026-12-04T09:00:00Z' },
        ],
      })
    ).toBe('2026-12-11T08:00:00.000Z');
  });

  it('treats a partial overlap as taken', () => {
    expect(propose(WEEKLY, busy('2026-11-27T08:30:00Z', '2026-11-27T09:30:00Z'))).toBe(
      '2026-12-04T08:00:00.000Z'
    );
  });

  it('does not treat a meeting ENDING on the hour as a clash', () => {
    /* Half-open, the same test the database constraint makes. */
    expect(propose(WEEKLY, busy('2026-11-27T07:00:00Z', '2026-11-27T08:00:00Z'))).toBe(
      '2026-11-27T08:00:00.000Z'
    );
  });

  it('nor one STARTING as this ends', () => {
    expect(propose(WEEKLY, busy('2026-11-27T09:00:00Z', '2026-11-27T10:00:00Z'))).toBe(
      '2026-11-27T08:00:00.000Z'
    );
  });

  it('measures the clash against the session’s real length', () => {
    /* A 30-minute session fits where a 2-hour one does not. */
    const taken = { busy: [{ start: '2026-11-27T08:30:00Z', end: '2026-11-27T09:30:00Z' }] };

    expect(propose(WEEKLY, { ...taken, durationMinutes: 30 })).toBe('2026-11-27T08:00:00.000Z');
    expect(propose(WEEKLY, { ...taken, durationMinutes: 120 })).toBe('2026-12-04T08:00:00.000Z');
  });

  it('gives up rather than proposing something months away', () => {
    /*
     * A diary solid for every rhythm in reach has no answer worth offering.
     * Null hides the toggle and the owner places the session by hand.
     */
    const solid = Array.from({ length: 30 }, (_, index) => ({
      start: new Date(Date.parse('2026-11-27T08:00:00Z') + index * 7 * 86_400_000).toISOString(),
      end: new Date(Date.parse('2026-11-27T09:00:00Z') + index * 7 * 86_400_000).toISOString(),
    }));

    expect(propose(WEEKLY, { busy: solid })).toBeNull();
  });
});

describe('the hour has to be ahead', () => {
  it('walks a block that is entirely in the past up to the future', () => {
    const past = ['2026-09-04T08:00:00Z', '2026-09-11T08:00:00Z', '2026-09-18T08:00:00Z'];

    const proposed = propose(past);

    expect(proposed).not.toBeNull();
    expect(new Date(proposed as string).getTime()).toBeGreaterThan(NOW.getTime());
    /* Still on the block's own weekday and hour — a Friday at 08:00. */
    expect(proposed).toBe('2026-10-30T08:00:00.000Z');
  });
});

describe('what is not a rhythm', () => {
  it('two sessions on one morning fall back to a week', () => {
    /* A workshop, not a series. Repeating a two-hour gap would propose an
       hour later the same day. */
    expect(propose(['2026-11-06T08:00:00Z', '2026-11-06T10:00:00Z'])).toBe(
      '2026-11-13T10:00:00.000Z'
    );
  });
});

describe('nextSessionSlots', () => {
  /* A weekly block, nothing in the way. */
  /* Just behind NOW, so the rhythm's next beats are genuinely ahead. */
  const weekly = ['2026-10-13T10:00:00.000Z', '2026-10-20T10:00:00.000Z'];

  it('offers the proposal first, then the beats after it', () => {
    const slots = nextSessionSlots(weekly, { now: NOW, durationMinutes: 60, count: 3 });
    expect(slots).toHaveLength(3);
    /* Same weekday and hour each time — that is the point of reading a rhythm. */
    for (const iso of slots) expect(new Date(iso).getUTCHours()).toBe(10);
    /* In order, and never the same hour twice. */
    expect(new Set(slots).size).toBe(3);
    const ms = slots.map(s => new Date(s).getTime());
    expect(ms[1]).toBeGreaterThan(ms[0]);
    expect(ms[2]).toBeGreaterThan(ms[1]);
  });

  it('skips an hour that is already taken', () => {
    const first = nextSessionSlots(weekly, { now: NOW, durationMinutes: 60, count: 1 })[0];
    const withoutIt = nextSessionSlots(weekly, {
      now: NOW,
      durationMinutes: 60,
      count: 2,
      busy: [{ start: first, end: new Date(new Date(first).getTime() + 3_600_000).toISOString() }],
    });
    expect(withoutIt).not.toContain(first);
  });

  /* The singular function is the first of these, or the two would drift. */
  it('agrees with nextSessionSlot on the proposal', () => {
    const one = nextSessionSlot(weekly, { now: NOW, durationMinutes: 60 });
    const many = nextSessionSlots(weekly, { now: NOW, durationMinutes: 60, count: 3 });
    expect(many[0]).toBe(one);
  });

  it('answers with nothing when there is no rhythm to read', () => {
    expect(nextSessionSlots([], { now: NOW })).toEqual([]);
  });
});
