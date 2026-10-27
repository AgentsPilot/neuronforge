/**
 * AccountLockRepository (account deletion lifecycle DL-1a, workplan §5.3, T-4; SA W-4).
 *
 * The lock seam takes a caller-supplied user id on a service-role path, so it
 * must check for itself that the account is at its lock (ban), or locked or
 * kept by an admin (unban), and that the login is not the tombstone of a
 * deleted account. Each refusal below is proven to make NO admin call.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const logged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logged.push(args);
    logger.child = (bindings: unknown) => {
      logged.push(['child', bindings]);
      return logger;
    };
    return logger;
  };
  return { createLogger: () => make() };
});

import { AccountLockRepository, LOCK_ERROR, SESSION_CUT_FUNCTION, isAtLock } from '../AccountLockRepository';
import type { AccountClosure, AccountClosureRepository } from '../AccountClosureRepository';
import { LOCK_BAN_DURATION, UNBAN_DURATION } from '@/lib/business-os/account-deletion/closureLifecycle';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-25T12:00:00.000Z');
const PAST = '2026-10-25T11:00:00.000Z';
const FUTURE = '2026-10-26T00:00:00.000Z';
const EMAIL = 'owner+private@example.com';

type Closure = Pick<AccountClosure, 'status' | 'lock_at' | 'kept_source'> & Partial<Pick<AccountClosure, 'locked_at'>>;

interface Setup {
  open?: Closure | null;
  latest?: Closure | null;
  user?: { email?: string | null; banned_until?: string | null; app_metadata?: Record<string, unknown> } | null;
  userError?: { status?: number; code?: string; message?: string } | null;
  updateError?: { status?: number; code?: string; message?: string } | null;
  rpc?: { data?: unknown; error?: unknown };
}

function setup(s: Setup = {}) {
  const adminCalls: Array<{ method: string; args: unknown[] }> = [];
  const supabase = {
    auth: {
      admin: {
        getUserById: async (...args: unknown[]) => {
          adminCalls.push({ method: 'getUserById', args });
          if (s.userError) return { data: { user: null }, error: s.userError };
          const user = s.user === undefined ? { email: EMAIL, banned_until: null, app_metadata: {} } : s.user;
          return { data: { user: user ? { id: USER, ...user } : null }, error: null };
        },
        updateUserById: async (...args: unknown[]) => {
          adminCalls.push({ method: 'updateUserById', args });
          if (s.updateError) return { data: { user: null }, error: s.updateError };
          return { data: { user: { id: USER, banned_until: FUTURE } }, error: null };
        },
      },
    },
    rpc: async (...args: unknown[]) => {
      adminCalls.push({ method: 'rpc', args });
      return s.rpc ?? { data: { sessions: 2, refresh_tokens: 3 }, error: null };
    },
  } as unknown as SupabaseClient;
  const closures = {
    findOpenForUser: async () => ({ data: s.open === undefined ? { status: 'locked', lock_at: PAST, kept_source: null } : s.open, error: null }),
    findLatestForUser: async () => ({
      data: s.latest === undefined ? { status: 'locked', lock_at: PAST, locked_at: PAST, kept_source: null } : s.latest,
      error: null,
    }),
  } as unknown as AccountClosureRepository;
  const repo = new AccountLockRepository(supabase, closures, () => NOW);
  const writes = () => adminCalls.filter((call) => call.method === 'updateUserById');
  return { repo, adminCalls, writes };
}

const code = (error: unknown) => (error as Error & { code?: string } | null)?.code;

beforeEach(() => {
  logged.length = 0;
});

describe('isAtLock (the SA W-3 predicate, mirrored from SQL)', () => {
  it.each([
    [{ status: 'locked', lock_at: null }, true],
    [{ status: 'grace', lock_at: PAST }, true],
    [{ status: 'grace', lock_at: FUTURE }, false],
    [{ status: 'grace', lock_at: null }, false],
    [{ status: 'pending', lock_at: PAST }, false],
    [{ status: 'requesting', lock_at: null }, false],
    [null, false],
  ] as const)('%j at its lock: %s', (closure, expected) => {
    expect(isAtLock(closure as Closure | null, NOW)).toBe(expected);
  });
});

describe('banLogin', () => {
  it('bans for exactly LOCK_BAN_DURATION (87600h) when the account is locked', async () => {
    const { repo, writes } = setup();
    const result = await repo.banLogin(USER);
    expect(result.error).toBeNull();
    expect(writes()).toEqual([{ method: 'updateUserById', args: [USER, { ban_duration: '87600h' }] }]);
    expect(LOCK_BAN_DURATION).toBe('87600h');
  });

  it('bans a grace row whose lock time has passed', async () => {
    const { repo, writes } = setup({ open: { status: 'grace', lock_at: PAST, kept_source: null } });
    expect((await repo.banLogin(USER)).error).toBeNull();
    expect(writes()).toHaveLength(1);
  });

  it.each([
    ['no open closure', null],
    ['a grace row before its lock time', { status: 'grace', lock_at: FUTURE, kept_source: null }],
    ['a pending row', { status: 'pending', lock_at: null, kept_source: null }],
    ['a requesting row', { status: 'requesting', lock_at: null, kept_source: null }],
  ] as const)('refuses %s with no admin call', async (_name, open) => {
    const { repo, adminCalls } = setup({ open: open as Closure | null });
    const result = await repo.banLogin(USER);
    expect(code(result.error)).toBe(LOCK_ERROR.NOT_CLOSING);
    expect(adminCalls).toEqual([]);
  });

  it.each([
    ['the placeholder email', { email: 'deleted-0123456789ab@deleted.invalid', banned_until: null, app_metadata: {} }],
    ['app_metadata.deleted', { email: EMAIL, banned_until: null, app_metadata: { deleted: true } }],
    ['a ban more than 99 years out', { email: EMAIL, banned_until: '2126-10-25T12:00:00Z', app_metadata: {} }],
  ])('refuses a tombstone (%s) with no admin write', async (_name, user) => {
    const { repo, writes } = setup({ user });
    const result = await repo.banLogin(USER);
    expect(code(result.error)).toBe(LOCK_ERROR.TOMBSTONE);
    expect(writes()).toEqual([]);
  });

  it('refuses a missing login with no admin write', async () => {
    const { repo, writes } = setup({ userError: { status: 404, code: 'user_not_found', message: 'User not found' } });
    expect(code((await repo.banLogin(USER)).error)).toBe(LOCK_ERROR.NOT_FOUND);
    expect(writes()).toEqual([]);
  });

  it('an auth error on the ban comes back with its code', async () => {
    const { repo } = setup({ updateError: { status: 500, code: 'unexpected_failure', message: 'boom' } });
    expect(code((await repo.banLogin(USER)).error)).toBe('unexpected_failure');
  });

  it('an invalid id makes no call at all', async () => {
    const { repo, adminCalls } = setup();
    expect(code((await repo.banLogin('nope')).error)).toBe(LOCK_ERROR.INVALID);
    expect(adminCalls).toEqual([]);
  });
});

describe('unbanLogin', () => {
  it('lifts the ban with exactly UNBAN_DURATION (none) when the newest row is locked', async () => {
    const { repo, writes } = setup();
    expect((await repo.unbanLogin(USER)).error).toBeNull();
    expect(writes()).toEqual([{ method: 'updateUserById', args: [USER, { ban_duration: 'none' }] }]);
    expect(UNBAN_DURATION).toBe('none');
  });

  it('lifts it when the newest row was kept by an admin (a retry after Keep)', async () => {
    const { repo, writes } = setup({ latest: { status: 'kept', lock_at: PAST, locked_at: PAST, kept_source: 'admin' } });
    expect((await repo.unbanLogin(USER)).error).toBeNull();
    expect(writes()).toHaveLength(1);
  });

  it.each([
    ['no closure at all', null],
    ['kept by the owner', { status: 'kept', lock_at: null, kept_source: 'owner' }],
    // SA CR-1: an admin Keep from grace (never locked) must not make the login unbannable.
    ['kept by an admin but never locked (locked_at null)', { status: 'kept', lock_at: PAST, locked_at: null, kept_source: 'admin' }],
    ['kept by Stripe', { status: 'kept', lock_at: null, kept_source: 'stripe' }],
    ['still in grace', { status: 'grace', lock_at: PAST, kept_source: null }],
  ] as const)('refuses %s with no admin call', async (_name, latest) => {
    const { repo, adminCalls } = setup({ latest: latest as Closure | null });
    expect(code((await repo.unbanLogin(USER)).error)).toBe(LOCK_ERROR.NOT_UNLOCKABLE);
    expect(adminCalls).toEqual([]);
  });

  it.each([
    ['the placeholder email', { email: 'deleted-0123456789ab@deleted.invalid', banned_until: '2126-10-25T12:00:00Z', app_metadata: {} }],
    ['app_metadata.deleted', { email: EMAIL, banned_until: null, app_metadata: { deleted: true } }],
    ['a 100 year ban', { email: EMAIL, banned_until: '2126-10-25T12:00:00Z', app_metadata: {} }],
  ])('refuses a tombstone (%s) with no admin write', async (_name, user) => {
    const { repo, writes } = setup({ user });
    expect(code((await repo.unbanLogin(USER)).error)).toBe(LOCK_ERROR.TOMBSTONE);
    expect(writes()).toEqual([]);
  });

  it('a ten year stage D ban is not a tombstone', async () => {
    const { repo, writes } = setup({ user: { email: EMAIL, banned_until: '2036-10-25T12:00:00Z', app_metadata: {} } });
    expect((await repo.unbanLogin(USER)).error).toBeNull();
    expect(writes()).toHaveLength(1);
  });
});

describe('readLoginState', () => {
  it('reports the ban and the tombstone signals, never the email', async () => {
    const { repo } = setup({ user: { email: EMAIL, banned_until: '2036-10-25T12:00:00Z', app_metadata: {} } });
    expect(await repo.readLoginState(USER)).toEqual({ data: { exists: true, bannedUntil: '2036-10-25T12:00:00Z', isTombstone: false }, error: null });
  });

  it('exists false only on a definite 404', async () => {
    expect((await setup({ userError: { status: 404, message: 'x' } }).repo.readLoginState(USER)).data).toEqual({
      exists: false,
      bannedUntil: null,
      isTombstone: false,
    });
    const other = await setup({ userError: { status: 500, code: 'unexpected_failure', message: 'x' } }).repo.readLoginState(USER);
    expect(other.data).toBeNull();
    expect(code(other.error)).toBe('unexpected_failure');
  });

  it('a reply with no user and no error is an error', async () => {
    expect((await setup({ user: null }).repo.readLoginState(USER)).error).toBeTruthy();
  });
});

describe('cutSessions', () => {
  it('calls the session cut function with the user id only and maps the counts', async () => {
    const { repo, adminCalls } = setup();
    expect(await repo.cutSessions(USER)).toEqual({ data: { sessions: 2, refreshTokens: 3 }, error: null });
    expect(adminCalls).toEqual([{ method: 'rpc', args: [SESSION_CUT_FUNCTION, { p_user_id: USER }] }]);
  });

  it('42501 from the function is not_closing', async () => {
    const { repo } = setup({ rpc: { data: null, error: { code: '42501', message: 'account closure session cut: the account is not at its lock' } } });
    expect(code((await repo.cutSessions(USER)).error)).toBe(LOCK_ERROR.NOT_CLOSING);
  });

  it('another error keeps its code; a malformed answer is an error', async () => {
    expect(code((await setup({ rpc: { data: null, error: { code: 'XX000', message: 'boom' } } }).repo.cutSessions(USER)).error)).toBe('XX000');
    expect((await setup({ rpc: { data: { sessions: -1 }, error: null } }).repo.cutSessions(USER)).error).toBeTruthy();
  });
});

describe('logs', () => {
  it('never carry the email, on any path', async () => {
    await setup().repo.banLogin(USER);
    await setup().repo.unbanLogin(USER);
    await setup({ user: { email: EMAIL, banned_until: null, app_metadata: { deleted: true } } }).repo.banLogin(USER);
    await setup({ updateError: { status: 500, code: 'x', message: 'failed for owner+private@example.com' } }).repo.banLogin(USER);
    expect(JSON.stringify(logged)).not.toContain('example.com');
  });
});
