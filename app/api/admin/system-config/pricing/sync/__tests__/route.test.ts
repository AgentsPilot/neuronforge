/**
 * T0-5 (Layer 2 Step 0, AC-1) for POST /api/admin/system-config/pricing/sync.
 *
 * The gate runs before any Supabase call, so an anonymous or non-admin request
 * cannot rewrite the pricing table; an admin's sync still runs.
 *
 * SF-1 to SF-4 (AI_MODEL_PRICE_REVIEW slice 1, MP-FR-1 / AB-5, WC-7): the
 * queued audit entry is flushed before the response, and a failed flush never
 * changes the answer.
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (u: unknown) => isAdmin(u) }) },
}));

const logs: Array<{ level: string; context: unknown; message: unknown }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (context: unknown, message: unknown) => {
        logs.push({ level, context, message });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

/**
 * As in `../../__tests__/route.test.ts`: `flush` resolves one macrotask later
 * and records `flush:start` / `flush:end`, so a handler that only fired it
 * (`void auditTrail.flush()`) would return before `flush:end`. The route takes
 * the singleton at module load, so `getInstance` returns a stable object that
 * delegates to the per-test `mockFlush`.
 */
const mockEvents: string[] = [];
const mockFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({ flush: () => mockFlush() }),
  },
}));

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
  logAIPricingSynced.mockImplementation(async () => {
    mockEvents.push('synced');
  });
  syncManyResult.error = null;
  logs.length = 0;
  mockEvents.length = 0;
  mockFlush.mockImplementation(async () => {
    mockEvents.push('flush:start');
    await new Promise((resolve) => setImmediate(resolve));
    mockEvents.push('flush:end');
  });
});

describe('POST /api/admin/system-config/pricing/sync', () => {
  it('returns 401 when signed out, with no Supabase call', async () => {
    getUser.mockResolvedValue(null);

    const response = await POST(syncRequest());

    expect(response.status).toBe(401);
    expect(mockOps).toHaveLength(0);
    // The gate's own refusal audit is requireAdmin's logAndFlush, not this flush.
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin, with no Supabase call', async () => {
    isAdmin.mockResolvedValue(false);

    const response = await POST(syncRequest());

    expect(response.status).toBe(403);
    expect(mockOps).toHaveLength(0);
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it('fails closed with 403 when the admin check throws', async () => {
    isAdmin.mockRejectedValue(new Error('admin_users unreachable'));

    const response = await POST(syncRequest());

    expect(response.status).toBe(403);
    expect(mockOps).toHaveLength(0);
    expect(mockFlush).not.toHaveBeenCalled();
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

  // SF-3: a rejected audit call never skips the flush or changes the status.
  it('still returns 200 when the audit entry fails (non-blocking), and still flushes', async () => {
    logAIPricingSynced.mockRejectedValue(new Error('audit_trail unreachable'));

    const response = await POST(syncRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  // SF-4
  it('returns 500 with no internal error text when the sync fails, and writes no audit entry', async () => {
    syncManyResult.error = new Error('permission denied for table ai_model_pricing');

    const response = await POST(syncRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('permission denied');
    expect(logAIPricingSynced).not.toHaveBeenCalled();
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it('writes no audit entry when the gate denies the request', async () => {
    isAdmin.mockResolvedValue(false);

    const response = await POST(syncRequest());

    expect(response.status).toBe(403);
    expect(logAIPricingSynced).not.toHaveBeenCalled();
    expect(mockFlush).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/system-config/pricing/sync: audit flush (MP-FR-1, WC-7)', () => {
  it('SF-1: flushes once, after the audit entry and before it responds', async () => {
    const response = await POST(syncRequest());

    expect(response.status).toBe(200);
    // `flush:end` is already recorded when the handler resolves: awaited, not fired.
    expect(mockEvents).toEqual(['synced', 'flush:start', 'flush:end']);
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it('SF-2: a rejected flush still answers 200 with the unchanged body, and is logged', async () => {
    mockFlush.mockRejectedValue(new Error('audit_trail unreachable'));

    const response = await POST(syncRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Object.keys(body).sort()).toEqual(['data', 'message', 'success']);
    expect(Object.keys(body.data).sort()).toEqual(['created', 'failed', 'total', 'updated']);
    expect(
      logs.some(
        (entry) =>
          entry.level === 'error' &&
          entry.message === 'Audit flush failed' &&
          (entry.context as { err?: unknown })?.err instanceof Error
      )
    ).toBe(true);
  });
});
