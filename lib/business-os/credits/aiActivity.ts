/**
 * The admin AI Activity view — one row per Business OS AI action, with what it
 * was, whether it worked and what it cost (Gap B slice B1a: FR-B1, FR-B3,
 * FR-B8, FR-B10, FR-B12, FR-B13), and its audit entry or why there is none
 * (slice B1b: FR-B1, FR-B5 question 1, SA-B1-7). Workplan
 * docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B1_WORKPLAN.md § D.
 *
 * THE BACKBONE IS THE CREDIT LEDGER. `business_os_credit_charges` holds one
 * `kind = 'charge'` row per `runAiAction` invocation (F-19), so the list is a
 * filtered, sorted, capped read of that table: nothing is grouped, no SQL
 * function is added, and `token_usage` is never read (SA-RC-4, AC-B7 list
 * half). `AiActivityDeps` has no usage member, and a source test pins it.
 *
 * READ-ONLY. No write, no LLM call, no audit entry (FR-B7, NFR-3).
 *
 * TENANT SCOPE. Called only from the admin-gated route, after Zod has
 * validated every value and refused a platform account. The all-accounts read
 * is used only when no account was chosen. Every second read is keyed on
 * SERVER-DERIVED values: adjustments by the page's own action ids (and each
 * one's account checked against its charge's by `resolveEffectiveFields`),
 * names by the page's own account ids, audit entries by the page's own
 * grouping ids. Business names and audit entries are read by the ROUTE
 * (`findNames`, `listAuditEntries`, injected): those admin reads may be called
 * only from `app/api/admin/**` (repository guard `adminReadMethods`).
 *
 * THE AUDIT JOIN (B1b, SA-RC-12, SA-B1-7). Entries are fetched by the page's
 * grouping ids across ALL accounts (a chat turn id comes from a client header,
 * so two accounts can share one, F-28), then matched HERE on
 * `details.actionId` (lower-cased) AND `user_id`. An entry of another account
 * is never sent: it only marks the row (`account_mismatch`) or adds to the
 * mismatch count. Entries with no `actionId` (schema 1) or for a charge not on
 * the page are dropped. A missing entry is classified (too recent / may be
 * archived / lost), and is "unknown" whenever the evidence is incomplete.
 *
 * THE CUT-OVER (FR-B13). The ledger has no row before charging went live. A
 * window that ends before it reads nothing; one that straddles it is clamped
 * to it. The floor is the first charge's instant TRUNCATED to the millisecond,
 * which is at or below the real microsecond value, so the first row stays
 * inside. Never round it up (R-2).
 *
 * GROSS SORT (SA-R8, R-5). "Most expensive first" orders by the charge's own
 * `cost_usd`, before corrections, because the order is applied in the query.
 * Today a correction can only lower a charge, and both figures are shown on a
 * corrected row. If slice 4c ever lets an adjustment RAISE a charge, this
 * order must be revisited.
 *
 * NON-AI TRIPWIRE (SA-R5, R-8). The list does not filter on the service (N-10
 * forbids the raw column, and every charge is an AI charge today). A non-AI
 * service writing charge rows would appear here with area NULL: an effective
 * service rule is needed in this view BEFORE any such service ships.
 *
 * EXACT SUMS. Amounts are netted as integers of the column's own scale, with
 * the cost report's helpers (`toUnits`, `COST_SCALE`, `CREDIT_SCALE`).
 *
 * @module lib/business-os/credits/aiActivity
 */

import {
  CHARGE_LIST_LIMITS,
  type BusinessOsCreditLedgerReadRepository,
  type ChargeListFilter,
  type CreditLedgerRow,
} from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import type { AdminAiActionEntriesPage, AdminAiActionEntryRow } from '@/lib/repositories/AuditTrailRepository';
import type { ArchiveRepository } from '@/lib/repositories/ArchiveRepository';
import { AI_ACTION_DECLARATIONS, sanitizeErrorCode } from '@/lib/business-os/llm/aiActionAudit';
import { AI_CHARGE_SERVICE } from '@/lib/business-os/llm/aiChargeRecorder';
import {
  COST_SCALE,
  CREDIT_REPORT_LIMITS,
  CREDIT_SCALE,
  toUnits,
  windowInstants,
  type AccountName,
  type CreditReportLogger,
  type CreditReportWindow,
} from './creditReport';
import { LEAK_CHECK_LIMITS } from './creditLeakCheck';
import { areaFor, resolveEffectiveFields } from './effectiveFields';
import type {
  AiActivityAreaOption,
  AiActivityAuditSummary,
  AiActivityCoverage,
  AiActivityDeletedBucket,
  AiActivityEntryState,
  AiActivityNoEntryCounts,
  AiActivityOutcome,
  AiActivityPayload,
  AiActivityReadStatus,
  AiActivityRow,
  AiActivitySort,
  AiActivityTrigger,
} from './aiActivityTypes';

