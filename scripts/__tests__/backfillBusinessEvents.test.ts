/**
 * Re-running the backfill must write nothing the second time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The event rail is fire-and-forget: a repository notes what happened and does
 * not wait to find out whether the note landed, which is correct -- the
 * business fact committed before the emit, so there is nothing to roll back --
 * but it means a cold start can drop an event.
 *
 * `scripts/backfill-business-events.ts` is the repair for that, and the whole
 * repair depends on one property: running it again is harmless. If it were not,
 * the fix for a dropped event would be to duplicate every event that was not
 * dropped, and every rate computed off the rail would drift upward each time
 * anyone ran it.
 *
 * Verified live on 2026-10-06 (97 written, then 0 on an immediate re-run).
 * This is that property as a test, so it survives the next edit.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { eventKey, freshCandidates } from '../backfill-business-events';

const ev = (event_type: string, entity_id: string) => ({ event_type, entity_id });

describe('freshCandidates', () => {
  it('writes everything when the rail is empty', () => {
    const candidates = [ev('invoice.created', 'i1'), ev('invoice.paid', 'i1')];

    expect(freshCandidates(candidates, [])).toHaveLength(2);
  });

  it('writes nothing when the rail already holds all of it', () => {
    /*
     * The second run. This is the assertion the whole script exists to satisfy,
     * and it is on a COUNT: an empty result is the pass condition, so asserting
     * merely that nothing threw would pass on a function that returned
     * everything.
     */
    const candidates = [ev('invoice.created', 'i1'), ev('invoice.paid', 'i1')];
    const existing = candidates.map(eventKey);

    expect(freshCandidates(candidates, existing)).toEqual([]);
  });

  it('writes only the gap when the rail holds some of it', () => {
    // A dropped event beside events that landed: the case this repairs.
    const candidates = [
      ev('invoice.created', 'i1'),
      ev('invoice.paid', 'i1'),
      ev('invoice.created', 'i2'),
    ];

    const fresh = freshCandidates(candidates, [eventKey(ev('invoice.created', 'i1'))]);

    expect(fresh).toEqual([ev('invoice.paid', 'i1'), ev('invoice.created', 'i2')]);
  });

  it('keeps two different events on the same entity', () => {
    /*
     * A partially refunded transaction leaves `status: 'succeeded'`, so one row
     * is BOTH a completed payment and a completed refund. Keying on the entity
     * alone would silently drop the refund -- and the refund is the event the
     * refund-rate detector needs.
     */
    const candidates = [ev('payment.completed', 't1'), ev('refund.completed', 't1')];

    expect(freshCandidates(candidates, [])).toHaveLength(2);
  });

  it('collapses a duplicate inside a single batch', () => {
    /*
     * Deduping against the database alone is not enough: nothing stops the
     * derivation emitting the same event twice from two rows, and on a first
     * run the database half of the key is empty.
     */
    const candidates = [ev('booking.created', 'b1'), ev('booking.created', 'b1')];

    expect(freshCandidates(candidates, [])).toEqual([ev('booking.created', 'b1')]);
  });

  it('preserves the order it was given', () => {
    // Events are inserted in chunks; a stable order keeps a partial run's
    // boundary predictable when it is resumed.
    const candidates = [ev('a', '1'), ev('b', '2'), ev('c', '3')];

    expect(freshCandidates(candidates, []).map(c => c.event_type)).toEqual(['a', 'b', 'c']);
  });
});

describe('eventKey', () => {
  it('separates the type from the entity', () => {
    expect(eventKey(ev('invoice.paid', 'i1'))).toBe('invoice.paid|i1');
  });

  it('does not collide across types or entities', () => {
    const keys = new Set([
      eventKey(ev('invoice.paid', 'i1')),
      eventKey(ev('invoice.created', 'i1')),
      eventKey(ev('invoice.paid', 'i2')),
    ]);

    expect(keys.size).toBe(3);
  });
});
