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
//     the invoice's Stripe ids (SR-8), never from Stripe metadata. From
//     P-5b.1 (N-2) the same read's `invite_id` also names the invite whose
//     champion is told the friend subscribed; the read is bounded by N-2's
//     clock and is still the only one (SA O-4).
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
// Plan payments P-5b.2 ("who sees the payment"; SA C-7) adds two reads and
// widens one, all select-only:
//   - `findByInviteIdsForAdmin` also selects `source`, `first_paid_at` and
//     `first_payment_ref`, for the admin paid line (`adminInviteOps.ts`, behind
//     `requireAdmin`). The money history is then matched on the account AND
//     that invoice id together (S5-8), never on the ref alone.
//   - `findSubscribedInviteIdsForIssuer` answers, for a champion's OWN list,
//     which of their accepted invites paid. Scoped twice: by
//     `parent_account_id` = the session's account, and to invite ids the
//     issuer-scoped list returned. It returns invite ids only, never a date,
//     an amount or an account (P5-C9). Only caller: `friendInviteOps.ts`.
//   - `findHoldFactsForAccountsForAdmin` is the batched form of
//     `findHoldFactsForAccount` for the shadow report and the launch dry run
//     (P5-C10). Only caller: `lib/business-os/invites/paymentHoldBatch.ts`.
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
  BusinessOsAccountHoldFactsRow,
  BusinessOsAccountLineageLevel,
} from './types';

/** The most invite ids one read accepts (the admin list shows at most 200 rows). */
export const LINEAGE_LOOKUP_LIMIT = 200;

/** P-5b.2: ids that key a scoped read must be well-formed before any query. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

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
        // P-5b.2: + the hold facts and the first payment's invoice id, for the paid line.
        .select('account_id, invite_id, level, parent_account_id, source, first_paid_at, first_payment_ref')
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

  /**
   * CHAMPION (plan payments P-5b.2, FR-31, P5-C9): which of THIS champion's
   * accepted friend invites have paid. INTENTIONAL SERVICE-ROLE READ (RLS
   * bypass; the table has no policy and no `user_id`): the friend-invite route
   * holds a session, but lineage is a platform record.
   *
   * Scoped twice, so no argument can widen it: `parent_account_id` must equal
   * `issuerAccountId` (the account the ROUTE resolved from the session, never a
   * request value), and `invite_id` must be one of `inviteIds` (which came
   * from the issuer-scoped `listForIssuerAccount`). Only friend rows
   * (`source = 'account_invite'`) with the first payment stamped. Returns invite
   * ids ONLY: never a date, an amount or the friend's account id.
   *
   * Only caller: `lib/business-os/invites/friendInviteOps.ts`
   * (`getFriendInviteSummary`), wired in `friendInviteDeps.ts`. Refuses more
   * than `LINEAGE_LOOKUP_LIMIT` ids (the champion list is capped at the same
   * number), and any id that is not a UUID, before a query.
   */
  async findSubscribedInviteIdsForIssuer(issuerAccountId: string, inviteIds: string[]): Promise<RepositoryResult<string[]>> {
    const methodLogger = this.logger.child({ method: 'findSubscribedInviteIdsForIssuer', accountId: issuerAccountId });
    if (!isUuid(issuerAccountId)) {
      return { data: null, error: new Error('findSubscribedInviteIdsForIssuer needs a valid issuer account id') };
    }
    if (inviteIds.length === 0) return { data: [], error: null };
    if (inviteIds.length > LINEAGE_LOOKUP_LIMIT || !inviteIds.every(isUuid)) {
      // Refused, not trimmed: a short answer would read as "not subscribed".
      return { data: null, error: new Error(`findSubscribedInviteIdsForIssuer accepts at most ${LINEAGE_LOOKUP_LIMIT} UUIDs`) };
    }
    try {
      const { data, error } = await this.supabase
        .from('business_os_account_lineage')
        .select('invite_id')
        .eq('parent_account_id', issuerAccountId)
        .eq('source', 'account_invite')
        .in('invite_id', inviteIds)
        .not('first_paid_at', 'is', null);

      if (error) throw error;
      const ids = ((data ?? []) as Array<{ invite_id?: unknown }>)
        .map((row) => row.invite_id)
        .filter((id): id is string => typeof id === 'string');
      return { data: ids, error: null };
    } catch (error) {
      const safe = safeDbError(error);
      methodLogger.error({ dbError: safe }, 'Failed to read which friend invites subscribed');
      const out = new Error(safe.message) as Error & { code?: string };
      if (safe.code) out.code = safe.code;
      return { data: null, error: out };
    }
  }

  /**
   * ADMIN (plan payments P-5b.2, P5-C10): the hold facts of up to
   * `LINEAGE_LOOKUP_LIMIT` accounts in one read, keyed by account. Accounts
   * with no lineage row are simply absent. INTENTIONAL SERVICE-ROLE READ
   * across accounts, by design: the shadow report and the launch dry run walk
   * every plan row, behind `requireAdmin` (each route's first statement).
   *
   * Only caller: `lib/business-os/invites/paymentHoldBatch.ts`, which applies
   * the gate's own predicate (`isAwaitingPayment`) to these rows. Refuses more
   * than the limit, and any id that is not a UUID, before a query.
   */
  async findHoldFactsForAccountsForAdmin(accountIds: string[]): Promise<RepositoryResult<BusinessOsAccountHoldFactsRow[]>> {
    const methodLogger = this.logger.child({ method: 'findHoldFactsForAccountsForAdmin', accounts: accountIds.length });
    if (accountIds.length === 0) return { data: [], error: null };
    if (accountIds.length > LINEAGE_LOOKUP_LIMIT || !accountIds.every(isUuid)) {
      return { data: null, error: new Error(`findHoldFactsForAccountsForAdmin accepts at most ${LINEAGE_LOOKUP_LIMIT} UUIDs`) };
    }
    try {
      const { data, error } = await this.supabase
        .from('business_os_account_lineage')
        .select('account_id, invite_id, source, first_paid_at')
        .in('account_id', accountIds);

      if (error) throw error;
      return { data: (data ?? []) as unknown as BusinessOsAccountHoldFactsRow[], error: null };
    } catch (error) {
      const safe = safeDbError(error);
      methodLogger.error({ dbError: safe }, 'Failed to read the lineage hold facts in batch');
      const out = new Error(safe.message) as Error & { code?: string };
      if (safe.code) out.code = safe.code;
      return { data: null, error: out };
    }
  }
}

export const businessOsAccountLineageRepository = new BusinessOsAccountLineageRepository();
