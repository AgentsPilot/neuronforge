/**
 * QA (admin reorganisation slice 2a): what the "Business OS only" lens actually
 * sends to PostgREST.
 *
 * The route test mocks the repository and checks the filter OBJECT. This suite
 * runs the route over the REAL AdminTokenUsageAnalyticsRepository and the REAL
 * supabase-js client, with only `fetch` replaced, so it pins the wire: both
 * ledger reads carry the platform's Business OS row definition (the prefix AND
 * every legacy value, from bosRowFilter()), select an explicit column list, and
 * scope=all sends no feature predicate at all.
 */

import { NextRequest } from 'next/server';
import { BOS_FEATURE_FILTER_PREFIX, BOS_LEGACY_FEATURES_FLAT } from '@/lib/business-os/llm/callCatalog';

type Captured = { url: URL };
const mockRequests: Captured[] = [];

const LEDGER_ROW = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  created_at: '2026-09-20T10:00:00.000Z',
  user_id: null,
  agent_id: null,
  execution_id: null,
  provider: 'openai',
  model_name: 'gpt-4o',
  activity_type: 'chat',
  activity_name: null,
  category: null,
  request_type: null,
  feature: 'lead-reply',
  component: 'lead-reply',
  endpoint: null,
  input_tokens: 10,
  output_tokens: 5,
  cost_usd: '0.0001',
};

const mockFetch = jest.fn(async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  mockRequests.push({ url });
  let body: unknown = [];
  if (url.pathname === '/rest/v1/token_usage') body = [LEDGER_ROW];
  if (url.pathname.startsWith('/auth/v1/admin/users')) body = { users: [], aud: 'authenticated' };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
});
(globalThis as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

jest.mock('@/lib/supabaseServer', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ES imports
  const { createClient } = require('@supabase/supabase-js');
  return {
    supabaseServer: createClient('http://pg.test', 'service-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (...args: unknown[]) => (globalThis.fetch as (...a: unknown[]) => unknown)(...args) },
    }),
  };
});

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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('../route') as typeof import('../route');

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const call = (query: string) => GET(new NextRequest(`http://localhost/api/admin/token-usage/drill-down${query}`));
const ledgerReads = () => mockRequests.filter((r) => r.url.pathname === '/rest/v1/token_usage');

beforeEach(() => {
  mockRequests.length = 0;
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
});

describe('scope=bos on the wire', () => {
  it('both ledger reads carry the prefix AND every legacy value, and select explicit columns', async () => {
    const res = await call('?scope=bos&period=30');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe('bos');

    const reads = ledgerReads();
    expect(reads).toHaveLength(2); // current period + previous period

    const expectedOr = `(feature.like.${BOS_FEATURE_FILTER_PREFIX}*,feature.in.(${BOS_LEGACY_FEATURES_FLAT.map(
      (f) => `"${f}"`
    ).join(',')}))`;
    for (const { url } of reads) {
      expect(url.searchParams.get('or')).toBe(expectedOr);
      const select = url.searchParams.get('select') ?? '';
      expect(select).not.toContain('*');
      // No payload, metadata or error column on the wire.
      for (const forbidden of ['request_payload', 'response_payload', 'metadata', 'error_message', 'prompt']) {
        expect(select).not.toContain(forbidden);
      }
    }
    // Every legacy value is included (the requirement's "legacy rows are included").
    expect(BOS_LEGACY_FEATURES_FLAT).toEqual(
      expect.arrayContaining(['insight-generation', 'correlated-insight-generation', 'health-summary-generation', 'landing-page-generation', 'lead-reply'])
    );
  });

  it('the one feature filter is a single parameter the request cannot extend', async () => {
    // A hostile dimension value reaches .eq() on its own column, never the or= group.
    const res = await call('?scope=bos&feature=' + encodeURIComponent('x,feature.neq.y)'));
    expect(res.status).toBe(200);
    const [main] = ledgerReads();
    expect(main.url.searchParams.getAll('or')).toHaveLength(1);
    expect(main.url.searchParams.get('feature')).toBe('eq.x,feature.neq.y)');
  });
});

describe('scope=all on the wire', () => {
  it('sends no feature predicate (the old all-products view)', async () => {
    const res = await call('?scope=all&period=30');
    expect(res.status).toBe(200);
    for (const { url } of ledgerReads()) expect(url.searchParams.has('or')).toBe(false);
  });

  it('the route default (no scope) is all; the page is what defaults to bos', async () => {
    const res = await call('?period=30');
    expect((await res.json()).scope).toBe('all');
    for (const { url } of ledgerReads()) expect(url.searchParams.has('or')).toBe(false);
  });
});
