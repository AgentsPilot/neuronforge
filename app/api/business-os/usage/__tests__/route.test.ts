/**
 * GET /api/business-os/usage — CHARACTERIZATION test (Layer 1.1 T1, AC-23).
 *
 * Written against the route BEFORE its totals moved into
 * `lib/business-os/usage/usageSummary.ts`, and required to pass UNEDITED
 * after. It pins the exact response the owner's usage card receives.
 *
 * The database is not a hand-set mock: `supabaseServer` is replaced by an
 * in-memory PostgREST stand-in (`tests/helpers/fakePostgrest.ts`) that applies
 * filters, ordering and paging to row fixtures, and gives `.single()` and
 * `.maybeSingle()` their real 0 / 1 / many-row semantics. The route read
 * `tokens_per_pilot_credit` with `.maybeSingle()`; after the refactor it is
 * read through `ConfigRepository.getSystemConfig` (`.single()`). The
 * tokens-per-credit cases below are the proof that the two agree (WC-1).
 */

import { NextRequest } from 'next/server';
import { createFakeSupabase, type FakeDbOptions, type Row } from '@/tests/helpers/fakePostgrest';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const logInfo = jest.fn();
const logWarn = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => logInfo(...a),
      warn: (...a: unknown[]) => logWarn(...a),
      error: jest.fn(),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// The active fake database. Replaced per test; the module-level proxy lets the
// route (and, after the refactor, the repositories) keep a stable reference.
let fake = createFakeSupabase();
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => fake.client.from(table),
    rpc: (name: string, args: Record<string, unknown>) => fake.client.rpc(name, args),
  },
  createServerSupabaseClient: jest.fn(),
}));

import { GET } from '../route';

const USER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const OTHER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-17T12:00:00.000Z');

function req(qs = '?range=last_7d'): NextRequest {
  return new NextRequest(`http://localhost/api/business-os/usage${qs}`, { method: 'GET' });
}

function config(rows: Row[]): Row[] {
  return rows;
}

const STANDARD_CONFIG: Row[] = [
  { config_key: 'tokens_per_pilot_credit', config_value: '25' },
  { config_key: 'monthly_ai_allowance_usd', config_value: '10' },
  { config_key: 'pilot_credit_cost_usd', config_value: '0.00048' },
];

const RPC_ROWS = [
  { bucket: 'feature', key: 'business-os-chat', tokens: '123456', calls: '12' },
  { bucket: 'feature', key: 'business-os-website', tokens: 5000, calls: 2 },
  { bucket: 'feature', key: 'landing-page-generation', tokens: 1000, calls: 1 },
  { bucket: 'feature', key: 'something-unmapped', tokens: 40, calls: 1 },
  { bucket: 'feature', key: 'business-os-leads', tokens: 0, calls: 1 },
  { bucket: 'day', key: '2026-09-15', tokens: '100000', calls: '9' },
  { bucket: 'day', key: '2026-09-17', tokens: 29496, calls: 8 },
];

function rpcOk(): FakeDbOptions['rpc'] {
  return () => ({ data: RPC_ROWS, error: null });
}

function rpcMissing(): FakeDbOptions['rpc'] {
  return () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
}

/** 2,050 in-window rows for USER (forces 3 pages), plus rows that must be excluded. */
function ledgerRows(): Row[] {
  const rows: Row[] = [];
  const features = ['business-os-chat', 'business-os-insights', 'insight-generation', null, 'chat-v3'];
  for (let i = 0; i < 2050; i++) {
    const at = new Date(NOW.getTime() - (i + 1) * 4 * 60 * 1000); // every 4 minutes, ~5.7 days
    rows.push({
      user_id: USER.id,
      feature: features[i % features.length],
      total_tokens: i % 7 === 0 ? null : 100 + (i % 13),
      created_at: at.toISOString(),
    });
  }
  // Another account in the window: excluded by user_id.
  rows.push({ user_id: OTHER, feature: 'business-os-chat', total_tokens: 99999, created_at: NOW.toISOString() });
  // Before the 7-day window: excluded by created_at.
  rows.push({
    user_id: USER.id,
    feature: 'business-os-chat',
    total_tokens: 77777,
    created_at: new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  });
  return rows;
}

