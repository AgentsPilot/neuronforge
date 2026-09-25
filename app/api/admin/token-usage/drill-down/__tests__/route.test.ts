/**
 * GET /api/admin/token-usage/drill-down — the "Business OS only" lens
 * (admin reorganisation slice 2a).
 *
 * The load-bearing test is the totals one: under scope=bos the screen's totals
 * must equal what the Business OS LLM usage report computes
 * (computeAreaTotals over classifyCallRow) for the same rows — including a
 * legacy-tagged row, the bare `business-os` briefing tag and a misspelled area.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// The label lookups still use an inline client: any chain resolves empty.
jest.mock('@supabase/supabase-js', () => {
  const builder = (): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
          return () => builder();
        },
      }
    );
  return {
    createClient: () => ({
      from: () => builder(),
      auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } },
    }),
  };
});

const mockListRows = jest.fn();
jest.mock('@/lib/repositories/AdminTokenUsageAnalyticsRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/AdminTokenUsageAnalyticsRepository');
  return {
    ...actual,
    adminTokenUsageAnalyticsRepository: {
      listRowsAllAccountsInWindow: (...args: unknown[]) => mockListRows(...args),
    },
  };
});

import { GET } from '../route';
import { bosRowFilter } from '@/lib/business-os/llm/callCatalog';
import { classifyCallRow, computeAreaTotals, readOk } from '@/lib/business-os/usage/llmUsageVerification';
import type { LedgerCallRow } from '@/lib/repositories/TokenUsageRepository';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const ACCOUNT = '99999999-9999-4999-8999-999999999999';

const call = (query: string) => GET(new NextRequest(`http://localhost/api/admin/token-usage/drill-down${query}`));

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

/** One ledger row, in both shapes (the drill-down's and the report's). */
function ledgerRow(id: string, feature: string, component: string, input: number, output: number, cost: string) {
  return {
    id,
    created_at: '2026-09-03T10:00:00.000Z',
    user_id: ACCOUNT,
    agent_id: null,
    execution_id: null,
    provider: 'openai',
    model_name: 'gpt-4o',
    activity_type: 'llm_call',
    activity_name: null,
    category: null,
    request_type: null,
    feature,
    component,
    endpoint: null,
    session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    input_tokens: input,
    output_tokens: output,
    cost_usd: cost,
    success: true,
    error_code: null,
  };
}

const BOS_ROWS = [
  ledgerRow('r1', 'business-os-chat', 'BizQLPlanCache', 100, 50, '0.0012'),
  ledgerRow('r2', 'lead-reply', 'lead-reply', 40, 20, '0.0003'), // legacy value
  ledgerRow('r3', 'business-os', 'daily-briefing', 300, 120, '0.004'), // legacy briefing tag
  ledgerRow('r4', 'business-osx', 'typo', 10, 5, '0.0001'), // misspelled area: seen, not hidden
];

beforeEach(() => {
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  mockListRows.mockReset();
});

describe('the admin gate runs first', () => {
  it('401 when signed out, before any ledger read', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call('?scope=bos');
    expect(res.status).toBe(401);
    expect(mockListRows).not.toHaveBeenCalled();
  });

  it('403 for a signed-in non-admin, before validation or any read', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call('?scope=nope');
    expect(res.status).toBe(403);
    expect(mockListRows).not.toHaveBeenCalled();
  });
});

describe('validation (SA C-4)', () => {
  it.each([
    ['?scope=nope'],
    ['?period=0'],
    ['?period=366'],
    ['?user=not-a-uuid'],
    ['?agent=abc'],
    ['?category=other'],
    ['?breakdownBy=everything'],
    ['?dateFrom=2026-09-10T00:00:00.000Z&dateTo=2026-09-01T00:00:00.000Z'],
    ['?model=%01bad'],
  ])('400 for %s, with no read', async (query) => {
    asAdmin();
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(mockListRows).not.toHaveBeenCalled();
  });

  it('accepts real dimension values with / . : (no identifier regex)', async () => {
    asAdmin();
    mockListRows.mockResolvedValue({ data: [], error: null });
    const res = await call('?model=openai%2Fgpt-4o%3A2024.1&endpoint=%2Fapi%2Fv2%2Frun');
    expect(res.status).toBe(200);
    expect(mockListRows.mock.calls[0][1]).toMatchObject({ model: 'openai/gpt-4o:2024.1', endpoint: '/api/v2/run' });
  });

  it('does not leak validation detail outside development', async () => {
    asAdmin();
    const body = await (await call('?scope=nope')).json();
    expect(body).toEqual({ success: false, error: 'Invalid query parameters' });
  });
});

