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
}

// Singleton instance for convenience (mirrors the rest of lib/repositories).
export const userProfileRepository = new UserProfileRepository();
