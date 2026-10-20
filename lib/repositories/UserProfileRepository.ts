// lib/repositories/UserProfileRepository.ts
// Repository for the user `profiles` table: reads plus four targeted writes.
//
// Note on user_id filtering: the `profiles` table's primary key column is `id`,
// and that value IS the Supabase auth user id (one row per user). Filtering by
// `.eq('id', userId)` is therefore equivalent to the standard
// `.eq('user_id', userId)` requirement called out in REPOSITORY_STRATEGY.md —
// the column is just named differently because the row is the user.
//
// Profile rows are created by the signup trigger and updated through auth flows
// and the onboarding UI. The writes here behave differently on a missing row:
//
//   updateTimezoneMirror  (settings drawer D-1) UPDATE only. Mirrors the
//                         timezone onto an EXISTING row; a missing row stays
//                         missing.
//   saveSettingsCard      (settings drawer D-2) UPSERT on `id`. Saves the
//                         settings card's name / job title and DOES create the
//                         row for an account that has none, exactly as the
//                         page's old browser upsert did. An upsert is right
//                         here, unlike D-1's `preferred_language` (which needs
//                         different values on the insert and update paths):
//                         the payload is identical on both paths, and a
//                         created row takes the column defaults exactly as a
//                         signup-created row does (`role 'user'`, `timezone
//                         'UTC'`, which is only the best-effort mirror; the
//                         authority is `user_preferences.timezone`). It is one
//                         atomic `INSERT ... ON CONFLICT (id) DO UPDATE` that
//                         sets only the payload's columns, so `avatar_url`,
//                         `role`, `timezone` and the rest of an existing row
//                         are left alone. `profiles_role_privilege_guard`
//                         exempts `service_role`, and `role` is never in the
//                         payload anyway. `role` and `avatar_url` are never
//                         written by `saveSettingsCard` (D-3 owns `avatar_url`).
//   setAvatarUrl          (settings drawer D-3) UPSERT on `id`, for the same
//                         reasons as `saveSettingsCard`: the account with no
//                         `profiles` row gets one (SA-D2-8), where the old
//                         browser UPDATE silently saved nothing. Payload is
//                         `avatar_url`, `updated_at`, then `id` LAST.
//   clearAvatarUrl        (settings drawer D-3) UPDATE only. Nothing to clear
//                         on a missing row, so none is created.
//
// `findAvatarUrl`, `setAvatarUrl` and `clearAvatarUrl` are called only by
// `POST` / `DELETE /api/user/avatar`, with the SESSION user's id. None of them
// logs a URL value.
//
// SERVICE-ROLE CLIENT (`supabaseServer`, bypasses RLS) by design: the callers of
// the writes (`PATCH /api/business-os/preferences`, `PATCH
// /api/business-os/account-profile`) pass the SESSION user's id. The mirror is
// scoped with `.eq('id', userId)`; the card upsert carries `id: userId` as its
// conflict key, set LAST in a payload built field by field from an allow-list,
// so nothing the caller sends can name another row or another column
// (tenant-isolation-guard).
//
// Database errors: `findById`, `updateTimezoneMirror`, `findSettingsCard`,
// `saveSettingsCard` and the three avatar methods reduce a PostgREST error to
// `{ code, message }` (`safeDbError`) before logging or returning it, because
// its `details` can carry row values ("Failing row contains ..."; D-1 SA code review CR-1). The
// admin and export reads (`listForAdmin`, `findAdminNamesByIds`,
// `findForUserDataExport`) still log and return the raw error: follow-up
// CR-1b (Low), to be done when the data-export stream is not editing
// `userDataExportReads.test.ts`.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';
import { ADMIN_IDENTITY_CHUNK, ilikeContainsPattern, matchesLiterally } from './BusinessProfileRepository';
import { exportColumnsOf } from '@/lib/business-os/data-export/classification';
import { safeDbError } from './BusinessOsInviteRepository';

/** A fresh Error from the safe projection: no `details`, no `hint` (CR-1). */
function toSafeError(error: unknown): Error {
  const safe = safeDbError(error);
  const out = new Error(safe.message) as Error & { code?: string };
  if (safe.code) out.code = safe.code;
  return out;
}

/** The settings profile card (D-2). Exported for tests. */
export const SETTINGS_CARD_COLUMNS = 'full_name, avatar_url, job_title';

export interface ProfileSettingsCard {
  full_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
}

/** The only fields the card may write. No role, no avatar_url, no id. */
export interface ProfileSettingsCardPatch {
  full_name?: string;
  job_title?: string;
}

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

/** What an admin screen may know about a person from `profiles`: the display name only. */
export interface AdminProfileName {
  id: string;
  full_name: string | null;
}

