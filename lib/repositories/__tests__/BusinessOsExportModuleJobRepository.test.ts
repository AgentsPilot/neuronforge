/**
 * BusinessOsExportModuleJobRepository (module export MX-1a, workplan §4.3, T-4;
 * durable-queue-drain step 10).
 *
 * A recording SupabaseClient is injected through the constructor. Each test
 * pins the exact query: the user_id filter and the DTO of the history, the
 * claim and reap RPCs, the per-row parse that drops a bad row by id, and that
 * a double claim (modelled SKIP LOCKED) never hands one job to two runners.
 * The real SKIP LOCKED is QA 4 on the local replica.
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
  BusinessOsExportModuleJobRepository,
  HISTORY_LIMIT_MAX,
  MODULE_JOB_CLAIM_FUNCTION,
  MODULE_JOB_ERROR,
  MODULE_JOB_HISTORY_SELECT,
  MODULE_JOB_REAP_FUNCTION,
} from '../BusinessOsExportModuleJobRepository';
import { MODULE_EXPORT_POLICY } from '@/lib/business-os/data-export/moduleExportPolicy';

type Call = { method: string; args: unknown[] };
type Result = { data?: unknown; error: unknown };

function client(...results: Result[]) {
  const calls: Call[] = [];
  let next = 0;
  const take = () => results[Math.min(next++, results.length - 1)] ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(take());
  const c = {
    from: (table: string) => (calls.push({ method: 'from', args: [table] }), builder),
    rpc: (name: string, params?: unknown) => {
      calls.push({ method: 'rpc', args: params === undefined ? [name] : [name, params] });
      return Promise.resolve(take());
    },
  } as unknown as SupabaseClient;
  return { c, calls };
}

const repo = (c: SupabaseClient) => new BusinessOsExportModuleJobRepository(c);

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const RUNNER = '33333333-3333-4333-8333-333333333333';
const RUNNER2 = '44444444-4444-4444-8444-444444444444';
const REQUEST = '55555555-5555-4555-8555-555555555555';
const JOB = (n: number) => `66666666-6666-4666-8666-${String(n).padStart(12, '0')}`;
const T = '2026-10-27T10:00:00.000Z';

function job(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: JOB(1),
    request_id: REQUEST,
    user_id: OWNER,
    module: 'clients',
    status: 'working',
    parts_total: null,
    parts: [],
    row_count: null,
    failure_code: null,
    notice_state: 'none',
    notice_attempts: 0,
    notice_sent_at: null,
    notice_resend_id: null,
    claimed_by: RUNNER,
    claimed_at: T,
    attempts: 1,
    next_attempt_at: null,
    last_error_code: null,
    started_at: T,
    sent_at: null,
    finished_at: null,
    created_at: T,
    updated_at: T,
    ...overrides,
  };
}

beforeEach(() => {
  logged.length = 0;
});

describe('listHistoryForUser', () => {
  const historyRow = {
    id: JOB(1),
    request_id: REQUEST,
    module: 'bookings',
    status: 'sent',
    parts: [
      { n: 1, state: 'accepted', resend_id: 're_1', at: T },
      { n: 2, state: 'accepted', resend_id: 're_2', at: T },
    ],
    sent_at: T,
    created_at: T,
    business_os_export_requests: { requested_at: T, origin: 'admin' },
  };

  it('filters on user_id, newest first, and embeds the request through the named foreign key', async () => {
    const { c, calls } = client({ data: [historyRow], error: null });
    const result = await repo(c).listHistoryForUser(OWNER, { limit: 20 });
    expect(calls).toEqual([
      { method: 'from', args: ['business_os_export_module_jobs'] },
      { method: 'select', args: [MODULE_JOB_HISTORY_SELECT] },
      { method: 'eq', args: ['user_id', OWNER] },
      { method: 'order', args: ['created_at', { ascending: false }] },
      { method: 'limit', args: [20] },
    ]);
    expect(MODULE_JOB_HISTORY_SELECT).toContain('business_os_export_requests!business_os_export_module_jobs_request_id_fkey(requested_at, origin)');
    expect(result).toEqual({
      data: [{ requestId: REQUEST, module: 'bookings', status: 'sent', requestedAt: T, sentAt: T, emailCount: 2, origin: 'admin' }],
      error: null,
    });
  });

  it('the DTO never carries a Resend id, a claim field or an error code, and the select never asks for them', async () => {
    const { c } = client({ data: [historyRow], error: null });
    const result = await repo(c).listHistoryForUser(OWNER);
    const text = JSON.stringify(result.data);
    expect(text).not.toMatch(/re_1|resend|claimed|error_code|failure|user_id/);
    expect(MODULE_JOB_HISTORY_SELECT).not.toMatch(/claimed|resend|error_code|failure_code|\*/);
  });

  it.each([
    [undefined, HISTORY_LIMIT_MAX],
    [0, 1],
    [-5, 1],
    [1000, HISTORY_LIMIT_MAX],
    [2.5, HISTORY_LIMIT_MAX],
  ])('limit %p is clamped to %p', async (limit, expected) => {
    const { c, calls } = client({ data: [], error: null });
    await repo(c).listHistoryForUser(OWNER, limit === undefined ? {} : { limit });
    expect(calls.find((call) => call.method === 'limit')?.args).toEqual([expected]);
  });

  it('refuses a non-uuid user id before any call, and returns a database error, never a throw', async () => {
    const bad = client({ data: [], error: null });
    expect((await repo(bad.c).listHistoryForUser('nope')).error).toMatchObject({ code: MODULE_JOB_ERROR.INVALID_INPUT });
    expect(bad.calls).toEqual([]);
    const failing = client({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect(await repo(failing.c).listHistoryForUser(OWNER)).toEqual({ data: null, error: expect.objectContaining({ code: 'XX000' }) });
  });
});

