/**
 * How unusual a client is FOR THIS BUSINESS, scored rather than thresholded.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE RULES HAD TO GO
 *
 * The first version asked "did they miss 40% of their sessions". Owner's
 * objection, 2026-11-16, and the live data agrees with them: on one account the
 * clients sit at 25%, 23%, 21% and 16% missed. A fixed line either flags all of
 * them or none, and neither is information — in that business, missing a
 * quarter of your sessions IS what people do.
 *
 * And a fixed line punishes volume. Somebody who buys fifty sessions a year
 * will cancel more of them than somebody who buys six, in every count the
 * product can take. Counts are not evidence of anything; rates against the
 * business's own norm are.
 *
 * So: every signal becomes a rate, the business's own clients set the normal,
 * and a client is scored by how far they sit from it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE PROBLEMS A NAIVE RATE HAS, AND WHAT IS DONE ABOUT EACH
 *
 * 1. A SMALL SAMPLE SHOUTS. One missed session out of two is 50%, and means
 *    nothing. Every rate is pulled towards the business's own average in
 *    proportion to how little evidence there is (`shrink`) — the standard
 *    remedy, and the reason a three-session client cannot top the list.
 *
 * 2. ONE OUTLIER MOVES THE AVERAGE. A single disastrous client would drag the
 *    mean up and make everyone else look fine. The norm is a MEDIAN, and the
 *    spread is the median absolute deviation, both of which ignore extremes.
 *
 * 3. A SMALL BUSINESS HAS NO NORM. With two clients there is no distribution
 *    to be unusual against. Below `MIN_PEERS` the norm is declared untrustworthy
 *    and the score falls back to a stated prior, rather than inventing a
 *    statistic from three people.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SCORE IS NEVER SHOWN
 *
 * It is a number so that it can be ordered and a line can be drawn once. What
 * the owner reads is words and the counts behind them — "5 of 10 sessions
 * missed" — because a client's standing has to be checkable against the record,
 * and "73" is not checkable by anybody.
 *
 * @module lib/business-os/clients/clientScore
 */

import type { ClientProfile } from './clientProfile';

export type ScoreSignal = 'attendance' | 'lateness' | 'persistence' | 'drift';

export interface SignalScore {
  key: ScoreSignal;
  /** The client's own rate, after shrinking towards the norm. */
  rate: number;
  /** What this business's clients normally do. */
  norm: number;
  /** How many spreads above the norm. Negative means better than usual. */
  deviation: number;
  /** What it contributed to the score, after weight and confidence. */
  points: number;
  /** The raw facts, for the sentence the owner reads. */
  count: number;
  of?: number;
}

export interface ClientScore {
  score: number;
  signals: SignalScore[];
  /** False when the business has too few clients to have a norm at all. */
  normTrusted: boolean;
}

/** A business needs this many measurable clients before it has a "normal". */
export const MIN_PEERS = 5;

/**
 * What the product assumes when a business has no norm of its own.
 *
 * Deliberately generous. A new business with four clients should almost never
 * see this card: it has no evidence, and the cost of a false accusation there
 * is the same as anywhere else.
 */
export const PRIOR = { attendance: 0.15, lateness: 0.15 } as const;

/**
 * How much evidence a rate needs before it speaks for itself.
 *
 * Five: with five settled sessions a client's own rate carries half the weight
 * and the business's norm the other half. Below that they are mostly described
 * by their peers, which is the honest reading of "we hardly know them".
 */
const SHRINK_K = 5;

/** Weights: money and attendance matter equally; a long run is corroboration. */
const WEIGHT: Record<ScoreSignal, number> = {
  attendance: 1,
  lateness: 1,
  persistence: 0.6,
  /*
   * The heaviest, and the one the other solutions miss.
   *
   * A level says what somebody is like; a CHANGE says what is happening. The
   * client who hurts a business is usually the one who was fine and stopped
   * being fine, and a comparison against other people cannot see them at all —
   * they look ordinary right up until they leave owing money.
   */
  drift: 1.4,
};

