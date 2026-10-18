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
const KEY_ENV = ['DELETION', 'RECEIPT', 'FINGERPRINT', 'KEY'].join('_');
const SECRET = 'f'.repeat(64);
const FINGERPRINT_KEY = 'k'.repeat(48);
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

// DE-10b.1: the export facts copied into the receipt. Recorded so a test can prove it ran, or did not.
const mockFacts = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportJobRepository', () => ({
  BusinessOsDataExportJobRepository: jest.fn().mockImplementation(() => ({ findDeletionFacts: (...args: unknown[]) => mockFacts(...args) })),
}));

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

const DELETE_OK = { mode: 'hard', email: EMAIL, tag: TAG, confirmEmail: EMAIL.toUpperCase(), reason: { category: 'test_account' } };
const CHECK_OK = { mode: 'hard', email: EMAIL, tag: TAG };
const RPC_CHECK = `rpc:${CLEANUP_RPC}:check`;
const RPC_DELETE = `rpc:${CLEANUP_RPC}:delete`;

beforeEach(() => {
  mockGate.mockReset().mockResolvedValue({ user: { id: ADMIN_ID, email: 'ops@example.com' } });
  mockAudit.mockReset().mockResolvedValue(undefined);
  mockEvents.length = 0;
  mockArgs.length = 0;
  mockLogged.length = 0;
  mockReply = () => ({ data: null, error: null });
  mockFacts.mockReset().mockImplementation(async () => {
    mockEvents.push('facts');
    return { data: { ownerLastExportReadyAt: null, ownerExportDownloadedAt: null, adminExportExisted: false }, error: null };
  });
  process.env[ENV_NAME] = SECRET;
  process.env[KEY_ENV] = FINGERPRINT_KEY;
});
afterAll(() => {
  delete process.env[ENV_NAME];
  delete process.env[KEY_ENV];
});

