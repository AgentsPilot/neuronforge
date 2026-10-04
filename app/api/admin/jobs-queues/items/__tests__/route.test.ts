/**
 * GET /api/admin/jobs-queues/items — the read-only queue item list
 * (ADMIN_BOS_CLEANUP slice 7a; SA C7-12, C7-13, C7-14; workplan §5.1, §5.2,
 * §5.6, §5.7 and conditions W7A-2, W7A-8, W7A-9).
 *
 *   G  the gate comes first: 401/403 with nothing read (the four denial cases
 *      C7-14 asks for), 401 before 400, and the source position
 *   Z  strict Zod → 400 with nothing read; the defaults
 *   P  every queue × state reaches the repository once, with the admin
 *      context, the minute-floored clock, the page and a signal; paging
 *   N  business names: one lookup with the distinct ids; a failed or slow
 *      lookup still serves the list
 *   E  past the end (W7A-2) is a 200 empty page; a failed read is a 500
 *   S  sentinel over the body and every log argument; no write, no audit
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const mockList = jest.fn();
const mockFigures = jest.fn();
jest.mock('@/lib/repositories/AdminJobsQueuesRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/AdminJobsQueuesRepository');
  return {
    ...actual,
    adminJobsQueuesRepository: {
      listQueueItemsAllAccounts: (...a: unknown[]) => mockList(...a),
      readQueueFiguresAllAccounts: (...a: unknown[]) => mockFigures(...a),
    },
  };
});

const mockNames = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findAdminIdentitiesByUserIds: (...a: unknown[]) => mockNames(...a) },
}));

// S-3: neither audit path may be touched by a read.
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...a: unknown[]) => mockLogAndFlush(...a) }));
const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: (...a: unknown[]) => mockAuditLog(...a) }) },
}));

import { GET } from '../route';
import { BOS_QUEUES } from '@/lib/cron/bosCronJobs';
import { QUEUE_ITEM_QUEUE_IDS, QUEUE_ITEM_STATES } from '@/lib/admin/jobs/buildQueueItemsView';
import {
  ADMIN_QUEUE_SPECS,
  ADMIN_QUEUE_ITEM_STATES,
  type RawQueueItem,
} from '@/lib/repositories/AdminJobsQueuesRepository';
import type { QueueItemsView } from '@/lib/admin/jobs/jobsQueuesTypes';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const URL_BASE = 'http://localhost/api/admin/jobs-queues/items';

function req(query = '?queue=lead_responses') {
  return new NextRequest(`${URL_BASE}${query}`, { headers: { 'x-correlation-id': 'corr-items' } });
}

type Body = { success: boolean; error?: string; code?: string; details?: string; data?: QueueItemsView };
const json = async (res: Response) => (await res.json()) as Body;

function raw(overrides: Partial<RawQueueItem> = {}): RawQueueItem {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    userId: 'user-1',
    status: 'failed',
    attempts: 2,
    claimedAt: null,
    createdAt: '2026-10-04T09:00:00.000Z',
    scheduledAt: '2026-10-04T08:00:00.000Z',
    nextAttemptAt: null,
    kind: 'chase',
    briefingDate: '2026-10-04',
    timezone: 'UTC',
    ...overrides,
  };
}

const reads = () => [mockList, mockNames, mockFigures];
const allLogs = () =>
  JSON.stringify([...mockLog.info.mock.calls, ...mockLog.warn.mock.calls, ...mockLog.error.mock.calls, ...mockLog.debug.mock.calls]);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
  mockList.mockResolvedValue({ data: { rows: [raw()], total: 1 }, error: null });
  mockNames.mockResolvedValue({ data: [{ user_id: 'user-1', company_name: 'Acme', vertical: 'trades', sub_vertical: null }], error: null });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('G: the gate comes first (C7-14)', () => {
  it('G-1 signed out → 401, nothing read', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('G-2 signed in, not an admin → 403, nothing read', async () => {
    mockIsAdmin.mockResolvedValue(false);
    expect((await GET(req())).status).toBe(403);
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('G-3 the admin check throws → 403 (fail closed), nothing read', async () => {
    mockIsAdmin.mockRejectedValue(new Error('boom'));
    expect((await GET(req())).status).toBe(403);
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('G-4 the auth lookup throws → 401, nothing read', async () => {
    mockGetUser.mockRejectedValue(new Error('supabase down'));
    expect((await GET(req())).status).toBe(401);
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('G-5 an invalid query while signed out → 401, not 400; not an admin → 403', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await GET(req('?queue=nope&accountId=x'))).status).toBe(401);
    mockGetUser.mockResolvedValue(ADMIN);
    mockIsAdmin.mockResolvedValue(false);
    expect((await GET(req('?queue=nope'))).status).toBe(403);
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('G-6 source: inside GET, requireAdmin( is preceded only by the correlation id and logger.child', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const handler = code.match(/export async function GET\(request: NextRequest\) \{([\s\S]*)$/);
    expect(handler).not.toBeNull();
    const statements = handler![1]
      .split('await requireAdmin(')[0]
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^const correlationId = request\.headers\.get\('x-correlation-id'\) \|\| crypto\.randomUUID\(\)$/);
    expect(statements[1]).toMatch(/^const requestLogger = logger\.child\(\{ correlationId, route: ROUTE \}\)$/);
    expect(statements[2]).toBe('const gate =');
    expect(code.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)).toEqual(['export async function GET']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Z: strict Zod → 400, nothing read', () => {
  it.each([
    ['no queue', ''],
    ['an unknown queue', '?queue=nope'],
    ['an empty queue', '?queue='],
    ['an unknown state', '?queue=lead_responses&state=cancelled'],
    ['an empty state', '?queue=lead_responses&state='],
    ['page 0', '?queue=lead_responses&page=0'],
    ['page 21', '?queue=lead_responses&page=21'],
    ['page abc', '?queue=lead_responses&page=abc'],
    ['page 1.5', '?queue=lead_responses&page=1.5'],
    ['an accountId', '?queue=lead_responses&accountId=22222222-2222-4222-8222-222222222222'],
    ['a userId', '?queue=lead_responses&userId=22222222-2222-4222-8222-222222222222'],
    ['a limit', '?queue=lead_responses&limit=500'],
  ])('Z: %s', async (_name, query) => {
    const res = await GET(req(query));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body).toMatchObject({ success: false, code: 'invalid_input', error: 'Choose a queue, a state and a page from the list' });
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('Z-5: queue only → state stuck, page 1', async () => {
    const res = await GET(req('?queue=lead_responses'));
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ queue: 'lead_responses', state: 'stuck', page: 1 });
    expect(mockList.mock.calls[0].slice(1, 3)).toEqual(['lead_responses', 'stuck']);
    expect(mockList.mock.calls[0][4]).toEqual({ page: 1 });
  });

  it('Z-6: details only in development', async () => {
    const env = process.env as Record<string, string | undefined>;
    const original = env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      expect((await json(await GET(req('?queue=nope')))).details).toBeUndefined();
      env.NODE_ENV = 'development';
      expect((await json(await GET(req('?queue=nope')))).details).toBeTruthy();
    } finally {
      env.NODE_ENV = original;
    }
  });

  it('Z-7: the queue ids and states are set-equal to the platform lists', () => {
    expect([...QUEUE_ITEM_QUEUE_IDS].sort()).toEqual(BOS_QUEUES.map((q) => q.id).sort());
    expect([...QUEUE_ITEM_QUEUE_IDS].sort()).toEqual(Object.keys(ADMIN_QUEUE_SPECS).sort());
    expect([...QUEUE_ITEM_STATES]).toEqual([...ADMIN_QUEUE_ITEM_STATES]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P: every queue and state, with the admin context and one clock', () => {
  const cases = QUEUE_ITEM_QUEUE_IDS.flatMap((queue) => QUEUE_ITEM_STATES.map((state) => [queue, state] as const));

  it.each(cases)('%s / %s', async (queue, state) => {
    const before = Date.now();
    const res = await GET(req(`?queue=${queue}&state=${state}`));
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledTimes(1);
    const [context, q, s, now, page, options] = mockList.mock.calls[0];
    expect(context).toEqual({ correlationId: 'corr-items', adminId: ADMIN.id });
    expect([q, s]).toEqual([queue, state]);
    // W7A-8: the minute-floored clock, the same as the card's.
    expect((now as Date).getTime() % 60_000).toBe(0);
    expect((now as Date).getTime()).toBeGreaterThan(before - 120_000);
    expect(page).toEqual({ page: 1 });
    expect((options as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
    const body = await json(res);
    expect(body.data).toMatchObject({ queue, state, page: 1, pageSize: 50, maxPage: 20, total: 1, hasMore: false });
    expect(body.data!.now).toBe((now as Date).toISOString());
  });

  it('page=3 reaches the repository; hasMore from total', async () => {
    mockList.mockResolvedValue({ data: { rows: [raw()], total: 132 }, error: null });
    expect((await json(await GET(req('?queue=lead_responses&state=failed&page=2')))).data).toMatchObject({ page: 2, hasMore: true, total: 132 });
    const res = await GET(req('?queue=lead_responses&state=failed&page=3'));
    expect(mockList.mock.calls[1][4]).toEqual({ page: 3 });
    expect((await json(res)).data).toMatchObject({ page: 3, hasMore: false });
  });

  it('a repeated parameter is resolved (last wins) and still validated', async () => {
    expect((await GET(req('?queue=nope&queue=lead_responses'))).status).toBe(200);
    expect((await GET(req('?queue=lead_responses&queue=nope'))).status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('N: business names', () => {
  it('one lookup with the distinct ids of the page (50 rows from 3 accounts → 3 ids)', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => raw({ id: `item-${i}`, userId: `user-${i % 3}` }));
    mockList.mockResolvedValue({ data: { rows, total: 50 }, error: null });
    await GET(req('?queue=lead_responses&state=failed'));
    expect(mockNames).toHaveBeenCalledTimes(1);
    expect([...(mockNames.mock.calls[0][0] as string[])].sort()).toEqual(['user-0', 'user-1', 'user-2']);
  });

  it('no rows → no lookup', async () => {
    mockList.mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
    const res = await GET(req('?queue=lead_responses&state=failed'));
    expect(res.status).toBe(200);
    expect(mockNames).not.toHaveBeenCalled();
  });

  it('the lookup fails → 200, "Name not available", one warn with a class and no message', async () => {
    mockNames.mockResolvedValue({ data: null, error: Object.assign(new Error('SENTINEL-NAME-ERR'), { code: '57014' }) });
    const res = await GET(req('?queue=lead_responses&state=failed'));
    expect(res.status).toBe(200);
    expect((await json(res)).data!.items[0].businessName).toBe('Name not available');
    const warns = mockLog.warn.mock.calls.filter(([, msg]) => msg === 'Business names could not be read for the queue items');
    expect(warns).toHaveLength(1);
    expect(warns[0][0]).toMatchObject({ code: '57014' });
    expect(allLogs()).not.toContain('SENTINEL-NAME-ERR');
  });

  it('the lookup throws → 200, "Name not available"', async () => {
    mockNames.mockRejectedValue(new Error('SENTINEL-THROWN'));
    const res = await GET(req('?queue=lead_responses&state=failed'));
    expect(res.status).toBe(200);
    expect((await json(res)).data!.items[0].businessName).toBe('Name not available');
    expect(allLogs()).not.toContain('SENTINEL-THROWN');
  });

  it('the lookup times out → 200, "Name not available" (W7A-9: the wait stops; the request cannot be cancelled)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      mockNames.mockImplementation(() => new Promise(() => undefined));
      const pending = GET(req('?queue=lead_responses&state=failed'));
      await jest.advanceTimersByTimeAsync(5_001);
      const res = await pending;
      expect(res.status).toBe(200);
      expect((await json(res)).data!.items[0].businessName).toBe('Name not available');
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E: past the end, and failures', () => {
  it('W7A-2: a page past the end (total null) → 200, items [], hasMore false, total null', async () => {
    mockList.mockResolvedValue({ data: { rows: [], total: null }, error: null });
    const res = await GET(req('?queue=lead_responses&state=waiting&page=2'));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ page: 2, items: [], hasMore: false, total: null });
    expect(Object.keys(body.data!).sort()).toEqual(['hasMore', 'items', 'maxPage', 'now', 'page', 'pageSize', 'queue', 'state', 'total'].sort());
    expect(mockNames).not.toHaveBeenCalled();
  });

  it('W7A-2 end to end: the real repository maps PostgREST PGRST103 to that empty page', async () => {
    const { AdminJobsQueuesRepository } = jest.requireActual('@/lib/repositories/AdminJobsQueuesRepository');
    const client = recordingClient(() => ({ data: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' }, count: null }));
    const repo = new AdminJobsQueuesRepository(client.client);
    mockList.mockImplementation((...a: unknown[]) => repo.listQueueItemsAllAccounts(...a));
    const res = await GET(req('?queue=lead_responses&state=waiting&page=2'));
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ items: [], hasMore: false, total: null });
  });

  it('the items read fails → 500, standard format, no items; the message only in development', async () => {
    mockList.mockResolvedValue({ data: null, error: new Error('relation SENTINEL-TABLE does not exist') });
    const env = process.env as Record<string, string | undefined>;
    const original = env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      const res = await GET(req('?queue=lead_responses&state=failed'));
      expect(res.status).toBe(500);
      const body = await json(res);
      expect(body).toEqual({ success: false, error: 'Could not load the items just now' });
      expect(JSON.stringify(body)).not.toContain('SENTINEL');
      expect(allLogs()).not.toContain('SENTINEL');
      expect(mockNames).not.toHaveBeenCalled();
      env.NODE_ENV = 'development';
      expect((await json(await GET(req('?queue=lead_responses&state=failed')))).details).toContain('SENTINEL-TABLE');
    } finally {
      env.NODE_ENV = original;
    }
  });

  it('the items read times out → 500', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      mockList.mockImplementation(() => new Promise(() => undefined));
      const pending = GET(req('?queue=lead_responses&state=failed'));
      await jest.advanceTimersByTimeAsync(5_001);
      const res = await pending;
      expect(res.status).toBe(500);
      expect((await json(res)).error).toBe('Could not load the items just now');
    } finally {
      jest.useRealTimers();
    }
  });

  it('the served log line carries counts only', async () => {
    await GET(req('?queue=lead_responses&state=failed'));
    const served = mockLog.info.mock.calls.find(([, msg]) => msg === 'Queue items served');
    expect(served?.[0]).toMatchObject({
      adminUserId: ADMIN.id,
      queue: 'lead_responses',
      state: 'failed',
      page: 1,
      returned: 1,
      total: 1,
      namesResolved: 1,
      namesFailed: false,
    });
    expect(JSON.stringify(served)).not.toMatch(/Acme|user-1|aaaaaaaa/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/** A recording Supabase client (every builder call, writes included). */
