// lib/repositories/AdminJobsQueuesRepository.ts
// Cross-account reads for the admin "Scheduled jobs & queues" page and the
// Health tiles 6 and 7 (admin reorganisation slice 5, parts C and D).
//
// ADMIN-ONLY, CROSS-ACCOUNT BY DESIGN, in the AdminTokenUsageAnalyticsRepository
// template (ADMIN_IDENTIFICATION_AND_ACCESS.md OI-9):
//   - SERVICE-ROLE CLIENT, ON PURPOSE. "How many lead replies are stuck,
//     platform-wide" has no per-tenant answer, so CLAUDE.md rule 4 is replaced
//     by the caller's gate. The ONLY permitted callers are app/api/admin/**
//     routes, after `requireAdmin` (a source guard in
//     lib/repositories/__tests__/AdminJobsQueuesRepository.test.ts enforces it,
//     barrel included).
//   - "AllAccounts" / "AllJobs" is in every method name.
//   - Every method takes an AdminReadContext FIRST and REQUIRED, and logs
//     `adminUserId` and counts only (SA SC-9(a)).
//   - COLUMNS: the FIGURES read selects only a head count (`id`, head: true)
//     or one of the timestamps `scheduled_at`, `next_attempt_at`, `created_at`
//     (SC-9(b), ADMIN_QUEUE_FIGURE_COLUMNS). The ITEM LIST (ADMIN_BOS_CLEANUP
//     slice 7a) selects the exact per-table list in ADMIN_QUEUE_ITEM_COLUMNS,
//     widened on purpose by SA C7-12 (and OP-2 for the briefing's `timezone`):
//     `user_id` is read ONLY to look up business names and never leaves the
//     server. No payload, recommendation, error message, skip reason, contact,
//     invoice, booking or claimer column is ever read. `error_message` appears
//     ONLY inside filters, compared with fixed markers (SC-9(d)).
//   - Methods never throw: they return `{ data, error }`.
//
// The five queue tables are READ ONLY here; nothing about them changes (A-6).
// One single-item read for the slice 7b action route
// (`readQueueItemAllAccounts`); this repository still writes nothing. The one
// write to a queue row lives in AdminQueueActionsRepository.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AdminReadContext } from './AdminTokenUsageAnalyticsRepository';
import type { AgentRepositoryResult as RepositoryResult } from './types';

export type { AdminReadContext };

export type AdminQueueId =
  | 'payment_reminders'
  | 'payment_automations'
  | 'daily_briefing_sends'
  | 'lead_responses'
  | 'insight_actions';

/** The fixed text every reaper writes when it dead-letters a row. Compared, never shown. */
export const DEAD_LETTER_MARKER = 'dead-letter: max attempts';

/** Fixed messages PaymentAutomationEngine writes for a guardrail skip (not a failure). */
export const GUARDRAIL_SKIP_MARKERS = ['max executions reached', 'cooldown active'] as const;

/** Every lease is 90 s; "stuck" allows 10 minutes more (requirement §S5.7). */
export const STUCK_AFTER_SECONDS = 90 + 10 * 60;

/** The only columns the FIGURES read may select (SC-9(b)); pinned by the figures tests. */
export const ADMIN_QUEUE_FIGURE_COLUMNS = ['id', 'scheduled_at', 'next_attempt_at', 'created_at'] as const;

interface QueueSpec {
  table: string;
  inProgress: 'processing' | 'running';
  /** The statuses the table's code writes; anything else is "unrecognised". */
  known: readonly string[];
  /** true: `scheduled_at` exists and gates "due" (the two payment tables). */
  hasScheduledAt: boolean;
  /** Dead-letter = this status (+ the marker when `deadLetterByMarker`). */
  deadLetterStatus: 'failed' | 'dead_letter';
  deadLetterByMarker: boolean;
  skippedStatus: 'skipped' | null;
  guardrailMarkers: readonly string[];
  /** Failed / dead-lettered are windowed by this column (F-8: no failure timestamp exists). */
  windowColumn: 'scheduled_at' | 'created_at';
  /** The claim function whose "due" predicate `dueNow` mirrors (SC-9(e)). */
  claimCitation: string;
}

