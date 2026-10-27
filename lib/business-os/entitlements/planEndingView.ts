import 'server-only';

/**
 * What changes when a paid plan ends after a cancel: the Cancel drawer's
 * "What changes" step (account-deletion lifecycle SX-2 / D3; workplan
 * docs/workplans/BUSINESS_OS_D3_PLAN_CANCEL_DRAWER_WORKPLAN.md §3; SA R-4,
 * R-6, Q-7; requirement SA-5, XC-19).
 *
 * ── IT DESCRIBES; IT DOES NOT DECIDE ────────────────────────────────────────
 * Display only. It refuses nothing, grants nothing, writes nothing and calls
 * no `check()` / `decide()`. The answer comes from the resolver, through
 * `EntitlementService.previewAfterPlan`, which applies the ONE after-plan rule
 * (`afterPlanAccount`) that SX-2b's writer will also use. So the words and the
 * write cannot drift apart (C-9).
 *
 *   free_plan     user decision BQ-20 (2026-10-27): the account moves to the
 *                 configured free cohort (Test Flight today) until `until`,
 *                 then that cohort's own lapse (read-only for
 *                 `thenReadOnlyDays`, then paused from `thenPausedFrom`). The
 *                 sentence states the CONFIGURED rule, also in shadow mode
 *                 (SA-15, ruled for this flow by SA Q-5).
 *   back_to_plan  the account's OWN cohort outlives the paid plan (a Founding
 *                 Partner, or an unexpired trial). `until` is P-7a.3's
 *                 `freeAccessAfterPaidTier` date when it has one (SA R-4b),
 *                 else the cohort's own end (`null` = open-ended).
 *   unknown       the current basis is not a tier, or the resolver reports an
 *                 anomaly, or the after-plan row does not resolve to a live
 *                 cohort: the drawer says so honestly.
 *
 * `credits` (user G-5 approval, 2026-10-27): the free cohort's one-off credit
 * total, read from that cohort's CONFIG value (`credits.allowance`), never a
 * literal; `null` when the configured allowance is not a one-off total. The
 * drawer formats it in the reader's number format.
 *
 * `loses`: the comparison table's row labels that are ✓ for the account now and
 * not ✓ after (SA Q-7), through the table's own ✓ rule (`comparisonRowIncluded`,
 * Q-3). Labels come from `config/planComparison.ts`, in the reader's language.
 *
 * No cohort id and no tier name in this file: the kind is decided by
 * structure (`moved`, the basis kind, the lifecycle state); plan names are
 * config labels (`planLabel`). The test checks the source.
 *
 * @module lib/business-os/entitlements/planEndingView
 */

import type { AccountId } from './account';
import { comparisonRowIncluded, comparisonRowMembers } from './customerPlanView';
import type { AfterPlanPreview, EntitlementService } from './EntitlementService';
import { getEntitlementService } from './EntitlementService';
import { describePlanCapabilities, planLabel } from './planPresentation';
import type { EntitlementResolution } from './resolver';
import { getEntitlementConfig, type EntitlementConfig } from './source';
import { PLAN_COMPARISON_ROWS, type PlanComparisonRowConfig } from './config/planComparison';
import type { CapabilityDef } from './types';
import type { Locale } from '@/lib/i18n/config';

