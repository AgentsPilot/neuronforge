/**
 * Finance slice 8.2: the history writer (HS-FR-5, E-88, E-96; AC-281, AC-284).
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
import { BusinessOsFinanceSnapshotRepository, type FinanceSnapshotInsertRow } from '../BusinessOsFinanceSnapshotRepository';

type Call = { method: string; args: unknown[] };

/** A fake client that records the builder chain and answers with `result`. */
function client(result: { data: unknown; error: unknown } | (() => never)) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'limit', 'upsert']) {
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

const ROW: FinanceSnapshotInsertRow = { as_of_date: '2026-10-17', metric: 'accounts_total', dimension: 'all', unit: 'accounts', value: 12 };

describe('insertSnapshotRows (E-88)', () => {
  it('one upsert with ON CONFLICT DO NOTHING on the day key, then select id; written and already there from the ids', async () => {
    const { client: c, calls } = client({ data: [{ id: 'x' }], error: null });
    const result = await new BusinessOsFinanceSnapshotRepository(c).insertSnapshotRows([ROW, { ...ROW, metric: 'founding_dormant', value: 1 }]);
    expect(result).toEqual({ data: { written: 1, alreadyThere: 1 }, error: null });
    expect(calls.map((x) => x.method)).toEqual(['from', 'upsert', 'select']);
    expect(calls[0].args).toEqual(['business_os_finance_snapshots']);
    expect(calls[1].args[1]).toEqual({ onConflict: 'as_of_date,metric,dimension', ignoreDuplicates: true });
    expect(calls[2].args).toEqual(['id']);
  });

  it('AC-284: only the five granted fields are sent, whatever the input carries', async () => {
    const { client: c, calls } = client({ data: [], error: null });
    const planted = { ...ROW, id: 'chosen', taken_at: '2020-01-01', user_id: 'someone' } as unknown as FinanceSnapshotInsertRow;
    await new BusinessOsFinanceSnapshotRepository(c).insertSnapshotRows([planted]);
    const [sent] = calls[1].args[0] as Array<Record<string, unknown>>;
    expect(Object.keys(sent).sort()).toEqual(['as_of_date', 'dimension', 'metric', 'unit', 'value']);
  });

  it('an empty list makes no call', async () => {
    const { client: c, calls } = client({ data: [], error: null });
    expect(await new BusinessOsFinanceSnapshotRepository(c).insertSnapshotRows([])).toEqual({ data: { written: 0, alreadyThere: 0 }, error: null });
    expect(calls).toEqual([]);
  });

  it('an error or a throw is { error }, never a throw', async () => {
    const failing = client({ data: null, error: { code: '23514', message: 'check' } });
    const r1 = await new BusinessOsFinanceSnapshotRepository(failing.client).insertSnapshotRows([ROW]);
    expect(r1.data).toBeNull();
    expect((r1.error as Error & { code?: string }).code).toBe('23514');
    const throwing = client(() => {
      throw new Error('network');
    });
    const r2 = await new BusinessOsFinanceSnapshotRepository(throwing.client).insertSnapshotRows([ROW]);
    expect(r2.error?.message).toBe('network');
  });
});

describe('probeTable (E-96)', () => {
  it('installed when the select works', async () => {
    const { client: c, calls } = client({ data: [], error: null });
    expect(await new BusinessOsFinanceSnapshotRepository(c).probeTable()).toEqual({ data: { installed: true }, error: null });
    expect(calls.map((x) => x.method)).toEqual(['from', 'select', 'limit']);
  });

  it.each([
    ['42P01', 'relation "public.business_os_finance_snapshots" does not exist'],
    ['PGRST205', 'Could not find the table public.business_os_finance_snapshots in the schema cache'],
  ])('%s is "not installed"', async (code, message) => {
    const { client: c } = client({ data: null, error: { code, message } });
    expect(await new BusinessOsFinanceSnapshotRepository(c).probeTable()).toEqual({ data: { installed: false }, error: null });
  });

  it('a missing COLUMN (42703) is a real error, not "not installed"', async () => {
    const { client: c } = client({ data: null, error: { code: '42703', message: 'column "id" does not exist' } });
    const result = await new BusinessOsFinanceSnapshotRepository(c).probeTable();
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
  });
});

describe('source: append only, no tenant scope to add', () => {
  const code = readFileSync(join(process.cwd(), 'lib', 'repositories', 'BusinessOsFinanceSnapshotRepository.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('no update, delete or rpc; no spread into the insert; no user_id', () => {
    expect(code).not.toMatch(/\.(update|delete|rpc|insert)\s*\(/);
    expect(code).not.toMatch(/\.\.\.row\b/);
    expect(code).not.toMatch(/user_id/);
    expect(/\.(update|delete|rpc)\s*\(/.test(`${code}\nthis.supabase.from(TABLE).delete();`)).toBe(true);
  });

  it('the header documents the user_id bypass and the not-installed exception', () => {
    const header = readFileSync(join(process.cwd(), 'lib', 'repositories', 'BusinessOsFinanceSnapshotRepository.ts'), 'utf8');
    expect(header).toContain('NO user_id FILTER, ON PURPOSE');
    expect(header).toContain('THE TABLE MAY NOT EXIST YET');
  });
});
