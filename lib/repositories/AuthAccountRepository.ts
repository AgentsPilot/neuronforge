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
// Slice 1b adds exactly two more doors, both used only by the redemption flow:
// `createConfirmedUser` (T-3 as amended: the account is created server-side,
// with the id the invite was ALREADY claimed for, after mailbox proof) and
// `findUserExists` (I-4/I-6: "does a user with this id exist?", yes/no/unknown).
// Slice 3b adds `createConfirmedUserWithoutPassword`: the same creation for a
// mailbox proven by a verified Google ID token, with no password.
// Admin delete AD-1b adds `findUserIdentity` (D-1): id, email and joined date
// of ONE account, for the admin-gated deletion preview only.
//
// No method here deletes a user, now or later (Slice 1 invariant I-1; the
// repo-wide no-deletion-paths guard). A signup that stops halfway keeps its
// claim and is finished by recovery, never undone by a delete (SA R-1).
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

/**
 * The outcome of creating the account (Slice 1b). Failures carry a CLASS, the
 * provider's error code and a message; the caller scrubs the message before
 * it is stored (SA D-2). The password never appears in either.
 */
export type CreateConfirmedUserOutcome =
  | { ok: true; id: string }
  | {
      ok: false;
      kind: 'email_exists' | 'weak_password' | 'other';
      code: string | null;
      message: string;
    };

/** The outcome of creating a password-less account (Slice 3b): no `weak_password` class. */
export type CreatePasswordlessUserOutcome =
  | { ok: true; id: string }
  | { ok: false; kind: 'email_exists' | 'other'; code: string | null; message: string };

/** The auth error codes that mean "an account already uses this email". */
const EMAIL_TAKEN_CODES = new Set(['email_exists', 'user_already_exists']);

