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
 * Slice 2a (takings, layer B): every money figure sits in an object that also
 * carries its `currency`, and was divided by 100 once from an exact sum of
 * integer hundredths (SA-W26). No field is a total across currencies.
 *
 * Slice 2b (client payment problems, layer B): the same money rule. A due
 * date is a date-only `YYYY-MM-DD` string, never an instant.
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
  /** Section 2 block B, "Takings through the platform" (slice 2a). Not our revenue (BD-1). */
  takings: FinanceTakingsSection;
  /** Section 6 block B, "Client payment problems" (slice 2b). The businesses' problem, not ours (BD-2). */
  paymentProblems: FinancePaymentProblemsSection;
}

// ── Section 2 block B, takings through the platform (slice 2a, S2-FR-1 to S2-FR-14) ──
// The businesses' client payments: NOT our revenue (BD-1). Each money figure
// is in the currency named beside it; none is ever added across currencies.

/** One currency's takings. `currency` null = "Unknown currency". */
export interface FinanceTakingsLine {
  currency: string | null;
  /** Counted payments (succeeded or refunded) in this currency, unreadable amounts included. */
  payments: number;
  /** Σ readable amounts of the counted payments. "At least" when `paymentsExact` is false. */
  gross: number;
  /** Σ readable succeeded refunds. Null when the refunds read failed. */
  refunded: number | null;
  /** gross − refunded, only when both are exact and every amount was read; otherwise null ("Unknown"). */
  net: number | null;
  /** Distinct businesses with a counted payment in this currency. */
  businesses: number;
  /** Payment and refund amounts on this line that could not be read (excluded, never 0). */
  unreadable: number;
  /** Of those, PAYMENT amounts: when above 0, gross is a lower bound ("At least", QA-2). */
  unreadablePayments: number;
}

/** One refund currency (S2-FR-3): succeeded refunds created in the window. */
export interface FinanceRefundLine {
  currency: string | null;
  refunds: number;
  refunded: number;
}

/** One FEE currency (S2-FR-4): `currency` is the fee's own currency, never the payment's. */
export interface FinanceFeeLine {
  currency: string | null;
  fees: number;
  /** Counted payments whose readable fee is in this fee currency. */
  payments: number;
}

export interface FinanceTakingsRow {
  /** Null only defensively: `user_id` is NOT NULL on the payment tables ("Unknown business"). */
  accountId: string | null;
  name: string | null;
  nameStatus: 'found' | 'missing' | 'unavailable' | 'platform' | 'unknown_business';
  currency: string | null;
  payments: number;
  gross: number;
  refunded: number | null;
  net: number | null;
  /** Unreadable payment amounts in this row: when above 0, gross is a lower bound ("At least", QA-2). */
  unreadablePayments: number;
}

export interface FinanceTakingsFigures {
  /** No counted payment and no succeeded refund in the window. */
  empty: boolean;
  /** False when the payments read reached its ceiling: gross and every count are "At least". */
  paymentsExact: boolean;
  /** `partial`: the refunds read reached its ceiling ("At least"); `unknown`: it failed. */
  refundsState: FinanceSectionStatus;
  lines: FinanceTakingsLine[];
  /** Null when the refunds read failed. */
  refundLines: FinanceRefundLine[] | null;
  /** Refunds in any state other than succeeded (amounts left out). Null when the refunds read failed. */
  refundsNotCompleted: number | null;
  feeLines: FinanceFeeLine[];
  /** Counted payments with a readable recorded fee ("Fees recorded on N of M"). */
  feesRecordedOn: number;
  /** M in "Fees recorded on N of M": every counted payment. */
  countedPayments: number;
  /** Recorded fees that could not be read: left out of the fee lines, counted (the block is partial). */
  unreadableFees: number;
  /** Counts per stored processor (trimmed, lower-cased); null = not recorded. */
  processors: Array<{ processorType: string | null; payments: number }>;
  /** Distinct businesses with a counted payment, any currency. */
  businesses: number;
  /** Payments with a status other than succeeded or refunded: counted, left out of every figure. */
  otherStatusPayments: number;
  /** Payment and refund amounts that could not be read (excluded, never 0). */
  unreadableAmounts: number;
  /** At most the display cap (S2-FR-7), sorted by currency, then gross highest first. */
  rows: FinanceTakingsRow[];
  /** Every (business, currency) row before the cap. */
  rowsTotal: number;
}

