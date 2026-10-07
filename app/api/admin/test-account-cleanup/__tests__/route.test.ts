/**
 * /api/admin/test-account-cleanup/{check,delete}: the real routes, the real
 * repository and the real secret reader, over a FAKE service-role client
 * (rpc + Storage). No database, no network (SA-12, R-5).
 *
 * The 401/403 denial cases live in app/api/admin/__tests__/adminGate.writes.test.ts
 * with every other gated handler. Here the gate is stubbed to "admin" so the
 * handler itself is exercised: 400 before any call, 503 when the secret is
 * unset or refused (42501), the version check before storage (R-6), storage
 * only after a check whose only blocker is G-12 and before the delete, the
 * refused-attempt audit row, and no email, tag or secret in a log line, an
 * audit row or a response.
 */

import { NextRequest, NextResponse } from 'next/server';
import { CLEANUP_FUNCTION_VERSION } from '@/lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated';

const ENV_NAME = ['TEST', 'CLEANUP', 'SECRET'].join('_');
const SECRET = 'f'.repeat(64);
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMAIL = 'someone+test7@example.org';
const TAG = '+test7';

const mockGate = jest.fn();
jest.mock('@/lib/admin/requireAdminRoute', () => ({ requireAdmin: () => mockGate() }));

const mockLogged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => mockLogged.push(...args);
  logger.child = (...args: unknown[]) => {
    mockLogged.push(...args);
    return logger;
  };
  return { createLogger: () => logger };
});

const mockAudit = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...args: unknown[]) => mockAudit(...args) }));

type Reply = { data: unknown; error: { code: string; message: string } | null };
/** Everything that happened, in order: rpc calls by mode, storage removals. */
const mockEvents: string[] = [];
const mockArgs: Array<Record<string, unknown>> = [];
let mockReply: (mode: string) => Reply = () => ({ data: null, error: null });
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mockEvents.push(`rpc:${fn}:${String(args.p_mode)}`);
      mockArgs.push(args);
      return mockReply(String(args.p_mode));
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          mockEvents.push(`storage:${bucket}:${paths.length}`);
          return { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
  },
}));

import * as checkRoute from '../check/route';
import * as deleteRoute from '../delete/route';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { CLEANUP_RPC } from '@/lib/repositories/TestAccountCleanupRepository';