describe('claimDue ⟨unscoped-by-design⟩', () => {
  it('calls the claim function with the runner and the batch, and returns the parsed rows', async () => {
    const { c, calls } = client({ data: [job()], error: null });
    const result = await repo(c).claimDue(RUNNER, 1);
    expect(calls).toEqual([{ method: 'rpc', args: [MODULE_JOB_CLAIM_FUNCTION, { p_runner: RUNNER, p_batch: 1 }] }]);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].user_id).toBe(OWNER);
  });

  it.each([
    ['a non-uuid runner', 'runner', 1],
    ['batch 0', RUNNER, 0],
    ['a batch above the SQL clamp', RUNNER, MODULE_EXPORT_POLICY.CLAIM_BATCH_MAX + 1],
    ['a fractional batch', RUNNER, 1.5],
  ])('refuses %s before any call', async (_name, runner, batch) => {
    const { c, calls } = client({ data: [job()], error: null });
    expect((await repo(c).claimDue(runner as string, batch as number)).error).toMatchObject({ code: MODULE_JOB_ERROR.INVALID_INPUT });
    expect(calls).toEqual([]);
  });

  it.each([
    ['a part with a numeric state', { parts_total: 2, parts: [{ n: 1, state: 7, resend_id: null, at: T }] }],
    ['a part with no n', { parts_total: 2, parts: [{ state: 'sending', resend_id: null, at: T }] }],
    ['an unknown status', { status: 'queued' }],
    ['a free-text failure code', { status: 'failed', failure_code: 'Owes money' }],
  ])('drops a row with %s, logs it by id, and keeps the good rows', async (_name, overrides) => {
    const { c } = client({ data: [job({ id: JOB(1) }), job({ id: JOB(2), ...overrides })], error: null });
    const result = await repo(c).claimDue(RUNNER, 2);
    expect(result.data?.map((row) => row.id)).toEqual([JOB(1)]);
    expect(logged.some((entry) => JSON.stringify(entry).includes(JOB(2)) && JSON.stringify(entry).includes('failed its parse'))).toBe(true);
  });

  it('validates the module by shape, not the enum, so a renamed module still reaches the worker (SA MX1A-10)', async () => {
    const { c } = client({ data: [job({ module: 'renamed_module' })], error: null });
    expect((await repo(c).claimDue(RUNNER, 1)).data?.[0].module).toBe('renamed_module');
  });

  it('a double claim never hands one job to two runners (modelled SKIP LOCKED, skill step 10)', async () => {
    // Two runners claim at once: the database locks the first batch, the second skips locked rows.
    const queue = [JOB(1), JOB(2), JOB(3)];
    const locked = new Set<string>();
    const c = {
      rpc: (_name: string, params: { p_runner: string; p_batch: number }) => {
        const batch = queue.filter((id) => !locked.has(id)).slice(0, params.p_batch);
        for (const id of batch) locked.add(id);
        return Promise.resolve({ data: batch.map((id) => job({ id, claimed_by: params.p_runner })), error: null });
      },
    } as unknown as SupabaseClient;
    const [first, second] = await Promise.all([repo(c).claimDue(RUNNER, 2), repo(c).claimDue(RUNNER2, 2)]);
    const a = first.data?.map((row) => row.id) ?? [];
    const b = second.data?.map((row) => row.id) ?? [];
    expect(a.filter((id) => b.includes(id))).toEqual([]);
    expect([...a, ...b].sort()).toEqual(queue);
    // Every claimed row carries its own account: the worker scopes each effect to it (tenant-isolation-guard step 6).
    for (const row of [...(first.data ?? []), ...(second.data ?? [])]) expect(row.user_id).toBe(OWNER);
  });

  it('an RPC error comes back as { error }, never a throw', async () => {
    const { c } = client({ data: null, error: { code: '40001', message: 'serialization' } });
    expect(await repo(c).claimDue(RUNNER, 1)).toEqual({ data: null, error: expect.objectContaining({ code: '40001' }) });
    const throwing = { rpc: () => Promise.reject(new Error('down')) } as unknown as SupabaseClient;
    expect((await repo(throwing).claimDue(RUNNER, 1)).error).toMatchObject({ message: 'down' });
  });
});

