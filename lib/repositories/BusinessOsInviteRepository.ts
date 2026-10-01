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
//      route answers "try again" (workplan D-4, R-1, D-dev-1). Slice 3b adds
//      `claimForGoogleSignup`, the same claim for a mailbox proven by a
//      verified Google ID token; both claims share one builder.
//
//   4. A CHAMPION account (Slice 5a, SA C-13, T-20), through
//      `app/api/business-os/friend-invites/**`, signed in with `getUser()`. Its
//      three methods end in `ForIssuerAccount` and are scoped by the
//      `issuer_account_id` the ROUTE resolved from the session, never by a
//      value from the request: `createForIssuerAccount` (the atomic SQL send
//      function, T-17), `listForIssuerAccount` (a narrow column list, F5a-9)
//      and `revokeForIssuerAccount` (ownership INSIDE the UPDATE, F5a-8). They
//      never reuse a `ForAdmin` method, which would hand one champion every
//      invite on the platform. Slice 5b adds `findRedeemedForIssuerAccount`,
//      a read with the same two issuer filters, so a revoke of an accepted
//      invite can answer "already used" (409) without widening the 404.
//   5. The PAYMENT HOLD (Slice 5b, T-13 layer 2), for the signed-in account
//      itself. `findHoldFactsById` reads two facts (`grant_kind`, `language`)
//      of the ONE invite named by that account's own lineage row, which the
//      caller read with the session's account id. Never a caller-supplied id.
//
// `token_hash` is written once per invite, by `createForAdmin` or (Slice 5a)
// by the SQL send function behind `createForIssuerAccount`, and never selected
// by any method. `recordInviteEmailOutcome` (Slice 2a) FILTERS on it, so an outcome
// lands only on the link that was emailed. No method logs a token, a hash or an
// email.
//
// Slice 2a: `inviter_reply_to` (an admin's own email) is written at creation
// and read by no select here; `email_problem_detail` is written by the outcome
// record and read by no select either. Both are for investigation in the SQL
// editor, never for a screen.
//
// Methods never throw: they return `{ data, error }`. A database error is
// reduced to `{ code, message }` before it is logged or returned (`safeDbError`),
// because a PostgrestError's `details` can hold the token hash and the email.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type {
  AgentRepositoryResult as RepositoryResult,
  BusinessOsFriendInviteListRow,
  BusinessOsInvite,
  BusinessOsInviteHoldFacts,
  BusinessOsInvitePublicView,
  BusinessOsInviteRedemptionView,
  ClaimInviteForGoogleSignupInput,
  ClaimInviteForSignupInput,
  CountSignupCodeAttemptInput,
  CreateBusinessOsInviteInput,
  CreateFriendInviteInput,
  CreateFriendInviteResult,
  IssueSignupCodeInput,
  RecordInviteEmailOutcomeInput,
  RecordRedemptionFailureInput,
  RevokeBusinessOsInviteInput,
  RevokeFriendInviteInput,
} from './types';

const INVITES = 'business_os_invites';

/** Every column the admin surface reads. Named, never `*`, and never `token_hash`. */
export const BUSINESS_OS_INVITE_ADMIN_COLUMNS =
  'id, email, email_locked, invite_type, grant_kind, grant_id, access_open_ended, access_months, ' +
  'issuer_kind, issuer_admin_id, issuer_account_id, inviter_display_name, language, personal_note, ' +
  'internal_reason, link_expiry_days, link_expires_at, first_viewed_at, revoked_at, revoked_by_admin_id, ' +
  'revoke_reason, redeemed_at, redeemed_account_id, opened_by_existing_account_at, claimed_at, claimed_account_id, ' +
  'redemption_failed_at, redemption_failed_step, redemption_error_code, redemption_error_message, ' +
  'redemption_failed_account_id, email_attempted_at, email_sent_at, email_provider_message_id, email_problem, ' +
  'email_problem_at, created_at, updated_at';

/**
 * What the signup routes read (Slice 1b). The email is here because the account
 * is created for exactly that address; the routes never return it before
 * mailbox proof. Never `token_hash`.
 */
export const BUSINESS_OS_INVITE_REDEMPTION_COLUMNS =
  'id, email, invite_type, issuer_kind, issuer_account_id, grant_kind, grant_id, access_open_ended, access_months, language, ' +
  'link_expires_at, revoked_at, redeemed_at, signup_code_hash, signup_code_expires_at, signup_code_attempts, ' +
  'signup_code_sent_count, signup_code_window_started_at, signup_code_last_sent_at, claimed_at, claimed_account_id';

