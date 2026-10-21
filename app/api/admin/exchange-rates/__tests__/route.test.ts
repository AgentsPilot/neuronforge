/**
 * GET /api/admin/exchange-rates (Admin Exchange Rates slice 1a, SA-R4, SA R-3;
 * slice 1c.1, SQ-12 / SQ-13 / SA Q-1 / SA-1c-7 / SA W-5): happy path, signed
 * out, not an admin, each read failing, the requireAdmin-first source pin, the
 * query parse, the per-currency read and the "Changed by" labels. Slice 1d
 * (SQ-26 to SQ-31, SA-1d-3, SA-1d-7 (b), SA-1d-9): the history window reaching
 * the repository as half-open instants, the This month default, the all-time
 * `lastChange` and its label, and the window's 400s.
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

// Every log call, at every level, lands in `logCalls` (SA-1c-7: no name or email in any of them).
const logError = jest.fn();
const logCalls: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const record =
      (level: string) =>
      (...args: unknown[]) => {
        logCalls.push([level, ...args]);
        if (level === 'error') logError(...args);
      };
    const logger: Record<string, unknown> = {
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      debug: record('debug'),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const listAll = jest.fn();
const listRecentHistory = jest.fn();
const findByCode = jest.fn();
const listRecentHistoryForCurrency = jest.fn();
const findLatestChange = jest.fn();
jest.mock('@/lib/repositories/ExchangeRatesRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/ExchangeRatesRepository');
  return {
    toExchangeRateWire: actual.toExchangeRateWire,
    toExchangeRateHistoryRecord: actual.toExchangeRateHistoryRecord,
    exchangeRatesRepository: {
      // Arguments are forwarded, so a test can pin what the route passes (slice 1d).
      listAll: (...args: unknown[]) => listAll(...args),
      listRecentHistory: (...args: unknown[]) => listRecentHistory(...args),
      findByCode: (...args: unknown[]) => findByCode(...args),
      listRecentHistoryForCurrency: (...args: unknown[]) => listRecentHistoryForCurrency(...args),
      findLatestChange: (...args: unknown[]) => findLatestChange(...args),
    },
  };
});

const findAdminNamesByIds = jest.fn();
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: { findAdminNamesByIds: (ids: readonly string[]) => findAdminNamesByIds(ids) },
}));

const findEmailsByUserIds = jest.fn();
jest.mock('@/lib/repositories/AdminUserRepository', () => ({
  adminUserRepository: { findEmailsByUserIds: (ids: readonly string[]) => findEmailsByUserIds(ids) },
}));

// The real repository module is loaded for its mappers; its default client must not be built.
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

// requireAdmin records a refused access through the audit trail; keep it in memory.
const auditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => {
  const sink = { log: (input: unknown) => auditLog(input), flush: () => Promise.resolve() };
  return { AuditTrail: sink, AuditTrailService: { getInstance: () => sink } };
});

import { GET } from '../route';
import { HISTORY_LIMIT, UNKNOWN_USER_LABEL } from '@/lib/admin/exchangeRates/exchangeRateRules';

const ADMIN = { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'ops@example.com' };
const FORMER = 'bbbbbbbb-2222-4222-8222-222222222222';
const NOBODY = 'cccccccc-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-19T12:00:00.000Z');

const ANNA_NAME = 'Anna Admin';
const ANNA_EMAIL = 'anna.private@example.com';
const FORMER_EMAIL = 'former.admin@example.com';

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
const historyRow = (id: string, changedBy: string | null) => ({ ...HISTORY, id, changed_by: changedBy });

/** This month at NOW (2026-10-19), as half-open instants (SQ-26, SQ-28). */
const THIS_MONTH_BOUNDS = { fromInclusive: '2026-10-01T00:00:00.000Z', toExclusive: '2026-10-20T00:00:00.000Z' };

const LAST_CHANGE_WIRE = {
  id: 'h1',
  currencyCode: 'ILS',
  oldRate: '3.600000',
  newRate: '3.650000',
  changedBy: ADMIN.id,
  changedByLabel: ANNA_NAME,
  changedAt: '2025-11-05T10:00:00+00:00',
  changeReason: null,
};

