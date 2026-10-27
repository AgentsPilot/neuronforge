/**
 * The rates wiring for the client payments approximate-dollar figure (FIN
 * BD-56, slice 1a). Workplan §9.2: field-by-field narrowing, rates kept as
 * text, never throws, logs the error or a count only.
 */

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: (...a: unknown[]) => mockLog.info(...a),
    warn: (...a: unknown[]) => mockLog.warn(...a),
    error: (...a: unknown[]) => mockLog.error(...a),
    debug: (...a: unknown[]) => mockLog.debug(...a),
  }),
}));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import { readClientPaymentRates } from '../clientPaymentRates';
import type { ExchangeRateRow } from '@/lib/repositories/types';

const row = (extra: Partial<ExchangeRateRow> = {}): ExchangeRateRow => ({
  id: 'r1', currency_code: 'ILS', currency_name: 'Shekel', currency_symbol: '₪', rate_to_usd: '3.700000',
  is_enabled: true, decimal_places: 2, last_updated_at: '2026-10-20T00:00:00+00:00', updated_by: 'admin-1', ...extra,
});
const reader = (result: unknown) => ({ listAll: jest.fn(async () => result) }) as never;
const logged = () => JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls, mockLog.debug.mock.calls]);

beforeEach(() => jest.clearAllMocks());

describe('readClientPaymentRates', () => {
  it('narrows field by field; the rate stays text; a null is_enabled reads as disabled', async () => {
    const result = await readClientPaymentRates({
      reader: reader({ data: [row(), row({ currency_code: 'EUR', rate_to_usd: '0.920000', is_enabled: null, last_updated_at: null })], error: null }),
    });
    expect(result).toEqual({
      status: 'ok',
      rates: [
        { code: 'ILS', rate: '3.700000', enabled: true, lastUpdatedAt: '2026-10-20T00:00:00+00:00' },
        { code: 'EUR', rate: '0.920000', enabled: false, lastUpdatedAt: null },
      ],
    });
    expect(typeof (result as { rates: Array<{ rate: unknown }> }).rates[0].rate).toBe('string');
    expect(mockLog.debug).toHaveBeenCalledWith({ rows: 2 }, expect.any(String));
  });

  it.each([
    ['a repository error', { data: null, error: new Error('down') }],
    ['no data and no error', { data: null, error: null }],
  ])('%s is failed, logged once with err', async (_name, answer) => {
    expect(await readClientPaymentRates({ reader: reader(answer) })).toEqual({ status: 'failed' });
    expect(mockLog.warn).toHaveBeenCalledTimes(1);
    expect(mockLog.warn.mock.calls[0][0]).toEqual({ err: expect.any(Error) });
  });

  it('a thrown read is failed, never a rejection', async () => {
    const throwing = { listAll: jest.fn(async () => { throw new Error('boom'); }) } as never;
    await expect(readClientPaymentRates({ reader: throwing })).resolves.toEqual({ status: 'failed' });
  });

  it('EX-4: no log call carries a rate or a code', async () => {
    await readClientPaymentRates({ reader: reader({ data: [row()], error: null }) });
    await readClientPaymentRates({ reader: reader({ data: null, error: new Error('down') }) });
    expect(logged()).not.toMatch(/3\.7|ILS/);
  });
});