export const ADMIN_QUEUE_SPECS: Readonly<Record<AdminQueueId, QueueSpec>> = {
  payment_reminders: {
    table: 'payment_reminders',
    inProgress: 'processing',
    known: ['pending', 'processing', 'sent', 'failed', 'cancelled'],
    hasScheduledAt: true,
    deadLetterStatus: 'failed',
    deadLetterByMarker: true,
    skippedStatus: null,
    guardrailMarkers: [],
    windowColumn: 'scheduled_at',
    claimCitation:
      'claim_due_payment_reminders, supabase/migrations/2026-08-14_payment_reminders_claim.sql:58-60',
  },
  payment_automations: {
    table: 'payment_automation_executions',
    inProgress: 'running',
    known: ['pending', 'running', 'completed', 'failed', 'cancelled', 'dead_letter'],
    hasScheduledAt: true,
    deadLetterStatus: 'dead_letter',
    deadLetterByMarker: false,
    skippedStatus: null,
    guardrailMarkers: GUARDRAIL_SKIP_MARKERS,
    windowColumn: 'scheduled_at',
    claimCitation:
      'claim_due_payment_automation_executions, supabase/migrations/2026-08-14_payment_automation_executions_claim.sql:73-75',
  },
  daily_briefing_sends: {
    table: 'daily_briefing_sends',
    inProgress: 'processing',
    known: ['pending', 'processing', 'sent', 'skipped', 'failed'],
    hasScheduledAt: false,
    deadLetterStatus: 'failed',
    deadLetterByMarker: true,
    skippedStatus: 'skipped',
    guardrailMarkers: [],
    windowColumn: 'created_at',
    claimCitation: 'claim_due_daily_briefings, supabase/migrations/20260911_daily_briefing.sql:141-142',
  },
  lead_responses: {
    table: 'lead_responses',
    inProgress: 'processing',
    known: ['pending', 'processing', 'sent', 'skipped', 'failed'],
    hasScheduledAt: false,
    deadLetterStatus: 'failed',
    deadLetterByMarker: true,
    skippedStatus: 'skipped',
    guardrailMarkers: [],
    windowColumn: 'created_at',
    claimCitation: 'claim_due_lead_responses, supabase/migrations/20260914_lead_responses.sql:132-133',
  },
  insight_actions: {
    table: 'insight_actions',
    inProgress: 'processing',
    known: ['pending', 'processing', 'sent', 'skipped', 'failed'],
    hasScheduledAt: false,
    deadLetterStatus: 'failed',
    deadLetterByMarker: true,
    skippedStatus: 'skipped',
    guardrailMarkers: [],
    windowColumn: 'created_at',
    claimCitation: 'claim_due_insight_actions, supabase/migrations/20260917_insight_actions.sql:167-168',
  },
};

/**
 * The exact select of the item list, per table (ADMIN_BOS_CLEANUP slice 7a,
 * SA C7-12; workplan section 6). Never `*`. The briefing's `timezone` is OP-2:
 * read on the server for "today in the row's zone", never returned.
 */
export const ADMIN_QUEUE_ITEM_COLUMNS: Readonly<Record<AdminQueueId, readonly string[]>> = {
  payment_reminders: ['id', 'user_id', 'status', 'attempts', 'claimed_at', 'created_at', 'scheduled_at', 'next_attempt_at', 'reminder_type'],
  payment_automations: ['id', 'user_id', 'status', 'attempts', 'claimed_at', 'created_at', 'scheduled_at', 'next_attempt_at'],
  daily_briefing_sends: ['id', 'user_id', 'status', 'attempts', 'claimed_at', 'created_at', 'next_attempt_at', 'briefing_date', 'timezone'],
  lead_responses: ['id', 'user_id', 'status', 'attempts', 'claimed_at', 'created_at', 'next_attempt_at', 'kind'],
  insight_actions: ['id', 'user_id', 'status', 'attempts', 'claimed_at', 'created_at', 'next_attempt_at', 'kind'],
};

