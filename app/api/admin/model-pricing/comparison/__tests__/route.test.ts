/**
 * GET /api/admin/model-pricing/comparison (AI model price review slice 3):
 * the gate comes first, no query parameter is accepted, read-only (no audit),
 * no internal detail leaves the server.
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
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...args: unknown[]) => mockLogAndFlush(...args) }));

const mockBuildComparison = jest.fn();
jest.mock('@/lib/ai/pricing-research/comparisonModel', () => ({
  buildComparison: () => mockBuildComparison(),
}));

import { GET } from '../route';

const get = (query = '') => new NextRequest(`http://localhost/api/admin/model-pricing/comparison${query}`);
const MODEL = { generatedAt: '2026-10-14T00:00:00.000Z', embedding: { status: 'not_set', label: 'x' }, rows: [] };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
  mockIsAdmin.mockResolvedValue(true);
  mockBuildComparison.mockResolvedValue(MODEL);
});

it('401 when signed out, before any read', async () => {
  mockGetUser.mockResolvedValue(null);
  expect((await GET(get())).status).toBe(401);
  expect(mockBuildComparison).not.toHaveBeenCalled();
});

it('403 when not an admin, before any read', async () => {
  mockIsAdmin.mockResolvedValue(false);
  expect((await GET(get())).status).toBe(403);
  expect(mockBuildComparison).not.toHaveBeenCalled();
});

it('400 on any query parameter', async () => {
  const response = await GET(get('?provider=openai'));
  expect(response.status).toBe(400);
  expect(mockBuildComparison).not.toHaveBeenCalled();
});

it('200 with the comparison model, and no audit row (a read)', async () => {
  const response = await GET(get());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, data: MODEL });
  expect(mockLogAndFlush).not.toHaveBeenCalled();
});

it('500 with no internal detail outside development', async () => {
  mockBuildComparison.mockRejectedValue(new Error('relation secret_table does not exist'));
  const response = await GET(get());
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('secret_table');
});