const url = (query = '') => `http://localhost/api/admin/exchange-rates${query}`;
const get = (query = '') => new NextRequest(url(query));

beforeEach(() => {
  jest.clearAllMocks();
  logCalls.length = 0;
  auditLog.mockResolvedValue(undefined);
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
  listAll.mockResolvedValue({ data: [RATE], error: null });
  listRecentHistory.mockResolvedValue({ data: [HISTORY], error: null });
  findByCode.mockResolvedValue({ data: RATE, error: null });
  listRecentHistoryForCurrency.mockResolvedValue({ data: [HISTORY], error: null });
  findLatestChange.mockResolvedValue({ data: HISTORY, error: null });
  findAdminNamesByIds.mockResolvedValue({ data: [{ id: ADMIN.id, full_name: ANNA_NAME }], error: null });
  findEmailsByUserIds.mockResolvedValue({ data: [{ user_id: ADMIN.id, email: ANNA_EMAIL }], error: null });
});

afterEach(() => {
  jest.useRealTimers();
});

const noRead = () => {
  expect(listAll).not.toHaveBeenCalled();
  expect(listRecentHistory).not.toHaveBeenCalled();
  expect(findByCode).not.toHaveBeenCalled();
  expect(listRecentHistoryForCurrency).not.toHaveBeenCalled();
  expect(findLatestChange).not.toHaveBeenCalled();
  expect(findAdminNamesByIds).not.toHaveBeenCalled();
  expect(findEmailsByUserIds).not.toHaveBeenCalled();
};

