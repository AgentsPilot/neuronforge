/**
 * The one task the card leads with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The Needs You card is becoming a card that shows ONE task. With eight rows
 * visible an owner can disagree with the order and still find what they want;
 * with one visible they cannot. So a wrong answer here is not a worse list, it
 * is a wrong card, and this is the suite that has to be right.
 *
 * Four things it must never do, each with its own block below:
 *
 *   rank by money across currencies  — there is no FX rate in this platform
 *   let an absent deadline win       — unknown is not "far away"
 *   bury money that is still leaving — the one task that worsens by the hour
 *   reshuffle between refreshes      — a card that moves is a card you misclick
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { compareUrgency, mostUrgent, rankTasks, tasksOf, type RankedTask } from '../mostUrgent';
import type { GapId, GapItem } from '../types';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const hoursAgo = (n: number) => new Date(NOW - n * 3600_000).toISOString();
const hoursAhead = (n: number) => new Date(NOW + n * 3600_000).toISOString();

function task(gapId: GapId, item: Partial<GapItem> = {}): RankedTask {
  return {
    gapId,
    item: {
      contactId: `c-${gapId}-${item.entityId ?? ''}`,
      name: 'Someone',
      since: hoursAgo(48),
      ...item,
    } as GapItem,
  };
}

const leader = (tasks: RankedTask[]) => mostUrgent(tasks, NOW)!.gapId;

describe('money that is still leaving comes first', () => {
  /*
   * A cancelled booking whose plan is still live is the only task on this card
   * that is worse tomorrow than today: the client's card is charged again next
   * period for an appointment nobody is attending.
   */
  it('beats everything, including a deadline closing within the hour', () => {
    const tasks = [
      task('quote_deadline_unanswered', { entityId: 'q1', eventAt: hoursAhead(1) }),
      task('booking_cancelled', { entityId: 'b1', planLive: true }),
      task('enquiry_unanswered', { entityId: 'e1', since: hoursAgo(500) }),
    ];

    expect(leader(tasks)).toBe('booking_cancelled');
  });

  it('beats an older task of its own kind that is not charging', () => {
    const charging = task('booking_cancelled', { entityId: 'b1', planLive: true, since: hoursAgo(2) });
    const quiet = task('booking_cancelled', { entityId: 'b2', since: hoursAgo(900) });

    expect(mostUrgent([quiet, charging], NOW)!.item.entityId).toBe('b1');
  });
});

describe('a decision about to be taken away', () => {
  /*
   * `eventAt` is when this one closes: a quote's deadline, or the moment the
   * platform marks a meeting completed on the owner's behalf. Inside a day,
   * the kind stops mattering.
   */
  it('promotes any kind whose deadline is within a day', () => {
    const tasks = [
      task('enquiry_unanswered', { entityId: 'e1', since: hoursAgo(300) }),
      task('meeting_unmarked', { entityId: 'm1', eventAt: hoursAhead(6) }),
    ];

    expect(leader(tasks)).toBe('meeting_unmarked');
  });

  it('leaves a distant deadline where its kind belongs', () => {
    // Three weeks out is not today's problem.
    const tasks = [
      task('enquiry_unanswered', { entityId: 'e1', since: hoursAgo(300) }),
      task('quote_deadline_unanswered', { entityId: 'q1', eventAt: hoursAhead(500) }),
    ];

    expect(leader(tasks)).toBe('quote_deadline_unanswered');
    // Still ahead on tier, but as a tier-2 kind rather than as a closing one.
    expect(leader([tasks[0]])).toBe('enquiry_unanswered');
  });

  it('puts the nearest deadline first among several', () => {
    const tasks = [
      task('quote_deadline_unanswered', { entityId: 'far', eventAt: hoursAhead(20) }),
      task('quote_deadline_unanswered', { entityId: 'near', eventAt: hoursAhead(2) }),
    ];

    expect(mostUrgent(tasks, NOW)!.item.entityId).toBe('near');
  });

  /*
   * An absent date is not "far away", it is unknown — and must never beat a
   * real one. `BriefingFactsService.earliest` draws the same line, after a debt
   * due today disappeared behind a sibling that carried no date at all.
   */
  it('never lets a task with no deadline outrank one that has it', () => {
    const tasks = [
      task('quote_deadline_unanswered', { entityId: 'nodate', since: hoursAgo(900) }),
      task('quote_deadline_unanswered', { entityId: 'dated', eventAt: hoursAhead(400), since: hoursAgo(1) }),
    ];

    expect(mostUrgent(tasks, NOW)!.item.entityId).toBe('dated');
  });
});

