/**
 * T-1 (slice F-1): GET / POST /api/admin/ui-config.
 *
 * The gate runs before any body read or data access; the body is validated
 * against the write schema; invalid tokens are refused by name without echoing
 * any value; writes go through the repository; every write is audited
 * non-blocking with names only; no internal error text leaves the server
 * outside development; GET returns the sanitized tokens (SA R-8).
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (u: unknown) => isAdmin(u) }) },
}));

jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn().mockResolvedValue(undefined) }));

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

const getByKeys = jest.fn();
const set = jest.fn();
const del = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => ({
  systemConfigRepository: {
    getByKeys: (...a: unknown[]) => getByKeys(...a),
    set: (...a: unknown[]) => set(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const auditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: (...a: unknown[]) => auditLog(...a) }) },
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
const URL = 'http://localhost/api/admin/ui-config';

function post(body: unknown) {
  return rawPost(JSON.stringify(body));
}

/** For payloads a JS object literal cannot express, such as an own `__proto__` key. */
function rawPost(json: string) {
  return new NextRequest(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-test' },
    body: json,
  });
}

function get() {
  return new NextRequest(URL, { method: 'GET', headers: { 'x-correlation-id': 'corr-test' } });
}

const dataCalls = () => getByKeys.mock.calls.length + set.mock.calls.length + del.mock.calls.length;

const ORIGINAL_ENV = process.env.NODE_ENV;
function setNodeEnv(value: string) {
  (process.env as Record<string, string>).NODE_ENV = value;
}

beforeEach(() => {
  jest.clearAllMocks();
  logs.length = 0;
  setNodeEnv(ORIGINAL_ENV ?? 'test');
  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
  getByKeys.mockResolvedValue({ data: [], error: null });
  set.mockResolvedValue({ data: {}, error: null });
  del.mockResolvedValue({ data: true, error: null });
  auditLog.mockResolvedValue(undefined);
});

afterAll(() => setNodeEnv(ORIGINAL_ENV ?? 'test'));

