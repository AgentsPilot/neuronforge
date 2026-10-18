/**
 * QA, data export DE-10b.1: no email, reason note, fingerprint, secret or key
 * in ANY log line, refused-audit row or response body, on EVERY path of the
 * admin cleanup routes (workplan §7.4 last bullet, SA "What QA must exercise"
 * item 10).
 *
 * route.test.ts scans two paths per mode. This file walks every refusal the
 * delete route has in the anonymise mode (and the hard-mode refusals that
 * carry a reason), plus the anonymise check, and scans everything that left
 * the handler at once. Same fakes as route.test.ts: the real routes, the real
 * repository, the real runners, a fake service-role client. No database.
 *
 * The injected database errors are shaped like real ones. The routes log a
 * database error's `message` as it comes back (the existing pattern), and no
 * message the cleanup function or PostgREST can raise holds the email today:
 * the function's RAISE texts name guards and tables only.
 */

import { NextRequest } from 'next/server';
import { CLEANUP_FUNCTION_VERSION } from '@/lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated';

const ENV_NAME = ['TEST', 'CLEANUP', 'SECRET'].join('_');
const KEY_ENV = ['DELETION', 'RECEIPT', 'FINGERPRINT', 'KEY'].join('_');
const SECRET = 'e'.repeat(64);
const FINGERPRINT_KEY = 'q'.repeat(48);
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const SUBJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
// Distinctive values, so a leak cannot hide behind a common substring.
const EMAIL = 'Zelda.Quill.Customer@example.org';
const TYPO = 'zelda.quill.customer@example.or';
const NOTE = 'Rang on Tuesday from her mobile';
const TAG = '+zqtag';

const mockGate = jest.fn();
jest.mock('@/lib/admin/requireAdminRoute', () => ({ requireAdmin: () => mockGate() }));

const mockLogged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug', 'fatal', 'trace']) logger[level] = (...args: unknown[]) => mockLogged.push(...args);
  logger.child = (...args: unknown[]) => {
    mockLogged.push(...args);
    return logger;
  };
  return { createLogger: () => logger };
});

const mockAudit = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...args: unknown[]) => mockAudit(...args) }));

const mockFacts = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportJobRepository', () => ({
  BusinessOsDataExportJobRepository: jest.fn().mockImplementation(() => ({ findDeletionFacts: (...args: unknown[]) => mockFacts(...args) })),
}));

type Reply = { data: unknown; error: { code: string; message: string } | null };
const mockArgs: Array<Record<string, unknown>> = [];
let mockReply: (mode: string) => Reply = () => ({ data: null, error: null });
let mockStorageThrows = false;
let mockRpcThrows = false;
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      mockArgs.push(args);
      if (mockRpcThrows) throw new Error('socket hang up');
      return mockReply(String(args.p_mode));
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          if (mockStorageThrows) throw new Error('storage down');
          return { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
  },
}));

import * as checkRoute from '../check/route';
import * as deleteRoute from '../delete/route';

const req = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const verdict = (status: 'OK' | 'BLOCKED') => ({ section: 'VERDICT', status, item: `login ${SUBJECT}`, found: 0, detail: '' });
const blocked = (item: string) => ({ section: 'guard', status: 'BLOCKED', item, found: 1, detail: 'how to clear' });
const note = (item: string) => ({ section: 'guard', status: 'info', item, found: 2, detail: 'Reported only: kept' });
const file = (name: string) => ({ section: 'storage', status: 'empty this folder', item: `website-images/${SUBJECT}/${name}`, found: null, detail: '' });
const fail = (code: string, message: string): Reply => ({ data: null, error: { code, message } });
const anonOk: Reply = {
  data: {
    version: CLEANUP_FUNCTION_VERSION, mode: 'anonymise', rows: [], server_ms: 12, receipt_id: '99999999-9999-4999-8999-999999999999',
    placeholder_ref: '999999999999', receipt_mode: 'anonymised', rows_removed: 3, tables_removed: 2, rows_blanked: 1,
  },
  error: null,
};
const anonScript = (checkRows: unknown[], onAnon: Reply = anonOk, version = CLEANUP_FUNCTION_VERSION) => (mode: string): Reply =>
  mode === 'anonymise_check' ? { data: { version, mode, rows: checkRows }, error: null } : onAnon;
