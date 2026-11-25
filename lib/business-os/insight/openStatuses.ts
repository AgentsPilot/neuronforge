/**
 * What "open" means for an insight, in one place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `InsightRepository` has always had this list: the statuses at which a finding
 * is still on the owner's dashboard, so a second detection updates that row
 * instead of raising a duplicate beside it.
 *
 * `BaseDetector` now needs the same answer — a finding that is on screen is
 * never on cooldown, because its figures have to follow the data — and two
 * copies of a status list drift the day a status is added. It cannot import the
 * repository (the repository constructs detectors' siblings and the cycle is
 * real), so the list lives here and both import it.
 *
 * Plain data, no imports: this file must stay importable from anywhere.
 *
 * @module lib/business-os/insight/openStatuses
 */

/** Still on the dashboard: raised, maybe read, neither acted on nor dismissed. */
export const OPEN_STATUSES = ['new', 'viewed'] as const;

export type OpenInsightStatus = (typeof OPEN_STATUSES)[number];

/** Is this an insight the owner can still see? A null status is not. */
export function isOpenStatus(status: string | null | undefined): boolean {
  return status === 'new' || status === 'viewed';
}
