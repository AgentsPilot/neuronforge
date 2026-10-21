/**
 * POST /api/admin/model-pricing/dismiss (AI model price review slice 8).
 * Gate first; strict Zod (ids and a reason, never pre-filled by the server);
 * 404/409 before the function; database refusals mapped; one audit entry per
 * line in one logAndFlush call before the response.
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
    const logger: Record<string, unknown> = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
const order: string[] = [];
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...args: unknown[]) => {
    order.push('audit');
    return mockLogAndFlush(...args);
  },
}));
const mockFindLines = jest.fn();
const mockDismiss = jest.fn();
jest.mock('@/lib/repositories/AiPriceProposalRepository', () => ({
  aiPriceProposalRepository: {
    findLinesForDecision: (...args: unknown[]) => mockFindLines(...args),
    dismissLines: (...args: unknown[]) => {
      order.push('dismiss');
      return mockDismiss(...args);
    },
  },
}));

import { POST } from '../route';

const LINE_A = '11111111-1111-4111-8111-111111111111';

function post(body: unknown, raw?: string): NextRequest {
  return new NextRequest('http://localhost/api/admin/model-pricing/dismiss', {
    method: 'POST',
    body: raw ?? JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  mockGetUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
  mockIsAdmin.mockResolvedValue(true);
  mockFindLines.mockResolvedValue({
    data: [{ id: LINE_A, proposal_id: 'proposal-1', kind: 'token', provider: 'openai', model_name: 'example-model', image_size: null, image_quality: null, source_url: 'https://developers.openai.com/api/docs/pricing', state: 'pending', created_by: 'submitter-1', flags: [] }],
    error: null,
  });
  mockDismiss.mockResolvedValue({ data: [{ lineId: LINE_A, decidedAt: '2026-10-17T10:00:00.000Z' }], error: null });
  mockLogAndFlush.mockResolvedValue(undefined);
});

it('401 when signed out and 403 when not an admin: the body is never read', async () => {
  mockGetUser.mockResolvedValueOnce(null);
  const first = post({ lineIds: [LINE_A], reason: 'not needed' });
  const json = jest.spyOn(first, 'json');
  expect((await POST(first)).status).toBe(401);
  mockIsAdmin.mockResolvedValueOnce(false);
  expect((await POST(post({ lineIds: [LINE_A], reason: 'not needed' }))).status).toBe(403);
  expect(json).not.toHaveBeenCalled();
  expect(mockDismiss).not.toHaveBeenCalled();
});

it.each([
  ['not JSON', undefined, '{'],
  ['no reason', { lineIds: [LINE_A] }, undefined],
  ['a reason too short', { lineIds: [LINE_A], reason: 'no' }, undefined],
  ['no lines', { lineIds: [], reason: 'not needed' }, undefined],
  ['an injected admin id', { lineIds: [LINE_A], reason: 'not needed', adminUserId: 'x' }, undefined],
])('400 for %s, before any read', async (_label, body, raw) => {
  const response = await POST(post(body, raw));
  expect(response.status).toBe(400);
  expect((await response.json()).code).toBe('invalid_input');
  expect(mockFindLines).not.toHaveBeenCalled();
});

it('404 for an unknown line and 409 for a decided one, before the function', async () => {
  mockFindLines.mockResolvedValueOnce({ data: [], error: null });
  expect((await POST(post({ lineIds: [LINE_A], reason: 'not needed' }))).status).toBe(404);
  mockFindLines.mockResolvedValueOnce({ data: [{ id: LINE_A, state: 'applied' }], error: null });
  expect((await POST(post({ lineIds: [LINE_A], reason: 'not needed' }))).status).toBe(409);
  expect(mockDismiss).not.toHaveBeenCalled();
});

it.each([
  ['P8001', 409, 'not_pending'],
  ['55P03', 409, 'busy'],
  ['42501', 403, 'not_admin_row'],
])('database %s → %s %s', async (code, status, answer) => {
  mockDismiss.mockResolvedValue({ data: null, error: Object.assign(new Error('refused'), { code }) });
  const response = await POST(post({ lineIds: [LINE_A], reason: 'not needed' }));
  expect(response.status).toBe(status);
  expect((await response.json()).code).toBe(answer);
  expect(mockLogAndFlush).not.toHaveBeenCalled();
});

it('R06b: a rejected audit flush is caught; the dismissal stands and answers 200', async () => {
  mockLogAndFlush.mockRejectedValue(new Error('flush failed'));
  const response = await POST(post({ lineIds: [LINE_A], reason: 'Wrong table on the page' }));
  expect(response.status).toBe(200);
});

it('dismisses with the session admin id and the trimmed reason, audits once, then answers', async () => {
  const response = await POST(post({ lineIds: [LINE_A], reason: '  Wrong table on the page  ' }));
  expect(response.status).toBe(200);
  expect(mockDismiss).toHaveBeenCalledWith({ adminUserId: 'admin-1', lineIds: [LINE_A], reason: 'Wrong table on the page' });
  expect(order).toEqual(['dismiss', 'audit']);
  const [entries] = mockLogAndFlush.mock.calls[0];
  expect(entries).toEqual([
    expect.objectContaining({
      action: 'AI_PRICE_LINE_DISMISSED',
      entityId: LINE_A,
      severity: 'info',
      details: expect.objectContaining({ entity_kind: 'price_line', reason: 'Wrong table on the page', dismissed_by: 'admin-1' }),
    }),
  ]);
});