/**
 * Every column this repository ever selects: the figures' four plus the item
 * list's, widened deliberately by slice 7a (C7-12). Pinned by exact equality in
 * AdminJobsQueuesRepository.items.test.ts; the figures read is pinned to
 * ADMIN_QUEUE_FIGURE_COLUMNS alone, so this widening cannot loosen it.
 */
export const ADMIN_QUEUE_SELECTABLE_COLUMNS: readonly string[] = [
  ...new Set<string>([...ADMIN_QUEUE_FIGURE_COLUMNS, ...Object.values(ADMIN_QUEUE_ITEM_COLUMNS).flat()]),
];

/** Which rows the item list shows (slice 7a workplan §2.1). */
export type AdminQueueItemState = 'stuck' | 'failed' | 'dead_lettered' | 'waiting';
export const ADMIN_QUEUE_ITEM_STATES: readonly AdminQueueItemState[] = ['stuck', 'failed', 'dead_lettered', 'waiting'];

/** SA §M: at most 50 rows a page. */
export const ADMIN_QUEUE_ITEMS_PAGE_SIZE = 50;
/** At most 1,000 rows deep (OP-8). */
export const ADMIN_QUEUE_ITEMS_MAX_PAGE = 20;

/** PostgREST "Requested range not satisfiable" (HTTP 416): a page past the end (W7A-2, measured live by SA). */
const PAST_THE_END_CODE = 'PGRST103';

/**
 * One queue row of the item list, mapped field by field (never a spread).
 * `userId` and `timezone` are SERVER-ONLY: the route uses them for the name
 * lookup and the briefing's "today", and never returns them (C7-13).
 */
export interface RawQueueItem {
  id: string;
  userId: string;
  status: string;
  attempts: number;
  claimedAt: string | null;
  createdAt: string;
  /** Payment tables only; else null. */
  scheduledAt: string | null;
  nextAttemptAt: string | null;
  /** lead_responses.kind, insight_actions.kind or payment_reminders.reminder_type; else null. */
  kind: string | null;
  /** daily_briefing_sends only; else null. */
  briefingDate: string | null;
  /** daily_briefing_sends only; else null. */
  timezone: string | null;
}

/** One queue's figures, exactly as counted. */
export interface RawQueueFigures {
  dueNow: number;
  later: number;
  /** Payment automations only: pending with no `scheduled_at`, which the claim never picks up. */
  noDueTime: number | null;
  inProgress: number;
  stuck: number;
  failed24h: number;
  failed7d: number;
  deadLettered24h: number;
  deadLettered7d: number;
  /** Tables with a `skipped` status only. */
  skipped7d: number | null;
  /** Payment automations only. */
  guardrailSkips7d: number | null;
  unrecognisedStatus: number;
  /** ISO; the effective due time of the oldest item that is due now, or null. */
  oldestDueAt: string | null;
}

export interface AdminReadOptions {
  signal?: AbortSignal;
}

/** Double-quote a value for a PostgREST logic tree (`.or(...)`), escaping `"` and `\`. */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Supabase's builder types differ per chain; this is the subset used here.
interface Query extends PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  eq(column: string, value: unknown): Query;
  lte(column: string, value: unknown): Query;
  lt(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  gt(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  in(column: string, values: readonly unknown[]): Query;
  not(column: string, operator: string, value: unknown): Query;
  or(filters: string): Query;
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): Query;
  limit(count: number): Query;
  range(from: number, to: number): Query;
  abortSignal(signal: AbortSignal): Query;
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  const e = (error ?? {}) as { message?: string; code?: string };
  const wrapped = new Error(e.message ?? 'Supabase error') as Error & { code?: string };
  if (e.code) wrapped.code = e.code;
  return wrapped;
}

// ── State filters shared by the figures and the item list (slice 7a, W7A-6) ──
// Lifted out of readQueueFiguresAllAccounts unchanged (same calls, same
// order), so the list can never disagree with the count on the card.

