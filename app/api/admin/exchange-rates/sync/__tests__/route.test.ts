/**
 * POST /api/admin/exchange-rates/sync (Admin Exchange Rates slice 1e; SA §13.7
 * SQ-39, SQ-47, SA-1e-6, SA-1e-7): the admin gate before anything, the empty
 * strict body, the happy path from the dated fixture, source failures as 200s,
 * the read failure, the audit entry and what never reaches a log line.
 *
 * The network is never touched: `global.fetch` is replaced by a stub that
 * serves the fixture for the one pinned ECB URL and throws for any other. The
 * REAL `logAndFlush` runs over an in-memory audit sink.
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

// Every log call, at every level, so a test can prove the feed text never reaches one.
const logCalls: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const record =
      (level: string) =>
      (...args: unknown[]) => {
        logCalls.push([level, ...args]);
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
// The mock carries ONLY the read: no write method exists to be called.
const repositoryMock: Record<string, unknown> = { listAll: (...args: unknown[]) => listAll(...args) };
jest.mock('@/lib/repositories/ExchangeRatesRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/ExchangeRatesRepository');
  return { toExchangeRateWire: actual.toExchangeRateWire, exchangeRatesRepository: repositoryMock };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const auditLog = jest.fn();
const auditFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => {
  const sink = { log: (input: unknown) => auditLog(input), flush: () => auditFlush() };
  return { AuditTrail: sink, AuditTrailService: { getInstance: () => sink } };
});

import * as routeModule from '../route';
import { POST } from '../route';
import { ECB_DAILY_URL } from '@/lib/admin/exchangeRates/ecbFeed';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { __resetAuditFlushChainForTests } from '@/lib/audit/boundedAuditFlush';

const ADMIN = { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'ops@example.com' };
const NOW = new Date('2026-10-25T09:14:03.000Z');
const FIXTURE = fs.readFileSync(
  path.join(process.cwd(), 'lib/admin/exchangeRates/__fixtures__/ecb-eurofxref-daily-2026-10-23.xml'),
  'utf8'
);

function row(code: string, rate: string, isEnabled: boolean | null = true) {
  return {
    id: `r-${code}`,
    currency_code: code,
    currency_name: `${code} name`,
    currency_symbol: '¤',
    rate_to_usd: rate,
    is_enabled: isEnabled,
    decimal_places: 2,
    last_updated_at: '2026-10-01T10:00:00+00:00',
    updated_by: null,
  };
}

/** ILS / EUR / GBP and USD enabled, JPY disabled. */
const ROWS = [row('EUR', '0.920000'), row('GBP', '0.750000'), row('ILS', '3.090000'), row('JPY', '150.000000', false), row('USD', '1.000000')];

type Reply = () => Response | Promise<Response>;
const fetchCalls: string[] = [];
let replies: Reply[] = [];
const realFetch = global.fetch;

function serve(...next: Reply[]) {
  replies = next;
}
const xml = (body = FIXTURE) => () => new Response(body, { status: 200, headers: { 'content-type': 'text/xml' } });

beforeAll(() => {
  global.fetch = jest.fn(async (input: unknown) => {
    const url = typeof input === 'string' ? input : String(input);
    fetchCalls.push(url);
    if (url !== ECB_DAILY_URL) throw new Error(`Unexpected outbound request in a unit test: ${url}`);
    const reply = replies.shift();
    if (!reply) throw new Error('no more replies');
    return reply();
  }) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  __resetAuditFlushChainForTests();
  logCalls.length = 0;
  fetchCalls.length = 0;
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout'] });
  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
  listAll.mockResolvedValue({ data: ROWS, error: null });
  auditLog.mockResolvedValue(undefined);
  auditFlush.mockResolvedValue(undefined);
  serve(xml());
});

afterEach(() => {
  jest.useRealTimers();
});

function post(raw?: string) {
  return POST(
    new NextRequest('http://localhost/api/admin/exchange-rates/sync', {
      method: 'POST',
      ...(raw === undefined ? {} : { body: raw, headers: { 'content-type': 'application/json' } }),
    })
  );
}

const syncAudits = () =>
  auditLog.mock.calls.map((call) => call[0] as Record<string, unknown>).filter((entry) => entry.action === AUDIT_EVENTS.EXCHANGE_RATE_SYNC_RUN);

