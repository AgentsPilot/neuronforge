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
 * Slice 4a (our boost revenue, layer A): the same money rule again. Every
 * boost money figure sits in an object that also carries its `currency`, was
 * summed in integer minor units of that currency and divided by 100 once. K-5
 * carries its money in `money`, never in `value` (SA-W47), and never a sum of
 * two currencies.
 *
 * Slice 5a (our plan revenue, layer A): plan payments received in the window,
 * per currency, with the same money rule. `revenue.totals` adds boost net and
 * plans received WITHIN one currency only (SA-Q40); K-5's `money.net` is that
 * total. No field is a total across currencies.
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
  /**
   * Slice 1c (BD-15, SA-Q24): accounts in this TIER group that hold the
   * Founding Partner cohort (paying, so grouped by their paid tier). Shown as a
   * note on the group row; 0 for every non-tier group.
   */
  foundingPartners: number;
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

// ── Our revenue, credit boosts (slice 4a, S4-FR-1 to S4-FR-14) ──────────────
// The platform's own boost purchases, paid in the window. Each money figure is
// in the currency named beside it; none is ever added across currencies.

/** One currency's boosts (S4-W-6). `currency` null = "Unknown currency". */
export interface FinanceBoostLine {
  currency: string | null;
  /** Counted purchases (paid family) in this currency, unreadable ones included. */
  purchases: number;
  /** Σ readable amounts charged. "At least" when not exact or `unreadable` > 0. */
  gross: number;
  /** Of which tax (shown, not deducted). */
  tax: number;
  refunded: number;
  /** Held in open disputes; null when it cannot be exact ("Unknown"). */
  held: number | null;
  /** Lost in disputes; null when it cannot be exact. */
  lost: number | null;
  /** gross − refunded − held − lost, only when exact; otherwise null (never a lower bound minus a figure). */
  net: number | null;
  /** Credits sold (credits, not money). "At least" when not exact or `unreadableCredits` > 0. */
  creditsSold: number;
  /** Purchases with an unreadable amount (excluded from every sum, never 0). */
  unreadable: number;
  /** Purchases whose credits could not be read (excluded from credits sold). */
  unreadableCredits: number;
}

/** One (currency, package, version) row, as stored on the purchase (SA-Q30). */
export interface FinanceBoostPackageRow {
  currency: string | null;
  /** Null: not recorded (defensive). */
  packageId: string | null;
  packageVersion: number | null;
  purchases: number;
  gross: number;
  refunded: number;
  net: number | null;
  unreadable: number;
}

/** One currency's purchases from deleted accounts (S4-W-7). Never a name. */
export interface FinanceBoostDeletedLine {
  currency: string | null;
  purchases: number;
  net: number | null;
  unreadable: number;
}

export interface FinanceBoostNotes {
  /** No counted purchase in the window. */
  empty: boolean;
  /** False when the read reached its ceiling: counts and amounts are "At least", held / lost / net Unknown. */
  exact: boolean;
  /** Purchases read with a status outside the paid family: left out of every figure, counted. */
  otherStatusPurchases: number;
  /** Counted purchases with an unreadable amount. */
  unreadablePurchases: number;
  /** A refund or dispute amount is non-zero (or unknown on a refund or dispute row): the S4-W-3 note shows. */
  refundOrDispute: boolean;
}

export interface FinanceBoostRevenue {
  status: FinanceSectionStatus;
  scope: 'all' | 'one';
  /** Null only when `status` is `unknown` (the read failed). */
  lines: FinanceBoostLine[] | null;
  packages: FinanceBoostPackageRow[] | null;
  /** Null with a business picked (S4-FR-8) or when the read failed. */
  deletedAccounts: FinanceBoostDeletedLine[] | null;
  notes: FinanceBoostNotes | null;
}

// ── Our revenue, plans (slice 5a, §11D.4 M2-FR-1 to M2-FR-11) ───────────────
// The platform's own paid plan invoices, by `paid_at` in the window. Each money
// figure is in the currency named beside it, received INCLUDING any tax, before
// any refund (none is recorded for plans yet) and before Stripe fees.

/** One currency's plan payments (M2-FR-1). `currency` null = "Unknown currency". */
export interface FinancePlanLine {
  currency: string | null;
  /** Readable paid invoices with an amount above 0. */
  payments: number;
  /** Σ amounts received (tax included). "At least" when not `exact`. */
  received: number;
  /** Of which tax (shown, never deducted). */
  tax: number;
  /** Distinct accounts with a payment in this currency (deleted accounts not counted). */
  businesses: number;
  /** Readable paid invoices of 0 in this currency: not payments (M2-W-5). */
  zeroAmountInvoices: number;
  /** Paid invoices whose money could not be read: excluded, never 0 (SA-W64). */
  unreadable: number;
  /** False at the ceiling or with an unreadable row or an overflow on this line: payments, received and tax are "At least". */
  exact: boolean;
}

