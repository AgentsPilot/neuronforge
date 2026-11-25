/**
 * Which way a client is going, which is the whole reason the snapshots exist.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A BAND IS A STATE; A TREND IS A STORY.
 *
 * "Missed four of sixteen" is true and says nothing about whether this is a
 * client settling down or one on the way out. The source rows cannot answer it
 * — they say what happened, never what the record looked like at the time — so
 * the answer comes from comparing two pictures taken on different days.
 *
 * ── IT IS SILENT UNTIL IT CAN BE HONEST ─────────────────────────────────────
 *
 * `null` whenever there is nothing fair to compare against: no earlier
 * snapshot, or one taken so recently that the comparison would be noise rather
 * than a direction. The first weeks after this ships have no history at all,
 * and a trend invented from one data point would be worse than no trend —
 * this is a claim about a person, and "getting worse" is the most consequential
 * thing the badge can say.
 *
 * ── WHY BANDS AND NOT RATES ─────────────────────────────────────────────────
 *
 * A rate moves on every session: 4 of 16 becomes 4 of 17 by turning up once,
 * and an arrow that flickered on arithmetic would train the owner to ignore it.
 * A band changes when the picture changed enough to be worth a word. The rates
 * stay on the profile for anyone who wants the detail.
 *
 * @module lib/business-os/clients/clientTrend
 */

import type { ClientBand } from './clientStanding';

export type ClientTrend = 'improving' | 'steady' | 'worsening';

/**
 * How far apart two pictures must be before their difference is a direction.
 *
 * Three weeks: shorter than the 180-day window the counts are taken over, long
 * enough that a single session or invoice does not turn into a verdict.
 */
export const TREND_MIN_DAYS = 21;

/** Better to worse. `new` is not on it: it means "we do not know yet". */
const SEVERITY: Record<Exclude<ClientBand, 'new'>, number> = {
  reliable: 0,
  watch: 1,
  at_risk: 2,
};

export interface TrendInput {
  current: { band: ClientBand; asOf: string };
  /** The oldest picture worth comparing against, or null when there is none. */
  earlier: { band: ClientBand; asOf: string } | null;
}

/** Whole days between two ISO dates, or null when either is unreadable. */
function daysBetween(from: string, to: string): number | null {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * The direction, or `null` when nothing honest can be said.
 *
 * `new` on either end returns null rather than being read as an improvement: a
 * client who dropped below the evidence floor has not got better, they have
 * stopped giving us anything to read.
 */
export function trendFrom(input: TrendInput): ClientTrend | null {
  const { current, earlier } = input;
  if (!earlier) return null;
  if (current.band === 'new' || earlier.band === 'new') return null;

  const apart = daysBetween(earlier.asOf, current.asOf);
  if (apart === null || apart < TREND_MIN_DAYS) return null;

  const now = SEVERITY[current.band];
  const then = SEVERITY[earlier.band];

  if (now > then) return 'worsening';
  if (now < then) return 'improving';
  return 'steady';
}

/**
 * The picture to compare against, from the rows a caller already has.
 *
 * The OLDEST snapshot still inside the window, not simply the previous one: the
 * row before today is usually yesterday, and yesterday's band is today's band
 * nearly always. A direction wants distance.
 */
export function earlierOf(
  rows: Array<{ band: string; as_of: string }>,
  today: string,
  minDays: number = TREND_MIN_DAYS
): { band: ClientBand; asOf: string } | null {
  const candidates = rows
    .filter(row => {
      const apart = daysBetween(row.as_of, today);
      return apart !== null && apart >= minDays;
    })
    .sort((a, b) => b.as_of.localeCompare(a.as_of));

  /* The most recent row that is still old enough: closest to the line, so the
     comparison is about the last few weeks rather than about last year. */
  const chosen = candidates[0];
  return chosen ? { band: chosen.band as ClientBand, asOf: chosen.as_of } : null;
}