describe('reapStale ⟨unscoped-by-design⟩', () => {
  it('calls the reap function with no argument (the lease is a SQL literal) and maps each verdict', async () => {
    const rows = [
      job({ id: JOB(1), status: 'waiting', claimed_by: null, claimed_at: null, last_error_code: 'lease_expired', next_attempt_at: T }),
      job({
        id: JOB(2),
        user_id: OTHER,
        status: 'interrupted',
        failure_code: 'interrupted',
        notice_state: 'due',
        claimed_by: null,
        claimed_at: null,
        parts_total: 2,
        parts: [{ n: 1, state: 'sending', resend_id: null, at: T }],
        finished_at: T,
      }),
      job({ id: JOB(3), status: 'failed', failure_code: 'attempts_exhausted', notice_state: 'given_up', claimed_by: null, claimed_at: null, attempts: 3, finished_at: T }),
    ];
    const { c, calls } = client({ data: rows, error: null });
    const result = await repo(c).reapStale();
    expect(calls).toEqual([{ method: 'rpc', args: [MODULE_JOB_REAP_FUNCTION] }]);
    expect(result).toEqual({
      data: [
        { id: JOB(1), userId: OWNER, status: 'waiting', failureCode: null, noticeState: 'none' },
        { id: JOB(2), userId: OTHER, status: 'interrupted', failureCode: 'interrupted', noticeState: 'due' },
        { id: JOB(3), userId: OWNER, status: 'failed', failureCode: 'attempts_exhausted', noticeState: 'given_up' },
      ],
      error: null,
    });
  });

  it('nothing stale is an empty list; an RPC error is { error }, never a throw', async () => {
    expect(await repo(client({ data: [], error: null }).c).reapStale()).toEqual({ data: [], error: null });
    const failing = client({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect(await repo(failing.c).reapStale()).toEqual({ data: null, error: expect.objectContaining({ code: 'XX000' }) });
  });
});
