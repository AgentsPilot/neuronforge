/**
 * GET /api/business-os/usage with an AI image row in the data (Layer 1.5
 * FR-14, AC-10).
 *
 * An image row carries zero tokens and a dollar cost. Every credit figure the
 * owner's card shows must be unchanged; only the call counts rise, which
 * `UsageCard.tsx` does not render (reviewed, not scraped — SA WC-6).
 *
 * Kept apart from `route.test.ts` so the Layer 1.1 characterization test and
 * its snapshot stay unedited.
 */

import { NextRequest } from 'next/server';
import { createFakeSupabase, type FakeDbOptions, type Row } from '@/tests/helpers/fakePostgrest';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

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
const NOW = new Date('2026-09-17T12:00:00.000Z');

const CONFIG: Row[] = [
  { config_key: 'tokens_per_pilot_credit', config_value: '25' },
  { config_key: 'monthly_ai_allowance_usd', config_value: '10' },
  { config_key: 'pilot_credit_cost_usd', config_value: '0.00048' },
];

const BASE_RPC = [
  { bucket: 'feature', key: 'business-os-chat', tokens: '123456', calls: '12' },
  { bucket: 'feature', key: 'business-os-website', tokens: 5000, calls: 2 },
  { bucket: 'feature', key: 'business-os-onboarding', tokens: 8000, calls: 3 },
  { bucket: 'day', key: '2026-09-15', tokens: '100000', calls: '9' },
  { bucket: 'day', key: '2026-09-17', tokens: 36456, calls: 8 },
];

/** The same data plus one generated image: zero tokens, one call, today. */
const WITH_IMAGE_RPC = [
  ...BASE_RPC.filter((r) => !(r.bucket === 'day' && r.key === '2026-09-17')),
  { bucket: 'feature', key: 'business-os-images', tokens: 0, calls: 1 },
  { bucket: 'day', key: '2026-09-17', tokens: 36456, calls: 9 },
];

function ledger(withImage: boolean): Row[] {
  const rows: Row[] = [
    { user_id: USER.id, feature: 'business-os-chat', total_tokens: 1200, created_at: '2026-09-16T10:00:00.000Z' },
    { user_id: USER.id, feature: 'business-os-onboarding', total_tokens: 800, created_at: '2026-09-17T09:00:00.000Z' },
  ];
  if (withImage) {
    rows.push({ user_id: USER.id, feature: 'business-os-images', total_tokens: 0, created_at: '2026-09-17T10:00:00.000Z' });
  }
  return rows;
}

async function run(options: FakeDbOptions) {
  fake = createFakeSupabase(options);
  const res = await GET(new NextRequest('http://localhost/api/business-os/usage?range=last_7d'));
  return { status: res.status, body: JSON.parse(await res.text()) };
}

function withoutCalls(data: Record<string, unknown>) {
  const { calls: _calls, breakdown, ...rest } = data;
  return {
    ...rest,
    breakdown: (breakdown as Array<Record<string, unknown>>).map(({ calls: _c, ...line }) => line),
  };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
  getUser.mockResolvedValue(USER);
});

afterEach(() => jest.useRealTimers());

describe.each([
  ['database path', (img: boolean): FakeDbOptions => ({
    rpc: () => ({ data: img ? WITH_IMAGE_RPC : BASE_RPC, error: null }),
    tables: { ais_system_config: CONFIG },
  })],
  ['row fallback path', (img: boolean): FakeDbOptions => ({
    rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
    tables: { ais_system_config: CONFIG, token_usage: ledger(img) },
  })],
])('an image row on the %s (AC-10)', (_name, options) => {
  it('leaves every credit figure, the allowance, remaining, the daily series and the breakdown unchanged', async () => {
    const before = await run(options(false));
    const after = await run(options(true));

    expect(before.status).toBe(200);
    expect(after.status).toBe(200);
    expect(withoutCalls(after.body.data)).toEqual(withoutCalls(before.body.data));
    expect(after.body.data.breakdown.map((b: { key: string }) => b.key)).not.toContain('images');
  });

  it('raises the call count by exactly one', async () => {
    const before = await run(options(false));
    const after = await run(options(true));
    expect(after.body.data.calls).toBe(before.body.data.calls + 1);
  });

  it('shows onboarding as its own category, counted in credits like any other area', async () => {
    const { body } = await run(options(false));
    const onboarding = body.data.breakdown.find((b: { key: string }) => b.key === 'onboarding');
    expect(onboarding).toBeDefined();
    expect(onboarding.credits).toBeGreaterThan(0);
    expect(body.data.breakdown.map((b: { key: string }) => b.key)).not.toContain('other');
  });
});

describe('allowance through ConfigRepository.getSystemConfigs (Layer 1.5 F-6, AC-19)', () => {
  const rpc = () => ({ data: BASE_RPC, error: null });

  it('reads both allowance keys in one query', async () => {
    await run({ rpc, tables: { ais_system_config: CONFIG } });
    const multiKey = fake.queries.filter(
      (q) => q.table === 'ais_system_config' && q.filters.some((f) => f.op === 'in' && f.column === 'config_key')
    );
    expect(multiKey).toHaveLength(1);
    expect(multiKey[0].filters.find((f) => f.op === 'in')?.value).toEqual(['monthly_ai_allowance_usd', 'pilot_credit_cost_usd']);
  });

  it('draws no gauge for an invalid allowance value', async () => {
    const { body } = await run({
      rpc,
      tables: {
        ais_system_config: [
          { config_key: 'tokens_per_pilot_credit', config_value: '25' },
          { config_key: 'monthly_ai_allowance_usd', config_value: 'not-a-number' },
        ],
      },
    });
    expect(body.data.allowance).toBeNull();
    expect(body.data.remaining).toBeNull();
  });

  it('keeps the documented fallbacks when the config read fails', async () => {
    const { status, body } = await run({
      rpc,
      tables: { ais_system_config: CONFIG },
      errorWhen: (q) => (q.table === 'ais_system_config' && q.filters.some((f) => f.op === 'in') ? { message: 'boom' } : null),
    });
    expect(status).toBe(200);
    expect(body.data.allowance).toBe(Math.round(10 / 0.00048));
  });
});
