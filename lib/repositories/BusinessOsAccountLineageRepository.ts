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
// Slice 5b adds ONE account-scoped read, for the payment hold (T-13 layer 2):
// `findHoldFactsForAccount(accountId)` reads ONE account's own row by primary
// key, and selects nothing about the parent or the tree. It has two kinds of
// caller, and neither takes the id from a request:
//   - the hold readers, with the id resolved from the session
//     (`getUser()` → `resolveAccountId`);
//   - plan payments P-5a.1 (SA W-5): the webhook apply
//     (`lib/business-os/billing/planPaymentApply.ts`, wired in
//     `planBillingHandler.ts`), right after the apply function reported that
//     it stamped the first payment, to name the lineage `source` in the audit
//     entry. There the id is the account resolved from OUR billing record by
//     the invoice's Stripe ids (SR-8), never from Stripe metadata.
//
// There is deliberately NO write method. The first payment stamp
// (`first_paid_at`, `first_payment_ref`) is written only inside the SQL
// function `business_os_apply_plan_payment` (migration 20261028), and a source
// guard (`lib/business-os/billing/__tests__/firstPaymentStamp.guard.test.ts`)
// keeps every TypeScript writer out (P5-C4). The writers are the SQL functions
// `business_os_finalise_invite_redemption` (champions, L1) and, from Slice 5b,
// `business_os_finalise_friend_invite_redemption` (friends, L2+), each inserting
// the row in the same transaction as the redemption and the plan row, reached
// through the plan repository's `provisionFromInvite` / `provisionFromFriendInvite`.
//
// Methods never throw: they return `{ data, error }`, with a database error
// reduced to `{ code, message }` before it is logged or returned (M-1).

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import { safeDbError } from './BusinessOsInviteRepository';
import type {
  AgentRepositoryResult as RepositoryResult,
  BusinessOsAccountHoldFacts,
  BusinessOsAccountLineageLevel,
} from './types';

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
   * ADMIN: the lineage level of each account created from these invites, and
   * (Slice 5b, FR-36) the account it was invited under. Invites with no
   * lineage row (not redeemed) are simply absent. The parent is read from
   * lineage, never inferred from the invite's issuer.
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
        .select('account_id, invite_id, level, parent_account_id')
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

  /**
   * HOLD (Slice 5b, T-13 layer 2): ONE account's own lineage facts, or `null`
   * when it has no row (every account created before invites, and every
   * organic one). `accountId` is resolved by the caller and is never a request
   * value: the session's for the hold readers, and for the webhook apply
   * (P-5a.1, SA W-5) the account resolved from our billing record (SR-8).
   */
  async findHoldFactsForAccount(accountId: string): Promise<RepositoryResult<BusinessOsAccountHoldFacts>> {
    const methodLogger = this.logger.child({ method: 'findHoldFactsForAccount', accountId });
    try {
      const { data, error } = await this.supabase
        .from('business_os_account_lineage')
        .select('invite_id, source, first_paid_at')
        .eq('account_id', accountId)
        .maybeSingle();

      if (error) throw error;
      return { data: (data ?? null) as unknown as BusinessOsAccountHoldFacts | null, error: null };
    } catch (error) {
      const safe = safeDbError(error);
      methodLogger.error({ dbError: safe }, 'Failed to read the lineage hold facts');
      const out = new Error(safe.message) as Error & { code?: string };
      if (safe.code) out.code = safe.code;
      return { data: null, error: out };
    }
  }
}

export const businessOsAccountLineageRepository = new BusinessOsAccountLineageRepository();
