/**
 * Wire types of `GET /api/admin/business-os/finance` (finance & business
 * health slices 1a and 1b).
 *
 * RUNTIME-FREE on purpose: only `export type` / `export interface`, and the
 * only import is the runtime-free Health tile status. The admin page is a
 * client component and imports these with `import type` only, so it never
 * pulls the entitlements module, a repository or the rule data into the
 * browser bundle.
 *
 * Money figures are USD numbers converted ONCE from exact integer sums
 * (credits 6 dp, cost 10 dp); the page formats them. Ledger cost is USD by
 * construction (AC-14): it is never summed with any other currency.
 *
 * @module lib/business-os/finance/financeTypes
 */

import type { TileStatus } from '@/lib/admin/health/healthTypes';

/** Per-section honesty (L-5): loaded, loaded but "at least", or could not load. */
export type FinanceSectionStatus = 'ok' | 'partial' | 'unknown';

export type FinanceWindowChoice = 'today' | '7d' | '30d' | 'this_month' | 'custom';

/** The resolved window: inclusive UTC dates plus the half-open instants read. */
export interface FinanceWindowInfo {
  preset: FinanceWindowChoice;
  /** Inclusive UTC date, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive UTC date, `YYYY-MM-DD`. */
  to: string;
  /** ISO instant, inclusive. */
  start: string;
  /** ISO instant, exclusive. */
  end: string;
}

/**
 * The six display groups of Section 1 (§8.1). A tier group's key is
 * `tier:<config tier id>`, built from `config.tierOrder` only (no tier
 * literal). `tier_set` appears only when the paying read failed.
 */
export type FinanceGroupKey = 'trial' | 'founding_partner' | 'comped' | `tier:${string}` | 'unknown_held' | 'tier_set';

export interface FinanceGroupCount {
  key: FinanceGroupKey;
  /** The tier's display label from config (`presentation[tier].labels.en`); null for every other group. */
  tierLabel: string | null;
  count: number;
  /** Accounts of this group in grace, shown beside it. */
  grace: number;
  /** Accounts of this group past due, shown beside it. */
  pastDue: number;
}

export interface FinanceAccountsFigures {
  /** Rows classified. The groups' counts add up to it. */
  total: number;
  groups: FinanceGroupCount[];
  /** False when the paying read failed: Comped and the tier groups are folded into `tier_set`. */
  payingKnown: boolean;
  /** Lifecycle state → count. */
  byState: Record<string, number>;
  foundingNoEndDate: number;
  dormantFounding: number;
  /** Plan rows created in the window, by `origin` as stored (backfill rows are labelled by the page). */
  newInWindow: { total: number; byOrigin: Array<{ origin: string; count: number }> };
  /** Accounts whose tier, cohort or trial ends in the next 30 days. */
  endingIn30Days: number;
}

export interface FinanceAccountsSection {
  status: FinanceSectionStatus;
  /** `one` when a business is picked: Section 1 narrows to it (SA-W1). */
  scope: 'all' | 'one';
  /** Null only when `status` is `unknown`. */
  figures: FinanceAccountsFigures | null;
}

export type FinanceCoverage = 'after_cutover' | 'starts_before_cutover' | 'entirely_before_cutover';

export interface FinanceAmount {
  costUsd: number;
  credits: number;
  /** Ledger rows counted (charges and adjustments). */
  rows: number;
}

export type FinanceTriggerKey = 'owner' | 'scheduled' | 'external' | 'unattributed';

export interface FinanceTopAccount {
  accountId: string;
  /** Null when no name was found or the names read failed (see `nameStatus`). */
  name: string | null;
  /** `platform`: a platform account (SA-WR-5), labelled, never shown as a business or as unknown. */
  nameStatus: 'found' | 'missing' | 'unavailable' | 'platform';
  costUsd: number;
  credits: number;
}

export interface FinanceAiCostFigures {
  /** False when the read reached its ceiling: every figure is "at least". */
  exact: boolean;
  costUsd: number;
  credits: number;
  /** Charge rows (adjustments excluded). */
  chargedActions: number;
  rows: number;
  byTrigger: Array<{ trigger: FinanceTriggerKey } & FinanceAmount>;
  /** By the plan each account is on NOW (BD-8). `unknown` when the plan walk failed. */
  byGroup: {
    /** `partial` when the plan walk hit its ceiling (some accounts may be held wrongly). */
    status: 'ok' | 'partial' | 'unknown';
    lines: Array<{ key: FinanceGroupKey; tierLabel: string | null } & FinanceAmount>;
  };
  topAccounts: FinanceTopAccount[];
  /** Rows of deleted accounts (`user_id` NULL): in the total AND here, never in the top 10. */
  deleted: FinanceAmount;
  /** Amounts that could not be read: counted as 0 and counted here (never silent). */
  unreadableAmounts: number;
  /** Adjustments whose charge could not be found. */
  unresolvedAdjustments: number;
}

export interface FinanceAiCostSection {
  status: FinanceSectionStatus;
  coverage: FinanceCoverage;
  /** Null only when `status` is `unknown`. Zeros (not null) when the window is entirely before the cut-over. */
  figures: FinanceAiCostFigures | null;
}

