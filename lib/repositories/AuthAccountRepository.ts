// lib/repositories/AuthAccountRepository.ts
// The one door to `auth.users` for Business OS invite-only signup.
//
// INTENTIONAL SERVICE-ROLE CLIENT (RLS bypass). Whether an email already has an
// account is not something a visitor may ask: it is asked only by the invite
// path, only after a 256-bit invite token has matched a row, and only about
// THAT row's email (requirement §16.5 L-3, §8.1; workplan D-12, SA R-4).
//
// The lookup is `business_os_auth_email_has_account` (migration 20261013): a
// hardened SECURITY DEFINER function that returns a boolean and nothing else,
// executable by `service_role` only. `listUsers` pagination is deliberately not
// used (L-3): it would page through every account on the platform to answer a
// yes/no question.
//
// WHO MAY IMPORT THIS FILE is pinned by
// `lib/repositories/__tests__/authAccountRepository.callers.guard.test.ts`.
// It is not exported from the `lib/repositories` barrel on purpose, so that
// every importer names it and the guard can see them.
//
// No method here deletes a user, now or later (Slice 1 invariant I-1; the
// repo-wide no-deletion-paths guard).
//
// Methods never throw: they return `{ data, error }`. A database error is
// reduced to `{ code, message }` before it is logged or returned, and no email
// is ever logged.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import { safeDbError, type SafeDbError } from './BusinessOsInviteRepository';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** The SQL function the lookup calls (migration 20261013). */
export const EMAIL_HAS_ACCOUNT_FUNCTION = 'business_os_auth_email_has_account';

export class AuthAccountRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AuthAccountRepository' });
  }

  /**
   * Does any account already use this email? (FR-8a, L-3.)
   *
   * The caller must pass the email of an invite row it has already matched by
   * token hash, never a value from a request. The answer is a boolean: no id,
   * no metadata.
   */
  async emailHasAccount(email: string): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'emailHasAccount' });
    try {
      const { data, error } = await this.supabase.rpc(EMAIL_HAS_ACCOUNT_FUNCTION, {
        p_email: email.trim().toLowerCase(),
      });

      if (error) throw error;
      // Anything but a real boolean is a broken contract, and "no account" must
      // never be the answer by default: the caller would then offer signup to
      // someone who already has an account.
      if (typeof data !== 'boolean') {
        throw { code: null, message: 'Account lookup returned a non-boolean result' } satisfies SafeDbError;
      }
      return { data, error: null };
    } catch (error) {
      const safe = safeDbError(error);
      methodLogger.error({ dbError: safe }, 'Account lookup failed');
      const out = new Error(safe.message) as Error & { code?: string };
      if (safe.code) out.code = safe.code;
      return { data: null, error: out };
    }
  }
}

export const authAccountRepository = new AuthAccountRepository();