export interface FinanceTakingsSection {
  status: FinanceSectionStatus;
  scope: 'all' | 'one';
  /** Null only when `status` is `unknown` (the payments read failed). */
  figures: FinanceTakingsFigures | null;
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

// ── Section 6 block B, client payment problems (slice 2b, S2-FR-15 to S2-FR-26) ──
// Where the businesses' clients are not paying: the businesses' problem, not
// ours (BD-2). Every amount is the FULL invoice or instalment amount, never
// what is still owed (S2-F7), in the currency named beside it; none is ever
// added across currencies. A due date is a date-only `YYYY-MM-DD` string.

/** One currency's overdue invoices (or instalments). `currency` null = "Unknown currency". */
export interface FinanceDueLine {
  currency: string | null;
  /** Rows marked `overdue`. */
  marked: number;
  /** Rows still `sent` (invoices) or `pending` (instalments) whose due date is before today, UTC. */
  pastDue: number;
  /** Σ the readable full amounts of both kinds. "At least" when `amountExact` is false. */
  amount: number;
  /** False when the read reached its ceiling or an amount on this line could not be read. */
  amountExact: boolean;
  /** Amounts on this line that could not be read (left out, never 0). */
  unreadable: number;
  /** Distinct businesses with a row in this currency. */
  businesses: number;
  /** The earliest real due date on this line (`YYYY-MM-DD`); null when none is known. */
  oldestDueDate: string | null;
}

/** One overdue invoice or instalment, as the table shows it. */
export interface FinanceDueRow {
  id: string;
  /** Null only defensively ("Unknown business"). */
  accountId: string | null;
  name: string | null;
  nameStatus: 'found' | 'missing' | 'unavailable' | 'platform' | 'unknown_business';
  /** `marked`: stored as overdue. `past_due`: still sent / pending, due before today. */
  kind: 'marked' | 'past_due';
  /** `YYYY-MM-DD`, or null when unknown (an overdue invoice with no due date, SA-W36). */
  dueDate: string | null;
  daysPastDue: number | null;
  /** The full amount; null when it could not be read. */
  amount: number | null;
  currency: string | null;
}

export interface FinanceDueFigures {
  /** No overdue row at all. */
  empty: boolean;
  /** False when the read reached its ceiling: every count and amount is "At least". */
  exact: boolean;
  lines: FinanceDueLine[];
  /** Distinct businesses with an overdue row, any currency (a count, not money). */
  businesses: number;
  /** Overdue rows counted. */
  total: number;
  unreadableAmounts: number;
  /** At most the display cap, oldest due date first, unknown dates last (SA-W30, SA-W36). */
  rows: FinanceDueRow[];
  /** Every counted row before the cap. */
  rowsTotal: number;
}

export interface FinanceDuePart {
  status: FinanceSectionStatus;
  /** Null only when `status` is `unknown` (the read failed). */
  figures: FinanceDueFigures | null;
}

export interface FinanceClientPlansFigures {
  /** False when the read reached its ceiling ("At least"). */
  exact: boolean;
  total: number;
  /** Every known status in the stored vocabulary's order (zeros included), then any other stored value. */
  byStatus: Array<{ status: string | null; plans: number; recognised: boolean }>;
  unrecognised: number;
  /** Exactly `active`, now. */
  activeNow: number;
  cancelledInWindow: number;
  completedInWindow: number;
  /** `active` with a next charge time before now. */
  nextChargeOverdue: number;
  /** Stored times that could not be read (left out of the counts above, never guessed). */
  unreadableTimes: number;
  /** Failed plan charges: `everRecorded` false = "Not recorded: no failure has ever been stored". */
  failedCharges: { everRecorded: boolean; inWindow: number };
}

/** The Jobs & queues figures for the reminder queue, shown plain (no colour). */
export interface FinanceReminderFigures {
  dueNow: number;
  inProgress: number;
  stuck: number;
  failed24h: number;
  failed7d: number;
  deadLettered24h: number;
  deadLettered7d: number;
  /** ISO instant, or null. */
  oldestDueAt: string | null;
}

export interface FinancePaymentProblemsSection {
  /** Never `unknown` (SA-W31): `partial` when any part is partial or unknown, else `ok`. */
  status: FinanceSectionStatus;
  scope: 'all' | 'one';
  /** The UTC date the as-of-now rule used, `YYYY-MM-DD`. */
  today: string;
  /** Fixed: failed client payments are not stored. Never a count (S2-FR-16). */
  failedPayments: { state: 'not_stored' };
  overdueInvoices: FinanceDuePart;
  overdueInstalments: FinanceDuePart;
  clientPlans: { status: FinanceSectionStatus; figures: FinanceClientPlansFigures | null };
  /** `not_narrowed`: a business is picked, so the platform-wide queue was not read. */
  reminders: { status: FinanceSectionStatus; state: 'read' | 'failed' | 'not_narrowed'; figures: FinanceReminderFigures | null };
}
