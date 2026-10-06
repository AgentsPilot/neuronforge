/**
 * Telling the race apart from a fault.
 *
 * `scheduling_bookings_no_overlap` (migration 20261001) is the only
 * double-booking check that cannot be raced: every application check is
 * SELECT-then-INSERT with no lock, so two clients pressing Book in the same
 * second both read a free slot and both write. The constraint refuses the
 * second one.
 *
 * When it fires, nothing is broken — one of them simply lost. If that reaches a
 * client as an internal error, the platform has turned working-as-designed into
 * a bug report, so this predicate is what separates the two.
 */

import { isSlotTakenError } from '../bookingStatus';

describe('the database refusing a taken slot', () => {
  it('recognises the exclusion violation by code', () => {
    expect(isSlotTakenError({ code: '23P01', message: 'conflicting key value violates exclusion constraint' })).toBe(true);
  });

  it('recognises it by the constraint name when no code is carried', () => {
    // A driver that surfaces only a message must still be readable.
    expect(
      isSlotTakenError(
        new Error('conflicting key value violates exclusion constraint "scheduling_bookings_no_overlap"')
      )
    ).toBe(true);
  });
});

describe('everything else is still a fault', () => {
  it('a unique violation is not this', () => {
    expect(isSlotTakenError({ code: '23505', message: 'duplicate key value' })).toBe(false);
  });

  it('a not-null violation is not this', () => {
    // 23502 is what a contact delete used to raise — a real defect, not a race.
    expect(isSlotTakenError({ code: '23502', message: 'null value in column "contact_id"' })).toBe(false);
  });

  it('an exclusion violation on ANOTHER constraint is not assumed to be ours', () => {
    expect(isSlotTakenError(new Error('violates exclusion constraint "something_else"'))).toBe(false);
  });

  it('and nothing at all is not an error', () => {
    expect(isSlotTakenError(null)).toBe(false);
    expect(isSlotTakenError(undefined)).toBe(false);
    expect(isSlotTakenError('23P01')).toBe(false);
    expect(isSlotTakenError({})).toBe(false);
  });
});
