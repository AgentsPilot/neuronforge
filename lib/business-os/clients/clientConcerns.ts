/**
 * When a client's record is worth interrupting an owner's day for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE THING GOING WRONG IS NOT A PATTERN.
 *
 * Owner's instruction, 2026-11-16: "we are human and sometimes things happen."
 * Three cancellations in a hard month is a person having a hard month. A card
 * that names them for it is the product being wrong about somebody in their
 * own CRM, and the owner learns to distrust the card.
 *
 * So the bar is a COMBINATION. A client reaches the card when at least two
 * different things are true about them — two separate ways of letting the
 * business down, or one that has kept being true over weeks.
 *
 * ── THE THREE CONCERNS ──────────────────────────────────────────────────────
 *
 *   attendance   they miss what they book
 *   lateness     paying late is a habit, not an occasion
 *   persistence  this is not a bad month: the record has read the same way
 *                across weeks
 *
 * `persistence` is why the snapshots exist. It cannot be computed from source
 * rows — those say what happened, never what the record looked like at the
 * time — and it is the one concern that distinguishes a rough patch from a
 * pattern.
 *
 * ── WHAT IS NOT A CONCERN ───────────────────────────────────────────────────
 *
 * Money outstanding today. `invoice_unpaid` already carries it with a chase
 * button this card cannot offer, and the owner asked for no duplicate alerts.
 * Refunds, which are almost always the business's own decision. And a session
 * the BUSINESS called off, which `clientProfile` never counts against anybody.
 *
 * @module lib/business-os/clients/clientConcerns
 */

import type { ClientProfile } from './clientProfile';
import { CLIENT_STANDING, type ClientStanding } from './clientStanding';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT USED TO LIVE HERE, AND WHY IT DOES NOT
 *
 * This file held the thresholds: miss 40% of your sessions, pay late twice.
 * Owner's objection, 2026-11-16, and the live data agreed — on one account the
 * clients sit at 25%, 23%, 21% and 16% missed, so a fixed line either flags
 * everybody or nobody. And a count-based rule punishes volume: a client who
 * buys fifty sessions cancels more of them than one who buys six.
 *
 * The judging moved to `clientScore`, which measures a client against what
 * THIS business's clients actually do. What stayed here is the one fact that
 * cannot be computed from source rows at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * How many weeks of the same reading make it a pattern rather than a month.
 *
 * Three: long enough that a single bad fortnight cannot reach it, short enough
 * that an owner hears about a client who is genuinely drifting while there is
 * still a relationship to repair.
 */
export const PERSISTENCE_WEEKS = 3;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long this client's record has read as concerning, without a break.
 *
 * Asked of the SNAPSHOTS, not of the counts: a rate computed today over 180
 * days cannot tell a client who slipped last week from one who has been
 * slipping since summer. A row exists for every day the picture changed, so
 * the oldest unbroken run of concern is exactly what they record — and it is
 * why `crm_client_standing` exists at all.
 *
 * Zero where there is no history yet, which is the honest state for the first
 * weeks after this ships.
 */
export function persistedWeeks(
  history: Array<{ band: string; as_of: string }>,
  now: Date
): number {
  const concerning = new Set(['watch', 'at_risk']);
  const ordered = [...history].sort((a, b) => b.as_of.localeCompare(a.as_of));
  if (ordered.length === 0 || !concerning.has(ordered[0].band)) return 0;

  let earliest = ordered[0].as_of;
  for (const row of ordered) {
    if (!concerning.has(row.band)) break;
    earliest = row.as_of;
  }

  const from = new Date(earliest);
  if (Number.isNaN(from.getTime())) return 0;
  return Math.floor((now.getTime() - from.getTime()) / WEEK_MS);
}