/** A PostgREST `or` filter: no claim, or a claim older than the lease (I-2, I-6). */
function noLiveClaim(cutoff: Date): string {
  return `claimed_at.is.null,claimed_at.lt."${cutoff.toISOString()}"`;
}

/**
 * The outcome of a single-row compare-and-swap UPDATE that asked for
 * `{ count: 'exact' }` instead of the changed rows.
 *
 * WHY NOT `.select('id')`: on production PostgREST, an UPDATE that combines an
 * `.or(...)` filter with `return=representation` fails with 42703 "column
 * <table>.<col> does not exist" whenever the `.or` column is not also in the
 * select list (proven live 2026-09-29; `revokeForAdmin` only works because its
 * select happens to list `claimed_at`). The count comes back in the
 * `Content-Range` header and needs no representation, so it is immune.
 * `mutationOrSelect.guard.test.ts` keeps `.or` and `.select` off every mutation
 * chain in `lib/` and `app/`.
 *
 * The id filter makes 0 or 1 the only honest answers. Anything else (a missing
 * count, or more than one row) means the filter did not do what the CAS relies
 * on, so it is an error rather than a win.
 */
function casWon(count: number | null): boolean {
  if (count === 0) return false;
  if (count === 1) return true;
  throw Object.assign(new Error(`Compare-and-swap matched an unexpected row count: ${String(count)}`), {
    code: 'CAS_ROW_COUNT',
  });
}

/**
 * How the mailbox was proven before a signup claim (Slice 3b, D-3, SA R-7).
 * `code`: the emailed code, whose hash must still be the live one. `google`: a
 * verified Google ID token for the invite's own address, checked by the caller.
 */
type SignupClaimProof = { kind: 'code'; codeHash: string } | { kind: 'google' };

/**
 * The ONE signup-claim compare-and-swap, shared by `claimForSignup` and
 * `claimForGoogleSignup` so their conditions cannot drift apart (D-3).
 *
 * A module function rather than a private method, so the repository's public
 * surface (pinned by its test) gains no unscoped-looking name.
 *
 * The proof `switch` is exhaustive with a `never` default (SA R-7): a third
 * kind added to `SignupClaimProof` without a case here fails to compile rather
 * than silently skipping the code-hash filter. Count-only, no `.select`
 * (see `casWon`).
 */
function signupClaimUpdate(
  supabase: SupabaseClient,
  input: ClaimInviteForGoogleSignupInput,
  proof: SignupClaimProof
) {
  const at = input.now.toISOString();
  let query = supabase
    .from(INVITES)
    .update(
      {
        signup_code_hash: null,
        signup_code_expires_at: null,
        claimed_at: at,
        claimed_account_id: input.accountId,
        updated_at: at,
      },
      // A count, not the rows: see `casWon` for why `.select` is not used here.
      { count: 'exact' }
    )
    .eq('id', input.id);

  switch (proof.kind) {
    case 'code':
      query = query.eq('signup_code_hash', proof.codeHash);
      break;
    case 'google':
      // No code condition: Google's verified token is the mailbox proof, and
      // the update above clears any outstanding code together with its expiry.
      break;
    default: {
      const unhandled: never = proof;
      throw new Error(`Unknown signup claim proof: ${String((unhandled as { kind?: unknown }).kind)}`);
    }
  }

  query = query
    .is('redeemed_at', null)
    .is('revoked_at', null)
    .gt('link_expires_at', at)
    .or(noLiveClaim(input.claimLeaseCutoff));

  return input.observedClaimedAccountId === null
    ? query.is('claimed_account_id', null)
    : query.eq('claimed_account_id', input.observedClaimedAccountId);
}

/** What the public page's lookup reads (C-4): no email, no issuer id, no reasons, no hash.
 *
 * `issuer_kind` (Slice 5a, F5a-10, SA R-5) is read only so an account-issued
 * invite never reaches the existing-account check; the view never returns it.
 */
export const BUSINESS_OS_INVITE_PUBLIC_COLUMNS =
  'id, issuer_kind, grant_kind, grant_id, access_open_ended, access_months, inviter_display_name, language, ' +
  'personal_note, link_expires_at, first_viewed_at, revoked_at, redeemed_at';

