/**
 * GET /api/admin/model-pricing/history (AI model price review slice 9): the
 * gate comes first, the strict query, the real builder over mocked
 * repositories, the response schema, no admin id in the body, no audit row (a
 * read), and no internal detail outside development.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));
const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = () => undefined;
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...args: unknown[]) => mockLogAndFlush(...args) }));
const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({ AuditTrailService: { getInstance: () => ({ log: mockAuditLog, flush: jest.fn() }) } }));
jest.mock('@/lib/ai/pricing', () => ({ isInputOnlyPricedModel: () => false }));

const mockTokenHistory = jest.fn();
jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({
  aiModelPricingRepository: { listHistoryExact: (...args: unknown[]) => mockTokenHistory(...args) },
}));
const mockImageHistory = jest.fn();
jest.mock('@/lib/repositories/AiModelImagePricingRepository', () => ({
  aiModelImagePricingRepository: { listHistoryExact: (...args: unknown[]) => mockImageHistory(...args) },
}));
const mockFindLines = jest.fn();
jest.mock('@/lib/repositories/AiPriceProposalRepository', () => ({
  aiPriceProposalRepository: { findAppliedLinesByIds: (...args: unknown[]) => mockFindLines(...args) },
}));
const mockFindBatches = jest.fn();
jest.mock('@/lib/repositories/AiPriceApplyRepository', () => ({
  aiPriceApplyRepository: { findBatchesByIds: (...args: unknown[]) => mockFindBatches(...args) },
}));
const mockRowEvents = jest.fn();
const mockSyncRuns = jest.fn();
jest.mock('@/lib/repositories/AuditTrailRepository', () => ({
  auditTrailRepository: {
    listAdminPricingRowEvents: (...args: unknown[]) => mockRowEvents(...args),
    listAdminPricingSyncRuns: (...args: unknown[]) => mockSyncRuns(...args),
  },
}));
const mockEmails = jest.fn();
jest.mock('@/lib/repositories/AdminUserRepository', () => ({
  adminUserRepository: { findEmailsByUserIds: (...args: unknown[]) => mockEmails(...args) },
}));

import { GET } from '../route';
import { PriceHistoryResponseSchema } from '@/lib/ai/pricing-research/priceHistorySchema';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const EDITOR = '22222222-2222-4222-8222-222222222222';
const URL_BASE = 'http://localhost/api/admin/model-pricing/history';
const get = (query: string) => new NextRequest(`${URL_BASE}${query}`);

const row = (over: Record<string, unknown>) => ({
  id: '00000000-0000-4000-8000-000000000001',
  provider: 'openai',
  model_name: 'gpt-4o-mini',
  input_cost_per_token: '0.00000015',
  output_cost_per_token: '0.0000006',
  cached_input_cost_per_token: null,
  effective_date: '2026-06-29',
  retired_date: null,
  created_at: '2026-06-29T10:00:00Z',
  proposal_id: null,
  proposal_line_id: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ id: ADMIN, email: 'admin@example.com' });
  mockIsAdmin.mockResolvedValue(true);
  mockTokenHistory.mockResolvedValue({ data: { rows: [row({})], truncated: false }, error: null });
  mockImageHistory.mockResolvedValue({ data: { rows: [], truncated: false }, error: null });
  mockFindLines.mockResolvedValue({ data: [], error: null });
  mockFindBatches.mockResolvedValue({ data: [], error: null });
  mockRowEvents.mockResolvedValue({
    data: {
      rows: [
        {
          id: 'e1',
          action: 'AI_PRICING_UPDATED',
          actor_id: EDITOR,
          user_id: EDITOR,
          created_at: '2026-09-25T10:00:00Z',
          entity_id: '00000000-0000-4000-8000-000000000001',
          changes: { after: { input_cost_per_token: 1.5e-7, output_cost_per_token: 6e-7 } },
          details: {},
        },
      ],
      reachedLimit: false,
    },
    error: null,
  });
  mockSyncRuns.mockResolvedValue({ data: { rows: [], reachedLimit: false }, error: null });
  mockEmails.mockResolvedValue({ data: [{ user_id: EDITOR, email: 'editor@example.com' }], error: null });
});

const anyRead = () =>
  [mockTokenHistory, mockImageHistory, mockFindLines, mockFindBatches, mockRowEvents, mockSyncRuns, mockEmails].some((m) => m.mock.calls.length > 0);

it('401 when signed out, before the query is read and before any repository call', async () => {
  mockGetUser.mockResolvedValue(null);
  expect((await GET(get('?kind=bad'))).status).toBe(401);
  expect(anyRead()).toBe(false);
});

it('403 when not an admin, before any repository call', async () => {
  mockIsAdmin.mockResolvedValue(false);
  expect((await GET(get('?kind=token&provider=openai&model=gpt-4o-mini'))).status).toBe(403);
  expect(anyRead()).toBe(false);
});

it.each([
  ['a missing kind', '?provider=openai&model=gpt-4o-mini'],
  ['an unknown key', '?kind=token&provider=openai&model=gpt-4o-mini&admin=1'],
  ['a provider outside the list', '?kind=token&provider=groq&model=llama'],
  ['a model failing the id rule', '?kind=token&provider=openai&model=GPT%204o'],
  ['a repeated key', '?kind=token&provider=openai&model=gpt-4o-mini&model=gpt-4o'],
  ['no query at all', ''],
])('400 for %s, before any repository call', async (_label, query) => {
  const response = await GET(get(query));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ success: false, code: 'invalid_input' });
  expect(anyRead()).toBe(false);
});

it('200 token history: the response schema holds, no admin id leaves the server, no audit row', async () => {
  const response = await GET(get('?kind=token&provider=openai&model=gpt-4o-mini'));
  expect(response.status).toBe(200);
  const body = await response.json();
  const parsed = PriceHistoryResponseSchema.safeParse(body);
  expect(parsed.success).toBe(true);
  expect(body.data.units[0].rows[0]).toMatchObject({
    status: 'current',
    provenance: { kind: 'audit', events: [{ action: 'updated', by: { kind: 'admin', email: 'editor@example.com' }, inputPer1m: '0.15', outputPer1m: '0.6' }] },
  });
  const text = JSON.stringify(body);
  expect(text).not.toContain(ADMIN);
  expect(text).not.toContain(EDITOR);
  expect(mockTokenHistory).toHaveBeenCalledWith({ provider: 'openai', modelName: 'gpt-4o-mini' });
  // The admin read context reaches the admin-only audit reads.
  expect(mockRowEvents.mock.calls[0][0]).toMatchObject({ adminId: ADMIN, correlationId: expect.any(String) });
  expect(mockLogAndFlush).not.toHaveBeenCalled();
  expect(mockAuditLog).not.toHaveBeenCalled();
});

it('200 image history, grouped by size and quality', async () => {
  mockImageHistory.mockResolvedValue({
    data: {
      rows: [
        { id: '00000000-0000-4000-8000-000000000051', provider: 'openai', model_name: 'gpt-image-1-mini', size: '1024x1024', quality: 'high', cost_per_image: '0.036', effective_date: '2026-10-01', retired_date: null, created_at: '2026-10-01T00:00:00Z', proposal_id: null, proposal_line_id: null },
        { id: '00000000-0000-4000-8000-000000000052', provider: 'openai', model_name: 'gpt-image-1-mini', size: '1024x1024', quality: 'low', cost_per_image: '0.005', effective_date: '2026-10-01', retired_date: null, created_at: '2026-10-01T00:00:00Z', proposal_id: null, proposal_line_id: null },
      ],
      truncated: false,
    },
    error: null,
  });
  mockRowEvents.mockResolvedValue({ data: { rows: [], reachedLimit: false }, error: null });
  const response = await GET(get('?kind=image&provider=openai&model=gpt-image-1-mini'));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(PriceHistoryResponseSchema.safeParse(body).success).toBe(true);
  expect(body.data.units.map((u: { quality: string }) => u.quality)).toEqual(['low', 'high']);
  expect(mockTokenHistory).not.toHaveBeenCalled();
});

it('200 with no units for a model with no stored row (never 404)', async () => {
  mockTokenHistory.mockResolvedValue({ data: { rows: [], truncated: false }, error: null });
  const response = await GET(get('?kind=token&provider=anthropic&model=claude-sonnet-4-6'));
  expect(response.status).toBe(200);
  expect((await response.json()).data.units).toEqual([]);
});

it.each([
  ['the rows', () => mockTokenHistory.mockResolvedValue({ data: null, error: new Error('relation secret_table does not exist') })],
  ['the admin name lookup', () => mockEmails.mockResolvedValue({ data: null, error: new Error('relation secret_table does not exist') })],
])('500 with no internal detail outside development when %s cannot be read', async (_label, arrange) => {
  arrange();
  const response = await GET(get('?kind=token&provider=openai&model=gpt-4o-mini'));
  expect(response.status).toBe(500);
  const text = JSON.stringify(await response.json());
  expect(text).not.toContain('secret_table');
  expect(text).toContain('The price history could not be loaded.');
});
