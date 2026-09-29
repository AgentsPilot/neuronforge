// lib/repositories/BusinessOsInviteRepository.ts
// Access to `business_os_invites` (Business OS invite-only signup, Slice 0).
//
// INTENTIONAL SERVICE-ROLE CLIENT (RLS bypass), condition C-13.
// Invites are PLATFORM RECORDS, not tenant data: the table has no `user_id`
// column, RLS is on with no policy, and `anon` / `authenticated` hold no
// privilege at all (migration 20261012). Only the service role can reach it,
// and it is reached UNSCOPED by design, by exactly two kinds of caller:
//
//   1. Platform admins, through `app/api/admin/business-os/invites/**`, behind
//      `requireAdmin`. Every method they use ends in `ForAdmin`, so "any invite"
//      is reached by calling a differently named method, never by leaving an
//      argument out (the `ArchiveRepository` / `TokenUsageRepository`
//      precedent).
//   2. The public invite page, through `app/api/public/invites/validate`, which
//      holds no identity at all. It reaches ONE row, by the SHA-256 of a token
//      the visitor presented (`findByTokenHashForPublicView`), and may stamp
//      that row's first view (`markFirstViewed`). Its select is a narrow column
//      list with no email, issuer, reason or hash. Slice 1a adds two methods
//      keyed by the id of THAT matched row, never by a caller-supplied value:
//      `findInviteeEmailForPublicCheck` (the invitee email, read only so the
//      server can ask whether it already has an account, and never returned to
//      the visitor) and `markOpenedByExistingAccount` (FR-8a).
//   3. The public SIGNUP routes (Slice 1b), which hold no identity either.
//      They reach ONE row by token hash (`findByTokenHashForRedemption`) and
//      then change it only through compare-and-swap methods keyed by that
//      row's id and a value observed on it: the send count, the attempt count,
//      the live code hash, the claimant. A lost race changes nothing and the
//      route answers "try again" (workplan D-4, R-1, D-dev-1).
//
// FUTURE: champion-issued invites (requirement §14) must get their OWN methods,
// scoped by `issuer_account_id` (for example `listForIssuerAccount`,
// `revokeForIssuerAccount`). They must never reuse the `ForAdmin` methods,
// which would hand one champion every invite on the platform.
//
// `token_hash` is written once, by `createForAdmin`, and never selected by any
// method. No method logs a token, a hash or an email.
//
// Methods never throw: they return `{ data, error }`. A database error is
// reduced to `{ code, message }` before it is logged or returned (`safeDbError`),
// because a PostgrestError's `details` can hold the token hash and the email.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type {
  AgentRepositoryResult as RepositoryResult,
  BusinessOsInvite,
  BusinessOsInvitePublicView,
  BusinessOsInviteRedemptionView,
  ClaimInviteForSignupInput,
  CountSignupCodeAttemptInput,
  CreateBusinessOsInviteInput,
  IssueSignupCodeInput,
  RecordRedemptionFailureInput,
  RevokeBusinessOsInviteInput,
} from './types';

const INVITES = 'business_os_invites';

/** Every column the admin surface reads. Named, never `*`, and never `token_hash`. */
export const BUSINESS_OS_INVITE_ADMIN_COLUMNS =
  'id, email, email_locked, invite_type, grant_kind, grant_id, access_open_ended, access_months, ' +
  'issuer_kind, issuer_admin_id, issuer_account_id, inviter_display_name, language, personal_note, ' +
  'internal_reason, link_expiry_days, link_expires_at, first_viewed_at, revoked_at, revoked_by_admin_id, ' +
  'revoke_reason, redeemed_at, redeemed_account_id, opened_by_existing_account_at, claimed_at, claimed_account_id, ' +
  'redemption_failed_at, redemption_failed_step, redemption_error_code, redemption_error_message, ' +
  'redemption_failed_account_id, created_at, updated_at';

/**
 * What the signup routes read (Slice 1b). The email is here because the account
 * is created for exactly that address; the routes never return it before
 * mailbox proof. Never `token_hash`.
 */
