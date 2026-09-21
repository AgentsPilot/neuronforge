/**
 * T0-1, T0-2, T0-3 (Layer 2 Step 0, AC-1) for GET / PUT /api/admin/system-config.
 *
 * The gate runs before any data access (401 → 403, fail closed), the body is
 * Zod-validated, `bos_llm_area_*` keys are refused, data access goes through the
 * repository, no internal error text leaves the server outside development, and
 * POST no longer exists (Next.js answers 405).
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (u: unknown) => isAdmin(u) }) },
}));

const logs: Array<{ level: string; ctx: unknown; msg: unknown }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (ctx: unknown, msg: unknown) => logs.push({ level, ctx, msg });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const getAll = jest.fn();
const setMultiple = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => ({
  systemConfigRepository: {
    getAll: (...a: unknown[]) => getAll(...a),
    setMultiple: (...a: unknown[]) => setMultiple(...a),
  },
}));

// Any direct database access from the route would land here.
const directDb = jest.fn(() => {
  throw new Error('direct database access');
});
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { from: () => directDb(), rpc: () => directDb() },
  createServerSupabaseClient: jest.fn(),
}));

import * as route from '../route';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@example.com' };
const SETTINGS = [{ key: 'payment_grace_period_days', value: 7, category: 'billing' }];

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/system-config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-test' },
    body: JSON.stringify(body),
  });
}

/** For payloads a JS object literal cannot express, such as an own `__proto__` key. */
function rawPutRequest(json: string) {
  return new NextRequest('http://localhost/api/admin/system-config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-test' },
    body: json,
  });
}

function getRequest() {
  return new NextRequest('http://localhost/api/admin/system-config', {
    method: 'GET',
    headers: { 'x-correlation-id': 'corr-test' },
  });
}

function dataCalls() {
  return getAll.mock.calls.length + setMultiple.mock.calls.length;
}

beforeEach(() => {
  jest.clearAllMocks();
  logs.length = 0;
  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
  getAll.mockResolvedValue({ data: SETTINGS, error: null });
  setMultiple.mockResolvedValue({ data: [], error: null });
});

describe('admin gate (T0-1)', () => {
  it('GET and PUT return 401 when signed out, and touch no data', async () => {
    getUser.mockResolvedValue(null);

    const get = await route.GET(getRequest());
    const put = await route.PUT(putRequest({ updates: { payment_grace_period_days: 7 } }));

    expect(get.status).toBe(401);
    expect(put.status).toBe(401);
    expect(dataCalls()).toBe(0);
  });

  it('GET and PUT return 403 for a non-admin, and touch no data', async () => {
    isAdmin.mockResolvedValue(false);

    const get = await route.GET(getRequest());
    const put = await route.PUT(putRequest({ updates: { payment_grace_period_days: 7 } }));

    expect(get.status).toBe(403);
    expect(put.status).toBe(403);
    expect(dataCalls()).toBe(0);
  });

  it('fails closed with 403 when the admin check throws', async () => {
    isAdmin.mockRejectedValue(new Error('admin_users unreachable'));

    const get = await route.GET(getRequest());
    const put = await route.PUT(putRequest({ updates: { payment_grace_period_days: 7 } }));

    expect(get.status).toBe(403);
    expect(put.status).toBe(403);
    expect(dataCalls()).toBe(0);
  });

  it('GET returns the unchanged { success, data } shape for an admin', async () => {
    const response = await route.GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: SETTINGS });
    expect(getAll).toHaveBeenCalledTimes(1);
  });
});

