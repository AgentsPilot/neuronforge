/**
 * T0-4 (Layer 2 Step 0, AC-1) for /api/admin/system-config/pricing.
 *
 * The gate runs before any Supabase call on all four methods, bodies are
 * Zod-validated (including PUT's "at least one cost field" rule), the audit
 * entries carry the acting admin's id and cannot 500 a write that already
 * succeeded (RC-W10), and no internal error text leaves the server outside
 * development.
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

const logAIPricingCreated = jest.fn();
const logAIPricingUpdated = jest.fn();
const logAIPricingDeleted = jest.fn();
const logAIPricingZeroCost = jest.fn();
jest.mock('@/lib/audit/admin-helpers', () => ({
  logAIPricingCreated: (...a: unknown[]) => logAIPricingCreated(...a),
  logAIPricingUpdated: (...a: unknown[]) => logAIPricingUpdated(...a),
  logAIPricingDeleted: (...a: unknown[]) => logAIPricingDeleted(...a),
  logAIPricingZeroCost: (...a: unknown[]) => logAIPricingZeroCost(...a),
}));

/**
 * A repository double (T0.13): every call records the entity it touched and takes
 * the next queued result, translated through the repository's own contract —
 * `findById`/`updateCosts` give `null` data for "no such row", `deleteById` gives
 * a boolean. `mockOps.length === 0` is still the proof that a refused request
 * touched the data layer not at all.
 *
 * The route no longer constructs a Supabase client, so there is nothing left to
 * mock at `@supabase/supabase-js`; a static test asserts that stays true.
 */
type QueryResult = { data: unknown; error: unknown };
const mockOps: Array<{ table: string; chain: string[] }> = [];
const mockResults: QueryResult[] = [];

function nextResult(method: string): QueryResult {
  mockOps.push({ table: 'ai_model_pricing', chain: [method] });
  return mockResults.shift() ?? { data: null, error: null };
}

jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({
  aiModelPricingRepository: {
    listAll: async () => {
      const r = nextResult('listAll');
      return { data: r.error ? null : ((r.data as unknown[]) ?? []), error: r.error };
    },
    findById: async () => {
      const r = nextResult('findById');
      return { data: r.error ? null : (r.data ?? null), error: r.error };
    },
    create: async () => {
      const r = nextResult('create');
      return { data: r.error ? null : r.data, error: r.error };
    },
    updateCosts: async (...args: unknown[]) => {
      const r = nextResult('updateCosts');
      updateCostsArgs.push(args);
      return { data: r.error ? null : (r.data ?? null), error: r.error };
    },
    deleteById: async () => {
      const r = nextResult('deleteById');
      return {
        data: r.error ? null : ((r.data as unknown[] | null)?.length ?? 0) > 0,
        error: r.error,
      };
    },
  },
}));

const updateCostsArgs: unknown[][] = [];

import { GET, PUT, POST, DELETE } from '../route';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@example.com' };
const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  provider: 'openai',
  model_name: 'gpt-4o-mini',
  input_cost_per_token: 0.00000015,
  output_cost_per_token: 0.0000006,
};