/**
 * What a champion's own list reads (Slice 5a, F5a-9). Never `token_hash`, the
 * redeemed account id, `first_viewed_at`, `opened_by_existing_account_at`,
 * `inviter_reply_to`, `internal_reason`, `signup_code_*`, `redemption_*` or
 * `email_problem_detail`: the two timestamps would tell a champion whether the
 * friend looked, and whether the typed address has an account. The last three
 * columns only derive the status and the allowance; the route never returns them.
 */
export const BUSINESS_OS_FRIEND_INVITE_LIST_COLUMNS =
  'id, email, created_at, link_expires_at, revoked_at, redeemed_at, claimed_account_id';

/** The most invites a champion's list reads, newest first (workplan D-7, SA Q-7). */
export const BUSINESS_OS_FRIEND_INVITE_LIST_LIMIT = 200;

/** The refusal classes the send function returns (T-17). */
const FRIEND_INVITE_REFUSALS: ReadonlySet<string> = new Set(['not_eligible', 'allowance_reached', 'daily_limit', 'already_invited']);

/**
 * The admin list shows at most this many invites, newest first. Slice 1c
 * (SA F-9) raised it from 200 so the screen's filters and search reach further;
 * `INVITE_LIST_CEILING` in `adminInviteOps.ts` asks for the same number.
 */
