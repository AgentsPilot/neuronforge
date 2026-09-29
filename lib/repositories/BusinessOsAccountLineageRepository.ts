// lib/repositories/BusinessOsAccountLineageRepository.ts
// Read access to `business_os_account_lineage` (invite-only signup, Slice 1b;
// requirement §6, L-6).
//
// INTENTIONAL SERVICE-ROLE CLIENT (RLS bypass). Lineage rows are PLATFORM
// RECORDS about who invited whom: the table has no `user_id` column, RLS is on
// with no policy, and `anon` / `authenticated` hold no privilege (migration
// 20261014). It is read UNSCOPED by design, by platform admins only, behind
// `requireAdmin` (the admin Signup Invites list).
//
// There is deliberately NO write method. The one writer is the SQL function
// `business_os_finalise_invite_redemption`, which inserts the row in the same
// transaction as the redemption and the plan row, reached through the plan
// repository's `provisionFromInvite`.
//
// Methods never throw: they return `{ data, error }`, with a database error
// reduced to `{ code, message }` before it is logged or returned (M-1).

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import { safeDbError } from './BusinessOsInviteRepository';
import type { AgentRepositoryResult as RepositoryResult, BusinessOsAccountLineageLevel } from './types';

/** The most invite ids one read accepts (the admin list shows at most 200 rows). */
export const LINEAGE_LOOKUP_LIMIT = 200;

export class BusinessOsAccountLineageRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsAccountLineageRepository' });
  }

  /**
   * ADMIN: the lineage level of each account created from these invites.
   * Invites with no lineage row (not redeemed) are simply absent.
   */
  async findByInviteIdsForAdmin(inviteIds: string[]): Promise<RepositoryResult<BusinessOsAccountLineageLevel[]>> {
    const methodLogger = this.logger.child({ method: 'findByInviteIdsForAdmin' });
    if (inviteIds.length === 0) return { data: [], error: null };
    if (inviteIds.length > LINEAGE_LOOKUP_LIMIT) {
      // Refused, not truncated: a silently short answer would read as "not redeemed".
      return { data: null, error: new Error(`findByInviteIdsForAdmin accepts at most ${LINEAGE_LOOKUP_LIMIT} ids`) };
    }
    try {
      const { data, error } = await this.supabase
        .from('business_os_account_lineage')
        .select('account_id, invite_id, level')
        .in('invite_id', inviteIds);

      if (error) throw error;
      return { data: (data ?? []) as unknown as BusinessOsAccountLineageLevel[], error: null };
    } catch (error) {
      const safe = safeDbError(error);
      methodLogger.error({ dbError: safe }, 'Failed to read lineage levels');
      const out = new Error(safe.message) as Error & { code?: string };
      if (safe.code) out.code = safe.code;
      return { data: null, error: out };
    }
  }
}

export const businessOsAccountLineageRepository = new BusinessOsAccountLineageRepository();
