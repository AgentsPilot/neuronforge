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
//      list with no email, issuer, reason or hash.
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
  CreateBusinessOsInviteInput,
  RevokeBusinessOsInviteInput,
} from './types';

const INVITES = 'business_os_invites';

/** Every column the admin surface reads. Named, never `*`, and never `token_hash`. */
export const BUSINESS_OS_INVITE_ADMIN_COLUMNS =
  'id, email, email_locked, invite_type, grant_kind, grant_id, access_open_ended, access_months, ' +
  'issuer_kind, issuer_admin_id, issuer_account_id, inviter_display_name, language, personal_note, ' +
  'internal_reason, link_expiry_days, link_expires_at, first_viewed_at, revoked_at, revoked_by_admin_id, ' +
  'revoke_reason, redeemed_at, redeemed_account_id, created_at, updated_at';

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
