/**
 * `GET /api/business-os/usage` — the owner's credits (credit deduction slice 6a,
 * workplan §4.5 and §7).
 *
 * Slice 6 supersedes Layer 1.1 AC-23 for this route: the Layer 1.1
 * characterization suites (`route.test.ts`, `route.zeroToken.test.ts` and their
 * snapshot) pinned the old token-based response and were retired, not edited
 * (SA F-11). The admin side keeps `lib/business-os/usage/__tests__/usageSummary.test.ts`.
 *
 * What is pinned here:
 *   - the happy path: a Founding Partner's exact payload, never cached;
 *   - 401 without a session, with nothing read;
 *   - tenant isolation: the handler takes NO input — `?accountId=` and
 *     `?range=` are ignored (behaviour) and nothing reads `searchParams`, a body
 *     or params (source) — and every ledger read goes through the caller's RLS
 *     client, scoped to the caller;
 *   - "invalid input" (the CLAUDE.md third case) is N/A by design: there is no
 *     input to be invalid; the two tests above replace it;
 *   - failures: a ledger, anchor or period read error is a 500 with the
 *     dev-only details guard, never `used: 0`; an unavailable plan snapshot is
 *     a 200 with no gauge.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { NextRequest } from 'next/server';

const CUSTOMER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SOMEBODY_ELSE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const ANCHOR = '2026-09-14T09:31:07.123456+00:00';
const PERIOD = '2026-09-14T09:31:07.123456+00:00';

type Query = { client: 'owner' | 'service'; table: string; calls: Array<[string, unknown[]]> };

const state = {
  user: null as { id: string } | null,
  queries: [] as Query[],
  rpcs: [] as Array<{ fn: string; args: unknown }>,
  askedFor: [] as string[],
  snapshot: { resolution: null as unknown, unavailable: false, stale: false },
  anchor: { data: { period_anchor: ANCHOR } as unknown, error: null as unknown },
  period: { data: PERIOD as unknown, error: null as unknown },
  totals: { data: null as unknown, error: null as unknown },
  // Slice 11d: the owner's credit lots and their draws.
  lots: { data: [] as unknown, error: null as unknown },
  draws: { data: [] as unknown, error: null as unknown },
  ownerClientsBuilt: 0,
};

function fakeClient(kind: 'owner' | 'service') {
  return {
    from: (table: string) => {
      const query: Query = { client: kind, table, calls: [] };
      state.queries.push(query);
      const answer = () =>
        table === 'business_os_account_plans'
          ? state.anchor
          : table === 'business_os_credit_lots'
            ? state.lots
            : table === 'business_os_credit_lot_draws'
              ? state.draws
              : state.totals;
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'order', 'range']) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push([method, args]);
          return builder;
        };
      }
      builder.maybeSingle = async () => answer();
      builder.then = (resolve: (v: unknown) => void) => resolve(answer());
      return builder;
    },
    rpc: async (fn: string, args: unknown) => {
      state.rpcs.push({ fn, args });
      if (kind === 'owner') throw new Error('the owner client must never call rpc');
      return state.period;
    },
  };
}

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

jest.mock('@/lib/auth', () => ({ getUser: async () => state.user }));

jest.mock('@/lib/supabaseServerAuth', () => ({
  createAuthenticatedServerClient: async () => {
    state.ownerClientsBuilt += 1;
    return fakeClient('owner');
  },
}));

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: fakeClient('service') }));

jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({
    getSnapshot: async (accountId: string) => {
      state.askedFor.push(accountId);
      return state.snapshot;
    },
  }),
}));

import { GET } from '@/app/api/business-os/usage/route';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';

const NOW = new Date('2026-09-30T12:00:00.000Z');

function resolutionFor(planId: string) {
  const config = readCodeConfig();
  return resolveEntitlements({ config, account: previewAccountFor(config, planId, NOW), overrides: [], addons: [], now: NOW });
}

const totalsRow = {
  period_start: PERIOD,
  credits_total: '63.000000',
  credits_owner: '41.000000',
  credits_scheduled: '20.000000',
  credits_external: '2.000000',
  credits_adjustment: '0.000000',
};

function request(url = 'https://example.test/api/business-os/usage') {
  return new NextRequest(url);
}

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
  state.user = { id: CUSTOMER };
  state.queries = [];
  state.rpcs = [];
  state.askedFor = [];
  state.snapshot = { resolution: resolutionFor('champion'), unavailable: false, stale: false };
  state.anchor = { data: { period_anchor: ANCHOR }, error: null };
  state.period = { data: PERIOD, error: null };
  state.totals = { data: totalsRow, error: null };
  state.lots = { data: [], error: null };
  state.draws = { data: [], error: null };
  state.ownerClientsBuilt = 0;
});

afterEach(() => jest.useRealTimers());

describe('GET /api/business-os/usage', () => {
  it('happy path: a Founding Partner gets credits used and left of the plan allowance, never cached', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(body).toEqual({
      success: true,
      data: {
        period: { kind: 'monthly', resetsOn: '2026-10-14T09:31:07.123Z' },
        allowance: { amount: 32250, per: 'month' },
        used: 63,
        usedByOwner: 41,
        usedAutomatic: 22,
        extraCredits: 0,
        remaining: 32187,
      },
    });
    // The period key went from the anchor to the function and on to the ledger untouched.
    expect(state.rpcs).toEqual([{ fn: 'business_os_credit_period_start', args: { p_anchor: ANCHOR, p_at: NOW.toISOString() } }]);
    const totals = state.queries.find((q) => q.table === 'business_os_credit_totals')!;
    expect(totals.calls).toContainEqual(['eq', ['period_start', PERIOD]]);
  });

  it('401 without a session, and nothing is read', async () => {
    state.user = null;

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(state.ownerClientsBuilt).toBe(0);
    expect(state.queries).toEqual([]);
    expect(state.rpcs).toEqual([]);
    expect(state.askedFor).toEqual([]);
  });

  it('ignores ?accountId= and ?range=: the caller always gets their own figures', async () => {
    const response = await GET(request(`https://example.test/api/business-os/usage?accountId=${SOMEBODY_ELSE}&range=last_7d`));

    expect(response.status).toBe(200);
    expect(state.askedFor).toEqual([CUSTOMER]);
    const userFilters = state.queries.flatMap((q) => q.calls.filter(([m, a]) => m === 'eq' && a[0] === 'user_id').map(([, a]) => a[1]));
    expect(userFilters.length).toBeGreaterThan(0);
    expect(new Set(userFilters)).toEqual(new Set([CUSTOMER]));
    expect(JSON.stringify(state.queries)).not.toContain(SOMEBODY_ELSE);
  });

  it('reads the ledger with the caller\'s RLS client; the service role only reads the anchor and calls the period function', async () => {
    await GET(request());

    const byClient = (client: 'owner' | 'service') => state.queries.filter((q) => q.client === client).map((q) => q.table);
    // Slice 11d: the lots too, on the same RLS client (no draws read without lots).
    expect(byClient('owner').sort()).toEqual(['business_os_credit_lots', 'business_os_credit_totals']);
    expect(byClient('service')).toEqual(['business_os_account_plans']);
    expect(state.ownerClientsBuilt).toBe(1);
  });

  it('an unavailable plan snapshot: 200 with usage and no gauge, never "0 left"', async () => {
    state.snapshot = { resolution: null, unavailable: true, stale: false };

    const body = await (await GET(request())).json();

    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ allowance: null, remaining: null, used: 63, period: { kind: 'monthly', resetsOn: null } });
  });

  it.each([
    ['the totals read', () => (state.totals = { data: null, error: new Error('permission denied') })],
    ['the anchor read', () => (state.anchor = { data: null, error: new Error('db down') })],
    ['the period function', () => (state.period = { data: null, error: new Error('rpc failed') })],
    ['a garbage figure', () => (state.totals = { data: { ...totalsRow, credits_owner: 'NaN' }, error: null })],
  ])('%s failing is a 500 with a generic message — never used: 0', async (_name, breakIt) => {
    breakIt();

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(body.success).toBe(false);
    expect(body.error).toBe('Could not load your credits');
    expect(body.data).toBeUndefined();
    // Not development: no internal detail leaves the server.
    expect(body.details).toBeUndefined();
  });
});

describe('the handler source', () => {
  const code = codeOnly(readFileSync(join(process.cwd(), 'app/api/business-os/usage/route.ts'), 'utf8'));

  it('reads no input: no searchParams, no body, no params (the isolation is structural)', () => {
    expect(code).not.toMatch(/searchParams|nextUrl|new URL\(|\.json\(\s*\)|formData|\.text\(\s*\)|params/);
    // The handler takes the request only for its correlation header.
    expect(code).toMatch(/export async function GET\(request: NextRequest\)/);
  });

  it('imports no service-role client and nothing from the entitlements module', () => {
    expect(code).not.toMatch(/supabaseServer['"]/);
    expect(code).not.toMatch(/business-os\/entitlements/);
  });

  it('is never cached', () => {
    expect(code).toMatch(/export const dynamic = 'force-dynamic'/);
    expect(code).toMatch(/'Cache-Control': 'private, no-store'/);
  });
});

/**
 * Credit deduction slice 11d (workplan §11d.6; SA W11d-2, W11d-8; G11d-1):
 * the owner's "Extra credits", read with the caller's RLS client.
 */