/** Above this a client is worth interrupting the owner for. */
export const FLAG_AT = 2;
/** Above this they are worth a quiet word on their own badge. */
export const WATCH_AT = 1;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Median absolute deviation, scaled to compare with a standard deviation.
 *
 * Robust where a standard deviation is not: one client who misses everything
 * inflates a standard deviation enough to hide everybody else behind them.
 */
function spread(values: number[], mid: number): number {
  if (values.length === 0) return 0;
  return 1.4826 * median(values.map(value => Math.abs(value - mid)));
}

/** A rate pulled towards the norm in proportion to how little evidence it has. */
function shrink(part: number, whole: number, norm: number): number {
  if (whole <= 0) return norm;
  return (part + SHRINK_K * norm) / (whole + SHRINK_K);
}

export interface BusinessNorm {
  attendance: number;
  lateness: number;
  attendanceSpread: number;
  latenessSpread: number;
  trusted: boolean;
  peers: number;
  /**
   * ── HOW THE WHOLE COHORT HAS MOVED ────────────────────────────────────────
   *
   * The business's own clients, recent half against earlier half. Positive
   * means everybody is missing more, or paying later, than they used to.
   *
   * This exists because of the question that has to be asked before any client
   * is named: maybe the BUSINESS is not operating well. If every client
   * started missing sessions after the owner moved premises or changed their
   * reminder mail, the clients are not the problem and a card accusing them is
   * the product blaming customers for the owner's own decline.
   *
   * So a client's drift is measured NET of this. Everyone slipping twenty
   * points and one client slipping twenty-two is not a client story. The
   * cohort's own drift is a story — for the advisor card, about the business.
   */
  attendanceDrift: number;
  latenessDrift: number;
}

/**
 * What this business's clients normally do.
 *
 * Measured only over clients with enough history to have a rate at all — a
 * roster of brand-new contacts would otherwise set the normal at zero and make
 * the first person to miss anything look like a crisis.
 */
export function businessNorm(profiles: ClientProfile[]): BusinessNorm {
  const attendance = profiles
    .filter(profile => profile.sessionsSettled >= 3)
    .map(profile => (profile.sessionsMissed + profile.sessionsCancelledByClient) / profile.sessionsSettled);

  const lateness = profiles
    .filter(profile => profile.instalmentsDue >= 3)
    .map(profile => profile.instalmentsPaidLate / profile.instalmentsDue);

  const peers = Math.max(attendance.length, lateness.length);
  const trusted = peers >= MIN_PEERS;

  const attendanceMid = trusted && attendance.length > 0 ? median(attendance) : PRIOR.attendance;
  const latenessMid = trusted && lateness.length > 0 ? median(lateness) : PRIOR.lateness;

  /*
   * The cohort's own movement, pooled rather than averaged per client: one
   * client with two sessions must not weigh the same as one with forty when
   * the question is "what happened to this business".
   */
  const pooled = (pick: (profile: ClientProfile) => { part: number; whole: number }) => {
    let part = 0;
    let whole = 0;
    for (const profile of profiles) {
      const taken = pick(profile);
      part += taken.part;
      whole += taken.whole;
    }
    return whole > 0 ? part / whole : null;
  };

  const attendanceThen = pooled(p => ({ part: p.earlier.sessionsMissed, whole: p.earlier.sessionsSettled }));
  const attendanceNow = pooled(p => ({ part: p.recent.sessionsMissed, whole: p.recent.sessionsSettled }));
  const latenessThen = pooled(p => ({ part: p.earlier.instalmentsPaidLate, whole: p.earlier.instalmentsDue }));
  const latenessNow = pooled(p => ({ part: p.recent.instalmentsPaidLate, whole: p.recent.instalmentsDue }));

  return {
    attendance: attendanceMid,
    lateness: latenessMid,
    /*
     * A floor under the spread, so a business where everybody is identical does
     * not divide by nearly zero and report the first wobble as a ten-sigma
     * event. Five points of rate is the smallest difference worth noticing.
     */
    attendanceSpread: Math.max(spread(attendance, attendanceMid), 0.05),
    latenessSpread: Math.max(spread(lateness, latenessMid), 0.05),
    trusted,
    peers,
    /* Zero where either half is empty: an unknown movement is not a movement. */
    attendanceDrift:
      attendanceThen === null || attendanceNow === null ? 0 : attendanceNow - attendanceThen,
    latenessDrift:
      latenessThen === null || latenessNow === null ? 0 : latenessNow - latenessThen,
  };
}

