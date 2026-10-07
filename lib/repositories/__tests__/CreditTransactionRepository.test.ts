/**
 * Unit tests for CreditTransactionRepository.sumCreditsDeltaByActivityType —
 * the Settings billing summary's reward / boost-pack totals (GET
 * /api/billing/summary, P-10 workplan §16b B-3).
 *
 * `listForUserDataExport` is covered by userDataExportReads.test.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import { CreditTransactionRepository } from '@/lib/repositories/CreditTransactionRepository';

const USER = '11111111-1111-4111-8111-111111111111';
const TYPES = ['reward_credit', 'boost_pack_purchase'] as const;

function mockSupabase(result: { data: unknown; error: unknown }) {
  const calls: { table?: string; select?: string; filters: unknown[][] } = { filters: [] };
  const builder: Record<string, unknown> = {
    select: (cols: string) => {
      calls.select = cols;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      calls.filters.push(['eq', col, val]);
      return builder;
    },
    in: (col: string, vals: unknown) => {
      calls.filters.push(['in', col, vals]);
      return builder;
    },
    then: (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => Promise.resolve(result).then(onF, onR),
  };
  const from = jest.fn((t: string) => {
    calls.table = t;
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls, from };
}

describe('CreditTransactionRepository.sumCreditsDeltaByActivityType', () => {
  it('sums credits_delta per asked-for type, scoped to the caller, in one query', async () => {
    const { client, calls, from } = mockSupabase({
      data: [
        { activity_type: 'reward_credit', credits_delta: 100 },
        { activity_type: 'boost_pack_purchase', credits_delta: 2000 },
        { activity_type: 'reward_credit', credits_delta: 50 },
        { activity_type: 'boost_pack_purchase', credits_delta: 500 },
      ],
      error: null,
    });
    const res = await new CreditTransactionRepository(client).sumCreditsDeltaByActivityType(USER, TYPES);
    expect(res).toEqual({ data: { reward_credit: 150, boost_pack_purchase: 2500 }, error: null });
    expect(from).toHaveBeenCalledTimes(1);
    expect(calls.table).toBe('credit_transactions');
    expect(calls.select).toBe('activity_type, credits_delta');
    expect(calls.filters).toEqual([
      ['eq', 'user_id', USER],
      ['in', 'activity_type', ['reward_credit', 'boost_pack_purchase']],
    ]);
  });

  it('a type with no rows is 0, and no rows at all is all zeros', async () => {
    const { client } = mockSupabase({ data: [], error: null });
    const res = await new CreditTransactionRepository(client).sumCreditsDeltaByActivityType(USER, TYPES);
    expect(res).toEqual({ data: { reward_credit: 0, boost_pack_purchase: 0 }, error: null });
  });

  it('null data is treated as no rows', async () => {
    const { client } = mockSupabase({ data: null, error: null });
    const res = await new CreditTransactionRepository(client).sumCreditsDeltaByActivityType(USER, TYPES);
    expect(res).toEqual({ data: { reward_credit: 0, boost_pack_purchase: 0 }, error: null });
  });

  it('ignores a row of a type it was not asked for, and a null delta', async () => {
    const { client } = mockSupabase({
      data: [
        { activity_type: 'agent_run', credits_delta: -999 },
        { activity_type: 'reward_credit', credits_delta: null },
        { activity_type: 'reward_credit', credits_delta: 25 },
      ],
      error: null,
    });
    const res = await new CreditTransactionRepository(client).sumCreditsDeltaByActivityType(USER, TYPES);
    expect(res.data).toEqual({ reward_credit: 25, boost_pack_purchase: 0 });
  });

  it('no types asked for: no query, empty map', async () => {
    const { client, from } = mockSupabase({ data: [], error: null });
    const res = await new CreditTransactionRepository(client).sumCreditsDeltaByActivityType(USER, []);
    expect(res).toEqual({ data: {}, error: null });
    expect(from).not.toHaveBeenCalled();
  });

  it('returns { data: null, error } on a DB error, never throws', async () => {
    const dbErr = { code: '42501', message: 'permission denied' };
    const { client } = mockSupabase({ data: null, error: dbErr });
    const res = await new CreditTransactionRepository(client).sumCreditsDeltaByActivityType(USER, TYPES);
    expect(res.data).toBeNull();
    expect(res.error).toBe(dbErr);
  });
});