export const AI_ACTIVITY_LIMITS = {
  /** Same as the Costs & credits tab, so the sibling tabs refuse the same windows (SA-RC-15, OQ-4). */
  MAX_WINDOW_DAYS: CREDIT_REPORT_LIMITS.MAX_WINDOW_DAYS,
  /** The server-side cap of the list (FR-B10). */
  MAX_ROWS: CHARGE_LIST_LIMITS.MAX_LIMIT,
  /** PostgREST's default max-rows; a larger page would be silently cut. */
  DELETED_BUCKET_PAGE_SIZE: 1000,
  DELETED_BUCKET_CEILING: 2000,
  /** Ids per adjustment lookup (the repository's own per-request limit). */
  ADJUSTMENT_IDS_PER_REQUEST: 200,
  /**
   * B1b: a charge younger than this with no entry is "too recent", not lost.
   * Minutes, NOT the audit batch interval (SA re-check §4 Q4, OQ-5): sized
   * against a serverless instance dying before its queued batch flushes.
   * Shown on screen.
   */
  AUDIT_SETTLE_MS: 15 * 60_000,
  /**
   * B1b: slack on both sides of the audit read's window, around the page's
   * earliest and latest charge (OQ-7). Entries are stamped when QUEUED, at or
   * just before their charge (V-15). The same slack as the leak check.
   */
  AUDIT_WINDOW_SLACK_MS: LEAK_CHECK_LIMITS.SLACK_MS,
  /**
   * B1b (QA E-B1): an entry is stamped at or just BEFORE its charge (V-15), and
   * the archive moves the ENTRY. So a charge up to this long after the cutoff
   * may have lost its entry to the archive, and is "may be archived", not
   * "lost". The same "entry at or before its charge" slack as the read window.
   */
  ARCHIVE_CUTOFF_MARGIN_MS: LEAK_CHECK_LIMITS.SLACK_MS,
  /** B1b: archive runs inspected for the highest cutoff that moved rows (OQ-8, R-11). */
  ARCHIVE_RUNS_INSPECTED: 100,
  /** B1b: projection caps for an entry's model list. */
  ENTRY_MAX_MODELS: 10,
  ENTRY_MAX_MODEL_LENGTH: 64,
} as const;

/** The archive source whose cutoff decides "may be archived". */
const AUDIT_ARCHIVE_SOURCE = 'audit_trail';

/**
 * The first charge row, read once on production (F-21, SA-RC-9 check 1):
 * 2026-09-29T16:50:53.914167Z. A JS Date holds milliseconds, so the
 * comparison floor is TRUNCATED to .914 — below the real value, so the first
 * row is still inside any window clamped to it. Never round up.
 */
export const CHARGING_CUTOVER_ISO = '2026-09-29T16:50:53.914167Z';
export const CHARGING_CUTOVER_FLOOR_MS = Date.UTC(2026, 8, 29, 16, 50, 53, 914);

type RepoResult<T> = { data: T | null; error: Error | null };

/** A charge row of a live account, as kept for the page (action id and account always set). */
type PageCharge = CreditLedgerRow & { action_id: string; user_id: string };

export interface AiActivityDeps {
  /** The four Activity reads. Production wiring: `aiActivityDeps.ts`. */
  ledger: Pick<
    BusinessOsCreditLedgerReadRepository,
    | 'listChargesAllAccountsInWindow'
    | 'listChargesForAccountInWindow'
    | 'listAdjustmentsForActionIds'
    | 'listChargesOfDeletedAccountsInWindow'
  >;
  /** Business names for display. Supplied by the admin route; required, no default (see header). */
  findNames: (accountIds: readonly string[]) => Promise<RepoResult<AccountName[]>>;
  /**
   * B1b: the AI audit entries of these grouping ids, ALL accounts, in the
   * half-open window. Supplied by the admin route with its read context
   * (`listAiActionEntriesAllAccountsByGroupIds`); required, no default.
   */
  listAuditEntries: (
    groupIds: readonly string[],
    window: { start: string; end: string }
  ) => Promise<RepoResult<AdminAiActionEntriesPage>>;
  /** B1b: the audit archive cutoff reads (OQ-8). Production wiring: `aiActivityDeps.ts`. */
  archive: Pick<ArchiveRepository, 'getLatestCutoff' | 'listRuns'>;
  now?: () => Date;
}

