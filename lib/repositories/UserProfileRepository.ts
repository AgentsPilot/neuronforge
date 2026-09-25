// lib/repositories/UserProfileRepository.ts
// Repository for read access to the user `profiles` table.
//
// Note on user_id filtering: the `profiles` table's primary key column is `id`,
// and that value IS the Supabase auth user id (one row per user). Filtering by
// `.eq('id', userId)` is therefore equivalent to the standard
// `.eq('user_id', userId)` requirement called out in REPOSITORY_STRATEGY.md —
// the column is just named differently because the row is the user.
//
// Profile rows are created/updated through auth flows and the onboarding UI,
// not through this code path, so this repository is intentionally read-only.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';
import { ilikeContainsPattern, matchesLiterally } from './BusinessProfileRepository';

/**
 * Subset of the `profiles` table columns used for building UserContext.
 * Add fields as new callers need them — keep this narrow on purpose.
 */
export interface UserProfile {
  id: string;
  full_name: string | null;
  role: string | null;
  company: string | null;
  timezone: string | null;
}

/** One row of the admin Businesses list (slice 2b). Never `select('*')`. */
export interface AdminProfileListRow {
  id: string;
  full_name: string | null;
  company: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export const ADMIN_PROFILE_LIST_COLUMNS = 'id, full_name, company, created_at, updated_at';

export interface AdminProfileListQuery {
  /** Free text. Matched with single-operator ILIKE calls, never an `.or()` string. */
  search?: string;
  /** Extra account ids to include when searching (e.g. accounts whose business name matched). */
  extraIds?: readonly string[];
  sortBy: 'created_at' | 'full_name';
  ascending: boolean;
  limit: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The in-memory order of a merged search, made to match the database order of
 * the unsearched list (QA N-3b). Postgres puts NULLs LAST when ascending and
 * FIRST when descending, so a missing value sorts as greater than any value.
 * Exported for its test.
 */
export function compareForAdminList(
  a: AdminProfileListRow,
  b: AdminProfileListRow,
  sortBy: AdminProfileListQuery['sortBy'],
  ascending: boolean
): number {
  const av = a[sortBy];
  const bv = b[sortBy];
  let cmp: number;
  if (av == null && bv == null) cmp = 0;
  else if (av == null) cmp = 1;
  else if (bv == null) cmp = -1;
  else cmp = av.localeCompare(bv);
  return ascending ? cmp : -cmp;
}

export class UserProfileRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'UserProfileRepository' });
  }

  /**
   * Fetch a user's profile row by auth user id.
   *
   * Returns `{ data: null, error: null }` when the row simply doesn't exist
   * (common for brand-new users whose onboarding hasn't written a profile yet)
   * — callers should treat this as "no enrichment available" and fall back to
   * auth metadata, NOT as an error.
   */
  async findById(userId: string): Promise<RepositoryResult<UserProfile>> {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('id, full_name, role, company, timezone')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      return { data: data as UserProfile | null, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to fetch user profile');
      return { data: null, error: error as Error };
    }
  }

  /**
   * ADMIN ONLY (admin reorganisation slice 2b): the account list behind
   * /admin/users. Every account, by design — the only caller is
   * `app/api/admin/users/route.ts`, behind `requireAdmin` (source guard in
   * lib/repositories/__tests__/adminReadMethods.guard.test.ts).
   *
   * The search used to be interpolated into an `.or()` filter string, which let
   * a search term inject PostgREST filter syntax. It is now matched with
   * separate single-operator reads (`.ilike`, `.eq`, `.in`) whose values are
   * parameters, and the results are merged here.
   */
  async listForAdmin(q: AdminProfileListQuery): Promise<RepositoryResult<AdminProfileListRow[]>> {
    try {
      const limit = Math.min(Math.max(Math.trunc(q.limit) || 1, 1), 1000);
      const ordered = <T extends { order: (c: string, o: { ascending: boolean }) => T }>(query: T): T =>
        query.order(q.sortBy, { ascending: q.ascending });

      const search = q.search?.trim();
      if (!search) {
        const { data, error } = await ordered(this.supabase.from('profiles').select(ADMIN_PROFILE_LIST_COLUMNS)).limit(limit);
        if (error) throw error;
        return { data: (data ?? []) as AdminProfileListRow[], error: null };
      }

      // Every character literal, `*` included (QA E-1): see ilikeContainsPattern.
      const pattern = ilikeContainsPattern(search);
      const reads = [
        this.supabase.from('profiles').select(ADMIN_PROFILE_LIST_COLUMNS).ilike('full_name', pattern).limit(limit),
        this.supabase.from('profiles').select(ADMIN_PROFILE_LIST_COLUMNS).ilike('company', pattern).limit(limit),
      ];
      if (UUID_PATTERN.test(search)) {
        reads.push(this.supabase.from('profiles').select(ADMIN_PROFILE_LIST_COLUMNS).eq('id', search).limit(1));
      }
      const extraIds = [...new Set(q.extraIds ?? [])].filter((id) => UUID_PATTERN.test(id));
      if (extraIds.length > 0) {
        reads.push(this.supabase.from('profiles').select(ADMIN_PROFILE_LIST_COLUMNS).in('id', extraIds).limit(limit));
      }

      const [byName, byCompany, ...exact] = await Promise.all(reads);
      const byId = new Map<string, AdminProfileListRow>();
      // A `*` went to the server as a one-character wildcard: keep literal matches only.
      const literalOnly = search.includes('*');
      for (const [result, column] of [
        [byName, 'full_name'],
        [byCompany, 'company'],
      ] as const) {
        if (result.error) throw result.error;
        for (const row of (result.data ?? []) as AdminProfileListRow[]) {
          if (literalOnly && !matchesLiterally(row[column], search)) continue;
          byId.set(row.id, row);
        }
      }
      // Exact-id and business-name matches are exact already.
      for (const { data, error } of exact) {
        if (error) throw error;
        for (const row of (data ?? []) as AdminProfileListRow[]) byId.set(row.id, row);
      }

      const rows = [...byId.values()].sort((a, b) => compareForAdminList(a, b, q.sortBy, q.ascending));
      // The search text is not logged: it is usually a person's or business's name.
      this.logger.debug({ searchLength: search.length, results: rows.length }, 'Admin profile search');
      return { data: rows.slice(0, limit), error: null };
    } catch (error) {
      this.logger.error({ err: error }, 'Admin profile list failed');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton instance for convenience (mirrors the rest of lib/repositories).
export const userProfileRepository = new UserProfileRepository();
