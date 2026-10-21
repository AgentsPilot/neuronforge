/**
 * Section 1's classifier (finance & business health slice 1a, §8.1, SA-F7,
 * SA-Q3, SA-Q5, SA-W3, SA-WR-4).
 *
 * PURE: plan rows, the paying set, the window, `now` and the entitlement
 * config are all passed in (SA-WR-4: the config is a parameter, the wiring
 * passes `getEntitlementConfig()`), so nothing here reads module state.
 *
 * THE ONLY FINANCE BUILDER FILE THAT IMPORTS FROM THE ENTITLEMENTS MODULE, for
 * DISPLAY only: it derives each row's lifecycle with the module's own
 * `deriveLifecycle(fromPlanRow(row), lifecycleInputs(config), now)` and counts
 * "no end date" / "dormant" with the shadow report's own predicates, so there
 * is one definition for both callers. It never calls `check()` / `decide()` and
 * refuses nothing (registered as a non-gate importer).
 *
 * No tier literal and no cohort-id literal: tier groups are built from
 * `config.tierOrder` and labelled from `config.matrix.presentation`; a cohort
 * maps to a group only through `stateForCohort` (SA-W3).
 *
 * Slice 1c (BD-15, SA-Q20, SA-Q23, SA-Q24): a PAYING account the §8.1 mapping
 * places in Founding Partner goes to its paid tier's group instead
 * (`paidTierOf`, applied right after `groupFor`, which is unchanged, SA-W44);
 * each tier group counts its Founding Partner cohort accounts for a note; "no
 * end date" and "dormant" count the Founding Partner group only (SA-W42).
 *
 * @module lib/business-os/finance/planGroups
 */

import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { fromPlanRow } from '@/lib/business-os/entitlements/account';
import { deriveLifecycle, stateForCohort } from '@/lib/business-os/entitlements/lifecycle';
import type { LifecycleResult } from '@/lib/business-os/entitlements/lifecycle';
import { isDormantChampion, isOpenEndedCohort, lifecycleInputs } from '@/lib/business-os/entitlements/report';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { LifecycleState } from '@/lib/business-os/entitlements/types';
import type { FinanceAccountsFigures, FinanceGroupCount, FinanceGroupKey } from './financeTypes';

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Ending soon" horizon (S1-FR-13). */
export const ENDING_SOON_DAYS = 30;

const tierKey = (tier: string): FinanceGroupKey => `tier:${tier}`;

/** The group of a live (not lapsed) state, when the state alone decides it. */
function groupOfState(state: LifecycleState): FinanceGroupKey | null {
  if (state === 'trial') return 'trial';
  if (state === 'champion') return 'founding_partner';
  return null;
}

/**
 * The §8.1 mapping. `isPaying`: `true` / `false` from the paying read, `null`
 * when that read failed (the tier groups then fold into "Tier set").
 * Every pair not listed in §8.1 is Unknown/held, so the groups always sum to
 * the total.
 */
export function groupFor(lifecycle: LifecycleResult, isPaying: boolean | null): FinanceGroupKey {
  const byState = groupOfState(lifecycle.state);
  if (byState) return byState;

  const { state, basis } = lifecycle;
  if ((state === 'active' || state === 'past_due' || state === 'grace') && basis.kind === 'tier') {
    if (isPaying === null) return 'tier_set';
    return isPaying ? tierKey(basis.tier) : 'comped';
  }
  if (state === 'grace' && basis.kind === 'cohort') {
    // A lapsed cohort sits in its own cohort's group, through the module's
    // one cohort → state function; a cohort that names no state is held.
    return groupOfState(stateForCohort(basis.cohort)) ?? 'unknown_held';
  }
  return 'unknown_held';
}