const hardScript = (checkRows: unknown[]) => (mode: string): Reply =>
  mode === 'check' ? { data: { version: CLEANUP_FUNCTION_VERSION, mode, rows: checkRows }, error: null } : fail('P0001', 'BLOCKED, nothing was removed: G-4 not a platform admin');

const ANON = { mode: 'anonymise', email: EMAIL, subject: SUBJECT, confirmEmail: EMAIL, reason: { category: 'other', note: NOTE } };
const HARD = { mode: 'hard', email: EMAIL, tag: TAG, confirmEmail: EMAIL, reason: { category: 'test_account' } };
const G12 = [verdict('BLOCKED'), blocked('G-12 no stored files under the account folder'), file('a.png')];

beforeEach(() => {
  mockGate.mockReset().mockResolvedValue({ user: { id: ADMIN_ID, email: 'ops@example.com' } });
  mockAudit.mockReset().mockResolvedValue(undefined);
  mockArgs.length = 0;
  mockLogged.length = 0;
  mockStorageThrows = false;
  mockRpcThrows = false;
  mockReply = () => ({ data: null, error: null });
  mockFacts.mockReset().mockResolvedValue({ data: { ownerLastExportReadyAt: null, ownerExportDownloadedAt: null, adminExportExisted: false }, error: null });
  process.env[ENV_NAME] = SECRET;
  process.env[KEY_ENV] = FINGERPRINT_KEY;
});
afterAll(() => {
  delete process.env[ENV_NAME];
  delete process.env[KEY_ENV];
});

/** Every value that must never leave the handler, for one recorded run. */
function expectNoLeak(bodies: string[], extra: string[] = []) {
  const recorded = JSON.stringify([mockLogged.map((x) => (x instanceof Error ? x.message : x)), mockAudit.mock.calls.map((call) => call[0]), bodies]);
  const lower = recorded.toLowerCase();
  for (const value of [EMAIL, TYPO, NOTE, TAG, SECRET, FINGERPRINT_KEY, ...extra]) {
    expect(lower).not.toContain(value.toLowerCase());
  }
}

