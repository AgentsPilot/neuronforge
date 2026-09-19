// lib/repositories/UserSubscriptionRepository.ts
// Repository for `user_subscriptions` — currently only the once-only free-tier grant.
//
// SERVICE ROLE, ON PURPOSE. This repository defaults to `supabaseServer`, which
// bypasses RLS. A user must never be able to write their own `balance`, so the
// grant cannot run under the user's RLS session. The tenant boundary is instead:
//   1. the caller passes the AUTHENTICATED user id (the route takes it from
//      `getUser()`, never from the request body), and every statement is
//      scoped with `.eq('user_id', userId)`;
//   2. every write payload is built here, field by field, from typed arguments.
//      Nothing is spread from caller or DB objects, `id` is never written, and
//      `account_frozen` is written only on a brand-new row (as `false`).
// See docs/workplans/ALLOCATE_FREE_TIER_S6_FIX_WORKPLAN.md §2.4 / §2.8.
//
// Server-only: never import from a 'use client' file.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type {
  AgentRepositoryResult as RepositoryResult,
  FreeTierGrantPatch,
  FreeTierInsertOutcome,
  FreeTierNewRow,
  FreeTierNewRowValues,
  FreeTierUpdateOutcome,
  UserSubscriptionGrantState,
} from './types';

/** Postgres unique_violation. Matched on the code only, never the message (SA RC-2). */
const PG_UNIQUE_VIOLATION = '23505';

const GRANT_STATE_COLUMNS =
  'user_id, balance, total_earned, storage_quota_mb, executions_quota, account_frozen, free_tier_granted_at';

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export class UserSubscriptionRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'UserSubscriptionRepository' });
  }

  /**
   * Read the columns the free-tier grant needs. `data: null` = no row.
   * `maybeSingle()` errors on more than one row, so duplicate rows fail closed.
   */
  async findGrantStateByUserId(
    userId: string
  ): Promise<RepositoryResult<UserSubscriptionGrantState | null>> {
    try {
      const { data, error } = await this.supabase
        .from('user_subscriptions')
        .select(GRANT_STATE_COLUMNS)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as UserSubscriptionGrantState | null) ?? null, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId, method: 'findGrantStateByUserId' }, 'Failed to read grant state');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Plain INSERT (never upsert) of a new row with the free tier already granted.
   * A unique violation on `user_id` means a concurrent grant (or another path)
   * created the row first: it is reported as `conflict`, not as an error.
   */
  async insertFreeTierRow(
    userId: string,
    values: FreeTierNewRowValues
  ): Promise<RepositoryResult<FreeTierInsertOutcome>> {
    const payload: FreeTierNewRow = {
      user_id: userId,
      balance: values.rawTokens,
      total_earned: values.rawTokens,
      storage_quota_mb: values.storageMb,
      storage_used_mb: 0,
      executions_quota: values.executionsQuota,
      executions_used: 0,
      status: 'active',
      free_tier_granted_at: values.grantedAt,
      free_tier_expires_at: values.expiresAt,
      free_tier_initial_amount: values.rawTokens,
      account_frozen: false,
      created_at: values.grantedAt,
      updated_at: values.grantedAt,
    };

    try {
      const { data, error } = await this.supabase
        .from('user_subscriptions')
        .insert(payload)
        .select('user_id');

      if (error) {
        if (errorCode(error) === PG_UNIQUE_VIOLATION) {
          this.logger.debug({ userId, method: 'insertFreeTierRow' }, 'Insert hit unique violation (row already exists)');
          return { data: { inserted: false, conflict: true }, error: null };
        }
        throw error;
      }

      const inserted = Array.isArray(data) && data.length === 1;
      return { data: { inserted, conflict: false }, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId, method: 'insertFreeTierRow' }, 'Failed to insert free-tier row');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Conditional UPDATE that applies the grant to an existing row exactly once.
   *
   * The WHERE clause is what makes it race-safe (Postgres re-evaluates it after
   * waiting for a concurrent writer's row lock):
   *   - `free_tier_granted_at IS NULL` → once only;
   *   - `account_frozen IS NOT TRUE`   → never grants a frozen account (SA RC-1),
   *     including one frozen between our read and this write;
   *   - `balance = expected`           → never overwrites a concurrent spend.
   */
  async applyFreeTierGrant(
    userId: string,
    expectedBalance: number | null,
    patch: FreeTierGrantPatch
  ): Promise<RepositoryResult<FreeTierUpdateOutcome>> {
    // Rebuilt key by key: even if a caller passed a wider object, only these reach the DB.
    const payload: Record<string, string | number | null> = {
      balance: patch.balance,
      total_earned: patch.total_earned,
      storage_quota_mb: patch.storage_quota_mb,
      executions_quota: patch.executions_quota,
      free_tier_granted_at: patch.free_tier_granted_at,
      free_tier_initial_amount: patch.free_tier_initial_amount,
      updated_at: patch.updated_at,
    };
    if (patch.free_tier_expires_at !== undefined) {
      payload.free_tier_expires_at = patch.free_tier_expires_at;
    }

    try {
      let query = this.supabase
        .from('user_subscriptions')
        .update(payload)
        .eq('user_id', userId)
        .is('free_tier_granted_at', null)
        // IS NOT TRUE rather than `= false`, so a row whose flag is NULL is still eligible.
        .not('account_frozen', 'is', true);

      // `.eq('balance', null)` would match nothing; NULL needs IS NULL.
      query = expectedBalance === null ? query.is('balance', null) : query.eq('balance', expectedBalance);

      const { data, error } = await query.select('user_id');
      if (error) throw error;

      const rowCount = Array.isArray(data) ? data.length : 0;
      if (rowCount > 1) {
        // Only possible if user_id is not unique (workplan C1). The rows WERE changed, so
        // this must not read as "no update" (which would retry); surface it as an error (SA F-2).
        throw new Error(`Free-tier grant updated ${rowCount} rows; expected at most 1`);
      }
      return { data: { updated: rowCount === 1 }, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId, method: 'applyFreeTierGrant' }, 'Failed to apply free-tier grant');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton instance for convenience
export const userSubscriptionRepository = new UserSubscriptionRepository();