function recordingClient(result: () => { data: unknown; error: unknown; count?: number | null }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  for (const method of [
    'select', 'eq', 'lte', 'lt', 'gte', 'gt', 'is', 'in', 'not', 'or', 'order', 'limit', 'range', 'abortSignal',
    'insert', 'update', 'upsert', 'delete',
  ]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(result());
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
    rpc: (...args: unknown[]) => {
      calls.push({ method: 'rpc', args });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('S: nothing leaks, nothing is written', () => {
  const PLANTED = {
    userId: 'SENTINEL-ACCOUNT',
    timezone: 'SENTINEL/Zone',
    kind: 'SENTINEL-KIND',
    error_message: 'SENTINEL-ERR',
    skip_reason: 'SENTINEL-SKIP',
    payload: { to: 'sentinel@client.test' },
    recommendation: 'SENTINEL-REC',
    contact_id: 'SENTINEL-CONTACT',
    invoice_id: 'SENTINEL-INVOICE',
    booking_id: 'SENTINEL-BOOKING',
    entity_id: 'SENTINEL-ENTITY',
  };

  it.each(QUEUE_ITEM_QUEUE_IDS)('S-1 %s: the body and every log carry no account id, zone, raw kind or planted field', async (queue) => {
    mockList.mockResolvedValue({ data: { rows: [{ ...raw(), ...PLANTED }], total: 1 }, error: null });
    mockNames.mockResolvedValue({ data: [{ user_id: 'SENTINEL-ACCOUNT', company_name: 'Acme', vertical: 'trades', sub_vertical: null }], error: null });
    for (const state of QUEUE_ITEM_STATES) {
      const res = await GET(req(`?queue=${queue}&state=${state}`));
      const text = JSON.stringify(await json(res));
      expect(text).not.toMatch(/SENTINEL|sentinel|@|client\.test/);
      expect(text).toContain('Acme');
    }
    expect(allLogs()).not.toMatch(/SENTINEL|sentinel|client\.test|Acme/);
  });

  it('S-2: the name is in the body (by design); the vertical and the user id are not; the logs never carry the name', async () => {
    mockNames.mockResolvedValue({
      data: [{ user_id: 'user-1', company_name: 'Acme', vertical: 'SENTINEL-VERTICAL', sub_vertical: 'SENTINEL-SUB' }],
      error: null,
    });
    const text = JSON.stringify(await json(await GET(req('?queue=lead_responses&state=failed'))));
    expect(text).toContain('Acme');
    expect(text).not.toMatch(/SENTINEL|user-1/);
    expect(allLogs()).not.toMatch(/Acme|SENTINEL/);
  });

  it('S-3: no write through the real repository on a recording client, and no audit row', async () => {
    const { AdminJobsQueuesRepository } = jest.requireActual('@/lib/repositories/AdminJobsQueuesRepository');
    const recording = recordingClient(() => ({ data: [], error: null, count: 0 }));
    const repo = new AdminJobsQueuesRepository(recording.client);
    mockList.mockImplementation((...a: unknown[]) => repo.listQueueItemsAllAccounts(...a));
    for (const queue of QUEUE_ITEM_QUEUE_IDS) {
      for (const state of QUEUE_ITEM_STATES) {
        expect((await GET(req(`?queue=${queue}&state=${state}`))).status).toBe(200);
      }
    }
    expect(recording.calls.filter((c) => c.method === 'from')).toHaveLength(20);
    expect(recording.calls.some((c) => ['insert', 'update', 'upsert', 'delete', 'rpc'].includes(c.method))).toBe(false);
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(mockFigures).not.toHaveBeenCalled();
  });

  it('S-4: the 500 path never carries a planted message in production', async () => {
    const env = process.env as Record<string, string | undefined>;
    const original = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      mockList.mockRejectedValue(new Error('SENTINEL-THROWN a@b.c'));
      const res = await GET(req('?queue=lead_responses&state=failed'));
      expect(res.status).toBe(500);
      expect(JSON.stringify(await json(res))).not.toMatch(/SENTINEL|a@b\.c/);
    } finally {
      env.NODE_ENV = original;
    }
  });
});