export interface BuildAiActivityInput {
  /** Inclusive UTC dates, `YYYY-MM-DD`. Validated by the route. */
  window: CreditReportWindow;
  accountId: string | null;
  area: string | null;
  outcome: AiActivityOutcome | null;
  trigger: AiActivityTrigger | null;
  /** A decimal string, validated by the route. Compared with the GROSS cost. */
  minCostUsd: string | null;
  sort: AiActivitySort;
  limit: number;
}

/** The main list could not be read: there is nothing honest to show. The route answers with an error. */
export class AiActivityListReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiActivityListReadError';
  }
}

/**
 * Every declared area and its action types, through `areaFor` with the AI
 * service constant (SA-B1-9), so the list's area filter and the cost report's
 * area breakdown cannot disagree. Areas with no type are left out.
 */
export function aiActivityAreaOptions(): AiActivityAreaOption[] {
  const byArea = new Map<string, string[]>();
  for (const actionType of Object.keys(AI_ACTION_DECLARATIONS)) {
    const area = areaFor(AI_CHARGE_SERVICE, actionType);
    if (area === null) continue;
    const types = byArea.get(area) ?? [];
    types.push(actionType);
    byArea.set(area, types);
  }
  return [...byArea.entries()]
    .map(([area, actionTypes]) => ({ area, actionTypes: [...actionTypes].sort() }))
    .sort((a, b) => a.area.localeCompare(b.area));
}

/** Where `[start, end)` sits against the cut-over, and where the read starts. NULL: nothing to read. */
export function cutoverClamp(start: Date, end: Date): { coverage: AiActivityCoverage; readFrom: Date | null } {
  if (end.getTime() <= CHARGING_CUTOVER_FLOOR_MS) return { coverage: 'entirely_before_cutover', readFrom: null };
  if (start.getTime() < CHARGING_CUTOVER_FLOOR_MS) {
    return { coverage: 'starts_before_cutover', readFrom: new Date(CHARGING_CUTOVER_FLOOR_MS) };
  }
  return { coverage: 'after_cutover', readFrom: start };
}

const errorOf = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

/** Settles a call that may throw synchronously, so one failing read never fails another. */
async function settle<T>(call: () => Promise<RepoResult<T>>): Promise<RepoResult<T>> {
  try {
    return await call();
  } catch (err) {
    return { data: null, error: errorOf(err) };
  }
}

interface NettedAdjustments {
  cost: number;
  credits: number;
  count: number;
  reasons: Set<string>;
}

/**
 * Net each adjustment onto its charge, in integer units. An adjustment
 * `resolveEffectiveFields` refuses (its charge is on another account, or it is
 * not an adjustment of a known charge) is NOT netted: it is only counted.
 */
function netAdjustments(
  adjustments: readonly CreditLedgerRow[],
  chargesByActionId: ReadonlyMap<string, CreditLedgerRow>,
  units: (value: number | string | null | undefined, scale: number) => number
): { byActionId: Map<string, NettedAdjustments>; unresolved: number } {
  const byActionId = new Map<string, NettedAdjustments>();
  let unresolved = 0;
  for (const adjustment of adjustments) {
    const target = adjustment.adjusts_action_id;
    if (adjustment.kind !== 'adjustment' || target === null || !resolveEffectiveFields(adjustment, chargesByActionId).resolved) {
      unresolved += 1;
      continue;
    }
    const acc = byActionId.get(target) ?? { cost: 0, credits: 0, count: 0, reasons: new Set<string>() };
    acc.cost += units(adjustment.cost_usd, COST_SCALE);
    acc.credits += units(adjustment.credits, CREDIT_SCALE);
    acc.count += 1;
    if (adjustment.reason_code) acc.reasons.add(adjustment.reason_code);
    byActionId.set(target, acc);
  }
  return { byActionId, unresolved };
}

