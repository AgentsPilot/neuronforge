/**
 * The wire shape of `GET /api/admin/business-os/ai-activity/drill-down`, as
 * the CLIENT sees it (admin AI Activity drill-down, Gap B slice B2a).
 *
 * ── Why these are re-declared instead of imported ─────────────────────────
 * The server declares this shape in
 * `lib/business-os/credits/aiActivityDrillDownTypes.ts`, and this page's source
 * guard forbids any `@/lib/` import (the same reason `costTypes.ts` and
 * `activityTypes.ts` re-declare theirs). The duplication is PINNED by
 * `lib/business-os/credits/__tests__/aiActivityDrillDown.wireTypes.test.ts`,
 * evaluated by `npm run typecheck:bos-llm` (a required check; not by Jest,
 * which checks no types here). Run the gate after editing either side.
 *
 * The group's calls and the group-level cost check arrive in slice B2b; they
 * are absent here, not optional.
 */

import type {
  ActivityAmount,
  ActivityAuditSummary,
  ActivityEntryState,
  ActivityOutcome,
  ActivityReadStatus,
  ActivityTrigger,
} from './activityTypes';

export interface ActivityDrillDownAdjustment {
  createdAt: string;
  reasonCode: string | null;
  /** Signed: a correction that lowers a charge is negative. */
  costUsd: number;
  credits: number;
}

export interface ActivityDrillDownCharge {
  actionId: string;
  createdAt: string;
  area: string | null;
  actionType: string;
  trigger: ActivityTrigger;
  outcome: ActivityOutcome;
  costUsd: ActivityAmount;
  credits: ActivityAmount;
  isFallbackPriced: boolean;
  corrected: boolean;
  adjustmentCount: number;
  reasonCodes: string[];
  /** Oldest first. Empty when the corrections could not be read (the payload says so). */
  adjustments: ActivityDrillDownAdjustment[];
  entry: ActivityEntryState;
  /** The charge the admin opened. */
  opened: boolean;
}

export interface ActivityDrillDownGroup {
  groupId: string;
  status: ActivityReadStatus;
  chargedActions: number;
  shared: boolean;
  atLeast: boolean;
  /** Newest first. */
  charges: ActivityDrillDownCharge[];
}

export interface ActivityDrillDownPayload {
  generatedAt: string;
  account: { accountId: string; companyName: string | null };
  names: ActivityReadStatus;
  actionId: string;
  group: ActivityDrillDownGroup;
  adjustments: ActivityReadStatus;
  unresolvedAdjustments: number;
  unreadableAmounts: number;
  audit: ActivityAuditSummary;
}