describe('scope=bos', () => {
  it('passes the platform BOS row definition to BOTH reads', async () => {
    asAdmin();
    mockListRows.mockResolvedValue({ data: BOS_ROWS, error: null });

    const res = await call('?scope=bos');
    expect(res.status).toBe(200);

    expect(mockListRows).toHaveBeenCalledTimes(2);
    for (const [, filters] of mockListRows.mock.calls) {
      expect(filters.featureFilter).toEqual(bosRowFilter());
    }
    const body = await res.json();
    expect(body.scope).toBe('bos');
  });

  it('totals equal the BOS LLM usage report arithmetic over the same rows (legacy rows included)', async () => {
    asAdmin();
    mockListRows.mockResolvedValue({ data: BOS_ROWS, error: null });

    const body = await (
      await call(`?scope=bos&user=${ACCOUNT}&dateFrom=2026-09-01T00:00:00.000Z&dateTo=2026-09-08T00:00:00.000Z`)
    ).json();

    const report = computeAreaTotals(
      readOk({ rows: (BOS_ROWS as unknown as LedgerCallRow[]).map(classifyCallRow), incomplete: false })
    );
    expect(body.totals.calls).toBe(report.total.calls);
    expect(body.totals.tokens).toBe(report.total.tokens);
    expect(body.totals.cost).toBeCloseTo(report.total.estimatedCostUsd, 10);
    expect(report.total.calls).toBe(4);
    expect(mockListRows.mock.calls[0][0]).toEqual({
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-09-08T00:00:00.000Z',
    });
    expect(mockListRows.mock.calls[0][1]).toMatchObject({ user: ACCOUNT });
  });

  it('flags possiblyIncomplete when the unpaged read returns the 1,000-row cap', async () => {
    asAdmin();
    const many = Array.from({ length: 1000 }, (_, i) => ledgerRow(`x${i}`, 'business-os-chat', 'c', 1, 1, '0'));
    mockListRows.mockResolvedValue({ data: many, error: null });
    const body = await (await call('?scope=bos')).json();
    expect(body.possiblyIncomplete).toBe(true);
  });
});

describe('scope=all (the old view)', () => {
  it('applies no feature predicate, and says it is complete below the cap', async () => {
    asAdmin();
    mockListRows.mockResolvedValue({ data: BOS_ROWS, error: null });
    const body = await (await call('')).json();
    for (const [, filters] of mockListRows.mock.calls) {
      expect(filters.featureFilter).toBeUndefined();
    }
    expect(body.scope).toBe('all');
    expect(body.possiblyIncomplete).toBe(false);
  });

  it('keeps the parked comparison behaviour: feature/component are NOT passed to the previous-period read', async () => {
    asAdmin();
    mockListRows.mockResolvedValue({ data: BOS_ROWS, error: null });
    await call('?feature=business-os-chat&component=c&provider=openai');
    const [main, comparison] = mockListRows.mock.calls.map((c) => c[1]);
    expect(main).toMatchObject({ feature: 'business-os-chat', component: 'c', provider: 'openai' });
    expect(comparison.feature).toBeUndefined();
    expect(comparison.component).toBeUndefined();
    expect(comparison.provider).toBe('openai');
  });

  it('500 without detail when the ledger read fails', async () => {
    asAdmin();
    mockListRows.mockResolvedValue({ data: null, error: new Error('db down') });
    const res = await call('');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Internal server error' });
  });
});