describe('GET /api/admin/exchange-rates', () => {
  it('returns rates, labelled history, the labelled lastChange, nameLookup and the server read time', async () => {
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
            changedByLabel: ANNA_NAME,
            changedAt: '2025-11-05T10:00:00+00:00',
            changeReason: null,
          },
        ],
        lastChange: LAST_CHANGE_WIRE,
        nameLookup: 'ok',
        readAt: NOW.toISOString(),
      },
    });
  });

  it('signed out: 401 and no read', async () => {
    getUser.mockResolvedValue(null);
    const res = await GET(get());
    expect(res.status).toBe(401);
    noRead();
  });

  it('not an admin: 403 and no read', async () => {
    isAdmin.mockResolvedValue(false);
    const res = await GET(get());
    expect(res.status).toBe(403);
    noRead();
  });

  it.each([
    ['signed out', 401, () => getUser.mockResolvedValue(null)],
    ['not an admin', 403, () => isAdmin.mockResolvedValue(false)],
  ])('%s with a bad query: still %i (the gate runs before the query parse), no read', async (_label, status, arrange) => {
    arrange();
    const res = await GET(get('?currency=ils&foo=1'));
    expect(res.status).toBe(status);
    noRead();
  });

  it.each([
    ['rates', () => listAll.mockResolvedValue({ data: null, error: new Error('rates down') })],
    ['history', () => listRecentHistory.mockResolvedValue({ data: null, error: new Error('history down') })],
    ['lastChange', () => findLatestChange.mockResolvedValue({ data: null, error: new Error('latest down') })],
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

describe('the history limit (FR-18)', () => {
  it('is the fixed constant 10, and a caller-supplied limit is a 400, never forwarded', async () => {
    expect(HISTORY_LIMIT).toBe(10);
    const res = await GET(get('?limit=999'));
    expect(res.status).toBe(400);
    noRead();
  });

  it('the route source never names a limit of its own', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    expect(source).not.toMatch(/\.limit\(|HISTORY_LIMIT\s*=|limit:/);
  });
});

describe('the query (SQ-12)', () => {
  it.each([
    ['an unknown key', '?foo=1'],
    ['a lower-case code', '?currency=ils'],
    ['an empty code', '?currency='],
    ['four letters', '?currency=ILSX'],
    ['a repeated currency', '?currency=ILS&currency=EUR'],
    ['the same code twice', '?currency=ILS&currency=ILS'],
    ['a code plus a limit', '?currency=ILS&limit=50'],
  ])('%s → 400, the error shape, no details outside development, nothing read', async (_label, query) => {
    const res = await GET(get(query));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid query' });
    noRead();
  });

  it('a well-formed code with no such currency → 404, and no history or name is read', async () => {
    findByCode.mockResolvedValue({ data: null, error: null });
    const res = await GET(get('?currency=XYZ'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Unknown currency' });
    expect(findByCode).toHaveBeenCalledWith('XYZ');
    expect(listRecentHistoryForCurrency).not.toHaveBeenCalled();
    expect(findAdminNamesByIds).not.toHaveBeenCalled();
    expect(findEmailsByUserIds).not.toHaveBeenCalled();
  });
});

describe('GET ?currency=XXX (SQ-12)', () => {
  it("returns that currency's labelled history in its own payload: no rates", async () => {
    const res = await GET(get('?currency=ILS'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: {
        currencyCode: 'ILS',
        history: [
          {
            id: 'h1',
            currencyCode: 'ILS',
            oldRate: '3.600000',
            newRate: '3.650000',
            changedBy: ADMIN.id,
            changedByLabel: ANNA_NAME,
            changedAt: '2025-11-05T10:00:00+00:00',
            changeReason: null,
          },
        ],
        nameLookup: 'ok',
        readAt: NOW.toISOString(),
      },
    });
    expect(listRecentHistoryForCurrency).toHaveBeenCalledWith('ILS', THIS_MONTH_BOUNDS);
    expect(listAll).not.toHaveBeenCalled();
    expect(listRecentHistory).not.toHaveBeenCalled();
    // SQ-31: the per-currency read never reads or sends lastChange.
    expect(findLatestChange).not.toHaveBeenCalled();
    expect(body.data).not.toHaveProperty('lastChange');
  });

  it('a valid code with no history: 200, an empty list, nameLookup ok, no lookup at all (W-5)', async () => {
    listRecentHistoryForCurrency.mockResolvedValue({ data: [], error: null });
    const res = await GET(get('?currency=EUR'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ currencyCode: 'EUR', history: [], nameLookup: 'ok', readAt: NOW.toISOString() });
    expect(findAdminNamesByIds).not.toHaveBeenCalled();
    expect(findEmailsByUserIds).not.toHaveBeenCalled();
  });

  it('a failed name lookup: still 200, nameLookup failed, labels null (W-5)', async () => {
    findAdminNamesByIds.mockResolvedValue({ data: null, error: new Error('profiles down') });
    const res = await GET(get('?currency=ILS'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.nameLookup).toBe('failed');
    expect(body.data.history.map((row: { changedByLabel: unknown }) => row.changedByLabel)).toEqual([null]);
  });

  it.each([
    ['the currency read', 'currency', () => findByCode.mockResolvedValue({ data: null, error: new Error('rates down') })],
    [
      'the history read',
      'history',
      () => listRecentHistoryForCurrency.mockResolvedValue({ data: null, error: new Error('history down') }),
    ],
  ])('%s failing is a 500 without details, named in the log', async (_label, failed, arrange) => {
    arrange();
    const res = await GET(get('?currency=ILS'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to read exchange rates' });
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ failed }), expect.any(String));
  });
});

describe('"Changed by" labels (SQ-13, SA Q-1)', () => {
  const labelsOf = async (query = '') => {
    const res = await GET(get(query));
    expect(res.status).toBe(200);
    const body = await res.json();
    return {
      nameLookup: body.data.nameLookup as string,
      labels: (body.data.history as Array<{ changedByLabel: string | null }>).map((row) => row.changedByLabel),
    };
  };

  it('the name wins over the email', async () => {
    expect(await labelsOf()).toEqual({ nameLookup: 'ok', labels: [ANNA_NAME] });
  });

  it('no name (missing or blank): the admin email, a deactivated admin included', async () => {
    listRecentHistory.mockResolvedValue({ data: [historyRow('h1', ADMIN.id), historyRow('h2', FORMER)], error: null });
    findAdminNamesByIds.mockResolvedValue({ data: [{ id: ADMIN.id, full_name: '   ' }], error: null });
    findEmailsByUserIds.mockResolvedValue({
      data: [
        { user_id: ADMIN.id, email: ANNA_EMAIL },
        { user_id: FORMER, email: FORMER_EMAIL },
      ],
      error: null,
    });
    expect(await labelsOf()).toEqual({ nameLookup: 'ok', labels: [ANNA_EMAIL, FORMER_EMAIL] });
  });

  it('neither a name nor an email: "Unknown user"', async () => {
    listRecentHistory.mockResolvedValue({ data: [historyRow('h1', NOBODY)], error: null });
    findAdminNamesByIds.mockResolvedValue({ data: [], error: null });
    findEmailsByUserIds.mockResolvedValue({ data: [], error: null });
    expect(await labelsOf()).toEqual({ nameLookup: 'ok', labels: [UNKNOWN_USER_LABEL] });
  });

  it('a null changedBy is "Unknown user" and is never looked up', async () => {
    listRecentHistory.mockResolvedValue({ data: [historyRow('h1', null), historyRow('h2', ADMIN.id)], error: null });
    expect(await labelsOf()).toEqual({ nameLookup: 'ok', labels: [UNKNOWN_USER_LABEL, ANNA_NAME] });
    expect(findAdminNamesByIds).toHaveBeenCalledWith([ADMIN.id]);
    expect(findEmailsByUserIds).toHaveBeenCalledWith([ADMIN.id]);
  });

  it('only null editors: no lookup at all, nameLookup ok', async () => {
    listRecentHistory.mockResolvedValue({ data: [historyRow('h1', null)], error: null });
    // Slice 1d: lastChange's editor is looked up too, so it has none here either (DV-1).
    findLatestChange.mockResolvedValue({ data: historyRow('h1', null), error: null });
    expect(await labelsOf()).toEqual({ nameLookup: 'ok', labels: [UNKNOWN_USER_LABEL] });
    expect(findAdminNamesByIds).not.toHaveBeenCalled();
    expect(findEmailsByUserIds).not.toHaveBeenCalled();
  });

  it('the ids looked up come from the history rows, de-duplicated, never from the request', async () => {
    listRecentHistory.mockResolvedValue({
      data: [historyRow('h1', ADMIN.id), historyRow('h2', ADMIN.id), historyRow('h3', FORMER)],
      error: null,
    });
    await labelsOf();
    expect(findAdminNamesByIds).toHaveBeenCalledTimes(1);
    expect(findAdminNamesByIds).toHaveBeenCalledWith([ADMIN.id, FORMER]);
    expect(findEmailsByUserIds).toHaveBeenCalledWith([ADMIN.id, FORMER]);
  });

  // RK-2: each source, returned error and thrown. All or nothing; a null editor keeps "Unknown user" (SA Q-1).
  it.each([
    ['names returned an error', () => findAdminNamesByIds.mockResolvedValue({ data: null, error: new Error('profiles down') })],
    ['names threw', () => findAdminNamesByIds.mockRejectedValue(new Error('profiles exploded'))],
    ['names returned no data', () => findAdminNamesByIds.mockResolvedValue({ data: null, error: null })],
    ['emails returned an error', () => findEmailsByUserIds.mockResolvedValue({ data: null, error: new Error('admins down') })],
    ['emails threw', () => findEmailsByUserIds.mockRejectedValue(new Error('admins exploded'))],
    [
      'both failed',
      () => {
        findAdminNamesByIds.mockRejectedValue(new Error('profiles exploded'));
        findEmailsByUserIds.mockResolvedValue({ data: null, error: new Error('admins down') });
      },
    ],
  ])('%s: 200, nameLookup failed, every looked-up label null, a null editor still "Unknown user", one error log', async (_label, arrange) => {
    listRecentHistory.mockResolvedValue({
      data: [historyRow('h1', ADMIN.id), historyRow('h2', null), historyRow('h3', FORMER)],
      error: null,
    });
    arrange();
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rates).toHaveLength(1);
    expect(body.data.nameLookup).toBe('failed');
    expect(body.data.history.map((row: { changedByLabel: unknown }) => row.changedByLabel)).toEqual([
      null,
      UNKNOWN_USER_LABEL,
      null,
    ]);
    expect(body.data.history.map((row: { changedBy: unknown }) => row.changedBy)).toEqual([ADMIN.id, null, FORMER]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ requested: 2, nameLookup: 'failed', failed: expect.any(Array) }),
      expect.any(String)
    );
  });

  it('names the failed source in the log', async () => {
    findEmailsByUserIds.mockRejectedValue(new Error('admins exploded'));
    await GET(get());
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ failed: ['emails'] }), expect.any(String));
  });

  it('SA-1c-7: no name and no email reaches any log line, on success or failure', async () => {
    listRecentHistory.mockResolvedValue({ data: [historyRow('h1', ADMIN.id), historyRow('h2', FORMER)], error: null });
    findEmailsByUserIds.mockResolvedValue({
      data: [
        { user_id: ADMIN.id, email: ANNA_EMAIL },
        { user_id: FORMER, email: FORMER_EMAIL },
      ],
      error: null,
    });
    await GET(get());
    await GET(get('?currency=ILS'));
    findAdminNamesByIds.mockRejectedValue(new Error('profiles exploded'));
    await GET(get());
    expect(logCalls.length).toBeGreaterThan(0);
    const logged = JSON.stringify(logCalls, (_key, value) => (value instanceof Error ? value.message : value));
    for (const secret of [ANNA_NAME, ANNA_EMAIL, FORMER_EMAIL]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('only changedByLabel and nameLookup are added: the exact keys of a row and of each payload', async () => {
    const plain = await (await GET(get())).json();
    expect(Object.keys(plain.data).sort()).toEqual(['history', 'lastChange', 'nameLookup', 'rates', 'readAt']);
    expect(Object.keys(plain.data.history[0]).sort()).toEqual([
      'changeReason',
      'changedAt',
      'changedBy',
      'changedByLabel',
      'currencyCode',
      'id',
      'newRate',
      'oldRate',
    ]);
    const one = await (await GET(get('?currency=ILS'))).json();
    expect(Object.keys(one.data).sort()).toEqual(['currencyCode', 'history', 'nameLookup', 'readAt']);
  });
});

describe('source pin', () => {
  it('the first statement of GET is `const gate = await requireAdmin(`', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const start = source.indexOf('export async function GET(');
    const body = source.slice(source.indexOf('{', start) + 1).replace(/^\s*(\/\/[^\n]*\n\s*)*/, '');
    expect(body).toMatch(/^const gate = await requireAdmin\(/);
  });

  it('exports only the handler and route config (resolveLabels stays private)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    // Every line that starts with `export`, whatever follows it (SA C-3): a stray
    // `export { resolveLabels }` or `export type` line is counted too.
    const exportLines = source.split(/\r?\n/).filter((line) => /^export\b/.test(line));
    expect(exportLines).toHaveLength(3);
    const names = exportLines.map((line) => /^export\s+(?:async\s+)?(?:const|function)\s+(\w+)/.exec(line)?.[1] ?? line);
    expect(names.sort()).toEqual(['GET', 'dynamic', 'runtime']);
  });
});