/** Read the fields of an auth error without trusting its shape. */
function authErrorFacts(error: unknown): { code: string | null; status: number | null; message: string } {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return {
    code: typeof record.code === 'string' ? record.code : null,
    status: typeof record.status === 'number' ? record.status : null,
    message: typeof record.message === 'string' ? record.message : 'Unknown auth error',
  };
}

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

  /**
   * Create a CONFIRMED account for an invite that is already claimed for `id`
   * (T-3 as amended, R-1, I-3).
   *
   * - `id` is generated by the server and recorded on the invite BEFORE this
   *   call, so the account and the claim are bound before the account exists.
   * - `email` is the invite row's email (the email lock), never request data.
   * - `email_confirm: true` because mailbox control was proven by the code.
   * - No metadata: nothing a caller sends reaches the auth user.
   *
   * The caller checks that the returned id equals `id` (I-3). Logs carry the
   * error code and HTTP status only: never the email, never the password.
   */
  async createConfirmedUser(input: { id: string; email: string; password: string }): Promise<CreateConfirmedUserOutcome> {
    return createConfirmedAuthUser(
      this.supabase,
      this.logger.child({ method: 'createConfirmedUser', accountId: input.id }),
      { id: input.id, email: input.email, password: input.password, email_confirm: true }
    );
  }

  /**
   * Create a CONFIRMED account with NO password, for an invite already claimed
   * for `id` after a verified Google ID token proved the mailbox (Slice 3b,
   * D-4). The same contract as `createConfirmedUser` in every other respect:
   * the server's id, the invite row's email, `email_confirm: true`, no
   * metadata. The person signs in with Google, which links the identity; they
   * can set a password later through "Forgot password".
   *
   * With no password there is nothing to be too weak, so the outcome has no
   * `weak_password` class (SA optimisation): should the provider ever report
   * one, it is `other`.
   */
  async createConfirmedUserWithoutPassword(input: { id: string; email: string }): Promise<CreatePasswordlessUserOutcome> {
    const outcome = await createConfirmedAuthUser(
      this.supabase,
      this.logger.child({ method: 'createConfirmedUserWithoutPassword', accountId: input.id }),
      { id: input.id, email: input.email, email_confirm: true }
    );
    if (!outcome.ok && outcome.kind === 'weak_password') return { ...outcome, kind: 'other' };
    return outcome as CreatePasswordlessUserOutcome;
  }

  /**
   * Does a user with this id exist? (I-4, I-6, D-dev-2.)
   *
   * `true` / `false` only on a definite answer; anything else is an error, and
   * the caller must then KEEP its claim ("never release on uncertainty").
   */
  async findUserExists(id: string): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'findUserExists', accountId: id });
    try {
      const { data, error } = await this.supabase.auth.admin.getUserById(id);
      if (error) {
        const facts = authErrorFacts(error);
        if (facts.status === 404 || facts.code === 'user_not_found') return { data: false, error: null };
        methodLogger.error({ authErrorCode: facts.code, authStatus: facts.status }, 'User lookup failed');
        const out = new Error(facts.message) as Error & { code?: string };
        if (facts.code) out.code = facts.code;
        return { data: null, error: out };
      }
      return { data: Boolean(data?.user?.id), error: null };
    } catch (error) {
      const facts = authErrorFacts(error);
      methodLogger.error({ authErrorCode: facts.code, authStatus: facts.status }, 'User lookup threw');
      return { data: null, error: new Error(facts.message) };
    }
  }

  /**
   * Who is the account with this id? (Admin delete AD-1b, D-1.)
   *
   * Read by the admin deletion preview only, for an id taken from an
   * admin-gated route path: the dialog header shows the email and joined date
   * (FR-A2), and R-2 checks the email against the admin list.
   *
   * `{ data: null }` ONLY on a definite 404 / `user_not_found`. Anything else,
   * including a reply with no user and no error, is an error: the caller must
   * answer 500, never "not found" and never "not an admin" (SA D-1). The email
   * is returned, never logged.
   */
  async findUserIdentity(
    id: string
  ): Promise<RepositoryResult<{ id: string; email: string | null; createdAt: string | null } | null>> {
    const methodLogger = this.logger.child({ method: 'findUserIdentity', accountId: id });
    try {
      const { data, error } = await this.supabase.auth.admin.getUserById(id);
      if (error) {
        const facts = authErrorFacts(error);
        if (facts.status === 404 || facts.code === 'user_not_found') return { data: null, error: null };
        methodLogger.error({ authErrorCode: facts.code, authStatus: facts.status }, 'User identity lookup failed');
        const out = new Error(facts.message) as Error & { code?: string };
        if (facts.code) out.code = facts.code;
        return { data: null, error: out };
      }
      const user = data?.user;
      if (!user || typeof user.id !== 'string') {
        methodLogger.error('User identity lookup returned no user and no error');
        return { data: null, error: new Error('User identity lookup returned no user') };
      }
      return {
        data: {
          id: user.id,
          email: typeof user.email === 'string' && user.email.length > 0 ? user.email : null,
          createdAt: typeof user.created_at === 'string' ? user.created_at : null,
        },
        error: null,
      };
    } catch (error) {
      const facts = authErrorFacts(error);
      methodLogger.error({ authErrorCode: facts.code, authStatus: facts.status }, 'User identity lookup threw');
      return { data: null, error: new Error(facts.message) };
    }
  }
}

/**
 * The one `admin.createUser` call behind both creators. A module function, not
 * a method, so the repository's public surface (pinned by its test) stays the
 * named doors. The attributes are an explicit allow-list built by the caller:
 * id, email, `email_confirm` and, for the code path only, the password.
 */
async function createConfirmedAuthUser(
  supabase: SupabaseClient,
  methodLogger: Logger,
  attributes: { id: string; email: string; password?: string; email_confirm: true }
): Promise<CreateConfirmedUserOutcome> {
  try {
    const { data, error } = await supabase.auth.admin.createUser(attributes);

    if (error) {
      const facts = authErrorFacts(error);
      const kind = EMAIL_TAKEN_CODES.has(facts.code ?? '')
        ? 'email_exists'
        : facts.code === 'weak_password'
          ? 'weak_password'
          : 'other';
      methodLogger.warn({ authErrorCode: facts.code, authStatus: facts.status, kind }, 'Account creation refused');
      return { ok: false, kind, code: facts.code, message: facts.message };
    }

    const createdId = data?.user?.id;
    if (typeof createdId !== 'string') {
      methodLogger.error('Account creation returned no user id');
      return { ok: false, kind: 'other', code: null, message: 'Account creation returned no user id' };
    }
    return { ok: true, id: createdId };
  } catch (error) {
    const facts = authErrorFacts(error);
    methodLogger.error({ authErrorCode: facts.code, authStatus: facts.status }, 'Account creation threw');
    return { ok: false, kind: 'other', code: facts.code, message: facts.message };
  }
}

export const authAccountRepository = new AuthAccountRepository();