async function run(options: FakeDbOptions, qs?: string) {
  fake = createFakeSupabase(options);
  const res = await GET(req(qs));
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
  getUser.mockResolvedValue(USER);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('GET /api/business-os/usage (characterization)', () => {
  it('database path: exact response, summedBy=database, no fallback read', async () => {
    const { status, text } = await run({
      rpc: rpcOk(),
      tables: { ais_system_config: config(STANDARD_CONFIG), token_usage: ledgerRows() },
    });

    expect(status).toBe(200);
    expect(text).toMatchSnapshot();
    expect(fake.queries.some((q) => q.table === 'token_usage')).toBe(false);
    expect(fake.rpcCalls).toEqual([
      {
        name: 'business_os_usage_summary',
        args: { p_user_id: USER.id, p_since: '2026-09-10T12:00:00.000Z' },
      },
    ]);
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER.id, range: 'last_7d', summedBy: 'database' }),
      'Usage reported'
    );
  });

  it('coerces BIGINT strings and totals from feature rows only (no day double count)', async () => {
    const { body } = await run({
      rpc: rpcOk(),
      tables: { ais_system_config: config(STANDARD_CONFIG) },
    });

    // feature rows: 123456 + 5000 + 1000 + 40 + 0 = 129496 tokens, 17 calls; / 25 = 5179.84 → 5180
    expect(body.data.calls).toBe(17);
    expect(body.data.credits).toBe(5180);
    expect(body.data.breakdown.find((b: { key: string }) => b.key === 'leads')).toBeUndefined();
  });

  it('fallback path: RPC missing → pages the rows, summedBy=rows, warns', async () => {
    const { status, text } = await run({
      rpc: rpcMissing(),
      tables: { ais_system_config: config(STANDARD_CONFIG), token_usage: ledgerRows() },
    });

    expect(status).toBe(200);
    expect(text).toMatchSnapshot();
    const pages = fake.queries.filter((q) => q.table === 'token_usage');
    expect(pages.map((q) => q.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(logWarn).toHaveBeenCalledTimes(1);
    expect(logInfo).toHaveBeenCalledWith(expect.objectContaining({ summedBy: 'rows' }), 'Usage reported');
  });

  it('fallback path: a page read error fails the request with 500', async () => {
    const { status, body } = await run({
      rpc: rpcMissing(),
      tables: { ais_system_config: config(STANDARD_CONFIG), token_usage: ledgerRows() },
      errorWhen: (q) =>
        q.table === 'token_usage' && q.range?.[0] === 1000 ? { message: 'boom', code: '57014' } : null,
    });

    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Internal server error' });
  });

  describe('tokens per Pilot Credit (positive integer, else 10)', () => {
    // 129,496 tokens from RPC_ROWS.
    const cases: Array<[string, Row[], number, boolean]> = [
      ["'25'", [{ config_key: 'tokens_per_pilot_credit', config_value: '25' }], Math.round(129496 / 25), false],
      ['number 25', [{ config_key: 'tokens_per_pilot_credit', config_value: 25 }], Math.round(129496 / 25), false],
      ["'0'", [{ config_key: 'tokens_per_pilot_credit', config_value: '0' }], Math.round(129496 / 10), false],
      ["''", [{ config_key: 'tokens_per_pilot_credit', config_value: '' }], Math.round(129496 / 10), false],
      ['null', [{ config_key: 'tokens_per_pilot_credit', config_value: null }], Math.round(129496 / 10), false],
      ["'abc'", [{ config_key: 'tokens_per_pilot_credit', config_value: 'abc' }], Math.round(129496 / 10), false],
      ["'-3'", [{ config_key: 'tokens_per_pilot_credit', config_value: '-3' }], Math.round(129496 / 10), false],
      ['no row', [], Math.round(129496 / 10), false],
      [
        'two rows',
        [
          { config_key: 'tokens_per_pilot_credit', config_value: '25' },
          { config_key: 'tokens_per_pilot_credit', config_value: '50' },
        ],
        Math.round(129496 / 10),
        false,
      ],
      ['a thrown client error', [{ config_key: 'tokens_per_pilot_credit', config_value: '25' }], Math.round(129496 / 10), true],
    ];

    it.each(cases)('%s', async (_label, rows, expectedCredits, throws) => {
      const { status, body } = await run({
        rpc: rpcOk(),
        tables: { ais_system_config: rows },
        throwWhen: throws
          ? (q) =>
              q.table === 'ais_system_config' &&
              q.filters.some((f) => f.op === 'eq' && f.value === 'tokens_per_pilot_credit')
          : undefined,
      });

      expect(status).toBe(200);
      expect(body.data.credits).toBe(expectedCredits);
    });
  });

  describe('allowance', () => {
    it('defaults to $10 at the documented credit price when the keys are absent', async () => {
      const { body } = await run({ rpc: rpcOk(), tables: { ais_system_config: [] } });
      expect(body.data.allowance).toBe(Math.round(10 / 0.00048));
      expect(body.data.remaining).toBe(Math.max(0, Math.round(10 / 0.00048) - Math.round(129496 / 10)));
    });

    it('is null (no gauge) when set to 0', async () => {
      const { body } = await run({
        rpc: rpcOk(),
        tables: {
          ais_system_config: [
            { config_key: 'tokens_per_pilot_credit', config_value: '25' },
            { config_key: 'monthly_ai_allowance_usd', config_value: '0' },
          ],
        },
      });
      expect(body.data.allowance).toBeNull();
      expect(body.data.remaining).toBeNull();
    });
  });

  it('uses the default range (last_30d) when none is given', async () => {
    const { body } = await run({ rpc: rpcOk(), tables: { ais_system_config: config(STANDARD_CONFIG) } }, '');
    expect(body.data.range).toBe('last_30d');
    expect(body.data.daily).toHaveLength(30);
    expect(fake.rpcCalls[0].args.p_since).toBe('2026-08-18T12:00:00.000Z');
  });

  it('401 when signed out, with no read', async () => {
    getUser.mockResolvedValue(null);
    const { status, body } = await run({ rpc: rpcOk() });
    expect(status).toBe(401);
    expect(body).toEqual({ success: false, error: 'Unauthorized' });
    expect(fake.rpcCalls).toHaveLength(0);
    expect(fake.queries).toHaveLength(0);
  });

  it('400 for an unknown range, with no read', async () => {
    const { status, body } = await run({ rpc: rpcOk() }, '?range=last_1y');
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error: 'Invalid range' });
    expect(fake.rpcCalls).toHaveLength(0);
  });
});
