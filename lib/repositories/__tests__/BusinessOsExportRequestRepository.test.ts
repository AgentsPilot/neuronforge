/**
 * BusinessOsExportRequestRepository (module export MX-1a, workplan §4.2, T-3; SA M-7).
 *
 * A recording SupabaseClient is injected through the constructor, so each test
 * pins the exact call: the start function receives exactly the ids it was
 * given (session id for an owner, path id + admin id for an admin), invalid
 * input never reaches the database, and every outcome and error is typed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const logged: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logged.push(args);
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  BusinessOsExportRequestRepository,
  EXPORT_REQUEST_COLUMNS,
  EXPORT_REQUEST_ERROR,
  EXPORT_REQUEST_HISTORY_COLUMNS,
  EXPORT_REQUEST_START_FUNCTION,
  HISTORY_REQUEST_LIMIT,
  HISTORY_REQUEST_LIMIT_MAX,
} from '../BusinessOsExportRequestRepository';
import { START_OUTCOMES } from '@/lib/business-os/data-export/moduleExportPolicy';

type Call = { method: string; args: unknown[] };
type Result = { data?: unknown; error: unknown };

/** A recording client. `results` are handed out one per awaited query, in order. */
function client(...results: Result[]) {
  const calls: Call[] = [];
  let next = 0;
  const take = () => results[Math.min(next++, results.length - 1)] ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'maybeSingle', 'order', 'limit', 'update', 'is']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(take());
  const c = {
    from: (table: string) => (calls.push({ method: 'from', args: [table] }), builder),
    rpc: (name: string, params: unknown) => {
      calls.push({ method: 'rpc', args: [name, params] });
      return Promise.resolve(take());
    },
  } as unknown as SupabaseClient;
  return { c, calls };
}

const repo = (c: SupabaseClient) => new BusinessOsExportRequestRepository(c);

const OWNER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const T = '2026-10-27T10:00:00.000Z';

const started = { data: [{ result_outcome: 'started', result_request_id: REQUEST, result_retry_at: null }], error: null };

beforeEach(() => {
  logged.length = 0;
});

describe('startForOwner', () => {
  it('calls the start function with the session id, origin owner and no admin id', async () => {
    const { c, calls } = client(started);
    const result = await repo(c).startForOwner(OWNER, ['clients', 'bookings']);
    expect(result).toEqual({ data: { outcome: 'started', requestId: REQUEST }, error: null });
    expect(calls).toEqual([
      {
        method: 'rpc',
        args: [EXPORT_REQUEST_START_FUNCTION, { p_user_id: OWNER, p_origin: 'owner', p_admin_actor_id: null, p_modules: ['clients', 'bookings'] }],
      },
    ]);
  });

  it('answers in_progress and daily_limit with its retry time', async () => {
    const inProgress = client({ data: [{ result_outcome: 'in_progress', result_request_id: null, result_retry_at: null }], error: null });
    expect(await repo(inProgress.c).startForOwner(OWNER, ['clients'])).toEqual({ data: { outcome: 'in_progress' }, error: null });
    const limited = client({ data: [{ result_outcome: 'daily_limit', result_request_id: null, result_retry_at: T }], error: null });
    expect(await repo(limited.c).startForOwner(OWNER, ['clients'])).toEqual({ data: { outcome: 'daily_limit', retryAt: T }, error: null });
  });

  it('the three outcomes it parses are START_OUTCOMES', () => {
    expect([...START_OUTCOMES].sort()).toEqual(['daily_limit', 'in_progress', 'started']);
  });

  it.each([
    ['a non-uuid user id', 'not-a-uuid', ['clients']],
    ['no module', OWNER, []],
    ['an unknown module id', OWNER, ['clients', 'secrets']],
    ['a duplicate module', OWNER, ['clients', 'clients']],
    ['a module of another shape', OWNER, ['Clients']],
  ])('refuses %s before any database call', async (_name, userId, modules) => {
    const { c, calls } = client(started);
    const result = await repo(c).startForOwner(userId as string, modules as string[]);
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe(EXPORT_REQUEST_ERROR.INVALID_INPUT);
    expect(calls).toEqual([]);
  });
});

describe('startForAdmin', () => {
  it('sends the owner id from the path and the admin id, with origin admin', async () => {
    const { c, calls } = client(started);
    const result = await repo(c).startForAdmin(OWNER, ADMIN, ['invoices_payments']);
    expect(result.data).toEqual({ outcome: 'started', requestId: REQUEST });
    expect(calls[0]).toEqual({
      method: 'rpc',
      args: [EXPORT_REQUEST_START_FUNCTION, { p_user_id: OWNER, p_origin: 'admin', p_admin_actor_id: ADMIN, p_modules: ['invoices_payments'] }],
    });
  });

  it('refuses a missing or invalid admin id before any database call', async () => {
    const { c, calls } = client(started);
    expect((await repo(c).startForAdmin(OWNER, '', ['clients'])).error).toMatchObject({ code: EXPORT_REQUEST_ERROR.INVALID_INPUT });
    expect((await repo(c).startForAdmin(OWNER, 'admin', ['clients'])).error).toMatchObject({ code: EXPORT_REQUEST_ERROR.INVALID_INPUT });
    expect(calls).toEqual([]);
  });
});

