/**
 * AuthAccountRepository — the one door to `auth.users` for invite-only signup
 * (Slice 1a; requirement §16.5 L-3; workplan D-12, SA R-4).
 *
 * One test per method (new-repository skill), plus the properties the door
 * rests on: it asks a yes/no question through the hardened SQL function, it
 * never pages through users, it never deletes one (invariant I-1), it never
 * logs the email it was asked about, and "no account" is never the answer by
 * default.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PostgrestError } from '@supabase/postgrest-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (...args: unknown[]) => logged.push({ level, args });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { AuthAccountRepository, EMAIL_HAS_ACCOUNT_FUNCTION } from '../AuthAccountRepository';

const EMAIL = 'Dana@Example.com';

function rpcClient(result: { data: unknown; error: unknown }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

beforeEach(() => {
  logged.length = 0;
});

describe('emailHasAccount (L-3)', () => {
  it('calls the hardened SQL function with the trimmed, lower-cased email, and returns its boolean', async () => {
    const { client, calls } = rpcClient({ data: true, error: null });
    const result = await new AuthAccountRepository(client).emailHasAccount(`  ${EMAIL} `);
    expect(result).toEqual({ data: true, error: null });
    expect(calls).toEqual([{ fn: 'business_os_auth_email_has_account', args: { p_email: 'dana@example.com' } }]);
    expect(EMAIL_HAS_ACCOUNT_FUNCTION).toBe('business_os_auth_email_has_account');
  });

  it('returns false when no account uses the email', async () => {
    const { client } = rpcClient({ data: false, error: null });
    expect(await new AuthAccountRepository(client).emailHasAccount(EMAIL)).toEqual({ data: false, error: null });
  });

  it.each([null, undefined, 'true', 1, {}])(
    'a non-boolean result (%p) is an error, never "no account"',
    async (data) => {
      const { client } = rpcClient({ data, error: null });
      const result = await new AuthAccountRepository(client).emailHasAccount(EMAIL);
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
    }
  );

  it('an RPC error is returned scrubbed to { code, message }, and neither the error nor the log carries the email', async () => {
    const dbError = new PostgrestError({
      code: '42501',
      message: 'permission denied for function business_os_auth_email_has_account',
      details: `argument was ${EMAIL}`,
      hint: `hint mentions ${EMAIL}`,
    });
    const { client } = rpcClient({ data: null, error: dbError });
    const result = await new AuthAccountRepository(client).emailHasAccount(EMAIL);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error).not.toBe(dbError);
    expect(result.error).not.toHaveProperty('details');
    expect(result.error).not.toHaveProperty('hint');
    expect((result.error as Error & { code?: string }).code).toBe('42501');

    const logText = JSON.stringify(logged).toLowerCase();
    expect(logged.length).toBeGreaterThan(0);
    expect(logText).toContain('42501');
    expect(logText).not.toContain(EMAIL.toLowerCase());
  });

  it('never logs the email on success either', async () => {
    const { client } = rpcClient({ data: true, error: null });
    await new AuthAccountRepository(client).emailHasAccount(EMAIL);
    expect(JSON.stringify(logged).toLowerCase()).not.toContain(EMAIL.toLowerCase());
  });
});

const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const PASSWORD = 'correct horse battery';

function authClient(options: {
  create?: { data: unknown; error: unknown } | 'throw';
  getUser?: { data: unknown; error: unknown } | 'throw';
}) {
  const calls: Array<{ method: string; args: unknown }> = [];
  const client = {
    auth: {
      admin: {
        createUser: async (args: unknown) => {
          calls.push({ method: 'createUser', args });
          if (options.create === 'throw') throw Object.assign(new Error(`network down for ${EMAIL}`), { status: 500 });
          return options.create ?? { data: { user: { id: ACCOUNT } }, error: null };
        },
        getUserById: async (args: unknown) => {
          calls.push({ method: 'getUserById', args });
          if (options.getUser === 'throw') throw new Error('network down');
          return options.getUser ?? { data: { user: { id: ACCOUNT } }, error: null };
        },
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('createConfirmedUser (T-3 as amended, R-1, I-3)', () => {
  it('creates a confirmed user with exactly { id, email, password, email_confirm } and no metadata', async () => {
    const { client, calls } = authClient({});
    const result = await new AuthAccountRepository(client).createConfirmedUser({ id: ACCOUNT, email: EMAIL, password: PASSWORD });
    expect(result).toEqual({ ok: true, id: ACCOUNT });
    expect(calls).toEqual([{ method: 'createUser', args: { id: ACCOUNT, email: EMAIL, password: PASSWORD, email_confirm: true } }]);
  });

  it('returns the id the provider created, so the caller can refuse a mismatch (I-3)', async () => {
    const { client } = authClient({ create: { data: { user: { id: 'other-id' } }, error: null } });
    expect(await new AuthAccountRepository(client).createConfirmedUser({ id: ACCOUNT, email: EMAIL, password: PASSWORD })).toEqual({
      ok: true,
      id: 'other-id',
    });
  });

  it.each([
    ['email_exists', 'email_exists'],
    ['user_already_exists', 'email_exists'],
    ['weak_password', 'weak_password'],
    ['unexpected_failure', 'other'],
  ])('maps the auth error code %s to %s', async (code, kind) => {
    const { client } = authClient({ create: { data: { user: null }, error: { code, status: 422, message: `refused for ${EMAIL}` } } });
    const result = await new AuthAccountRepository(client).createConfirmedUser({ id: ACCOUNT, email: EMAIL, password: PASSWORD });
    expect(result).toMatchObject({ ok: false, kind, code });
  });

  it('a throw is an "other" failure, never an exception', async () => {
    const { client } = authClient({ create: 'throw' });
    const result = await new AuthAccountRepository(client).createConfirmedUser({ id: ACCOUNT, email: EMAIL, password: PASSWORD });
    expect(result).toMatchObject({ ok: false, kind: 'other' });
  });

  it('never logs the email or the password, on success or failure', async () => {
    await new AuthAccountRepository(authClient({}).client).createConfirmedUser({ id: ACCOUNT, email: EMAIL, password: PASSWORD });
    await new AuthAccountRepository(
      authClient({ create: { data: null, error: { code: 'weak_password', status: 422, message: `bad for ${EMAIL}` } } }).client
    ).createConfirmedUser({ id: ACCOUNT, email: EMAIL, password: PASSWORD });
    await new AuthAccountRepository(authClient({ create: 'throw' }).client).createConfirmedUser({ id: ACCOUNT, email: EMAIL, password: PASSWORD });
    const text = JSON.stringify(logged).toLowerCase();
    expect(text).not.toContain(EMAIL.toLowerCase());
    expect(text).not.toContain(PASSWORD);
  });
});

describe('createConfirmedUserWithoutPassword (Slice 3b, D-4)', () => {
  it('creates a confirmed user with exactly { id, email, email_confirm }: no password, no metadata', async () => {
    const { client, calls } = authClient({});
    const result = await new AuthAccountRepository(client).createConfirmedUserWithoutPassword({ id: ACCOUNT, email: EMAIL });
    expect(result).toEqual({ ok: true, id: ACCOUNT });
    expect(calls).toEqual([{ method: 'createUser', args: { id: ACCOUNT, email: EMAIL, email_confirm: true } }]);
  });

  it('returns the id the provider created, so the caller can refuse a mismatch (I-3)', async () => {
    const { client } = authClient({ create: { data: { user: { id: 'other-id' } }, error: null } });
    expect(await new AuthAccountRepository(client).createConfirmedUserWithoutPassword({ id: ACCOUNT, email: EMAIL })).toEqual({
      ok: true,
      id: 'other-id',
    });
  });

  it.each([
    ['email_exists', 'email_exists'],
    ['user_already_exists', 'email_exists'],
    // No password was sent, so there is nothing to be too weak: never the password-only class.
    ['weak_password', 'other'],
    ['unexpected_failure', 'other'],
  ])('maps the auth error code %s to %s, keeping the code', async (code, kind) => {
    const { client } = authClient({ create: { data: { user: null }, error: { code, status: 422, message: `refused for ${EMAIL}` } } });
    const result = await new AuthAccountRepository(client).createConfirmedUserWithoutPassword({ id: ACCOUNT, email: EMAIL });
    expect(result).toMatchObject({ ok: false, kind, code });
  });

  it('a throw is an "other" failure, never an exception', async () => {
    const { client } = authClient({ create: 'throw' });
    expect(await new AuthAccountRepository(client).createConfirmedUserWithoutPassword({ id: ACCOUNT, email: EMAIL })).toMatchObject({
      ok: false,
      kind: 'other',
    });
  });

  it('never logs the email, on success or failure', async () => {
    logged.length = 0;
    await new AuthAccountRepository(authClient({}).client).createConfirmedUserWithoutPassword({ id: ACCOUNT, email: EMAIL });
    await new AuthAccountRepository(
      authClient({ create: { data: null, error: { code: 'email_exists', status: 422, message: `taken: ${EMAIL}` } } }).client
    ).createConfirmedUserWithoutPassword({ id: ACCOUNT, email: EMAIL });
    await new AuthAccountRepository(authClient({ create: 'throw' }).client).createConfirmedUserWithoutPassword({ id: ACCOUNT, email: EMAIL });
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged).toLowerCase()).not.toContain(EMAIL.toLowerCase());
  });
});

describe('findUserExists (I-4, I-6, D-dev-2)', () => {
  it('true when the user exists, false only on a definite 404 / user_not_found', async () => {
    expect(await new AuthAccountRepository(authClient({}).client).findUserExists(ACCOUNT)).toEqual({ data: true, error: null });
    expect(
      await new AuthAccountRepository(authClient({ getUser: { data: { user: null }, error: { status: 404, message: 'not found' } } }).client).findUserExists(ACCOUNT)
    ).toEqual({ data: false, error: null });
    expect(
      await new AuthAccountRepository(authClient({ getUser: { data: { user: null }, error: { code: 'user_not_found', status: 400, message: 'x' } } }).client).findUserExists(ACCOUNT)
    ).toEqual({ data: false, error: null });
  });

  it('anything else is an error (the caller then keeps its claim: never release on uncertainty)', async () => {
    const failing = await new AuthAccountRepository(
      authClient({ getUser: { data: null, error: { status: 500, message: 'upstream' } } }).client
    ).findUserExists(ACCOUNT);
    expect(failing.data).toBeNull();
    expect(failing.error).toBeInstanceOf(Error);

    const thrown = await new AuthAccountRepository(authClient({ getUser: 'throw' }).client).findUserExists(ACCOUNT);
    expect(thrown.data).toBeNull();
    expect(thrown.error).toBeInstanceOf(Error);
  });
});

describe('the door stays narrow', () => {
  const source = readFileSync(join(process.cwd(), 'lib', 'repositories', 'AuthAccountRepository.ts'), 'utf8');
  const code = source.replace(/^\s*\/\/.*$/gm, '');

  it('exposes only the methods Slices 1 and 3b need (and no delete, invariant I-1)', () => {
    const methods = Object.getOwnPropertyNames(AuthAccountRepository.prototype).filter((name) => name !== 'constructor');
    expect(methods.sort()).toEqual(['createConfirmedUser', 'createConfirmedUserWithoutPassword', 'emailHasAccount', 'findUserExists']);
  });

  it('never pages through users and never deletes one (L-3, invariant I-1)', () => {
    expect(code).not.toMatch(/listUsers/);
    expect(code).not.toMatch(/deleteUser/);
    expect(code).not.toMatch(/\.from\(\s*['"]users['"]/);
  });

  it('states why it uses the service role', () => {
    expect(source).toContain('INTENTIONAL SERVICE-ROLE CLIENT (RLS bypass)');
  });
});