describe('the admin gate comes first', () => {
  it.each([
    ['signed out', 401, () => getUser.mockResolvedValue(null)],
    ['not an admin', 403, () => isAdmin.mockResolvedValue(false)],
  ])('%s → %i; nothing read, nothing fetched, no sync audit', async (_label, status, arrange) => {
    arrange();
    const res = await post('{}');
    expect(res.status).toBe(status);
    expect(listAll).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
    expect(syncAudits()).toEqual([]);
  });

  it('the first statement of POST is `const gate = await requireAdmin(`', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const body = source.slice(source.indexOf('export async function POST'));
    const firstStatement = body
      .slice(body.indexOf('{') + 1)
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '' && !line.startsWith('//'));
    expect(firstStatement).toMatch(/^const gate = await requireAdmin\(/);
  });
});

describe('the body: the sync takes no input', () => {
  it.each([
    ['a URL', { url: 'https://example.com/rates.xml' }],
    ['a currency list', { currencies: ['ILS'] }],
    ['a rate', { rate: '3.7' }],
  ])('%s → 400 invalid_input, no read, no fetch', async (_label, body) => {
    const res = await post(JSON.stringify(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'This action takes no input.', code: 'invalid_input' });
    expect(listAll).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
    expect(syncAudits()).toEqual([]);
  });

  it.each(['{', 'not json', '[]', '"x"', 'null'])('%j → 400, no read, no fetch', async (raw) => {
    const res = await post(raw);
    expect(res.status).toBe(400);
    expect(listAll).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
  });

  it.each([
    ['no body at all', undefined],
    ['an empty body', ''],
    ['{}', '{}'],
  ])('%s → 200', async (_label, raw) => {
    const res = await post(raw);
    expect(res.status).toBe(200);
  });
});

describe('the happy path (fixture of 2026-10-23)', () => {
  it('suggests ILS / EUR / GBP only, with the §5.7.2 values, rate date, fetch time and source', async () => {
    const res = await post('{}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        source: 'ECB',
        outcome: 'ok',
        rateDate: '2026-10-23',
        fetchedAt: NOW.toISOString(),
        suggestions: [
          {
            currencyCode: 'EUR',
            currentRate: '0.920000',
            status: 'suggested',
            suggestedRate: '0.893416',
            gapAbsolute: '-0.026584',
            gapPercent: '-2.89%',
            direction: 'down',
          },
          {
            currencyCode: 'GBP',
            currentRate: '0.750000',
            status: 'suggested',
            suggestedRate: '0.748039',
            gapAbsolute: '-0.001961',
            gapPercent: '-0.26%',
            direction: 'down',
          },
          {
            currencyCode: 'ILS',
            currentRate: '3.090000',
            status: 'suggested',
            suggestedRate: '3.121505',
            gapAbsolute: '+0.031505',
            gapPercent: '+1.02%',
            direction: 'up',
          },
        ],
      },
    });
    expect(fetchCalls).toEqual([ECB_DAILY_URL]);
  });

  it('a currency the feed lacks is not_in_feed, never 1 (D-4)', async () => {
    listAll.mockResolvedValue({ data: [row('XYZ', '2.000000'), row('USD', '1.000000')], error: null });
    const body = await (await post('{}')).json();
    expect(body.data.suggestions).toEqual([
      {
        currencyCode: 'XYZ',
        currentRate: '2.000000',
        status: 'not_in_feed',
        suggestedRate: null,
        gapAbsolute: null,
        gapPercent: null,
        direction: null,
      },
    ]);
  });

  it('an enabled flag that is null in the database is not synced', async () => {
    listAll.mockResolvedValue({ data: [row('ILS', '3.090000', null), row('GBP', '0.750000')], error: null });
    const body = await (await post('{}')).json();
    expect(body.data.suggestions.map((s: { currencyCode: string }) => s.currencyCode)).toEqual(['GBP']);
  });

  it('two syncs make two fetches (no server cache, SQ-46)', async () => {
    serve(xml(), xml());
    await post('{}');
    await post('{}');
    expect(fetchCalls).toEqual([ECB_DAILY_URL, ECB_DAILY_URL]);
  });
});

