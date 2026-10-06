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

// ── Admin delete AD-1c: the read-only deletion preview ─────────────────────
// `POST /api/admin/users/[id]/deletion/preview` → `data`. A structural copy of
// `AdminDeletionPreview` in `lib/business-os/purge/AdminDeletionPreview.ts`
// (this screen's source guard forbids `@/lib/business-os` imports); the two are
// pinned together by `lib/business-os/purge/__tests__/adminDeletionPreview.wireTypes.test.ts`.

/** The descriptor area a table belongs to (`PurgeArea`), or `unassigned`. */
export type DeletionAreaView =
  | 'business_profile'
  | 'crm'
  | 'website'
  | 'scheduling'
  | 'payments'
  | 'email_marketing'
  | 'intake'
  | 'onboarding_chat'
  | 'capabilities'
  | 'smart_links'
  | 'channels'
  | 'insights'
  | 'briefings'
  | 'integrations'
  | 'agents'
  | 'activity_history'
  | 'unassigned';

export interface DeletionTableCountView {
  table: string;
  /** `null` = could not be counted. Shown as "unknown", never as 0. */
  count: number | null;
  /** The server's reason a count failed. Never rendered: only "unknown" is. */
  error?: string;
  /** The count reached a cap: a floor, not an exact figure. */
  truncated?: boolean;
}

export interface DeletionAreaCountView {
  area: DeletionAreaView;
  rows: number;
  tablesUnknown: number;
  tables: DeletionTableCountView[];
}

export type DeletionRefusalIdView = 'R-1' | 'R-2' | 'R-3' | 'R-4' | 'R-5' | 'R-6' | 'R-7' | 'R-8';

export type DeletionRefusalStatusView =
  | 'applies'
  | 'clear'
  | 'unverified'
  | 'not_applicable'
  | 'not_evaluated'
  | 'deferred';

export interface DeletionRefusalView {
  id: DeletionRefusalIdView;
  status: DeletionRefusalStatusView;
  message: string;
  clearingAction?: string;
  detail?: Record<string, unknown>;
}

export interface DeletionPreviewPayload {
  target: {
    userId: string;
    email: string | null;
    businessName: string | null;
    joinedAt: string | null;
  };
  /** False when R-1 or R-2 refused and nothing was counted. */
  counted: boolean;
  level: 'purge';
  options: { integrations: boolean; agents: boolean; activityHistory: boolean };
  areas: DeletionAreaCountView[];
  storage: DeletionTableCountView[];
  totals: { rows: number; tablesWithRows: number; tablesUnknown: number } | null;
  keptTables: Array<{ table: string; notes: string | null }>;
  refusals: DeletionRefusalView[];
  schema: {
    status: 'ok' | 'drift' | 'ambiguous' | 'unreadable';
    unclassified: string[];
    missingDeletable: string[];
    missingNever: string[];
    fingerprint: string | null;
  } | null;
  resetLive: boolean | null;
  limitations: string[];
  /**
   * True exactly when `commitToken` is set (AD-2a). The confirm control stays
   * disabled until AD-2b wires the typed confirmation.
   */
  deletionAvailable: boolean;
  deletionUnavailableReason: string;
  /**
   * AD-2a: the signed commit token, or null. Hold it in component state only:
   * never a URL, never storage, never a log (SA AC2-5).
   */
  commitToken: string | null;
  /** What the admin must type to confirm; null when it could not be determined. */
  confirmKind: 'business name' | 'account email' | null;
  correlationId: string;
  generatedAt: string;
}
