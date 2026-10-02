/**
 * `GET /api/business-os/credits/history` — the owner's credit history (credit
 * deduction slice 7a, workplan §4.7 and §7; SA SQ-29).
 *
 * The real route, builder, window function and repositories run here; only the
 * Supabase clients, the session and the entitlement snapshot are faked.
 *
 * Pinned:
 *   - the happy path: the summary and the lines, never cached;
 *   - 401 without a session, with nothing read and nothing decoded;
 *   - invalid input: a malformed or hostile cursor is a 400 with the error
 *     format, and nothing is read;
 *   - tenant isolation: `?accountId=` / `?userId=` are ignored; every ledger
 *     read goes through the caller's RLS client, scoped to the caller; the
 *     service role only reads the anchor and calls the period function;
 *   - paging: the cursor round-trips, and a cursor for another window is
 *     answered `{ restart: true }`;
 *   - failures: a ledger read error is a 500, never an empty history.
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
  anchor: { data: { period_anchor: ANCHOR } as unknown, error: null as unknown },
  period: { data: PERIOD as unknown, error: null as unknown },
  totals: { data: null as unknown, error: null as unknown },
  charges: { data: [] as unknown, error: null as unknown },
  ownerClientsBuilt: 0,
};

function fakeClient(kind: 'owner' | 'service') {
  return {
    from: (table: string) => {
      const query: Query = { client: kind, table, calls: [] };
      state.queries.push(query);
      const answer = () =>
        table === 'business_os_account_plans' ? state.anchor : table === 'business_os_credit_totals' ? state.totals : state.charges;
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'or', 'order', 'range']) {
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
      return { resolution: resolutionFor('champion'), unavailable: false, stale: false };
    },
  }),
}));

import { GET } from '@/app/api/business-os/credits/history/route';
import { encodeHistoryCursor } from '@/lib/business-os/credits/creditHistoryCursor';
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
  credits_total: '2.300000',
  credits_owner: '2.100000',
  credits_scheduled: '0.200000',
  credits_external: '0.000000',
  credits_adjustment: '0.000000',
};

const ROW_1 = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'charge',
  action_id: 'cccccccc-0000-4000-8000-000000000001',
  adjusts_action_id: null,
  period_start: PERIOD,
  credits: '2.100000',
  service: 'ai',
  action_type: 'chat_turn',
  triggered_by: 'owner',
  outcome: 'succeeded',
  created_at: '2026-09-30T09:14:00.123456+00:00',
  user_id: CUSTOMER,
};
const ROW_2 = {
  ...ROW_1,
  id: '00000000-0000-4000-8000-000000000002',
  action_id: 'cccccccc-0000-4000-8000-000000000002',
  credits: '0.200000',
  action_type: 'briefing_narration',
  triggered_by: 'scheduled',
  created_at: '2026-09-30T07:00:00.654321+00:00',
};

const URL_BASE = 'https://example.test/api/business-os/credits/history';
const request = (query = '') => new NextRequest(`${URL_BASE}${query}`);

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FLAG = 'NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY';
const flagBefore = process.env[FLAG];
afterAll(() => {
  if (flagBefore === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flagBefore;
});

beforeEach(() => {
  // The history is parked behind a flag (default off); these tests exercise it switched on.
  process.env[FLAG] = 'true';
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
  state.user = { id: CUSTOMER };
  state.queries = [];
  state.rpcs = [];
  state.askedFor = [];
  state.anchor = { data: { period_anchor: ANCHOR }, error: null };
  state.period = { data: PERIOD, error: null };
  state.totals = { data: totalsRow, error: null };
  state.charges = { data: [ROW_1, ROW_2], error: null };
  state.ownerClientsBuilt = 0;
});

afterEach(() => jest.useRealTimers());

describe('GET /api/business-os/credits/history', () => {
  it('happy path: the summary and the lines, never cached', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(body.success).toBe(true);
    expect(body.data.summary).toEqual({
      period: { kind: 'monthly', startsOn: '2026-09-14T09:31:07.123Z', endsBefore: '2026-10-14T09:31:07.123Z' },
      used: 2.3,
      usedByOwner: 2.1,
      usedAutomatic: 0.2,
    });
    expect(body.data.lines.map((l: { area: string; who: string; credits: number }) => [l.area, l.who, l.credits])).toEqual([
      ['chat', 'you', 2.1],
      ['briefing', 'automatic', 0.2],
    ]);
    expect(body.data.nextCursor).toBeNull();
    // The ledger rows were read by the exact period key, newest first.
    const rows = state.queries.find((q) => q.table === 'business_os_credit_charges')!;
    expect(rows.calls).toContainEqual(['eq', ['period_start', PERIOD]]);
    expect(rows.calls).toContainEqual(['range', [0, 50]]);
  });

  it('401 without a session: nothing read, nothing decoded', async () => {
    state.user = null;
    const response = await GET(request('?cursor=%%%'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(state.ownerClientsBuilt).toBe(0);
    expect(state.queries).toEqual([]);
    expect(state.rpcs).toEqual([]);
    expect(state.askedFor).toEqual([]);
  });

  it.each([
    ['empty', '?cursor='],
    ['not base64url', '?cursor=abc%2B%2F'],
    ['too long', `?cursor=${'a'.repeat(513)}`],
    ['not JSON', `?cursor=${Buffer.from('hello').toString('base64url')}`],
    ['an extra key', `?cursor=${Buffer.from(JSON.stringify({ w: `m:${PERIOD}`, t: PERIOD, i: ROW_1.id, accountId: SOMEBODY_ELSE })).toString('base64url')}`],
  ])('400 for a malformed cursor (%s), and nothing is read', async (_name, query) => {
    const response = await GET(request(query));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Invalid request');
    expect(state.queries).toEqual([]);
    expect(state.rpcs).toEqual([]);
  });

  it.each([
    ['an or-expression in the time', { w: `m:${PERIOD}`, t: `${ROW_1.created_at}",id.gt.0`, i: ROW_1.id }],
    ['parentheses in the time', { w: `m:${PERIOD}`, t: `${ROW_1.created_at})`, i: ROW_1.id }],
    ['or= in the window', { w: `m:${PERIOD},or=(id.gt.0)`, t: ROW_1.created_at, i: ROW_1.id }],
    ['a comma in the id', { w: `m:${PERIOD}`, t: ROW_1.created_at, i: `${ROW_1.id},id.gt.0` }],
  ])('400 for a hostile cursor (%s): it never reaches the repository', async (_name, payload) => {
    const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const response = await GET(request(`?cursor=${raw}`));
    expect(response.status).toBe(400);
    expect(state.queries).toEqual([]);
  });

  it('ignores ?accountId= and ?userId=: the caller always gets their own history', async () => {
    const response = await GET(request(`?accountId=${SOMEBODY_ELSE}&userId=${SOMEBODY_ELSE}`));
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
    expect(byClient('owner').sort()).toEqual(['business_os_credit_charges', 'business_os_credit_totals']);
    expect(byClient('service')).toEqual(['business_os_account_plans']);
  });

  it('a valid cursor reads the next page by the exact keyset, with no summary', async () => {
    const cursor = encodeHistoryCursor({ w: `m:${PERIOD}`, t: ROW_1.created_at, i: ROW_1.id });
    state.charges = { data: [ROW_2], error: null };
    const response = await GET(request(`?cursor=${cursor}`));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.summary).toBeUndefined();
    expect(body.data.lines).toHaveLength(1);
    const rows = state.queries.find((q) => q.table === 'business_os_credit_charges')!;
    expect(rows.calls).toContainEqual(['or', [`created_at.lt."${ROW_1.created_at}",and(created_at.eq."${ROW_1.created_at}",id.lt.${ROW_1.id})`]]);
  });

  it('a cursor for another window is answered { restart: true }, and no ledger row is read', async () => {
    const cursor = encodeHistoryCursor({ w: 'm:2026-08-14T09:31:07.123456+00:00', t: ROW_1.created_at, i: ROW_1.id });
    const response = await GET(request(`?cursor=${cursor}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { restart: true } });
    expect(state.queries.some((q) => q.table === 'business_os_credit_charges')).toBe(false);
  });

  it('a ledger read error is a 500 with the error format — never an empty history', async () => {
    state.charges = { data: null, error: new Error('permission denied for table') };
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Could not load your credit history', details: undefined });
  });

  it('a window read error is a 500', async () => {
    state.period = { data: null, error: new Error('rpc failed') };
    const response = await GET(request());
    expect(response.status).toBe(500);
  });
});

describe('parked: the flag is off (user decision 2026-10-02)', () => {
  it.each([['unset', undefined], ['false', 'false'], ['blank', ''], ['unrecognised', 'yes']])(
    '%s → 404 for a signed-in owner, before anything is read',
    async (_name, value) => {
      if (value === undefined) delete process.env[FLAG];
      else process.env[FLAG] = value;
      const response = await GET(request());
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(await response.json()).toEqual({ success: false, error: 'Not found' });
      expect(state.ownerClientsBuilt).toBe(0);
      expect(state.queries).toEqual([]);
      expect(state.rpcs).toEqual([]);
      expect(state.askedFor).toEqual([]);
    }
  );

  it('the same 404 for an anonymous caller — the route does not reveal that it exists (no 401)', async () => {
    delete process.env[FLAG];
    state.user = null;
    const response = await GET(request());
    expect(response.status).toBe(404);
  });

  it('a hostile cursor while off is still a plain 404, never decoded', async () => {
    delete process.env[FLAG];
    const response = await GET(request('?cursor=%%%'));
    expect(response.status).toBe(404);
  });

  it('switched on ("1" also counts), the route answers', async () => {
    process.env[FLAG] = '1';
    const response = await GET(request());
    expect(response.status).toBe(200);
  });
});

describe('the route source', () => {
  it('asks the server-side flag before the session', () => {
    const src = codeOnly(readFileSync(join(process.cwd(), 'app/api/business-os/credits/history/route.ts'), 'utf8'));
    expect(src.indexOf('isCreditHistoryRouteEnabled()')).toBeGreaterThan(-1);
    expect(src.indexOf('isCreditHistoryRouteEnabled()')).toBeLessThan(src.indexOf('getUser()'));
    expect(src).not.toMatch(/utils\/featureFlags/);
  });

  const code = codeOnly(readFileSync(join(process.cwd(), 'app/api/business-os/credits/history/route.ts'), 'utf8'));

  it('reads only `cursor` from the query, and no body or params', () => {
    const gets = [...code.matchAll(/searchParams\.get\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(gets).toEqual(['cursor']);
    expect(code).not.toMatch(/request\.(json|text|formData)\(|params\b/);
  });

  it('imports no service-role client and nothing from the entitlements module', () => {
    expect(code).not.toMatch(/supabaseServer['"]/);
    expect(code).not.toMatch(/business-os\/entitlements/);
  });

  it('calls getUser() before reading the cursor', () => {
    expect(code.indexOf('getUser()')).toBeLessThan(code.indexOf("searchParams.get('cursor')"));
  });
});
