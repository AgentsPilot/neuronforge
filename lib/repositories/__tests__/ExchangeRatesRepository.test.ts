/**
 * Unit tests for `ExchangeRatesRepository` (Admin Exchange Rates slice 1a) —
 * one block per method, against an INJECTED Supabase double. They pin the
 * query each method builds, the never-throws contract, and the SA-R7 trigger
 * contract: every update carries `updated_by` (the admin) and
 * `last_updated_at` (the clock) in ONE `.update()` call.
 */

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = () => undefined;
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// The repository's default client must never be constructed in a unit test.
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: undefined }));

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  EXCHANGE_RATE_HISTORY_LIMIT,
  ExchangeRatesRepository,
  toExchangeRateHistoryRecord,
  toExchangeRateWire,
} from '../ExchangeRatesRepository';
import type { ExchangeRateRow } from '../types';

type QueryResult = { data: unknown; error: unknown };
type Call = { method: string; args: unknown[] };

interface Recorder {
  queries: Array<{ table: string; calls: Call[] }>;
  results: QueryResult[];
  throwOnFrom?: Error;
}

function makeClient(recorder: Recorder): SupabaseClient {
  const CHAIN = ['select', 'update', 'eq', 'order', 'limit', 'maybeSingle'];
  return {
    from(table: string) {
      if (recorder.throwOnFrom) throw recorder.throwOnFrom;
      const query = { table, calls: [] as Call[] };
      recorder.queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of CHAIN) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(recorder.results.shift() ?? { data: null, error: null }).then(resolve, reject);
      return builder;
    },
  } as unknown as SupabaseClient;
}

const NOW = new Date('2026-10-19T12:00:00.000Z');
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';

const ROW: ExchangeRateRow = {
  id: '11111111-1111-4111-8111-111111111111',
  currency_code: 'ILS',
  currency_name: 'Israeli New Shekel',
  currency_symbol: '₪',
  rate_to_usd: '3.650000',
  is_enabled: true,
  decimal_places: 2,
  last_updated_at: '2025-11-05T10:00:00+00:00',
  updated_by: null,
};

function setup(results: QueryResult[] = [], throwOnFrom?: Error) {
  const recorder: Recorder = { queries: [], results: [...results], throwOnFrom };
  const repo = new ExchangeRatesRepository(makeClient(recorder), { now: () => NOW });
  return { repo, recorder };
}

const callsOf = (recorder: Recorder, index = 0) => recorder.queries[index]?.calls ?? [];
const methodsOf = (recorder: Recorder, index = 0) => callsOf(recorder, index).map((c) => c.method);
const argsOf = (recorder: Recorder, method: string, index = 0) =>
  callsOf(recorder, index).filter((c) => c.method === method).map((c) => c.args);

describe('listAll', () => {
  it('selects explicit columns with the rate as text, ordered by code', async () => {
    const { repo, recorder } = setup([{ data: [ROW], error: null }]);
    const result = await repo.listAll();
    expect(result).toEqual({ data: [ROW], error: null });
    expect(recorder.queries[0].table).toBe('exchange_rates');
    expect(methodsOf(recorder)).toEqual(['select', 'order']);
    const [columns] = argsOf(recorder, 'select')[0] as [string];
    expect(columns).toContain('rate_to_usd::text');
    expect(columns).not.toContain('*');
    expect(argsOf(recorder, 'order')[0]).toEqual(['currency_code', { ascending: true }]);
  });

  it('returns an empty list for no rows', async () => {
    const { repo } = setup([{ data: null, error: null }]);
    expect(await repo.listAll()).toEqual({ data: [], error: null });
  });

  it('returns the error, never throws', async () => {
    const { repo } = setup([{ data: null, error: new Error('boom') }]);
    const result = await repo.listAll();
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('boom');
  });

  it('a thrown client error is returned too', async () => {
    const { repo } = setup([], new Error('client down'));
    const result = await repo.listAll();
    expect(result).toEqual({ data: null, error: new Error('client down') });
  });
});

describe('findByCode', () => {
  it('finds one row by code', async () => {
    const { repo, recorder } = setup([{ data: ROW, error: null }]);
    expect(await repo.findByCode('ILS')).toEqual({ data: ROW, error: null });
    expect(methodsOf(recorder)).toEqual(['select', 'eq', 'maybeSingle']);
    expect(argsOf(recorder, 'eq')[0]).toEqual(['currency_code', 'ILS']);
  });

  it('not found is data null with no error', async () => {
    const { repo } = setup([{ data: null, error: null }]);
    expect(await repo.findByCode('XYZ')).toEqual({ data: null, error: null });
  });

  it('returns the error, never throws', async () => {
    const { repo } = setup([{ data: null, error: new Error('read failed') }]);
    const result = await repo.findByCode('ILS');
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('read failed');
  });
});