describe('extra credits (slice 11d)', () => {
  const LOT = 'cccccccc-3333-4333-8333-cccccccccccc';
  const lotRow = { id: LOT, user_id: CUSTOMER, credits_granted: '200.000000', expires_at: null, created_at: '2026-09-20T00:00:00+00:00' };
  const routeLogger = () =>
    (jest.requireMock('@/lib/logger') as { createLogger: () => { info: jest.Mock } }).createLogger();

  beforeEach(() => routeLogger().info.mockClear());

  it('a 200-credit lot: extraCredits 200, remaining unchanged (the plan only), no lot detail in the answer', async () => {
    state.lots = { data: [lotRow], error: null };
    state.draws = { data: [{ id: 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee', lot_id: LOT, user_id: CUSTOMER, kind: 'reversal', credits: '50', created_at: '2026-09-21T00:00:00+00:00' }], error: null };

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ used: 63, extraCredits: 150, remaining: 32187 });
    expect(JSON.stringify(body)).not.toContain(LOT);
    // Both lot reads on the caller's RLS client, scoped to the caller.
    const lotQueries = state.queries.filter((q) => q.table.startsWith('business_os_credit_lot'));
    expect(lotQueries.map((q) => q.client)).toEqual(['owner', 'owner']);
    for (const q of lotQueries) expect(q.calls).toContainEqual(['eq', ['user_id', CUSTOMER]]);
  });

  it('the log says whether there are extra credits, never the figure (W11d-8)', async () => {
    state.lots = { data: [lotRow], error: null };
    await GET(request());
    const info = routeLogger().info.mock.calls.find(([, msg]) => msg === 'Owner credits read');
    expect(info).toBeDefined();
    expect(info![0]).toMatchObject({ hasExtra: true });
    expect(JSON.stringify(info![0])).not.toMatch(/200|extraCredits/);

    routeLogger().info.mockClear();
    state.lots = { data: [], error: null };
    await GET(request());
    expect(routeLogger().info.mock.calls.find(([, msg]) => msg === 'Owner credits read')![0]).toMatchObject({ hasExtra: false });
  });

  it.each([
    ['a lots read error', () => (state.lots = { data: null, error: new Error('permission denied for column reason') })],
    ['a draws read error', () => {
      state.lots = { data: [lotRow], error: null };
      state.draws = { data: null, error: new Error('JWT expired') };
    }],
    ['an unreadable lot figure', () => (state.lots = { data: [{ ...lotRow, credits_granted: 'NaN' }], error: null })],
  ])('%s is a 500 with the generic message, never extraCredits: 0 (OP-38)', async (_name, breakIt) => {
    breakIt();
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Could not load your credits' });
  });
});
