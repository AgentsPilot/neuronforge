/**
 * GET /api/business-os/account/closure (DL-2a; DL-2 workplan §5.1, §12 T-4;
 * SA W-4). The real route and the real view over mocked edges: the session,
 * the throttle and the production ports (`closureStatusDeps`).
 */

import { NextRequest } from 'next/server';
import type { ClosureStatusDeps } from '@/lib/business-os/account-deletion/closureStatusDeps';
import type { ClosureStatusRow, TimezoneRead } from '@/lib/business-os/account-deletion/closureStatusView';

const FLAG = 'BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED';
const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EMAIL = 'jane.owner@example.org';
const ENDS = '2026-11-26T10:00:00.000Z';

const mockLogged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => mockLogged.push(...args);
  logger.child = (...args: unknown[]) => {
    mockLogged.push(...args);
    return logger;
  };
  return { createLogger: () => logger };
});
const mockSession = jest.fn();
jest.mock('@/lib/business-os/account-deletion/sessionSubject', () => {
  const actual = jest.requireActual('@/lib/business-os/account-deletion/sessionSubject');
  return { ...actual, readSessionSubject: () => mockSession() };
});
const mockRateLimit = jest.fn();
jest.mock('@/lib/security/rateLimit', () => {
  const actual = jest.requireActual('@/lib/security/rateLimit');
  return { ...actual, rateLimit: (...args: unknown[]) => mockRateLimit(...args) };
});
jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({
  errorKindFacts: (err: unknown) => ({ kind: null, code: null, name: err instanceof Error ? err.name : null }),
}));

let open: { data: ClosureStatusRow | null; error: Error | null };
let zone: TimezoneRead;
let depsThrow: boolean;
const readOpen = jest.fn();
const readTimezone = jest.fn();
jest.mock('@/lib/business-os/account-deletion/closureStatusDeps', () => ({
  closureStatusDeps: (): ClosureStatusDeps => {
    if (depsThrow) throw new Error('boom: relation "secret_table" does not exist');
    return {
      readOpen: async (userId) => {
        readOpen(userId);
        return open;
      },
      readTimezone: async (userId) => {
        readTimezone(userId);
        return zone;
      },
    };
  },
}));

import { GET } from '../route';
import { closureStatusResponseSchema } from '@/lib/business-os/account-deletion/schemas';
import { closureLockAt } from '@/lib/business-os/account-deletion/closureDates';

const req = (query = '') =>
  new NextRequest(`http://localhost/api/business-os/account/closure${query}`, {
    method: 'GET',
    headers: { 'x-correlation-id': 'corr-c' },
  });

const PENDING: ClosureStatusRow = { status: 'pending', renewal_was_on: true, plan_ends_at: ENDS, lock_at: null, lock_timezone: null };
const originalEnv = process.env.NODE_ENV;

beforeEach(() => {
  mockLogged.length = 0;
  readOpen.mockReset();
  readTimezone.mockReset();
  open = { data: PENDING, error: null };
  zone = { ok: true, stored: 'Asia/Jerusalem' };
  depsThrow = false;
  process.env[FLAG] = 'true';
  mockSession.mockReset().mockResolvedValue({ id: SUBJECT, email: EMAIL });
  mockRateLimit.mockReset().mockResolvedValue({ allowed: true, hits: 1, degraded: false });
});

afterAll(() => {
  delete process.env[FLAG];
  (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
});

describe('happy path', () => {
  it('a pending row → 200 with the projected lock in the owner zone, parsed by the route schema, no-store', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    const body = await res.json();
    expect(closureStatusResponseSchema.safeParse(body).success).toBe(true);
    expect(body.data.closure).toEqual({
      status: 'pending',
      planEndsAt: ENDS,
      lockAt: closureLockAt(new Date(ENDS), 'Asia/Jerusalem').lockAt,
      lockAtIsProjected: true,
      timezone: 'Asia/Jerusalem',
      renewalWasOn: true,
      graceDays: 14,
    });
    expect(body.correlationId).toBe('corr-c');
  });

  it('no open row → 200 { closure: null }, the timezone never read', async () => {
    open = { data: null, error: null };
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ closure: null });
    expect(readTimezone).not.toHaveBeenCalled();
  });

  it('a grace row → the stored date, the timezone not read', async () => {
    open = { data: { status: 'grace', renewal_was_on: false, plan_ends_at: null, lock_at: '2026-12-01T22:00:00.000Z', lock_timezone: 'Asia/Jerusalem' }, error: null };
    const body = await (await GET(req())).json();
    expect(body.data.closure).toMatchObject({ status: 'grace', lockAt: '2026-12-01T22:00:00.000Z', lockAtIsProjected: false, timezone: 'Asia/Jerusalem' });
    expect(readTimezone).not.toHaveBeenCalled();
  });

  it.each([undefined, 'false', 'true'])('the request switch %s does not change the answer (not behind it, D-2)', async (value) => {
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).data.closure.status).toBe('pending');
  });
});

describe('W-4 d: the timezone read failed', () => {
  it('lockAt null, timezone UTC, no plan end: nothing is formatted on a guessed zone', async () => {
    zone = { ok: false };
    const body = await (await GET(req())).json();
    expect(body.data.closure).toMatchObject({ status: 'pending', planEndsAt: null, lockAt: null, lockAtIsProjected: false, timezone: 'UTC' });
  });
});

describe('auth failure', () => {
  it('no session → 401 no-store, nothing read', async () => {
    mockSession.mockResolvedValueOnce(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(readOpen).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it('the session check throws → 401, nothing read', async () => {
    mockSession.mockRejectedValueOnce(new Error('auth down'));
    expect((await GET(req())).status).toBe(401);
    expect(readOpen).not.toHaveBeenCalled();
  });
});

describe('invalid input: the request cannot steer the read (W-4 a)', () => {
  it('?userId=<another uuid>&status=locked is ignored; only the session id is read', async () => {
    const res = await GET(req(`?userId=${OTHER}&status=locked&user_id=${OTHER}`));
    expect(res.status).toBe(200);
    expect(readOpen).toHaveBeenCalledTimes(1);
    expect(readOpen).toHaveBeenCalledWith(SUBJECT);
    expect(readTimezone).toHaveBeenCalledWith(SUBJECT);
    expect((await res.json()).data.closure.status).toBe('pending');
    expect(JSON.stringify(mockLogged)).not.toContain(OTHER);
  });
});

describe('failures', () => {
  it('throttled → 429 no-store; the key is account-closure, hashed, on the read preset', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, hits: 999, degraded: false });
    const res = await GET(req());
    expect(res.status).toBe(429);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(mockRateLimit.mock.calls[0][1]).toMatch(/^account-closure:[0-9a-f]{16}$/);
    expect(readOpen).not.toHaveBeenCalled();
  });

  it('the open-row read errors → 503 try_again no-store', async () => {
    open = { data: null, error: new Error('db down') };
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect((await res.json()).error).toBe('try_again');
  });

  it('an unexpected throw → 500 no-store, no details outside development', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    depsThrow = true;
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    const body = await res.json();
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('secret_table');
  });

  it('details only in development', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    depsThrow = true;
    expect((await (await GET(req())).json()).details).toContain('boom');
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
  });
});

describe('what never leaves', () => {
  it('no email in the body or any log call', async () => {
    const res = await GET(req());
    const text = JSON.stringify([await res.json(), mockLogged]);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toMatch(/reason_code|reasonCode|statement_language/);
  });
});