export async function buildAiActivity(
  input: BuildAiActivityInput,
  log: CreditReportLogger,
  deps: AiActivityDeps
): Promise<AiActivityPayload> {
  const now = (deps.now ?? (() => new Date()))();
  const { start, end } = windowInstants(input.window);
  const { coverage, readFrom } = cutoverClamp(start, end);
  const areas = aiActivityAreaOptions();
  let unreadable = 0;
  const units = (value: number | string | null | undefined, scale: number): number => {
    const u = toUnits(value, scale);
    if (Number.isNaN(u)) {
      unreadable += 1;
      return 0;
    }
    return u;
  };

  const allAccounts = input.accountId === null;
  const empty = (bucket: AiActivityDeletedBucket | null): AiActivityPayload => ({
    generatedAt: now.toISOString(),
    window: { from: input.window.from, to: input.window.to, start: start.toISOString(), end: end.toISOString() },
    cutover: { at: CHARGING_CUTOVER_ISO, coverage },
    filters: {
      accountId: input.accountId,
      area: input.area,
      outcome: input.outcome,
      trigger: input.trigger,
      minCostUsd: input.minCostUsd,
    },
    sort: input.sort,
    limit: input.limit,
    areas,
    rows: [],
    total: 0,
    capped: false,
    names: 'ok',
    adjustments: 'ok',
    unresolvedAdjustments: 0,
    unreadableAmounts: 0,
    deletedAccounts: bucket,
    audit: null,
  });

  // ---- 1. The cut-over: nothing before it is ever read (AC-B20) ----
  if (readFrom === null) return empty(null);

  // ---- 2. The area, as its action types (plain data, SA-R10) ----
  let actionTypes: string[] | undefined;
  if (input.area !== null) {
    actionTypes = areas.find((a) => a.area === input.area)?.actionTypes ?? [];
    if (actionTypes.length === 0) {
      // An area with no declared action type has no charge: no query at all.
      return empty(allAccounts ? { status: 'ok', count: 0, costUsd: 0, credits: 0, atLeast: false } : null);
    }
  }

  const filter: ChargeListFilter = { range: { from: readFrom, to: end } };
  if (actionTypes !== undefined) filter.actionTypes = actionTypes;
  if (input.outcome !== null) filter.outcome = input.outcome;
  if (input.trigger !== null) filter.triggeredBy = input.trigger;
  if (input.minCostUsd !== null) filter.minCostUsd = input.minCostUsd;
  const listOptions = { sort: input.sort === 'cost' ? ('cost_usd' as const) : ('created_at' as const), limit: input.limit };

  // ---- 3. The page: capped and counted in the query (FR-B10) ----
  const accountId = input.accountId;
  const pageResult = await settle(() =>
    accountId === null
      ? deps.ledger.listChargesAllAccountsInWindow(filter, listOptions)
      : deps.ledger.listChargesForAccountInWindow(accountId, filter, listOptions)
  );
  if (pageResult.error || !pageResult.data) {
    log.error({ err: pageResult.error, read: 'activity charges' }, 'AI activity read failed');
    throw new AiActivityListReadError('The AI activity could not be read');
  }
  const { total } = pageResult.data;

  const chargesByActionId = new Map<string, CreditLedgerRow>();
  const pageRows: PageCharge[] = [];
  for (const row of pageResult.data.rows) {
    // The query asks for charge rows of live accounts, and a charge row always
    // carries an action id (CHECK charge_shape). Anything else is an invariant
    // break: logged, never shown as somebody's row.
    if (row.kind !== 'charge' || row.action_id === null || row.user_id === null) {
      log.warn({ rowId: row.id, read: 'activity charges' }, 'AI activity skipped a row that is not a live charge');
      continue;
    }
    pageRows.push(row as PageCharge);
    chargesByActionId.set(row.action_id, row);
  }

  // ---- 4. Adjustments, names, the deleted bucket and the audit join, in parallel ----
  // Each read starts inside its own promise, so a synchronous throw fails only
  // its own part (the cost report's QA edge 7).
  const actionIds = [...chargesByActionId.keys()];
  const accountIds = [...new Set(pageRows.map((r) => r.user_id))];
  const [adjustmentsResult, namesResult, bucket, auditRead, archiveRead] = await Promise.all([
    actionIds.length === 0
      ? Promise.resolve<RepoResult<{ rows: CreditLedgerRow[]; reachedCeiling: boolean }>>({
          data: { rows: [], reachedCeiling: false },
          error: null,
        })
      : settle(() => deps.ledger.listAdjustmentsForActionIds(actionIds)),
    accountIds.length === 0
      ? Promise.resolve<RepoResult<AccountName[]>>({ data: [], error: null })
      : settle(() => deps.findNames(accountIds)),
    allAccounts ? readDeletedBucket(filter, log, deps, units) : Promise.resolve(null),
    pageRows.length === 0 ? Promise.resolve(null) : readAuditEntries(pageRows, deps),
    pageRows.length === 0 ? Promise.resolve(null) : readArchiveCutoff(deps),
  ]);

  let adjustmentsStatus: AiActivityReadStatus = 'ok';
  let netted: ReturnType<typeof netAdjustments> = { byActionId: new Map(), unresolved: 0 };
  // A read cut at its ceiling could hide a correction: treat it as unread,
  // so no row ever shows a net figure that may be missing one.
  if (adjustmentsResult.error || !adjustmentsResult.data || adjustmentsResult.data.reachedCeiling) {
    adjustmentsStatus = 'failed';
    log.error(
      { err: adjustmentsResult.error, reachedCeiling: adjustmentsResult.data?.reachedCeiling ?? null, read: 'activity adjustments' },
      'AI activity read failed; rows are shown without net figures'
    );
  } else {
    netted = netAdjustments(adjustmentsResult.data.rows, chargesByActionId, units);
  }

  let namesStatus: AiActivityReadStatus = 'ok';
  const names = new Map<string, string | null>();
  if (namesResult.error || !namesResult.data) {
    namesStatus = 'failed';
    // Display data only: the list continues without names.
    log.warn({ err: namesResult.error, read: 'business names' }, 'AI activity business-name lookup failed; list continues without names');
  } else {
    for (const n of namesResult.data) names.set(n.user_id, n.company_name);
  }

  // ---- 5. The audit join (B1b, step 8): one state per row, decided server-side ----
  const join =
    auditRead === null || archiveRead === null ? null : joinAuditEntries(pageRows, auditRead, archiveRead, now, log);

  // ---- 6. The rows ----
  const rows: AiActivityRow[] = pageRows.map((row) => {
    const grossCost = units(row.cost_usd, COST_SCALE);
    const grossCredits = units(row.credits, CREDIT_SCALE);
    const adjustments = netted.byActionId.get(row.action_id);
    const netKnown = adjustmentsStatus === 'ok';
    return {
      actionId: row.action_id,
      createdAt: row.created_at,
      accountId: row.user_id,
      companyName: names.get(row.user_id) ?? null,
      // The charge's own fields, resolved in the one place allowed to (N-10).
      area: resolveEffectiveFields(row, chargesByActionId).effectiveArea,
      actionType: row.action_type ?? '',
      // CHECK triggered_by_known / outcome_known hold these to the unions.
      trigger: row.triggered_by as AiActivityTrigger,
      outcome: row.outcome as AiActivityOutcome,
      groupId: row.group_id ?? '',
      costUsd: {
        gross: grossCost / COST_SCALE,
        net: netKnown ? (grossCost + (adjustments?.cost ?? 0)) / COST_SCALE : null,
      },
      credits: {
        gross: grossCredits / CREDIT_SCALE,
        net: netKnown ? (grossCredits + (adjustments?.credits ?? 0)) / CREDIT_SCALE : null,
      },
      isFallbackPriced: row.is_fallback_priced === true,
      corrected: (adjustments?.count ?? 0) > 0,
      adjustmentCount: adjustments?.count ?? 0,
      reasonCodes: adjustments ? [...adjustments.reasons].sort() : [],
      // `join` is null only when the page is empty, and then there is no row.
      entry: join?.entries.get(row.action_id) ?? { state: 'unknown', reason: 'audit_read_failed' },
    };
  });

  return {
    ...empty(bucket),
    rows,
    total,
    // Without a count, a full page is the only sign that more may match.
    capped: total !== null ? total > rows.length : rows.length >= input.limit,
    names: namesStatus,
    adjustments: adjustmentsStatus,
    unresolvedAdjustments: netted.unresolved,
    unreadableAmounts: unreadable,
    audit: join?.summary ?? null,
  };
}

