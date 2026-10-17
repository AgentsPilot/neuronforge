/**
 * Finance slice 8.3: the read-only history repository (HS-FR-10, E-98, E-100).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { readFileSync } from 'fs';
import { join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BusinessOsFinanceSnapshotReadRepository,
  FINANCE_SNAPSHOT_READ_CEILING,
  FINANCE_SNAPSHOT_READ_PAGE_SIZE,
  FINANCE_SNAPSHOT_READ_COLUMNS,
} from '../BusinessOsFinanceSnapshotReadRepository';

type Call = { method: string; args: unknown[] };

function client(result: { data: unknown; error: unknown } | (() => never)) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'order', 'limit', 'gte', 'lte', 'range']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    try {
      resolve(typeof result === 'function' ? result() : result);
    } catch (e) {
      reject(e);
    }
  };
  return { client: chain as unknown as SupabaseClient, calls };
}
const repo = (c: SupabaseClient) => new BusinessOsFinanceSnapshotReadRepository(c);

describe('findFirstSnapshotDate', () => {
  it('the earliest as_of_date, ascending, one row', async () => {
    const { client: c, calls } = client({ data: [{ as_of_date: '2026-10-17' }], error: null });
    expect(await repo(c).findFirstSnapshotDate()).toEqual({ data: { state: 'ready', firstDate: '2026-10-17' }, error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['business_os_finance_snapshots'] },
      { method: 'select', args: ['as_of_date'] },
      { method: 'order', args: ['as_of_date', { ascending: true }] },
      { method: 'limit', args: [1] },
    ]);
  });

  it('an empty table gives null', async () => {
    const { client: c } = client({ data: [], error: null });
    expect(await repo(c).findFirstSnapshotDate()).toEqual({ data: { state: 'ready', firstDate: null }, error: null });
  });

  it.each(['42P01', 'PGRST205'])('%s is not installed (E-100)', async (code) => {
    const { client: c } = client({ data: null, error: { code, message: 'missing' } });
    expect(await repo(c).findFirstSnapshotDate()).toEqual({ data: { state: 'not_installed' }, error: null });
  });

  it('a missing COLUMN (42703) is an error', async () => {
    const { client: c } = client({ data: null, error: { code: '42703', message: 'column' } });
    expect((await repo(c).findFirstSnapshotDate()).error).not.toBeNull();
  });
});

describe('listSnapshotsInRange (HS-FR-10)', () => {
  it('exactly the five columns, the inclusive range, a stable order, one row past the ceiling', async () => {
    const { client: c, calls } = client({ data: [{ as_of_date: '2026-10-16', metric: 'accounts_total', dimension: 'all', unit: 'accounts', value: 3 }], error: null });
    const result = await repo(c).listSnapshotsInRange('2026-10-01', '2026-10-16');
    expect(result.data).toEqual({ state: 'ready', rows: [{ as_of_date: '2026-10-16', metric: 'accounts_total', dimension: 'all', unit: 'accounts', value: 3 }] });
    expect(FINANCE_SNAPSHOT_READ_COLUMNS).toBe('as_of_date, metric, dimension, unit, value');
    expect(calls.map((x) => [x.method, ...x.args])).toEqual([
      ['from', 'business_os_finance_snapshots'],
      ['select', 'as_of_date, metric, dimension, unit, value'],
      ['gte', 'as_of_date', '2026-10-01'],
      ['lte', 'as_of_date', '2026-10-16'],
      ['order', 'as_of_date', { ascending: true }],
      ['order', 'metric', { ascending: true }],
      ['order', 'dimension', { ascending: true }],
      ['range', 0, FINANCE_SNAPSHOT_READ_PAGE_SIZE - 1],
    ]);
  });

  /**
   * SA-CR-8.3 C-1: a client that behaves like PostgREST, holding `total` rows and cutting EVERY
   * response at 1,000 rows, whatever range is asked for. Rows are unique by (metric) so a lost
   * or repeated page would show.
   */
  function pagedClient(total: number) {
    const all = Array.from({ length: total }, (_, i) => ({
      as_of_date: '2026-10-16',
      metric: `m${String(i).padStart(5, '0')}`,
      dimension: 'all',
      unit: 'accounts',
      value: i,
    }));
    const ranges: Array<[number, number]> = [];
    const make = () => {
      let from = 0;
      let to = Number.MAX_SAFE_INTEGER;
      const chain: Record<string, unknown> = {};
      for (const method of ['from', 'select', 'order', 'gte', 'lte']) chain[method] = () => chain;
      chain.range = (a: number, b: number) => {
        from = a;
        to = b;
        ranges.push([a, b]);
        return chain;
      };
      chain.then = (resolve: (v: unknown) => void) =>
        resolve({ data: all.slice(from, Math.min(to + 1, from + 1000)), error: null });
      return chain;
    };
    const c = { from: () => (make() as { from: () => unknown }).from() } as unknown as SupabaseClient;
    return { client: c, ranges };
  }

  it('C-1: with every response cut at 1,000 rows, a 3,700-row window comes back whole, in pages of 1,000', async () => {
    const { client: c, ranges } = pagedClient(3700);
    const result = await repo(c).listSnapshotsInRange('2026-07-17', '2026-10-16');
    if (!result.data || result.data.state !== 'ready') throw new Error('expected rows');
    expect(result.data.rows).toHaveLength(3700);
    expect(new Set(result.data.rows.map((r) => r.metric)).size).toBe(3700);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
    ]);
  });

  it('C-1: a page that comes back full is followed by one more read; an empty page ends it', async () => {
    const { client: c, ranges } = pagedClient(2000);
    const result = await repo(c).listSnapshotsInRange('2026-10-01', '2026-10-16');
    expect(result.data).toMatchObject({ state: 'ready' });
    expect(ranges).toHaveLength(3);
  });

  it('C-1: exactly 5,000 rows is fine', async () => {
    const result = await repo(pagedClient(FINANCE_SNAPSHOT_READ_CEILING).client).listSnapshotsInRange('2026-10-01', '2026-10-16');
    if (!result.data || result.data.state !== 'ready') throw new Error('expected rows');
    expect(result.data.rows).toHaveLength(FINANCE_SNAPSHOT_READ_CEILING);
  });

  it('C-1: past 5,000 rows is an error, never a partial list, even though each response is 1,000', async () => {
    const result = await repo(pagedClient(FINANCE_SNAPSHOT_READ_CEILING + 1).client).listSnapshotsInRange('2026-10-01', '2026-10-16');
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/ceiling/);
  });

  it('malformed dates make no call', async () => {
    const { client: c, calls } = client({ data: [], error: null });
    expect((await repo(c).listSnapshotsInRange('2026-10-1', '2026-10-16')).error).not.toBeNull();
    expect(calls).toEqual([]);
  });

  it('not installed, an error and a throw', async () => {
    expect((await repo(client({ data: null, error: { code: '42P01', message: 'x' } }).client).listSnapshotsInRange('2026-10-01', '2026-10-02')).data).toEqual({
      state: 'not_installed',
    });
    expect((await repo(client({ data: null, error: { code: '57014', message: 'timeout' } }).client).listSnapshotsInRange('2026-10-01', '2026-10-02')).error).not.toBeNull();
    const throwing = client(() => {
      throw new Error('network');
    });
    expect((await repo(throwing.client).listSnapshotsInRange('2026-10-01', '2026-10-02')).error?.message).toBe('network');
  });
});

describe('source: read only (E-98)', () => {
  const code = readFileSync(join(process.cwd(), 'lib', 'repositories', 'BusinessOsFinanceSnapshotReadRepository.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('no insert, upsert, update, delete or rpc; no user_id; no id or taken_at selected', () => {
    expect(code).not.toMatch(/\.(insert|upsert|update|delete|rpc)\s*\(/);
    expect(code).not.toMatch(/user_id|taken_at/);
    expect(/\.(insert|upsert|update|delete|rpc)\s*\(/.test(`${code}\nthis.supabase.from(TABLE).upsert(rows);`)).toBe(true);
  });
});
