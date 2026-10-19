/**
 * PATCH /api/admin/exchange-rates/[currencyCode] (Admin Exchange Rates slice
 * 1a): workplan §8.1. Happy paths (rate, toggle, same-value confirm), not an
 * admin (nothing read or written), every invalid input (SQ-3, SQ-5 as amended
 * by SA O-1, SA-R8), unknown code 404, failures, the audit shape (SA-R9) and
 * the requireAdmin-first source pin.
 *
 * The REAL `logAndFlush` runs over an in-memory audit sink, so "flushed before
 * the response" is proven on the code path the route uses.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (u: unknown) => isAdmin(u) }) },
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const order: string[] = [];
const findByCode = jest.fn();
const updateRate = jest.fn();
const setEnabled = jest.fn();
const record =
  (name: string, fn: jest.Mock) =>
  (...args: unknown[]) => {
    order.push(name);
    return fn(...args);
  };
jest.mock('@/lib/repositories/ExchangeRatesRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/ExchangeRatesRepository');
  return {
    toExchangeRateWire: actual.toExchangeRateWire,
    exchangeRatesRepository: {
      findByCode: record('findByCode', findByCode),
      updateRate: record('updateRate', updateRate),
      setEnabled: record('setEnabled', setEnabled),
    },
  };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const auditLog = jest.fn();
const auditFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => {
  const sink = {
    log: (input: unknown) => {
      order.push('audit.log');
      return auditLog(input);
    },
    flush: () => {
      order.push('audit.flush');
      return auditFlush();
    },
  };
  return { AuditTrail: sink, AuditTrailService: { getInstance: () => sink } };
});

import { PATCH } from '../route';
import { __resetAuditFlushChainForTests } from '@/lib/audit/boundedAuditFlush';

const ADMIN = { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'ops@example.com' };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    currency_code: 'ILS',
    currency_name: 'Israeli New Shekel',
    currency_symbol: '₪',
    rate_to_usd: '3.650000',
    is_enabled: true,
    decimal_places: 2,
    last_updated_at: '2025-11-05T10:00:00+00:00',
    updated_by: null,
    ...overrides,
  };
}

function patch(code: string, body: unknown, raw?: string) {
  const request = new NextRequest(`http://localhost/api/admin/exchange-rates/${code}`, {
    method: 'PATCH',
    body: raw ?? JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  return PATCH(request, { params: { currencyCode: code } });
}

const repoTouched = () => order.filter((name) => !name.startsWith('audit.'));
const rateAudits = () =>
  auditLog.mock.calls
    .map((call) => call[0] as { action: string; details: { oldValue: unknown; newValue: unknown } })
    .filter((entry) => entry.action.startsWith('EXCHANGE_RATE_'));

beforeEach(() => {
  jest.clearAllMocks();
  __resetAuditFlushChainForTests();
  order.length = 0;
  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
  auditLog.mockResolvedValue(undefined);
  auditFlush.mockResolvedValue(undefined);
  findByCode.mockImplementation(async (code: string) => ({ data: row({ currency_code: code }), error: null }));
  updateRate.mockImplementation(async (code: string, rate: string, adminId: string) => ({
    data: row({ currency_code: code, rate_to_usd: rate, updated_by: adminId, last_updated_at: '2026-10-19T12:00:00+00:00' }),
    error: null,
  }));
  setEnabled.mockImplementation(async (code: string, isEnabled: boolean, adminId: string) => ({
    data: row({ currency_code: code, is_enabled: isEnabled, updated_by: adminId }),
    error: null,
  }));
});

describe('happy paths', () => {
  it('sets a rate: one update with the admin, audit flushed before the answer', async () => {
    const res = await patch('ILS', { field: 'rate', rate: '3.71' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.unchanged).toBe(false);
    expect(body.data.rate).toMatchObject({ currencyCode: 'ILS', rateToUsd: '3.71', updatedBy: ADMIN.id });

    expect(updateRate).toHaveBeenCalledWith('ILS', '3.71', ADMIN.id);
    expect(setEnabled).not.toHaveBeenCalled();
    expect(order).toEqual(['findByCode', 'updateRate', 'audit.log', 'audit.flush']);

    expect(rateAudits()).toEqual([
      expect.objectContaining({
        action: 'EXCHANGE_RATE_UPDATED',
        entityType: 'exchange_rate',
        entityId: 'ILS',
        userId: ADMIN.id,
        actorId: ADMIN.id,
        severity: 'info',
        details: { currencyCode: 'ILS', field: 'rate', oldValue: '3.650000', newValue: '3.71' },
      }),
    ]);
  });

  it('switches a currency off', async () => {
    const res = await patch('EUR', { field: 'enabled', isEnabled: false });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rate.isEnabled).toBe(false);
    expect(body.data.unchanged).toBe(false);
    expect(setEnabled).toHaveBeenCalledWith('EUR', false, ADMIN.id);
    expect(updateRate).not.toHaveBeenCalled();
    expect(rateAudits()).toEqual([
      expect.objectContaining({
        action: 'EXCHANGE_RATE_ENABLED_CHANGED',
        entityType: 'exchange_rate',
        entityId: 'EUR',
        userId: ADMIN.id,
        actorId: ADMIN.id,
        details: { currencyCode: 'EUR', field: 'enabled', oldValue: true, newValue: false },
      }),
    ]);
  });

  it('same-value confirm: the update still runs, unchanged is true, audit old equals new', async () => {
    const res = await patch('ILS', { field: 'rate', rate: '3.650000' });
    expect(res.status).toBe(200);
    expect((await res.json()).data.unchanged).toBe(true);
    expect(updateRate).toHaveBeenCalledWith('ILS', '3.650000', ADMIN.id);
    const [entry] = rateAudits();
    expect(entry.details.oldValue).toBe(entry.details.newValue);
  });

  it('same-value confirm with a differently written number ("3.65" over "3.650000")', async () => {
    updateRate.mockResolvedValue({ data: row({ rate_to_usd: '3.650000' }), error: null });
    const res = await patch('ILS', { field: 'rate', rate: '3.65' });
    expect((await res.json()).data.unchanged).toBe(true);
  });

  it('a null enabled flag: the audit keeps the raw null, the answer reads it healed', async () => {
    findByCode.mockResolvedValue({ data: row({ is_enabled: null }), error: null });
    const res = await patch('ILS', { field: 'enabled', isEnabled: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rate.isEnabled).toBe(true);
    expect(body.data.unchanged).toBe(false);
    const [entry] = rateAudits();
    expect(entry.details).toEqual({ currencyCode: 'ILS', field: 'enabled', oldValue: null, newValue: true });
  });

  it('USD may be switched on (it is never off)', async () => {
    const res = await patch('USD', { field: 'enabled', isEnabled: true });
    expect(res.status).toBe(200);
    expect(setEnabled).toHaveBeenCalledWith('USD', true, ADMIN.id);
  });

  it.each(['999999.999999', '0.000001', '000150'])('accepts the edge rate %s', async (rate) => {
    const res = await patch('ILS', { field: 'rate', rate });
    expect(res.status).toBe(200);
    expect(updateRate).toHaveBeenCalledWith('ILS', rate, ADMIN.id);
  });

  it('an audit failure does not fail the save', async () => {
    auditFlush.mockRejectedValue(new Error('audit down'));
    const res = await patch('ILS', { field: 'rate', rate: '3.71' });
    expect(res.status).toBe(200);
    expect(updateRate).toHaveBeenCalled();
  });
});

describe('auth: nothing is read or written', () => {
  it('signed out: 401', async () => {
    getUser.mockResolvedValue(null);
    const res = await patch('ILS', { field: 'rate', rate: '3.71' });
    expect(res.status).toBe(401);
    expect(repoTouched()).toEqual([]);
    expect(rateAudits()).toEqual([]);
  });

  it('not an admin: 403', async () => {
    isAdmin.mockResolvedValue(false);
    const res = await patch('ILS', { field: 'rate', rate: '3.71' });
    expect(res.status).toBe(403);
    expect(repoTouched()).toEqual([]);
    expect(rateAudits()).toEqual([]);
  });
});

describe('invalid input: 400, nothing read or written', () => {
  const expectNothingTouched = () => {
    expect(repoTouched()).toEqual([]);
    expect(rateAudits()).toEqual([]);
  };

  it.each(['usd', 'US', 'USDX', '12A', 'U$D'])('bad code %j', async (code) => {
    const res = await patch(code, { field: 'rate', rate: '1' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid currency code');
    expectNothingTouched();
  });

  it('body is not JSON', async () => {
    const res = await patch('ILS', null, '{not json');
    expect(res.status).toBe(400);
    expectNothingTouched();
  });

  it.each([
    ['empty', {}],
    ['unknown field', { field: 'symbol', symbol: '$' }],
    ['both fields', { field: 'rate', rate: '1', isEnabled: true }],
    ['extra key', { field: 'enabled', isEnabled: true, note: 'x' }],
    ['updatedBy in the body', { field: 'rate', rate: '1', updatedBy: 'bbbbbbbb-1111-4111-8111-111111111111' }],
    ['updated_by in the body', { field: 'enabled', isEnabled: true, updated_by: 'bbbbbbbb-1111-4111-8111-111111111111' }],
    ['enabled as a string', { field: 'enabled', isEnabled: 'true' }],
    ['rate as a number', { field: 'rate', rate: 1.2 }],
  ])('body: %s', async (_name, body) => {
    const res = await patch('ILS', body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid input');
    expectNothingTouched();
  });

  it.each([
    '0',
    '0.000000',
    '-1',
    '1000000',
    '1234567',
    '10000000',
    '10000000.000001',
    '123456789',
    '1.1234567',
    '1e3',
    ' 1',
    '1.',
    '.5',
    '',
  ])('rate %j', async (rate) => {
    const res = await patch('ILS', { field: 'rate', rate });
    expect(res.status).toBe(400);
    expectNothingTouched();
  });

  it('no internal details outside development', async () => {
    const res = await patch('ILS', { field: 'rate', rate: '0' });
    expect((await res.json()).details).toBeUndefined();
  });
});

describe('base currency (SA-R8): 400, nothing read or written', () => {
  it.each(['1', '1.000000', '2'])('USD rate %s', async (rate) => {
    const res = await patch('USD', { field: 'rate', rate });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('The USD rate is fixed at 1 and cannot be edited');
    expect(repoTouched()).toEqual([]);
  });

  it('USD disabled', async () => {
    const res = await patch('USD', { field: 'enabled', isEnabled: false });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('USD cannot be disabled');
    expect(repoTouched()).toEqual([]);
  });
});

describe('unknown code and failures', () => {
  it('unknown code: 404, no update, no audit', async () => {
    findByCode.mockResolvedValue({ data: null, error: null });
    const res = await patch('XYZ', { field: 'rate', rate: '1' });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Unknown currency');
    expect(repoTouched()).toEqual(['findByCode']);
    expect(rateAudits()).toEqual([]);
  });

  it('row vanished between the read and the update: 404, no audit', async () => {
    updateRate.mockResolvedValue({ data: null, error: null });
    const res = await patch('ILS', { field: 'rate', rate: '1' });
    expect(res.status).toBe(404);
    expect(rateAudits()).toEqual([]);
  });

  it('pre-read error: 500, no update', async () => {
    findByCode.mockResolvedValue({ data: null, error: new Error('read failed') });
    const res = await patch('ILS', { field: 'rate', rate: '1' });
    expect(res.status).toBe(500);
    expect(repoTouched()).toEqual(['findByCode']);
  });

  it('update error: 500, no audit, no details outside development', async () => {
    setEnabled.mockResolvedValue({ data: null, error: new Error('write failed') });
    const res = await patch('EUR', { field: 'enabled', isEnabled: false });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to update the exchange rate');
    expect(body.details).toBeUndefined();
    expect(rateAudits()).toEqual([]);
  });
});

describe('source pin', () => {
  it('the first statement of PATCH is `const gate = await requireAdmin(`', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const start = source.indexOf('export async function PATCH(');
    const body = source.slice(source.indexOf('{', source.indexOf(')', source.indexOf('context:', start))) + 1);
    expect(body.replace(/^\s*(\/\/[^\n]*\n\s*)*/, '')).toMatch(/^const gate = await requireAdmin\(/);
  });

  it('the admin id written is the gate user, never read from the body', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    expect(source).toMatch(/const adminId = gate\.user\.id;/);
    expect(source).not.toMatch(/body\.(updatedBy|updated_by|adminId)/);
  });
});

