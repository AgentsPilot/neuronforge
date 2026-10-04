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
  CHARGE_LIST_LIMITS,
  CREDIT_LEDGER_READ_LIMITS,
  CREDIT_LEDGER_ROW_COLUMNS,
  CREDIT_TOTALS_COLUMNS,
  type ChargeListFilter,
  CREDIT_TOTALS_POSITION_COLUMNS,
  type CreditLedgerRow,
} from '../BusinessOsCreditLedgerReadRepository';

type Call = { method: string; args: unknown[] };

/** Records every query; each resolves with `respond(calls, index)`. */
function recordingClient(
  respond: (calls: Call[], index: number) => { data: unknown; error: unknown; count?: number | null }
) {
  const queries: Call[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      const index = queries.length;
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'lt', 'lte', 'order', 'range', 'limit', 'not', 'is']) {
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

describe('listTotalsForAccountsInRange (slice 8a, the admin "Credits left" column)', () => {
  it('selects user_id, period_start and credits_total only — no cost column', () => {
    expect(CREDIT_TOTALS_POSITION_COLUMNS.split(',').map((c) => c.trim())).toEqual([
      'user_id',
      'period_start',
      'credits_total',
    ]);
    expect(CREDIT_TOTALS_POSITION_COLUMNS).not.toMatch(/cost|usd|fallback/);
  });

  it('reads the named accounts with one IN list, the half-open range, newest first', async () => {
    const { client, queries } = recordingClient(() => ({
      data: [{ user_id: A, period_start: 'p1', credits_total: '1.5' }],
      error: null,
    }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listTotalsForAccountsInRange(
      [A, B, A],
      RANGE,
      PAGING
    );

    expect(result.error).toBeNull();
    expect(result.data?.rows).toEqual([{ user_id: A, period_start: 'p1', credits_total: '1.5' }]);
    expect(queries).toHaveLength(1);
    expect(argsOf(queries[0], 'from')).toEqual([['business_os_credit_totals']]);
    expect(argsOf(queries[0], 'select')).toEqual([[CREDIT_TOTALS_POSITION_COLUMNS]]);
    expect(argsOf(queries[0], 'in')).toEqual([['user_id', [A, B]]]);
    expect(argsOf(queries[0], 'gte')).toEqual([['period_start', '2026-08-01T00:00:00.000Z']]);
    expect(argsOf(queries[0], 'lt')).toEqual([['period_start', '2026-10-01T00:00:00.000Z']]);
    expect(argsOf(queries[0], 'eq')).toEqual([]);
    expect(argsOf(queries[0], 'order')[0]).toEqual(['period_start', { ascending: false }]);
  });

  it('pages, de-duplicates by (account, period) and reports the ceiling', async () => {
    const pages = [
      [{ user_id: A, period_start: 'p1', credits_total: 1 }, { user_id: B, period_start: 'p1', credits_total: 2 }],
      [{ user_id: B, period_start: 'p1', credits_total: 2 }, { user_id: A, period_start: 'p0', credits_total: 3 }],
      [],
    ];
    const { client, queries } = recordingClient((_calls, i) => ({ data: pages[i], error: null }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listTotalsForAccountsInRange([A, B], RANGE, PAGING);
    expect(queries).toHaveLength(3);
    expect(result.data?.rows.map((r) => `${r.user_id}|${r.period_start}`)).toEqual([`${A}|p1`, `${B}|p1`, `${A}|p0`]);
    expect(result.data?.reachedCeiling).toBe(false);

    let n = 0;
    const full = recordingClient(() => ({
      data: [{ user_id: A, period_start: `q${n++}`, credits_total: 1 }, { user_id: A, period_start: `q${n++}`, credits_total: 1 }],
      error: null,
    }));
    const capped = await new BusinessOsCreditLedgerReadRepository(full.client).listTotalsForAccountsInRange([A], RANGE, {
      pageSize: 2,
      ceiling: 4,
    });
    expect(capped.data?.rows).toHaveLength(4);
    expect(capped.data?.reachedCeiling).toBe(true);
  });

  it('returns a database error as { data: null, error }, never throws', async () => {
    const { client } = recordingClient(() => ({ data: null, error: new Error('boom') }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listTotalsForAccountsInRange([A], RANGE, PAGING);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('boom');
  });

  const tooMany = Array.from(
    { length: CREDIT_LEDGER_READ_LIMITS.MAX_IDS_PER_REQUEST + 1 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
  );
  it.each([
    ['no account ids', [] as string[], RANGE, PAGING],
    ['a malformed account id', [A, 'nope'], RANGE, PAGING],
    ['a filter-syntax account id', [`${A},user_id.neq.x`], RANGE, PAGING],
    ['more than MAX_IDS_PER_REQUEST ids', tooMany, RANGE, PAGING],
    ['an inverted range', [A], { from: RANGE.to, to: RANGE.from }, PAGING],
    ['a bad page size', [A], RANGE, { pageSize: 0, ceiling: 10 }],
  ])('refuses %s before querying', async (_name, ids, range, paging) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsCreditLedgerReadRepository(client).listTotalsForAccountsInRange(
      ids,
      range as typeof RANGE,
      paging
    );
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
  });
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

describe('the Activity list (admin AI Activity view, slice B1a)', () => {
  // Half-open on created_at, starting at the charging cut-over floor.
  const WINDOW = { from: new Date('2026-09-29T16:50:53.914Z'), to: new Date('2026-10-03T00:00:00.000Z') };
  const FILTER: ChargeListFilter = { range: WINDOW };
  const LIST = { sort: 'created_at' as const, limit: 100 };

  describe('listChargesAllAccountsInWindow', () => {
    it('reads charge rows of every LIVE account, half-open on created_at, newest first, capped and counted IN the query', async () => {
      const { client, queries } = recordingClient(() => ({ data: [ledgerRow('1')], error: null, count: 7 }));
      const result = await new BusinessOsCreditLedgerReadRepository(client).listChargesAllAccountsInWindow(FILTER, LIST);

      expect(result).toEqual({ data: { rows: [ledgerRow('1')], total: 7 }, error: null });
      expect(queries).toHaveLength(1);
      const [q] = queries;
      expect(q[0].args).toEqual(['business_os_credit_charges']);
      expect(argsOf(q, 'select')).toEqual([[CREDIT_LEDGER_ROW_COLUMNS, { count: 'exact' }]]);
      expect(argsOf(q, 'eq')).toEqual([['kind', 'charge']]);
      // Deleted accounts are excluded here: they have their own bucket (FR-B8).
      expect(argsOf(q, 'not')).toEqual([['user_id', 'is', null]]);
      expect(argsOf(q, 'is')).toEqual([]);
      expect(argsOf(q, 'gte')).toEqual([['created_at', WINDOW.from.toISOString()]]);
      expect(argsOf(q, 'lt')).toEqual([['created_at', WINDOW.to.toISOString()]]);
      expect(argsOf(q, 'lte')).toEqual([]);
      expect(argsOf(q, 'in')).toEqual([]);
      expect(argsOf(q, 'order')).toEqual([
        ['created_at', { ascending: false }],
        ['id', { ascending: false }],
      ]);
      // FR-B10: the cap is in the query, not a slice in Node.
      expect(argsOf(q, 'range')).toEqual([[0, 99]]);
      expect(mockLog.info).toHaveBeenCalledTimes(1);
    });

    it('orders by GROSS cost, then id, for the cost sort', async () => {
      const { client, queries } = recordingClient(() => ({ data: [], error: null, count: 0 }));
      await new BusinessOsCreditLedgerReadRepository(client).listChargesAllAccountsInWindow(FILTER, {
        sort: 'cost_usd',
        limit: 10,
      });
      expect(argsOf(queries[0], 'order')).toEqual([
        ['cost_usd', { ascending: false }],
        ['id', { ascending: false }],
      ]);
      expect(argsOf(queries[0], 'range')).toEqual([[0, 9]]);
    });

    it('applies every filter, together, to the same query that is counted', async () => {
      const { client, queries } = recordingClient(() => ({ data: [], error: null, count: 0 }));
      await new BusinessOsCreditLedgerReadRepository(client).listChargesAllAccountsInWindow(
        {
          range: WINDOW,
          actionTypes: ['chat_turn', 'chat_website_operation'],
          outcome: 'failed',
          triggeredBy: 'scheduled',
          minCostUsd: '0.0015',
        },
        LIST
      );
      const [q] = queries;
      expect(argsOf(q, 'in')).toEqual([['action_type', ['chat_turn', 'chat_website_operation']]]);
      expect(argsOf(q, 'eq')).toEqual([
        ['kind', 'charge'],
        ['outcome', 'failed'],
        ['triggered_by', 'scheduled'],
      ]);
      // The cost floor stays a decimal string: numeric(16,10) never goes through a float.
      expect(argsOf(q, 'gte')).toEqual([
        ['created_at', WINDOW.from.toISOString()],
        ['cost_usd', '0.0015'],
      ]);
    });

    it.each([
      ['an area', { actionTypes: ['insight_run'] }, 'in', ['action_type', ['insight_run']]],
      ['an outcome', { outcome: 'succeeded' }, 'eq', ['outcome', 'succeeded']],
      ['a trigger', { triggeredBy: 'external' }, 'eq', ['triggered_by', 'external']],
      ['a cost floor', { minCostUsd: '2' }, 'gte', ['cost_usd', '2']],
    ])('applies %s on its own', async (_name, extra, method, expected) => {
      const { client, queries } = recordingClient(() => ({ data: [], error: null, count: 0 }));
      await new BusinessOsCreditLedgerReadRepository(client).listChargesAllAccountsInWindow(
        { range: WINDOW, ...(extra as Partial<ChargeListFilter>) },
        LIST
      );
      expect(argsOf(queries[0], method)).toContainEqual(expected);
    });

    it('passes a missing count through as null, never as 0', async () => {
      const { client } = recordingClient(() => ({ data: [ledgerRow('1')], error: null, count: null }));
      const result = await new BusinessOsCreditLedgerReadRepository(client).listChargesAllAccountsInWindow(FILTER, LIST);
      expect(result.data?.total).toBeNull();
    });

    it.each([
      ['a limit over the cap', FILTER, { sort: 'created_at', limit: CHARGE_LIST_LIMITS.MAX_LIMIT + 1 }],
      ['a zero limit', FILTER, { sort: 'created_at', limit: 0 }],
      ['a fractional limit', FILTER, { sort: 'created_at', limit: 1.5 }],
      ['an unknown sort', FILTER, { sort: 'service', limit: 10 }],
      ['an empty window', { range: { from: WINDOW.from, to: WINDOW.from } }, LIST],
      ['an empty action-type list', { range: WINDOW, actionTypes: [] }, LIST],
      ['a malformed action type', { range: WINDOW, actionTypes: ['chat_turn,outcome.eq.failed'] }, LIST],
      [
        'too many action types',
        { range: WINDOW, actionTypes: Array.from({ length: CHARGE_LIST_LIMITS.MAX_ACTION_TYPES + 1 }, (_v, i) => `t${i}`) },
        LIST,
      ],
      ['an unknown outcome', { range: WINDOW, outcome: 'maybe' }, LIST],
      ['an unknown trigger', { range: WINDOW, triggeredBy: 'cron' }, LIST],
      ['a cost floor that is not a dollar amount', { range: WINDOW, minCostUsd: '1e3' }, LIST],
      ['a cost floor with more than 10 decimals', { range: WINDOW, minCostUsd: '0.00000000001' }, LIST],
    ])('refuses %s before querying', async (_name, filter, opts) => {
      const { client, queries } = recordingClient(() => ({ data: [], error: null, count: 0 }));
      const result = await new BusinessOsCreditLedgerReadRepository(client).listChargesAllAccountsInWindow(
        filter as ChargeListFilter,
        opts as typeof LIST
      );
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(queries).toHaveLength(0);
      expect(mockLog.warn).toHaveBeenCalled();
    });

    it('returns a database error as { data: null, error }, never throws', async () => {
      const { client } = recordingClient(() => ({ data: null, error: new Error('down') }));
      const result = await new BusinessOsCreditLedgerReadRepository(client).listChargesAllAccountsInWindow(FILTER, LIST);
      expect(result).toEqual({ data: null, error: expect.objectContaining({ message: 'down' }) });
    });
  });

  describe('listChargesForAccountInWindow', () => {
    it('scopes the same query to the one account, and logs at debug', async () => {
      const { client, queries } = recordingClient(() => ({ data: [], error: null, count: 0 }));
      const result = await new BusinessOsCreditLedgerReadRepository(client).listChargesForAccountInWindow(A, FILTER, LIST);
      expect(result.error).toBeNull();
      const [q] = queries;
      expect(argsOf(q, 'eq')).toEqual([
        ['kind', 'charge'],
        ['user_id', A],
      ]);
      expect(argsOf(q, 'not')).toEqual([]);
      expect(argsOf(q, 'is')).toEqual([]);
      expect(argsOf(q, 'select')).toEqual([[CREDIT_LEDGER_ROW_COLUMNS, { count: 'exact' }]]);
      expect(mockLog.info).not.toHaveBeenCalled();
      expect(mockLog.debug).toHaveBeenCalledTimes(1);
    });

    it.each([['missing', ''], ['malformed', 'not-a-uuid']])('refuses a %s account before querying', async (_n, id) => {
      const { client, queries } = recordingClient(() => ({ data: [], error: null, count: 0 }));
      const result = await new BusinessOsCreditLedgerReadRepository(client).listChargesForAccountInWindow(id, FILTER, LIST);
      expect(result.data).toBeNull();
      expect(queries).toHaveLength(0);
    });
  });

  describe('listAdjustmentsForActionIds', () => {
    const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

    it('reads adjustment rows by the action ids they correct, with NO time bound (FR-B12)', async () => {
      const adjustment = ledgerRow('9', {
        kind: 'adjustment',
        action_id: null,
        adjusts_action_id: ID,
        reason_code: 'fallback_price_reconciled',
      });
      const { client, queries } = recordingClient(() => ({ data: [adjustment], error: null }));
      const result = await new BusinessOsCreditLedgerReadRepository(client).listAdjustmentsForActionIds([ID, ID]);

      expect(result).toEqual({ data: { rows: [adjustment], reachedCeiling: false }, error: null });
      const [q] = queries;
      expect(argsOf(q, 'select')).toEqual([[CREDIT_LEDGER_ROW_COLUMNS]]);
      expect(argsOf(q, 'eq')).toEqual([['kind', 'adjustment']]);
      expect(argsOf(q, 'in')).toEqual([['adjusts_action_id', [ID]]]);
      // An adjustment written in a later period still nets onto its charge.
      expect(argsOf(q, 'gte')).toEqual([]);
      expect(argsOf(q, 'lt')).toEqual([]);
      expect(argsOf(q, 'range')).toEqual([[0, CREDIT_LEDGER_READ_LIMITS.MAX_PAGE_SIZE - 1]]);
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
      const result = await new BusinessOsCreditLedgerReadRepository(client).listAdjustmentsForActionIds(ids);
      expect(result.data).toBeNull();
      expect(queries).toHaveLength(0);
    });

    it('returns a failed read as an error, never throws', async () => {
      const exploding = {
        from: () => {
          throw new Error('client exploded');
        },
      } as unknown as SupabaseClient;
      const result = await new BusinessOsCreditLedgerReadRepository(exploding).listAdjustmentsForActionIds([ID]);
      expect(result.error?.message).toBe('client exploded');
    });
  });

  describe('listChargesOfDeletedAccountsInWindow', () => {
    it('reads charges with user_id NULL, with the same filters, counted on the first page only', async () => {
      const { client, queries } = recordingClient((_c, i) => ({
        data:
          i === 0
            ? [ledgerRow('1', { user_id: null }), ledgerRow('2', { user_id: null })]
            : [ledgerRow('3', { user_id: null })],
        error: null,
        count: i === 0 ? 3 : null,
      }));
      const result = await new BusinessOsCreditLedgerReadRepository(client).listChargesOfDeletedAccountsInWindow(
        { range: WINDOW, outcome: 'succeeded' },
        { pageSize: 2, ceiling: 10 }
      );

      expect(result.error).toBeNull();
      expect(result.data?.rows.map((r) => r.id)).toEqual(['1', '2', '3']);
      expect(result.data?.total).toBe(3);
      expect(result.data?.reachedCeiling).toBe(false);
      expect(queries).toHaveLength(2);
      expect(argsOf(queries[0], 'select')).toEqual([[CREDIT_LEDGER_ROW_COLUMNS, { count: 'exact' }]]);
      expect(argsOf(queries[1], 'select')).toEqual([[CREDIT_LEDGER_ROW_COLUMNS, undefined]]);
      for (const q of queries) {
        expect(argsOf(q, 'is')).toEqual([['user_id', null]]);
        expect(argsOf(q, 'not')).toEqual([]);
        expect(argsOf(q, 'eq')).toEqual([
          ['kind', 'charge'],
          ['outcome', 'succeeded'],
        ]);
      }
      expect(mockLog.info).toHaveBeenCalledTimes(1);
    });

    it('says when the ceiling was reached', async () => {
      let n = 0;
      const { client } = recordingClient(() => ({
        data: [ledgerRow(String(n++), { user_id: null }), ledgerRow(String(n++), { user_id: null })],
        error: null,
        count: 99,
      }));
      const result = await new BusinessOsCreditLedgerReadRepository(client).listChargesOfDeletedAccountsInWindow(FILTER, {
        pageSize: 2,
        ceiling: 4,
      });
      expect(result.data?.rows).toHaveLength(4);
      expect(result.data?.reachedCeiling).toBe(true);
      expect(result.data?.total).toBe(99);
    });

    /** Serves `n` stored rows honouring the requested range, as PostgREST does. */
    function tableOf(n: number) {
      const stored = Array.from({ length: n }, (_v, i) => ledgerRow(String(i), { user_id: null }));
      return recordingClient((calls) => {
        const [from, to] = argsOf(calls, 'range')[0] as [number, number];
        return { data: stored.slice(from, to + 1), error: null, count: n };
      });
    }

    it('QA E-1: exactly the ceiling is NOT "reached" — every row was read', async () => {
      const { client, queries } = tableOf(4);
      const result = await new BusinessOsCreditLedgerReadRepository(client).listChargesOfDeletedAccountsInWindow(FILTER, {
        pageSize: 2,
        ceiling: 4,
      });
      expect(result.data?.rows).toHaveLength(4);
      expect(result.data?.reachedCeiling).toBe(false);
      // The probe for a fifth row is one row wide.
      expect(argsOf(queries[queries.length - 1], 'range')).toEqual([[4, 4]]);
    });

    it('QA E-1: one row past the ceiling is "reached", and only the ceiling is returned', async () => {
      const { client } = tableOf(5);
      const result = await new BusinessOsCreditLedgerReadRepository(client).listChargesOfDeletedAccountsInWindow(FILTER, {
        pageSize: 2,
        ceiling: 4,
      });
      expect(result.data?.rows.map((r) => r.id)).toEqual(['0', '1', '2', '3']);
      expect(result.data?.reachedCeiling).toBe(true);
    });

    it('refuses bad paging before querying', async () => {
      const { client, queries } = recordingClient(() => ({ data: [], error: null }));
      const result = await new BusinessOsCreditLedgerReadRepository(client).listChargesOfDeletedAccountsInWindow(FILTER, {
        pageSize: 1001,
        ceiling: 10,
      });
      expect(result.data).toBeNull();
      expect(queries).toHaveLength(0);
    });
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

  it('is imported only by the report builder, the leak check (slice 4b), the Activity view (B1a), the barrel and tests', () => {
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
        // Admin AI Activity view (Gap B slice B1a): types via Pick<...> and the
        // value CHARGE_LIST_LIMITS; it calls no read method itself ...
        'lib/business-os/credits/aiActivity.ts',
        // ... and its production wiring, which calls the four Activity reads.
        'lib/business-os/credits/aiActivityDeps.ts',
        // Slice 8a: the admin "Credits left" column's production wiring.
        'lib/business-os/credits/adminCreditPercentDeps.ts',
        'lib/repositories/BusinessOsCreditLedgerReadRepository.ts',
        'lib/repositories/index.ts',
      ].sort()
    );
  });
});
