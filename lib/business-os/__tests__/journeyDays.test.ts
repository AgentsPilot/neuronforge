/**
 * Grouping a booking's journey into days.
 *
 * The failures that matter here are silent ones: a step quietly reordered, a
 * step dropped because it has no date, or a month-long gap rendered as though
 * it were the next morning.
 */

import { groupJourneyByDay, WAIT_THRESHOLD_DAYS } from '../journeyDays';

const step = (timestamp: string | null, label: string) => ({ timestamp, label });

describe('groupJourneyByDay', () => {
  it('puts one afternoon under one day', () => {
    // The case this exists for: four things between 15:32 and 16:02 read as one
    // afternoon, not four milestones.
    const groups = groupJourneyByDay([
      step('2026-09-02T15:32:00', 'booked'),
      step('2026-09-02T15:34:00', 'paid'),
      step('2026-09-02T16:02:00', 'intake'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('day');
    expect(groups[0].kind === 'day' && groups[0].steps.map(s => s.label)).toEqual([
      'booked',
      'paid',
      'intake',
    ]);
  });

  it('draws the wait between distant days', () => {
    const groups = groupJourneyByDay([
      step('2026-09-02T15:32:00', 'booked'),
      step('2026-09-29T14:00:00', 'session'),
    ]);

    expect(groups.map(g => g.kind)).toEqual(['day', 'wait', 'day']);
    expect(groups[1].kind === 'wait' && groups[1].days).toBe(27);
  });

  it('does not annotate an ordinary next-day step', () => {
    // A journey moving along is not a wait. Marking every gap would make the
    // device meaningless where it matters.
    const groups = groupJourneyByDay([
      step('2026-09-02T15:32:00', 'booked'),
      step('2026-09-03T09:00:00', 'paid'),
    ]);

    expect(groups.map(g => g.kind)).toEqual(['day', 'day']);
  });

  it('measures the gap midnight to midnight', () => {
    /*
     * 23:00 on the 2nd to 08:00 on the 5th is nine hours short of three days,
     * but a person reading a calendar sees three. Measuring elapsed time would
     * put the threshold on the wrong side of that.
     */
    const groups = groupJourneyByDay([
      step('2026-09-02T23:00:00', 'booked'),
      step('2026-09-05T08:00:00', 'paid'),
    ]);

    expect(groups[1].kind === 'wait' && groups[1].days).toBe(WAIT_THRESHOLD_DAYS);
  });

  it('splits a day boundary that is only twenty minutes wide', () => {
    // 23:50 and 00:10 are different days, and the strip must say so.
    const groups = groupJourneyByDay([
      step('2026-09-02T23:50:00', 'booked'),
      step('2026-09-03T00:10:00', 'paid'),
    ]);

    expect(groups.filter(g => g.kind === 'day')).toHaveLength(2);
  });

  it('keeps undated steps in place rather than dropping them', () => {
    /*
     * A step with no timestamp is usually one that has not happened yet — the
     * session, an intake form not yet returned. Dropping it would remove the
     * only row that says what is still outstanding.
     */
    const groups = groupJourneyByDay([
      step('2026-09-02T15:32:00', 'booked'),
      step(null, 'session'),
    ]);

    expect(groups.map(g => g.kind)).toEqual(['day', 'day']);
    expect(groups[1].kind === 'day' && groups[1].date).toBeNull();
    expect(groups[1].kind === 'day' && groups[1].steps[0].label).toBe('session');
  });

  it('never puts a wait next to an undated group', () => {
    // There is no gap to measure against a step with no date, and inventing one
    // would draw "27 days" before something that may happen tomorrow.
    const groups = groupJourneyByDay([
      step(null, 'session'),
      step('2026-09-29T14:00:00', 'done'),
    ]);

    expect(groups.some(g => g.kind === 'wait')).toBe(false);
  });

  it('preserves the caller’s order', () => {
    // The journey is sequenced deliberately; re-sorting here would silently
    // reorder a booking whose steps are not chronological.
    const groups = groupJourneyByDay([
      step('2026-09-29T14:00:00', 'session'),
      step('2026-09-02T15:32:00', 'booked'),
    ]);

    const labels = groups.flatMap(g => (g.kind === 'day' ? g.steps.map(s => s.label) : []));
    expect(labels).toEqual(['session', 'booked']);
  });

  it('ignores an unparseable timestamp instead of throwing', () => {
    const groups = groupJourneyByDay([step('not a date', 'booked')]);

    expect(groups).toHaveLength(1);
    expect(groups[0].kind === 'day' && groups[0].date).toBeNull();
  });

  it('is empty-safe', () => {
    expect(groupJourneyByDay([])).toEqual([]);
  });
});