/** One (account, currency) row of the by-business table (M2-FR-2). */
export interface FinancePlanAccountRow {
  accountId: string;
  name: string | null;
  nameStatus: 'found' | 'missing' | 'unavailable' | 'platform';
  currency: string | null;
  payments: number;
  received: number;
  exact: boolean;
}

/** One payment of the picked business (M2-FR-3), newest first. */
export interface FinancePlanPaymentListRow {
  /** The billing event row's own id (an internal UUID, never a Stripe id). */
  id: string;
  /** ISO timestamptz, shown through `formatUtc`; null only defensively (the read filters on it). */
  paidAt: string | null;
  /** The plan's display label, or null ("Unknown plan"). */
  planLabel: string | null;
  received: number;
  tax: number;
  currency: string | null;
  /** ISO timestamptz, or null ("Not recorded"). */
  periodStart: string | null;
  periodEnd: string | null;
}

/** One currency's plan payments from deleted accounts (M2-W-8). Never a name. */
export interface FinancePlanDeletedLine {
  currency: string | null;
  payments: number;
  received: number;
  exact: boolean;
}

export interface FinancePlanNotes {
  /** No payment and no unreadable paid invoice in the window. */
  empty: boolean;
  /** False when the read reached its ceiling. */
  exact: boolean;
  zeroAmountInvoices: number;
  unreadable: number;
  /** Rows of another kind (impossible by the query; left out, counted). */
  otherKind: number;
}

export interface FinancePlanRevenue {
  status: FinanceSectionStatus;
  scope: 'all' | 'one';
  /** Null only when `status` is `unknown` (the read failed). */
  lines: FinancePlanLine[] | null;
  /** All businesses only: at most the display cap. */
  accounts: FinancePlanAccountRow[] | null;
  /** Every (account, currency) row before the cap; all businesses only. */
  accountsTotal: number | null;
  /** One business only: at most the display cap, newest first. */
  payments: FinancePlanPaymentListRow[] | null;
  /** Every payment before the cap; one business only. */
  paymentsTotal: number | null;
  /** All businesses only; `[]` when none. */
  deletedAccounts: FinancePlanDeletedLine[] | null;
  notes: FinancePlanNotes | null;
}

/**
 * One currency of "boosts net plus plans received" (SA-Q40, E-34). Every money
 * key sits beside `currency`; a part or the total is null when it cannot be
 * exact. Never across currencies.
 */
export interface FinanceRevenueTotalLine {
  currency: string | null;
  boostsNet: number | null;
  plansReceived: number | null;
  total: number | null;
}

export interface FinanceRevenueSection {
  /** From the two money parts (SA-W62): `unknown` when boosts AND plans failed; `partial` when one did or either is partial. */
  status: FinanceSectionStatus;
  /**
   * All businesses: R-d, unchanged (any paid plan invoice or paid boost,
   * platform-wide). One business (E-36): from that business's own reads.
   */
  state: FinanceRevenueState;
  /** Plan payments received in the window (slice 5a, M2-FR-11; replaced R-d's plans line, SA-W61). */
  plans: FinancePlanRevenue;
  /** Credit boosts paid in the window (S4-FR-10). */
  boosts: FinanceBoostRevenue;
  /** Boost net plus plans received, per currency (SA-Q40); null when either read failed. Never across currencies. */
  totals: FinanceRevenueTotalLine[] | null;
}

/**
 * K-5's money (SA-W47): one currency's figure, a count of currencies (never a
 * sum), nothing yet, or unknown. Set on K-5 only. Slice 5a (SA-W60): `net` is
 * boost net plus plans received, in one currency.
 */
export type FinanceTileMoney =
  | { kind: 'one'; currency: string | null; net: number }
  | { kind: 'several'; currencies: number }
  | { kind: 'none' }
  | { kind: 'unknown'; reason: 'failed' | 'cut_off' | 'unreadable' };

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
  /** K-1: this month to date (USD); K-2 and K-3: the count; K-4: credits; K-5: none (see `money`). */
  value: FinanceMeasured | null;
  /** K-1 only: the same elapsed span of last month (USD). Null when not measured. */
  previous: FinanceMeasured | null;
  /** K-5 only (slice 4a, SA-W47; slice 5a): boost net plus plans received for the window, with its currency. Absent on K-1 to K-4. */
  money?: FinanceTileMoney;
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
