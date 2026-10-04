/**
 * The wire shape of `GET /api/admin/business-os/ai-activity` — the admin AI
 * Activity view (Gap B slice B1a). Workplan
 * docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B1_WORKPLAN.md § D.
 *
 * The admin page re-declares this shape in
 * `app/admin/business-os-llm/activityTypes.ts` (its source guard forbids
 * `@/lib/` imports). `__tests__/aiActivity.wireTypes.test.ts` pins the two
 * together, and `npm run typecheck:bos-llm` (a required check) is what
 * evaluates that pin. Edit both sides together.
 *
 * Slice B1b will add the audit-entry fields (`entry` on a row, `audit` on the
 * payload). They are ABSENT here on purpose, not blank: a missing column
 * cannot be misread as "no entry" (FR-B1).
 *
 * Server-only by convention: it holds no value, only types.
 *
 * @module lib/business-os/credits/aiActivityTypes
 */

/** Where the chosen window sits against the day charging went live (FR-B13). */
export type AiActivityCoverage = 'after_cutover' | 'starts_before_cutover' | 'entirely_before_cutover';

export type AiActivitySort = 'time' | 'cost';
export type AiActivityOutcome = 'succeeded' | 'failed';
export type AiActivityTrigger = 'owner' | 'scheduled' | 'external';
export type AiActivityReadStatus = 'ok' | 'failed';

/**
 * A charge's figure and its figure after its corrections (FR-B12). `net` is
 * NULL when the corrections could not be read: a gross figure is never shown
 * as a net one.
 */
export interface AiActivityAmount {
  gross: number;
  net: number | null;
}

/** One `kind = 'charge'` ledger row: one Business OS AI action (FR-B1). */
export interface AiActivityRow {
  actionId: string;
  createdAt: string;
  accountId: string;
  /** NULL when the name lookup failed or the account has no business name. */
  companyName: string | null;
  /** NULL when the action type declares no area (a non-AI row would be too, R-8). */
  area: string | null;
  actionType: string;
  trigger: AiActivityTrigger;
  outcome: AiActivityOutcome;
  groupId: string;
  costUsd: AiActivityAmount;
  credits: AiActivityAmount;
  isFallbackPriced: boolean;
  /** At least one correction was netted into this row. */
  corrected: boolean;
  adjustmentCount: number;
  reasonCodes: string[];
}

/**
 * Charges whose account was deleted (`user_id` NULL), shown as one bucket and
 * never merged into a row (FR-B8). This is NOT audit loss. NULL in
 * single-account mode (a deleted account has no id to choose), and when the
 * window lies entirely before charging went live.
 */
export interface AiActivityDeletedBucket {
  status: AiActivityReadStatus;
  /** The exact count, or NULL when it could not be read. */
  count: number | null;
  /** Net of corrections. NULL when the bucket could not be read. */
  costUsd: number | null;
  credits: number | null;
  /** The read stopped at its ceiling: the sums are lower bounds. */
  atLeast: boolean;
}

/** An area and the action types it covers, sent as plain data for the area filter (SA-R10). */
export interface AiActivityAreaOption {
  area: string;
  actionTypes: string[];
}

export interface AiActivityPayload {
  generatedAt: string;
  /** The inclusive UTC dates asked for, and the half-open instants they mean. */
  window: { from: string; to: string; start: string; end: string };
  cutover: { at: string; coverage: AiActivityCoverage };
  filters: {
    accountId: string | null;
    area: string | null;
    outcome: AiActivityOutcome | null;
    trigger: AiActivityTrigger | null;
    minCostUsd: string | null;
  };
  sort: AiActivitySort;
  limit: number;
  areas: AiActivityAreaOption[];
  rows: AiActivityRow[];
  /** The exact FILTERED count, or NULL when it could not be read (FR-B10: no count beats a wrong one). */
  total: number | null;
  /** More rows match than are shown. */
  capped: boolean;
  names: AiActivityReadStatus;
  adjustments: AiActivityReadStatus;
  /** Corrections that point at a shown charge but could not be attributed to it (another account). Not netted. */
  unresolvedAdjustments: number;
  /** Amounts that could not be read and were counted as 0 (never silent). */
  unreadableAmounts: number;
  deletedAccounts: AiActivityDeletedBucket | null;
}
