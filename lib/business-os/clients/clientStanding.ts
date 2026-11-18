/**
 * What the counts add up to, in words an owner can act on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BANDS, NOT A NUMBER OUT OF A HUNDRED.
 *
 * A score invites a comparison it cannot carry — 64 against 71 means nothing
 * about two people with different histories — and it hides the evidence at
 * exactly the moment the owner needs it. This is also the one screen in the
 * product that makes a claim about a PERSON, and it may be read with the
 * client sitting across the table. So the answer is a band and the facts that
 * produced it, and the facts are always shown.
 *
 * ── THE EVIDENCE FLOOR ──────────────────────────────────────────────────────
 * Below it there is no band at all, not a flattering one. One missed session
 * out of one is not a pattern, and a badge that says so would be the product
 * libelling somebody on a single data point.
 *
 * ── WHAT CANNOT MOVE A BAND ─────────────────────────────────────────────────
 * A session the BUSINESS called off, and one nobody is recorded as having
 * called off. Measured on the reporting account: one client's seven
 * cancellations are all the owner's, and attributing them would have put a
 * reliable client in the worst band for the owner's own decisions.
 *
 * @module lib/business-os/clients/clientStanding
 */

import type { ClientProfile } from './clientProfile';

export type ClientBand = 'new' | 'reliable' | 'watch' | 'at_risk';

/**
 * One line of evidence behind a band.
 *
 * A key and its numbers, never a sentence: the surface translates it, and the
 * badge is read in three languages.
 */
export interface ClientStandingReason {
  key: 'missed_sessions' | 'late_payments' | 'overdue_payments';
  count: number;
  of?: number;
}

export interface ClientStanding {
  band: ClientBand;
  reasons: ClientStandingReason[];
  /** Missed and client-cancelled, over settled sessions. Null below the floor. */
  missRate: number | null;
  /** Paid late, over instalments that came due. Null below the floor. */
  lateRate: number | null;
}

/**
 * The thresholds, in one place.
 *
 * Deliberately a constant and not config: an owner tuning the line at which a
 * client is called unreliable is a product decision, not a setting, and the
 * first version of it has to be defensible from the data rather than from
 * whoever moved the slider.
 */
export const CLIENT_STANDING = {
  /** Enough history for a pattern to mean anything. */
  minSettledSessions: 3,
  minInstalmentsDue: 3,
  watch: { missRate: 0.2, lateRate: 0.25, overdue: 1 },
  atRisk: { missRate: 0.4, lateRate: 0.5, lateCount: 2, overdue: 2 },
} as const;

const rate = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

/**
 * The band, and why.
 *
 * Attendance and money are judged separately and the WORSE answer wins: a
 * client who always turns up and never pays is not "half fine".
 */
export function standingFor(profile: ClientProfile): ClientStanding {
  const attendanceKnown = profile.sessionsSettled >= CLIENT_STANDING.minSettledSessions;
  const moneyKnown = profile.instalmentsDue >= CLIENT_STANDING.minInstalmentsDue;

  if (!attendanceKnown && !moneyKnown) {
    return { band: 'new', reasons: [], missRate: null, lateRate: null };
  }

  /* Theirs: a no-show, and a session they called off themselves. Never one the
     business called off, and never one nobody is recorded as calling off. */
  const theirMisses = profile.sessionsMissed + profile.sessionsCancelledByClient;
  const missRate = attendanceKnown ? rate(theirMisses, profile.sessionsSettled) : null;
  const lateRate = moneyKnown ? rate(profile.instalmentsPaidLate, profile.instalmentsDue) : null;

  const reasons: ClientStandingReason[] = [];
  if (theirMisses > 0) {
    reasons.push({ key: 'missed_sessions', count: theirMisses, of: profile.sessionsSettled });
  }
  if (profile.instalmentsPaidLate > 0) {
    reasons.push({ key: 'late_payments', count: profile.instalmentsPaidLate, of: profile.instalmentsDue });
  }
  if (profile.instalmentsOverdue > 0) {
    reasons.push({ key: 'overdue_payments', count: profile.instalmentsOverdue });
  }
  /*
   * REFUNDS ARE NOT A REASON, though the profile counts them.
   *
   * `reasons` exists to explain the BAND, and refunds do not move it: a refund
   * is almost always the business's own decision. Measured across three live
   * accounts — 30, 14 and 6 refunds against clients whose attendance was
   * fine — listing them beside a person's name would read as an accusation
   * for something the owner did. The count stays on the profile, where a
   * report can use it, and off the badge.
   */

  const atRisk =
    (missRate !== null && missRate >= CLIENT_STANDING.atRisk.missRate) ||
    profile.instalmentsOverdue >= CLIENT_STANDING.atRisk.overdue ||
    (lateRate !== null &&
      lateRate >= CLIENT_STANDING.atRisk.lateRate &&
      profile.instalmentsPaidLate >= CLIENT_STANDING.atRisk.lateCount);

  if (atRisk) return { band: 'at_risk', reasons, missRate, lateRate };

  const watch =
    (missRate !== null && missRate >= CLIENT_STANDING.watch.missRate) ||
    (lateRate !== null && lateRate >= CLIENT_STANDING.watch.lateRate) ||
    profile.instalmentsOverdue >= CLIENT_STANDING.watch.overdue;

  if (watch) return { band: 'watch', reasons, missRate, lateRate };

  return { band: 'reliable', reasons, missRate, lateRate };
}