export type FinanceRevenueState = 'none_yet' | 'recorded' | 'unknown';

export interface FinanceRevenueSection {
  status: FinanceSectionStatus;
  state: FinanceRevenueState;
}

export type FinanceTileId =
  | 'k1_ai_cost'
  | 'k2_far_over_allowance'
  | 'k3_founding_no_end_date'
  | 'k4_gifted_outstanding'
  | 'k5_our_revenue';

/** A number and whether it is exact (`false` = a lower bound, "at least"). */
export interface FinanceMeasured {
  value: number;
  exact: boolean;
}

export interface FinanceTile {
  id: FinanceTileId;
  status: TileStatus;
  /** The first matching rule's description, or a fixed state text. Never "OK". */
  headline: string;
  /** K-1: this month to date (USD); K-2 and K-3: the count; K-4: credits; K-5: none. */
  value: FinanceMeasured | null;
  /** K-1 only: the same elapsed span of last month (USD). Null when not measured. */
  previous: FinanceMeasured | null;
}

export interface FinancePayload {
  generatedAt: string;
  window: FinanceWindowInfo;
  /** The validated business filter, or null for all businesses. An id, never a name. */
  accountId: string | null;
  tiles: { k1: FinanceTile; k2: FinanceTile; k3: FinanceTile; k4: FinanceTile; k5: FinanceTile };
  revenue: FinanceRevenueSection;
  accounts: FinanceAccountsSection;
  aiCost: FinanceAiCostSection;
  credits: FinanceCreditsSection;
}

// ── Section 4, credits (slice 1b, S1-FR-21 to S1-FR-24) ─────────────────────
// Every figure below is in CREDITS, the platform's own unit (6 dp). None is
// money: no currency is attached, and none is ever added to a money figure.

/** One account's row in Section 4. */
export interface FinanceCreditRow {
  accountId: string;
  /** Null when no name was found, the names read failed, or a platform account (see `nameStatus`). */
  name: string | null;
  nameStatus: 'found' | 'missing' | 'unavailable' | 'platform';
  /** The account's current plan group (Section 1's), or null when it has none. */
  group: FinanceGroupKey | null;
  tierLabel: string | null;
  /** `position`: the figures below are read; `no_allowance`: usage with no allowance; `unknown`: could not be read. */
  kind: 'position' | 'no_allowance' | 'unknown';
  /** This credit period's allowance; null unless `position`. */
  allowance: number | null;
  /** Credits used this credit period; null unless `position`. */
  used: number | null;
  /** % used in tenths, rounded DOWN (SA-W17): 1499 = 149.9%. Null unless `position`. */
  usedTenths: number | null;
  trial: boolean;
  /** Used > allowance. Null unless `position`. */
  overAllowance: boolean | null;
  /** At or over the far-over-allowance line (K-2). Null unless `position`, or when the line is invalid. */
  farOverAllowance: boolean | null;
  /** Admin-granted credits still available now. Null when the lots could not be read. */
  giftedOutstanding: number | null;
}

/** The figures that need the credits pass. Null when the section is `unknown`. */
export interface FinanceCreditsFigures {
  /** Every account counted (not only the rows shown). */
  accounts: number;
  /** Accounts used over their allowance. */
  overAllowance: number;
  /** Accounts at or over the far-over-allowance line (= K-2). Null when the line is invalid. */
  farOverAllowance: number | null;
  /** Accounts whose figure could not be read: the counts exclude them (AC-17). */
  unknownAccounts: number;
  noAllowanceAccounts: number;
  /** At most the display cap, sorted by % used, highest first (SA-W15). */
  rows: FinanceCreditRow[];
}

/** Gifted credits (admin grants). Independent of the credits pass (SA-W12). */
export interface FinanceGiftedFigures {
  /** = K-4: Σ outstanding over the lots of existing accounts. Null when any account's lots are unreadable. */
  outstanding: number | null;
  /** Accounts holding gifted credits that have no row in the table (no plan row). */
  accountsNotListed: number | null;
  /** Outstanding on lots of deleted accounts: shown on its own, never in K-4 (SA-W9). Null when unreadable. */
  deletedAccountsOutstanding: number | null;
  /** Accounts with a lot that drew more than it granted (clamped to 0, shown as a note). */
  inconsistentAccounts: number;
  /** Grants in the window, deleted accounts included (the grants did happen). Null when unreadable. */
  window: { granted: number; takenBack: number; grants: number; grantingAdmins: number } | null;
}

export interface FinanceCreditsSection {
  /** Never `partial`: there is no "at least" for a per-account percentage. */
  status: FinanceSectionStatus;
  scope: 'all' | 'one';
  /** The far-over-allowance line in percent, from data (SA-W10); null when the configured value is invalid. */
  farOverAllowancePercent: number | null;
  figures: FinanceCreditsFigures | null;
  /** Null when the lots read failed or reached its ceiling (AC-38). */
  gifted: FinanceGiftedFigures | null;
}