describe('PUT validation and reserved keys (T0-2)', () => {
  it.each([
    ['no updates key', {}],
    ['updates is an array', { updates: [] }],
    ['updates is null', { updates: null }],
    ['zero keys', { updates: {} }],
    ['an empty key', { updates: { '': 1 } }],
    [
      '51 keys',
      { updates: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i])) },
    ],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const response = await route.PUT(putRequest(body));

    expect(response.status).toBe(400);
    expect(setMultiple).not.toHaveBeenCalled();
  });

  it('refuses bos_llm_area_* keys with 400 and writes nothing', async () => {
    const response = await route.PUT(
      putRequest({ updates: { bos_llm_area_chat: { enabled: false } } })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('bos_llm_area_*'),
    });
    expect(setMultiple).not.toHaveBeenCalled();
  });

  it.each([
    ['an upper-case variant', 'BOS_LLM_AREA_chat'],
    ['a mixed-case variant', 'Bos_Llm_Area_Chat'],
    ['a padded key', ' bos_llm_area_chat'],
    ['a trailing-space key', 'bos_llm_area_chat '],
  ])('refuses %s of a reserved key with 400 and writes nothing (S-2)', async (_label, key) => {
    const response = await route.PUT(putRequest({ updates: { [key]: { enabled: false } } }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('bos_llm_area_*'),
    });
    expect(setMultiple).not.toHaveBeenCalled();
  });

  // D-Q1: the ASCII-only check let invisible and look-alike variants through.
  it.each([
    ['a zero-width-space prefix', '\u200Bbos_llm_area_chat'],
    ['a full-width b', '\uFF42os_llm_area_chat'],
    ['a soft hyphen inside the prefix', 'bos_llm\u00AD_area_chat'],
  ])('refuses %s of a reserved key with 400 and writes nothing (D-Q1)', async (_label, key) => {
    const response = await route.PUT(putRequest({ updates: { [key]: { enabled: false } } }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('bos_llm_area_*'),
    });
    expect(setMultiple).not.toHaveBeenCalled();
  });

  it('refuses a Cyrillic look-alike key with 400 and writes nothing (D-Q1)', async () => {
    // `\u043E` does not fold to ASCII `o`, so the charset rule is what stops it.
    const response = await route.PUT(
      putRequest({ updates: { ['b\u043Es_llm_area_chat']: { enabled: false } } })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('letters, digits'),
    });
    expect(setMultiple).not.toHaveBeenCalled();
  });

  // D-Q2: the key vanished into the object's prototype and the route said "saved".
  it('refuses a body whose key cannot be stored, instead of reporting success', async () => {
    // Written as raw JSON: a `{ __proto__: … }` object literal sets the prototype
    // instead of creating the key, so JSON.stringify would never emit it.
    const response = await route.PUT(
      rawPutRequest('{"updates":{"__proto__":1,"payment_grace_period_days":7}}')
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('__proto__'),
    });
    expect(setMultiple).not.toHaveBeenCalled();
  });

  it('refuses a padded non-reserved key with 400 and writes nothing (S-2)', async () => {
    const response = await route.PUT(putRequest({ updates: { ' payment_grace_period_days': 7 } }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('whitespace'),
    });
    expect(setMultiple).not.toHaveBeenCalled();
  });

  it('refuses a mixed body that contains one reserved key', async () => {
    const response = await route.PUT(
      putRequest({ updates: { payment_grace_period_days: 7, bos_llm_area_leads: {} } })
    );

    expect(response.status).toBe(400);
    expect(setMultiple).not.toHaveBeenCalled();
  });

  it('passes a mixed-type billing body to the repository unchanged', async () => {
    const updates = {
      payment_grace_period_days: 7,
      some_flag: true,
      some_label: 'text',
      some_object: { a: 1 },
    };

    const response = await route.PUT(putRequest({ updates }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'Configuration updated successfully',
    });
    expect(setMultiple).toHaveBeenCalledWith(updates);
  });

  it('logs the keys but never the values', async () => {
    await route.PUT(putRequest({ updates: { some_secret_key: 'sk-live-do-not-log' } }));

    expect(JSON.stringify(logs)).not.toContain('sk-live-do-not-log');
  });

  it('returns 500 with no internal error text when the repository fails', async () => {
    setMultiple.mockResolvedValue({ data: null, error: new Error('relation does not exist') });

    const response = await route.PUT(putRequest({ updates: { payment_grace_period_days: 7 } }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('relation does not exist');
    expect(body).toEqual({ success: false, error: 'Failed to update system configuration' });
  });

  it('returns 500 with no internal error text when the GET read fails', async () => {
    getAll.mockResolvedValue({ data: null, error: new Error('permission denied for table') });

    const response = await route.GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('permission denied');
  });
});

describe('POST is gone (T0-3)', () => {
  it('exports no POST handler, so Next.js answers 405', () => {
    expect((route as Record<string, unknown>).POST).toBeUndefined();
    expect(Object.keys(route).sort()).toEqual(['GET', 'PUT', 'dynamic', 'runtime']);
  });
});