describe('QA DE-10b.1: no PII on any path of the anonymise delete', () => {
  it.each<[string, () => void, number, Record<string, unknown> | undefined]>([
    ['the happy path', () => { mockReply = anonScript([verdict('OK'), note('G-14 no consent ledger rows')]); }, 200, undefined],
    ['G-3 mismatch (400)', () => undefined, 400, { confirmEmail: TYPO }],
    ['the cleanup secret missing (503)', () => { delete process.env[ENV_NAME]; }, 503, undefined],
    ['the fingerprint key missing (503 not_configured)', () => { delete process.env[KEY_ENV]; }, 503, undefined],
    ['the fingerprint key too short (503 not_configured)', () => { process.env[KEY_ENV] = 'short'; }, 503, undefined],
    ['another function version (503)', () => { mockReply = anonScript([verdict('OK')], anonOk, 'ffffffffffffffff'); }, 503, undefined],
    ['a blocking guard on the check (409)', () => { mockReply = anonScript([verdict('BLOCKED'), blocked('G-8 no Stripe account connected for client payments')]); }, 409, undefined],
    ['the check fails with a database error (500)', () => { mockReply = () => fail('57014', 'canceling statement due to statement timeout'); }, 500, undefined],
    ['the export facts fail (500 receipt_failed)', () => { mockReply = anonScript(G12); mockFacts.mockResolvedValue({ data: null, error: new Error('db down') }); }, 500, undefined],
    ['storage fails (500 storage_failed)', () => { mockReply = anonScript(G12); mockStorageThrows = true; }, 500, undefined],
    ['a guard appears after storage (409)', () => { mockReply = anonScript(G12, fail('P0001', 'BLOCKED, nothing was removed: G-6 no live plan subscription, test or live mode')); }, 409, undefined],
    ['the secret refused after storage (503)', () => { mockReply = anonScript(G12, fail('42501', 'not authorised')); }, 503, undefined],
    ['an integrity raise in the anonymise (409)', () => { mockReply = anonScript([verdict('OK')], fail('P0001', 'A blanked value is still there, so everything was rolled back: token_usage.error_message')); }, 409, undefined],
    ['a database error in the anonymise (500)', () => { mockReply = anonScript([verdict('OK')], fail('23514', 'new row for relation "business_os_deletion_receipts" violates check constraint "business_os_deletion_receipts_reason_note_shape"')); }, 500, undefined],
    ['an unexpected throw (500)', () => { mockRpcThrows = true; }, 500, undefined],
  ])('%s', async (_name, arrange, status, override) => {
    arrange();
    const res = await deleteRoute.POST(req('/d', { ...ANON, ...(override ?? {}) }));
    expect(res.status).toBe(status);
    const fingerprint = mockArgs.map((a) => (a.p_receipt as Record<string, unknown> | undefined)?.email_fingerprint).find(Boolean);
    expectNoLeak([await res.text()], typeof fingerprint === 'string' ? [fingerprint] : []);
  });

  it('the refused rows carry ids and reason codes only (deep scan of every refused row)', async () => {
    mockReply = anonScript([verdict('BLOCKED'), blocked('G-8 no Stripe account connected for client payments')]);
    await deleteRoute.POST(req('/d', ANON));
    await deleteRoute.POST(req('/d', { ...ANON, confirmEmail: TYPO }));
    delete process.env[KEY_ENV];
    await deleteRoute.POST(req('/d', ANON));
    expect(mockAudit).toHaveBeenCalledTimes(3);
    for (const [entry] of mockAudit.mock.calls) {
      expect(JSON.stringify(entry).toLowerCase()).not.toMatch(/zelda|quill|tuesday|mobile/);
    }
  });
});

describe('QA DE-10b.1: no PII on the hard-mode refusals and the anonymise check', () => {
  it.each<[string, () => void, number, Record<string, unknown> | undefined]>([
    ['hard: the fingerprint key missing (503)', () => { delete process.env[KEY_ENV]; }, 503, undefined],
    ['hard: G-3 mismatch (400)', () => undefined, 400, { confirmEmail: TYPO }],
    ['hard: blocked on the check (409)', () => { mockReply = hardScript([verdict('BLOCKED'), blocked('G-4 not a platform admin')]); }, 409, undefined],
    ['hard: the export facts fail (500)', () => { mockReply = hardScript([verdict('OK')]); mockFacts.mockResolvedValue({ data: null, error: new Error('db down') }); }, 500, undefined],
  ])('%s', async (_name, arrange, status, override) => {
    arrange();
    const res = await deleteRoute.POST(req('/d', { ...HARD, ...(override ?? {}) }));
    expect(res.status).toBe(status);
    expectNoLeak([await res.text()]);
  });

  it('the anonymise check: OK, blocked and a database error', async () => {
    const bodies: string[] = [];
    mockReply = anonScript([verdict('OK'), note('G-9 money in flight: unpaid invoice(s) owed to this business')]);
    bodies.push(await (await checkRoute.POST(req('/c', { mode: 'anonymise', email: EMAIL, subject: SUBJECT }))).text());
    mockReply = anonScript([verdict('BLOCKED'), blocked('G-2a the account id and the email name the same login')]);
    bodies.push(await (await checkRoute.POST(req('/c', { mode: 'anonymise', email: EMAIL, subject: SUBJECT }))).text());
    mockReply = () => fail('57014', 'canceling statement due to statement timeout');
    bodies.push(await (await checkRoute.POST(req('/c', { mode: 'anonymise', email: EMAIL, subject: SUBJECT }))).text());
    expectNoLeak(bodies);
  });
});
