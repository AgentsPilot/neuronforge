/**
 * BusinessOsCreditLedgerReadRepository — the read-only ledger access of the
 * operator cost report (credit deduction slice 4a, workplan §4.4, SA Q-3).
 *
 * Pinned: each method's query (columns, account scope, ranges, paging,
 * de-duplication, ceiling), that every method refuses bad input BEFORE
 * querying and never throws, that the source holds no write verb and no filter
 * on the raw `service` column, and who may import it.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
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

import {
  BusinessOsCreditLedgerReadRepository,
  CREDIT_LEDGER_READ_LIMITS,
  CREDIT_LEDGER_ROW_COLUMNS,
  CREDIT_TOTALS_COLUMNS,
  type CreditLedgerRow,
} from '../BusinessOsCreditLedgerReadRepository';

type Call = { method: string; args: unknown[] };

/** Records every query; each resolves with `respond(calls, index)`. */
function recordingClient(respond: (calls: Call[], index: number) => { data: unknown; error: unknown }) {
  const queries: Call[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      const index = queries.length;
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'lt', 'lte', 'order', 'range', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        try {
          resolve(respond(calls, index));
        } catch (err) {
          reject(err);
        }
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const argsOf = (calls: Call[], method: string) => calls.filter((c) => c.method === method).map((c) => c.args);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
// Half-open: `to` is exclusive (SA CR-B1), a whole-day boundary.
const RANGE = { from: new Date('2026-08-01T00:00:00.000Z'), to: new Date('2026-10-01T00:00:00.000Z') };
const PAGING = { pageSize: 2, ceiling: 10 };

function ledgerRow(id: string, extra: Partial<CreditLedgerRow> = {}): CreditLedgerRow {
  return {
    id,
    kind: 'charge',
    action_id: `aaaaaaaa-aaaa-4aaa-8aaa-${id.padStart(12, '0')}`,
    adjusts_action_id: null,
    reason_code: null,
    user_id: A,
    period_start: '2026-09-01T00:00:00+00:00',
    group_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    credits: '1.000000',
    cost_usd: '0.0010000000',
    credit_value_version: 0,
    is_fallback_priced: false,
    service: 'ai',
    action_type: 'chat_turn',
    triggered_by: 'owner',
    outcome: 'succeeded',
    created_at: '2026-09-10T10:00:00+00:00',
    ...extra,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('column allow-lists', () => {
  it('select exactly the columns the report needs, and no others', () => {
    expect(CREDIT_LEDGER_ROW_COLUMNS.split(',').map((c) => c.trim())).toEqual([
      'id', 'kind', 'action_id', 'adjusts_action_id', 'reason_code', 'user_id', 'period_start', 'group_id',
      'credits', 'cost_usd', 'credit_value_version', 'is_fallback_priced', 'service', 'action_type',
      'triggered_by', 'outcome', 'created_at',
    ]);
    expect(CREDIT_TOTALS_COLUMNS.split(',').map((c) => c.trim())).toEqual([
      'user_id', 'period_start', 'credits_total', 'credits_owner', 'credits_scheduled', 'credits_external',
      'credits_adjustment', 'cost_usd_total', 'charge_count', 'fallback_priced_count', 'updated_at',
    ]);
  });
});

describe('listTotalsForPeriodsInRange (the one all-accounts read)', () => {
  it('reads the totals table by period range only, with the allow-listed columns, and logs at info', async () => {
    const { client, queries } = recordingClient(() => ({
      data: [{ user_id: A, period_start: '2026-09-01T00:00:00+00:00' }],
      error: null,
    }));
    const repo = new BusinessOsCreditLedgerReadRepository(client);
    const result = await repo.listTotalsForPeriodsInRange(RANGE, PAGING);

    expect(result.error).toBeNull();
    expect(result.data?.rows).toHaveLength(1);
    expect(result.data?.reachedCeiling).toBe(false);
    const [q] = queries;
    expect(q[0].args).toEqual(['business_os_credit_totals']);
    expect(argsOf(q, 'select')).toEqual([[CREDIT_TOTALS_COLUMNS]]);
    expect(argsOf(q, 'gte')).toEqual([['period_start', RANGE.from.toISOString()]]);
    // Exclusive upper bound (CR-B1): never `.lte`, which a millisecond Date
    // bound would turn into "drop the row whose microseconds exceed it".
    expect(argsOf(q, 'lt')).toEqual([['period_start', RANGE.to.toISOString()]]);
    expect(argsOf(q, 'lte')).toEqual([]);
    expect(argsOf(q, 'eq')).toEqual([]);
    expect(mockLog.info).toHaveBeenCalledTimes(1);
  });

  it('pages until a short page and de-duplicates a row read twice', async () => {
    const pages = [
      [{ user_id: A, period_start: 'p1' }, { user_id: B, period_start: 'p1' }],
      [{ user_id: B, period_start: 'p1' }, { user_id: A, period_start: 'p0' }],
      [{ user_id: B, period_start: 'p0' }],
    ];
    const { client, queries } = recordingClient((_calls, i) => ({ data: pages[i], error: null }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listTotalsForPeriodsInRange(RANGE, PAGING);

    expect(queries).toHaveLength(3);
    expect(queries.map((q) => argsOf(q, 'range')[0])).toEqual([[0, 1], [2, 3], [4, 5]]);
    expect(result.data?.rows.map((r) => `${r.user_id}|${r.period_start}`)).toEqual([
      `${A}|p1`, `${B}|p1`, `${A}|p0`, `${B}|p0`,
    ]);
  });

  it('stops at the ceiling and says so', async () => {
    let n = 0;
    const { client } = recordingClient(() => ({
      data: [{ user_id: A, period_start: `p${n++}` }, { user_id: A, period_start: `p${n++}` }],
      error: null,
    }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listTotalsForPeriodsInRange(RANGE, {
      pageSize: 2,
      ceiling: 4,
    });
    expect(result.data?.rows).toHaveLength(4);
    expect(result.data?.reachedCeiling).toBe(true);
  });

  it('returns a database error as { data: null, error }, never throws', async () => {
    const { client } = recordingClient(() => ({ data: null, error: new Error('boom') }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listTotalsForPeriodsInRange(RANGE, PAGING);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('boom');
    expect(mockLog.error).toHaveBeenCalled();
  });

  it.each([
    ['an inverted range', { from: RANGE.to, to: RANGE.from }, PAGING],
    ['an empty half-open range (from = to)', { from: RANGE.from, to: RANGE.from }, PAGING],
    ['an invalid date', { from: new Date('nope'), to: RANGE.to }, PAGING],
    ['a zero page size', RANGE, { pageSize: 0, ceiling: 10 }],
    ['a page size over PostgREST max-rows', RANGE, { pageSize: 1001, ceiling: 10 }],
    ['a ceiling over the maximum', RANGE, { pageSize: 10, ceiling: CREDIT_LEDGER_READ_LIMITS.MAX_CEILING + 1 }],
  ])('refuses %s before querying', async (_name, range, paging) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listTotalsForPeriodsInRange(
      range as typeof RANGE,
      paging
    );
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
  });
});

describe('listTotalsForAccountInRange', () => {
  it('scopes the read to the one account', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listTotalsForAccountInRange(A, RANGE, PAGING);
    expect(result.error).toBeNull();
    expect(argsOf(queries[0], 'eq')).toEqual([['user_id', A]]);
  });

  it.each([['missing', ''], ['malformed', 'not-a-uuid'], ['undefined', undefined as unknown as string]])(
    'refuses a %s account id before querying',
    async (_name, id) => {
      const { client, queries } = recordingClient(() => ({ data: [], error: null }));
      const result = await new BusinessOsCreditLedgerReadRepository(client).listTotalsForAccountInRange(id, RANGE, PAGING);
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(queries).toHaveLength(0);
    }
  );
});

describe('listRowsForAccountPeriods', () => {
  it('reads charges AND adjustments of the named accounts in the period range, newest first', async () => {
    const { client, queries } = recordingClient(() => ({ data: [ledgerRow('1')], error: null }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listRowsForAccountPeriods([A, B], RANGE, PAGING);

    expect(result.error).toBeNull();
    expect(result.data?.rows).toHaveLength(1);
    const [q] = queries;
    expect(q[0].args).toEqual(['business_os_credit_charges']);
    expect(argsOf(q, 'select')).toEqual([[CREDIT_LEDGER_ROW_COLUMNS]]);
    expect(argsOf(q, 'in')).toEqual([['user_id', [A, B]]]);
    expect(argsOf(q, 'gte')).toEqual([['period_start', RANGE.from.toISOString()]]);
    expect(argsOf(q, 'lt')).toEqual([['period_start', RANGE.to.toISOString()]]);
    expect(argsOf(q, 'lte')).toEqual([]);
    // No filter on `kind`: adjustments are part of every period's figures.
    expect(argsOf(q, 'eq')).toEqual([]);
    expect(argsOf(q, 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
  });

  it('pages, de-duplicates by id, and stops at the ceiling across accounts', async () => {
    let n = 0;
    const { client, queries } = recordingClient(() => {
      const page = [ledgerRow(String(n)), ledgerRow(String(n + 1))];
      n += 1; // overlap by one: every page repeats the previous page's last row
      return { data: page, error: null };
    });
    const result = await new BusinessOsCreditLedgerReadRepository(client).listRowsForAccountPeriods([A], RANGE, {
      pageSize: 2,
      ceiling: 3,
    });
    expect(result.data?.rows.map((r) => r.id)).toEqual(['0', '1', '2']);
    expect(result.data?.reachedCeiling).toBe(true);
    expect(queries.length).toBeGreaterThanOrEqual(2);
  });

  it('splits a long account list into requests of at most MAX_IDS_PER_REQUEST ids', async () => {
    const ids = Array.from({ length: CREDIT_LEDGER_READ_LIMITS.MAX_IDS_PER_REQUEST + 5 }, (_v, i) =>
      `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`
    );
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    await new BusinessOsCreditLedgerReadRepository(client).listRowsForAccountPeriods(ids, RANGE, PAGING);
    const sizes = queries.map((q) => (argsOf(q, 'in')[0][1] as string[]).length);
    expect(sizes).toEqual([CREDIT_LEDGER_READ_LIMITS.MAX_IDS_PER_REQUEST, 5]);
  });

  it.each([
    ['an empty list', []],
    ['a malformed id in the list', [A, 'nope']],
  ])('refuses %s before querying', async (_name, ids) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listRowsForAccountPeriods(ids, RANGE, PAGING);
    expect(result.data).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it('returns a failed page as an error, never a partial result', async () => {
    const { client } = recordingClient((_c, i) =>
      i === 0 ? { data: [ledgerRow('1'), ledgerRow('2')], error: null } : { data: null, error: new Error('page 2') }
    );
    const result = await new BusinessOsCreditLedgerReadRepository(client).listRowsForAccountPeriods([A], RANGE, PAGING);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('page 2');
  });
});

describe('listRowsForAccountCreatedInRange (slice 4b, the leak check)', () => {
  const WRITTEN = { from: new Date('2026-09-27T23:00:00.000Z'), to: new Date('2026-09-29T01:05:00.000Z') };

  it("reads ONE account's charges AND adjustments by created_at, half-open, newest first", async () => {
    const { client, queries } = recordingClient(() => ({ data: [ledgerRow('1')], error: null }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listRowsForAccountCreatedInRange(A, WRITTEN, PAGING);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ rows: [ledgerRow('1')], reachedCeiling: false });
    const [q] = queries;
    expect(q[0].args).toEqual(['business_os_credit_charges']);
    expect(argsOf(q, 'select')).toEqual([[CREDIT_LEDGER_ROW_COLUMNS]]);
    // Scoped to the one account (CLAUDE.md rule 4); no filter on kind or service.
    expect(argsOf(q, 'eq')).toEqual([['user_id', A]]);
    expect(argsOf(q, 'in')).toEqual([]);
    expect(argsOf(q, 'gte')).toEqual([['created_at', WRITTEN.from.toISOString()]]);
    expect(argsOf(q, 'lt')).toEqual([['created_at', WRITTEN.to.toISOString()]]);
    expect(argsOf(q, 'lte')).toEqual([]);
    expect(argsOf(q, 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(argsOf(q, 'range')).toEqual([[0, 1]]);
  });

  it('pages, de-duplicates by id, and reports the ceiling', async () => {
    let n = 0;
    const { client } = recordingClient(() => {
      const page = [ledgerRow(String(n)), ledgerRow(String(n + 1))];
      n += 1;
      return { data: page, error: null };
    });
    const result = await new BusinessOsCreditLedgerReadRepository(client).listRowsForAccountCreatedInRange(A, WRITTEN, {
      pageSize: 2,
      ceiling: 3,
    });
    expect(result.data?.rows.map((r) => r.id)).toEqual(['0', '1', '2']);
    expect(result.data?.reachedCeiling).toBe(true);
  });

  it('a short page ends the read below the ceiling', async () => {
    const { client, queries } = recordingClient(() => ({ data: [ledgerRow('1')], error: null }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listRowsForAccountCreatedInRange(A, WRITTEN, PAGING);
    expect(result.data?.reachedCeiling).toBe(false);
    expect(queries).toHaveLength(1);
  });

  it.each([
    ['a missing account', '' as string, WRITTEN, PAGING],
    ['a malformed account', 'not-a-uuid', WRITTEN, PAGING],
    ['an empty half-open range', A, { from: WRITTEN.to, to: WRITTEN.to }, PAGING],
    ['a reversed range', A, { from: WRITTEN.to, to: WRITTEN.from }, PAGING],
    ['a page larger than PostgREST returns', A, WRITTEN, { pageSize: 1001, ceiling: 10 }],
  ])('refuses %s before querying', async (_name, account, range, paging) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listRowsForAccountCreatedInRange(account, range, paging);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
  });

  it('returns a failed page as an error, never a partial result, and never throws', async () => {
    const { client } = recordingClient((_c, i) =>
      i === 0 ? { data: [ledgerRow('1'), ledgerRow('2')], error: null } : { data: null, error: new Error('page 2') }
    );
    const result = await new BusinessOsCreditLedgerReadRepository(client).listRowsForAccountCreatedInRange(A, WRITTEN, PAGING);
    expect(result).toEqual({ data: null, error: expect.objectContaining({ message: 'page 2' }) });

    const exploding = {
      from: () => {
        throw new Error('client exploded');
      },
    } as unknown as SupabaseClient;
    const thrown = await new BusinessOsCreditLedgerReadRepository(exploding).listRowsForAccountCreatedInRange(A, WRITTEN, PAGING);
    expect(thrown.error?.message).toBe('client exploded');
  });
});

describe('findChargesByActionIds', () => {
  const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

  it('reads charge rows only, by their action ids', async () => {
    const { client, queries } = recordingClient(() => ({ data: [ledgerRow('1')], error: null }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).findChargesByActionIds([ID, ID]);
    expect(result.data).toHaveLength(1);
    expect(argsOf(queries[0], 'eq')).toEqual([['kind', 'charge']]);
    expect(argsOf(queries[0], 'in')).toEqual([['action_id', [ID]]]);
  });

  it.each([
    ['no ids', []],
    ['a malformed id', ['nope']],
    [
      'more ids than one request may carry',
      Array.from({ length: CREDIT_LEDGER_READ_LIMITS.MAX_IDS_PER_REQUEST + 1 }, (_v, i) =>
        `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`
      ),
    ],
  ])('refuses %s before querying', async (_name, ids) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).findChargesByActionIds(ids);
    expect(result.data).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it('never throws when the client itself throws', async () => {
    const client = {
      from: () => {
        throw new Error('client exploded');
      },
    } as unknown as SupabaseClient;
    const result = await new BusinessOsCreditLedgerReadRepository(client).findChargesByActionIds([ID]);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('client exploded');
  });
});

describe('source guards', () => {
  const FILE = 'lib/repositories/BusinessOsCreditLedgerReadRepository.ts';
  const code = fs
    .readFileSync(path.join(process.cwd(), FILE), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const WRITE_VERB = /\.(insert|update|upsert|delete|rpc)\s*\(/;

  it('the write-verb rule matches a planted write, so a clean file means something', () => {
    expect(WRITE_VERB.test(`await this.supabase.from('x').insert({ a: 1 })`)).toBe(true);
    expect(WRITE_VERB.test(`this.supabase.rpc('fn', {})`)).toBe(true);
    // A column called updated_at is not a write.
    expect(WRITE_VERB.test(`select('updated_at')`)).toBe(false);
  });

  it('names no write verb: the repository cannot write', () => {
    expect(WRITE_VERB.test(code)).toBe(false);
  });

  it('never filters, orders or groups on the raw service column (N-10)', () => {
    expect(code).not.toMatch(/\.(eq|neq|in|is|filter|order|or|match)\(\s*['"]service['"]/);
    expect(code).not.toMatch(/group by service/i);
  });

  it('bounds period_start only with an exclusive upper bound (CR-B1: no .lte on a microsecond column)', () => {
    expect(code).not.toMatch(/\.lte\(\s*['"]period_start['"]/);
    expect(code).toMatch(/\.lt\(\s*['"]period_start['"]/);
  });

  it('bounds created_at the same way (slice 4b: also a microsecond column)', () => {
    expect(code).not.toMatch(/\.lte\(\s*['"]created_at['"]/);
    expect(code).toMatch(/\.lt\(\s*['"]created_at['"]/);
  });

  it('is imported only by the report builder, the leak check (slice 4b), the barrel and tests', () => {
    const roots = ['app', 'lib', 'components', 'hooks', 'scripts'];
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.next', '.claude', '__tests__'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const rel = path.relative(process.cwd(), full).split(path.sep).join('/');
          if (fs.readFileSync(full, 'utf8').includes('BusinessOsCreditLedgerReadRepository')) found.push(rel);
        }
      }
    };
    roots.filter((r) => fs.existsSync(r)).forEach((r) => walk(path.join(process.cwd(), r)));
    expect(found.sort()).toEqual(
      [
        'lib/business-os/credits/creditReport.ts',
        // Slice 4b: types only (the runner takes its reads injected) ...
        'lib/business-os/credits/creditLeakCheck.ts',
        // ... and the production wiring, which calls two read methods.
        'lib/business-os/credits/creditLeakCheckDeps.ts',
        'lib/repositories/BusinessOsCreditLedgerReadRepository.ts',
        'lib/repositories/index.ts',
      ].sort()
    );
  });
});