describe('listRecentHistory', () => {
  const HISTORY = {
    id: 'h1',
    currency_code: 'ILS',
    old_rate: '3.600000',
    new_rate: '3.650000',
    changed_by: ADMIN_ID,
    changed_at: '2026-10-19T11:00:00+00:00',
    change_reason: null,
  };

  it('reads the newest 10, newest first, rates as text (slice 1c.1, FR-18)', async () => {
    const { repo, recorder } = setup([{ data: [HISTORY], error: null }]);
    expect(await repo.listRecentHistory()).toEqual({ data: [HISTORY], error: null });
    expect(recorder.queries[0].table).toBe('exchange_rate_history');
    expect(methodsOf(recorder)).toEqual(['select', 'order', 'limit']);
    const [columns] = argsOf(recorder, 'select')[0] as [string];
    expect(columns).toContain('old_rate::text');
    expect(columns).toContain('new_rate::text');
    expect(argsOf(recorder, 'order')[0]).toEqual(['changed_at', { ascending: false }]);
    expect(argsOf(recorder, 'limit')[0]).toEqual([10]);
    expect(EXCHANGE_RATE_HISTORY_LIMIT).toBe(10);
  });

  it('returns the error, never throws', async () => {
    const { repo } = setup([{ data: null, error: new Error('history failed') }]);
    const result = await repo.listRecentHistory();
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('history failed');
  });
});

describe('listRecentHistoryForCurrency (slice 1c.1, SQ-12)', () => {
  const HISTORY = {
    id: 'h1',
    currency_code: 'ILS',
    old_rate: '3.600000',
    new_rate: '3.650000',
    changed_by: ADMIN_ID,
    changed_at: '2026-10-19T11:00:00+00:00',
    change_reason: null,
  };

  it("reads one currency's newest 10, newest first, rates as text", async () => {
    const { repo, recorder } = setup([{ data: [HISTORY], error: null }]);
    expect(await repo.listRecentHistoryForCurrency('ILS')).toEqual({ data: [HISTORY], error: null });
    expect(recorder.queries).toHaveLength(1);
    expect(recorder.queries[0].table).toBe('exchange_rate_history');
    expect(methodsOf(recorder)).toEqual(['select', 'eq', 'order', 'limit']);
    const [columns] = argsOf(recorder, 'select')[0] as [string];
    expect(columns).toContain('old_rate::text');
    expect(columns).toContain('new_rate::text');
    expect(argsOf(recorder, 'eq')).toEqual([['currency_code', 'ILS']]);
    expect(argsOf(recorder, 'order')[0]).toEqual(['changed_at', { ascending: false }]);
    expect(argsOf(recorder, 'limit')).toEqual([[EXCHANGE_RATE_HISTORY_LIMIT]]);
    expect(EXCHANGE_RATE_HISTORY_LIMIT).toBe(10);
  });

  it('no rows is an empty list, not an error', async () => {
    const { repo } = setup([{ data: [], error: null }]);
    expect(await repo.listRecentHistoryForCurrency('EUR')).toEqual({ data: [], error: null });
  });

  it('returns the error, never throws', async () => {
    const { repo } = setup([{ data: null, error: new Error('history failed') }]);
    const result = await repo.listRecentHistoryForCurrency('ILS');
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('history failed');
  });

  it('a thrown client error comes back as an error too', async () => {
    const { repo } = setup([], new Error('client exploded'));
    const result = await repo.listRecentHistoryForCurrency('ILS');
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('client exploded');
  });
});

