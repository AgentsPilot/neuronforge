/**
 * /api/admin/system-config/pricing (T0-4, Layer 2 Step 0, AC-1; AI model price
 * review slice 6).
 *
 * Since slice 6 (MP-FR-11, Q9) the route is read-only: GET only. The gate runs
 * before any repository call, and no internal error text leaves the server
 * outside development. RG-1..RG-3 pin that the removed write handlers and the
 * Sync route stay gone (Next.js answers 405 to an unexported method, and the
 * deleted Sync path is a plain 404).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (u: unknown) => isAdmin(u) }) },
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = () => undefined;
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

/**
 * A repository double: every call records itself and takes the next queued
 * result. `mockOps.length === 0` is the proof that a refused request touched
 * the data layer not at all.
 */
type QueryResult = { data: unknown; error: unknown };
const mockOps: string[] = [];
const mockResults: QueryResult[] = [];

jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({
  aiModelPricingRepository: {
    listAll: async () => {
      mockOps.push('listAll');
      const r = mockResults.shift() ?? { data: [], error: null };
      return { data: r.error ? null : ((r.data as unknown[]) ?? []), error: r.error };
    },
  },
}));

import * as routeModule from '../route';
import { GET } from '../route';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@example.com' };
const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  provider: 'openai',
  model_name: 'gpt-4o-mini',
  input_cost_per_token: 0.00000015,
  output_cost_per_token: 0.0000006,
};

const ROUTE_DIR = join(process.cwd(), 'app/api/admin/system-config/pricing');

function request() {
  return new NextRequest('http://localhost/api/admin/system-config/pricing', {
    method: 'GET',
    headers: { 'x-correlation-id': 'corr-test' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOps.length = 0;
  mockResults.length = 0;
  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
});

describe('admin gate', () => {
  it('returns 401 when signed out, with no repository call', async () => {
    getUser.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mockOps).toHaveLength(0);
  });

  it('returns 403 for a non-admin, with no repository call', async () => {
    isAdmin.mockResolvedValue(false);
    expect((await GET(request())).status).toBe(403);
    expect(mockOps).toHaveLength(0);
  });

  it('fails closed with 403 when the admin check throws', async () => {
    isAdmin.mockRejectedValue(new Error('admin_users unreachable'));
    expect((await GET(request())).status).toBe(403);
    expect(mockOps).toHaveLength(0);
  });
});

describe('GET', () => {
  it('returns the unchanged { success, data } shape', async () => {
    mockResults.push({ data: [ROW], error: null });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: [ROW] });
    expect(mockOps).toEqual(['listAll']);
  });

  it('returns 500 with no internal error text when the query fails', async () => {
    mockResults.push({ data: null, error: new Error('permission denied for table ai_model_pricing') });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('permission denied');
    expect(body).toEqual({ success: false, error: 'Failed to fetch pricing information' });
  });
});

describe('slice 6: the write handlers and Sync are gone (MP-FR-11)', () => {
  it('RG-1: the module exports GET and no other HTTP method', () => {
    const verbs = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'];
    const exported = verbs.filter((verb) => verb in routeModule);
    expect(exported).toEqual(['GET']);
  });

  it('RG-2: the Sync route folder does not exist', () => {
    expect(existsSync(join(ROUTE_DIR, 'sync'))).toBe(false);
  });

  it('RG-3: the route writes no audit, holds no client, and calls only listAll', () => {
    const source = readFileSync(join(ROUTE_DIR, 'route.ts'), 'utf8');
    expect(source).not.toContain('logAIPricing');
    expect(source).not.toContain('AuditTrailService');
    expect(source).not.toContain('@supabase/supabase-js');
    const methods = [...source.matchAll(/aiModelPricingRepository[.]([A-Za-z]+)/g)].map((m) => m[1]);
    expect(new Set(methods)).toEqual(new Set(['listAll']));
  });
});