// ---------------------------------------------------------------------------
// B1b: the audit join
// ---------------------------------------------------------------------------

type AuditRead = { status: 'ok'; page: AdminAiActionEntriesPage } | { status: 'failed' };
type ArchiveRead = { status: 'ok'; cutoffMs: number | null; cutoff: string | null } | { status: 'failed' };

/**
 * The page's grouping ids (from the CHARGE rows, never the request), read in
 * one call over `[earliest - slack, latest + slack)`. At most 100 distinct
 * ids, because the page holds at most 100 rows.
 */
async function readAuditEntries(pageRows: readonly PageCharge[], deps: AiActivityDeps): Promise<AuditRead> {
  const groupIds = [
    ...new Set(
      pageRows
        .map((r) => r.group_id)
        .filter((g): g is string => typeof g === 'string' && g.length > 0)
        .map((g) => g.toLowerCase())
    ),
  ];
  const times = pageRows.map((r) => Date.parse(r.created_at)).filter((t) => Number.isFinite(t));
  if (groupIds.length === 0 || times.length === 0) return { status: 'failed' };
  const window = {
    start: new Date(Math.min(...times) - AI_ACTIVITY_LIMITS.AUDIT_WINDOW_SLACK_MS).toISOString(),
    end: new Date(Math.max(...times) + AI_ACTIVITY_LIMITS.AUDIT_WINDOW_SLACK_MS).toISOString(),
  };
  const result = await settle(() => deps.listAuditEntries(groupIds, window));
  if (result.error || !result.data) return { status: 'failed' };
  return { status: 'ok', page: result.data };
}

