/**
 * BusinessOsDataExportJobRepository (data export DE-8a, workplan §5 / §8.2).
 *
 * A mocked SupabaseClient is injected through the constructor. Every call the
 * repository makes is recorded, so each test pins the exact query: the
 * tenant filter (id AND user_id) on every per-account method, the status
 * guard on every transition, explicit columns, and that invalid input never
 * reaches the database.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const logged: unknown[] = [];
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
  BusinessOsDataExportJobRepository,
  DATA_EXPORT_JOB_COLUMNS,
  DATA_EXPORT_JOB_LIMITS,
} from '../BusinessOsDataExportJobRepository';
import { EXPORT_JOB_POLICY } from '@/lib/business-os/data-export/jobPolicy';

type Call = { method: string; args: unknown[] };
type Result = { data: unknown; error: unknown };

/** A recording client. `results` are handed out one per awaited query, in order. */
function client(...results: Result[]) {
  const calls: Call[] = [];
  let next = 0;
  const take = () => results[Math.min(next++, results.length - 1)] ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'update', 'eq', 'neq', 'is', 'in', 'lt', 'lte', 'order', 'limit', 'maybeSingle']) {
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

const repo = (c: SupabaseClient) => new BusinessOsDataExportJobRepository(c);

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const JOB = '44444444-4444-4444-8444-444444444444';
const JOB2 = '55555555-5555-4555-8555-555555555555';

const eqs = (calls: Call[]) => calls.filter((c) => c.method === 'eq').map((c) => c.args);

beforeEach(() => {
  logged.length = 0;
});

describe('startForOwner / startForAdmin (M-1, SA C-10)', () => {
  it('owner: sends the session id as both the account and the requester', async () => {
    const { c, calls } = client({ data: [{ result_outcome: 'started', result_job_id: JOB, result_retry_at: null }], error: null });
    expect(await repo(c).startForOwner(OWNER)).toEqual({ data: { outcome: 'started', jobId: JOB }, error: null });
    expect(calls).toEqual([
      { method: 'rpc', args: ['business_os_data_export_start', { p_user_id: OWNER, p_requested_by: OWNER, p_requested_by_kind: 'owner' }] },
    ]);
  });

  it('admin: the target account and the admin requester, kind admin', async () => {
    const { c, calls } = client({ data: [{ result_outcome: 'started', result_job_id: JOB, result_retry_at: null }], error: null });
    expect((await repo(c).startForAdmin(OWNER, ADMIN)).data).toEqual({ outcome: 'started', jobId: JOB });
    expect(calls[0].args).toEqual(['business_os_data_export_start', { p_user_id: OWNER, p_requested_by: ADMIN, p_requested_by_kind: 'admin' }]);
  });

  it('maps in_progress and daily_limit with their retry time', async () => {
    const at = '2026-10-18T10:00:00+00:00';
    for (const outcome of ['in_progress', 'daily_limit'] as const) {
      const { c } = client({ data: [{ result_outcome: outcome, result_job_id: null, result_retry_at: at }], error: null });
      expect(await repo(c).startForOwner(OWNER)).toEqual({ data: { outcome, retryAt: at }, error: null });
    }
  });

  it.each([
    ['an unknown outcome', [{ result_outcome: 'queued', result_job_id: null, result_retry_at: null }]],
    ['an empty answer', []],
    ['started without a job id', [{ result_outcome: 'started', result_job_id: null, result_retry_at: null }]],
    ['a refusal without a retry time', [{ result_outcome: 'daily_limit', result_job_id: null, result_retry_at: null }]],
  ])('%s is an error, never a thrown exception', async (_name, data) => {
    const { c } = client({ data, error: null });
    const result = await repo(c).startForOwner(OWNER);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('an RPC error is returned scrubbed to code and message (no details)', async () => {
    const { c } = client({ data: null, error: { code: '42501', message: 'permission denied', details: 'secret row' } });
    const result = await repo(c).startForOwner(OWNER);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('permission denied');
    expect((result.error as Error & { code?: string }).code).toBe('42501');
    expect(JSON.stringify(logged)).not.toContain('secret row');
  });

  it('invalid ids never reach the database', async () => {
    const { c, calls } = client({ data: null, error: null });
    expect((await repo(c).startForOwner('not-a-uuid')).error).toBeInstanceOf(Error);
    expect((await repo(c).startForAdmin(OWNER, '../x')).error).toBeInstanceOf(Error);
    expect((await repo(c).startForAdmin('', ADMIN)).error).toBeInstanceOf(Error);
    expect(calls).toEqual([]);
  });

  it('there is no generic start taking a kind (an owner route cannot build a mismatched call)', () => {
    const source = readFileSync(join(__dirname, '..', 'BusinessOsDataExportJobRepository.ts'), 'utf8');
    expect(source).toMatch(/async startForOwner\(sessionUserId: string\)/);
    expect(source).toMatch(/async startForAdmin\(targetUserId: string, adminUserId: string\)/);
    expect(source).toMatch(/private async start\(/);
    expect(source).toContain('return this.start(sessionUserId, sessionUserId, \'owner\');');
  });
});

describe('findById / findLatestForUser / listForUser (M-2 to M-4)', () => {
  it('findById filters id AND user_id, explicit columns', async () => {
    const row = { id: JOB, user_id: OWNER };
    const { c, calls } = client({ data: row, error: null });
    expect(await repo(c).findById(JOB, OWNER)).toEqual({ data: row, error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['business_os_data_exports'] },
      { method: 'select', args: [DATA_EXPORT_JOB_COLUMNS] },
      { method: 'eq', args: ['id', JOB] },
      { method: 'eq', args: ['user_id', OWNER] },
      { method: 'maybeSingle', args: [] },
    ]);
    expect(DATA_EXPORT_JOB_COLUMNS).not.toContain('*');
  });

  it('a foreign job id returns null, not another tenant row', async () => {
    const { c } = client({ data: null, error: null });
    expect(await repo(c).findById(JOB, OTHER)).toEqual({ data: null, error: null });
  });

  it('findLatestForUser: newest first, one row, scoped', async () => {
    const { c, calls } = client({ data: [{ id: JOB }], error: null });
    expect((await repo(c).findLatestForUser(OWNER)).data).toEqual({ id: JOB });
    expect(eqs(calls)).toEqual([['user_id', OWNER]]);
    expect(calls).toContainEqual({ method: 'order', args: ['created_at', { ascending: false }] });
    expect(calls).toContainEqual({ method: 'limit', args: [1] });
    const empty = client({ data: [], error: null });
    expect((await repo(empty.c).findLatestForUser(OWNER)).data).toBeNull();
  });

  it('listForUser: default 10, max 20, scoped', async () => {
    const { c, calls } = client({ data: [], error: null });
    expect((await repo(c).listForUser(OWNER)).data).toEqual([]);
    expect(calls).toContainEqual({ method: 'limit', args: [DATA_EXPORT_JOB_LIMITS.LIST_DEFAULT] });
    expect(eqs(calls)).toEqual([['user_id', OWNER]]);
    const tooMany = client({ data: [], error: null });
    expect((await repo(tooMany.c).listForUser(OWNER, { limit: 21 })).error).toBeInstanceOf(Error);
    expect((await repo(tooMany.c).listForUser(OWNER, { limit: 0 })).error).toBeInstanceOf(Error);
    expect(tooMany.calls).toEqual([]);
  });

  it('a database error is returned, not thrown', async () => {
    const { c } = client({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect((await repo(c).findById(JOB, OWNER)).error?.message).toBe('boom');
    expect((await repo(c).listForUser(OWNER)).error?.message).toBe('boom');
    expect((await repo(c).findLatestForUser(OWNER)).error?.message).toBe('boom');
  });
});

function updatePayload(calls: Call[]): Record<string, unknown> {
  const update = calls.find((call) => call.method === 'update');
  expect(update).toBeDefined();
  return update!.args[0] as Record<string, unknown>;
}

describe('markReady / markFailed (M-5, M-6)', () => {
  it('markReady: only from running, scoped by id and user_id, expiry exactly 72 hours after ready', async () => {
    const { c, calls } = client({ data: { id: JOB, status: 'ready' }, error: null });
    const result = await repo(c).markReady(JOB, OWNER, { bytes: 10, fileCount: 2, rowCount: 3 });
    expect(result.data).toEqual({ id: JOB, status: 'ready' });
    expect(eqs(calls)).toEqual([['id', JOB], ['user_id', OWNER], ['status', 'running']]);
    const payload = updatePayload(calls);
    expect(Object.keys(payload).sort()).toEqual(
      ['bytes', 'expires_at', 'file_count', 'finished_at', 'ready_at', 'row_count', 'status', 'updated_at'].sort()
    );
    expect(payload.status).toBe('ready');
    expect(payload.ready_at).toBe(payload.finished_at);
    const hours = (Date.parse(payload.expires_at as string) - Date.parse(payload.ready_at as string)) / 3_600_000;
    expect(hours).toBe(EXPORT_JOB_POLICY.RETENTION_HOURS);
    expect(hours).toBe(72);
    expect(calls).toContainEqual({ method: 'select', args: [DATA_EXPORT_JOB_COLUMNS] });
  });

  it('markReady: a row no longer running (the stale rule took it) returns null', async () => {
    const { c } = client({ data: null, error: null });
    expect(await repo(c).markReady(JOB, OWNER, { bytes: 1, fileCount: 0, rowCount: 0 })).toEqual({ data: null, error: null });
  });

  it('markReady: caller extras never reach the payload, bad counts never reach the database', async () => {
    const { c, calls } = client({ data: null, error: null });
    const sneaky = { bytes: 1, fileCount: 1, rowCount: 1, user_id: OTHER, status: 'expired' } as unknown as Parameters<BusinessOsDataExportJobRepository['markReady']>[2];
    expect((await repo(c).markReady(JOB, OWNER, sneaky)).error).toBeInstanceOf(Error);
    expect((await repo(c).markReady(JOB, OWNER, { bytes: -1, fileCount: 0, rowCount: 0 })).error).toBeInstanceOf(Error);
    expect((await repo(c).markReady(JOB, OWNER, { bytes: 1.5, fileCount: 0, rowCount: 0 })).error).toBeInstanceOf(Error);
    expect(calls).toEqual([]);
  });

  it('markFailed: reason and optional sizes, only from running, scoped', async () => {
    const { c, calls } = client({ data: { id: JOB, status: 'failed' }, error: null });
    expect((await repo(c).markFailed(JOB, OWNER, 'over_ceiling', { rowCount: 120000 })).data).toEqual({ id: JOB, status: 'failed' });
    expect(eqs(calls)).toEqual([['id', JOB], ['user_id', OWNER], ['status', 'running']]);
    const payload = updatePayload(calls);
    expect(Object.keys(payload).sort()).toEqual(['failure_reason', 'finished_at', 'row_count', 'status', 'updated_at']);
    expect(payload).toMatchObject({ status: 'failed', failure_reason: 'over_ceiling', row_count: 120000 });
  });

  it('markFailed: an unknown reason never reaches the database', async () => {
    const { c, calls } = client({ data: null, error: null });
    expect((await repo(c).markFailed(JOB, OWNER, 'bogus' as never)).error).toBeInstanceOf(Error);
    expect(calls).toEqual([]);
  });
});

describe('markOwnerDownloaded / markExpired (M-7, M-10): idempotent', () => {
  it('markOwnerDownloaded: first download only, ready only, scoped', async () => {
    const { c, calls } = client({ data: [{ id: JOB }], error: null }, { data: [], error: null });
    expect(await repo(c).markOwnerDownloaded(JOB, OWNER)).toEqual({ data: true, error: null });
    expect(await repo(c).markOwnerDownloaded(JOB, OWNER)).toEqual({ data: false, error: null });
    expect(eqs(calls).slice(0, 3)).toEqual([['id', JOB], ['user_id', OWNER], ['status', 'ready']]);
    expect(calls).toContainEqual({ method: 'is', args: ['owner_downloaded_at', null] });
    expect(Object.keys(updatePayload(calls)).sort()).toEqual(['owner_downloaded_at', 'updated_at']);
  });

  it('markExpired: ready to expired, false the second time, scoped', async () => {
    const { c, calls } = client({ data: [{ id: JOB }], error: null }, { data: [], error: null });
    expect((await repo(c).markExpired(JOB, OWNER)).data).toBe(true);
    expect((await repo(c).markExpired(JOB, OWNER)).data).toBe(false);
    expect(eqs(calls).slice(0, 3)).toEqual([['id', JOB], ['user_id', OWNER], ['status', 'ready']]);
    expect(Object.keys(updatePayload(calls)).sort()).toEqual(['expired_at', 'status', 'updated_at']);
  });
});

describe('expireOtherReady (M-8)', () => {
  it('expires the other ready jobs of this account only, never the kept one', async () => {
    const { c, calls } = client({ data: [{ id: JOB2 }], error: null });
    expect(await repo(c).expireOtherReady(OWNER, JOB)).toEqual({ data: [JOB2], error: null });
    expect(eqs(calls)).toEqual([['user_id', OWNER], ['status', 'ready']]);
    expect(calls).toContainEqual({ method: 'neq', args: ['id', JOB] });
    expect(updatePayload(calls)).toMatchObject({ status: 'expired' });
  });

  it('invalid ids never reach the database', async () => {
    const { c, calls } = client({ data: [], error: null });
    expect((await repo(c).expireOtherReady(OWNER, 'x')).error).toBeInstanceOf(Error);
    expect(calls).toEqual([]);
  });
});

describe('cross-account sweep reads (M-9, M-11)', () => {
  it('listDueForExpiry: ready and past expiry, oldest first, at most 500, only id and user_id', async () => {
    const now = new Date('2026-10-17T12:00:00.000Z');
    const { c, calls } = client({ data: [{ id: JOB, user_id: OWNER }], error: null });
    expect((await repo(c).listDueForExpiry(now)).data).toEqual([{ id: JOB, user_id: OWNER }]);
    expect(calls).toEqual([
      { method: 'from', args: ['business_os_data_exports'] },
      { method: 'select', args: ['id, user_id'] },
      { method: 'eq', args: ['status', 'ready'] },
      { method: 'lte', args: ['expires_at', '2026-10-17T12:00:00.000Z'] },
      { method: 'order', args: ['expires_at', { ascending: true }] },
      { method: 'limit', args: [500] },
    ]);
    const bad = client({ data: [], error: null });
    expect((await repo(bad.c).listDueForExpiry(now, 501)).error).toBeInstanceOf(Error);
    expect((await repo(bad.c).listDueForExpiry(new Date('nope'))).error).toBeInstanceOf(Error);
    expect(bad.calls).toEqual([]);
  });

  it('findJobsByIds: chunks of at most 100, deduplicated, uuids only', async () => {
    const ids = Array.from({ length: 250 }, (_v, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const { c, calls } = client({ data: [{ id: ids[0], user_id: OWNER, status: 'ready' }], error: null });
    const result = await repo(c).findJobsByIds([...ids, ids[0]]);
    expect(result.data).toHaveLength(3);
    const ins = calls.filter((call) => call.method === 'in').map((call) => (call.args[1] as string[]).length);
    expect(ins).toEqual([100, 100, 50]);
    expect(calls.filter((call) => call.method === 'select').every((call) => call.args[0] === 'id, user_id, status')).toBe(true);

    const bad = client({ data: [], error: null });
    expect((await repo(bad.c).findJobsByIds(['../etc'])).error).toBeInstanceOf(Error);
    expect((await repo(bad.c).findJobsByIds(Array.from({ length: 1001 }, (_v, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`))).error).toBeInstanceOf(Error);
    expect(await repo(bad.c).findJobsByIds([])).toEqual({ data: [], error: null });
    expect(bad.calls).toEqual([]);
  });

  // DE-8b: was "both carry ..."; listStaleRunning is the third sweep read.
  it('listStaleRunning: running and created before the cut, oldest first, at most 500, only id and user_id (DE-8b, SA DE-8a Q-12)', async () => {
    const before = new Date('2026-10-17T11:58:30.000Z');
    const { c, calls } = client({ data: [{ id: JOB, user_id: OWNER }], error: null });
    expect((await repo(c).listStaleRunning(before)).data).toEqual([{ id: JOB, user_id: OWNER }]);
    expect(calls).toEqual([
      { method: 'from', args: ['business_os_data_exports'] },
      { method: 'select', args: ['id, user_id'] },
      { method: 'eq', args: ['status', 'running'] },
      { method: 'lt', args: ['created_at', '2026-10-17T11:58:30.000Z'] },
      { method: 'order', args: ['created_at', { ascending: true }] },
      { method: 'limit', args: [500] },
    ]);
    const bad = client({ data: [], error: null });
    expect((await repo(bad.c).listStaleRunning(before, 501)).error).toBeInstanceOf(Error);
    expect((await repo(bad.c).listStaleRunning(new Date('nope'))).error).toBeInstanceOf(Error);
    expect(bad.calls).toEqual([]);
    const failing = client({ data: null, error: { message: 'down', code: 'XX000', details: 'secret detail' } });
    const failed = await repo(failing.c).listStaleRunning(before);
    expect(failed.data).toBeNull();
    expect(failed.error?.message).toBe('down');
  });

  it('the three sweep reads carry the cross-account comment, and no other method reads without user_id (source scan)', () => {
    const source = readFileSync(join(__dirname, '..', 'BusinessOsDataExportJobRepository.ts'), 'utf8').replace(/\r\n/g, '\n');
    const comment = "// Cross-account by design: the daily sweep has no user context; every effect it takes is scoped by the row's own user_id (tenant-isolation-guard Step 6).";
    expect(source.split(comment).length - 1).toBe(3);
    // Code only: the header comment names .or() to say it is never used.
    const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/select\('\*'\)/);
    expect(code).not.toMatch(/\.or\(/);
    expect(code).not.toMatch(/\.delete\(/);
    expect(code).not.toMatch(/\.upsert\(/);
    expect(code).not.toMatch(/console\./);
  });
});

describe('tenant isolation negative control', () => {
  it('with nothing matching (foreign job id, my user id) no write reports success', async () => {
    const { c } = client({ data: null, error: null }, { data: null, error: null }, { data: [], error: null }, { data: [], error: null });
    expect((await repo(c).markReady(JOB, OWNER, { bytes: 1, fileCount: 1, rowCount: 1 })).data).toBeNull();
    expect((await repo(c).markFailed(JOB, OWNER, 'error')).data).toBeNull();
    expect((await repo(c).markOwnerDownloaded(JOB, OWNER)).data).toBe(false);
    expect((await repo(c).markExpired(JOB, OWNER)).data).toBe(false);
  });

  it('every per-account method sends a user_id filter', async () => {
    const run = async (fn: (r: BusinessOsDataExportJobRepository) => Promise<unknown>) => {
      const { c, calls } = client({ data: null, error: null });
      await fn(repo(c));
      return eqs(calls).some(([column, value]) => column === 'user_id' && value === OWNER);
    };
    expect(await run((r) => r.findById(JOB, OWNER))).toBe(true);
    expect(await run((r) => r.findLatestForUser(OWNER))).toBe(true);
    expect(await run((r) => r.listForUser(OWNER))).toBe(true);
    expect(await run((r) => r.markReady(JOB, OWNER, { bytes: 0, fileCount: 0, rowCount: 0 }))).toBe(true);
    expect(await run((r) => r.markFailed(JOB, OWNER, 'timeout'))).toBe(true);
    expect(await run((r) => r.markOwnerDownloaded(JOB, OWNER))).toBe(true);
    expect(await run((r) => r.expireOtherReady(OWNER, JOB))).toBe(true);
    expect(await run((r) => r.markExpired(JOB, OWNER))).toBe(true);
  });
});
