/**
 * PUT /api/user/profile must not write `profiles.role`.
 *
 * The route builds a user-scoped (anon-key) Supabase client, so it writes with
 * the caller's own privileges — and the `profiles` UPDATE policy is
 * `USING (auth.uid() = id)` with no WITH CHECK and no column restriction.
 * While the route destructured `role` from the body, `PUT { role: 'admin' }`
 * on your own profile was therefore honoured by the database. Nothing
 * authorizes on that column (admin identity is `admin_users` via
 * AdminAccessService), so nothing was exploitable — but the column looks like
 * an authorization field, and one `WHERE role = 'admin'` would make it one.
 *
 * The important assertion is not "role is unchanged" — it is that the key is
 * **absent from the payload handed to Supabase**, because a payload that
 * carries the user's current role would start failing the moment the database
 * guard treats a re-assert as an attempt.
 */

import { NextRequest } from 'next/server';

const USER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/services/AuditTrailService', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

const CURRENT_PROFILE = {
  id: USER.id,
  full_name: 'Old Name',
  role: 'business_owner',
  timezone: 'UTC',
};

/** Every `.update()` / `.upsert()` payload the route sent, by table. */
const writes: Array<{ table: string; op: 'update' | 'upsert'; payload: Record<string, unknown> }> = [];

const mockGetUser = jest.fn();

function builder(table: string): any {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({
      // The read-back after an update returns the row with the writes applied,
      // so generateDiff sees a realistic before/after.
      data: writes.length
        ? { ...CURRENT_PROFILE, ...writes[writes.length - 1].payload }
        : CURRENT_PROFILE,
      error: null,
    }),
    update: (payload: Record<string, unknown>) => {
      writes.push({ table, op: 'update', payload });
      return chain;
    },
    upsert: (payload: Record<string, unknown>) => {
      writes.push({ table, op: 'upsert', payload });
      return chain;
    },
    then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
  };
  return chain;
}

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => builder(table),
  }),
}));

// Imported after the mocks are registered.
import { PUT } from '../route';

function put(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/user/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function profileWrite() {
  return writes.find(w => w.table === 'profiles');
}

beforeEach(() => {
  writes.length = 0;
  mockAuditLog.mockClear();
  mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
});

describe('PUT /api/user/profile', () => {
  it('ignores `role` in the body and never sends it to the database', async () => {
    const response = await PUT(put({ full_name: 'New Name', role: 'admin' }));

    // The save the user asked for still succeeds — the field is skipped, not rejected.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });

    const write = profileWrite();
    expect(write).toBeDefined();
    expect(write!.payload.full_name).toBe('New Name');
    expect(Object.keys(write!.payload)).not.toContain('role');
  });

  /*
   * The padded spellings matter beyond this route. The database guard
   * (20261002_profiles_role_privilege_guard.sql) first normalised with
   * `btrim`, which strips ASCII spaces only — so a tab-, newline- or
   * NBSP-padded 'admin' was stored verbatim, and JavaScript's `.trim()`, which
   * strips all three, would read it back as exactly 'admin'. The guard now
   * strips every non-alphanumeric character. This route reaches the same end by
   * never forwarding the field at all, however it is spelled.
   */
  it.each([
    'admin',
    'Administrator',
    'super_admin',
    'Super-Admin',
    'super admin',
    'service_role',
    '  ADMIN ',
    '\tadmin',
    'admin\n',
    ' admin ', // NBSP
    '​admin', // zero-width space
  ])('ignores the privileged value %j', async (role) => {
    await PUT(put({ full_name: 'New Name', role }));
    expect(Object.keys(profileWrite()!.payload)).not.toContain('role');
  });

  it('ignores `role` even when it is the only field sent', async () => {
    const response = await PUT(put({ role: 'admin' }));

    expect(response.status).toBe(200);
    // Only the timestamp the route always stamps — no user-supplied column.
    expect(Object.keys(profileWrite()!.payload)).toEqual(['updated_at']);
  });

  it('still writes the fields it does accept', async () => {
    await PUT(
      put({
        full_name: 'New Name',
        company: 'Acme',
        avatar_url: 'https://example.com/a.png',
        bio: 'hello',
        language: 'en',
      })
    );

    expect(profileWrite()!.payload).toMatchObject({
      full_name: 'New Name',
      company: 'Acme',
      avatar_url: 'https://example.com/a.png',
      bio: 'hello',
      language: 'en',
    });
  });

  it('still mirrors a timezone change to user_preferences', async () => {
    await PUT(put({ timezone: 'Asia/Jerusalem', role: 'admin' }));

    expect(profileWrite()!.payload).toMatchObject({ timezone: 'Asia/Jerusalem' });
    const mirror = writes.find(w => w.table === 'user_preferences');
    expect(mirror).toBeDefined();
    expect(mirror!.payload).toMatchObject({ user_id: USER.id, timezone: 'Asia/Jerusalem' });
  });

  it('returns 401 and writes nothing without a session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await PUT(put({ full_name: 'New Name', role: 'admin' }));

    expect(response.status).toBe(401);
    expect(writes).toHaveLength(0);
  });
});
