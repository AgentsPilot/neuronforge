/**
 * Which trial accounts the first-payment read must be asked about, for MK-9's
 * trial-to-paid "Paid" (MK5B-FU-1, SA-WP-M5F M5F-6).
 *
 * `trialsToPaid` (payingBreakdown.ts) looks up a first payment only for a
 * trial whose end parses, is in `[window.start, window.end)`, and is not after
 * `now`. This helper returns every trial whose end parses and is in the window,
 * WITHOUT the `now` condition: a SUPERSET by construction, so the read never
 * misses a lookup, and an extra id cannot change a figure (`trialsToPaid` never
 * reads it). A property test pins the superset against the real
 * `trialsToPaid`. `payingBreakdown.ts` itself is not edited.
 *
 * PURE: no read, no clock, no mode.
 *
 * @module lib/business-os/finance/firstPaymentAsk
 */

/** The ids of the trials whose end falls in `[window.start, window.end)`, de-duplicated, in input order. */
export function trialAccountsToAsk(
  trials: ReadonlyArray<{ accountId: string; endsAt: string | null }>,
  window: { start: Date; end: Date }
): string[] {
  const from = window.start.getTime();
  const to = window.end.getTime();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const trial of trials) {
    if (trial.endsAt === null) continue;
    const end = Date.parse(trial.endsAt);
    if (!Number.isFinite(end) || end < from || end >= to) continue;
    if (seen.has(trial.accountId)) continue;
    seen.add(trial.accountId);
    out.push(trial.accountId);
  }
  return out;
}
