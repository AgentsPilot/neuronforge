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
// THE ONE ADMIN EXCEPTION (admin reorganisation slice 2b, SA C-7):
// `listAdminAiFailures` reads an ADMIN-SELECTED account's failed Business OS AI
// actions for the Businesses panel. Its only caller is
// `app/api/admin/business-os/accounts/[accountId]/summary/route.ts`, behind
// `requireAdmin`; a source guard (lib/repositories/__tests__/
// adminReadMethods.guard.test.ts) fails if anything outside `app/api/admin/**`
// calls it. It is still `.eq('user_id', accountId)`-scoped, and it selects only
// the id, time, grouping id and `details` (metadata; no prompt or message).
//
// AI audit entries (entity type `ai_action`, events `BUSINESS_AI_ACTION_*`) are
// operator-only until the charging decision (Layer 3 D-6). They are excluded
// IN THE QUERY, so the page, its counts and its CSV export can never see one.

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
}

export const auditTrailRepository = new AuditTrailRepository();