/**
 * SA-Q20 / SA-WR-29: the tier a PAYING champion is grouped under. The plan
 * row's tier first (the entitlement truth, written by the webhook), when it is
 * in `tierOrder`; otherwise the tier its billing row bought, when that is in
 * `tierOrder`; otherwise null (Unknown/held, never dropped). Values are only
 * compared with `tierOrder`: no tier is written here.
 */
export function paidTierOf(
  planTier: string | null | undefined,
  boughtTier: string | null | undefined,
  tierOrder: readonly string[]
): string | null {
  if (planTier && tierOrder.includes(planTier)) return planTier;
  if (boughtTier && tierOrder.includes(boughtTier)) return boughtTier;
  return null;
}

/**
 * Whether a cohort id is the Founding Partner cohort, through the module's one
 * cohort → state function (no cohort literal). Written `!!cohort`, never as a
 * comparison with an empty string: the cohort-literal guard matches that form.
 */
const isChampionCohort = (cohort: string | null | undefined): boolean =>
  !!cohort && stateForCohort(cohort) === 'champion';

/**
 * QA-1: whether a cohort period is current at `nowMs`: no end date, or an end
 * strictly after now. An unparseable end is treated as ended (no note, never a
 * claim the data cannot back).
 */
const isCohortCurrent = (expiresAt: string | null | undefined, nowMs: number): boolean => {
  if (!expiresAt) return true;
  const end = new Date(expiresAt).getTime();
  return Number.isFinite(end) && end > nowMs;
};

/** The tier label from config, the only place a tier's display name lives. */
function tierLabelOf(config: EntitlementConfig, tier: string): string {
  const presentation = config.matrix.presentation as Readonly<Record<string, { labels: { en: string } } | undefined>>;
  return presentation[tier]?.labels.en ?? tier;
}

/** Every group, seeded at 0 in display order. `tier_set` only when the paying read failed. */
export function seedGroups(config: EntitlementConfig, payingKnown: boolean): FinanceGroupCount[] {
  const zero = (key: FinanceGroupKey, tierLabel: string | null = null): FinanceGroupCount => ({
    key,
    tierLabel,
    count: 0,
    grace: 0,
    pastDue: 0,
    foundingPartners: 0,
  });
  const groups = [zero('trial'), zero('founding_partner')];
  if (payingKnown) {
    groups.push(zero('comped'));
    for (const tier of config.tierOrder) groups.push(zero(tierKey(tier), tierLabelOf(config, tier)));
  } else {
    groups.push(zero('tier_set'));
  }
  groups.push(zero('unknown_held'));
  return groups;
}

export interface ClassifiedAccounts {
  figures: FinanceAccountsFigures;
  /** Each classified account's group, for Section 3's breakdown by current plan. */
  groupByAccount: ReadonlyMap<string, FinanceGroupKey>;
  /**
   * NON-WIRE (slice 6a, SA-W77): the accounts counted in a tier group's
   * `foundingPartners`, under exactly that condition, so the Accounts tab's
   * Founding Partner chip and Section 1's note cannot differ. Its size equals
   * the sum of `foundingPartners` over the groups.
   */
  foundingPartnerNote: ReadonlySet<string>;
}

export interface ClassifyInput {
  rows: readonly BusinessOsAccountPlan[];
  /** Accounts paying now; null when the paying read failed. */
  payingIds: ReadonlySet<string> | null;
  /**
   * Slice 1c (SA-Q20): each paying account's `bought_tier`, from its paying
   * billing row only. Optional: absent means none known. Validated here
   * against `config.tierOrder`, never trusted as is.
   */
  paidTierHints?: ReadonlyMap<string, string>;
  window: { start: Date; end: Date };
  now: Date;
  config: EntitlementConfig;
}

const within = (iso: string | null | undefined, from: number, to: number): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= from && t < to;
};

