/**
 * T0-5 (Layer 2 Step 0, AC-1) for POST /api/admin/system-config/pricing/sync.
 *
 * The gate runs before any Supabase call, so an anonymous or non-admin request
 * cannot rewrite the pricing table; an admin's sync still runs.
 */

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
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = () => undefined;
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

/**
 * A repository double (T0.13): `syncMany` records that the pricing entity was
 * touched and reports every catalogue entry as created, which is what the real
 * repository does when no row exists yet. `mockOps.length === 0` is still the
 * proof that a refused request never reached the data layer.
 */
type SyncEntry = { model_name: string };
const mockOps: Array<{ table: string; chain: string[] }> = [];
const syncManyResult: { error: Error | null } = { error: null };

jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({
  aiModelPricingRepository: {
    syncMany: async (entries: SyncEntry[]) => {
      mockOps.push({ table: 'ai_model_pricing', chain: ['syncMany'] });
      if (syncManyResult.error) return { data: null, error: syncManyResult.error };
      return {
        data: { updated: [], created: entries.map((e) => e.model_name), failed: [] },
        error: null,
      };
    },
  },
}));

const logAIPricingSynced = jest.fn();
jest.mock('@/lib/audit/admin-helpers', () => ({
  logAIPricingSynced: (...args: unknown[]) => logAIPricingSynced(...args),
}));

import { POST } from '../route';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@example.com' };

function syncRequest() {
  return new NextRequest('http://localhost/api/admin/system-config/pricing/sync', {
    method: 'POST',
    headers: { 'x-correlation-id': 'corr-test' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOps.length = 0;
  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
  logAIPricingSynced.mockResolvedValue(undefined);
  syncManyResult.error = null;
});

describe('POST /api/admin/system-config/pricing/sync', () => {
  it('returns 401 when signed out, with no Supabase call', async () => {
    getUser.mockResolvedValue(null);

    const response = await POST(syncRequest());

    expect(response.status).toBe(401);
    expect(mockOps).toHaveLength(0);
  });

  it('returns 403 for a non-admin, with no Supabase call', async () => {
    isAdmin.mockResolvedValue(false);

    const response = await POST(syncRequest());

    expect(response.status).toBe(403);
    expect(mockOps).toHaveLength(0);
  });

  it('fails closed with 403 when the admin check throws', async () => {
    isAdmin.mockRejectedValue(new Error('admin_users unreachable'));

    const response = await POST(syncRequest());

    expect(response.status).toBe(403);
    expect(mockOps).toHaveLength(0);
  });

  it('runs the sync for an admin', async () => {
    const response = await POST(syncRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.created.length).toBeGreaterThan(0);
    expect(body.data.failed).toHaveLength(0);
    expect(mockOps.every((op) => op.table === 'ai_model_pricing')).toBe(true);
  });

  // S-1: the sync rewrites every pricing row, so it must be attributable.
  it('writes one audit entry carrying the admin user id and the counts', async () => {
    const response = await POST(syncRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(logAIPricingSynced).toHaveBeenCalledTimes(1);
    expect(logAIPricingSynced).toHaveBeenCalledWith(ADMIN.id, {
      models_updated: body.data.updated.length,
      models_added: body.data.created.length,
      source: 'admin_catalog_sync',
    });
  });

  it('still returns 200 when the audit entry fails (non-blocking)', async () => {
    logAIPricingSynced.mockRejectedValue(new Error('audit_trail unreachable'));

    const response = await POST(syncRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  it('returns 500 with no internal error text when the sync fails, and writes no audit entry', async () => {
    syncManyResult.error = new Error('permission denied for table ai_model_pricing');

    const response = await POST(syncRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('permission denied');
    expect(logAIPricingSynced).not.toHaveBeenCalled();
  });

  it('writes no audit entry when the gate denies the request', async () => {
    isAdmin.mockResolvedValue(false);

    const response = await POST(syncRequest());

    expect(response.status).toBe(403);
    expect(logAIPricingSynced).not.toHaveBeenCalled();
  });
});