const req = (url: string, body?: unknown, raw?: string) =>
  new NextRequest(`http://localhost${url}`, {
    method: body === undefined && raw === undefined ? 'GET' : 'POST',
    ...(body === undefined && raw === undefined
      ? {}
      : { body: raw ?? JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });

const verdict = (status: 'OK' | 'BLOCKED') => ({ section: 'VERDICT', status, item: `login ${TARGET}`, found: 0, detail: '' });
const blocked = (item: string) => ({ section: 'guard', status: 'BLOCKED', item, found: 1, detail: 'how to clear' });
const file = (bucket: string, name: string) => ({ section: 'storage', status: 'empty this folder', item: `${bucket}/${TARGET}/${name}`, found: null, detail: '' });
const REPORT = [
  { line: 'crm_contacts', rows_removed: 2 },
  { line: 'TOTAL', rows_removed: 2, result: 'CLEAN', tables_removed: 1, removed_login: TARGET, removed_at: '2026-10-07T10:00:00Z', same_run: true },
];
const ok = (mode: string, rows: unknown[], version = CLEANUP_FUNCTION_VERSION): Reply => ({ data: { version, mode, rows }, error: null });
const fail = (code: string, message: string): Reply => ({ data: null, error: { code, message } });

/** check -> the given rows; delete -> the report, unless overridden. */
const script = (checkRows: unknown[], onDelete: Reply = ok('delete', REPORT), version = CLEANUP_FUNCTION_VERSION) =>
  (mode: string): Reply => (mode === 'check' ? ok('check', checkRows, version) : onDelete);

const DELETE_OK = { email: EMAIL, tag: TAG, confirmEmail: EMAIL.toUpperCase() };
const RPC_CHECK = `rpc:${CLEANUP_RPC}:check`;
const RPC_DELETE = `rpc:${CLEANUP_RPC}:delete`;

beforeEach(() => {
  mockGate.mockReset().mockResolvedValue({ user: { id: ADMIN_ID, email: 'ops@example.com' } });
  mockAudit.mockReset().mockResolvedValue(undefined);
  mockEvents.length = 0;
  mockArgs.length = 0;
  mockLogged.length = 0;
  mockReply = () => ({ data: null, error: null });
  process.env[ENV_NAME] = SECRET;
});
afterAll(() => {
  delete process.env[ENV_NAME];
});

describe('the gate comes first', () => {
  it('returns the gate response and touches nothing', async () => {
    mockGate.mockResolvedValue(NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }));
    expect((await checkRoute.POST(req('/c', { email: EMAIL, tag: TAG }))).status).toBe(403);
    expect((await deleteRoute.POST(req('/d', DELETE_OK))).status).toBe(403);
    expect((await checkRoute.GET(req('/c'))).status).toBe(403);
    expect(mockEvents).toEqual([]);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe('Zod, before any call (SA-9)', () => {
  it.each([
    ['malformed JSON', undefined, '{'],
    ['an extra key', { email: EMAIL, tag: TAG, userId: TARGET }, undefined],
    ['an empty tag', { email: EMAIL, tag: '   ' }, undefined],
    ['not an email', { email: 'nobody', tag: TAG }, undefined],
    ['an email over 254 chars', { email: `${'a'.repeat(250)}@b.co`, tag: TAG }, undefined],
  ])('check: 400 on %s', async (_name, body, raw) => {
    expect((await checkRoute.POST(req('/c', body, raw))).status).toBe(400);
    expect(mockEvents).toEqual([]);
  });

  it('delete: 400 without confirmEmail, nothing touched or audited', async () => {
    expect((await deleteRoute.POST(req('/d', { email: EMAIL, tag: TAG }))).status).toBe(400);
    expect(mockEvents).toEqual([]);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('accepts any non-empty free-text tag (BQ-2)', async () => {
    mockReply = script([verdict('OK')]);
    expect((await checkRoute.POST(req('/c', { email: EMAIL, tag: '@example.org' }))).status).toBe(200);
  });
});

describe('503 when the secret is unset (the off switch)', () => {
  beforeEach(() => {
    delete process.env[ENV_NAME];
  });

  it('the probe says not configured', async () => {
    expect(await (await checkRoute.GET(req('/c'))).json()).toMatchObject({ success: true, data: { configured: false } });
  });

  it('check and delete answer 503 and make no rpc call', async () => {
    expect((await checkRoute.POST(req('/c', { email: EMAIL, tag: TAG }))).status).toBe(503);
    expect((await deleteRoute.POST(req('/d', DELETE_OK))).status).toBe(503);
    expect(mockEvents).toEqual([]);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ details: { reason: 'not_configured' } });
  });
});

describe('the database refuses the secret (42501) or lacks the function', () => {
  it('check: 503, logged as an error, not audited', async () => {
    mockReply = () => fail('42501', 'not authorised');
    const res = await checkRoute.POST(req('/c', { email: EMAIL, tag: TAG }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('not_authorised');
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('delete: 503 before any storage call, audited as refused', async () => {
    mockReply = () => fail('42501', 'not authorised');
    const res = await deleteRoute.POST(req('/d', DELETE_OK));
    expect(res.status).toBe(503);
    expect(mockEvents).toEqual([RPC_CHECK]);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({
      action: AUDIT_EVENTS.BUSINESS_TEST_ACCOUNT_REMOVAL_REFUSED,
      details: { reason: 'not_authorised' },
    });
  });

  it('delete: a missing function (PGRST202) is 503 too', async () => {
    mockReply = () => fail('PGRST202', 'Could not find the function');
    expect((await deleteRoute.POST(req('/d', DELETE_OK))).status).toBe(503);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ details: { reason: 'function_missing' } });
  });
});

describe('check', () => {
  it('returns the report and whether the function is up to date', async () => {
    mockReply = script([verdict('OK')]);
    const res = await checkRoute.POST(req('/c', { email: EMAIL, tag: TAG }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ verdict: 'OK', targetUserId: TARGET, functionUpToDate: true });
    expect(mockEvents).toEqual([RPC_CHECK]);
    expect(mockArgs[0]).toMatchObject({ p_mode: 'check', p_actor: null, p_secret: SECRET });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('500 with no database detail in production', async () => {
    mockReply = () => fail('42P01', 'relation "secret_table" does not exist');
    const res = await checkRoute.POST(req('/c', { email: EMAIL, tag: TAG }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret_table');
  });
});

describe('delete (SA-6 ordering, R-6)', () => {
  it('OK check, no files: check, then the delete with the admin as actor', async () => {
    mockReply = script([verdict('OK')]);
    const res = await deleteRoute.POST(req('/d', DELETE_OK));
    expect(res.status).toBe(200);
    expect((await res.json()).data.report.total).toMatchObject({ result: 'CLEAN', rowsRemoved: 2 });
    expect(mockEvents).toEqual([RPC_CHECK, RPC_DELETE]);
    // The admin id comes from the gate, never the body.
    expect(mockArgs[1]).toMatchObject({ p_mode: 'delete', p_actor: ADMIN_ID, p_confirm: DELETE_OK.confirmEmail, p_secret: SECRET });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('logs and returns the database time of both calls next to elapsedMs (SA C-2)', async () => {
    mockReply = (mode: string): Reply =>
      ({ data: { version: CLEANUP_FUNCTION_VERSION, mode, rows: mode === 'check' ? [verdict('OK')] : REPORT, server_ms: mode === 'check' ? 900 : 2100 }, error: null });
    const res = await deleteRoute.POST(req('/d', DELETE_OK));
    expect((await res.json()).data.serverMs).toEqual({ check: 900, delete: 2100 });
    const line = mockLogged.find((entry) => typeof entry === 'object' && entry !== null && 'serverMs' in entry) as Record<string, unknown>;
    expect(line).toMatchObject({ serverMs: { check: 900, delete: 2100 } });
    expect(typeof line.elapsedMs).toBe('number');
  });

  it('a function of another version: 503 before any storage call or delete (R-6)', async () => {
    mockReply = script([verdict('BLOCKED'), blocked('G-12 no stored files under the account folder'), file('website-images', 'a.png')], ok('delete', REPORT), 'ffffffffffffffff');
    const res = await deleteRoute.POST(req('/d', DELETE_OK));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('function_out_of_date');
    expect(mockEvents).toEqual([RPC_CHECK]);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ details: { reason: 'function_out_of_date', target_user_id: TARGET } });
  });

  it('only G-12 blocks: the listed files are removed FIRST, then the delete runs', async () => {
    mockReply = script([
      verdict('BLOCKED'),
      blocked('G-12 no stored files under the account folder'),
      file('website-images', 'a.png'),
      file('website-images', 'b.png'),
      file('contact-documents', 'c.pdf'),
    ]);
    const res = await deleteRoute.POST(req('/d', DELETE_OK));
    expect(res.status).toBe(200);
    expect((await res.json()).data.filesRemoved).toBe(3);
    expect(mockEvents).toEqual([RPC_CHECK, 'storage:website-images:2', 'storage:contact-documents:1', RPC_DELETE]);
  });

  it('BLOCKED with no parsed blocker: 409, storage never called, no delete', async () => {
    mockReply = script([verdict('BLOCKED'), file('website-images', 'a.png')]);
    const res = await deleteRoute.POST(req('/d', DELETE_OK));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('blocked');
    expect(mockEvents).toEqual([RPC_CHECK]);
  });

  it('any other blocker: 409, no storage call, no delete, audited with the guard ids', async () => {
    mockReply = script([
      verdict('BLOCKED'),
      blocked('G-12 no stored files under the account folder'),
      blocked('G-5 nothing ever ran in Stripe live mode'),
      file('website-images', 'a.png'),
    ]);
    const res = await deleteRoute.POST(req('/d', DELETE_OK));
    expect(res.status).toBe(409);
    expect((await res.json()).guards).toEqual(['G-12', 'G-5']);
    expect(mockEvents).toEqual([RPC_CHECK]);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({
      action: AUDIT_EVENTS.BUSINESS_TEST_ACCOUNT_REMOVAL_REFUSED,
      entityType: 'user',
      entityId: TARGET,
      userId: ADMIN_ID,
      actorId: ADMIN_ID,
      details: { reason: 'blocked', guards: ['G-12', 'G-5'], target_user_id: TARGET, correlation_id: expect.any(String) },
    });
  });

  it('a wrong confirmation: 400 G-3 before any call, audited', async () => {
    const res = await deleteRoute.POST(req('/d', { ...DELETE_OK, confirmEmail: 'other+test7@example.org' }));
    expect(res.status).toBe(400);
    expect((await res.json()).guards).toEqual(['G-3']);
    expect(mockEvents).toEqual([]);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ details: { reason: 'confirmation_mismatch', guards: ['G-3'] } });
  });

  it('the function raises after files went: 409, "files removed, account kept"', async () => {
    mockReply = script(
      [verdict('BLOCKED'), blocked('G-12 no stored files under the account folder'), file('website-images', 'a.png')],
      fail('P0001', 'BLOCKED, nothing was removed: G-15 nobody else hangs below it in the invitation circle')
    );
    const res = await deleteRoute.POST(req('/d', DELETE_OK));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.guards).toEqual(['G-15']);
    expect(body.message).toMatch(/^Files removed, account kept: BLOCKED/);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ details: { reason: 'blocked', guards: ['G-15'], files_removed: 1 } });
  });

  it('a database error during the delete: 500, audited as delete_failed', async () => {
    mockReply = script([verdict('OK')], fail('55P03', 'lock timeout on secret_table'));
    const res = await deleteRoute.POST(req('/d', DELETE_OK));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret_table');
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ details: { reason: 'delete_failed' } });
  });

  it('an unexpected throw: 500 with the correlationId, audited as unexpected_failed', async () => {
    const spy = jest
      .spyOn(jest.requireActual('@/lib/business-os/test-account-cleanup/runCleanupDelete'), 'runCleanupDelete')
      .mockRejectedValue(new Error('boom'));
    try {
      const res = await deleteRoute.POST(req('/d', DELETE_OK));
      expect(res.status).toBe(500);
      expect((await res.json()).correlationId).toEqual(expect.any(String));
      expect(mockAudit.mock.calls[0][0]).toMatchObject({ details: { reason: 'unexpected_failed' } });
    } finally {
      spy.mockRestore();
    }
  });

  it('never logs, audits or returns the email, the tag or the secret', async () => {
    const bodies: string[] = [];
    mockReply = script([verdict('BLOCKED'), blocked('G-4 not a platform admin')]);
    bodies.push(await (await deleteRoute.POST(req('/d', DELETE_OK))).text());
    mockReply = () => fail('42501', 'not authorised');
    bodies.push(await (await deleteRoute.POST(req('/d', DELETE_OK))).text());
    bodies.push(await (await checkRoute.POST(req('/c', { email: EMAIL, tag: TAG }))).text());
    const recorded = JSON.stringify([mockLogged, mockAudit.mock.calls.map((call) => call[0].details), bodies]);
    expect(recorded.toLowerCase()).not.toContain(EMAIL.toLowerCase());
    expect(recorded).not.toContain(TAG);
    expect(recorded).not.toContain(SECRET);
  });
});
