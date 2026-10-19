/**
 * GET /api/admin/exchange-rates (Admin Exchange Rates slice 1a, SA-R4, SA R-3):
 * happy path, signed out, not an admin, each read failing, and the
 * requireAdmin-first source pin.
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

const logError = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: jest.fn(),
      warn: jest.fn(),
      error: (...args: unknown[]) => logError(...args),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const listAll = jest.fn();
const listRecentHistory = jest.fn();
jest.mock('@/lib/repositories/ExchangeRatesRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/ExchangeRatesRepository');
  return {
    toExchangeRateWire: actual.toExchangeRateWire,
    toExchangeRateHistoryWire: actual.toExchangeRateHistoryWire,
    exchangeRatesRepository: {
      listAll: () => listAll(),
      listRecentHistory: () => listRecentHistory(),
    },
  };
});
// The real repository module is loaded for its mappers; its default client must not be built.
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

// requireAdmin records a refused access through the audit trail; keep it in memory.
const auditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => {
  const sink = { log: (input: unknown) => auditLog(input), flush: () => Promise.resolve() };
  return { AuditTrail: sink, AuditTrailService: { getInstance: () => sink } };
});

import { GET } from '../route';

const ADMIN = { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'ops@example.com' };
const NOW = new Date('2026-10-19T12:00:00.000Z');

const RATE = {
  id: 'r1',
  currency_code: 'ILS',
  currency_name: 'Israeli New Shekel',
  currency_symbol: '₪',
  rate_to_usd: '3.650000',
  is_enabled: null,
  decimal_places: 2,
  last_updated_at: '2025-11-05T10:00:00+00:00',
  updated_by: null,
};
const HISTORY = {
  id: 'h1',
  currency_code: 'ILS',
  old_rate: '3.600000',
  new_rate: '3.650000',
  changed_by: ADMIN.id,
  changed_at: '2025-11-05T10:00:00+00:00',
  change_reason: null,
};

const get = () => new NextRequest('http://localhost/api/admin/exchange-rates?limit=999');

beforeEach(() => {
  jest.clearAllMocks();
  auditLog.mockResolvedValue(undefined);
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
  listAll.mockResolvedValue({ data: [RATE], error: null });
  listRecentHistory.mockResolvedValue({ data: [HISTORY], error: null });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('GET /api/admin/exchange-rates', () => {
  it('returns rates, history and the server read time', async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: {
        rates: [
          {
            currencyCode: 'ILS',
            currencyName: 'Israeli New Shekel',
            currencySymbol: '₪',
            rateToUsd: '3.650000',
            isEnabled: false,
            decimalPlaces: 2,
            lastUpdatedAt: '2025-11-05T10:00:00+00:00',
            updatedBy: null,
          },
        ],
        history: [
          {
            id: 'h1',
            currencyCode: 'ILS',
            oldRate: '3.600000',
            newRate: '3.650000',
            changedBy: ADMIN.id,
            changedAt: '2025-11-05T10:00:00+00:00',
            changeReason: null,
          },
        ],
        readAt: NOW.toISOString(),
      },
    });
  });

  it('signed out: 401 and no read', async () => {
    getUser.mockResolvedValue(null);
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(listAll).not.toHaveBeenCalled();
    expect(listRecentHistory).not.toHaveBeenCalled();
  });

  it('not an admin: 403 and no read', async () => {
    isAdmin.mockResolvedValue(false);
    const res = await GET(get());
    expect(res.status).toBe(403);
    expect(listAll).not.toHaveBeenCalled();
    expect(listRecentHistory).not.toHaveBeenCalled();
  });

  it.each([
    ['rates', () => listAll.mockResolvedValue({ data: null, error: new Error('rates down') })],
    ['history', () => listRecentHistory.mockResolvedValue({ data: null, error: new Error('history down') })],
  ])('the %s read failing is one 500, named in the log, no details outside development', async (failed, arrange) => {
    arrange();
    const res = await GET(get());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to read exchange rates');
    expect(body.details).toBeUndefined();
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ failed }), expect.any(String));
  });
});

describe('source pin', () => {
  it('the first statement of GET is `const gate = await requireAdmin(`', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const start = source.indexOf('export async function GET(');
    const body = source.slice(source.indexOf('{', start) + 1).replace(/^\s*(\/\/[^\n]*\n\s*)*/, '');
    expect(body).toMatch(/^const gate = await requireAdmin\(/);
  });
});

// QA probes (slice 1a QA, 2026-10-19).
describe('QA probes', () => {
  it('the history read rejecting (thrown) is a 500 without details', async () => {
    listRecentHistory.mockRejectedValue(new Error('connection reset'));
    const res = await GET(get());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Failed to read exchange rates' });
  });

  it('history read returns data null without an error: still a 500', async () => {
    listRecentHistory.mockResolvedValue({ data: null, error: null });
    const res = await GET(get());
    expect(res.status).toBe(500);
  });

  it('the query string is never read (no caller-supplied limit)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    expect(source).not.toMatch(/searchParams|nextUrl|request\.url/);
  });
});
