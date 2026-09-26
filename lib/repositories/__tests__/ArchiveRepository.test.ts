/**
 * ArchiveRepository: Slice 1 U-R1 to U-R10, Slice 2a R-1 to R-3 (still read-only).
 *
 * A fake PostgREST builder records every call, including ones the repository
 * must never make, so "read-only" is asserted rather than assumed (U-R10).
 */

const logged: Array<{ level: string; ctx: unknown; msg: unknown }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (ctx: unknown, msg: unknown) => logged.push({ level, ctx, msg });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ARCHIVE_RUN_COLUMNS, ArchiveRepository } from '../ArchiveRepository';

type Call = [string, ...unknown[]];

interface FakeResult {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

/** Every PostgREST method a repository could reach for, read or write. */
const RECORDED = [
  'select', 'eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'not', 'in', 'order', 'limit', 'range',
  'single', 'maybeSingle', 'insert', 'update', 'delete', 'upsert',
];
const WRITES = ['insert', 'update', 'delete', 'upsert', 'rpc'];

function fakeClient(result: FakeResult) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of RECORDED) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  // Awaiting the chain resolves to the canned PostgREST response.
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null, count: null, ...result }).then(resolve, reject);

  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
    rpc: (...args: unknown[]) => {
      calls.push(['rpc', ...args]);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const methodsCalled = (calls: Call[]) => calls.map((call) => call[0]);

beforeEach(() => {
  logged.length = 0;
});

describe('countAuditTrailAllAccounts', () => {
  it('U-R1: counts audit_trail with an exact head count and no filter', async () => {
    const { client, calls } = fakeClient({ count: 1234 });

    const result = await new ArchiveRepository(client).countAuditTrailAllAccounts();

    expect(result).toEqual({ data: 1234, error: null });
    expect(calls).toEqual([
      ['from', 'audit_trail'],
      ['select', 'id', { count: 'exact', head: true }],
    ]);
  });

  it('U-R1: a real zero is returned as zero', async () => {
    const { client } = fakeClient({ count: 0 });
    expect(await new ArchiveRepository(client).countAuditTrailAllAccounts()).toEqual({
      data: 0,
      error: null,
    });
  });

  it('U-R2: a Supabase error comes back as an error result, logged, without throwing', async () => {
    const { client } = fakeClient({ error: { message: 'boom', code: 'XX000' } });

    const result = await new ArchiveRepository(client).countAuditTrailAllAccounts();

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('boom');
    expect(logged.some((entry) => entry.level === 'error')).toBe(true);
  });

  it('U-R3: a missing count is an error, never a zero', async () => {
    const { client } = fakeClient({ count: null });

    const result = await new ArchiveRepository(client).countAuditTrailAllAccounts();

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('getOldestAuditTrailCreatedAtAllAccounts', () => {
  it('U-R4: selects only created_at, oldest first, one row', async () => {
    const { client, calls } = fakeClient({ data: [{ created_at: '2024-01-02T03:04:05+00:00' }] });

    const result = await new ArchiveRepository(client).getOldestAuditTrailCreatedAtAllAccounts();

    expect(result).toEqual({ data: '2024-01-02T03:04:05+00:00', error: null });
    expect(calls).toEqual([
      ['from', 'audit_trail'],
      ['select', 'created_at'],
      ['order', 'created_at', { ascending: true }],
      ['limit', 1],
    ]);
  });

  it('U-R5: an empty table gives null without an error', async () => {
    const { client } = fakeClient({ data: [] });
    expect(await new ArchiveRepository(client).getOldestAuditTrailCreatedAtAllAccounts()).toEqual({
      data: null,
      error: null,
    });
  });

  it('U-R6: a Supabase error comes back as an error result, without throwing', async () => {
    const { client } = fakeClient({ error: { message: 'timeout' } });

    const result = await new ArchiveRepository(client).getOldestAuditTrailCreatedAtAllAccounts();

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('timeout');
  });
});

describe('countAuditTrailBeforeAllAccounts', () => {
  const cutoff = new Date('2025-09-26T00:00:00.000Z');

  it('U-R7: applies a strict less-than on created_at with an exact head count', async () => {
    const { client, calls } = fakeClient({ count: 77 });

    const result = await new ArchiveRepository(client).countAuditTrailBeforeAllAccounts(cutoff);

    expect(result).toEqual({ data: 77, error: null });
    expect(calls).toEqual([
      ['from', 'audit_trail'],
      ['select', 'id', { count: 'exact', head: true }],
      ['lt', 'created_at', '2025-09-26T00:00:00.000Z'],
    ]);
  });

  it('U-R8: refuses an invalid Date before issuing any query', async () => {
    const { client, calls } = fakeClient({ count: 5 });

    const result = await new ArchiveRepository(client).countAuditTrailBeforeAllAccounts(
      new Date('not a date')
    );

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(calls).toEqual([]);
  });

  it('U-R9: a Supabase error comes back as an error result', async () => {
    const { client } = fakeClient({ error: { message: 'nope' } });
    const result = await new ArchiveRepository(client).countAuditTrailBeforeAllAccounts(cutoff);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('nope');
  });

  it('U-R9: a missing count is an error, never a zero', async () => {
    const { client } = fakeClient({ count: null });
    const result = await new ArchiveRepository(client).countAuditTrailBeforeAllAccounts(cutoff);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('countArchivedAllAccounts (Slice 2a)', () => {
  it('R-1: counts archived_records of one source with an exact head count', async () => {
    const { client, calls } = fakeClient({ count: 4321 });

    const result = await new ArchiveRepository(client).countArchivedAllAccounts('audit_trail');

    expect(result).toEqual({ data: 4321, error: null });
    expect(calls).toEqual([
      ['from', 'archived_records'],
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'source', 'audit_trail'],
    ]);
  });

  it('R-1: a real zero is zero; a missing count is an error, never a zero', async () => {
    expect(await new ArchiveRepository(fakeClient({ count: 0 }).client).countArchivedAllAccounts('audit_trail')).toEqual({
      data: 0,
      error: null,
    });

    const missing = await new ArchiveRepository(fakeClient({ count: null }).client).countArchivedAllAccounts('audit_trail');
    expect(missing.data).toBeNull();
    expect(missing.error).toBeInstanceOf(Error);
  });

  it('R-1: a Supabase error comes back as an error result, logged, without throwing', async () => {
    const result = await new ArchiveRepository(
      fakeClient({ error: { message: 'relation does not exist' } }).client
    ).countArchivedAllAccounts('audit_trail');

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('relation does not exist');
    expect(logged.some((entry) => entry.level === 'error')).toBe(true);
  });
});

describe('listRuns (Slice 2a)', () => {
  it('R-2: names its columns (never * and never payload), newest first, 20 by default', async () => {
    const { client, calls } = fakeClient({ data: [{ id: 'run-1' }] });

    const result = await new ArchiveRepository(client).listRuns();

    expect(result).toEqual({ data: [{ id: 'run-1' }], error: null });
    expect(calls).toEqual([
      ['from', 'archive_runs'],
      ['select', ARCHIVE_RUN_COLUMNS],
      ['order', 'started_at', { ascending: false }],
      ['limit', 20],
    ]);
    expect(ARCHIVE_RUN_COLUMNS).not.toMatch(/\*|payload/);
  });

  it('R-2: honours a limit and returns [] for no runs', async () => {
    const { client, calls } = fakeClient({ data: null });
    expect(await new ArchiveRepository(client).listRuns({ limit: 5 })).toEqual({ data: [], error: null });
    expect(calls).toContainEqual(['limit', 5]);
  });

  it('R-2: a Supabase error comes back as an error result', async () => {
    const result = await new ArchiveRepository(fakeClient({ error: { message: 'nope' } }).client).listRuns();
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('nope');
  });

  it('R-2: the selected columns are exactly the archive_runs columns M1 creates', () => {
    // Closes the schema-check blind spot for this select: a renamed or missing
    // column would otherwise surface only as a PROD 400.
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261010_admin_archiving_runs.sql'),
      'utf8'
    );
    const start = sql.indexOf('CREATE TABLE public.archive_runs (');
    const statement = sql.slice(start, sql.indexOf(');', start));
    const created = [...statement.matchAll(/^\s{2}([a-z_]+)\s+/gm)].map((m) => m[1]);
    expect(ARCHIVE_RUN_COLUMNS.split(',').map((c) => c.trim()).sort()).toEqual([...created].sort());
  });
});

describe('getLatestCutoff (Slice 2a)', () => {
  it('R-3: reads the latest cutoff of a SUCCEEDED run of the source, ordered by cutoff (SA Q-5)', async () => {
    const { client, calls } = fakeClient({ data: [{ cutoff: '2025-09-26T12:00:00+00:00' }] });

    const result = await new ArchiveRepository(client).getLatestCutoff('audit_trail');

    expect(result).toEqual({ data: '2025-09-26T12:00:00+00:00', error: null });
    expect(calls).toEqual([
      ['from', 'archive_runs'],
      ['select', 'cutoff'],
      ['eq', 'source', 'audit_trail'],
      ['eq', 'status', 'succeeded'],
      ['order', 'cutoff', { ascending: false }],
      ['limit', 1],
    ]);
  });

  it('R-3: none yet is null without an error', async () => {
    expect(await new ArchiveRepository(fakeClient({ data: [] }).client).getLatestCutoff('audit_trail')).toEqual({
      data: null,
      error: null,
    });
  });

  it('R-3: a Supabase error comes back as an error result', async () => {
    const result = await new ArchiveRepository(fakeClient({ error: { message: 'x' } }).client).getLatestCutoff(
      'audit_trail'
    );
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('x');
  });
});

describe('U-R10 / R-10: still read-only in Slice 2a', () => {
  it('no method writes, deletes or calls a function', async () => {
    const { client, calls } = fakeClient({
      count: 1,
      data: [{ created_at: '2024-01-01T00:00:00Z', cutoff: '2024-01-01T00:00:00Z' }],
    });
    const repo = new ArchiveRepository(client);

    await repo.countAuditTrailAllAccounts();
    await repo.getOldestAuditTrailCreatedAtAllAccounts();
    await repo.countAuditTrailBeforeAllAccounts(new Date('2025-01-01T00:00:00Z'));
    await repo.countArchivedAllAccounts('audit_trail');
    await repo.listRuns();
    await repo.getLatestCutoff('audit_trail');

    expect(calls.length).toBeGreaterThan(0);
    for (const method of methodsCalled(calls)) {
      expect(WRITES).not.toContain(method);
    }
    expect(calls.filter((call) => call[0] === 'from').map((call) => call[1])).toEqual([
      'audit_trail',
      'audit_trail',
      'audit_trail',
      'archived_records',
      'archive_runs',
      'archive_runs',
    ]);
    // No select ever names the archived payload (AC-14).
    for (const call of calls.filter((c) => c[0] === 'select')) {
      expect(String(call[1])).not.toMatch(/payload|\*/);
    }
  });

  it('method count is pinned at 6; account-data methods end in AllAccounts, run-log methods do not need to (SA Q-7)', () => {
    const methods = Object.getOwnPropertyNames(ArchiveRepository.prototype).filter(
      (name) => name !== 'constructor'
    );
    // Deliberate pin move: 3 in Slice 1, 6 in Slice 2a, 11 in Slice 2b.
    expect(methods.sort()).toEqual(
      [
        'countArchivedAllAccounts',
        'countAuditTrailAllAccounts',
        'countAuditTrailBeforeAllAccounts',
        'getLatestCutoff',
        'getOldestAuditTrailCreatedAtAllAccounts',
        'listRuns',
      ].sort()
    );
    const runLogMethods = ['getLatestCutoff', 'listRuns'];
    for (const name of methods.filter((m) => !runLogMethods.includes(m))) {
      expect(name).toMatch(/AllAccounts$/);
    }
  });
});