// QA probes (slice 1a QA, 2026-10-19): edge cases beyond the §8.1 matrix.
describe('QA probes', () => {
  const expectNothingTouched = () => {
    expect(repoTouched()).toEqual([]);
    expect(rateAudits()).toEqual([]);
  };

  it.each(['eur', 'Ils', 'E1R', 'EU', 'EURO', 'E R', ''])('path code %j: 400, nothing read', async (code) => {
    const res = await patch(code, { field: 'enabled', isEnabled: true });
    expect(res.status).toBe(400);
    expectNothingTouched();
  });

  it.each([
    ['seven zero decimals', '0.0000000'],
    ['zero with six-digit int', '000000.000000'],
    ['trailing newline', '1\n'],
    ['non-ASCII digits', '١'],
  ])('rate %s: 400, nothing written', async (_name, rate) => {
    const res = await patch('ILS', { field: 'rate', rate });
    expect(res.status).toBe(400);
    expectNothingTouched();
  });

  it.each([
    ['integer number', 1],
    ['null', null],
    ['missing', undefined],
  ])('rate as %s: 400', async (_name, rate) => {
    const res = await patch('ILS', { field: 'rate', rate });
    expect(res.status).toBe(400);
    expectNothingTouched();
  });

  it.each([
    ['user_id', { field: 'rate', rate: '1', user_id: 'bbbbbbbb-1111-4111-8111-111111111111' }],
    ['currencyCode', { field: 'rate', rate: '1', currencyCode: 'EUR' }],
    ['last_updated_at', { field: 'enabled', isEnabled: true, last_updated_at: '2020-01-01' }],
  ])('extra key %s: 400, nothing written', async (_name, body) => {
    const res = await patch('ILS', body);
    expect(res.status).toBe(400);
    expectNothingTouched();
  });

  it.each([
    ['1', 1],
    ['0', 0],
    ['null', null],
    ['"false"', 'false'],
    ['missing', undefined],
  ])('isEnabled %s: 400', async (_name, isEnabled) => {
    const res = await patch('ILS', { field: 'enabled', isEnabled });
    expect(res.status).toBe(400);
    expectNothingTouched();
  });

  it('a JSON array or a bare string body: 400', async () => {
    expect((await patch('ILS', [{ field: 'rate', rate: '1' }])).status).toBe(400);
    expect((await patch('ILS', 'rate')).status).toBe(400);
    expectNothingTouched();
  });

  it('USD disable with a stringy flag is refused by Zod before the base rule', async () => {
    const res = await patch('USD', { field: 'enabled', isEnabled: 'false' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid input');
    expectNothingTouched();
  });

  it('same-value enabled save: update runs, unchanged true, audit old === new', async () => {
    const res = await patch('EUR', { field: 'enabled', isEnabled: true });
    expect(res.status).toBe(200);
    expect((await res.json()).data.unchanged).toBe(true);
    expect(setEnabled).toHaveBeenCalledWith('EUR', true, ADMIN.id);
    const [entry] = rateAudits();
    expect(entry.details.oldValue).toBe(true);
    expect(entry.details.newValue).toBe(true);
  });

  it('exactly one audit entry per change', async () => {
    await patch('ILS', { field: 'rate', rate: '3.71' });
    expect(rateAudits()).toHaveLength(1);
  });

  it('audit log() rejecting does not fail the save', async () => {
    auditLog.mockRejectedValue(new Error('queue down'));
    const res = await patch('ILS', { field: 'rate', rate: '3.71' });
    expect(res.status).toBe(200);
  });

  it.each([
    ['signed out', 401, () => getUser.mockResolvedValue(null)],
    ['not an admin', 403, () => isAdmin.mockResolvedValue(false)],
  ])('%s on a toggle with a garbage body: %i, gate wins, nothing touched', async (_n, status, arrange) => {
    arrange();
    const res = await patch('USD', null, '{not json');
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.success).toBe(false);
    expectNothingTouched();
  });

  it('a thrown repository error is a 500 without details', async () => {
    findByCode.mockRejectedValue(new Error('socket hang up'));
    const res = await patch('ILS', { field: 'rate', rate: '1' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('socket');
  });
});