/** The only columns `findAdminNamesByIds` selects. No email: `profiles` has none. Exported for tests. */
export const ADMIN_PROFILE_NAME_COLUMNS = 'id, full_name';

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
      this.logger.error({ dbError: safeDbError(error), userId }, 'Failed to fetch user profile');
      return { data: null, error: toSafeError(error) };
    }
  }

  /**
   * Mirror the business timezone onto the user's existing `profiles` row.
   *
   * `user_preferences.timezone` is the authority; this copy is best-effort and
   * the caller does not fail the save over it. A targeted UPDATE of two
   * columns, never an upsert or insert: a missing row stays missing (count 0
   * is logged at info and is not an error). `{ count: 'exact' }` and no
   * `.select()` (the PostgREST update + select 42703 hazard). `stamp` is the
   * same one the caller wrote to `user_preferences`. Never throws.
   */
  async updateTimezoneMirror(userId: string, zone: string, stamp: string): Promise<RepositoryResult<true>> {
    try {
      const { error, count } = await this.supabase
        .from('profiles')
        .update({ timezone: zone, updated_at: stamp }, { count: 'exact' })
        .eq('id', userId);

      if (error) throw error;
      if (count === 0) {
        this.logger.info({ userId }, 'No profile row to mirror the timezone onto');
      }
      return { data: true, error: null };
    } catch (error) {
      this.logger.error({ dbError: safeDbError(error), userId }, 'Failed to mirror the timezone onto the profile');
      return { data: null, error: toSafeError(error) };
    }
  }

  /**
   * The settings profile card (D-2): name, avatar URL and job title.
   *
   * `.maybeSingle()`: no row is `{ data: null, error: null }`, not an error
   * (the route shows empty fields). Never throws.
   */
  async findSettingsCard(userId: string): Promise<RepositoryResult<ProfileSettingsCard | null>> {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select(SETTINGS_CARD_COLUMNS)
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      return { data: (data ?? null) as ProfileSettingsCard | null, error: null };
    } catch (error) {
      this.logger.error({ dbError: safeDbError(error), userId }, 'Failed to read the profile card');
      return { data: null, error: toSafeError(error) };
    }
  }

  /**
   * Save the settings card's name and / or job title (D-2). See the header for
   * why this is an upsert on `id`.
   *
   * The payload is built field by field from the allow-list, never by
   * spreading `patch`, so a cast object carrying `role`, `avatar_url`,
   * `timezone` or another id cannot reach the table. `id` is set LAST so
   * nothing earlier can override it. No `.select()` after the upsert (the
   * PostgREST update + select hazard). Values are never logged. Never throws.
   */
  async saveSettingsCard(userId: string, patch: ProfileSettingsCardPatch): Promise<RepositoryResult<true>> {
    try {
      const payload: Record<string, string> = {};
      if (typeof patch.full_name === 'string') payload.full_name = patch.full_name;
      if (typeof patch.job_title === 'string') payload.job_title = patch.job_title;

      if (Object.keys(payload).length === 0) {
        this.logger.warn({ userId }, 'Profile card save with nothing to write');
        const empty = new Error('Nothing to update') as Error & { code?: string };
        empty.code = 'EMPTY_PATCH';
        return { data: null, error: empty };
      }

      // Reset by the BEFORE UPDATE trigger on the update path; needed on insert.
      payload.updated_at = new Date().toISOString();
      payload.id = userId;

      const { error } = await this.supabase.from('profiles').upsert(payload, { onConflict: 'id' });

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      this.logger.error({ dbError: safeDbError(error), userId }, 'Failed to save the profile card');
      return { data: null, error: toSafeError(error) };
    }
  }

  /**
   * The stored profile-picture URL (D-3, C-19), so `POST` / `DELETE
   * /api/user/avatar` know which old file to consider deleting.
   *
   * `.maybeSingle()`: no row, or a NULL column, is `{ data: null, error: null }`.
   * The URL is never logged. Never throws.
   */
  async findAvatarUrl(userId: string): Promise<RepositoryResult<string | null>> {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      const value = (data as { avatar_url?: unknown } | null)?.avatar_url;
      return { data: typeof value === 'string' ? value : null, error: null };
    } catch (error) {
      this.logger.error({ dbError: safeDbError(error), userId }, 'Failed to read the avatar URL');
      return { data: null, error: toSafeError(error) };
    }
  }

  /**
   * Store a new profile-picture URL (D-3). An UPSERT on `id`, so it also works
   * for an account with no `profiles` row (SA-D2-8 / RK-2 / F-25 D-3 note):
   * the old hook's UPDATE silently saved nothing there. Same reasoning as
   * `saveSettingsCard` (see the header): identical payload on both paths,
   * `role` never in it, `id` set LAST. No `.select()`. The URL is never
   * logged. Never throws.
   */
  async setAvatarUrl(userId: string, url: string): Promise<RepositoryResult<true>> {
    try {
      if (typeof url !== 'string' || url.length === 0) {
        this.logger.warn({ userId }, 'Avatar URL save with nothing to write');
        const empty = new Error('Nothing to update') as Error & { code?: string };
        empty.code = 'EMPTY_VALUE';
        return { data: null, error: empty };
      }

      const payload: Record<string, string> = {};
      payload.avatar_url = url;
      // Reset by the BEFORE UPDATE trigger on the update path; needed on insert.
      payload.updated_at = new Date().toISOString();
      payload.id = userId;

      const { error } = await this.supabase.from('profiles').upsert(payload, { onConflict: 'id' });

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      this.logger.error({ dbError: safeDbError(error), userId }, 'Failed to save the avatar URL');
      return { data: null, error: toSafeError(error) };
    }
  }

  /**
   * Clear the profile-picture URL (D-3, Remove). A targeted UPDATE, never an
   * upsert: there is nothing to clear on a missing row, so none is created
   * (count 0 is logged at info and is not an error). `{ count: 'exact' }` and
   * no `.select()` (the PostgREST update + select hazard). Never throws.
   */
  async clearAvatarUrl(userId: string): Promise<RepositoryResult<true>> {
    try {
      const { error, count } = await this.supabase
        .from('profiles')
        .update({ avatar_url: null, updated_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', userId);

      if (error) throw error;
      if (count === 0) {
        this.logger.info({ userId }, 'No profile row to clear the avatar on');
      }
      return { data: true, error: null };
    } catch (error) {
      this.logger.error({ dbError: safeDbError(error), userId }, 'Failed to clear the avatar URL');
      return { data: null, error: toSafeError(error) };
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

  /**
   * ADMIN ONLY (ADMIN_BOS_CLEANUP slice 4, TA-10): display names for the accounts
   * on one admin audit-trail page. Replaces the route's read of a `users` table
   * that does not exist.
   *
   * Runs on the default service-role client (`supabaseServer`), so it
   * intentionally bypasses RLS on `profiles` — admin-only context: it reads
   * every account's name, by design. The boundary is `requireAdmin` on the two
   * callers, `app/api/admin/audit-trail/route.ts` and (Admin Exchange Rates
   * slice 1c.1, SQ-13) `app/api/admin/exchange-rates/route.ts`, plus the caller
   * guard in lib/repositories/__tests__/adminReadMethods.guard.test.ts, which
   * allows calls from `app/api/admin/**` only. Read-only; the ids come from the
   * rows each route already loaded (`audit_trail`, `exchange_rate_history`),
   * never from the request.
   *
   * One `.in('id', …)` per chunk of ADMIN_IDENTITY_CHUNK ids, never one read per
   * row; an empty list makes no query. Accounts without a profile row are simply
   * absent. Names are never logged, only counts. Never throws.
   */
  async findAdminNamesByIds(userIds: readonly string[]): Promise<RepositoryResult<AdminProfileName[]>> {
    try {
      const unique = [...new Set(userIds)];
      const found: AdminProfileName[] = [];
      for (let i = 0; i < unique.length; i += ADMIN_IDENTITY_CHUNK) {
        const chunk = unique.slice(i, i + ADMIN_IDENTITY_CHUNK);
        const { data, error } = await this.supabase
          .from('profiles')
          .select(ADMIN_PROFILE_NAME_COLUMNS)
          .in('id', chunk);
        if (error) throw error;
        found.push(...((data ?? []) as AdminProfileName[]));
      }
      // Counts only: a person's name is never logged.
      this.logger.debug({ requested: unique.length, found: found.length }, 'Admin profile names read');
      return { data: found, error: null };
    } catch (error) {
      this.logger.error({ err: error, requested: userIds.length }, 'Admin profile names read failed');
      return { data: null, error: error as Error };
    }
  }

  /**
   * GDPR export only ("Download my data", Art. 15 / 20: the zip builder's
   * `user_profile` section, lib/business-os/data-export/sections.ts; the JSON
   * route GET /api/user/data-export was retired by DE-9). The caller's
   * profile row, the `profiles` descriptor's export columns only (DE-2:
   * lib/business-os/purge/descriptors.ts PROFILES_EXPORT, where the privacy
   * reasoning now lives). Changing that list changes what the export holds,
   * which is a privacy decision.
   *
   * The columns are resolved INSIDE the try (DE-2 §2.4): a bad descriptor, or a
   * secret column on the deny list, returns `{ data: null, error }` and the
   * export marks the section `failed` (fail closed). It can never break module
   * load for the many routes that import this repository.
   *
   * `.maybeSingle()` (DE-1, SA ruling Q-4): no row is `{ data: null, error: null }`,
   * NOT an error, so the export shows an empty profile section rather than a
   * failed one (FR-E12). A real read error is still returned as an error, and
   * the export marks the section `failed`.
   */
  async findForUserDataExport(userId: string): Promise<RepositoryResult<Record<string, unknown> | null>> {
    try {
      const columns = exportColumnsOf('profiles').join(', ');
      const { data, error } = await this.supabase
        .from('profiles')
        .select(columns)
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      return { data: (data ?? null) as unknown as Record<string, unknown> | null, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to read the profile for the data export');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton instance for convenience (mirrors the rest of lib/repositories).
export const userProfileRepository = new UserProfileRepository();
