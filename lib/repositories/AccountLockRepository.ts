// lib/repositories/AccountLockRepository.ts
//
// Account deletion lifecycle DL-1a (workplan BUSINESS_OS_DELETION_DL1A_WORKPLAN.md
// §5.3 with SA W-4; requirement BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md
// XC-3, XC-21): the one seam over the Supabase Auth admin API that locks and
// unlocks the login of an account at stage D, and ends its sign-in sessions.
//
// INTENTIONAL SERVICE-ROLE CLIENT. The auth admin API and the session cut
// function (migration 20261093) exist only for service_role. Each method takes
// a caller-supplied user id, so each one checks for itself, on the server,
// that the account really is at that step (tenant-isolation-guard), exactly as
// the SQL function does:
//
// - banLogin refuses, with no admin call, unless the account has a `locked`
//   closure row or a `grace` row whose lock time has passed (the SA W-3
//   predicate of the session cut).
// - unbanLogin refuses unless the account's newest closure row is `locked`, or
//   `kept` by an admin after a real lock (`locked_at` set, SA CR-1), so a retry
//   after the Keep transition still works.
// - Both refuse a TOMBSTONE: the closed login of a deleted account (XC-3, F-2).
//   Three signals: the placeholder email, `app_metadata.deleted`, or a ban more
//   than 99 years out (the anonymise bans for 100 years). Lifting or replacing
//   that ban would reopen a deleted account.
// - cutSessions calls the SQL function, which refuses with 42501 itself.
//
// No callers in DL-1a besides tests: DL-4 wires the lifecycle job and the
// admin Unlock route. WHO MAY IMPORT THIS FILE is pinned by
// lib/repositories/__tests__/accountClosureRepositories.callers.guard.test.ts,
// and it is not exported from the `lib/repositories` barrel on purpose.
//
// The session cut is isolated in `cutSessions` and SESSION_CUT_FUNCTION. If the
// GoTrue spike (workplan §3) shows that a ban alone ends a live session, both
// go, with the function in 20261093, and nothing else changes.
//
// The email is read only to recognise a tombstone. It is never returned and
// never logged. Logs carry the user id and error codes only. Every method
// returns { data, error } and never throws.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import { isClosedAccountEmail } from '@/lib/business-os/account-deletion/closedAccount';
import {
  LOCK_BAN_DURATION,
  TOMBSTONE_BAN_MIN_YEARS,
  UNBAN_DURATION,
} from '@/lib/business-os/account-deletion/closureLifecycle';
import { AccountClosureRepository, type AccountClosure } from './AccountClosureRepository';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** The session cut function of migration 20261093 (XC-3, SA W-3). */
export const SESSION_CUT_FUNCTION = 'business_os_account_closure_cut_sessions';

/** What the lock seam knows about a login. Never the email. */
export interface LoginState {
  exists: boolean;
  bannedUntil: string | null;
  isTombstone: boolean;
}

/** The typed error codes callers branch on. */
export const LOCK_ERROR = {
  INVALID: 'invalid_input',
  NOT_CLOSING: 'not_closing',
  NOT_UNLOCKABLE: 'not_unlockable',
  TOMBSTONE: 'tombstone',
  NOT_FOUND: 'user_not_found',
} as const;

const uuid = z.string().uuid();
const cutResultSchema = z.object({
  sessions: z.number().int().nonnegative(),
  refresh_tokens: z.number().int().nonnegative(),
});

function coded(code: string, message: string): Error & { code: string } {
  const out = new Error(message) as Error & { code: string };
  out.code = code;
  return out;
}

/** Read the fields of an auth or database error without trusting its shape. */
function errorFacts(error: unknown): { code: string | null; status: number | null; message: string } {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return {
    code: typeof record.code === 'string' ? record.code : null,
    status: typeof record.status === 'number' ? record.status : null,
    message: typeof record.message === 'string' ? record.message : 'Unknown auth error',
  };
}

/** The SA W-3 predicate, the same one the session cut function checks in SQL. */
export function isAtLock(closure: Pick<AccountClosure, 'status' | 'lock_at'> | null, now: Date = new Date()): boolean {
  if (!closure) return false;
  if (closure.status === 'locked') return true;
  if (closure.status !== 'grace' || !closure.lock_at) return false;
  const lockAt = Date.parse(closure.lock_at);
  return Number.isFinite(lockAt) && lockAt <= now.getTime();
}