describe('the gate comes first', () => {
  it('returns the gate response and touches nothing', async () => {
    mockGate.mockResolvedValue(NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }));
    expect((await checkRoute.POST(req('/c', CHECK_OK))).status).toBe(403);
    expect((await deleteRoute.POST(req('/d', DELETE_OK))).status).toBe(403);
    expect((await checkRoute.GET(req('/c'))).status).toBe(403);
    expect(mockEvents).toEqual([]);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe('Zod, before any call (SA-9)', () => {
  it.each([
    ['malformed JSON', undefined, '{'],
    ['an extra key', { ...CHECK_OK, userId: TARGET }, undefined],
    ['an empty tag', { ...CHECK_OK, tag: '   ' }, undefined],
    ['not an email', { ...CHECK_OK, email: 'nobody' }, undefined],
    ['an email over 254 chars', { ...CHECK_OK, email: `${'a'.repeat(250)}@b.co` }, undefined],
    // DE-10b.1 (W-8): the mode is required, and each mode has its own strict shape.
    ['no mode', { email: EMAIL, tag: TAG }, undefined],
    ['hard without a tag', { mode: 'hard', email: EMAIL }, undefined],
    ['a tag in the anonymise mode', { mode: 'anonymise', email: EMAIL, subject: TARGET, tag: TAG }, undefined],
    ['anonymise without a subject', { mode: 'anonymise', email: EMAIL }, undefined],
    ['anonymise with a subject that is not a uuid', { mode: 'anonymise', email: EMAIL, subject: 'nope' }, undefined],
  ])('check: 400 on %s', async (_name, body, raw) => {
    expect((await checkRoute.POST(req('/c', body, raw))).status).toBe(400);
    expect(mockEvents).toEqual([]);
  });

  it('delete: 400 without confirmEmail, nothing touched or audited', async () => {
    expect((await deleteRoute.POST(req('/d', { mode: 'hard', email: EMAIL, tag: TAG, reason: { category: 'test_account' } }))).status).toBe(400);
    expect(mockEvents).toEqual([]);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('accepts any non-empty free-text tag (BQ-2)', async () => {
    mockReply = script([verdict('OK')]);
    expect((await checkRoute.POST(req('/c', { ...CHECK_OK, tag: '@example.org' }))).status).toBe(200);
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
    expect((await checkRoute.POST(req('/c', CHECK_OK))).status).toBe(503);
    expect((await deleteRoute.POST(req('/d', DELETE_OK))).status).toBe(503);
    expect(mockEvents).toEqual([]);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ details: { reason: 'not_configured' } });
  });
});

describe('the database refuses the secret (42501) or lacks the function', () => {
  it('check: 503, logged as an error, not audited', async () => {
    mockReply = () => fail('42501', 'not authorised');
    const res = await checkRoute.POST(req('/c', CHECK_OK));
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
    const res = await checkRoute.POST(req('/c', CHECK_OK));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ verdict: 'OK', targetUserId: TARGET, functionUpToDate: true });
    expect(mockEvents).toEqual([RPC_CHECK]);
    expect(mockArgs[0]).toMatchObject({ p_mode: 'check', p_actor: null, p_secret: SECRET });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('500 with no database detail in production', async () => {
    mockReply = () => fail('42P01', 'relation "secret_table" does not exist');
    const res = await checkRoute.POST(req('/c', CHECK_OK));
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
    expect(mockEvents).toEqual([RPC_CHECK, 'facts', RPC_DELETE]);
    // The admin id comes from the gate, never the body.
    expect(mockArgs[1]).toMatchObject({ p_mode: 'delete', p_actor: ADMIN_ID, p_confirm: DELETE_OK.confirmEmail, p_secret: SECRET });
    // DE-10b.1: the receipt rides on the delete: fingerprint, the test_account reason, the admin email from the gate.
    expect(mockArgs[1].p_receipt).toMatchObject({
      email_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      fingerprint_key_version: 1,
      origin: 'admin',
      executor_kind: 'admin',
      executor_admin_email: 'ops@example.com',
      reason_category: 'test_account',
      reason_note: null,
      files_removed: 0,
    });
    expect(mockArgs[1]).not.toHaveProperty('p_subject');
    expect(mockFacts).toHaveBeenCalledWith(TARGET);
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
    expect(mockEvents).toEqual([RPC_CHECK, 'facts', 'storage:website-images:2', 'storage:contact-documents:1', RPC_DELETE]);
    expect(mockArgs[1].p_receipt).toMatchObject({ files_removed: 3 });
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
    bodies.push(await (await checkRoute.POST(req('/c', CHECK_OK))).text());
    const recorded = JSON.stringify([mockLogged, mockAudit.mock.calls.map((call) => call[0].details), bodies]);
    expect(recorded.toLowerCase()).not.toContain(EMAIL.toLowerCase());
    expect(recorded).not.toContain(TAG);
    expect(recorded).not.toContain(SECRET);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Data export DE-10b.1: the reason, the fingerprint key, the anonymise mode
// ════════════════════════════════════════════════════════════════════════════

const SUBJECT = TARGET;
const ANON_CHECK = { mode: 'anonymise', email: EMAIL, subject: SUBJECT };
const ANON_DELETE = { mode: 'anonymise', email: EMAIL, subject: SUBJECT, confirmEmail: EMAIL, reason: { category: 'customer_asked' } };
const RPC_ANON_CHECK = `rpc:${CLEANUP_RPC}:anonymise_check`;
const RPC_ANON = `rpc:${CLEANUP_RPC}:anonymise`;
const RECEIPT_ID = '99999999-9999-4999-8999-999999999999';
const note = (item: string) => ({ section: 'guard', status: 'info', item, found: 2, detail: 'Reported only: kept' });
const ANON_REPORT = {
  receipt_id: RECEIPT_ID,
  placeholder_ref: '999999999999',
  receipt_mode: 'anonymised',
  rows_removed: 7,
  tables_removed: 3,
  rows_blanked: 2,
};
/** anonymise_check -> the given rows; anonymise -> the report, unless overridden. */
const anonScript = (checkRows: unknown[], onAnon?: Reply, version = CLEANUP_FUNCTION_VERSION) =>
  (mode: string): Reply =>
    mode === 'anonymise_check'
      ? ok('anonymise_check', checkRows, version)
      : onAnon ?? { data: { version, mode: 'anonymise', rows: [], server_ms: 40, ...ANON_REPORT }, error: null };

describe('DE-10b.1 check: the anonymise mode', () => {
  it('sends the subject, no tag and no receipt, and returns blockers and notes apart', async () => {
    mockReply = anonScript([verdict('OK'), note('G-14 no consent ledger rows'), note('G-9 money in flight: unpaid invoice(s) owed to this business')]);
    const res = await checkRoute.POST(req('/c', ANON_CHECK));
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data).toMatchObject({ verdict: 'OK', blockers: [], functionUpToDate: true });
    expect(data.notes.map((n: { guard: string }) => n.guard)).toEqual(['G-14', 'G-9']);
    expect(mockEvents).toEqual([RPC_ANON_CHECK]);
    expect(mockArgs[0]).toMatchObject({ p_mode: 'anonymise_check', p_subject: SUBJECT, p_tag: '', p_actor: null });
    expect(mockArgs[0]).not.toHaveProperty('p_receipt');
  });

  it('503 on a missing secret, before any call', async () => {
    delete process.env[ENV_NAME];
    expect((await checkRoute.POST(req('/c', ANON_CHECK))).status).toBe(503);
    expect(mockEvents).toEqual([]);
  });
});

describe('DE-10b.1 delete: the reason (BQ-4, O-10)', () => {
  it.each([
    ['no reason (hard)', { mode: 'hard', email: EMAIL, tag: TAG, confirmEmail: EMAIL }],
    ['no reason (anonymise)', { ...ANON_DELETE, reason: undefined }],
    ['hard with customer_asked (O-10)', { ...DELETE_OK, reason: { category: 'customer_asked' } }],
    ['hard with other (O-10)', { ...DELETE_OK, reason: { category: 'other', note: 'Duplicate signup' } }],
    ['other without a note', { ...ANON_DELETE, reason: { category: 'other' } }],
    ['other with a 4-character note', { ...ANON_DELETE, reason: { category: 'other', note: 'abcd' } }],
    ['an unknown reason', { ...ANON_DELETE, reason: { category: 'because' } }],
    ['a tag in the anonymise mode', { ...ANON_DELETE, tag: TAG }],
    ['a subject in the hard mode', { ...DELETE_OK, subject: SUBJECT }],
    ['an origin in the body', { ...ANON_DELETE, origin: 'owner' }],
  ])('400 on %s, no repository call, nothing audited', async (_name, body) => {
    expect((await deleteRoute.POST(req('/d', body))).status).toBe(400);
    expect(mockEvents).toEqual([]);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe('DE-10b.1 delete: the order of the refusals (workplan §7.4)', () => {
  it('2. fingerprint key missing: 503 not_configured, no check, no storage, no delete; audited', async () => {
    delete process.env[KEY_ENV];
    for (const body of [DELETE_OK, ANON_DELETE]) {
      const res = await deleteRoute.POST(req('/d', body));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe('not_configured');
    }
    expect(mockEvents).toEqual([]);
    expect(mockFacts).not.toHaveBeenCalled();
    expect(mockAudit.mock.calls.map((call) => call[0].action)).toEqual([
      AUDIT_EVENTS.BUSINESS_TEST_ACCOUNT_REMOVAL_REFUSED,
      AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED,
    ]);
  });

  it('3. the cleanup secret missing: 503 before the key is even read', async () => {
    delete process.env[ENV_NAME];
    delete process.env[KEY_ENV];
    const res = await deleteRoute.POST(req('/d', ANON_DELETE));
    expect(res.status).toBe(503);
    expect(mockEvents).toEqual([]);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ action: AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED, details: { reason: 'not_configured' } });
  });

  it('anonymise happy path: check, facts, anonymise; 200 with the receipt id and the reference', async () => {
    mockReply = anonScript([verdict('OK'), note('G-5 nothing ever ran in Stripe live mode')]);
    const res = await deleteRoute.POST(req('/d', { ...ANON_DELETE, reason: { category: 'other', note: 'Asked by phone' } }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      mode: 'anonymise',
      targetUserId: TARGET,
      filesRemoved: 0,
      receiptId: RECEIPT_ID,
      placeholderRef: '999999999999',
      receiptMode: 'anonymised',
      rowsRemoved: 7,
      tablesRemoved: 3,
      rowsBlanked: 2,
      serverMs: { check: null, delete: 40 },
    });
    expect(mockEvents).toEqual([RPC_ANON_CHECK, 'facts', RPC_ANON]);
    expect(mockArgs[1]).toMatchObject({ p_mode: 'anonymise', p_subject: SUBJECT, p_actor: ADMIN_ID, p_confirm: EMAIL });
    // W-7: the admin route never sends origin owner, and the admin email comes from the gate.
    expect(mockArgs[1].p_receipt).toMatchObject({
      origin: 'admin',
      executor_kind: 'admin',
      executor_admin_email: 'ops@example.com',
      reason_category: 'other',
      reason_note: 'Asked by phone',
    });
    expect(mockArgs[1].p_receipt).not.toHaveProperty('executor_admin_id');
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('4. another function version: 503, no facts, no storage, no anonymise', async () => {
    mockReply = anonScript([verdict('BLOCKED'), blocked('G-12 no stored files under the account folder'), file('website-images', 'a.png')], undefined, 'ffffffffffffffff');
    const res = await deleteRoute.POST(req('/d', ANON_DELETE));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('function_out_of_date');
    expect(mockEvents).toEqual([RPC_ANON_CHECK]);
  });

  it('5. a blocking guard: 409, no facts, no storage, ACCOUNT_DELETION_REFUSED', async () => {
    mockReply = anonScript([verdict('BLOCKED'), blocked('G-8 no Stripe account connected for client payments'), file('website-images', 'a.png')]);
    const res = await deleteRoute.POST(req('/d', ANON_DELETE));
    expect(res.status).toBe(409);
    expect((await res.json()).guards).toEqual(['G-8']);
    expect(mockEvents).toEqual([RPC_ANON_CHECK]);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({
      action: AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED,
      entityId: TARGET,
      userId: ADMIN_ID,
      details: { mode: 'anonymise', reason: 'blocked', guards: ['G-8'], files_removed: 0 },
    });
  });

  it('6. only info notes (G-5, G-14, G-15, G-9 C3): it proceeds', async () => {
    mockReply = anonScript([
      verdict('OK'),
      note('G-5 nothing ever ran in Stripe live mode'),
      note('G-14 no consent ledger rows'),
      note('G-15 nobody else hangs below it in the invitation circle'),
      note('G-9 money in flight: unpaid invoice(s) owed to this business'),
    ]);
    expect((await deleteRoute.POST(req('/d', ANON_DELETE))).status).toBe(200);
    expect(mockEvents).toEqual([RPC_ANON_CHECK, 'facts', RPC_ANON]);
  });

  it('7. storage fails: 500 storage_failed, no anonymise', async () => {
    mockReply = anonScript([verdict('BLOCKED'), blocked('G-12 no stored files under the account folder'), file('website-images', 'a.png')]);
    const failing = jest.requireMock('@/lib/supabaseServer').supabaseServer.storage;
    const original = failing.from;
    try {
      // The Storage call throws: the repository answers an error, and the runner stops before the anonymise.
      failing.from = () => ({
        remove: async () => {
          throw new Error('storage down');
        },
      });
      const res = await deleteRoute.POST(req('/d', ANON_DELETE));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('storage_failed');
      expect(mockEvents).toEqual([RPC_ANON_CHECK, 'facts']);
    } finally {
      failing.from = original;
    }
  });

  it('8. a guard appears between storage and the anonymise (P0001): 409, "Files removed, account kept", recorded with files_removed', async () => {
    mockReply = anonScript(
      [verdict('BLOCKED'), blocked('G-12 no stored files under the account folder'), file('website-images', 'a.png')],
      fail('P0001', 'BLOCKED, nothing was removed: G-6 no live plan subscription, test or live mode')
    );
    const res = await deleteRoute.POST(req('/d', ANON_DELETE));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toMatch(/^Files removed, account kept: BLOCKED/);
    expect(body.filesRemoved).toBe(1);
    expect(mockEvents).toEqual([RPC_ANON_CHECK, 'facts', 'storage:website-images:1', RPC_ANON]);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({
      action: AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED,
      details: { reason: 'blocked', guards: ['G-6'], files_removed: 1 },
    });
  });

  it('9. the RPC refuses the secret (42501) after storage: 503 with the files-removed sentence', async () => {
    mockReply = anonScript(
      [verdict('BLOCKED'), blocked('G-12 no stored files under the account folder'), file('website-images', 'a.png')],
      fail('42501', 'not authorised')
    );
    const res = await deleteRoute.POST(req('/d', ANON_DELETE));
    expect(res.status).toBe(503);
    expect((await res.json()).message).toContain('Files removed, account kept.');
  });

  it('10. G-3 mismatch: 400 before the check', async () => {
    const res = await deleteRoute.POST(req('/d', { ...ANON_DELETE, confirmEmail: 'other@example.org' }));
    expect(res.status).toBe(400);
    expect(mockEvents).toEqual([]);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ action: AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED, details: { reason: 'confirmation_mismatch' } });
  });

  it('the export facts cannot be read: 500 receipt_failed, nothing removed', async () => {
    mockReply = anonScript([verdict('BLOCKED'), blocked('G-12 no stored files under the account folder'), file('website-images', 'a.png')]);
    mockFacts.mockResolvedValue({ data: null, error: new Error('db down') });
    const res = await deleteRoute.POST(req('/d', ANON_DELETE));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('receipt_failed');
    expect(mockEvents).toEqual([RPC_ANON_CHECK]);
  });

  it('never logs, audits or returns the email, the note or the fingerprint', async () => {
    const NOTE = 'Asked by phone on Monday';
    const bodies: string[] = [];
    mockReply = anonScript([verdict('OK')]);
    bodies.push(await (await deleteRoute.POST(req('/d', { ...ANON_DELETE, reason: { category: 'other', note: NOTE } }))).text());
    const fingerprint = String((mockArgs[1].p_receipt as Record<string, unknown>).email_fingerprint);
    mockReply = anonScript([verdict('BLOCKED'), blocked('G-8 no Stripe account connected for client payments')]);
    bodies.push(await (await deleteRoute.POST(req('/d', { ...ANON_DELETE, reason: { category: 'other', note: NOTE } }))).text());
    const recorded = JSON.stringify([mockLogged, mockAudit.mock.calls.map((call) => call[0]), bodies]);
    expect(recorded.toLowerCase()).not.toContain(EMAIL.toLowerCase());
    expect(recorded).not.toContain(NOTE);
    expect(recorded).not.toContain(fingerprint);
    expect(recorded).not.toContain(SECRET);
    expect(recorded).not.toContain(FINGERPRINT_KEY);
  });
});
