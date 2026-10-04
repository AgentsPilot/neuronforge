/**
 * The wire shape of `GET /api/admin/business-os/ai-activity`, as the CLIENT
 * sees it (admin AI Activity view, Gap B slice B1a).
 *
 * ── Why these are re-declared instead of imported ─────────────────────────
 * The server declares this shape in `lib/business-os/credits/aiActivityTypes.ts`,
 * and this page's source guard forbids any `@/lib/` import (the same reason
 * `costTypes.ts` re-declares the cost report). The duplication is PINNED by
 * `lib/business-os/credits/__tests__/aiActivity.wireTypes.test.ts`, evaluated
 * by `npm run typecheck:bos-llm` (a required check; not by Jest, which checks
 * no types here). Run the gate after editing either side.
 */

export type ActivityCoverage = 'after_cutover' | 'starts_before_cutover' | 'entirely_before_cutover';
export type ActivitySort = 'time' | 'cost';
export type ActivityOutcome = 'succeeded' | 'failed';
export type ActivityTrigger = 'owner' | 'scheduled' | 'external';
export type ActivityReadStatus = 'ok' | 'failed';

export interface ActivityAmount {
  gross: number;
  /** NULL when the corrections could not be read: never show the gross figure as net. */
  net: number | null;
}

export interface ActivityRow {
  actionId: string;
  createdAt: string;
  accountId: string;
  companyName: string | null;
  area: string | null;
  actionType: string;
  trigger: ActivityTrigger;
  outcome: ActivityOutcome;
  groupId: string;
  costUsd: ActivityAmount;
  credits: ActivityAmount;
  isFallbackPriced: boolean;
  corrected: boolean;
  adjustmentCount: number;
  reasonCodes: string[];
}

export interface ActivityDeletedBucket {
  status: ActivityReadStatus;
  count: number | null;
  costUsd: number | null;
  credits: number | null;
  atLeast: boolean;
}

export interface ActivityAreaOption {
  area: string;
  actionTypes: string[];
}

export interface ActivityPayload {
  generatedAt: string;
  window: { from: string; to: string; start: string; end: string };
  cutover: { at: string; coverage: ActivityCoverage };
  filters: {
    accountId: string | null;
    area: string | null;
    outcome: ActivityOutcome | null;
    trigger: ActivityTrigger | null;
    minCostUsd: string | null;
  };
  sort: ActivitySort;
  limit: number;
  areas: ActivityAreaOption[];
  rows: ActivityRow[];
  total: number | null;
  capped: boolean;
  names: ActivityReadStatus;
  adjustments: ActivityReadStatus;
  unresolvedAdjustments: number;
  unreadableAmounts: number;
  deletedAccounts: ActivityDeletedBucket | null;
}
