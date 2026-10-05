/**
 * The leak check's result (credit deduction slice 4b, workplan §5.2 to §5.4).
 *
 * Server-side. The admin page re-declares it in
 * `app/admin/business-os-llm/leakTypes.ts` (its source guard forbids `@/lib/`
 * imports); `__tests__/creditLeakCheck.wireTypes.test.ts` pins the two
 * together in both directions, compiled by `typecheck:bos-llm`.
 *
 * Money appears here (the admin payload) and in exactly one log field
 * (`unchargedCostUsd`). It never reaches the cron response or `bos_cron_runs`.
 *
 * @module lib/business-os/credits/creditLeakCheckTypes
 */

/** How each examined group was classified (workplan §5.2 step 4). */
export type LeakGroupCase =
  | 'matched'
  | 'uncharged'
  | 'no_spend'
  | 'undercharged'
  | 'pending_reconciliation'
  | 'charged_above_usage';

/** An account's state after the check. Never "clean" unless every read succeeded in full. */
export type LeakAccountStatus = 'clean' | 'leak' | 'incomplete' | 'could_not_check';

/** Blind spots stated in every result (workplan §5.2); the tab spells each out. */
export type LeakBlindSpot =
  | 'no_plan_no_charge_account'
  | 'sub_microdollar_reused_group'
  | 'never_reached_token_usage'
  | 'outside_business_os_filter'
  | 'edge_of_window'
  | 'fallback_masks_undercharge';

/** One example group, for the drill-down: group id → `token_usage.session_id` (SQ-15). */
export interface LeakGroupExample {
  groupId: string;
  /** The billing period the group belongs to (S-4); null when it could not be told. */
  periodStart: string | null;
  calls: number;
  usageUsd: number;
  chargedUsd: number;
  /** First and last usage row of the group that was read (slack included). */
  firstCallAt: string | null;
  lastCallAt: string | null;
  /** Pending reconciliation only: which way the fallback price missed. */
  direction: 'over' | 'under' | null;
}

/** A known uncharged path seen in the window (S-3): accepted, not a leak. */
export interface LeakKnownPath {
  feature: string;
  component: string;
  calls: number;
  usageUsd: number;
}

export interface LeakAccountCounts {
  /** Groups with any usage or charge-side row inside the window (B-1). */
  groupsExamined: number;
  matched: number;
  uncharged: number;
  undercharged: number;
  /** Business OS calls with no grouping id that carry tokens or cost (S-3). */
  ungroupedCalls: number;
  noSpend: number;
  pendingReconciliation: number;
  /** The pending ones where usage exceeded the fallback-priced charge (N-8). */
  pendingUndercharged: number;
  chargedAboveUsage: number;
  knownPathCalls: number;
  /** Adjustments whose charge was not read: counted, never compared. */
  unresolvedCorrections: number;
  /** Amounts that could not be read and counted as 0 (never silent). */
  unreadableAmounts: number;
}

export interface LeakAccountUsd {
  /** Usage of uncharged groups. */
  uncharged: number;
  /** Usage minus charge, summed over under-charged groups. */
  undercharged: number;
  /** Usage of ungrouped calls. */
  ungrouped: number;
  /** uncharged + undercharged + ungrouped: the one figure the error log carries. */
  totalUncharged: number;
  knownPath: number;
}

/** One account with any finding (clean accounts with nothing to show are only counted). */
export interface LeakAccountFinding {
  accountId: string;
  /** Display only, filled by the admin route; never logged. */
  companyName: string | null;
  status: LeakAccountStatus;
  /** The earliest leaking group's period (S-4, AC-31), else the first examined group's. */
  periodStart: string | null;
  periodStarts: string[];
  counts: LeakAccountCounts;
  usd: LeakAccountUsd;
  /** At most `LEAK_EXAMPLES_PER_CASE` each. */
  examples: {
    uncharged: LeakGroupExample[];
    undercharged: LeakGroupExample[];
    pendingReconciliation: LeakGroupExample[];
    chargedAboveUsage: LeakGroupExample[];
  };
  knownPaths: LeakKnownPath[];
  /** Why the account is incomplete or could not be checked. */
  reasons: Array<'usage_ceiling' | 'ledger_ceiling' | 'usage_read_failed' | 'ledger_read_failed'>;
}

export interface CreditLeakCheckResult {
  trigger: 'on_demand' | 'nightly';
  /** The window checked, `[start, end)`, ISO instants. `end` may be clamped to now − 6 min. */
  window: { start: string; end: string };
  /** Whether the requested end was later than now − 6 min and was pulled back. */
  endClamped: boolean;
  accountId: string | null;
  generatedAt: string;
  accountsChecked: number;
  accountsWithLeak: number;
  accountsIncomplete: number;
  accountsNotChecked: number;
  accountsRemaining: number;
  deadlineReached: boolean;
  /** The account list could not be read in full (plans or totals failed or hit a limit). */
  listingFailed: boolean;
  listing: {
    planAccounts: number;
    /** Accounts with a totals row in the window and no plan row (S-1). */
    chargedWithoutPlan: number;
    plans: 'ok' | 'failed';
    totals: 'ok' | 'failed' | 'ceiling';
  };
  totals: {
    unchargedGroups: number;
    ungroupedCalls: number;
    underchargedGroups: number;
    pendingReconciliation: number;
    knownPathCalls: number;
    matchedGroups: number;
    noSpendGroups: number;
    chargedAboveUsage: number;
    unchargedUsd: number;
  };
  /** Business OS spend on the platform account, counted only (§5.1, Q-9). Null when the count failed. */
  platform: {
    businessOsCalls: number | null;
    helperLabelCalls: number | null;
    /** SYSTEM_ADMIN_USER_ID is set but not a UUID, so it was left out of the count. */
    envIgnored: boolean;
  };
  /** Accounts with any finding, leaks first. */
  accounts: LeakAccountFinding[];
  blindSpots: LeakBlindSpot[];
}
