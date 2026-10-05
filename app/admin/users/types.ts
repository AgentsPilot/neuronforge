/**
 * Payload shapes the Businesses screen reads (admin reorganisation slice 2b).
 * Client-side types only: nothing here imports a server module.
 */

/** The Business OS business on a list row. `null` = none; `undefined` = lookup failed. */
export interface RowBusiness {
  companyName: string | null;
  vertical: string;
}

/**
 * A Business OS row's credits left (credit deduction slice 8a, FR-48) — the
 * shape `GET /api/admin/users` sends (`AdminCreditsLeft`), declared here
 * structurally so this file imports nothing. A percentage only: no credit
 * count, token or cost. Absent on a row with no business.
 */
export type RowCreditsLeft =
  | { kind: 'percent'; value: number; trial: boolean }
  | { kind: 'less_than_one'; trial: boolean }
  | { kind: 'no_allowance' }
  | { kind: 'unknown' };

export interface AreaTotalsLineView {
  key: string;
  kind: 'area' | 'legacy' | 'unknown';
  calls: number;
  tokens: number;
  estimatedCostUsd: number;
}

export interface AiFailureItemView {
  id: string;
  createdAt: string;
  groupId: string | null;
  area: string | null;
  actionType: string | null;
  trigger: string | null;
  errorCode: string | null;
  callCount: number | null;
  failedCallCount: number | null;
}

/** `GET /api/admin/business-os/accounts/[accountId]/summary` → `data`. */
export interface AccountSummaryPayload {
  accountId: string;
  business:
    | { status: 'ok'; companyName: string | null; vertical: string; subVertical: string | null }
    | { status: 'none' }
    | { status: 'error' };
  aiSpend30d: {
    status: 'complete' | 'incomplete' | 'error';
    /** Always USD: the model pricing table's currency. Never converted. */
    currency: 'USD';
    /** Most calls the read counts; `status: 'incomplete'` means it reached this. */
    readCeiling: number;
    window: { start: string; end: string };
    total: { calls: number; tokens: number; estimatedCostUsd: number };
    lines: AreaTotalsLineView[];
  };
  recentAiFailures: {
    status: 'ok' | 'error';
    window: { start: string; end: string };
    limit: number;
    items: AiFailureItemView[];
  };
}

// ── Credit deduction slice 11c: the admin per-account credit view ──────────
// `GET /api/admin/business-os/credits/accounts/[accountId]` → `data`. A copy of
// `lib/business-os/credits/adminCreditPositionTypes.ts` (this screen's source
// guard forbids `@/lib/business-os` imports); the two are pinned together by
// `lib/business-os/credits/__tests__/adminCreditPosition.wireTypes.test.ts`.
// Credits only: no USD, and no combined figure of plan and extra credits.

/** The resolver layer that decided the allowance (the Plan & entitlements vocabulary). */
export type CreditAllowanceLayerView = 'basis' | 'lifecycle_gate' | 'grandfather' | 'addon' | 'cohort_values' | 'override';

export interface CreditTakeBackView {
  id: string;
  credits: number;
  reason: string | null;
  actorAdminId: string | null;
  createdAt: string;
}

export interface CreditLotView {
  id: string;
  source: 'admin_grant' | 'boost_purchase';
  credits: number;
  remaining: number;
  expired: boolean;
  /** False for a lot created after the read (clock skew): listed, not counted, no Take back. */
  counted: boolean;
  expiresAt: string | null;
  reason: string | null;
  actorKind: 'admin' | 'stripe_webhook';
  actorAdminId: string | null;
  createdAt: string;
  takeBacks: CreditTakeBackView[];
}

export type CreditUsageBlockView =
  | { status: 'error' }
  | {
      status: 'ok';
      period: { kind: 'monthly' | 'trial_total' | 'calendar_month'; key: string; resetsOn: string | null };
      allowanceStatus: 'ok' | 'unavailable';
      allowance: { amount: number; per: 'month' | 'total' } | null;
      allowanceLayer: CreditAllowanceLayerView | null;
      used: number;
      usedByOwner: number;
      usedAutomatic: number;
      planLeft: number | null;
      overPlan: number | null;
    };

export type CreditExtraBlockView =
  | { status: 'error' }
  | { status: 'ok'; extraCredits: number; hasInconsistentLot: boolean; lots: CreditLotView[] };

export interface AccountCreditPositionPayload {
  accountId: string;
  isOwnAccount: boolean;
  limits: { grantCeiling: number; reasonMin: number; reasonMax: number };
  usage: CreditUsageBlockView;
  extra: CreditExtraBlockView;
}
