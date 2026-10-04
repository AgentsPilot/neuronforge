// lib/repositories/AuditTrailRepository.ts
// Owner-scoped reads of the `audit_trail` table (Layer 3 step 0, FR-23, FR-27).
//
// Writes do NOT go through here: every audit write goes through
// AuditTrailService's queued `log()`, which this repository leaves untouched
// (Layer 3 D-4).
//
// Service-role client, by design. The owner's own RLS policy would also scope
// the rows, but the audit routes have always read with the service role, and
// this repository makes the scoping explicit instead of relying on RLS:
// `.eq('user_id', userId)` on every query. For the owner method `userId` is
// always the authenticated caller (never a client-supplied value).
//
// THE FIRST ADMIN EXCEPTION (admin reorganisation slice 2b, SA C-7):
// `listAdminAiFailures` reads an ADMIN-SELECTED account's failed Business OS AI
// actions for the Businesses panel. Its only caller is
// `app/api/admin/business-os/accounts/[accountId]/summary/route.ts`, behind
// `requireAdmin`; a source guard (lib/repositories/__tests__/
// adminReadMethods.guard.test.ts) fails if anything outside `app/api/admin/**`
// calls it. It is still `.eq('user_id', accountId)`-scoped, and it selects only
// the id, time, grouping id and `details` (metadata; no prompt or message).
//
// THE SECOND ADMIN EXCEPTION, AND THE FIRST UNSCOPED READ (admin reorganisation
// slice 4, SA C-5): `countAdminEventsAllAccountsInWindow` counts audit rows of
// EVERY account, for the admin Health landing. It is NOT `.eq('user_id')`-scoped:
// the question ("how many failed AI actions platform-wide in 24 h?") has no
// per-tenant answer. It returns one integer (`count: 'exact', head: true`, so no
// row, no `details`), requires an admin read context (who read, for which
// request), and its only caller is `app/api/admin/health-summary/route.ts`,
// behind `requireAdmin` (pinned by adminReadMethods.guard.test.ts).
//
// THE THIRD ADMIN EXCEPTION, AND THE FIRST UNSCOPED READ OF ENTRY CONTENT
// (admin AI Activity view, Gap B slice B1b, NFR-4.4, SA-RC-12):
// `listAiActionEntriesAllAccountsByGroupIds` reads Business OS AI action entries
// of EVERY account whose grouping id is one of at most 100 ids, inside a
// bounded window. It returns ONLY AI entries: it filters by entity type
// `ai_action` and the two `BUSINESS_AI_ACTION_*` events, never by severity
// (severity is decided at write or registration, not an outcome signal). It is
// not `.eq('user_id')`-scoped, because a chat turn id comes from a client
// header and two accounts can share one (F-28): the CALLER matches each entry to
// its charge on `details.actionId` AND `user_id`, and discards every other
// entry before anything is serialised. It requires an admin read context, its
// group ids come from charge rows (never from a request), it selects only
// `ADMIN_AI_ACTION_ENTRY_COLUMNS` (no hash, no email, no ip, no user agent), and
// its only caller is `app/api/admin/business-os/ai-activity/route.ts`, behind
// `requireAdmin` (pinned by adminReadMethods.guard.test.ts).
//
// AI audit entries (entity type `ai_action`, events `BUSINESS_AI_ACTION_*`) are
// operator-only until the charging decision (Layer 3 D-6). The OWNER read,
// `listOwnerEntries`, excludes them IN THE QUERY, so the owner's page, its
// counts and its CSV export can never see one. Only the admin exceptions above
// read them.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import { AI_ACTION_ENTITY_TYPE, AI_ACTION_EVENT_PREFIX, isAiAuditFilter } from '@/lib/audit/requestSchemas';
import type { AuditSeverity } from '@/lib/audit/types';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/**
 * The columns an owner may read: exactly the fields the /monitoring page uses,
 * plus the two ids. Not `hash` (the tamper hash) and not `user_email`.
 */
