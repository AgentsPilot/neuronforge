/**
 * `signInWithGoogleIdToken` (invite-only signup, Slice 3b, D-1, D-11): the
 * browser signs in with the same Google ID token the server just redeemed the
 * invite with. Supabase receives the RAW nonce; the audit records the method;
 * neither the token nor the nonce reaches a log line or an audit body.
 */

const signInCalls: unknown[] = [];
let signInAnswer: { data: { user: { id: string; email: string } | null }; error: { message: string; status?: number } | null } = {
  data: { user: { id: 'acct-1', email: 'invitee@gmail.com' } },
  error: null,
};

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithIdToken: async (credentials: unknown) => {
        signInCalls.push(credentials);
        return signInAnswer;
      },
    },
  },
}));

const logs: unknown[] = [];
jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logs.push(args);
  logger.child = () => logger;
  return { clientLogger: logger };
});

import { signInWithGoogleIdToken } from '../auth-actions';

const ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
const RAW_NONCE = 'r'.repeat(43);

let audits: Array<Record<string, unknown>> = [];

beforeEach(() => {
  signInCalls.length = 0;
  logs.length = 0;
  audits = [];
  signInAnswer = { data: { user: { id: 'acct-1', email: 'invitee@gmail.com' } }, error: null };
  global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    audits.push(JSON.parse(String(init?.body)));
    return { ok: true, status: 200 } as Response;
  }) as unknown as typeof fetch;
});

describe('signInWithGoogleIdToken', () => {
  it('passes the token and the RAW nonce to Supabase as provider google, and audits USER_LOGIN with the method', async () => {
    expect(await signInWithGoogleIdToken(ID_TOKEN, RAW_NONCE)).toMatchObject({ ok: true });
    expect(signInCalls).toEqual([{ provider: 'google', token: ID_TOKEN, nonce: RAW_NONCE }]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'USER_LOGIN', userId: 'acct-1', details: { login_method: 'google_id_token' } });
  });

  it('a refusal is audited USER_LOGIN_FAILED with no address, and returns ok: false', async () => {
    signInAnswer = { data: { user: null }, error: { message: 'Invalid nonce', status: 400 } };
    expect(await signInWithGoogleIdToken(ID_TOKEN, RAW_NONCE)).toEqual({ ok: false, error: 'Invalid nonce' });
    expect(audits[0]).toMatchObject({ action: 'USER_LOGIN_FAILED', userId: null, resourceName: 'google_id_token' });
  });

  it('neither the token nor the nonce is in any log line or audit body, on success or failure', async () => {
    await signInWithGoogleIdToken(ID_TOKEN, RAW_NONCE);
    signInAnswer = { data: { user: null }, error: { message: 'Invalid nonce', status: 400 } };
    await signInWithGoogleIdToken(ID_TOKEN, RAW_NONCE);
    const text = JSON.stringify({ logs, audits });
    expect(text).not.toContain(ID_TOKEN);
    expect(text).not.toContain(RAW_NONCE);
  });
});