export const BUSINESS_OS_INVITE_REDEMPTION_COLUMNS =
  'id, email, invite_type, issuer_kind, grant_kind, grant_id, access_open_ended, access_months, language, ' +
  'link_expires_at, revoked_at, redeemed_at, signup_code_hash, signup_code_expires_at, signup_code_attempts, ' +
  'signup_code_sent_count, signup_code_window_started_at, signup_code_last_sent_at, claimed_at, claimed_account_id';

/** A PostgREST `or` filter: no claim, or a claim older than the lease (I-2, I-6). */
function noLiveClaim(cutoff: Date): string {
  return `claimed_at.is.null,claimed_at.lt."${cutoff.toISOString()}"`;
}

/** What the public page's lookup reads (C-4): no email, no issuer, no reasons, no hash. */
export const BUSINESS_OS_INVITE_PUBLIC_COLUMNS =
  'id, grant_kind, grant_id, access_open_ended, access_months, inviter_display_name, language, ' +
  'personal_note, link_expires_at, first_viewed_at, revoked_at, redeemed_at';

/** The admin list shows at most this many invites, newest first. */
export const BUSINESS_OS_INVITE_LIST_LIMIT = 200;

export class BusinessOsInviteRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsInviteRepository' });
  }

  // ============ Admin (behind requireAdmin) ============

  /**
   * ADMIN: create one admin-issued invite.
   *
   * The insert is built field by field from the allow-list; nothing is spread,
   * so a property that is not in `CreateBusinessOsInviteInput` cannot reach the
   * row even if a caller passes one. `issuer_kind` is fixed to `admin` here.
   */
  async createForAdmin(input: CreateBusinessOsInviteInput): Promise<RepositoryResult<BusinessOsInvite>> {
    const methodLogger = this.logger.child({ method: 'createForAdmin', adminId: input.issuer_admin_id });
    try {
      const { data, error } = await this.supabase
        .from(INVITES)
        .insert({
          token_hash: input.token_hash,
          email: input.email,
          invite_type: input.invite_type,
          grant_kind: input.grant_kind,
          grant_id: input.grant_id,
          access_open_ended: input.access_open_ended,
          access_months: input.access_months,
          issuer_kind: 'admin',
          issuer_admin_id: input.issuer_admin_id,
          issuer_account_id: null,
          inviter_display_name: input.inviter_display_name,
          language: input.language,
          personal_note: input.personal_note,
          internal_reason: input.internal_reason,
          link_expiry_days: input.link_expiry_days,
          link_expires_at: input.link_expires_at,
        })
        .select(BUSINESS_OS_INVITE_ADMIN_COLUMNS)
        .single();

      if (error) throw error;
      const row = data as unknown as BusinessOsInvite;
      methodLogger.info({ inviteId: row.id }, 'Invite created');
      return { data: row, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to create invite');
      return { data: null, error: toError(error) };
    }
  }

  /** ADMIN: the newest invites, across every issuer. */
  async listRecentForAdmin(options: { limit?: number } = {}): Promise<RepositoryResult<BusinessOsInvite[]>> {
    const methodLogger = this.logger.child({ method: 'listRecentForAdmin' });
    const requested = Math.trunc(options.limit ?? BUSINESS_OS_INVITE_LIST_LIMIT) || 1;
    const limit = Math.min(Math.max(requested, 1), BUSINESS_OS_INVITE_LIST_LIMIT);
    try {
      const { data, error } = await this.supabase
        .from(INVITES)
        .select(BUSINESS_OS_INVITE_ADMIN_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data: (data ?? []) as unknown as BusinessOsInvite[], error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to list invites');
      return { data: null, error: toError(error) };
    }
  }

  /** ADMIN: one invite by id, or `null` when there is none. */
  async findByIdForAdmin(id: string): Promise<RepositoryResult<BusinessOsInvite>> {
    const methodLogger = this.logger.child({ method: 'findByIdForAdmin', inviteId: id });
    try {
      const { data, error } = await this.supabase
        .from(INVITES)
        .select(BUSINESS_OS_INVITE_ADMIN_COLUMNS)
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      return { data: (data ?? null) as unknown as BusinessOsInvite | null, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to read invite');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * ADMIN: revoke an invite that is neither accepted nor already revoked.
   *
   * One conditional UPDATE, so a revoke racing a redemption (Slice 1) cannot
   * both win. `data` is `null` when no row matched; the caller tells "no such
   * invite" from "cannot be revoked" with `findByIdForAdmin`.
   *
   * Slice 1b (I-2): a LIVE signup claim (made after `claimLeaseCutoff`) also
   * blocks the revoke. Once a signup has claimed the invite, the claim is the
   * decision point; a revoke in the milliseconds before the account is created
   * would otherwise leave an account its invite no longer points at.
   */
  async revokeForAdmin(input: RevokeBusinessOsInviteInput): Promise<RepositoryResult<BusinessOsInvite>> {
    const methodLogger = this.logger.child({ method: 'revokeForAdmin', inviteId: input.id, adminId: input.adminId });
    const at = input.now.toISOString();
    try {
      const { data, error } = await this.supabase
        .from(INVITES)
        .update({
          revoked_at: at,
          revoked_by_admin_id: input.adminId,
          revoke_reason: input.reason,
          updated_at: at,
        })
        .eq('id', input.id)
        .is('redeemed_at', null)
        .is('revoked_at', null)
        .or(noLiveClaim(input.claimLeaseCutoff))
        .select(BUSINESS_OS_INVITE_ADMIN_COLUMNS)
        .maybeSingle();

      if (error) throw error;
      if (data) methodLogger.info('Invite revoked');
      return { data: (data ?? null) as unknown as BusinessOsInvite | null, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to revoke invite');
      return { data: null, error: toError(error) };
    }
  }

  // ============ Public page (no identity; by token hash only) ============

  /**
   * PUBLIC: the one invite whose token hashes to `tokenHash`, or `null`.
   *
   * Unscoped by design: the visitor has no account, and holding the token IS
   * the authorisation. The hash is compared by an indexed equality, and neither
   * it nor the token is logged.
   */
  async findByTokenHashForPublicView(tokenHash: string): Promise<RepositoryResult<BusinessOsInvitePublicView>> {
    const methodLogger = this.logger.child({ method: 'findByTokenHashForPublicView' });
    try {
      const { data, error } = await this.supabase
        .from(INVITES)
        .select(BUSINESS_OS_INVITE_PUBLIC_COLUMNS)
        .eq('token_hash', tokenHash)
        .maybeSingle();

      if (error) throw error;
      return { data: (data ?? null) as unknown as BusinessOsInvitePublicView | null, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to look up invite by token');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * PUBLIC: the invitee email of the invite the visitor's token already matched
   * (Slice 1a, FR-8a, L-3), or `null` when there is no such row.
   *
   * Kept out of `findByTokenHashForPublicView` on purpose (workplan D-12): the
   * row the public response is built from never holds the email, so no future
   * edit of that response's allow-list can leak it. The only use of the value
   * is the server-side "does this email already have an account?" question.
   * Never logged.
   */
  async findInviteeEmailForPublicCheck(id: string): Promise<RepositoryResult<string>> {
    const methodLogger = this.logger.child({ method: 'findInviteeEmailForPublicCheck', inviteId: id });
    try {
      const { data, error } = await this.supabase.from(INVITES).select('email').eq('id', id).maybeSingle();

      if (error) throw error;
      const email = (data as { email?: unknown } | null)?.email;
      return { data: typeof email === 'string' ? email : null, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to read the invitee email');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * PUBLIC: stamp that the invited email already had an account when the
   * invite was opened (FR-8a, requirement §4.1 delivery facts). Conditional on
   * the stamp being empty, so a reload never moves it.
   *
   * `data` is `true` only when THIS call set the stamp, so the caller can write
   * the audit entry once rather than on every reload (workplan D-13).
   */
  async markOpenedByExistingAccount(id: string, now: Date): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'markOpenedByExistingAccount', inviteId: id });
    const at = now.toISOString();
    try {
      const { data, error } = await this.supabase
        .from(INVITES)
        .update({ opened_by_existing_account_at: at, updated_at: at })
        .eq('id', id)
        .is('opened_by_existing_account_at', null)
        .select('id');

      if (error) throw error;
      return { data: Array.isArray(data) && data.length > 0, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to record an open by an existing account');
      return { data: null, error: toError(error) };
    }
  }

  // ============ Public signup (Slice 1b; no identity; by token hash, then CAS) ============

  /**
   * SIGNUP: the one invite whose token hashes to `tokenHash`, with the email and
   * the code/claim counters, or `null`. Never logged: not the hash, not the email.
   */
  async findByTokenHashForRedemption(tokenHash: string): Promise<RepositoryResult<BusinessOsInviteRedemptionView>> {
    const methodLogger = this.logger.child({ method: 'findByTokenHashForRedemption' });
    try {
      const { data, error } = await this.supabase
        .from(INVITES)
        .select(BUSINESS_OS_INVITE_REDEMPTION_COLUMNS)
        .eq('token_hash', tokenHash)
        .maybeSingle();

      if (error) throw error;
      return { data: (data ?? null) as unknown as BusinessOsInviteRedemptionView | null, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to look up invite for signup');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * SIGNUP: store a freshly issued code, resetting the attempt count. `true`
   * only when this call wrote it.
   *
   * A compare-and-swap on BOTH the send count and the last-sent time observed
   * with the row (SA MF-2): at a 24 h rollover every parallel request computes
   * the same reset count, so the count alone would let all of them win. The
   * last-sent time changes on every write, so exactly one does. Also only on a
   * pending, unexpired invite with no live claim.
   */
  async issueSignupCode(input: IssueSignupCodeInput): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'issueSignupCode', inviteId: input.id });
    const at = input.now.toISOString();
    try {
      const query = this.supabase
        .from(INVITES)
        .update({
          signup_code_hash: input.codeHash,
          signup_code_expires_at: input.expiresAt.toISOString(),
          signup_code_attempts: 0,
          signup_code_sent_count: input.sentCount,
          signup_code_window_started_at: input.windowStartedAt.toISOString(),
          signup_code_last_sent_at: at,
          updated_at: at,
        })
        .eq('id', input.id)
        .eq('signup_code_sent_count', input.observedSentCount)
        .is('redeemed_at', null)
        .is('revoked_at', null)
        .gt('link_expires_at', at)
        .or(noLiveClaim(input.claimLeaseCutoff));

      const { data, error } = await (input.observedLastSentAt === null
        ? query.is('signup_code_last_sent_at', null)
        : query.eq('signup_code_last_sent_at', input.observedLastSentAt)
      ).select('id');

      if (error) throw error;
      return { data: Array.isArray(data) && data.length > 0, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to store a signup code');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * SIGNUP: count one attempt against the live code, BEFORE it is compared
   * (workplan D-5). A CAS on the observed attempt count AND the code hash, so
   * five parallel guesses cannot all count as the first, and an attempt cannot
   * be counted against a code that has since been replaced.
   */
  async countSignupCodeAttempt(input: CountSignupCodeAttemptInput): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'countSignupCodeAttempt', inviteId: input.id });
    try {
      const { data, error } = await this.supabase
        .from(INVITES)
        .update({ signup_code_attempts: input.observedAttempts + 1, updated_at: input.now.toISOString() })
        .eq('id', input.id)
        .eq('signup_code_attempts', input.observedAttempts)
        .eq('signup_code_hash', input.codeHash)
        .select('id');

      if (error) throw error;
      return { data: Array.isArray(data) && data.length > 0, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to count a signup code attempt');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * SIGNUP: clear the matched code and claim the invite for a server-generated
   * account id, in ONE compare-and-swap (R-1). Conditional on: the same code
   * hash, still pending (not redeemed, not revoked, not expired), no LIVE claim,
   * and the claimant being the one observed with the row (D-dev-1): `null` for a
   * first claim, the stale claimant when a lapsed claim is re-taken (I-6).
   */
  async claimForSignup(input: ClaimInviteForSignupInput): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'claimForSignup', inviteId: input.id });
    const at = input.now.toISOString();
    try {
      let query = this.supabase
        .from(INVITES)
        .update({
          signup_code_hash: null,
          signup_code_expires_at: null,
          claimed_at: at,
          claimed_account_id: input.accountId,
          updated_at: at,
        })
        .eq('id', input.id)
        .eq('signup_code_hash', input.codeHash)
        .is('redeemed_at', null)
        .is('revoked_at', null)
        .gt('link_expires_at', at)
        .or(noLiveClaim(input.claimLeaseCutoff));

      query =
        input.observedClaimedAccountId === null
          ? query.is('claimed_account_id', null)
          : query.eq('claimed_account_id', input.observedClaimedAccountId);

      const { data, error } = await query.select('id');

      if (error) throw error;
      return { data: Array.isArray(data) && data.length > 0, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to claim an invite for signup');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * SIGNUP: release a claim, only after a POSITIVE "no such user" (I-4,
   * D-dev-2). A CAS on the same claimant on an unredeemed invite, so it can
   * never release someone else's claim or a finished redemption. A failed
   * release is harmless: no account exists, and the claim lapses after the
   * lease.
   */
  async releaseSignupClaim(id: string, accountId: string, now: Date): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'releaseSignupClaim', inviteId: id });
    try {
      const { data, error } = await this.supabase
        .from(INVITES)
        .update({ claimed_at: null, claimed_account_id: null, updated_at: now.toISOString() })
        .eq('id', id)
        .eq('claimed_account_id', accountId)
        .is('redeemed_at', null)
        .select('id');

      if (error) throw error;
      return { data: Array.isArray(data) && data.length > 0, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to release a signup claim');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * SIGNUP: the FR-12a record of a signup that stopped with its claim KEPT
   * (SA D-2). Keyed on the invite id and the claimant; the last failure wins;
   * never cleared. The caller passes values already scrubbed (no email).
   */
  async recordRedemptionFailure(input: RecordRedemptionFailureInput): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'recordRedemptionFailure', inviteId: input.id });
    const at = input.now.toISOString();
    try {
      const { data, error } = await this.supabase
        .from(INVITES)
        .update({
          redemption_failed_at: at,
          redemption_failed_step: input.step,
          redemption_error_code: input.errorCode,
          redemption_error_message: input.errorMessage,
          redemption_failed_account_id: input.failedAccountId,
          updated_at: at,
        })
        .eq('id', input.id)
        .eq('claimed_account_id', input.claimedAccountId)
        .select('id');

      if (error) throw error;
      return { data: Array.isArray(data) && data.length > 0, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to record a stopped signup');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * PUBLIC: stamp the first successful view (FR-10). Conditional on
   * `first_viewed_at IS NULL`, so a reload never moves it.
   */
  async markFirstViewed(id: string, now: Date): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'markFirstViewed', inviteId: id });
    const at = now.toISOString();
    try {
      const { error } = await this.supabase
        .from(INVITES)
        .update({ first_viewed_at: at, updated_at: at })
        .eq('id', id)
        .is('first_viewed_at', null);

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to record first view');
      return { data: null, error: toError(error) };
    }
  }
}

/**
 * The only part of a database error this repository ever logs or returns
 * (C-3, SA M-1).
 *
 * A `PostgrestError` carries `details` and `hint`, and on this table those are
 * row values: a CHECK violation says "Failing row contains (<id>, <token_hash>,
 * <email>, …)" and a unique violation says "Key (token_hash)=(…)". Pino's error
 * serializer emits every own field, and neither `details` nor `token_hash` is
 * on the redaction list. So neither the raw error nor its `details` / `hint`
 * ever leaves this file: only the SQLSTATE code and the message, which names
 * the constraint but carries no value.
 */
export interface SafeDbError {
  code: string | null;
  message: string;
}

export function safeDbError(error: unknown): SafeDbError {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return {
    code: typeof record.code === 'string' ? record.code : null,
    message: typeof record.message === 'string' ? record.message : 'Unknown database error',
  };
}

/**
 * A fresh `Error` built from the safe projection only, so a caller that logs
 * `{ err }` cannot reintroduce `details`. The SQLSTATE code is kept on `code`.
 */
function toError(error: unknown): Error {
  const safe = safeDbError(error);
  const out = new Error(safe.message) as Error & { code?: string };
  if (safe.code) out.code = safe.code;
  return out;
}

export const businessOsInviteRepository = new BusinessOsInviteRepository();