describe('a source failure is a 200 with its outcome and no suggestions', () => {
  it.each([
    ['http_404', () => new Response(null, { status: 404 })],
    ['blocked', () => new Response(null, { status: 403 })],
    ['blocked', () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['layout_changed', () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['layout_changed', () => new Response(FIXTURE.replace('European Central Bank', 'X'), { status: 200, headers: { 'content-type': 'text/xml' } })],
  ])('%s', async (outcome, reply) => {
    serve(reply);
    const res = await post('{}');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      source: 'ECB',
      outcome,
      rateDate: null,
      fetchedAt: NOW.toISOString(),
      suggestions: [],
    });
    expect(syncAudits()).toHaveLength(1);
    expect((syncAudits()[0].details as Record<string, unknown>).outcome).toBe(outcome);
  });

  it('a parser anchor is named in the log line, not in the answer', async () => {
    serve(() => new Response(FIXTURE.replace("<Cube currency='GBP'", "<Cube rate='1' currency='GBP'"), { status: 200, headers: { 'content-type': 'text/xml' } }));
    const body = await (await post('{}')).json();
    expect(body.data.outcome).toBe('layout_changed');
    expect(JSON.stringify(body)).not.toContain('E3');
    expect(logCalls).toContainEqual(['warn', expect.objectContaining({ outcome: 'layout_changed', anchor: 'E3' }), expect.any(String)]);
  });

  it('5xx twice is http_500 after one retry', async () => {
    serve(
      () => new Response('', { status: 500 }),
      () => new Response('', { status: 500 })
    );
    const body = await (await post('{}')).json();
    expect(body.data.outcome).toBe('http_500');
    expect(fetchCalls).toHaveLength(2);
  });
});

describe('the rates read', () => {
  it('a listAll error → 500, no fetch, no details outside development', async () => {
    listAll.mockResolvedValue({ data: null, error: new Error('rates down') });
    const res = await post('{}');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to sync exchange rates' });
    expect(fetchCalls).toEqual([]);
  });

  it('a thrown listAll → 500, no fetch', async () => {
    listAll.mockRejectedValue(new Error('boom'));
    const res = await post('{}');
    expect(res.status).toBe(500);
    expect(fetchCalls).toEqual([]);
  });
});

describe('the audit (SQ-47)', () => {
  it('one EXCHANGE_RATE_SYNC_RUN per accepted POST, flushed before the answer, with the SQ-47 shape', async () => {
    await post('{}');
    expect(syncAudits()).toHaveLength(1);
    expect(auditFlush).toHaveBeenCalled();
    const entry = syncAudits()[0];
    expect(entry).toMatchObject({
      action: 'EXCHANGE_RATE_SYNC_RUN',
      entityType: 'exchange_rate',
      userId: ADMIN.id,
      actorId: ADMIN.id,
      severity: 'info',
    });
    expect(entry.entityId).toBeUndefined();
    expect(entry.details).toEqual({
      source: 'ecb',
      outcome: 'ok',
      rateDate: '2026-10-23',
      durationMs: expect.any(Number),
      attempts: 1,
      bytes: Buffer.byteLength(FIXTURE, 'utf8'),
      currencies: [
        { currencyCode: 'EUR', currentRate: '0.920000', suggestedRate: '0.893416', status: 'suggested' },
        { currencyCode: 'GBP', currentRate: '0.750000', suggestedRate: '0.748039', status: 'suggested' },
        { currencyCode: 'ILS', currentRate: '3.090000', suggestedRate: '3.121505', status: 'suggested' },
      ],
    });
  });

  it('an audit failure still answers 200 with the suggestions', async () => {
    auditLog.mockRejectedValue(new Error('audit down'));
    auditFlush.mockRejectedValue(new Error('audit down'));
    const res = await post('{}');
    expect(res.status).toBe(200);
    expect((await res.json()).data.suggestions).toHaveLength(3);
  });

  it('the audit and the log never hold the feed text', async () => {
    await post('{}');
    const recorded = JSON.stringify([auditLog.mock.calls, logCalls]);
    expect(recorded).not.toContain('gesmes');
    expect(recorded).not.toContain('<Cube');
    expect(recorded).not.toContain('European Central Bank');
  });
});

