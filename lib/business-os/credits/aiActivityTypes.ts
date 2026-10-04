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
 * Slice B1b added the audit-entry fields (`entry` on a row, `audit` on the
 * payload). A row with no entry carries a STATE, never blank fields: calls,
 * tokens, models and the error code read as unknown, not as "none" (FR-B1).
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
  /** B1b: the action's audit entry, matched on `actionId` AND account, or why there is none. */
  entry: AiActivityEntryState;
}

/** Why an entry's presence could not be decided. Never reported as "lost" (FR-B5 Q1). */
export type AiActivityEntryUnknownReason =
  /** The audit read failed. */
  | 'audit_read_failed'
  /** The audit read was cut at its row cap, so the entry may be in the part not read. */
  | 'audit_read_incomplete'
  /** The archive cutoff could not be read, so "may be archived" and "lost" cannot be told apart. */
  | 'archive_unread'
  /** The charge's own time could not be read, so its age decides nothing (SA-CR-B-1). */
  | 'charge_time_unreadable';

/**
 * The audit entry of one charge (B1b, FR-B1, FR-B5 Q1, SA-B1-7).
 *
 * - `found`: one entry with this `actionId` on THIS account, projected field by
 *   field. A field the entry does not carry in the expected shape is NULL
 *   (shown as unknown).
 * - `account_mismatch`: an entry with this `actionId` exists only on ANOTHER
 *   account. A defect marker: neither account's entry data is sent.
 * - `too_recent` / `may_be_archived` / `lost`: no entry, classified (D-6).
 * - `unknown`: the evidence was incomplete; never "lost".
 */
export type AiActivityEntryState =
  | {
      state: 'found';
      callCount: number | null;
      failedCallCount: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
      /** At most 10, each at most 64 characters. NULL when the entry's list is unreadable (shown as unknown). */
      models: string[] | null;
      /** A short identifier only (the writer's `sanitizeErrorCode` shape); NULL when none or not of that shape. */
      errorCode: string | null;
    }
  | { state: 'account_mismatch' }
  | { state: 'too_recent' }
  | { state: 'may_be_archived' }
  | { state: 'lost' }
  | { state: 'unknown'; reason: AiActivityEntryUnknownReason };

/** Counted over the ROWS SHOWN, not the window (workplan § D step 8). */
export interface AiActivityNoEntryCounts {
  tooRecent: number;
  mayBeArchived: number;
  lost: number;
  unknown: number;
  /** Rows with at least one entry of their `actionId` on another account (found or not). */
  accountMismatch: number;
}

/** How the audit join went for the rows shown (B1b). */
export interface AiActivityAuditSummary {
  /** `incomplete`: the read reached its row cap. */
  status: 'ok' | 'failed' | 'incomplete';
  /** The "too recent" window, in minutes, stated on screen (OQ-5). */
  settleMinutes: number;
  /** The highest audit archive cutoff of a run that moved rows, or NULL when none has. */
  archiveCutoff: string | null;
  archive: AiActivityReadStatus;
  noEntry: AiActivityNoEntryCounts;
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
  /** B1b. NULL when no row is shown: there was nothing to join. */
  audit: AiActivityAuditSummary | null;
}