describe('updateRate', () => {
  it('one UPDATE with the rate, the clock and the admin, keyed by code', async () => {
    const updated = { ...ROW, rate_to_usd: '3.710000', updated_by: ADMIN_ID };
    const { repo, recorder } = setup([{ data: updated, error: null }]);
    expect(await repo.updateRate('ILS', '3.71', ADMIN_ID)).toEqual({ data: updated, error: null });
    expect(recorder.queries).toHaveLength(1);
    expect(methodsOf(recorder)).toEqual(['update', 'eq', 'select', 'maybeSingle']);
    expect(argsOf(recorder, 'update')).toEqual([
      [{ rate_to_usd: '3.71', last_updated_at: NOW.toISOString(), updated_by: ADMIN_ID }],
    ]);
    expect(argsOf(recorder, 'eq')[0]).toEqual(['currency_code', 'ILS']);
  });

  it('sends the rate as the validated string, never a number', async () => {
    const { repo, recorder } = setup([{ data: ROW, error: null }]);
    await repo.updateRate('ILS', '000150', ADMIN_ID);
    const [payload] = argsOf(recorder, 'update')[0] as [Record<string, unknown>];
    expect(payload.rate_to_usd).toBe('000150');
  });

  it('not found is data null with no error', async () => {
    const { repo } = setup([{ data: null, error: null }]);
    expect(await repo.updateRate('XYZ', '1', ADMIN_ID)).toEqual({ data: null, error: null });
  });

  it('returns the error, never throws', async () => {
    const { repo } = setup([{ data: null, error: new Error('22003') }]);
    const result = await repo.updateRate('ILS', '1', ADMIN_ID);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('22003');
  });
});

describe('setEnabled', () => {
  it('one UPDATE with the flag, the clock and the admin, keyed by code', async () => {
    const { repo, recorder } = setup([{ data: { ...ROW, is_enabled: false }, error: null }]);
    await repo.setEnabled('EUR', false, ADMIN_ID);
    expect(methodsOf(recorder)).toEqual(['update', 'eq', 'select', 'maybeSingle']);
    expect(argsOf(recorder, 'update')).toEqual([
      [{ is_enabled: false, last_updated_at: NOW.toISOString(), updated_by: ADMIN_ID }],
    ]);
    expect(argsOf(recorder, 'eq')[0]).toEqual(['currency_code', 'EUR']);
  });

  it('not found is data null with no error', async () => {
    const { repo } = setup([{ data: null, error: null }]);
    expect(await repo.setEnabled('XYZ', true, ADMIN_ID)).toEqual({ data: null, error: null });
  });

  it('returns the error, never throws', async () => {
    const { repo } = setup([{ data: null, error: new Error('write failed') }]);
    const result = await repo.setEnabled('EUR', true, ADMIN_ID);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('write failed');
  });
});

describe('SA-R7 pin: every update payload carries updated_by and last_updated_at', () => {
  it.each([
    ['updateRate', (repo: ExchangeRatesRepository) => repo.updateRate('ILS', '3.65', ADMIN_ID)],
    ['setEnabled true', (repo: ExchangeRatesRepository) => repo.setEnabled('ILS', true, ADMIN_ID)],
    ['setEnabled false', (repo: ExchangeRatesRepository) => repo.setEnabled('ILS', false, ADMIN_ID)],
  ])('%s', async (_name, run) => {
    const { repo, recorder } = setup([{ data: ROW, error: null }]);
    await run(repo);
    const updates = argsOf(recorder, 'update');
    expect(updates).toHaveLength(1);
    const [payload] = updates[0] as [Record<string, unknown>];
    expect(payload.updated_by).toBe(ADMIN_ID);
    expect(payload.last_updated_at).toBe(NOW.toISOString());
  });
});

describe('wire mapping (SA §10 additional ruling 1)', () => {
  it('maps a row to the wire shape, rate string untouched', () => {
    expect(toExchangeRateWire(ROW)).toEqual({
      currencyCode: 'ILS',
      currencyName: 'Israeli New Shekel',
      currencySymbol: '₪',
      rateToUsd: '3.650000',
      isEnabled: true,
      decimalPlaces: 2,
      lastUpdatedAt: '2025-11-05T10:00:00+00:00',
      updatedBy: null,
    });
  });

  it('is_enabled null reads as false; false stays false', () => {
    expect(toExchangeRateWire({ ...ROW, is_enabled: null }).isEnabled).toBe(false);
    expect(toExchangeRateWire({ ...ROW, is_enabled: false }).isEnabled).toBe(false);
  });

  it('maps a history row to a record (no label yet), keeping changeReason', () => {
    expect(
      toExchangeRateHistoryRecord({
        id: 'h1',
        currency_code: 'ILS',
        old_rate: null,
        new_rate: '3.650000',
        changed_by: null,
        changed_at: '2026-10-19T11:00:00+00:00',
        change_reason: null,
      })
    ).toEqual({
      id: 'h1',
      currencyCode: 'ILS',
      oldRate: null,
      newRate: '3.650000',
      changedBy: null,
      changedAt: '2026-10-19T11:00:00+00:00',
      changeReason: null,
    });
  });
});