export type PlanEndingView =
  /** The account's own free plan is still live past the period end. */
  | { kind: 'back_to_plan'; endsAt: string; planName: string; until: string | null; loses: string[] }
  /** User BQ-20: the after-plan free cohort, dated; then its normal lapse. */
  | {
      kind: 'free_plan';
      endsAt: string;
      planName: string;
      until: string;
      /** The free cohort's one-off credit total from its config, or `null` when it is not a total. */
      credits: number | null;
      loses: string[];
      thenReadOnlyDays: number | null;
      thenPausedFrom: string | null;
    }
  /** The resolver gave an anomaly, or the current basis is not a tier. */
  | { kind: 'unknown'; endsAt: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/** The credit allowance capability, named once (as in `creditAllowanceView.ts`). */
const CREDIT_ALLOWANCE = 'credits.allowance';

/** The cohort's configured one-off credit total, or `null` (no such cohort, or not a `{ total }`). */
function cohortCreditTotal(config: EntitlementConfig, cohortId: string): number | null {
  const cohorts = config.cohorts as Readonly<Record<string, { values?: Readonly<Record<string, unknown>> }>>;
  if (!Object.prototype.hasOwnProperty.call(cohorts, cohortId)) return null;
  const value = cohorts[cohortId].values?.[CREDIT_ALLOWANCE] as { total?: unknown } | undefined;
  return typeof value?.total === 'number' && Number.isFinite(value.total) ? value.total : null;
}

function isLiveCohort(resolution: EntitlementResolution): boolean {
  return (
    resolution.basis.kind === 'cohort' &&
    !resolution.anomaly &&
    resolution.state !== 'grace' &&
    resolution.state !== 'paused' &&
    resolution.state !== 'unknown'
  );
}

/** Row labels ✓ for `current` and not ✓ for `after`, in config order. */
function lostRows(
  config: EntitlementConfig,
  current: EntitlementResolution,
  after: EntitlementResolution,
  locale: Locale,
  rows: ReadonlyArray<PlanComparisonRowConfig>
): string[] {
  const catalog = config.catalog as Record<string, CapabilityDef>;
  const describe = (resolution: EntitlementResolution) =>
    new Map(describePlanCapabilities(resolution, catalog, locale).map((row) => [row.capability, row]));
  const now = describe(current);
  const then = describe(after);

  const out: string[] = [];
  for (const row of rows) {
    const members = comparisonRowMembers(row.capabilities, catalog);
    if (members.length === 0) continue;
    if (comparisonRowIncluded(members, now) && !comparisonRowIncluded(members, then)) {
      out.push(row.labels[locale] ?? row.labels.en ?? row.id);
    }
  }
  return out;
}

/** Pure. No I/O, no clock: everything comes in. */
export function buildPlanEndingView(input: {
  config: EntitlementConfig;
  preview: AfterPlanPreview;
  endsAt: string;
  locale: Locale;
  /** Default `PLAN_COMPARISON_ROWS`; injectable for fixtures. */
  rows?: ReadonlyArray<PlanComparisonRowConfig>;
}): PlanEndingView {
  const { config, preview, endsAt, locale } = input;
  const { current, after, afterTrialEnd, moved, freeAccessAfter } = preview;
  const rows = input.rows ?? PLAN_COMPARISON_ROWS;

  if (current.anomaly || current.basis.kind !== 'tier' || !isLiveCohort(after) || after.basis.kind !== 'cohort') {
    return { kind: 'unknown', endsAt };
  }

  const planName = planLabel(config, after.basis.cohort, locale);
  const loses = lostRows(config, current, after, locale, rows);

  if (!moved) {
    return {
      kind: 'back_to_plan',
      endsAt,
      planName,
      // SA R-4b: P-7a.3's date when it has one, so the Founding Partner date is never computed twice.
      until: freeAccessAfter?.endsAt ?? after.lifecycle.accessEndsAt,
      loses,
    };
  }

  const until = after.lifecycle.accessEndsAt;
  if (until === null) return { kind: 'unknown', endsAt };

  let thenReadOnlyDays: number | null = null;
  let thenPausedFrom: string | null = null;
  if (afterTrialEnd && afterTrialEnd.state === 'grace' && afterTrialEnd.lifecycle.graceEndsAt) {
    const accessEndMs = Date.parse(afterTrialEnd.lifecycle.accessEndsAt ?? until);
    const graceEndMs = Date.parse(afterTrialEnd.lifecycle.graceEndsAt);
    if (Number.isFinite(accessEndMs) && Number.isFinite(graceEndMs) && graceEndMs > accessEndMs) {
      thenReadOnlyDays = Math.round((graceEndMs - accessEndMs) / DAY_MS);
      thenPausedFrom = afterTrialEnd.lifecycle.graceEndsAt;
    }
  }

  const credits = cohortCreditTotal(config, after.basis.cohort);
  return { kind: 'free_plan', endsAt, planName, until, credits, loses, thenReadOnlyDays, thenPausedFrom };
}

/**
 * The one entry point outside the module (registered for the my-plan route,
 * XC-19 / SA R-6). `endsAt` is our billing row's period end, passed in by the
 * route from `readPlanPurchaseView`, never a request value (SA R-8). `null`
 * when the account's inputs are unreadable or it has no plan row.
 */
export async function readPlanEndingView(
  input: { accountId: AccountId; endsAt: string; locale: Locale },
  deps: { service?: Pick<EntitlementService, 'previewAfterPlan'>; config?: EntitlementConfig } = {}
): Promise<PlanEndingView | null> {
  const service = deps.service ?? getEntitlementService();
  const preview = await service.previewAfterPlan(input.accountId, input.endsAt);
  if (!preview) return null;
  return buildPlanEndingView({
    config: deps.config ?? getEntitlementConfig(),
    preview,
    endsAt: input.endsAt,
    locale: input.locale,
  });
}
