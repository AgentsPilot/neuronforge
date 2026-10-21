/**
 * The drill-down names a closed account "Deleted account {ref}" (data export
 * DE-10b.2, SA TQ-21), in the user filter list and in the grouped rows. The
 * placeholder address itself is never shown.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: async () => true }) },
}));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const TOMBSTONE = 'deleted-0123456789ab@deleted.invalid';

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
      auth: {
        admin: {
          listUsers: async () => ({
            data: { users: [{ id: '99999999-9999-4999-8999-999999999999', email: 'deleted-0123456789ab@deleted.invalid' }] },
            error: null,
          }),
        },
      },
    }),
  };
});

const mockListRows = jest.fn();
jest.mock('@/lib/repositories/AdminTokenUsageAnalyticsRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/AdminTokenUsageAnalyticsRepository');
  return { ...actual, adminTokenUsageAnalyticsRepository: { listRowsAllAccountsInWindow: (...args: unknown[]) => mockListRows(...args) } };
});

import { GET } from '../route';

const row = {
  id: 'r1',
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
  feature: 'business-os-chat',
  component: 'BizQLPlanCache',
  endpoint: null,
  session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  input_tokens: 100,
  output_tokens: 50,
  cost_usd: '0.0012',
  success: true,
  error_code: null,
};

it('labels the closed account in the filter list and in the user grouping', async () => {
  mockGetUser.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' });
  mockListRows.mockResolvedValue({ data: [row], error: null });

  const response = await GET(
    new NextRequest('http://localhost/api/admin/token-usage/drill-down?scope=bos&groupBy=user&dateFrom=2026-09-01T00:00:00.000Z&dateTo=2026-09-08T00:00:00.000Z')
  );
  const text = await response.text();
  expect(response.status).toBe(200);
  expect(text).toContain('Deleted account 0123456789ab');
  expect(text).not.toContain(TOMBSTONE);
});
