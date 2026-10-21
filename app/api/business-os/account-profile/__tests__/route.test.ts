/**
 * GET / PATCH /api/business-os/account-profile (settings drawer D-2).
 *
 * CLAUDE.md minimum (happy path, auth failure, invalid input), plus what this
 * route exists to hold:
 *   - only `full_name` / `job_title` are writable: `role`, `avatar_url`, any id
 *     and the timezone are a 400 before the repository is reached;
 *   - every read and write is for the SESSION user;
 *   - a name save never reaches the timezone (F-24, server half);
 *   - no name or job title is ever logged or audited, on any path.
 */

import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = jest.fn(() => logger);
  return { createLogger: () => logger };
});

const auditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: (...a: unknown[]) => auditLog(...a) }) },
}));

const findSettingsCard = jest.fn();
const saveSettingsCard = jest.fn();
const updateTimezoneMirror = jest.fn();
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: {
    findSettingsCard: (...a: unknown[]) => findSettingsCard(...a),
    saveSettingsCard: (...a: unknown[]) => saveSettingsCard(...a),
    updateTimezoneMirror: (...a: unknown[]) => updateTimezoneMirror(...a),
  },
}));

// Must never be called: the route has no business with preferences (F-24).
const preferencesCalls = jest.fn();
jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
  userPreferencesRepository: new Proxy(
    {},
    { get: (_t, prop) => (...a: unknown[]) => preferencesCalls(prop, ...a) }
  ),
}));

import { createLogger } from '@/lib/logger';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { GET, PATCH } from '../route';

/** The mocked logger: one shared object (its `child` returns itself). */
const log = createLogger({ module: 'test' }) as unknown as Record<'info' | 'warn' | 'error' | 'debug' | 'child', jest.Mock>;

const SESSION_USER = { id: 'session-user-id', email: 'owner@example.com' };
const OTHER = 'other-user-id';
const URL_BASE = 'http://localhost/api/business-os/account-profile';
const FULL_NAME_MAX = 120;
const JOB_TITLE_MAX = 100;

function patchReq(body: unknown, opts: { raw?: boolean; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(URL_BASE, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.raw ? (body as string) : JSON.stringify(body),
  });
}

function getReq(query = ''): NextRequest {
  return new NextRequest(URL_BASE + query, { method: 'GET' });
}

/** Every argument any logger level was called with, serialised. */
function allLogged(): string {
  return JSON.stringify(
    (['info', 'warn', 'error', 'debug'] as const).flatMap((level) => log[level].mock.calls)
  );
}

function noSave() {
  expect(saveSettingsCard).not.toHaveBeenCalled();
  expect(auditLog).not.toHaveBeenCalled();
}

const ORIGINAL_ENV = process.env.NODE_ENV;
function setEnv(value: string) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue(SESSION_USER);
  auditLog.mockResolvedValue(undefined);
  findSettingsCard.mockResolvedValue({
    data: { full_name: 'Dana Cohen', avatar_url: 'https://cdn/a.png', job_title: 'founder' },
    error: null,
  });
  saveSettingsCard.mockResolvedValue({ data: true, error: null });
});

afterEach(() => {
  setEnv(ORIGINAL_ENV as string);
});

describe('GET /api/business-os/account-profile', () => {
  it('G-1: returns the three card fields for the session user', async () => {
    const res = await GET(getReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { full_name: 'Dana Cohen', avatar_url: 'https://cdn/a.png', job_title: 'founder' },
    });
    expect(findSettingsCard).toHaveBeenCalledTimes(1);
    expect(findSettingsCard).toHaveBeenCalledWith(SESSION_USER.id);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('G-2: no row is 200 with three empty strings, not 404', async () => {
    findSettingsCard.mockResolvedValue({ data: null, error: null });
    const res = await GET(getReq());

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ full_name: '', avatar_url: '', job_title: '' });
  });

  it("G-3: NULL columns are ''", async () => {
    findSettingsCard.mockResolvedValue({ data: { full_name: null, avatar_url: null, job_title: null }, error: null });
    const res = await GET(getReq());

    expect((await res.json()).data).toEqual({ full_name: '', avatar_url: '', job_title: '' });
  });

  it('G-4: 401 with no session, and reads nothing', async () => {
    getUser.mockResolvedValue(null);
    const res = await GET(getReq());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(findSettingsCard).not.toHaveBeenCalled();
  });

  it('G-5: a repository error is 500 with no database message in the body', async () => {
    setEnv('production');
    findSettingsCard.mockResolvedValue({ data: null, error: new Error('relation secret_db_message') });
    const res = await GET(getReq());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Failed to load the profile' });
    expect(JSON.stringify(body)).not.toContain('secret_db_message');
  });

  it('G-6: a user id in the query string is ignored', async () => {
    await GET(getReq(`?user_id=${OTHER}&id=${OTHER}`));

    expect(findSettingsCard).toHaveBeenCalledWith(SESSION_USER.id);
    expect(JSON.stringify(findSettingsCard.mock.calls)).not.toContain(OTHER);
  });
});

