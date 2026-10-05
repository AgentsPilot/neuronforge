/**
 * The wire shape of `GET /api/admin/business-os/ai-activity/drill-down` — the
 * admin AI Activity drill-down (Gap B slice B2a). Workplan
 * docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B2_WORKPLAN.md § D.
 *
 * The admin page re-declares this shape in
 * `app/admin/business-os-llm/activityDrillDownTypes.ts` (its source guard
 * forbids `@/lib/` imports). `__tests__/aiActivityDrillDown.wireTypes.test.ts`
 * pins the two together, and `npm run typecheck:bos-llm` (a required check) is
 * what evaluates that pin. Edit both sides together.
 *
 * B2a reads only the credit ledger and the audit trail. The calls of the group
 * and the group-level cost check arrive in slice B2b; their members are ABSENT
 * here, not optional, so nothing can read as "no calls" (the B1a D-8 precedent).
 *
 * Server-only by convention: it holds no value, only types.
 *
 * @module lib/business-os/credits/aiActivityDrillDownTypes
 */

import type {
  AiActivityAmount,
  AiActivityAuditSummary,
  AiActivityEntryState,
  AiActivityOutcome,
  AiActivityReadStatus,
  AiActivityTrigger,
} from './aiActivityTypes';

/** One correction of a charge, listed in the drawer (FR-B12). Only corrections attributed to the charge. */
export interface AiActivityDrillDownAdjustment {
  createdAt: string;
  reasonCode: string | null;
  /** Signed: a correction that lowers a charge is negative. */
  costUsd: number;
  credits: number;
}

/**
 * One charge of the opened action's group, on the opened action's account.
 * The fields it shares with a list row are computed the same way (SA-B2-7).
 */
export interface AiActivityDrillDownCharge {
  actionId: string;
  createdAt: string;
  /** NULL when the action type declares no area. */
  area: string | null;
  actionType: string;
  trigger: AiActivityTrigger;
  outcome: AiActivityOutcome;
  costUsd: AiActivityAmount;
  credits: AiActivityAmount;
  isFallbackPriced: boolean;
  /** At least one correction was netted into this charge. */
  corrected: boolean;
  adjustmentCount: number;
  reasonCodes: string[];
  /** Oldest first. Empty when the corrections could not be read (the payload says so). */
  adjustments: AiActivityDrillDownAdjustment[];
  /** The audit entry, matched on actionId AND account, or why there is none (SA-B1-7). */
  entry: AiActivityEntryState;
  /** The charge the admin opened. Exactly one charge carries it. */
  opened: boolean;
}

/** The opened action's grouping id, on the opened action's account only. */
export interface AiActivityDrillDownGroup {
  /** From the charge row, lower-cased. Empty only for a charge with no grouping id (never written today). */
  groupId: string;
  /** `failed`: only the opened charge is shown; the others could not be read. */
  status: AiActivityReadStatus;
  /** Charges of this group on THIS account, as read. */
  chargedActions: number;
  /** More than one charged action shares this grouping id: its calls cannot be attributed to one of them. */
  shared: boolean;
  /** The read stopped at its ceiling: "at least N". */
  atLeast: boolean;
  /** Newest first. */
  charges: AiActivityDrillDownCharge[];
}

export interface AiActivityDrillDownPayload {
  generatedAt: string;
  account: { accountId: string; companyName: string | null };
  names: AiActivityReadStatus;
  /** The opened action's id, lower-case; it is also one of `group.charges`. */
  actionId: string;
  group: AiActivityDrillDownGroup;
  adjustments: AiActivityReadStatus;
  /** Corrections that point at a shown charge but could not be attributed to it (another account). Never listed. */
  unresolvedAdjustments: number;
  /** Amounts that could not be read and were counted as 0 (never silent). */
  unreadableAmounts: number;
  /**
   * The B1b audit summary, over the group's charges shown. Never NULL: the
   * drawer always holds at least the opened charge (unlike the list, which
   * sends NULL for an empty page).
   */
  audit: AiActivityAuditSummary;
}