const OWNER_COLUMNS =
  'id, user_id, actor_id, action, entity_type, entity_id, resource_name, changes, details, ' +
  'ip_address, user_agent, session_id, severity, compliance_flags, created_at';

export interface OwnerAuditRow {
  id: string;
  user_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  resource_name: string | null;
  changes: unknown;
  details: unknown;
  ip_address: string | null;
  user_agent: string | null;
  session_id: string | null;
  severity: AuditSeverity | null;
  compliance_flags: string[] | null;
  created_at: string;
}

/** The only columns the admin AI-failures read selects. */
export const ADMIN_AI_FAILURE_COLUMNS = 'id, created_at, entity_id, details';

/** Upper bound on `listAdminAiFailures`'s limit. */
export const ADMIN_AI_FAILURES_MAX_LIMIT = 50;

export interface AdminAiFailureRow {
  id: string;
  created_at: string;
  /** The action's grouping id (links to its token_usage rows). */
  entity_id: string | null;
  /** AiAuditDetails as stored. Projected to an allow-list by the caller. */
  details: unknown;
}

/**
 * Who is reading, for which request (slice 4, SA C-5). Structurally the same as
 * the admin analytics repository's context, declared here so this owner-scoped
 * repository does not import that admin-only module.
 */
export interface AdminAuditReadContext {
  correlationId: string;
  /** The admin's user id (from `requireAdmin`). Never an email. */
  adminId: string;
}

/** What `countAdminEventsAllAccountsInWindow` may filter on. At least one is required. */
export interface AdminAuditCountFilter {
  /** An exact event name (an AUDIT_EVENTS value). */
  action?: (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];
  severity?: AuditSeverity;
}

const AUDIT_SEVERITIES: readonly AuditSeverity[] = ['info', 'warning', 'critical'];

/**
 * The only columns the admin AI-entry join selects (B1b). No `hash`, no
 * `user_email`, no `ip_address`, no `user_agent`. `details` is projected to an
 * allow-list by the caller.
 */
export const ADMIN_AI_ACTION_ENTRY_COLUMNS = 'id, user_id, created_at, entity_id, details';

export const ADMIN_AI_ENTRY_LIMITS = {
  /** Distinct group ids per call, BEFORE the case variants are added (so at most 200 in the IN). */
  MAX_GROUP_IDS: 100,
  /**
   * Rows per call; reaching it means the read was CUT. This is PostgREST's
   * max-rows on this project (every `PAGE_SIZE: 1000` in the credits module
   * relies on the same setting). If max-rows is ever lowered, this cap must
   * follow it, or a silently truncated response would read as complete.
   */
  MAX_ROWS: 1000,
} as const;

const GROUP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AdminAiActionEntryRow {
  id: string;
  user_id: string | null;
  created_at: string;
  /** The action's grouping id, as written (case preserved: `entity_id` is text). */
  entity_id: string | null;
  /** AiAuditDetails as stored. Projected to an allow-list by the caller. */
  details: unknown;
}

export interface AdminAiActionEntriesPage {
  rows: AdminAiActionEntryRow[];
  /** `rows.length >= MAX_ROWS`: more may match, so the read is incomplete. */
  reachedLimit: boolean;
}

export interface OwnerAuditQuery {
  action?: string;
  entityType?: string;
  severity?: AuditSeverity;
  page: number;
  limit: number;
}

export interface OwnerAuditPage {
  logs: OwnerAuditRow[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export class AuditTrailRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AuditTrailRepository' });
  }

