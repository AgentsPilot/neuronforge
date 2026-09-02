/**
 * Identity-hardening regression locks for /api/plugin-connections.
 *
 * Before this change all three handlers took `user_id` from the caller with no
 * authentication. The worst was `GET ?plugin_key=…&user_id=…`, which returned
 * decryptCredentials(...) — the stored username/password in plaintext — to anyone.
 * That branch is deleted; these tests lock that it cannot come back silently.
 *
 * Workplan: docs/workplans/BUSINESS_OS_PLUGIN_ROUTE_IDENTITY_HARDENING_WORKPLAN.md
 */

const resolveActingUserIdentity = jest.fn();
const decryptCredentials = jest.fn();
const encryptCredentials = jest.fn((..._args: unknown[]) => 'encrypted-blob');
const from = jest.fn();

jest.mock('@/lib/server/route-identity', () => ({
  resolveActingUserIdentity: (...args: unknown[]) => resolveActingUserIdentity(...args),
}));

jest.mock('@/lib/encryptCredentials', () => ({
  encryptCredentials: (...args: unknown[]) => encryptCredentials(...args),
  decryptCredentials: (...args: unknown[]) => decryptCredentials(...args),
}));

jest.mock('@/lib/supabaseServer', () => ({
  createServerSupabaseClient: () => ({ from: (t: string) => from(t) }),
}));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: jest.fn().mockResolvedValue(undefined) }) },
}));

import { NextRequest } from 'next/server';
import { POST, DELETE, GET } from '../route';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const VICTIM_ID = '22222222-2222-4222-8222-222222222222';

const UNAUTHENTICATED = { ok: false, status: 401, error: 'Authentication required' };
const SELF = {
  ok: true,
  userId: SESSION_ID,
  sessionUserId: SESSION_ID,
  sessionUserEmail: 'op@example.com',
  actingAs: false,
};

/** select().eq() chain used by GET; insert()/delete().eq().eq() used by POST/DELETE. */
function mockTable(rows: any[] = []) {
  const chain: any = {
    select: jest.fn(() => chain),
    insert: jest.fn(async () => ({ error: null })),
    delete: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    then: undefined,
  };
  // Terminal await on the select/delete chain
  chain.eq = jest.fn(() => Object.assign(Promise.resolve({ data: rows, error: null }), chain));
  return chain;
}

describe('/api/plugin-connections identity hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveActingUserIdentity.mockResolvedValue(SELF);
    from.mockReturnValue(mockTable([]));
  });

  it('POST refuses unauthenticated and never writes a connection', async () => {
    resolveActingUserIdentity.mockResolvedValue(UNAUTHENTICATED);

    const res = await POST(
      new NextRequest('http://localhost/api/plugin-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: VICTIM_ID,
          plugin_key: 'notion',
          username: 'attacker',
          password: 'hunter2',
          access_token: 'attacker-token',
        }),
      })
    );

    expect(res.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it('DELETE refuses unauthenticated and never deletes', async () => {
    resolveActingUserIdentity.mockResolvedValue(UNAUTHENTICATED);

    const res = await DELETE(
      new NextRequest(
        `http://localhost/api/plugin-connections?plugin_key=google-mail&user_id=${VICTIM_ID}`,
        { method: 'DELETE' }
      )
    );

    expect(res.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it('GET refuses unauthenticated', async () => {
    resolveActingUserIdentity.mockResolvedValue(UNAUTHENTICATED);

    const res = await GET(
      new NextRequest(`http://localhost/api/plugin-connections?user_id=${VICTIM_ID}`, {
        method: 'GET',
      })
    );

    expect(res.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  // The deleted credential branch: even authenticated, and even when asked the exact way
  // the old exploit did, the response must never carry decrypted credentials.
  it('GET never returns decrypted credentials, even with plugin_key + user_id', async () => {
    from.mockReturnValue(
      mockTable([{ plugin_key: 'notion', created_at: '2026-01-01', access_token: 'tok' }])
    );

    const res = await GET(
      new NextRequest(
        `http://localhost/api/plugin-connections?plugin_key=notion&user_id=${SESSION_ID}`,
        { method: 'GET' }
      )
    );

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(decryptCredentials).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty('credentials');
    expect(body.plugins).toBeDefined();
  });

  it('GET does not send a public cache directive', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/plugin-connections', { method: 'GET' })
    );

    expect(res.headers.get('Cache-Control') ?? '').not.toContain('public');
  });
});