/**
 * The audit archive cutoff (FR-B5, SA-R7, OQ-8): the highest of the latest
 * SUCCEEDED run's cutoff and the cutoff of any recent run of this source that
 * moved rows (a partial run moves rows too). NULL when no run has moved any.
 */
async function readArchiveCutoff(deps: AiActivityDeps): Promise<ArchiveRead> {
  const [latest, runs] = await Promise.all([
    settle(() => deps.archive.getLatestCutoff(AUDIT_ARCHIVE_SOURCE)),
    settle(() => deps.archive.listRuns({ limit: AI_ACTIVITY_LIMITS.ARCHIVE_RUNS_INSPECTED })),
  ]);
  if (latest.error || runs.error || !runs.data) return { status: 'failed' };

  const candidates: string[] = [];
  if (latest.data) candidates.push(latest.data);
  for (const run of runs.data) {
    if (run.source === AUDIT_ARCHIVE_SOURCE && Number(run.rows_archived) > 0 && run.cutoff) candidates.push(run.cutoff);
  }
  let best: { ms: number; iso: string } | null = null;
  for (const candidate of candidates) {
    const ms = Date.parse(candidate);
    // An unreadable cutoff decides nothing: the rows it would decide become "unknown".
    if (!Number.isFinite(ms)) return { status: 'failed' };
    if (best === null || ms > best.ms) best = { ms, iso: candidate };
  }
  return { status: 'ok', cutoffMs: best?.ms ?? null, cutoff: best?.iso ?? null };
}

const finiteCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;

/** The entry's allow-listed fields, one by one. Never a spread of `details` (AC-B13). */
function projectEntry(details: Record<string, unknown>): AiActivityEntryState {
  // A `models` that is not a list is unreadable: NULL ("Unknown"), never [] (QA E-B2).
  const models = Array.isArray(details.models)
    ? details.models
        .filter(
          (m): m is string => typeof m === 'string' && m.length > 0 && m.length <= AI_ACTIVITY_LIMITS.ENTRY_MAX_MODEL_LENGTH
        )
        .slice(0, AI_ACTIVITY_LIMITS.ENTRY_MAX_MODELS)
    : null;
  return {
    state: 'found',
    callCount: finiteCount(details.callCount),
    failedCallCount: finiteCount(details.failedCallCount),
    inputTokens: finiteCount(details.inputTokens),
    outputTokens: finiteCount(details.outputTokens),
    totalTokens: finiteCount(details.totalTokens),
    models,
    // The writer's own shape for a code: a short identifier, never free text.
    errorCode: sanitizeErrorCode(details.errorCode) ?? null,
  };
}

const detailsOf = (row: AdminAiActionEntryRow): Record<string, unknown> | null =>
  row.details && typeof row.details === 'object' && !Array.isArray(row.details)
    ? (row.details as Record<string, unknown>)
    : null;

/** Newest `created_at` first, then the higher id: deterministic (SA-B1-7 iii). */
function newestEntry(entries: readonly AdminAiActionEntryRow[]): AdminAiActionEntryRow {
  return [...entries].sort((a, b) => {
    const byTime = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (Number.isFinite(byTime) && byTime !== 0) return byTime;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  })[0];
}