describe('somebody waiting beats work sitting still', () => {
  it('puts an unanswered enquiry above a phase ready to bill', () => {
    const tasks = [
      task('stage_awaiting_completion', { entityId: 's1', value: 705, currency: 'ILS', since: hoursAgo(400) }),
      task('enquiry_unanswered', { entityId: 'e1', since: hoursAgo(3) }),
    ];

    expect(leader(tasks)).toBe('enquiry_unanswered');
  });

  it('puts the longest wait first among equals', () => {
    const tasks = [
      task('enquiry_unanswered', { entityId: 'new', since: hoursAgo(3) }),
      task('enquiry_unanswered', { entityId: 'old', since: hoursAgo(72) }),
    ];

    expect(mostUrgent(tasks, NOW)!.item.entityId).toBe('old');
  });

  /*
   * A meeting becomes answerable when it ENDS. Charging the wait to the start
   * time asks the owner about a session that may still be running.
   */
  it('measures a meeting from when it ended, not when it began', () => {
    const tasks = [
      task('meeting_unmarked', { entityId: 'long', since: hoursAgo(9), staleFrom: hoursAgo(2) }),
      task('meeting_unmarked', { entityId: 'short', since: hoursAgo(6), staleFrom: hoursAgo(5) }),
    ];

    // `short` ended longer ago, so it has been answerable longer.
    expect(mostUrgent(tasks, NOW)!.item.entityId).toBe('short');
  });
});

describe('money never ranks across currencies', () => {
  /*
   * There is no FX rate anywhere in this platform. The briefing's takings were
   * reported wrong for exactly this reason until it was fixed, and the quote
   * total refuses to publish a figure at all when currencies are mixed.
   */
  it('does not let a larger foreign amount jump a smaller local one', () => {
    const shekels = task('stage_awaiting_completion', { entityId: 'ils', value: 100, currency: 'ILS' });
    const dollars = task('stage_awaiting_completion', { entityId: 'usd', value: 9000, currency: 'USD' });

    // Same tier, same wait, different currencies: the amounts decide nothing,
    // so the stable tiebreak does — and it is the id, not the number.
    const order = rankTasks([dollars, shekels], NOW).map(t => t.item.entityId);
    expect(order).toEqual(['ils', 'usd']);
  });

  it('does use the amount when the currency is the same', () => {
    const small = task('stage_awaiting_completion', { entityId: 'a-small', value: 100, currency: 'ILS' });
    const large = task('stage_awaiting_completion', { entityId: 'z-large', value: 900, currency: 'ILS' });

    // Without the money rule the id tiebreak would put 'a-small' first.
    expect(mostUrgent([small, large], NOW)!.item.entityId).toBe('z-large');
  });
});

describe('the order holds still', () => {
  /*
   * The card shows ONE task with a button on it. An order that reshuffles
   * between two refreshes is an order that gets the wrong thing clicked.
   */
  it('is stable for two tasks alike in everything that ranks', () => {
    const a = task('enquiry_unanswered', { entityId: 'aaa' });
    const b = task('enquiry_unanswered', { entityId: 'bbb' });

    expect(rankTasks([a, b], NOW).map(t => t.item.entityId)).toEqual(['aaa', 'bbb']);
    expect(rankTasks([b, a], NOW).map(t => t.item.entityId)).toEqual(['aaa', 'bbb']);
  });

  it('does not mutate what it was given', () => {
    const tasks = [task('stage_awaiting_completion', { entityId: 's' }), task('enquiry_unanswered', { entityId: 'e' })];
    const before = tasks.map(t => t.item.entityId);

    rankTasks(tasks, NOW);
    expect(tasks.map(t => t.item.entityId)).toEqual(before);
  });
});

describe('a gap nobody ranked', () => {
  /*
   * Adding a gap must not be able to put an unconsidered task at the top of the
   * dashboard. Unknown sorts last, so a new kind is visible in the list and
   * never leads the card until somebody places it.
   */
  it('sorts below every kind that has been placed', () => {
    const known = task('stage_awaiting_completion', { entityId: 'known' });
    const novel = task('something_new' as GapId, { entityId: 'novel' });

    expect(mostUrgent([novel, known], NOW)!.item.entityId).toBe('known');
  });
});

describe('the shapes callers use', () => {
  it('flattens gaps into tasks', () => {
    const flat = tasksOf([
      { id: 'enquiry_unanswered', items: [task('enquiry_unanswered').item, task('enquiry_unanswered').item] },
      { id: 'quote_unsent', items: [task('quote_unsent').item] },
    ]);

    expect(flat).toHaveLength(3);
    expect(flat.map(t => t.gapId)).toEqual(['enquiry_unanswered', 'enquiry_unanswered', 'quote_unsent']);
  });

  it('returns nothing for an empty card rather than throwing', () => {
    expect(mostUrgent([], NOW)).toBeNull();
    expect(rankTasks([], NOW)).toEqual([]);
  });

  it('compares consistently in both directions', () => {
    const a = task('booking_cancelled', { entityId: 'a', planLive: true });
    const b = task('enquiry_unanswered', { entityId: 'b' });

    expect(compareUrgency(a, b, NOW)).toBeLessThan(0);
    expect(compareUrgency(b, a, NOW)).toBeGreaterThan(0);
  });
});