describe('admin gate', () => {
  it('GET and POST return 401 when signed out, and touch no data', async () => {
    getUser.mockResolvedValue(null);
    expect((await route.GET(get())).status).toBe(401);
    expect((await route.POST(post({ action: 'reset_tokens' }))).status).toBe(401);
    expect(dataCalls()).toBe(0);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('GET and POST return 403 for a non-admin, and touch no data', async () => {
    isAdmin.mockResolvedValue(false);
    expect((await route.GET(get())).status).toBe(403);
    expect((await route.POST(post({ action: 'reset_tokens' }))).status).toBe(403);
    expect(dataCalls()).toBe(0);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('does not read the body before the gate, by any method', async () => {
    getUser.mockResolvedValue(null);
    const request = post({ action: 'reset_tokens' });
    const readers = (['json', 'text', 'clone', 'arrayBuffer', 'formData', 'blob'] as const).map((m) =>
      jest.spyOn(request, m)
    );
    await route.POST(request);
    for (const spy of readers) expect(spy).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
  });
});

describe('invalid input', () => {
  it('malformed JSON → 400', async () => {
    const response = await route.POST(rawPost('{not json'));
    expect(response.status).toBe(400);
    expect(dataCalls()).toBe(0);
  });

  it.each([
    ['unknown action', { action: 'drop_table', data: {} }],
    ['no action', { data: {} }],
    ['version v3', { action: 'update_version', data: { version: 'v3' } }],
    ['version as number', { action: 'update_version', data: { version: 2 } }],
    ['version missing', { action: 'update_version', data: {} }],
  ])('%s → 400 "Invalid input", nothing written', async (_label, body) => {
    const response = await route.POST(post(body));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: 'Invalid input' });
    expect(set).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it.each([
    ['an array', ['#fff']],
    ['a string', 'colors'],
    ['null', null],
    ['missing', undefined],
  ])('tokens as %s → 400 with a format message and no names, nothing written', async (_label, tokens) => {
    const response = await route.POST(post({ action: 'save_tokens', data: { tokens } }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'The custom tokens are not in the expected format.',
      invalidKeys: [],
    });
    expect(set).not.toHaveBeenCalled();
  });

  it('no development details in production', async () => {
    setNodeEnv('production');
    const response = await route.POST(post({ action: 'update_version', data: { version: 'v3' } }));
    const body = await response.json();
    expect(body.details).toBeUndefined();
  });
});

describe('poisoned tokens', () => {
  const POISON = {
    colors: { primary: 'red;}body{display:none', evil: '#fff', secondary: 42 },
    shadows: { card: 'url(javascript:alert(1))' },
    '--v2-bg': { x: 'expression(alert(1))' },
  };

  it('are refused by name, nothing is written or audited, and no value is echoed', async () => {
    const response = await route.POST(post({ action: 'save_tokens', data: { tokens: POISON } }));
    expect(response.status).toBe(400);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.success).toBe(false);
    expect(body.invalidKeys).toEqual(['colors.primary', 'colors.secondary', 'shadows.card']);
    expect(body.error).toContain('colors.primary');
    expect(body.error).toContain('unknown setting');
    for (const reflected of ['red;}', 'display:none', 'javascript', 'expression', 'evil', '--v2-bg', '42']) {
      expect([reflected, text.includes(reflected)]).toEqual([reflected, false]);
    }
    expect(set).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('logs names and an unknown-key count, never a value or an unknown name', async () => {
    await route.POST(post({ action: 'save_tokens', data: { tokens: POISON } }));
    const warn = logs.find((l) => l.level === 'warn');
    expect(warn?.ctx).toMatchObject({ invalidKeys: ['colors.primary', 'colors.secondary', 'shadows.card'], unknownKeyCount: 2 });
    const logged = JSON.stringify(logs);
    for (const reflected of ['red;}', 'javascript', 'expression', 'evil', '--v2-bg']) {
      expect([reflected, logged.includes(reflected)]).toEqual([reflected, false]);
    }
  });
});

describe('prototype pollution, raw JSON bodies (R-4)', () => {
  afterEach(() => {
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('x');
  });

  it.each([
    ['the SA example', '{"action":"save_tokens","data":{"tokens":{"__proto__":{"x":"1"},"colors":{"constructor":"#fff"}}}}'],
    ['top-level __proto__', '{"action":"save_tokens","data":{"tokens":{"__proto__":{"x":"1"}}}}'],
    ['top-level constructor', '{"action":"save_tokens","data":{"tokens":{"constructor":{"prototype":{"x":"1"}}}}}'],
    ['top-level prototype', '{"action":"save_tokens","data":{"tokens":{"prototype":{"x":"1"}}}}'],
    ['group-level __proto__', '{"action":"save_tokens","data":{"tokens":{"colors":{"__proto__":{"x":"1"}}}}}'],
    ['group-level __proto__, empty', '{"action":"save_tokens","data":{"tokens":{"colors":{"__proto__":""}}}}'],
    ['group-level constructor', '{"action":"save_tokens","data":{"tokens":{"colors":{"constructor":"#fff"}}}}'],
    ['group-level prototype', '{"action":"save_tokens","data":{"tokens":{"colors":{"prototype":"#fff"}}}}'],
    ['beside a valid key', '{"action":"save_tokens","data":{"tokens":{"colors":{"primary":"#fff","__proto__":{"polluted":"1"}}}}}'],
    ['body-level __proto__', '{"__proto__":{"x":"1"},"action":"save_tokens","data":{"__proto__":{"x":"1"},"tokens":{"colors":{"primary":"#fff"}}}}'],
  ])('%s → 400, nothing written', async (_label, json) => {
    const response = await route.POST(rawPost(json));
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toMatch(/__proto__|constructor|prototype|polluted/);
    expect(set).not.toHaveBeenCalled();
  });
});

describe('happy paths', () => {
  it('save_tokens stores the trimmed object without empty values, audited by name', async () => {
    const response = await route.POST(
      post({
        action: 'save_tokens',
        data: { tokens: { colors: { primary: ' #6366F1 ', secondary: '' }, spacing: { card: '' }, shadows: { card: 'none' } } },
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      'v2_custom_tokens',
      { colors: { primary: '#6366F1' }, shadows: { card: 'none' } },
      'ui',
      expect.any(String),
      { actorId: ADMIN.id }
    );

    expect(auditLog).toHaveBeenCalledTimes(1);
    const entry = auditLog.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'SYSTEM_CONFIG_CHANGED',
      entityType: 'settings',
      entityId: 'v2_custom_tokens',
      userId: ADMIN.id,
      actorId: ADMIN.id,
      resourceName: 'UI configuration',
      severity: 'info',
      details: { operation: 'save_tokens', tokenKeys: ['colors.primary', 'shadows.card'] },
    });
    expect(entry.request).toBeDefined();
    const audited = JSON.stringify({ ...entry, request: undefined });
    expect(audited).not.toContain('#6366F1');
    expect(audited).not.toContain('none');
  });

  it('update_version stores the enum value and audits it', async () => {
    const response = await route.POST(post({ action: 'update_version', data: { version: 'v2' } }));
    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith('ui_version', 'v2', 'ui', expect.any(String), { actorId: ADMIN.id });
    expect(auditLog.mock.calls[0][0]).toMatchObject({
      entityType: 'settings',
      entityId: 'ui_version',
      details: { operation: 'update_version', version: 'v2' },
    });
  });

  it('reset_tokens deletes the key and audits it', async () => {
    const response = await route.POST(post({ action: 'reset_tokens', data: {} }));
    expect(response.status).toBe(200);
    expect(del).toHaveBeenCalledWith('v2_custom_tokens');
    expect(set).not.toHaveBeenCalled();
    expect(auditLog.mock.calls[0][0]).toMatchObject({ entityId: 'v2_custom_tokens', details: { operation: 'reset_tokens' } });
  });

  it('GET returns the version and tokens, and writes no audit', async () => {
    getByKeys.mockResolvedValue({
      data: [
        { key: 'ui_version', value: 'v2' },
        { key: 'v2_custom_tokens', value: { colors: { primary: '#6366F1' } } },
      ],
      error: null,
    });
    const response = await route.GET(get());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { uiVersion: 'v2', customTokens: { colors: { primary: '#6366F1' } } },
    });
    expect(getByKeys).toHaveBeenCalledWith(['ui_version', 'v2_custom_tokens']);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('GET falls back to v1 and {} when nothing is stored, or the version is not in the enum', async () => {
    const empty = await route.GET(get());
    await expect(empty.json()).resolves.toEqual({ success: true, data: { uiVersion: 'v1', customTokens: {} } });

    getByKeys.mockResolvedValue({ data: [{ key: 'ui_version', value: 'v9' }], error: null });
    const odd = await route.GET(get());
    await expect(odd.json()).resolves.toMatchObject({ data: { uiVersion: 'v1' } });
  });

  it('GET omits stored invalid values and logs their names, never the values (R-8)', async () => {
    getByKeys.mockResolvedValue({
      data: [{ key: 'v2_custom_tokens', value: { colors: { primary: 'red;}body{x', secondary: '#fff' }, evil: { a: 'b' } } }],
      error: null,
    });
    const response = await route.GET(get());
    const text = await response.text();
    expect(JSON.parse(text).data.customTokens).toEqual({ colors: { secondary: '#fff' } });
    expect(text).not.toContain('red;}');

    const warn = logs.find((l) => l.level === 'warn');
    expect(warn?.ctx).toMatchObject({ droppedKeys: ['colors.primary'] });
    expect(JSON.stringify(logs)).not.toContain('red;}');
  });
});

describe('failures', () => {
  it('a repository write error → 500 with no details in production, and no audit', async () => {
    setNodeEnv('production');
    set.mockResolvedValue({ data: null, error: new Error('duplicate key value violates unique constraint "pk"') });
    const response = await route.POST(post({ action: 'save_tokens', data: { tokens: { colors: { primary: '#fff' } } } }));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ success: false, error: 'Failed to save UI configuration' });
    expect(text).not.toContain('duplicate');
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('a repository write error carries details in development', async () => {
    setNodeEnv('development');
    del.mockResolvedValue({ data: null, error: new Error('boom') });
    const response = await route.POST(post({ action: 'reset_tokens' }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ details: 'boom' });
  });

  it('a GET repository error → 500 with no details in production', async () => {
    setNodeEnv('production');
    getByKeys.mockResolvedValue({ data: null, error: new Error('relation does not exist') });
    const response = await route.GET(get());
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ success: false, error: 'Failed to fetch UI configuration' });
  });

  it('an audit failure does not fail the save', async () => {
    auditLog.mockRejectedValue(new Error('audit down'));
    const response = await route.POST(post({ action: 'update_version', data: { version: 'v1' } }));
    expect(response.status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(logs.some((l) => l.level === 'error' && l.msg === 'Audit failed (non-blocking)')).toBe(true);
  });

  it('never touches the database directly', () => {
    expect(directDb).not.toHaveBeenCalled();
  });
});