/**
 * One state per charge, decided here, on the server (SA-B1-7):
 *  (i)   the match is `details.actionId` lower-cased === the charge's action id
 *        (a uuid, read back lower-case) AND `user_id` === the charge's account;
 *  (ii)  an own-account entry means `found`, whatever else exists; an entry of
 *        another account with the same action id only adds to the mismatch
 *        count, and is the row's state only when no own entry exists;
 *  (iii) two own entries (impossible by construction) resolve to the newest,
 *        then the higher id, and are logged at warn with ids only.
 * Precedence for a row with no own entry: read failed or cut -> unknown;
 * another account -> account_mismatch; charge time unreadable -> unknown;
 * strictly younger than the settle window -> too_recent; archive cutoff
 * unreadable -> unknown; older than the cutoff plus its margin (E-B1) ->
 * may_be_archived; otherwise lost.
 */
function joinAuditEntries(
  pageRows: readonly PageCharge[],
  auditRead: AuditRead,
  archiveRead: ArchiveRead,
  now: Date,
  log: CreditReportLogger
): { entries: Map<string, AiActivityEntryState>; summary: AiActivityAuditSummary } {
  const own = new Map<string, AdminAiActionEntryRow[]>();
  const foreign = new Map<string, number>();
  const chargeByActionId = new Map(pageRows.map((r) => [r.action_id, r]));

  if (auditRead.status === 'ok') {
    for (const entry of auditRead.page.rows) {
      const details = detailsOf(entry);
      // Schema 1 entries carry no actionId and cannot be matched: dropped.
      if (!details || typeof details.actionId !== 'string') continue;
      const charge = chargeByActionId.get(details.actionId.toLowerCase());
      // Not a charge on this page: dropped, never sent.
      if (!charge) continue;
      if (entry.user_id === charge.user_id) {
        own.set(charge.action_id, [...(own.get(charge.action_id) ?? []), entry]);
      } else {
        // Another account's entry: counted, never sent (SA-RC-12).
        foreign.set(charge.action_id, (foreign.get(charge.action_id) ?? 0) + 1);
      }
    }
  }

  const incomplete = auditRead.status === 'ok' && auditRead.page.reachedLimit;
  const noEntry: AiActivityNoEntryCounts = { tooRecent: 0, mayBeArchived: 0, lost: 0, unknown: 0, accountMismatch: 0 };
  const entries = new Map<string, AiActivityEntryState>();
  const settleFloorMs = now.getTime() - AI_ACTIVITY_LIMITS.AUDIT_SETTLE_MS;

  for (const charge of pageRows) {
    if (foreign.has(charge.action_id)) noEntry.accountMismatch += 1;
    const mine = own.get(charge.action_id) ?? [];
    const createdMs = Date.parse(charge.created_at);
    let state: AiActivityEntryState;

    if (auditRead.status === 'failed') {
      state = { state: 'unknown', reason: 'audit_read_failed' };
    } else if (mine.length > 0) {
      if (mine.length > 1) {
        log.warn(
          { actionId: charge.action_id, entryIds: mine.map((e) => e.id), read: 'activity audit entries' },
          'AI activity found more than one audit entry for one action on one account; showing the newest'
        );
      }
      // `mine` holds only entries whose details parsed, so this is never null.
      state = projectEntry(detailsOf(newestEntry(mine)) ?? {});
    } else if (incomplete) {
      // The entry may sit in the part of the read that was cut: never "lost".
      state = { state: 'unknown', reason: 'audit_read_incomplete' };
    } else if (foreign.has(charge.action_id)) {
      state = { state: 'account_mismatch' };
    } else if (!Number.isFinite(createdMs)) {
      // An unreadable charge time decides nothing (SA-CR-B-1).
      state = { state: 'unknown', reason: 'charge_time_unreadable' };
    } else if (createdMs > settleFloorMs) {
      // Strictly younger than 15 minutes; exactly 15 minutes old is settled.
      state = { state: 'too_recent' };
    } else if (archiveRead.status === 'failed') {
      state = { state: 'unknown', reason: 'archive_unread' };
    } else if (
      archiveRead.cutoffMs !== null &&
      createdMs < archiveRead.cutoffMs + AI_ACTIVITY_LIMITS.ARCHIVE_CUTOFF_MARGIN_MS
    ) {
      state = { state: 'may_be_archived' };
    } else {
      state = { state: 'lost' };
    }

    if (state.state === 'too_recent') noEntry.tooRecent += 1;
    else if (state.state === 'may_be_archived') noEntry.mayBeArchived += 1;
    else if (state.state === 'lost') noEntry.lost += 1;
    else if (state.state === 'unknown') noEntry.unknown += 1;
    entries.set(charge.action_id, state);
  }

  if (auditRead.status === 'failed') {
    log.error({ read: 'activity audit entries' }, 'AI activity audit read failed; rows show their entry as unknown');
  } else if (incomplete) {
    log.warn(
      { rows: auditRead.page.rows.length, read: 'activity audit entries' },
      'AI activity audit read reached its cap; undecided rows show their entry as unknown'
    );
  }
  if (archiveRead.status === 'failed') {
    log.error({ read: 'audit archive cutoff' }, 'AI activity archive cutoff read failed');
  }
  if (noEntry.accountMismatch > 0) {
    log.warn(
      { rows: noEntry.accountMismatch, read: 'activity audit entries' },
      'AI activity found audit entries on another account for a shown action (defect marker)'
    );
  }

  return {
    entries,
    summary: {
      status: auditRead.status === 'failed' ? 'failed' : incomplete ? 'incomplete' : 'ok',
      settleMinutes: AI_ACTIVITY_LIMITS.AUDIT_SETTLE_MS / 60_000,
      archiveCutoff: archiveRead.status === 'ok' ? archiveRead.cutoff : null,
      archive: archiveRead.status,
      noEntry,
    },
  };
}