/** In progress with no claim, or a claim older than the stuck threshold. */
function stuckFilter(query: Query, spec: QueueSpec, stuckBefore: string): Query {
  return query.eq('status', spec.inProgress).or(`claimed_at.is.null,claimed_at.lt.${quoteFilterValue(stuckBefore)}`);
}

/** Failed and NOT dead-lettered and NOT a guardrail skip. Null-safe on error_message. */
function failedNotDeadFilter(query: Query, spec: QueueSpec): Query {
  const excluded = [...(spec.deadLetterByMarker ? [DEAD_LETTER_MARKER] : []), ...spec.guardrailMarkers];
  const filtered = query.eq('status', 'failed');
  if (excluded.length === 0) return filtered;
  return filtered.or(`error_message.is.null,error_message.not.in.(${excluded.map(quoteFilterValue).join(',')})`);
}

/** Dead-lettered: status `failed` plus the fixed marker, or the `dead_letter` status. */
function deadLetteredFilter(query: Query, spec: QueueSpec): Query {
  return spec.deadLetterByMarker
    ? query.eq('status', 'failed').eq('error_message', DEAD_LETTER_MARKER)
    : query.eq('status', spec.deadLetterStatus);
}

const stuckBeforeOf = (now: Date): string => new Date(now.getTime() - STUCK_AFTER_SECONDS * 1000).toISOString();

const isTimestamp = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isOptionalTimestamp = (value: unknown): value is string | null | undefined =>
  value === null || value === undefined || isTimestamp(value);
const isOptionalString = (value: unknown): value is string | null | undefined =>
  value === null || value === undefined || typeof value === 'string';

/** Which column holds a row's kind, per table (OP-4: payment automations have none). */
const KIND_COLUMN: Readonly<Record<AdminQueueId, 'reminder_type' | 'kind' | null>> = {
  payment_reminders: 'reminder_type',
  payment_automations: null,
  daily_briefing_sends: null,
  lead_responses: 'kind',
  insight_actions: 'kind',
};

/**
 * Field-by-field mapping of one item row (C7-13). A column outside the table's
 * allow-list is never read, even if a client returned it. Null for a malformed
 * row: the read then fails rather than showing a half-understood row (the
 * readJobsQueues precedent, SC-5).
 */
function mapItemRow(queue: AdminQueueId, raw: unknown): RawQueueItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const spec = ADMIN_QUEUE_SPECS[queue];
  if (typeof r.id !== 'string' || r.id.length === 0) return null;
  if (typeof r.user_id !== 'string' || r.user_id.length === 0) return null;
  if (typeof r.status !== 'string') return null;
  if (typeof r.attempts !== 'number' || !Number.isInteger(r.attempts) || r.attempts < 0) return null;
  if (!isTimestamp(r.created_at)) return null;
  const claimedAt = r.claimed_at;
  const nextAttemptAt = r.next_attempt_at;
  if (!isOptionalTimestamp(claimedAt) || !isOptionalTimestamp(nextAttemptAt)) return null;

  let scheduledAt: string | null = null;
  if (spec.hasScheduledAt) {
    const value = r.scheduled_at;
    if (!isOptionalTimestamp(value)) return null;
    scheduledAt = value ?? null;
  }
  let kind: string | null = null;
  const kindColumn = KIND_COLUMN[queue];
  if (kindColumn) {
    const value = r[kindColumn];
    if (!isOptionalString(value)) return null;
    kind = value ?? null;
  }
  let briefingDate: string | null = null;
  let timezone: string | null = null;
  if (queue === 'daily_briefing_sends') {
    const date = r.briefing_date;
    const zone = r.timezone;
    if (!isOptionalString(date) || !isOptionalString(zone)) return null;
    briefingDate = date ?? null;
    timezone = zone ?? null;
  }
  return {
    id: r.id,
    userId: r.user_id,
    status: r.status,
    attempts: r.attempts,
    claimedAt: claimedAt ?? null,
    createdAt: r.created_at,
    scheduledAt,
    nextAttemptAt: nextAttemptAt ?? null,
    kind,
    briefingDate,
    timezone,
  };
}

