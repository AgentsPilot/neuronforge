/**
 * Which one thing the owner should do first.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A MODULE AND NOT A `.sort()` IN A COMPONENT
 *
 * The Needs You card is becoming a card that shows ONE task, with the rest
 * behind a line. That makes the ordering the whole product: when eight rows are
 * visible an owner can disagree with the order and still find what they want,
 * and when one is visible they cannot. A wrong answer here is not a worse list,
 * it is a wrong card.
 *
 * So it is pure, it is tested, and it is separate from anything that renders.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * YOU CANNOT RANK BY AMOUNT, AND THAT IS NOT A LIMITATION
 *
 * There is no FX rate anywhere in this platform — CLAUDE.md says so, the
 * briefing's `owed` groups by currency for it, and the day's takings were
 * reported wrong for exactly this reason until it was fixed. ₪1,200 and $150
 * cannot be compared, so "largest first" is not available.
 *
 * It would be the wrong rule even if it were. The biggest number is rarely the
 * most urgent thing: a ₪705 phase that can be billed next week matters less
 * than a ₪150 card being charged today for an appointment nobody is attending.
 *
 * Money therefore breaks ties INSIDE one currency and decides nothing across
 * them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FOUR TIERS, AND WHAT SEPARATES THEM
 *
 *   1 GETTING WORSE    money is leaving a client's account right now
 *   2 ABOUT TO CLOSE   a decision expires if it is not made
 *   3 SOMEBODY WAITS   a person is waiting on the owner
 *   4 SITTING STILL    real, but nothing changes if it waits a day
 *
 * The line between 1 and 2 is whether waiting COSTS something, and between 2
 * and 3 whether waiting LOSES something. Tier 4 is work, not urgency.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/gaps/mostUrgent
 */

import type { GapId, GapItem } from './types';

/** One task, flattened out of its gap so it can be compared with the others. */
export interface RankedTask {
  gapId: GapId;
  item: GapItem;
}

/**
 * Where each kind sits when nothing about the individual row changes it.
 *
 * `booking_cancelled` is listed at 3 rather than 1: a cancellation with money
 * held is urgent, one with nothing held is an hour to refill. The row decides
 * which, below — this table only says where a kind starts.
 */
const TIER: Record<string, number> = {
  booking_refunded: 2,
  quote_deadline_unanswered: 2,
  meeting_unmarked: 3,
  enquiry_unanswered: 3,
  quote_unwritten: 3,
  quote_unsent: 3,
  booking_cancelled: 3,
  meeting_auto_completed: 4,
  stage_awaiting_completion: 4,
};

/** Anything unrecognised sorts below everything named. Adding a gap is safe. */
const UNRANKED = 9;

/**
 * How soon a deadline has to be before it outranks everything else waiting.
 *
 * A quote valid for another three weeks is not urgent; the same quote with two
 * days left is the thing to do today. Twenty-four hours is deliberately tight:
 * this promotes a task to the top of the card, and a card that cries wolf is a
 * card nobody reads.
 */
const CLOSING_SOON_MS = 24 * 60 * 60 * 1000;

function tierOf(task: RankedTask, now: number): number {
  const { gapId, item } = task;

  /*
   * TIER 1, and the only thing in it.
   *
   * A cancelled booking whose payment plan is still live is money leaving a
   * client's card every period for an appointment that is not happening. It is
   * the one task on this card that is worse tomorrow than it is today, and the
   * registry already treats it as the loudest signal — the row's amber rail
   * keys off the same flag.
   */
  if (item.planLive) return 1;

  /*
   * TIER 2 by the clock rather than by kind.
   *
   * `eventAt` is when this one closes: a quote's `valid_until`, or the moment
   * the platform will mark a meeting completed on the owner's behalf. Near
   * enough and the decision is about to be taken away from them, whatever kind
   * of thing it is.
   */
  const closesAt = item.eventAt ? Date.parse(item.eventAt) : NaN;
  if (Number.isFinite(closesAt) && closesAt - now <= CLOSING_SOON_MS) return 2;

  return TIER[gapId] ?? UNRANKED;
}

/**
 * How long this has been waiting, in milliseconds.
 *
 * `staleFrom` where the gap sets one — a meeting becomes answerable when it
 * ENDS, not when it starts, and charging the wait to the start time asks about
 * a session that is still running. `since` otherwise, which is every other gap.
 */
function waitedFor(item: GapItem, now: number): number {
  const from = Date.parse(item.staleFrom ?? item.since);
  return Number.isFinite(from) ? now - from : 0;
}

/**
 * Compare two tasks. Lower sorts first.
 *
 * Exported for the sort and for the tests; `mostUrgent` and `rankTasks` below
 * are what callers want.
 */
export function compareUrgency(a: RankedTask, b: RankedTask, now: number): number {
  const tier = tierOf(a, now) - tierOf(b, now);
  if (tier !== 0) return tier;

  /*
   * Then the nearest deadline, among those that have one.
   *
   * A task with no deadline is not "far away" — it is unknown, and must never
   * win over a real one. The briefing's `earliest` draws the same line for the
   * same reason: an absent date beating a real one is how a debt due today
   * disappears behind one that carries no date at all.
   */
  const aAt = a.item.eventAt ? Date.parse(a.item.eventAt) : NaN;
  const bAt = b.item.eventAt ? Date.parse(b.item.eventAt) : NaN;
  const aHas = Number.isFinite(aAt);
  const bHas = Number.isFinite(bAt);
  if (aHas && bHas && aAt !== bAt) return aAt - bAt;
  if (aHas !== bHas) return aHas ? -1 : 1;

  /* Then whoever has waited longest. */
  const waited = waitedFor(b.item, now) - waitedFor(a.item, now);
  if (waited !== 0) return waited;

  /*
   * Then the larger amount, and ONLY within one currency.
   *
   * Across currencies this returns 0 and the order falls through to the stable
   * tiebreak below rather than inventing a comparison. Two unrelated numbers
   * are not a ranking.
   */
  const sameCurrency =
    a.item.currency && b.item.currency && a.item.currency === b.item.currency;
  if (sameCurrency) {
    const money = (b.item.value ?? 0) - (a.item.value ?? 0);
    if (money !== 0) return money;
  }

  /* Stable and arbitrary, so the card does not reshuffle between refreshes. */
  return (a.item.entityId ?? a.item.contactId).localeCompare(
    b.item.entityId ?? b.item.contactId
  );
}

/**
 * Every task in order, most urgent first.
 *
 * `now` is a parameter rather than read from the clock so the ordering can be
 * tested without freezing time, and so one render cannot have two different
 * ideas of when it is.
 */
export function rankTasks(tasks: RankedTask[], now: number = Date.now()): RankedTask[] {
  return [...tasks].sort((a, b) => compareUrgency(a, b, now));
}

/** The one the card leads with, or nothing at all. */
export function mostUrgent(tasks: RankedTask[], now: number = Date.now()): RankedTask | null {
  return rankTasks(tasks, now)[0] ?? null;
}

/** Flatten the gap list into comparable tasks. */
export function tasksOf(
  gaps: Array<{ id: GapId; items: GapItem[] }>
): RankedTask[] {
  return gaps.flatMap(gap => gap.items.map(item => ({ gapId: gap.id, item })));
}