  /**
   * One page of the owner's own audit entries, newest first, never including an
   * AI audit entry. `total` counts the same filtered rows.
   */
  async listOwnerEntries(userId: string, q: OwnerAuditQuery): Promise<RepositoryResult<OwnerAuditPage>> {
    const empty: OwnerAuditPage = { logs: [], total: 0, page: q.page, limit: q.limit, hasMore: false };

    // Asking for AI entries is answered without a query: there are none for an owner.
    if (isAiAuditFilter(q)) {
      return { data: empty, error: null };
    }

    const offset = (q.page - 1) * q.limit;

    try {
      let query = this.supabase
        .from('audit_trail')
        .select(OWNER_COLUMNS, { count: 'exact' })
        .eq('user_id', userId)
        // The primary guard. entity_type is NOT NULL, so no ordinary row is lost.
        .neq('entity_type', AI_ACTION_ENTITY_TYPE)
        // Defence in depth, should an AI event ever be written under another type.
        .not('action', 'like', `${AI_ACTION_EVENT_PREFIX}%`);

      if (q.action) query = query.eq('action', q.action);
      if (q.entityType) query = query.eq('entity_type', q.entityType);
      if (q.severity) query = query.eq('severity', q.severity);

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + q.limit - 1); // inclusive range

      if (error) throw error;

      const total = count ?? 0;
      return {
        data: {
          logs: (data ?? []) as unknown as OwnerAuditRow[],
          total,
          page: q.page,
          limit: q.limit,
          hasMore: total > offset + q.limit,
        },
        error: null,
      };
    } catch (error) {
      this.logger.error({ err: error, userId, page: q.page, limit: q.limit }, 'Failed to list owner audit entries');
      return { data: null, error: error as Error };
    }
  }

  /**
   * ADMIN ONLY — see the header. The most recent failed Business OS AI actions
   * of one admin-selected account since `since`, newest first, at most `limit`.
   */
  async listAdminAiFailures(
    accountId: string,
    opts: { since: Date; limit: number }
  ): Promise<RepositoryResult<AdminAiFailureRow[]>> {
    try {
      const limit = Math.min(Math.max(Math.trunc(opts.limit) || 1, 1), ADMIN_AI_FAILURES_MAX_LIMIT);
      const { data, error } = await this.supabase
        .from('audit_trail')
        .select(ADMIN_AI_FAILURE_COLUMNS)
        .eq('user_id', accountId)
        .eq('action', AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED)
        .gte('created_at', opts.since.toISOString())
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data: (data ?? []) as unknown as AdminAiFailureRow[], error: null };
    } catch (error) {
      this.logger.error({ err: error, accountId }, 'Failed to list the AI failures of an account for admin');
      return { data: null, error: error as Error };
    }
  }
  /**
   * ADMIN ONLY, ALL ACCOUNTS — see the header. The exact number of audit rows,
   * every account, in `[window.start, window.end]` (both inclusive, as the admin
   * audit page's `.gte/.lte`), matching the action and/or severity.
   */
  async countAdminEventsAllAccountsInWindow(
    context: AdminAuditReadContext,
    filter: AdminAuditCountFilter,
    window: { start: string; end: string },
    opts: { signal?: AbortSignal } = {}
  ): Promise<RepositoryResult<number>> {
    try {
      if (!context?.correlationId || !context?.adminId) {
        throw new Error('An admin read context (correlationId, adminId) is required');
      }
      if (!filter?.action && !filter?.severity) {
        throw new Error('An action or a severity is required');
      }
      if (filter.severity && !AUDIT_SEVERITIES.includes(filter.severity)) {
        throw new Error('Unknown severity');
      }
      if (!window || !window.start || !window.end || !(Date.parse(window.start) <= Date.parse(window.end))) {
        throw new Error('A valid window (start <= end) is required');
      }

      let query = this.supabase
        .from('audit_trail')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', window.start)
        .lte('created_at', window.end);
      if (filter.action) query = query.eq('action', filter.action);
      if (filter.severity) query = query.eq('severity', filter.severity);
      if (opts.signal) query = query.abortSignal(opts.signal);

      const { count, error } = await query;
      if (error) throw error;

      // info: a cross-tenant read. The filter and the count only.
      this.logger.info(
        {
          correlationId: context.correlationId,
          adminId: context.adminId,
          method: 'countAdminEventsAllAccountsInWindow',
          action: filter.action,
          severity: filter.severity,
          count: count ?? 0,
        },
        'Admin audit count read across all accounts'
      );
      return { data: count ?? 0, error: null };
    } catch (error) {
      // warn, like the sibling admin reads (AdminTokenUsageAnalyticsRepository):
      // the caller turns a failure into an "unavailable" tile and records it in
      // its own timings, so this is not a fault on its own (SA code review 5).
      this.logger.warn(
        { err: error, correlationId: context?.correlationId, method: 'countAdminEventsAllAccountsInWindow' },
        'Admin audit count read failed'
      );
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * ADMIN ONLY, ALL ACCOUNTS — see the header (third exception). Business OS AI
   * action entries whose grouping id is one of `groupIds`, created in
   * `[window.start, window.end)`, newest first, at most `MAX_ROWS`.
   *
   * Filtered by ENTITY TYPE and the two AI ACTIONS, never by severity. Each
   * group id is queried in lower AND upper case: `entity_id` is text and keeps
   * the case of a client-supplied chat turn id, while a charge's `group_id`
   * reads back lower-case (V-14, OQ-6). Never `lower(entity_id)`, which would
   * defeat `idx_audit_trail_entity_id`. A mixed-case id is a known gap (R-6).
   */
  async listAiActionEntriesAllAccountsByGroupIds(
    context: AdminAuditReadContext,
    groupIds: readonly string[],
    window: { start: string; end: string }
  ): Promise<RepositoryResult<AdminAiActionEntriesPage>> {
    try {
      if (!context?.correlationId || !context?.adminId) {
        throw new Error('An admin read context (correlationId, adminId) is required');
      }
      if (!Array.isArray(groupIds) || groupIds.length === 0 || groupIds.length > ADMIN_AI_ENTRY_LIMITS.MAX_GROUP_IDS) {
        throw new Error(`Between 1 and ${ADMIN_AI_ENTRY_LIMITS.MAX_GROUP_IDS} group ids are required`);
      }
      if (!groupIds.every((id) => typeof id === 'string' && GROUP_ID_PATTERN.test(id))) {
        throw new Error('Every group id must be a UUID');
      }
      const startMs = window ? Date.parse(window.start) : NaN;
      const endMs = window ? Date.parse(window.end) : NaN;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(startMs < endMs)) {
        throw new Error('A valid half-open window (start < end) is required');
      }

      const variants = [...new Set(groupIds.flatMap((id) => [id.toLowerCase(), id.toUpperCase()]))];

      const { data, error } = await this.supabase
        .from('audit_trail')
        .select(ADMIN_AI_ACTION_ENTRY_COLUMNS)
        .eq('entity_type', AI_ACTION_ENTITY_TYPE)
        .in('action', [AUDIT_EVENTS.BUSINESS_AI_ACTION_COMPLETED, AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED])
        .in('entity_id', variants)
        .gte('created_at', window.start)
        .lt('created_at', window.end)
        .order('created_at', { ascending: false })
        .limit(ADMIN_AI_ENTRY_LIMITS.MAX_ROWS);

      if (error) throw error;
      const rows = (data ?? []) as unknown as AdminAiActionEntryRow[];
      const reachedLimit = rows.length >= ADMIN_AI_ENTRY_LIMITS.MAX_ROWS;

      // info: a cross-tenant read. Counts only: no id list, no details.
      this.logger.info(
        {
          correlationId: context.correlationId,
          adminId: context.adminId,
          method: 'listAiActionEntriesAllAccountsByGroupIds',
          groupIds: groupIds.length,
          rows: rows.length,
          reachedLimit,
        },
        'Admin AI action entries read across all accounts'
      );
      return { data: { rows, reachedLimit }, error: null };
    } catch (error) {
      // warn, like the sibling admin count: the caller marks every undecided
      // row "unknown" and records the failure in its own log line.
      this.logger.warn(
        { err: error, correlationId: context?.correlationId, method: 'listAiActionEntriesAllAccountsByGroupIds' },
        'Admin AI action entries read failed'
      );
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
}

export const auditTrailRepository = new AuditTrailRepository();