/**
 * How much of its own weight a signal has earned.
 *
 * A rate over four sessions is a hint; over twenty it is a fact. Rising with
 * the square root rather than linearly, so the twentieth session adds less
 * than the fourth — which is how evidence actually accumulates.
 */
function confidence(volume: number): number {
  return Math.min(1, Math.sqrt(Math.min(volume, 20) / 20));
}

export interface ScoreInput {
  profile: ClientProfile;
  norm: BusinessNorm;
  /** Weeks the record has read as concerning, from the snapshots. */
  persistedWeeks: number;
}

/**
 * The client's score, and what produced it.
 *
 * Only deviations ABOVE the norm add points: being better behaved than the
 * median is not worth a negative score that could cancel out a real problem
 * elsewhere.
 */
export function scoreClient(input: ScoreInput): ClientScore {
  const { profile, norm, persistedWeeks } = input;
  const signals: SignalScore[] = [];

  const theirMisses = profile.sessionsMissed + profile.sessionsCancelledByClient;
  if (profile.sessionsSettled > 0) {
    const rate = shrink(theirMisses, profile.sessionsSettled, norm.attendance);
    const deviation = (rate - norm.attendance) / norm.attendanceSpread;
    signals.push({
      key: 'attendance',
      rate,
      norm: norm.attendance,
      deviation,
      points: Math.max(0, deviation) * WEIGHT.attendance * confidence(profile.sessionsSettled),
      count: theirMisses,
      of: profile.sessionsSettled,
    });
  }

  if (profile.instalmentsDue > 0) {
    const rate = shrink(profile.instalmentsPaidLate, profile.instalmentsDue, norm.lateness);
    const deviation = (rate - norm.lateness) / norm.latenessSpread;
    signals.push({
      key: 'lateness',
      rate,
      norm: norm.lateness,
      deviation,
      points: Math.max(0, deviation) * WEIGHT.lateness * confidence(profile.instalmentsDue),
      count: profile.instalmentsPaidLate,
      of: profile.instalmentsDue,
    });
  }

  /*
   * ── AGAINST THEIR OWN PATTERN, NET OF THE BUSINESS'S ──────────────────────
   *
   * Their recent half against their earlier half, minus whatever the whole
   * cohort did over the same period. If every client started missing sessions
   * when the owner changed premises, nobody here has changed relative to the
   * business they are dealing with, and naming one of them would be blaming a
   * customer for the owner's own decline.
   *
   * Both halves must hold real evidence. A client with one session in each is
   * a coin toss, and `confidence` is taken from the SMALLER half so a long
   * history cannot vouch for a thin recent one.
   */
  const driftOf = (
    then: { part: number; whole: number },
    recently: { part: number; whole: number },
    norm_: number,
    spread_: number,
    cohortDrift: number
  ): number | null => {
    if (then.whole < 3 || recently.whole < 3) return null;
    const before = shrink(then.part, then.whole, norm_);
    const after = shrink(recently.part, recently.whole, norm_);
    return (after - before - cohortDrift) / spread_;
  };

  const attendanceDrift = driftOf(
    { part: profile.earlier.sessionsMissed, whole: profile.earlier.sessionsSettled },
    { part: profile.recent.sessionsMissed, whole: profile.recent.sessionsSettled },
    norm.attendance,
    norm.attendanceSpread,
    norm.attendanceDrift
  );

  const latenessDrift = driftOf(
    { part: profile.earlier.instalmentsPaidLate, whole: profile.earlier.instalmentsDue },
    { part: profile.recent.instalmentsPaidLate, whole: profile.recent.instalmentsDue },
    norm.lateness,
    norm.latenessSpread,
    norm.latenessDrift
  );

  const worstDrift = [attendanceDrift, latenessDrift].filter(
    (value): value is number => value !== null
  );

  if (worstDrift.length > 0) {
    const deviation = Math.max(...worstDrift);
    const evidence = Math.min(
      profile.earlier.sessionsSettled + profile.earlier.instalmentsDue,
      profile.recent.sessionsSettled + profile.recent.instalmentsDue
    );
    signals.push({
      key: 'drift',
      rate: deviation,
      norm: 0,
      deviation,
      points: Math.max(0, deviation) * WEIGHT.drift * confidence(evidence),
      /* The count is the deterioration in whole points of rate, which is what
         the sentence says: "missing twice as often as they used to" needs a
         figure the owner can check against the record. */
      count: Math.round(Math.max(0, deviation) * 100) / 100,
    });
  }

  /*
   * Persistence is corroboration, not an accusation of its own: it says the
   * rest has been true for a while. Capped at four weeks' worth so a client
   * cannot reach the card on duration alone — which is the "we are human"
   * rule, kept from the version this replaces.
   */
  if (persistedWeeks > 0) {
    const weeks = Math.min(persistedWeeks, 4);
    signals.push({
      key: 'persistence',
      rate: weeks,
      norm: 0,
      deviation: weeks,
      points: (weeks / 4) * WEIGHT.persistence,
      count: persistedWeeks,
    });
  }

  const score = signals.reduce((total, signal) => total + signal.points, 0);

  return { score, signals, normTrusted: norm.trusted };
}

