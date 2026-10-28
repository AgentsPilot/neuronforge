/**
 * Why an owner leaves: the reason list for the plan cancel (D2 / SX-1,
 * workplan docs/workplans/BUSINESS_OS_D2_PLAN_CANCEL_ENGINE_WORKPLAN.md §3.6;
 * SA W-6) and, later, the deletion request (D6), which uses the SAME list
 * (account-deletion requirement §3.3, BQ-7 / BQ-17).
 *
 * Codes only. List only, no free text (SX C-10, SA-4): the code is the only
 * thing that reaches the audit row (`details.reasonCode`), never a label or a
 * note. Labels and their order on screen are D3's (translations).
 *
 * Every code fits the closure table's `reason_code` CHECK
 * (`^[a-z][a-z0-9_]{1,39}$`, migration 20261093), so D6 can store it as is
 * (pinned by planLeaveReasons.test.ts).
 *
 * The seven codes are BQ-7's suggested list (TL default; the user may change it).
 *
 * Pure, NO IMPORT, client-safe.
 *
 * @module lib/business-os/billing/planLeaveReasons
 */

export const PLAN_LEAVE_REASON_CODES = [
  'too_expensive',
  'not_using_enough',
  'missing_feature',
  'switching_tool',
  'business_closing',
  'technical_problems',
  'other',
] as const;

export type PlanLeaveReasonCode = (typeof PLAN_LEAVE_REASON_CODES)[number];