describe('the history window (slice 1d, SQ-26 to SQ-31)', () => {
  it('the request dates reach both windowed reads as half-open UTC instants (SQ-28, SA-1d-7 (b))', async () => {
    const res = await GET(get('?from=2026-09-01&to=2026-09-30'));
    expect(res.status).toBe(200);
    expect(listRecentHistory).toHaveBeenCalledTimes(1);
    expect(listRecentHistory).toHaveBeenCalledWith({
      fromInclusive: '2026-09-01T00:00:00.000Z',
      toExclusive: '2026-10-01T00:00:00.000Z',
    });
    // lastChange is all-time: no window argument at all.
    expect(findLatestChange).toHaveBeenCalledTimes(1);
    expect(findLatestChange).toHaveBeenCalledWith();

    const one = await GET(get('?currency=ILS&from=2028-02-01&to=2028-02-29'));
    expect(one.status).toBe(200);
    expect(listRecentHistoryForCurrency).toHaveBeenCalledWith('ILS', {
      fromInclusive: '2028-02-01T00:00:00.000Z',
      toExclusive: '2028-03-01T00:00:00.000Z',
    });
    expect(findLatestChange).toHaveBeenCalledTimes(1);
  });

  it('no window in the query: This month at the server clock', async () => {
    // A clock of its own for this test (the file-wide one is NOW).
    jest.useFakeTimers({ now: new Date('2026-12-31T23:59:59.999Z'), doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const res = await GET(get());
      expect(res.status).toBe(200);
      expect(listRecentHistory).toHaveBeenCalledWith({
        fromInclusive: '2026-12-01T00:00:00.000Z',
        toExclusive: '2027-01-01T00:00:00.000Z',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('a to after today is accepted (no cap, SQ-26)', async () => {
    const res = await GET(get('?from=2026-10-01&to=2027-06-30'));
    expect(res.status).toBe(200);
  });

  it('lastChange is labelled through the same single lookup: an editor only in lastChange is named', async () => {
    listRecentHistory.mockResolvedValue({ data: [historyRow('h2', ADMIN.id)], error: null });
    findLatestChange.mockResolvedValue({ data: historyRow('h9', FORMER), error: null });
    findAdminNamesByIds.mockResolvedValue({ data: [{ id: ADMIN.id, full_name: ANNA_NAME }], error: null });
    findEmailsByUserIds.mockResolvedValue({ data: [{ user_id: FORMER, email: FORMER_EMAIL }], error: null });
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.history.map((row: { changedByLabel: unknown }) => row.changedByLabel)).toEqual([ANNA_NAME]);
    expect(body.data.lastChange).toMatchObject({ id: 'h9', changedBy: FORMER, changedByLabel: FORMER_EMAIL });
    // Each source once, with the union of the ids.
    expect(findAdminNamesByIds).toHaveBeenCalledTimes(1);
    expect(findAdminNamesByIds).toHaveBeenCalledWith([ADMIN.id, FORMER]);
    expect(findEmailsByUserIds).toHaveBeenCalledTimes(1);
    expect(findEmailsByUserIds).toHaveBeenCalledWith([ADMIN.id, FORMER]);
  });

  it('an editor in both lists is looked up once', async () => {
    await GET(get());
    expect(findAdminNamesByIds).toHaveBeenCalledWith([ADMIN.id]);
  });

  it('an empty window still sends the all-time lastChange', async () => {
    listRecentHistory.mockResolvedValue({ data: [], error: null });
    const body = await (await GET(get())).json();
    expect(body.data.history).toEqual([]);
    expect(body.data.lastChange).toEqual(LAST_CHANGE_WIRE);
  });

  it('no history at all: lastChange is null and nothing is looked up', async () => {
    listRecentHistory.mockResolvedValue({ data: [], error: null });
    findLatestChange.mockResolvedValue({ data: null, error: null });
    const body = await (await GET(get())).json();
    expect(body.data.lastChange).toBeNull();
    expect(body.data.nameLookup).toBe('ok');
    expect(findAdminNamesByIds).not.toHaveBeenCalled();
  });

  it('a failed lookup nulls the lastChange label too (all or nothing across both lists)', async () => {
    findLatestChange.mockResolvedValue({ data: historyRow('h9', FORMER), error: null });
    findEmailsByUserIds.mockRejectedValue(new Error('admins exploded'));
    const body = await (await GET(get())).json();
    expect(body.data.nameLookup).toBe('failed');
    expect(body.data.history.map((row: { changedByLabel: unknown }) => row.changedByLabel)).toEqual([null]);
    expect(body.data.lastChange.changedByLabel).toBeNull();
  });

  it('a findLatestChange thrown error is a 500 too', async () => {
    findLatestChange.mockRejectedValue(new Error('latest exploded'));
    const res = await GET(get());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to read exchange rates' });
  });

  it.each([
    ['only from', '?from=2026-10-01'],
    ['only to', '?to=2026-10-20'],
    ['reversed', '?from=2026-10-20&to=2026-10-01'],
    ['not a real date', '?from=2026-02-30&to=2026-03-01'],
    ['an unpadded date', '?from=2026-1-01&to=2026-10-20'],
    ['an empty date', '?from=&to=2026-10-20'],
    ['before 2000-01-01', '?from=1999-12-31&to=2026-10-20'],
    ['after 2999-12-31', '?from=2026-10-01&to=3000-01-01'],
    ['year 0', '?from=0000-01-01&to=2026-10-20'],
    ['year 9999', '?from=2026-10-01&to=9999-12-31'],
    ['a repeated from', '?from=2026-10-01&from=2026-10-02&to=2026-10-20'],
    ['a window plus a limit', '?from=2026-10-01&to=2026-10-20&limit=50'],
    ['a limit alone', '?limit=50'],
    ['a currency with a one-sided window', '?currency=ILS&from=2026-10-01'],
  ])('%s → 400, nothing read', async (_label, query) => {
    const res = await GET(get(query));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid query' });
    noRead();
  });

  it('not an admin with a window: 403 before any read', async () => {
    isAdmin.mockResolvedValue(false);
    const res = await GET(get('?from=2026-10-01&to=2026-10-20'));
    expect(res.status).toBe(403);
    noRead();
  });

  it('SA-1d-9: the window dates may be logged, a label never (the lastChange editor included)', async () => {
    findLatestChange.mockResolvedValue({ data: historyRow('h9', FORMER), error: null });
    findEmailsByUserIds.mockResolvedValue({
      data: [
        { user_id: ADMIN.id, email: ANNA_EMAIL },
        { user_id: FORMER, email: FORMER_EMAIL },
      ],
      error: null,
    });
    await GET(get('?from=2026-10-01&to=2026-10-20'));
    findAdminNamesByIds.mockRejectedValue(new Error('profiles exploded'));
    await GET(get());
    const logged = JSON.stringify(logCalls, (_key, value) => (value instanceof Error ? value.message : value));
    expect(logged).toContain('2026-10-01');
    for (const secret of [ANNA_NAME, ANNA_EMAIL, FORMER_EMAIL]) {
      expect(logged).not.toContain(secret);
    }
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
});

// QA probes (slice 1d QA, 2026-10-21): window edges the Dev suite pins only at the rules level.
describe('QA probes (slice 1d)', () => {
  it.each([
    ['the 1st of the month at 00:00:00Z', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z'],
    ['the last day at 23:59:59Z', '2026-10-31T23:59:59.000Z', '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'],
  ])('no window on %s: This month', async (_label, now, fromInclusive, toExclusive) => {
    jest.useFakeTimers({ now: new Date(now), doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const res = await GET(get());
      expect(res.status).toBe(200);
      expect(listRecentHistory).toHaveBeenCalledWith({ fromInclusive, toExclusive });
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['from = to: one whole UTC day', '?from=2026-10-20&to=2026-10-20', '2026-10-20T00:00:00.000Z', '2026-10-21T00:00:00.000Z'],
    ['a leap day', '?from=2028-02-29&to=2028-02-29', '2028-02-29T00:00:00.000Z', '2028-03-01T00:00:00.000Z'],
  ])('%s', async (_label, query, fromInclusive, toExclusive) => {
    const res = await GET(get(query));
    expect(res.status).toBe(200);
    expect(listRecentHistory).toHaveBeenCalledWith({ fromInclusive, toExclusive });
  });

  it('?currency=EUR&from&to: the windowed per-currency list, its own keys only, no lastChange read or sent', async () => {
    listRecentHistoryForCurrency.mockResolvedValue({ data: [{ ...HISTORY, currency_code: 'EUR' }], error: null });
    const res = await GET(get('?currency=EUR&from=2026-09-01&to=2026-09-30'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual(['currencyCode', 'history', 'nameLookup', 'readAt']);
    expect(body.data.currencyCode).toBe('EUR');
    expect(body.data.history).toHaveLength(1);
    expect(listRecentHistoryForCurrency).toHaveBeenCalledWith('EUR', {
      fromInclusive: '2026-09-01T00:00:00.000Z',
      toExclusive: '2026-10-01T00:00:00.000Z',
    });
    expect(findLatestChange).not.toHaveBeenCalled();
    expect(listRecentHistory).not.toHaveBeenCalled();
  });

  it('?currency=EUR with a reversed window: 400, nothing read', async () => {
    const res = await GET(get('?currency=EUR&from=2026-09-30&to=2026-09-01'));
    expect(res.status).toBe(400);
    noRead();
  });
});
