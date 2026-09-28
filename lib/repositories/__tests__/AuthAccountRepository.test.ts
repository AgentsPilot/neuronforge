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

describe('the door stays narrow', () => {
  const source = readFileSync(join(process.cwd(), 'lib', 'repositories', 'AuthAccountRepository.ts'), 'utf8');
  const code = source.replace(/^\s*\/\/.*$/gm, '');

  it('exposes only the methods Slice 1 needs', () => {
    const methods = Object.getOwnPropertyNames(AuthAccountRepository.prototype).filter((name) => name !== 'constructor');
    expect(methods).toEqual(['emailHasAccount']);
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