/** True when a ban runs further out than TOMBSTONE_BAN_MIN_YEARS from `now`. */
function isTombstoneBan(bannedUntil: string | null, now: Date): boolean {
  if (!bannedUntil) return false;
  const until = Date.parse(bannedUntil);
  if (!Number.isFinite(until)) return false;
  const threshold = new Date(now.getTime());
  threshold.setUTCFullYear(threshold.getUTCFullYear() + TOMBSTONE_BAN_MIN_YEARS);
  return until > threshold.getTime();
}

export class AccountLockRepository {
  private supabase: SupabaseClient;
  private closures: AccountClosureRepository;
  private logger: Logger;
  private now: () => Date;

  constructor(supabaseClient?: SupabaseClient, closures?: AccountClosureRepository, now: () => Date = () => new Date()) {
    // Service role on purpose: the auth admin API and the session cut are service_role only (header).
    this.supabase = supabaseClient || defaultSupabase;
    this.closures = closures || new AccountClosureRepository(this.supabase);
    this.logger = createLogger({ service: 'AccountLockRepository' });
    this.now = now;
  }

  /**
   * Does the login exist, how long is it banned, and is it a tombstone?
   * `{ exists: false }` only on a definite 404 / `user_not_found`.
   */
  async readLoginState(userId: string): Promise<RepositoryResult<LoginState>> {
    if (!uuid.safeParse(userId).success) return { data: null, error: coded(LOCK_ERROR.INVALID, 'Invalid input: user id') };
    const methodLogger = this.logger.child({ method: 'readLoginState', userId });
    try {
      const { data, error } = await this.supabase.auth.admin.getUserById(userId);
      if (error) {
        const facts = errorFacts(error);
        if (facts.status === 404 || facts.code === 'user_not_found') {
          return { data: { exists: false, bannedUntil: null, isTombstone: false }, error: null };
        }
        methodLogger.error({ authErrorCode: facts.code, authStatus: facts.status }, 'Login state lookup failed');
        return { data: null, error: coded(facts.code ?? 'auth_error', facts.message) };
      }
      const user = data?.user;
      if (!user || typeof user.id !== 'string') {
        methodLogger.error('Login state lookup returned no user and no error');
        return { data: null, error: new Error('Login state lookup returned no user') };
      }
      // `banned_until` is on the admin user object but not on every SDK type version.
      const bannedRaw = (user as unknown as { banned_until?: unknown }).banned_until;
      const bannedUntil = typeof bannedRaw === 'string' && bannedRaw !== '' ? bannedRaw : null;
      const appMetadata = (user.app_metadata ?? {}) as Record<string, unknown>;
      const isTombstone =
        isClosedAccountEmail(user.email) || appMetadata.deleted === true || isTombstoneBan(bannedUntil, this.now());
      return { data: { exists: true, bannedUntil, isTombstone }, error: null };
    } catch (error) {
      const facts = errorFacts(error);
      methodLogger.error({ authErrorCode: facts.code, authStatus: facts.status }, 'Login state lookup threw');
      return { data: null, error: new Error(facts.message) };
    }
  }

  /**
   * Stage D: ban the login for LOCK_BAN_DURATION. Refuses, with no admin call,
   * unless the account is at its lock (W-3 predicate) and the login is a live,
   * non-tombstone login (W-4).
   */
  async banLogin(userId: string): Promise<RepositoryResult<{ bannedUntil: string | null }>> {
    if (!uuid.safeParse(userId).success) return { data: null, error: coded(LOCK_ERROR.INVALID, 'Invalid input: user id') };
    const methodLogger = this.logger.child({ method: 'banLogin', userId });
    const open = await this.closures.findOpenForUser(userId);
    if (open.error) return { data: null, error: open.error };
    if (!isAtLock(open.data, this.now())) {
      methodLogger.warn({ status: open.data?.status ?? null }, 'Ban refused: the account is not at its lock');
      return { data: null, error: coded(LOCK_ERROR.NOT_CLOSING, 'The account is not at its lock') };
    }
    const refusal = await this.refuseUnlessLiveLogin(userId, methodLogger);
    if (refusal) return { data: null, error: refusal };
    return this.setBan(userId, LOCK_BAN_DURATION, methodLogger);
  }

