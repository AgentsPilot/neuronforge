/**
 * The wire shape of `GET /api/admin/business-os/credits/leak-check`, as the
 * CLIENT sees it (credit deduction slice 4b).
 *
 * Re-declared, not imported, for the reason `costTypes.ts` gives: this page's
 * source guard forbids any `@/lib/` import. The server declares it in
 * `lib/business-os/credits/creditLeakCheckTypes.ts`; the two are PINNED to each
 * other, both directions, by
 * `lib/business-os/credits/__tests__/creditLeakCheck.wireTypes.test.ts`, which
 * `npm run typecheck:bos-llm` compiles. Run the gate after editing either side.
 */

export type LeakAccountStatusWire = 'clean' | 'leak' | 'incomplete' | 'could_not_check';

export type LeakBlindSpotWire =
  | 'no_plan_no_charge_account'
  | 'sub_microdollar_reused_group'
  | 'never_reached_token_usage'
  | 'outside_business_os_filter'
  | 'edge_of_window'
  | 'fallback_masks_undercharge';

export interface LeakGroupExampleWire {
  groupId: string;
  periodStart: string | null;
  calls: number;
  usageUsd: number;
  chargedUsd: number;
  firstCallAt: string | null;
  lastCallAt: string | null;
  direction: 'over' | 'under' | null;
}

export interface LeakKnownPathWire {
  feature: string;
  component: string;
  calls: number;
  usageUsd: number;
}

export interface LeakAccountFindingWire {
  accountId: string;
  companyName: string | null;
  status: LeakAccountStatusWire;
  periodStart: string | null;
  periodStarts: string[];
  counts: {
    groupsExamined: number;
    matched: number;
    uncharged: number;
    undercharged: number;
    ungroupedCalls: number;
    noSpend: number;
    pendingReconciliation: number;
    pendingUndercharged: number;
    chargedAboveUsage: number;
    knownPathCalls: number;
    unresolvedCorrections: number;
    unreadableAmounts: number;
  };
  usd: {
    uncharged: number;
    undercharged: number;
    ungrouped: number;
    totalUncharged: number;
    knownPath: number;
  };
  examples: {
    uncharged: LeakGroupExampleWire[];
    undercharged: LeakGroupExampleWire[];
    pendingReconciliation: LeakGroupExampleWire[];
    chargedAboveUsage: LeakGroupExampleWire[];
  };
  knownPaths: LeakKnownPathWire[];
  reasons: Array<'usage_ceiling' | 'ledger_ceiling' | 'usage_read_failed' | 'ledger_read_failed'>;
}

export interface LeakCheckPayload {
  trigger: 'on_demand' | 'nightly';
  window: { start: string; end: string };
  endClamped: boolean;
  accountId: string | null;
  generatedAt: string;
  accountsChecked: number;
  accountsWithLeak: number;
  accountsIncomplete: number;
  accountsNotChecked: number;
  accountsRemaining: number;
  deadlineReached: boolean;
  listingFailed: boolean;
  listing: {
    planAccounts: number;
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
  platform: {
    businessOsCalls: number | null;
    helperLabelCalls: number | null;
    envIgnored: boolean;
  };
  accounts: LeakAccountFindingWire[];
  blindSpots: LeakBlindSpotWire[];
}
