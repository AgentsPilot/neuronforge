/**
 * The Model pricing KPI figures (AI model price review page layout slice,
 * user feedback UF-7, 2026-10-16). Pure.
 *
 * Every figure comes from data the page already holds: the price comparison
 * (`GET /api/admin/model-pricing/comparison`) and the provider check status
 * that `ProviderPriceCheck` reads. No request of its own.
 *
 * No price arithmetic (slice 4 RC-8): gaps are the server's basis points,
 * printed through `unitGapText`, so a red unit under 1 bp still reads
 * "less than -0.01%". The only arithmetic is on timestamps (the check age).
 */

import type { ComparisonModel, ComparisonRow } from '@/lib/ai/pricing-research/comparisonModel';
import { unitGapText, type UnitComparison } from '@/lib/ai/pricing-research/coverageColour';
import type { FetchStatus } from '@/lib/ai/pricing-research/fetchOutcomes';

import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import type { KpiTileStatus } from '@/app/admin/components/layout/KpiStrip';
import { KPI_WORDS, PROVIDER_NAMES } from '@/app/admin/system-config/priceReviewCopy';

/** A provider check older than this is stale (the user's rule: 3 months = 90 days). */
export const STALE_CHECK_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface KpiFigures {
  value: string;
  sub: string | null;
  status: KpiTileStatus | null;
}

/**
 * The provider check status as the page holds it: `undefined` until
 * `ProviderPriceCheck` reports, `null` when its read failed.
 */
export type CheckStatusState = FetchStatus | null | undefined;

function unitName(unit: string): string {
  return unit.replace('_', ' ');
}

/** Undercharging: red rows, and the single worst undercharging unit in words. */
export function underchargingKpi(rows: readonly ComparisonRow[]): KpiFigures {
  const red = rows.filter((row) => row.colour === 'red');
  if (red.length === 0) return { value: formatCount(0), sub: KPI_WORDS.noneUndercharging, status: null };

  let worst: { row: ComparisonRow; unit: UnitComparison; gap: number } | null = null;
  for (const row of red) {
    for (const unit of row.units) {
      if (unit.status !== 'undercharging' || unit.gapBasisPoints === null) continue;
      if (worst === null || unit.gapBasisPoints < worst.gap) worst = { row, unit, gap: unit.gapBasisPoints };
    }
  }
  const notPriced = red.filter((row) => row.units.some((unit) => unit.status === 'not_priced')).length;
  const sub = worst
    ? `${KPI_WORDS.worst} ${unitGapText(worst.unit)} (${worst.row.modelName} ${unitName(worst.unit.unit)})`
    : `${formatCount(notPriced)} ${KPI_WORDS.notPriced}`;
  return { value: formatCount(red.length), sub, status: 'red' };
}

/** Pending prices: distinct pending lines (an image line shows once per unit, so ids are de-duplicated). */
export function pendingKpi(rows: readonly ComparisonRow[]): KpiFigures {
  const lines = new Set<string>();
  for (const row of rows) for (const view of row.pending) lines.add(view.lineId);
  return { value: formatCount(lines.size), sub: KPI_WORDS.awaitingApply, status: null };
}

/**
 * Models in use: rows with at least one SWITCHED-ON Business OS area tag
 * (SA F-1: the user's "actively being used"). `AreaTag.enabled` is false when
 * every call of that area is switched off: the "(off)" chip in "Used by". A
 * row whose tags are all off is not in use.
 */
export function modelsInUseKpi(rows: readonly ComparisonRow[]): KpiFigures {
  const used = rows.filter((row) => row.areas.some((tag) => tag.enabled)).length;
  return { value: formatCount(used), sub: `${KPI_WORDS.of} ${formatCount(rows.length)} ${KPI_WORDS.compared}`, status: null };
}

/** One automatically checked provider's last success, as the KPI weighs it. */
export interface ProviderCheck {
  provider: string;
  lastOkAt: string | null;
}