describe('PATCH /api/business-os/account-profile', () => {
  it('P-1: saves the name for the session user, audits field names only', async () => {
    const res = await PATCH(patchReq({ full_name: 'Dana Cohen' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { full_name: 'Dana Cohen' } });
    expect(saveSettingsCard).toHaveBeenCalledTimes(1);
    expect(saveSettingsCard).toHaveBeenCalledWith(SESSION_USER.id, { full_name: 'Dana Cohen' });

    expect(auditLog).toHaveBeenCalledTimes(1);
    const entry = auditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toEqual(
      expect.objectContaining({
        action: AUDIT_EVENTS.SETTINGS_PROFILE_UPDATED,
        entityType: 'user',
        entityId: SESSION_USER.id,
        userId: SESSION_USER.id,
        details: { fields: ['full_name'] },
      })
    );
    expect(entry).not.toHaveProperty('changes');
    // The request object is the framework's; everything else is what is stored.
    const stored = { ...entry };
    delete stored.request;
    expect(JSON.stringify(stored)).not.toContain('Dana');
  });

  it('P-2: a job title alone', async () => {
    const res = await PATCH(patchReq({ job_title: 'founder' }));

    expect(res.status).toBe(200);
    expect(saveSettingsCard).toHaveBeenCalledWith(SESSION_USER.id, { job_title: 'founder' });
    expect((auditLog.mock.calls[0][0] as { details: unknown }).details).toEqual({ fields: ['job_title'] });
  });

  it('P-3: both fields', async () => {
    const res = await PATCH(patchReq({ full_name: 'Dana', job_title: 'founder' }));

    expect(res.status).toBe(200);
    expect(saveSettingsCard).toHaveBeenCalledWith(SESSION_USER.id, { full_name: 'Dana', job_title: 'founder' });
    expect((auditLog.mock.calls[0][0] as { details: unknown }).details).toEqual({
      fields: ['full_name', 'job_title'],
    });
  });

  it('P-4: values are trimmed, saved and returned trimmed', async () => {
    const res = await PATCH(patchReq({ full_name: '  Dana  ', job_title: ' founder ' }));

    expect(res.status).toBe(200);
    expect(saveSettingsCard).toHaveBeenCalledWith(SESSION_USER.id, { full_name: 'Dana', job_title: 'founder' });
    expect((await res.json()).data).toEqual({ full_name: 'Dana', job_title: 'founder' });
  });

  it('P-5: an empty name is allowed', async () => {
    const res = await PATCH(patchReq({ full_name: '' }));

    expect(res.status).toBe(200);
    expect(saveSettingsCard).toHaveBeenCalledWith(SESSION_USER.id, { full_name: '' });
  });

  it('P-6: exactly the limit is allowed, also with outer spaces', async () => {
    const name = 'n'.repeat(FULL_NAME_MAX);
    const title = 't'.repeat(JOB_TITLE_MAX);
    expect((await PATCH(patchReq({ full_name: name, job_title: title }))).status).toBe(200);
    expect((await PATCH(patchReq({ full_name: `  ${name}  `, job_title: ` ${title} ` }))).status).toBe(200);
    expect(saveSettingsCard).toHaveBeenLastCalledWith(SESSION_USER.id, { full_name: name, job_title: title });
  });

  it('P-7: one over the limit is a 400, and the value is not logged', async () => {
    const longName = 'MARKERNAME' + 'n'.repeat(FULL_NAME_MAX - 9);
    const longTitle = 'MARKERTITLE' + 't'.repeat(JOB_TITLE_MAX - 10);

    const a = await PATCH(patchReq({ full_name: longName }));
    const b = await PATCH(patchReq({ job_title: longTitle }));

    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
    expect((await a.json()).error).toBe('Invalid input');
    noSave();
    expect(allLogged()).not.toContain('MARKERNAME');
    expect(allLogged()).not.toContain('MARKERTITLE');
  });

  it('P-8: 401 with no session: no save, no audit', async () => {
    getUser.mockResolvedValue(null);
    const res = await PATCH(patchReq({ full_name: 'Dana' }));

    expect(res.status).toBe(401);
    noSave();
  });

  it.each<[string, unknown]>([
    ['empty object', {}],
    ['role', { role: 'admin' }],
    ['a name with role', { full_name: 'x', role: 'admin' }],
    ['avatar_url', { avatar_url: 'https://cdn/x.png' }],
    // With a name too, so the "nothing to update" refine cannot be what refuses it.
    ['a name with avatar_url', { full_name: 'x', avatar_url: 'https://cdn/x.png' }],
    ['a name with timezone_confirmed_at', { full_name: 'x', timezone_confirmed_at: '2026-10-15T00:00:00Z' }],
    ['a name with company', { full_name: 'x', company: 'x' }],
    ['id', { full_name: 'x', id: OTHER }],
    ['user_id', { full_name: 'x', user_id: OTHER }],
    ['userId', { full_name: 'x', userId: OTHER }],
    ['timezone', { timezone: 'UTC' }],
    ['timezone with a name', { full_name: 'x', timezone: 'UTC' }],
    ['timezone_confirmed_at', { timezone_confirmed_at: '2026-10-15T00:00:00Z' }],
    ['company', { company: 'x' }],
    ['null name', { full_name: null }],
    ['numeric name', { full_name: 42 }],
    ['array body', []],
    ['string body', 'Dana'],
    ['null body', null],
  ])('P-9: %s is a 400 Invalid input, with no save and no audit', async (_label, body) => {
    const res = await PATCH(patchReq(body));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid input');
    noSave();
  });

  it('P-9: a body that is not JSON is a 400 Invalid JSON body', async () => {
    const res = await PATCH(patchReq('not json', { raw: true }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid JSON body' });
    noSave();
  });

  it('P-9: a refused body logs at most key names, never values', async () => {
    const res = await PATCH(patchReq({ full_name: 'UNIQUEMARKER42', role: 'admin' }));

    expect(res.status).toBe(400);
    noSave();
    expect(allLogged()).not.toContain('UNIQUEMARKER42');
    expect(allLogged()).not.toContain('"admin"');
  });

  it('P-10: a repository error is 500 with no database message, and no audit', async () => {
    setEnv('production');
    saveSettingsCard.mockResolvedValue({ data: null, error: new Error('secret_db_message') });
    const res = await PATCH(patchReq({ full_name: 'Dana Cohen' }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Failed to save the profile' });
    expect(JSON.stringify(body)).not.toContain('secret_db_message');
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('P-11: an audit failure does not fail the save', async () => {
    auditLog.mockRejectedValue(new Error('audit down'));
    const res = await PATCH(patchReq({ full_name: 'Dana' }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'Audit failed (non-blocking)');
  });

  it('P-12: F-24, a profile save never touches preferences or the timezone mirror', async () => {
    await PATCH(patchReq({ full_name: 'Dana' }));
    await PATCH(patchReq({ job_title: 'founder' }));
    await PATCH(patchReq({ full_name: 'Dana', job_title: 'founder' }));

    expect(preferencesCalls).not.toHaveBeenCalled();
    expect(updateTimezoneMirror).not.toHaveBeenCalled();

    const source = fs
      .readFileSync(path.join(process.cwd(), 'app/api/business-os/account-profile/route.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).not.toContain('UserPreferencesRepository');
    expect(source).not.toContain('userPreferencesRepository');
    expect(source).not.toContain('updateTimezoneMirror');
  });

  it('P-13: no name or job title in any log line, across saves and failures', async () => {
    await PATCH(patchReq({ full_name: 'MARKERDANA' }));
    await PATCH(patchReq({ job_title: 'MARKERJOB' }));
    await PATCH(patchReq({ full_name: 'MARKERBOTH', job_title: 'MARKERBOTHJOB' }));
    await PATCH(patchReq({ full_name: '  MARKERTRIM  ' }));
    saveSettingsCard.mockResolvedValue({ data: null, error: new Error('db') });
    await PATCH(patchReq({ full_name: 'MARKERFAIL' }));

    const logged = allLogged();
    for (const marker of ['MARKERDANA', 'MARKERJOB', 'MARKERBOTH', 'MARKERTRIM', 'MARKERFAIL']) {
      expect(logged).not.toContain(marker);
    }
  });

  it('P-14: the x-correlation-id header is used for the child logger', async () => {
    await PATCH(patchReq({ full_name: 'Dana' }, { headers: { 'x-correlation-id': 'corr-123' } }));

    expect(log.child).toHaveBeenCalledWith({ correlationId: 'corr-123' });
  });

  // QA EC-3: the PATCH twin of G-6. The greeting guard only matches the source
  // text `saveSettingsCard(user.id`; this pins the behaviour.
  it('P-15: a user id in the query string is ignored, the write is for the session user', async () => {
    const res = await PATCH(
      new NextRequest(`${URL_BASE}?user_id=${OTHER}&id=${OTHER}&userId=${OTHER}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'Dana' }),
      })
    );

    expect(res.status).toBe(200);
    expect(saveSettingsCard).toHaveBeenCalledTimes(1);
    expect(saveSettingsCard).toHaveBeenCalledWith(SESSION_USER.id, { full_name: 'Dana' });
    expect(JSON.stringify(saveSettingsCard.mock.calls)).not.toContain(OTHER);
    const entry = auditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(entry.userId).toBe(SESSION_USER.id);
    expect(entry.entityId).toBe(SESSION_USER.id);
  });
});
