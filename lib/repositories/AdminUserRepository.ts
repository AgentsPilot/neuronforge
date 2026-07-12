// lib/repositories/AdminUserRepository.ts
// Data-access layer for the `admin_users` table — the authoritative allow-list of
// platform admins/operators.
//
// Security model (why this table exists):
//   `profiles.role` is user-writable (the profile settings UI offers "Administrator"
//   and /api/user/profile PUT writes role from the request body) and is overloaded
//   with onboarding personas, so it CANNOT be an admin security boundary. `admin_users`
//   is service-role write only (see the migration's RLS) and is the single source of
//   truth. This repository therefore uses `supabaseServer` (service role) by design —
//   this is an intentional RLS bypass for an admin-only, cross-tenant surface.
//
// This repository is read-mostly. The only writes are bootstrap/management operations
// (seeding from the ADMIN_EMAILS env allow-list, binding a user_id once an admin signs
// up, and soft-revoking). It never accepts client-supplied data on the hot path.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/**
 * A row in the `admin_users` allow-list.
 */
export interface AdminUser {
  id: string;
  user_id: string | null;   // null until the admin has an auth account, then bound
  email: string;            // lowercased; the stable seed key
  granted_by: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Input for upserting an admin by email (used by env seeding + admin management).
 */
export interface UpsertAdminInput {
  email: string;
  userId?: string | null;
  grantedBy?: string | null;
  notes?: string | null;
}

const ADMIN_COLUMNS = 'id, user_id, email, granted_by, notes, is_active, created_at, updated_at';

/** Normalize an email to the stored form (trimmed + lowercased). */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class AdminUserRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service-role client by design — see the security note at the top of the file.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AdminUserRepository' });
  }

  /**
   * Find the active admin row bound to an auth user id. Returns
   * `{ data: null, error: null }` when the user is not an admin (not an error).
   */
  async findByUserId(userId: string): Promise<RepositoryResult<AdminUser>> {
    try {
      const { data, error } = await this.supabase
        .from('admin_users')
        .select(ADMIN_COLUMNS)
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as AdminUser | null) ?? null, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to find admin by user id');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find the active admin row for an email (case-insensitive). Returns
   * `{ data: null, error: null }` when there is no such admin (not an error).
   */
  async findByEmail(email: string): Promise<RepositoryResult<AdminUser>> {
    try {
      const { data, error } = await this.supabase
        .from('admin_users')
        .select(ADMIN_COLUMNS)
        .eq('email', normalizeEmail(email))
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as AdminUser | null) ?? null, error: null };
    } catch (error) {
      this.logger.error({ err: error, email }, 'Failed to find admin by email');
      return { data: null, error: error as Error };
    }
  }

  /**
   * List all active admins. Used by the authz gate (checked against a cached set)
   * and by notification recipient resolution (list admins to email).
   */
  async listActive(): Promise<RepositoryResult<AdminUser[]>> {
    try {
      const { data, error } = await this.supabase
        .from('admin_users')
        .select(ADMIN_COLUMNS)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return { data: (data as AdminUser[]) ?? [], error: null };
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to list active admins');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Insert or update an admin by email. Idempotent on `email` (the natural key) —
   * safe to run repeatedly from the env-seed script. Re-activates a soft-revoked row.
   */
  async upsertByEmail(input: UpsertAdminInput): Promise<RepositoryResult<AdminUser>> {
    try {
      const email = normalizeEmail(input.email);
      const { data, error } = await this.supabase
        .from('admin_users')
        .upsert(
          {
            email,
            user_id: input.userId ?? null,
            granted_by: input.grantedBy ?? null,
            notes: input.notes ?? null,
            is_active: true,
          },
          { onConflict: 'email' }
        )
        .select(ADMIN_COLUMNS)
        .single();

      if (error) throw error;
      this.logger.info({ email, userId: input.userId ?? null }, 'Admin upserted');
      return { data: data as AdminUser, error: null };
    } catch (error) {
      this.logger.error({ err: error, email: input.email }, 'Failed to upsert admin');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Bind an auth user id to an existing admin row (matched by email). Used to
   * self-heal a row that was seeded by email before the admin had an account.
   */
  async bindUserId(email: string, userId: string): Promise<RepositoryResult<AdminUser>> {
    try {
      const { data, error } = await this.supabase
        .from('admin_users')
        .update({ user_id: userId })
        .eq('email', normalizeEmail(email))
        .select(ADMIN_COLUMNS)
        .single();

      if (error) throw error;
      this.logger.info({ email: normalizeEmail(email), userId }, 'Admin user_id bound');
      return { data: data as AdminUser, error: null };
    } catch (error) {
      this.logger.error({ err: error, email, userId }, 'Failed to bind admin user id');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Soft-revoke an admin by email (sets is_active = false; keeps the audit row).
   */
  async deactivateByEmail(email: string): Promise<RepositoryResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('admin_users')
        .update({ is_active: false })
        .eq('email', normalizeEmail(email));

      if (error) throw error;
      this.logger.info({ email: normalizeEmail(email) }, 'Admin deactivated');
      return { data: true, error: null };
    } catch (error) {
      this.logger.error({ err: error, email }, 'Failed to deactivate admin');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton instance for convenience (mirrors the rest of lib/repositories).
export const adminUserRepository = new AdminUserRepository();