const later = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
};

const earlier = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
};

export class AdminJobsQueuesRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Intentionally bypasses RLS: admin-only, cross-account (see header).
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AdminJobsQueuesRepository' });
  }

  private requireContext(context: AdminReadContext | undefined): Error | null {
    if (!context || !context.correlationId || !context.adminId) {
      return new Error('An admin read context is required');
    }
    return null;
  }

  /**
   * The run record summary for the given jobs (SA SC-5): one RPC, rows returned
   * raw. The caller validates every row with Zod (external data).
   */
  async summariseCronRunsAllJobs(
    context: AdminReadContext,
    jobs: readonly string[],
    now: Date,
    recent: number,
    options: AdminReadOptions = {}
  ): Promise<RepositoryResult<unknown[]>> {
    const missing = this.requireContext(context);
    if (missing) return { data: null, error: missing };
    try {
      let query = this.supabase.rpc('admin_bos_cron_run_summary', {
        p_jobs: [...jobs],
        p_now: now.toISOString(),
        p_recent: recent,
      }) as unknown as Query;
      if (options.signal) query = query.abortSignal(options.signal);
      const { data, error } = await query;
      if (error) {
        this.logger.warn(
          { correlationId: context.correlationId, adminUserId: context.adminId, code: (error as { code?: string }).code },
          'Cron run summary read failed'
        );
        return { data: null, error: asError(error) };
      }
      const rows = Array.isArray(data) ? data : [];
      this.logger.info(
        { correlationId: context.correlationId, adminUserId: context.adminId, jobs: jobs.length, rows: rows.length },
        'Cron run summary read (all jobs)'
      );
      return { data: rows, error: null };
    } catch (error) {
      return { data: null, error: asError(error) };
    }
  }

  /** Every figure for one queue, across all accounts. Any failed request fails the queue. */
  async readQueueFiguresAllAccounts(
    context: AdminReadContext,
    queue: AdminQueueId,
    now: Date,
    options: AdminReadOptions = {}
  ): Promise<RepositoryResult<RawQueueFigures>> {
    const missing = this.requireContext(context);
    if (missing) return { data: null, error: missing };
    const spec = ADMIN_QUEUE_SPECS[queue];
    if (!spec) return { data: null, error: new Error('Unknown queue') };

    const nowIso = now.toISOString();
    const q = quoteFilterValue;
    const day = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const week = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    const stuckBefore = stuckBeforeOf(now);

    const base = (columns: string, head: boolean): Query => {
      let query = (head
        ? this.supabase.from(spec.table).select(columns, { count: 'exact', head: true })
        : this.supabase.from(spec.table).select(columns)) as unknown as Query;
      if (options.signal) query = query.abortSignal(options.signal);
      return query;
    };
    const head = () => base('id', true);

    /**
     * "Due now", exactly the claim function's predicate (SC-9(e)): see
     * `spec.claimCitation`. Payment tables: pending, scheduled_at <= now, and
     * (next_attempt_at IS NULL OR next_attempt_at <= now). Others: pending and
     * (next_attempt_at IS NULL OR next_attempt_at <= now).
     */
    const due = (query: Query): Query => {
      let filtered = query.eq('status', 'pending');
      if (spec.hasScheduledAt) filtered = filtered.lte('scheduled_at', nowIso);
      return filtered.or(`next_attempt_at.is.null,next_attempt_at.lte.${q(nowIso)}`);
    };
    const inWindow = (query: Query, since: string): Query =>
      query.gte(spec.windowColumn, since).lte(spec.windowColumn, nowIso);
    // Shared with the item list (slice 7a, W7A-6): the same calls in the same order.
    const failedNotDead = (query: Query): Query => failedNotDeadFilter(query, spec);
    const deadLettered = (query: Query): Query => deadLetteredFilter(query, spec);

    const count = async (query: Query): Promise<number> => {
      const { error, count: n } = await query;
      if (error) throw asError(error);
      return n ?? 0;
    };
    const first = async (query: Query): Promise<Record<string, string | null> | null> => {
      const { data, error } = await query;
      if (error) throw asError(error);
      const rows = Array.isArray(data) ? (data as Array<Record<string, string | null>>) : [];
      return rows[0] ?? null;
    };

    const laterFilter = spec.hasScheduledAt
      ? (query: Query) =>
          query
            .eq('status', 'pending')
            .not('scheduled_at', 'is', null)
            .or(`scheduled_at.gt.${q(nowIso)},next_attempt_at.gt.${q(nowIso)}`)
      : (query: Query) => query.eq('status', 'pending').gt('next_attempt_at', nowIso);

    // Oldest due, as two single-row reads (SC-9(f)):
    //  (a) due rows never retried: ordered by the base column;
    //  (b) due rows with a retry time: ordered by next_attempt_at.
    // ASSUMPTION (stated and tested): whenever next_attempt_at is set on a
    // payment row it is >= scheduled_at, because only the retry path sets it,
    // after the row was claimed (so after it was due). PostgREST cannot compare
    // two columns, so the effective due time of (b) is taken as
    // max(scheduled_at, next_attempt_at) of the one row read. If L-5.2/L-5.5
    // ever show otherwise, read limit(20) and take the minimum of the maxima.
    const baseColumn = spec.hasScheduledAt ? 'scheduled_at' : 'created_at';
    const oldestNeverRetried = () =>
      due(base(baseColumn, false)).is('next_attempt_at', null).order(baseColumn, { ascending: true }).limit(1);
    const oldestRetried = () =>
      due(base(spec.hasScheduledAt ? 'next_attempt_at, scheduled_at' : 'next_attempt_at', false))
        .not('next_attempt_at', 'is', null)
        .order('next_attempt_at', { ascending: true })
        .limit(1);

    try {
      const [
        dueNow, laterCount, noDueTime, inProgress, stuck, failed24h, failed7d, dead24h, dead7d,
        skipped7d, guardrail7d, unrecognised, oldestA, oldestB,
      ] = await Promise.all([
        count(due(head())),
        count(laterFilter(head())),
        spec.table === 'payment_automation_executions'
          ? count(head().eq('status', 'pending').is('scheduled_at', null))
          : Promise.resolve(null),
        count(head().eq('status', spec.inProgress)),
        count(stuckFilter(head(), spec, stuckBefore)),
        count(inWindow(failedNotDead(head()), day)),
        count(inWindow(failedNotDead(head()), week)),
        count(inWindow(deadLettered(head()), day)),
        count(inWindow(deadLettered(head()), week)),
        spec.skippedStatus ? count(inWindow(head().eq('status', spec.skippedStatus), week)) : Promise.resolve(null),
        spec.guardrailMarkers.length
          ? count(inWindow(head().eq('status', 'failed').in('error_message', spec.guardrailMarkers), week))
          : Promise.resolve(null),
        count(head().not('status', 'in', `(${spec.known.join(',')})`)),
        first(oldestNeverRetried()),
        first(oldestRetried()),
      ]);

      const dueA = oldestA ? (oldestA[baseColumn] ?? null) : null;
      const dueB = oldestB
        ? spec.hasScheduledAt
          ? later(oldestB.next_attempt_at ?? null, oldestB.scheduled_at ?? null)
          : (oldestB.next_attempt_at ?? null)
        : null;

      const figures: RawQueueFigures = {
        dueNow,
        later: laterCount,
        noDueTime,
        inProgress,
        stuck,
        failed24h,
        failed7d,
        deadLettered24h: dead24h,
        deadLettered7d: dead7d,
        skipped7d,
        guardrailSkips7d: guardrail7d,
        unrecognisedStatus: unrecognised,
        oldestDueAt: earlier(dueA, dueB),
      };
      this.logger.info(
        {
          correlationId: context.correlationId,
          adminUserId: context.adminId,
          queue,
          dueNow,
          stuck,
          deadLettered24h: dead24h,
        },
        'Queue figures read (all accounts)'
      );
      return { data: figures, error: null };
    } catch (error) {
      this.logger.warn(
        { correlationId: context.correlationId, adminUserId: context.adminId, queue, code: (error as { code?: string }).code },
        'Queue figures read failed'
      );
      return { data: null, error: asError(error) };
    }
  }

  /**
   * One page of a queue's items in one state, across all accounts
   * (ADMIN_BOS_CLEANUP slice 7a; SA C7-12, workplan §2.3).
   *
   * SERVICE ROLE, ON PURPOSE: "which lead replies are dead-lettered,
   * platform-wide" has no per-tenant answer. CLAUDE.md rule 4 is replaced by
   * the caller's `requireAdmin` gate; the only caller is
   * app/api/admin/jobs-queues/items/route.ts (the isolation guard in this
   * repository's test enforces "only app/api/admin/**").
   *
   * One request: the exact column list, the state filter (the figures' own
   * helpers, without their 24 h / 7 d window), explicit NULL ordering with
   * `id` as the tie-breaker, and a 50-row range. `count: 'exact'` comes back on
   * the same request. A page past the end (PostgREST 416 PGRST103) is an empty
   * page with `total: null`, never an error (W7A-2). Read-only: nothing is
   * written, and no row value is logged.
   */
  async listQueueItemsAllAccounts(
    context: AdminReadContext,
    queue: AdminQueueId,
    state: AdminQueueItemState,
    now: Date,
    page: { page: number },
    options: AdminReadOptions = {}
  ): Promise<RepositoryResult<{ rows: RawQueueItem[]; total: number | null }>> {
    const missing = this.requireContext(context);
    if (missing) return { data: null, error: missing };
    const spec = ADMIN_QUEUE_SPECS[queue];
    if (!spec) return { data: null, error: new Error('Unknown queue') };
    if (!ADMIN_QUEUE_ITEM_STATES.includes(state)) return { data: null, error: new Error('Unknown item state') };
    const pageNumber = page?.page;
    // Defence in depth: the route has already refused this with a 400.
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > ADMIN_QUEUE_ITEMS_MAX_PAGE) {
      return { data: null, error: new Error('Page out of range') };
    }
    const logContext = { correlationId: context.correlationId, adminUserId: context.adminId, queue, state, page: pageNumber };

    try {
      let query = this.supabase
        .from(spec.table)
        .select(ADMIN_QUEUE_ITEM_COLUMNS[queue].join(', '), { count: 'exact' }) as unknown as Query;
      if (options.signal) query = query.abortSignal(options.signal);

      // Explicit NULL ordering (W7A-3): Postgres puts NULLs last on ASC and
      // first on DESC by default, which is the opposite of what each list wants.
      if (state === 'stuck') {
        // Orphans (no claim, the only cancellable stuck rows) first.
        query = stuckFilter(query, spec, stuckBeforeOf(now)).order('claimed_at', { ascending: true, nullsFirst: true });
      } else if (state === 'failed' || state === 'dead_lettered') {
        // Newest first, so items still inside the 72 h window lead; an
        // automation with no scheduled_at must not lead.
        query = (state === 'failed' ? failedNotDeadFilter(query, spec) : deadLetteredFilter(query, spec)).order(
          spec.windowColumn,
          { ascending: false, nullsFirst: false }
        );
      } else {
        query = query
          .eq('status', 'pending')
          .order(spec.hasScheduledAt ? 'scheduled_at' : 'created_at', { ascending: true, nullsFirst: false });
      }
      const from = (pageNumber - 1) * ADMIN_QUEUE_ITEMS_PAGE_SIZE;
      query = query.order('id', { ascending: true }).range(from, from + ADMIN_QUEUE_ITEMS_PAGE_SIZE - 1);

      const { data, error, count } = await query;
      if (error) {
        const code = (error as { code?: string }).code;
        if (code === PAST_THE_END_CODE) {
          this.logger.info(logContext, 'Queue items page is past the end of the list');
          return { data: { rows: [], total: null }, error: null };
        }
        this.logger.warn({ ...logContext, code }, 'Queue items read failed');
        return { data: null, error: asError(error) };
      }

      // Defensive: never more than one page, even if a client ignored the range.
      const raw = (Array.isArray(data) ? data : []).slice(0, ADMIN_QUEUE_ITEMS_PAGE_SIZE);
      const rows: RawQueueItem[] = [];
      for (const value of raw) {
        const mapped = mapItemRow(queue, value);
        if (!mapped) {
          this.logger.warn({ ...logContext, code: 'malformed_row' }, 'Queue items read failed');
          return { data: null, error: new Error('A queue item row was not in the expected shape') };
        }
        rows.push(mapped);
      }
      const total = count ?? 0;
      this.logger.info({ ...logContext, returned: rows.length, total }, 'Queue items read (all accounts)');
      return { data: { rows, total }, error: null };
    } catch (error) {
      this.logger.warn({ ...logContext, code: (error as { code?: string }).code }, 'Queue items read failed');
      return { data: null, error: asError(error) };
    }
  }

  /**
   * ONE queue row by id, across all accounts (ADMIN_BOS_CLEANUP slice 7b; SA
   * C7-12 "reads extend AdminJobsQueuesRepository", workplan §2.2, OP-7).
   *
   * The action route re-reads the row on the server before its
   * compare-and-set, to check it is still what the admin saw and to take the
   * row's OWN `user_id` for the write. SERVICE ROLE, ON PURPOSE, as the list:
   * the only caller is app/api/admin/jobs-queues/items/action/route.ts, after
   * `requireAdmin` (the isolation guard enforces "only app/api/admin/**").
   *
   * The same column allow-list and field-by-field mapper as the list: no new
   * column, no error text, skip reason, payload or claimer. `null` means no
   * such row in THIS queue's table (never `.single()`, so a missing row is not
   * a PGRST116 error). Read-only; logs ids and `found` only, never a row value.
   */
  async readQueueItemAllAccounts(
    context: AdminReadContext,
    queue: AdminQueueId,
    itemId: string,
    options: AdminReadOptions = {}
  ): Promise<RepositoryResult<RawQueueItem | null>> {
    const missing = this.requireContext(context);
    if (missing) return { data: null, error: missing };
    if (!Object.prototype.hasOwnProperty.call(ADMIN_QUEUE_SPECS, queue)) return { data: null, error: new Error('Unknown queue') };
    if (typeof itemId !== 'string' || itemId.length === 0) return { data: null, error: new Error('An item id is required') };
    const spec = ADMIN_QUEUE_SPECS[queue];
    const logContext = { correlationId: context.correlationId, adminUserId: context.adminId, queue };

    try {
      let query = (this.supabase
        .from(spec.table)
        .select(ADMIN_QUEUE_ITEM_COLUMNS[queue].join(', ')) as unknown as Query)
        .eq('id', itemId)
        .limit(1);
      if (options.signal) query = query.abortSignal(options.signal);

      const { data, error } = await query;
      if (error) {
        this.logger.warn({ ...logContext, code: (error as { code?: string }).code }, 'Queue item read failed');
        return { data: null, error: asError(error) };
      }
      const raw = Array.isArray(data) ? data : [];
      if (raw.length === 0) {
        this.logger.info({ ...logContext, found: false }, 'Queue item read (all accounts)');
        return { data: null, error: null };
      }
      const mapped = mapItemRow(queue, raw[0]);
      if (!mapped) {
        this.logger.warn({ ...logContext, code: 'malformed_row' }, 'Queue item read failed');
        return { data: null, error: new Error('The queue item row was not in the expected shape') };
      }
      this.logger.info({ ...logContext, found: true }, 'Queue item read (all accounts)');
      return { data: mapped, error: null };
    } catch (error) {
      this.logger.warn({ ...logContext, code: (error as { code?: string }).code }, 'Queue item read failed');
      return { data: null, error: asError(error) };
    }
  }
}

export const adminJobsQueuesRepository = new AdminJobsQueuesRepository();