describe('start result handling (SA M-7)', () => {
  it.each([
    ['zero rows', []],
    ['two rows', [started.data[0], started.data[0]]],
    ['an unknown outcome', [{ result_outcome: 'queued', result_request_id: null, result_retry_at: null }]],
    ['started without a request id', [{ result_outcome: 'started', result_request_id: null, result_retry_at: null }]],
    ['daily_limit without a retry time', [{ result_outcome: 'daily_limit', result_request_id: null, result_retry_at: null }]],
    ['no array at all', null],
  ])('%s is unexpected_result', async (_name, data) => {
    const { c, calls } = client({ data, error: null });
    const result = await repo(c).startForOwner(OWNER, ['clients']);
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ code: EXPORT_REQUEST_ERROR.UNEXPECTED_RESULT });
    expect(calls.filter((call) => call.method === 'rpc')).toHaveLength(1);
  });

  it.each([
    ['22023', EXPORT_REQUEST_ERROR.INVALID_ARGUMENTS],
    ['23503', EXPORT_REQUEST_ERROR.UNKNOWN_ACCOUNT],
  ])('Postgres %s maps to its own code, called once, never retried', async (pgCode, expected) => {
    const { c, calls } = client({ data: null, error: { code: pgCode, message: 'refused', details: 'secret detail' } });
    const result = await repo(c).startForOwner(OWNER, ['clients']);
    expect(result).toEqual({ data: null, error: expect.objectContaining({ code: expected }) });
    expect(calls).toHaveLength(1);
  });

  it('any other database error comes back as an error carrying only code and message, never a throw', async () => {
    const { c } = client({ data: null, error: { code: '57014', message: 'timeout', details: 'secret detail' } });
    const result = await repo(c).startForOwner(OWNER, ['clients']);
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ code: '57014', message: 'timeout' });
    expect(JSON.stringify(logged)).not.toContain('secret detail');
  });

  it('a throwing client is caught, never rethrown', async () => {
    const c = { rpc: () => Promise.reject(new Error('network down')) } as unknown as SupabaseClient;
    const result = await repo(c).startForOwner(OWNER, ['clients']);
    expect(result).toEqual({ data: null, error: expect.objectContaining({ message: 'network down' }) });
  });

  it('logs ids, the outcome and the module count, never the module list', async () => {
    const { c } = client(started);
    await repo(c).startForOwner(OWNER, ['clients', 'bookings']);
    const text = JSON.stringify(logged);
    expect(text).toContain(REQUEST);
    expect(text).toContain('"moduleCount":2');
    expect(text).not.toMatch(/"clients"|"bookings"|@/);
  });
});