/**
 * Which signals actually drove the score, for the sentence the owner reads.
 *
 * A signal that contributed nothing is not a reason, however true it is: "0 of
 * 9 payments late" beside a name reads as an accusation about the thing they
 * did right.
 */
/**
 * The score as a figure an owner can read and compare — 0 to 100.
 *
 * ── WHY NOT THE RAW NUMBER ──────────────────────────────────────────────────
 *
 * The internal score is a sum of weighted standard deviations. It is unbounded
 * (a live test produced 13.61), it has no natural maximum, and "13.61" answers
 * no question anybody asks. Two clients at 13.61 and 24.0 are not meaningfully
 * different; both are far past anything an owner needs to rank.
 *
 * So it is mapped onto a fixed scale with the card's own firing line pinned at
 * 60. A flagged client therefore always reads 60 or more, and two of them can
 * be put in order.
 *
 * ── THE CURVE, AND THE VERSION THAT WAS WRONG ───────────────────────────────
 *
 * The first attempt ran straight from the line to 100 over twice the line, and
 * saturated: two test clients at raw 6.42 and 13.26 — genuinely different
 * people, one twice as far gone as the other — both read 100, which is exactly
 * the failure the figure was added to fix.
 *
 * It now approaches 100 without reaching it, so there is always room above the
 * worst client seen so far. Raw 6 reads 79, raw 13 reads 94, raw 24 reads 99.
 *
 * It is a RANK, not a probability, and nothing in the product treats it as one.
 */
export function displayScore(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;

  if (score <= FLAG_AT) return Math.round((score / FLAG_AT) * 60);

  /* Asymptotic above the line: every real difference stays visible. */
  const beyond = score - FLAG_AT;
  return Math.min(99, Math.round(60 + 40 * (1 - Math.exp(-beyond / 6))));
}

/**
 * The word for a score.
 *
 * The badge and the card read the SAME number, so a client cannot be "needs
 * attention" in one place and ordinary in the other. `new` is not a band on
 * this scale: it means the evidence floor was never reached, which the caller
 * knows and this function does not.
 */
export function bandFromScore(score: number): 'reliable' | 'watch' | 'at_risk' {
  if (score >= FLAG_AT) return 'at_risk';
  if (score >= WATCH_AT) return 'watch';
  return 'reliable';
}

export function drivingSignals(score: ClientScore): SignalScore[] {
  return score.signals.filter(signal => signal.points > 0.1);
}
