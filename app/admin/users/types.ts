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
