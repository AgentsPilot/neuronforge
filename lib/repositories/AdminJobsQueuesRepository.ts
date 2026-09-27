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
//   - COLUMNS: every select is a head count (`id`, head: true) or one of the
//     timestamps `scheduled_at`, `next_attempt_at`, `created_at` (SC-9(b)). No
//     payload, recommendation, error message, skip reason, contact, invoice,
//     booking or user column is ever read. `error_message` appears ONLY inside
//     filters, compared with fixed markers (SC-9(d)).
//   - Methods never throw: they return `{ data, error }`.
//
// The five queue tables are READ ONLY here; nothing about them changes (A-6).

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

/** The only columns this repository ever selects (SC-9(b)). */
export const ADMIN_QUEUE_SELECTABLE_COLUMNS = ['id', 'scheduled_at', 'next_attempt_at', 'created_at'] as const;

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
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
  abortSignal(signal: AbortSignal): Query;
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  const e = (error ?? {}) as { message?: string; code?: string };
  const wrapped = new Error(e.message ?? 'Supabase error') as Error & { code?: string };
  if (e.code) wrapped.code = e.code;
  return wrapped;
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
    const stuckBefore = new Date(now.getTime() - STUCK_AFTER_SECONDS * 1000).toISOString();

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
    /** Failed and NOT dead-lettered and NOT a guardrail skip. Null-safe on error_message. */
    const failedNotDead = (query: Query): Query => {
      const excluded = [...(spec.deadLetterByMarker ? [DEAD_LETTER_MARKER] : []), ...spec.guardrailMarkers];
      const filtered = query.eq('status', 'failed');
      if (excluded.length === 0) return filtered;
      return filtered.or(`error_message.is.null,error_message.not.in.(${excluded.map(q).join(',')})`);
    };
    const deadLettered = (query: Query): Query =>
      spec.deadLetterByMarker
        ? query.eq('status', 'failed').eq('error_message', DEAD_LETTER_MARKER)
        : query.eq('status', spec.deadLetterStatus);

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
        count(head().eq('status', spec.inProgress).or(`claimed_at.is.null,claimed_at.lt.${q(stuckBefore)}`)),
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
}

export const adminJobsQueuesRepository = new AdminJobsQueuesRepository();