export const BUSINESS_OS_INVITE_LIST_LIMIT = 500;

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
          inviter_reply_to: input.inviter_reply_to,
          email_attempted_at: input.email_attempted_at,
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
   *
   * The one mutation here that still pairs `.or` with `.select` (see `casWon`
   * for the PostgREST 42703 trap), because the admin screen needs the revoked
   * row back. It works ONLY because `BUSINESS_OS_INVITE_ADMIN_COLUMNS` lists
   * `claimed_at`, the column the `.or` names; `mutationOrSelect.guard.test.ts`
   * holds this as its single exemption and fails if that column ever leaves
   * the list.
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

  /**
   * ADMIN: record how the invitation email for the CURRENT link ended (Slice
   * 2a, D-6). `true` only when this call wrote it.
   *
   * A compare-and-swap on the invite id AND the hash of the link that was
   * emailed: once a resend (Slice 2b) replaces the link, a slow outcome for the
   * old one matches no row and the caller logs a warning. Built field by field;
   * a sent outcome clears any problem, a problem leaves `email_sent_at` alone.
   * The caller passes a detail that is already scrubbed and capped.
   *
   * Counted with `{ count: 'exact' }` and NO `.select()`: the written row is not
   * needed, and it keeps this write off the PostgREST shape that fails (an
   * UPDATE whose filters include `.or()` AND a `.select()` returns a misleading
   * 42703, found on production for Slice 1b). `true` only on exactly one row.
   */
  async recordInviteEmailOutcome(input: RecordInviteEmailOutcomeInput): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'recordInviteEmailOutcome', inviteId: input.id });
    const at = input.now.toISOString();
    const patch =
      input.outcome.kind === 'sent'
        ? {
            email_sent_at: at,
            email_provider_message_id: input.outcome.providerMessageId,
            email_problem: null,
            email_problem_at: null,
            email_problem_detail: null,
            updated_at: at,
          }
        : {
            email_problem: input.outcome.problem,
            email_problem_at: at,
            email_problem_detail: input.outcome.detail,
            updated_at: at,
          };
    try {
      const { error, count } = await this.supabase
        .from(INVITES)
        .update(patch, { count: 'exact' })
        .eq('id', input.id)
        .eq('token_hash', input.tokenHash);

      if (error) throw error;
      return { data: count === 1, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to record the invitation email outcome');
      return { data: null, error: toError(error) };
    }
  }

  // ============ Champion (behind getUser; scoped by the issuing account) ============

  /**
   * CHAMPION: issue one friend invite through `business_os_create_friend_invite`
   * (migration 20261023, T-17, T-21). The function takes a per-issuer advisory
   * lock, re-checks the in-force cohort, counts against the allowance and the
   * daily limit, refuses a duplicate live invite, and inserts, in ONE
   * transaction. Nothing here counts or inserts on its own.
   *
   * The arguments are mapped field by field from the allow-list type; nothing
   * is spread. They are never logged (the email and note are in them), and a
   * database error is reduced by `safeDbError` (SA R-6): a CHECK failure inside
   * the function carries "Failing row contains ..." in `details`.
   */
  async createForIssuerAccount(input: CreateFriendInviteInput): Promise<RepositoryResult<CreateFriendInviteResult>> {
    const methodLogger = this.logger.child({ method: 'createForIssuerAccount', accountId: input.issuerAccountId });
    try {
      const { data, error } = await this.supabase.rpc('business_os_create_friend_invite', {
        p_issuer_account_id: input.issuerAccountId,
        p_issuer_cohort: input.issuerCohort,
        p_invite_type: input.inviteType,
        p_grant_id: input.grantId,
        p_allowance: input.allowance,
        p_daily_limit: input.dailyLimit,
        p_daily_window_hours: input.dailyWindowHours,
        p_token_hash: input.tokenHash,
        p_email: input.email,
        p_inviter_display_name: input.inviterDisplayName,
        p_inviter_reply_to: input.inviterReplyTo,
        p_language: input.language,
        p_personal_note: input.personalNote,
        p_internal_reason: input.internalReason,
        p_link_expiry_days: input.linkExpiryDays,
      });

      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { result_outcome?: unknown; result_invite_id?: unknown; result_link_expires_at?: unknown }
        | null
        | undefined;
      const outcome = row?.result_outcome;
      if (outcome === 'created' && typeof row?.result_invite_id === 'string' && typeof row.result_link_expires_at === 'string') {
        methodLogger.info({ inviteId: row.result_invite_id }, 'Friend invite created');
        return {
          data: { outcome: 'created', inviteId: row.result_invite_id, linkExpiresAt: row.result_link_expires_at },
          error: null,
        };
      }
      if (typeof outcome === 'string' && FRIEND_INVITE_REFUSALS.has(outcome)) {
        return { data: { outcome: outcome as Exclude<CreateFriendInviteResult['outcome'], 'created'> }, error: null };
      }
      throw Object.assign(new Error('The friend invite function returned an unexpected shape'), { code: 'FRIEND_INVITE_SHAPE' });
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to create friend invite');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * CHAMPION: the invites THIS account issued, newest first, capped at
   * `BUSINESS_OS_FRIEND_INVITE_LIST_LIMIT` (F5a-9). Both issuer filters are
   * here, so no argument can widen it.
   */
  async listForIssuerAccount(
    issuerAccountId: string,
    options: { limit?: number } = {}
  ): Promise<RepositoryResult<BusinessOsFriendInviteListRow[]>> {
    const methodLogger = this.logger.child({ method: 'listForIssuerAccount', accountId: issuerAccountId });
    const requested = Math.trunc(options.limit ?? BUSINESS_OS_FRIEND_INVITE_LIST_LIMIT) || 1;
    const limit = Math.min(Math.max(requested, 1), BUSINESS_OS_FRIEND_INVITE_LIST_LIMIT);
    try {
      const { data, error } = await this.supabase
        .from(INVITES)
        .select(BUSINESS_OS_FRIEND_INVITE_LIST_COLUMNS)
        .eq('issuer_kind', 'account')
        .eq('issuer_account_id', issuerAccountId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data: (data ?? []) as unknown as BusinessOsFriendInviteListRow[], error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to list friend invites');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * CHAMPION: revoke one of THIS account's invites that is neither accepted nor
   * already revoked, and has no live signup claim (F5a-8, T-20).
   *
   * Ownership lives INSIDE the UPDATE (`issuer_kind` + `issuer_account_id`), so
   * there is no gap between checking and writing, and "not found", "not yours"
   * and "no longer revocable" are all `false` (the route's one 404).
   * `revoked_by_admin_id` stays NULL: on an account-issued invite that MEANS
   * "revoked by the inviter" (the admin list derives `revokedByInviter` from it).
   *
   * Counted with `{ count: 'exact' }` and NO `.select()` (see `casWon`):
   * `mutationOrSelect.guard.test.ts` keeps its single exemption.
   */
  async revokeForIssuerAccount(input: RevokeFriendInviteInput): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({
      method: 'revokeForIssuerAccount',
      inviteId: input.id,
      accountId: input.issuerAccountId,
    });
    const at = input.now.toISOString();
    try {
      const { error, count } = await this.supabase
        .from(INVITES)
        .update(
          {
            revoked_at: at,
            revoke_reason: input.reason,
            updated_at: at,
          },
          // A count, not the rows: see `casWon` for why `.select` is not used here.
          { count: 'exact' }
        )
        .eq('id', input.id)
        .eq('issuer_kind', 'account')
        .eq('issuer_account_id', input.issuerAccountId)
        .is('redeemed_at', null)
        .is('revoked_at', null)
        .or(noLiveClaim(input.claimLeaseCutoff));

      if (error) throw error;
      const won = casWon(count);
      if (won) methodLogger.info('Friend invite revoked by its issuer');
      return { data: won, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to revoke friend invite');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * CHAMPION: whether THIS account's invite `id` has already been accepted
   * (Slice 5b, 5a Q-3). Asked only after `revokeForIssuerAccount` matched no
   * row, so the route can answer 409 "already used" instead of 404.
   *
   * Scoped exactly like the revoke (`issuer_kind` + `issuer_account_id` from
   * the session), so another account's accepted invite reads as `false` and
   * still gets the shared 404: "not found" and "not yours" stay
   * indistinguishable. A plain SELECT of one column, kept as its own method so
   * it never shares a block with the revoke's `.update(` (the
   * `mutationOrSelect` guard reads to the end of that block).
   */
  async findRedeemedForIssuerAccount(id: string, issuerAccountId: string): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({
      method: 'findRedeemedForIssuerAccount',
      inviteId: id,
      accountId: issuerAccountId,
    });
    try {
      const { data, error } = await this.supabase
        .from(INVITES)
        .select('redeemed_at')
        .eq('id', id)
        .eq('issuer_kind', 'account')
        .eq('issuer_account_id', issuerAccountId)
        .maybeSingle();

      if (error) throw error;
      const redeemedAt = (data as { redeemed_at?: unknown } | null)?.redeemed_at;
      return { data: typeof redeemedAt === 'string' && redeemedAt.length > 0, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to read whether a friend invite was accepted');
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

  // ============ Payment hold (Slice 5b; the signed-in account's own invite) ============

  /**
   * HOLD: the grant kind and language of the invite that created the signed-in
   * account, or `null`. `id` is the `invite_id` of THAT account's own lineage
   * row (read by the caller with the session's account id), never a value from
   * a request. Two columns only: no email, no issuer, no hash.
   */
  async findHoldFactsById(id: string): Promise<RepositoryResult<BusinessOsInviteHoldFacts>> {
    const methodLogger = this.logger.child({ method: 'findHoldFactsById', inviteId: id });
    try {
      const { data, error } = await this.supabase.from(INVITES).select('grant_kind, language').eq('id', id).maybeSingle();

      if (error) throw error;
      return { data: (data ?? null) as unknown as BusinessOsInviteHoldFacts | null, error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to read the invite hold facts');
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
        .update(
          {
            signup_code_hash: input.codeHash,
            signup_code_expires_at: input.expiresAt.toISOString(),
            signup_code_attempts: 0,
            signup_code_sent_count: input.sentCount,
            signup_code_window_started_at: input.windowStartedAt.toISOString(),
            signup_code_last_sent_at: at,
            updated_at: at,
          },
          // A count, not the rows: see `casWon` for why `.select` is not used here.
          { count: 'exact' }
        )
        .eq('id', input.id)
        .eq('signup_code_sent_count', input.observedSentCount)
        .is('redeemed_at', null)
        .is('revoked_at', null)
        .gt('link_expires_at', at)
        .or(noLiveClaim(input.claimLeaseCutoff));

      const { count, error } = await (input.observedLastSentAt === null
        ? query.is('signup_code_last_sent_at', null)
        : query.eq('signup_code_last_sent_at', input.observedLastSentAt));

      if (error) throw error;
      return { data: casWon(count), error: null };
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
    try {
      const { count, error } = await signupClaimUpdate(this.supabase, input, { kind: 'code', codeHash: input.codeHash });

      if (error) throw error;
      return { data: casWon(count), error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to claim an invite for signup');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * SIGNUP (Slice 3b, D-3): the same claim as `claimForSignup`, for a signup
   * whose mailbox was proven by a verified Google ID token instead of the
   * emailed code. Every condition of the code claim holds (still pending, no
   * live claim, the observed claimant) EXCEPT the code-hash equality, and any
   * outstanding code is cleared with the claim, so it dies here (CHECK
   * `signup_code_paired`). The caller verifies the token and the email lock
   * BEFORE calling this; nothing Google-derived is passed in.
   */
  async claimForGoogleSignup(input: ClaimInviteForGoogleSignupInput): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'claimForGoogleSignup', inviteId: input.id });
    try {
      const { count, error } = await signupClaimUpdate(this.supabase, input, { kind: 'google' });

      if (error) throw error;
      return { data: casWon(count), error: null };
    } catch (error) {
      methodLogger.error({ dbError: safeDbError(error) }, 'Failed to claim an invite for Google signup');
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