/** One pass over the plan rows: groups, states, no end date, dormant, new in window, ending soon. */
export function classifyAccounts(input: ClassifyInput): ClassifiedAccounts {
  const { rows, payingIds, window, now, config } = input;
  const payingKnown = payingIds !== null;
  const groups = seedGroups(config, payingKnown);
  const groupIndex = new Map(groups.map((g, i) => [g.key, i]));
  const inputs = lifecycleInputs(config);
  const byState: Record<string, number> = {};
  const byOrigin = new Map<string, number>();
  const groupByAccount = new Map<string, FinanceGroupKey>();
  const foundingPartnerNote = new Set<string>();
  let foundingNoEndDate = 0;
  let dormantFounding = 0;
  let newTotal = 0;
  let endingIn30Days = 0;

  const nowMs = now.getTime();
  const soonMs = nowMs + ENDING_SOON_DAYS * DAY_MS;
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();

  for (const row of rows) {
    const lifecycle = deriveLifecycle(fromPlanRow(row), inputs, now);
    const isPaying = payingIds === null ? null : payingIds.has(row.user_id);
    let key = groupFor(lifecycle, isPaying);
    // BD-15 (SA-W44): a PAYING account the §8.1 table places in Founding
    // Partner (champion, or grace on the champion cohort) goes to its paid
    // tier. Never when the paying read failed (`null`): champions then stay.
    if (key === 'founding_partner' && isPaying === true) {
      const paidTier = paidTierOf(row.tier, input.paidTierHints?.get(row.user_id), config.tierOrder);
      key = paidTier ? tierKey(paidTier) : 'unknown_held';
    }
    // A tier group outside the seeded set cannot occur (deriveLifecycle refuses
    // an unknown tier), but if it ever did it is held, never dropped.
    if (!groupIndex.has(key)) key = 'unknown_held';
    const group = groups[groupIndex.get(key) as number];

    group.count += 1;
    if (lifecycle.state === 'grace') group.grace += 1;
    if (lifecycle.state === 'past_due') group.pastDue += 1;
    byState[lifecycle.state] = (byState[lifecycle.state] ?? 0) + 1;
    groupByAccount.set(row.user_id, key);
    // SA-Q24: a tier group holds paying accounts only; count its Founding Partners for the note.
    // QA-1: only while the Founding Partner period is current (no end, or an end after `now`).
    if (key.startsWith('tier:') && isChampionCohort(row.cohort) && isCohortCurrent(row.cohort_expires_at, nowMs)) {
      group.foundingPartners += 1;
      foundingPartnerNote.add(row.user_id);
    }

    if (key === 'founding_partner' && isOpenEndedCohort(row)) foundingNoEndDate += 1;
    // SA-Q23 / SA-W42: the Founding Partner group only, like K-3 above.
    if (key === 'founding_partner' && isDormantChampion(row)) dormantFounding += 1;

    if (within(row.created_at, startMs, endMs)) {
      newTotal += 1;
      byOrigin.set(row.origin, (byOrigin.get(row.origin) ?? 0) + 1);
    }

    if (
      within(row.tier_expires_at, nowMs, soonMs) ||
      within(row.cohort_expires_at, nowMs, soonMs) ||
      within(lifecycle.trial?.endsAt, nowMs, soonMs)
    ) {
      endingIn30Days += 1;
    }
  }

  return {
    figures: {
      total: rows.length,
      groups,
      payingKnown,
      byState,
      foundingNoEndDate,
      dormantFounding,
      newInWindow: {
        total: newTotal,
        byOrigin: [...byOrigin.entries()]
          .map(([origin, count]) => ({ origin, count }))
          .sort((a, b) => a.origin.localeCompare(b.origin)),
      },
      endingIn30Days,
    },
    groupByAccount,
    foundingPartnerNote,
  };
}

/** The tier label of a group key, for any breakdown that shows groups. */
export function tierLabelForGroup(config: EntitlementConfig, key: FinanceGroupKey): string | null {
  return key.startsWith('tier:') ? tierLabelOf(config, key.slice('tier:'.length)) : null;
}