  /**
   * Unlock: lift the ban. Refuses, with no admin call, unless the newest
   * closure row is `locked`, or `kept` by an admin, and the login is not a
   * tombstone (W-4).
   */
  async unbanLogin(userId: string): Promise<RepositoryResult<{ bannedUntil: string | null }>> {
    if (!uuid.safeParse(userId).success) return { data: null, error: coded(LOCK_ERROR.INVALID, 'Invalid input: user id') };
    const methodLogger = this.logger.child({ method: 'unbanLogin', userId });
    const latest = await this.closures.findLatestForUser(userId);
    if (latest.error) return { data: null, error: latest.error };
    const row = latest.data;
    // SA CR-1: a kept row counts only if it really was locked (locked_at set). An admin Keep from
    // grace, or an old Keep, must not make the login unbannable for ever.
    const unlockable =
      row !== null && (row.status === 'locked' || (row.status === 'kept' && row.kept_source === 'admin' && row.locked_at !== null));
    if (!unlockable) {
      methodLogger.warn({ status: row?.status ?? null }, 'Unban refused: the account is not locked or kept by an admin');
      return { data: null, error: coded(LOCK_ERROR.NOT_UNLOCKABLE, 'The account is not locked') };
    }
    const refusal = await this.refuseUnlessLiveLogin(userId, methodLogger);
    if (refusal) return { data: null, error: refusal };
    return this.setBan(userId, UNBAN_DURATION, methodLogger);
  }

  /**
   * End every sign-in session of the account (XC-3). The SQL function refuses
   * with 42501 unless the account is at its lock; that comes back as
   * `not_closing`. Removed if the spike shows a ban ends sessions by itself.
   */
  async cutSessions(userId: string): Promise<RepositoryResult<{ sessions: number; refreshTokens: number }>> {
    if (!uuid.safeParse(userId).success) return { data: null, error: coded(LOCK_ERROR.INVALID, 'Invalid input: user id') };
    const methodLogger = this.logger.child({ method: 'cutSessions', userId });
    try {
      const { data, error } = await this.supabase.rpc(SESSION_CUT_FUNCTION, { p_user_id: userId });
      if (error) {
        const facts = errorFacts(error);
        if (facts.code === '42501') {
          methodLogger.warn('Session cut refused: the account is not at its lock');
          return { data: null, error: coded(LOCK_ERROR.NOT_CLOSING, 'The account is not at its lock') };
        }
        methodLogger.error({ dbErrorCode: facts.code }, 'Session cut failed');
        return { data: null, error: coded(facts.code ?? 'db_error', facts.message) };
      }
      const parsed = cutResultSchema.parse(data);
      methodLogger.info({ sessions: parsed.sessions, refreshTokens: parsed.refresh_tokens }, 'Sessions ended');
      return { data: { sessions: parsed.sessions, refreshTokens: parsed.refresh_tokens }, error: null };
    } catch (error) {
      const facts = errorFacts(error);
      methodLogger.error({ dbErrorCode: facts.code }, 'Session cut threw');
      return { data: null, error: new Error(facts.message) };
    }
  }

  /** null when the login is live and not a tombstone; otherwise the refusal. Makes no write. */
  private async refuseUnlessLiveLogin(userId: string, methodLogger: Logger): Promise<Error | null> {
    const state = await this.readLoginState(userId);
    if (state.error) return state.error;
    if (!state.data?.exists) {
      methodLogger.warn('Refused: the login does not exist');
      return coded(LOCK_ERROR.NOT_FOUND, 'The login does not exist');
    }
    if (state.data.isTombstone) {
      methodLogger.warn('Refused: the login is the tombstone of a deleted account');
      return coded(LOCK_ERROR.TOMBSTONE, 'The login belongs to a deleted account');
    }
    return null;
  }

  private async setBan(
    userId: string,
    duration: typeof LOCK_BAN_DURATION | typeof UNBAN_DURATION,
    methodLogger: Logger
  ): Promise<RepositoryResult<{ bannedUntil: string | null }>> {
    try {
      const { data, error } = await this.supabase.auth.admin.updateUserById(userId, { ban_duration: duration });
      if (error) {
        const facts = errorFacts(error);
        methodLogger.error({ authErrorCode: facts.code, authStatus: facts.status }, 'Ban change failed');
        return { data: null, error: coded(facts.code ?? 'auth_error', facts.message) };
      }
      const bannedRaw = (data?.user as unknown as { banned_until?: unknown } | undefined)?.banned_until;
      const bannedUntil = typeof bannedRaw === 'string' && bannedRaw !== '' ? bannedRaw : null;
      methodLogger.info({ locked: duration === LOCK_BAN_DURATION }, duration === LOCK_BAN_DURATION ? 'Login locked' : 'Login unlocked');
      return { data: { bannedUntil }, error: null };
    } catch (error) {
      const facts = errorFacts(error);
      methodLogger.error({ authErrorCode: facts.code, authStatus: facts.status }, 'Ban change threw');
      return { data: null, error: new Error(facts.message) };
    }
  }
}
