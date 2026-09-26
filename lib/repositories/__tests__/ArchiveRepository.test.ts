/**
 * ArchiveRepository, Slice 1 (read-only): U-R1 to U-R10.
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

import type { SupabaseClient } from '@supabase/supabase-js';
import { ArchiveRepository } from '../ArchiveRepository';

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

describe('U-R10: read-only', () => {
  it('no method writes, deletes or calls a function', async () => {
    const { client, calls } = fakeClient({ count: 1, data: [{ created_at: '2024-01-01T00:00:00Z' }] });
    const repo = new ArchiveRepository(client);

    await repo.countAuditTrailAllAccounts();
    await repo.getOldestAuditTrailCreatedAtAllAccounts();
    await repo.countAuditTrailBeforeAllAccounts(new Date('2025-01-01T00:00:00Z'));

    expect(calls.length).toBeGreaterThan(0);
    for (const method of methodsCalled(calls)) {
      expect(WRITES).not.toContain(method);
    }
    // Only the audit trail is ever touched.
    expect(calls.filter((call) => call[0] === 'from').map((call) => call[1])).toEqual([
      'audit_trail',
      'audit_trail',
      'audit_trail',
    ]);
  });

  it('every public method is named for its all-accounts reach', () => {
    const methods = Object.getOwnPropertyNames(ArchiveRepository.prototype).filter(
      (name) => name !== 'constructor'
    );
    expect(methods.length).toBe(3);
    for (const name of methods) {
      expect(name).toMatch(/AllAccounts$/);
    }
  });
});