describe('read-only', () => {
  it('the repository mock has no write method, and the route imports none', async () => {
    await post('{}');
    expect(Object.keys(repositoryMock)).toEqual(['listAll']);
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    expect(source).not.toMatch(/updateRate|setEnabled|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });

  it('the module exports POST only (PATCH …/sync is a 405, SA-1e-6)', () => {
    const handlers = Object.keys(routeModule).filter((name) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name));
    expect(handlers).toEqual(['POST']);
  });
});

// ── QA (slice 1e): every source failure end to end through the route ────────
// `ecbFeed.test.ts` covers each outcome on the fetch alone; these prove the
// route turns each into a 200 with its outcome, no suggestion, one sync entry
// and nothing written (the repository mock carries `listAll` only).

describe('QA: the feed fails in every way → 200, outcome, nothing written', () => {
  const big = 'x'.repeat(64 * 1024 + 1);
  it.each([
    ['a redirect (301) is reported, never followed', 'http_301', [() => new Response(null, { status: 301, headers: { location: 'https://example.com/' } })], 1],
    ['a declared content-length over 64 KB', 'too_large', [() => new Response('<x/>', { status: 200, headers: { 'content-type': 'text/xml', 'content-length': String(64 * 1024 + 1) } })], 1],
    ['a streamed body over 64 KB', 'too_large', [() => new Response(big, { status: 200, headers: { 'content-type': 'text/xml' } })], 1],
    ['the feed is down (network error twice)', 'network_error', [() => Promise.reject(new TypeError('fetch failed')), () => Promise.reject(new TypeError('fetch failed'))], 2],
    ['an HTML challenge page', 'blocked', [() => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })], 1],
    ['a feed without USD (E5)', 'layout_changed', [xml(FIXTURE.replace(/\s*<Cube currency='USD' rate='1.1193'\/>/, ''))], 1],
    ['USD at zero (E5)', 'layout_changed', [xml(FIXTURE.replace("rate='1.1193'", "rate='0.0000'"))], 1],
  ] as const)('%s', async (_label, outcome, reply, fetches) => {
    serve(...(reply as unknown as Reply[]));
    const res = await post('{}');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ source: 'ECB', outcome, rateDate: null, fetchedAt: NOW.toISOString(), suggestions: [] });
    expect(fetchCalls).toEqual(Array(fetches).fill(ECB_DAILY_URL));
    expect(Object.keys(repositoryMock)).toEqual(['listAll']);
    expect(syncAudits()).toHaveLength(1);
    expect(syncAudits()[0].details).toMatchObject({ outcome, rateDate: null, currencies: [] });
  });

  it('a timeout (10 s, no retry) is a 200 with outcome timeout', async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    const hanging = jest.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    );
    const previous = global.fetch;
    global.fetch = hanging as unknown as typeof fetch;
    try {
      const pending = post('{}');
      await jest.advanceTimersByTimeAsync(10_000);
      await jest.advanceTimersByTimeAsync(10_000);
      const res = await pending;
      expect(res.status).toBe(200);
      expect((await res.json()).data).toMatchObject({ outcome: 'timeout', rateDate: null, suggestions: [] });
      expect(hanging).toHaveBeenCalledTimes(1);
      expect(syncAudits()).toHaveLength(1);
    } finally {
      global.fetch = previous;
    }
  });

  it('a zero rate for another currency is that row only (no_usable_rate); the sync is ok', async () => {
    serve(xml(FIXTURE.replace("rate='0.83728'", "rate='0.00000'")));
    const body = await (await post('{}')).json();
    expect(body.data.outcome).toBe('ok');
    const byCode = Object.fromEntries(
      (body.data.suggestions as Array<{ currencyCode: string; status: string; suggestedRate: string | null }>).map((s) => [s.currencyCode, s])
    );
    expect(byCode.GBP).toMatchObject({ status: 'no_usable_rate', suggestedRate: null });
    expect(byCode.ILS).toMatchObject({ status: 'suggested', suggestedRate: '3.121505' });
    expect(byCode.EUR).toMatchObject({ status: 'suggested', suggestedRate: '0.893416' });
  });

  it('an attribute swap (DV-3) fails the whole sync loudly, never a silent drop', async () => {
    serve(xml(FIXTURE.replace("<Cube currency='ILS' rate='3.4939'/>", "<Cube rate='3.4939' currency='ILS'/>")));
    const body = await (await post('{}')).json();
    expect(body.data).toMatchObject({ outcome: 'layout_changed', suggestions: [] });
  });
});