/**
 * The deleted-account bucket (FR-B8): every matching charge of a deleted
 * account, netted, summed in Node up to a ceiling, with the exact count. Never
 * merged into a row; never called audit loss. A failure fails the bucket only.
 */
async function readDeletedBucket(
  filter: ChargeListFilter,
  log: CreditReportLogger,
  deps: AiActivityDeps,
  units: (value: number | string | null | undefined, scale: number) => number
): Promise<AiActivityDeletedBucket> {
  const failed: AiActivityDeletedBucket = { status: 'failed', count: null, costUsd: null, credits: null, atLeast: false };

  const read = await settle(() =>
    deps.ledger.listChargesOfDeletedAccountsInWindow(filter, {
      pageSize: AI_ACTIVITY_LIMITS.DELETED_BUCKET_PAGE_SIZE,
      ceiling: AI_ACTIVITY_LIMITS.DELETED_BUCKET_CEILING,
    })
  );
  if (read.error || !read.data) {
    log.error({ err: read.error, read: 'deleted-account charges' }, 'AI activity read failed');
    return failed;
  }

  const charges = read.data.rows.filter((r) => r.kind === 'charge' && r.action_id !== null);
  const chargesByActionId = new Map<string, CreditLedgerRow>();
  for (const r of charges) chargesByActionId.set(r.action_id as string, r);

  const adjustments: CreditLedgerRow[] = [];
  const ids = [...chargesByActionId.keys()];
  for (let i = 0; i < ids.length; i += AI_ACTIVITY_LIMITS.ADJUSTMENT_IDS_PER_REQUEST) {
    const chunk = ids.slice(i, i + AI_ACTIVITY_LIMITS.ADJUSTMENT_IDS_PER_REQUEST);
    const result = await settle(() => deps.ledger.listAdjustmentsForActionIds(chunk));
    if (result.error || !result.data || result.data.reachedCeiling) {
      log.error({ err: result.error, read: 'deleted-account adjustments' }, 'AI activity read failed');
      return failed;
    }
    adjustments.push(...result.data.rows);
  }

  // Both sides of a deleted account's correction carry user_id NULL, so
  // resolveEffectiveFields attributes it (the account check compares equal).
  const netted = netAdjustments(adjustments, chargesByActionId, units);
  let cost = 0;
  let credits = 0;
  for (const r of charges) {
    cost += units(r.cost_usd, COST_SCALE);
    credits += units(r.credits, CREDIT_SCALE);
  }
  for (const acc of netted.byActionId.values()) {
    cost += acc.cost;
    credits += acc.credits;
  }

  return {
    status: 'ok',
    count: read.data.total,
    costUsd: cost / COST_SCALE,
    credits: credits / CREDIT_SCALE,
    atLeast: read.data.reachedCeiling,
  };
}