/**
 * The B-1 policy (user decision 2026-10-18, "Oldest of the two"; SA SC10-4):
 * which provider's last successful check the tile shows. A provider that has
 * never succeeded decides first; otherwise the OLDEST success, and an
 * unreadable time counts as oldest (it cannot prove the check is recent).
 * `named` is true when the providers' checks differ, so the tile says whose
 * check it is. If the policy ever changes, only this function and its tests
 * change.
 */
export function decidingCheck(checks: readonly ProviderCheck[]): { check: ProviderCheck; named: boolean } | null {
  if (checks.length === 0) return null;
  const named = checks.some((check) => check.lastOkAt !== checks[0].lastOkAt);
  const never = checks.find((check) => !check.lastOkAt);
  if (never) return { check: never, named };
  const age = (check: ProviderCheck) => {
    const at = Date.parse(check.lastOkAt ?? '');
    return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
  };
  const oldest = checks.reduce((older, check) => (age(check) < age(older) ? check : older));
  return { check: oldest, named };
}

/** The automatically checked providers the status reports, in display order. */
function providerChecks(status: FetchStatus): ProviderCheck[] {
  const checks: ProviderCheck[] = [{ provider: PROVIDER_NAMES.openai, lastOkAt: status.openai.lastOkAt }];
  // A status from before slice 10 has no `anthropic` key: that provider is not reported, so it is left out.
  const anthropic: FetchStatus['anthropic'] | undefined = status.anthropic;
  if (anthropic) checks.push({ provider: PROVIDER_NAMES.anthropic, lastOkAt: anthropic.lastOkAt });
  return checks;
}

/**
 * Last provider check: the last SUCCESSFUL check of the provider chosen by
 * `decidingCheck` (B-1: the older of OpenAI's and Anthropic's, named when they
 * differ). "Now" is the server's `generatedAt` from the comparison (slice 4
 * NR-1), never the browser clock, so the rule is the same for every admin and
 * testable. Red when a provider never succeeded, or when the check shown is
 * more than 90 days old.
 */
export function lastCheckKpi(status: CheckStatusState, generatedAt: string): KpiFigures {
  if (status === undefined) return { value: KPI_WORDS.reading, sub: null, status: null };
  if (status === null) return { value: KPI_WORDS.unavailable, sub: KPI_WORDS.statusUnavailable, status: 'amber' };

  const deciding = decidingCheck(providerChecks(status));
  const lastOkAt = deciding?.check.lastOkAt ?? null;
  const who = deciding?.named ? `${deciding.check.provider} ` : '';
  if (!lastOkAt) return { value: KPI_WORDS.neverChecked, sub: `${who}${KPI_WORDS.runCheck}`, status: 'red' };

  const shown = deciding?.named ? `${deciding.check.provider}, ${formatUtc(lastOkAt)}` : formatUtc(lastOkAt);
  const ageMs = Date.parse(generatedAt) - Date.parse(lastOkAt);
  // An unreadable timestamp cannot prove the check is recent, so it is stale.
  if (!Number.isFinite(ageMs)) return { value: shown, sub: KPI_WORDS.ageUnknown, status: 'red' };

  const days = Math.max(0, Math.floor(ageMs / DAY_MS));
  const sub = days === 0 ? KPI_WORDS.today : `${formatCount(days)} ${days === 1 ? KPI_WORDS.dayAgo : KPI_WORDS.daysAgo}`;
  const isStale = ageMs > STALE_CHECK_DAYS * DAY_MS;
  return { value: shown, sub: isStale ? `${sub}; ${KPI_WORDS.stale}` : sub, status: isStale ? 'red' : null };
}

/** All four, from the comparison and the check status. */
export function priceKpis(comparison: ComparisonModel, status: CheckStatusState) {
  return {
    undercharging: underchargingKpi(comparison.rows),
    pending: pendingKpi(comparison.rows),
    lastCheck: lastCheckKpi(status, comparison.generatedAt),
    modelsInUse: modelsInUseKpi(comparison.rows),
  };
}