function request(method: string, body?: unknown, query = '') {
  return new NextRequest(`http://localhost/api/admin/system-config/pricing${query}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-test' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOps.length = 0;
  mockResults.length = 0;
  updateCostsArgs.length = 0;
  logs.length = 0;
  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
  logAIPricingCreated.mockResolvedValue(undefined);
  logAIPricingUpdated.mockResolvedValue(undefined);
  logAIPricingDeleted.mockResolvedValue(undefined);
  logAIPricingZeroCost.mockResolvedValue(undefined);
});

describe('admin gate on every method', () => {
  it('returns 401 when signed out, with no Supabase call', async () => {
    getUser.mockResolvedValue(null);

    const responses = await Promise.all([
      GET(request('GET')),
      PUT(request('PUT', { id: ROW.id, input_cost_per_token: 1 })),
      POST(
        request('POST', {
          provider: 'openai',
          model_name: 'm',
          input_cost_per_token: 1,
          output_cost_per_token: 1,
        })
      ),
      DELETE(request('DELETE', undefined, `?id=${ROW.id}`)),
    ]);

    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    expect(mockOps).toHaveLength(0);
  });

  it('returns 403 for a non-admin, with no Supabase call', async () => {
    isAdmin.mockResolvedValue(false);

    const responses = await Promise.all([
      GET(request('GET')),
      PUT(request('PUT', { id: ROW.id, input_cost_per_token: 1 })),
      POST(
        request('POST', {
          provider: 'openai',
          model_name: 'm',
          input_cost_per_token: 1,
          output_cost_per_token: 1,
        })
      ),
      DELETE(request('DELETE', undefined, `?id=${ROW.id}`)),
    ]);

    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(mockOps).toHaveLength(0);
  });

  it('fails closed with 403 when the admin check throws', async () => {
    isAdmin.mockRejectedValue(new Error('admin_users unreachable'));

    const response = await DELETE(request('DELETE', undefined, `?id=${ROW.id}`));

    expect(response.status).toBe(403);
    expect(mockOps).toHaveLength(0);
  });
});

describe('validation', () => {
  it('rejects a PUT with neither cost field', async () => {
    const response = await PUT(request('PUT', { id: ROW.id }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'At least one cost field must be provided',
    });
    expect(mockOps).toHaveLength(0);
  });

  it.each([
    ['no id', { input_cost_per_token: 1 }],
    ['a negative cost', { id: ROW.id, input_cost_per_token: -1 }],
    ['a non-numeric cost', { id: ROW.id, input_cost_per_token: '1' }],
  ])('rejects a PUT with %s', async (_label, body) => {
    const response = await PUT(request('PUT', body));

    expect(response.status).toBe(400);
    expect(mockOps).toHaveLength(0);
  });

  it('accepts a PUT with only one cost field', async () => {
    mockResults.push({ data: ROW, error: null }, { data: { ...ROW, input_cost_per_token: 2 }, error: null });

    const response = await PUT(request('PUT', { id: ROW.id, input_cost_per_token: 2 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  it.each([
    ['missing fields', { provider: 'openai' }],
    ['an empty model name', { provider: 'openai', model_name: '', input_cost_per_token: 1, output_cost_per_token: 1 }],
    [
      'a non-ISO effective_date',
      {
        provider: 'openai',
        model_name: 'm',
        input_cost_per_token: 1,
        output_cost_per_token: 1,
        effective_date: 'yesterday',
      },
    ],
  ])('rejects a POST with %s', async (_label, body) => {
    const response = await POST(request('POST', body));

    expect(response.status).toBe(400);
    expect(mockOps).toHaveLength(0);
  });

  it('rejects a DELETE with no id', async () => {
    const response = await DELETE(request('DELETE'));

    expect(response.status).toBe(400);
    expect(mockOps).toHaveLength(0);
  });

  // D-1: the live column is a uuid, so a mistyped id is a 400 here and never
  // reaches PostgREST (which answered 500 through `.single()`).
  it.each([
    ['a non-uuid string', 'not-a-uuid'],
    ['a numeric id', 12345],
  ])('rejects a PUT with %s', async (_label, id) => {
    const response = await PUT(request('PUT', { id, input_cost_per_token: 1 }));

    expect(response.status).toBe(400);
    expect(mockOps).toHaveLength(0);
  });

  it('rejects a DELETE with a non-uuid id', async () => {
    const response = await DELETE(request('DELETE', undefined, '?id=not-a-uuid'));

    expect(response.status).toBe(400);
    expect(mockOps).toHaveLength(0);
  });
});

describe('admin happy paths and audit (RC-W10)', () => {
  it('GET returns the unchanged { success, data } shape', async () => {
    mockResults.push({ data: [ROW], error: null });

    const response = await GET(request('GET'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: [ROW] });
    expect(mockOps[0]).toMatchObject({ table: 'ai_model_pricing' });
  });

  it('PUT updates and audits with the admin user id', async () => {
    const updated = { ...ROW, input_cost_per_token: 2, output_cost_per_token: 3 };
    mockResults.push({ data: ROW, error: null }, { data: updated, error: null });

    const response = await PUT(
      request('PUT', { id: ROW.id, input_cost_per_token: 2, output_cost_per_token: 3 })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: updated,
      message: 'Pricing updated successfully',
    });
    expect(logAIPricingUpdated).toHaveBeenCalledWith(ADMIN.id, ROW.id, ROW.model_name, {
      before: ROW,
      after: updated,
    });
  });

  it('POST creates and audits with the admin user id', async () => {
    mockResults.push({ data: ROW, error: null });

    const response = await POST(
      request('POST', {
        provider: 'openai',
        model_name: 'gpt-4o-mini',
        input_cost_per_token: 0.00000015,
        output_cost_per_token: 0.0000006,
      })
    );

    expect(response.status).toBe(200);
    expect(logAIPricingCreated).toHaveBeenCalledWith(ADMIN.id, expect.objectContaining({ id: ROW.id }));
  });

  it('DELETE deletes and audits with the admin user id', async () => {
    // Arrangement only (the repository reports the rows it deleted); the
    // assertions below are unchanged.
    mockResults.push({ data: ROW, error: null }, { data: [{ id: ROW.id }], error: null });

    const response = await DELETE(request('DELETE', undefined, `?id=${ROW.id}`));

    expect(response.status).toBe(200);
    expect(logAIPricingDeleted).toHaveBeenCalledWith(ADMIN.id, ROW.id, ROW.model_name, ROW);
  });

  it('still returns 200 when the audit call rejects', async () => {
    const updated = { ...ROW, input_cost_per_token: 2 };
    mockResults.push({ data: ROW, error: null }, { data: updated, error: null });
    logAIPricingUpdated.mockRejectedValue(new Error('audit_trail unreachable'));

    const response = await PUT(request('PUT', { id: ROW.id, input_cost_per_token: 2 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  // S-3: a missing row is the caller's mistake, not a server fault.
  it('PUT answers 404 when no row matched, and writes no audit entry', async () => {
    mockResults.push({ data: null, error: null }, { data: null, error: null });

    const response = await PUT(request('PUT', { id: ROW.id, input_cost_per_token: 2 }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Pricing row not found',
    });
    expect(logAIPricingUpdated).not.toHaveBeenCalled();
  });

  it('DELETE answers 404 when nothing was deleted, and writes no audit entry', async () => {
    mockResults.push({ data: null, error: null }, { data: [], error: null });

    const response = await DELETE(request('DELETE', undefined, `?id=${ROW.id}`));

    expect(response.status).toBe(404);
    expect(logAIPricingDeleted).not.toHaveBeenCalled();
  });

  it('returns 500 with no internal error text when the query fails', async () => {
    mockResults.push({ data: null, error: new Error('permission denied for table ai_model_pricing') });

    const response = await GET(request('GET'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('permission denied');
    expect(body).toEqual({ success: false, error: 'Failed to fetch pricing information' });
  });
});

// T0-9: a $0 price is allowed (user decision, 2026-09-20) but must be loud and
// attributable — an error-level log plus its own critical audit entry.
describe('zero-price policy (T0-9)', () => {
  const zeroRow = { ...ROW, input_cost_per_token: 0, output_cost_per_token: 0.0000006 };

  function zeroLogged(): boolean {
    return logs.some(
      (entry) =>
        entry.level === 'error' &&
        typeof entry.message === 'string' &&
        entry.message.includes('Zero price saved')
    );
  }

  it('PUT that saves a zero cost logs at error level and audits it with the admin id', async () => {
    mockResults.push({ data: ROW, error: null }, { data: zeroRow, error: null });

    const response = await PUT(request('PUT', { id: ROW.id, input_cost_per_token: 0 }));

    expect(response.status).toBe(200);
    expect(zeroLogged()).toBe(true);
    expect(logAIPricingZeroCost).toHaveBeenCalledWith(ADMIN.id, ROW.id, {
      provider: ROW.provider,
      model_name: ROW.model_name,
      input_cost_per_token: 0,
      output_cost_per_token: 0.0000006,
      source: 'update',
    });
    // The ordinary audit entry is still written.
    expect(logAIPricingUpdated).toHaveBeenCalledTimes(1);
  });

  it('POST that saves a zero cost logs at error level and audits it with the admin id', async () => {
    mockResults.push({ data: { ...zeroRow, output_cost_per_token: 0 }, error: null });

    const response = await POST(
      request('POST', {
        provider: 'openai',
        model_name: 'gpt-4o-mini',
        input_cost_per_token: 0,
        output_cost_per_token: 0,
      })
    );

    expect(response.status).toBe(200);
    expect(zeroLogged()).toBe(true);
    expect(logAIPricingZeroCost).toHaveBeenCalledWith(
      ADMIN.id,
      ROW.id,
      expect.objectContaining({ source: 'create', input_cost_per_token: 0 })
    );
  });

  it('a non-zero save produces neither the log nor the audit entry', async () => {
    const updated = { ...ROW, input_cost_per_token: 2, output_cost_per_token: 3 };
    mockResults.push({ data: ROW, error: null }, { data: updated, error: null });

    const response = await PUT(
      request('PUT', { id: ROW.id, input_cost_per_token: 2, output_cost_per_token: 3 })
    );

    expect(response.status).toBe(200);
    expect(zeroLogged()).toBe(false);
    expect(logAIPricingZeroCost).not.toHaveBeenCalled();
  });

  it('still returns 200 when the zero-price audit call rejects', async () => {
    mockResults.push({ data: ROW, error: null }, { data: zeroRow, error: null });
    logAIPricingZeroCost.mockRejectedValue(new Error('audit_trail unreachable'));

    const response = await PUT(request('PUT', { id: ROW.id, input_cost_per_token: 0 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  it('treats a numeric-as-string zero from PostgREST as zero', async () => {
    mockResults.push(
      { data: ROW, error: null },
      { data: { ...ROW, input_cost_per_token: '0' }, error: null }
    );

    const response = await PUT(request('PUT', { id: ROW.id, input_cost_per_token: 0 }));

    expect(response.status).toBe(200);
    expect(logAIPricingZeroCost).toHaveBeenCalledTimes(1);
  });
});