describe('findByIdForUser', () => {
  const row = {
    id: REQUEST,
    user_id: OWNER,
    origin: 'owner',
    admin_actor_id: null,
    modules: ['clients'],
    requested_at: T,
    requested_email_sent_at: null,
    created_at: T,
    updated_at: T,
  };

  it('filters on id AND user_id with explicit columns', async () => {
    const { c, calls } = client({ data: row, error: null });
    const result = await repo(c).findByIdForUser(REQUEST, OWNER);
    expect(result).toEqual({ data: row, error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['business_os_export_requests'] },
      { method: 'select', args: [EXPORT_REQUEST_COLUMNS] },
      { method: 'eq', args: ['id', REQUEST] },
      { method: 'eq', args: ['user_id', OWNER] },
      { method: 'maybeSingle', args: [] },
    ]);
  });

  it('a foreign id matches nothing and answers null', async () => {
    const { c } = client({ data: null, error: null });
    expect(await repo(c).findByIdForUser(REQUEST, ADMIN)).toEqual({ data: null, error: null });
  });

  it('refuses a non-uuid before any call, and returns a database error', async () => {
    const bad = client({ data: row, error: null });
    expect((await repo(bad.c).findByIdForUser('x', OWNER)).error).toMatchObject({ code: EXPORT_REQUEST_ERROR.INVALID_INPUT });
    expect(bad.calls).toEqual([]);
    const failing = client({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect((await repo(failing.c).findByIdForUser(REQUEST, OWNER)).error).toMatchObject({ code: 'XX000' });
  });
});

describe('listRecentForUser (MX-1b history, §5 step 1)', () => {
  const REQUEST2 = '44444444-4444-4444-8444-444444444444';
  const row = (id: string, overrides: Record<string, unknown> = {}) => ({ id, origin: 'owner', modules: ['clients', 'quotes'], requested_at: T, ...overrides });

  it('filters on user_id and orders requested_at DESC, then id DESC (the tie-break), then limits REQUESTS', async () => {
    const { c, calls } = client({ data: [row(REQUEST2), row(REQUEST)], error: null });
    const result = await repo(c).listRecentForUser(OWNER);
    expect(calls).toEqual([
      { method: 'from', args: ['business_os_export_requests'] },
      { method: 'select', args: [EXPORT_REQUEST_HISTORY_COLUMNS] },
      { method: 'eq', args: ['user_id', OWNER] },
      { method: 'order', args: ['requested_at', { ascending: false }] },
      { method: 'order', args: ['id', { ascending: false }] },
      { method: 'limit', args: [HISTORY_REQUEST_LIMIT] },
    ]);
    expect(result).toEqual({
      data: [
        { id: REQUEST2, origin: 'owner', modules: ['clients', 'quotes'], requestedAt: T },
        { id: REQUEST, origin: 'owner', modules: ['clients', 'quotes'], requestedAt: T },
      ],
      error: null,
    });
    expect(EXPORT_REQUEST_HISTORY_COLUMNS).not.toMatch(/\*|admin_actor_id|user_id/);
  });

  it.each([
    [undefined, HISTORY_REQUEST_LIMIT],
    [0, 1],
    [-3, 1],
    [999, HISTORY_REQUEST_LIMIT_MAX],
    [2.5, HISTORY_REQUEST_LIMIT],
    [7, 7],
  ])('limit %p is clamped to %p', async (limit, expected) => {
    const { c, calls } = client({ data: [], error: null });
    await repo(c).listRecentForUser(OWNER, limit === undefined ? {} : { limit });
    expect(calls.find((call) => call.method === 'limit')?.args).toEqual([expected]);
  });

  it('a malformed row is dropped and logged by id; the rest are returned', async () => {
    const { c } = client({ data: [row(REQUEST2, { origin: 'robot' }), row(REQUEST)], error: null });
    const result = await repo(c).listRecentForUser(OWNER);
    expect(result.data?.map((r) => r.id)).toEqual([REQUEST]);
    expect(logged.some((args) => (args[0] as Record<string, unknown>).requestId === REQUEST2)).toBe(true);
  });

  it('refuses a non-uuid user id before any call; a DB error is { error }, never a throw', async () => {
    const bad = client({ data: [], error: null });
    expect((await repo(bad.c).listRecentForUser('nope')).error).toMatchObject({ code: EXPORT_REQUEST_ERROR.INVALID_INPUT });
    expect(bad.calls).toEqual([]);
    const failing = client({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect(await repo(failing.c).listRecentForUser(OWNER)).toEqual({ data: null, error: expect.objectContaining({ code: 'XX000' }) });
  });
});

describe('markRequestedEmailSent (MX-1b, compare-and-set)', () => {
  it('updates only the row of this account while the column is NULL, counted exactly, with no select after the update', async () => {
    const { c, calls } = client({ error: null, count: 1 } as Result);
    const result = await repo(c).markRequestedEmailSent(REQUEST, OWNER);
    expect(result).toEqual({ data: { updated: true }, error: null });
    expect(calls.map((call) => call.method)).toEqual(['from', 'update', 'eq', 'eq', 'is']);
    expect(calls[0].args).toEqual(['business_os_export_requests']);
    const [payload, options] = calls[1].args as [Record<string, unknown>, unknown];
    expect(Object.keys(payload).sort()).toEqual(['requested_email_sent_at', 'updated_at']);
    expect(options).toEqual({ count: 'exact' });
    expect(calls[2].args).toEqual(['id', REQUEST]);
    expect(calls[3].args).toEqual(['user_id', OWNER]);
    expect(calls[4].args).toEqual(['requested_email_sent_at', null]);
    expect(calls.some((call) => call.method === 'select')).toBe(false);
  });

  it('count 0 (already marked, or another account) is updated: false and not an error', async () => {
    const { c } = client({ error: null, count: 0 } as Result);
    expect(await repo(c).markRequestedEmailSent(REQUEST, OWNER)).toEqual({ data: { updated: false }, error: null });
  });

  it('refuses bad ids before any call; a DB error is { error }, never a throw', async () => {
    for (const [requestId, userId] of [['nope', OWNER], [REQUEST, 'nope']]) {
      const bad = client({ error: null });
      expect((await repo(bad.c).markRequestedEmailSent(requestId, userId)).error).toMatchObject({ code: EXPORT_REQUEST_ERROR.INVALID_INPUT });
      expect(bad.calls).toEqual([]);
    }
    const failing = client({ error: { code: 'XX000', message: 'boom' } });
    expect(await repo(failing.c).markRequestedEmailSent(REQUEST, OWNER)).toEqual({ data: null, error: expect.objectContaining({ code: 'XX000' }) });
  });
});
