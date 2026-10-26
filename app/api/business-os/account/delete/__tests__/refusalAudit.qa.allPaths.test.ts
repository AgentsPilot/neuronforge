/**
 * QA re-test of B-1 (2026-10-21): EVERY refusal path of the delete route,
 * through the real `logAndFlush` → `AuditTrailService.buildLogEntry` → insert,
 * with `SYSTEM_ADMIN_USER_ID` set. Only the Supabase client is faked (it
 * captures the inserted rows); the session, throttle, export facts, runner and
 * email are mocked as in route.test.ts.
 *
 * Each refusal writes exactly one `ACCOUNT_DELETION_REFUSED` row with
 * user_id = actor_id = entity_id = the session user, no `system_action`, and
 * no email, statement text or 64-hex string. The success path writes no
 * route-level audit row at all (O2-3).
 */

import { NextRequest } from 'next/server';
import { DELETION_STATEMENTS } from '@/lib/business-os/account-deletion/acknowledgement';

const FLAG = 'BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED';
const SECRET_ENV = ['TEST', 'CLEANUP', 'SECRET'].join('_');
const KEY_ENV = ['DELETION', 'RECEIPT', 'FINGERPRINT', 'KEY'].join('_');
const SUBJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SYSTEM_ADMIN = '66666666-6666-4666-8666-666666666666';
const EMAIL = 'qa.subject@example.org';

const inserted: Array<Record<string, unknown>> = [];

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const l: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'debug', 'error']) l[level] = () => undefined;
    l.child = () => l;
    return l;
  };
  return { createLogger: () => make(), clientLogger: make() };
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: async (rows: Array<Record<string, unknown>>) => {
        if (table === 'audit_trail') inserted.push(...rows);
        return { error: null };
      },
    }),
  }),
}));
jest.mock('@/lib/repositories/ArchiveRepository', () => ({ archiveRepository: {} }));

const mockSession = jest.fn();
jest.mock('@/lib/business-os/account-deletion/sessionSubject', () => {
  const actual = jest.requireActual('@/lib/business-os/account-deletion/sessionSubject');
  return { ...actual, readSessionSubject: () => mockSession() };
});
const mockRateLimit = jest.fn();
jest.mock('@/lib/security/rateLimit', () => {
  const actual = jest.requireActual('@/lib/security/rateLimit');
  return { ...actual, rateLimit: (...args: unknown[]) => mockRateLimit(...args) };
});
const mockFacts = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportJobRepository', () => ({
  BusinessOsDataExportJobRepository: jest.fn().mockImplementation(() => ({ findDeletionFacts: (...a: unknown[]) => mockFacts(...a) })),
}));
const mockRun = jest.fn();
jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({
  runSelfAccountAnonymise: (...args: unknown[]) => mockRun(...args),
  runAccountDeletionCheck: jest.fn(),
  errorKindFacts: () => ({ kind: null, code: null, name: null }),
}));
jest.mock('@/lib/notifications/emailTransport', () => ({ sendEmail: async () => ({ sent: true, provider: 'resend' }) }));

import { POST } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/business-os/account/delete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-qa' },
  });
const OK = { statement: DELETION_STATEMENTS.he, language: 'he' };

const FACTS_OK = { data: { ownerLastExportReadyAt: null, ownerExportDownloadedAt: null, adminExportExisted: false }, error: null };

beforeEach(() => {
  inserted.length = 0;
  process.env[FLAG] = 'true';
  process.env[SECRET_ENV] = 's'.repeat(40);
  process.env[KEY_ENV] = 'k'.repeat(48);
  process.env.SYSTEM_ADMIN_USER_ID = SYSTEM_ADMIN;
  mockSession.mockReset().mockResolvedValue({ id: SUBJECT, email: EMAIL });
  mockRateLimit.mockReset().mockResolvedValue({ allowed: true, hits: 1, degraded: false });
  mockFacts.mockReset().mockResolvedValue(FACTS_OK);
  mockRun.mockReset();
});

afterAll(() => {
  delete process.env[FLAG];
  delete process.env[SECRET_ENV];
  delete process.env[KEY_ENV];
  delete process.env.SYSTEM_ADMIN_USER_ID;
});

const refusals = () => inserted.filter((row) => row.action === AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED);

function expectOneOnSubject(reason: string) {
  const rows = refusals();
  expect(rows).toHaveLength(1);
  const [row] = rows;
  const details = row.details as Record<string, unknown>;
  expect(row.user_id).toBe(SUBJECT);
  expect(row.actor_id).toBe(SUBJECT);
  expect(row.entity_id).toBe(SUBJECT);
  expect(row.entity_type).toBe('user');
  expect(details.system_action).toBeUndefined();
  expect(details.source).toBe('self_service');
  expect(details.reason).toBe(reason);
  const serialised = JSON.stringify(row);
  expect(serialised).not.toContain(SYSTEM_ADMIN);
  expect(serialised).not.toContain(EMAIL);
  expect(serialised).not.toContain(DELETION_STATEMENTS.he);
  expect(serialised).not.toContain(DELETION_STATEMENTS.en);
  expect(serialised).not.toMatch(/[0-9a-f]{64}/);
  return details;
}

it('wrong statement past the failure budget (429) still writes its row on the subject', async () => {
  mockRateLimit.mockImplementation(async (_r: unknown, _route: string, _rule: unknown, outcome = 'ok') => ({
    allowed: outcome === 'ok',
    hits: 11,
    degraded: false,
  }));
  expect((await POST(req({ statement: `${EMAIL} nope`, language: 'en' }))).status).toBe(429);
  expectOneOnSubject('statement_mismatch');
});

it('no login email (V-1) → 503, row on the subject', async () => {
  mockSession.mockResolvedValue({ id: SUBJECT, email: null });
  expect((await POST(req(OK))).status).toBe(503);
  expectOneOnSubject('not_available');
});

it('missing fingerprint key → 503, row on the subject', async () => {
  delete process.env[KEY_ENV];
  expect((await POST(req(OK))).status).toBe(503);
  expectOneOnSubject('not_available');
});

it('export facts unreadable → 500, row on the subject, engine not called', async () => {
  mockFacts.mockResolvedValue({ data: null, error: new Error('db down') });
  expect((await POST(req(OK))).status).toBe(500);
  expect(mockRun).not.toHaveBeenCalled();
  expectOneOnSubject('facts_failed');
});

it('blocked on the check (G-8) → 409, row on the subject with the guard id', async () => {
  mockRun.mockResolvedValue({
    kind: 'refused',
    reason: 'blocked',
    targetUserId: SUBJECT,
    guards: ['G-8'],
    blockers: [{ guard: 'G-8', item: 'Stripe Connect account', found: 1 }],
    filesRemoved: 0,
    filesRemovedThenRefused: false,
  });
  expect((await POST(req(OK))).status).toBe(409);
  expect(expectOneOnSubject('blocked').guards).toEqual(['G-8']);
});

it('engine unavailable after storage → 503, row on the subject with files_removed', async () => {
  mockRun.mockResolvedValue({ kind: 'unavailable', reason: 'function_out_of_date', error: null, filesRemoved: 3 });
  expect((await POST(req(OK))).status).toBe(503);
  expect(expectOneOnSubject('function_out_of_date').files_removed).toBe(3);
});

it('engine failed at the storage stage → 500, row on the subject', async () => {
  mockRun.mockResolvedValue({ kind: 'failed', stage: 'storage', error: new Error(`boom ${EMAIL}`), filesRemoved: 1 });
  expect((await POST(req(OK))).status).toBe(500);
  expectOneOnSubject('storage_failed');
});

it('engine throws (message holds the email) → 500, row on the subject, message not recorded', async () => {
  mockRun.mockRejectedValue(new Error(`unexpected for ${EMAIL}`));
  expect((await POST(req(OK))).status).toBe(500);
  expectOneOnSubject('unexpected_failed');
});

it('the receipt callback finds another login → 500 receipt stage, row on the SESSION user (never the other id)', async () => {
  const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  mockRun.mockImplementation(async (_input: unknown, prepare: (target: string) => Promise<unknown>) => {
    try {
      await prepare(OTHER);
    } catch (error) {
      return { kind: 'failed', stage: 'receipt', error, filesRemoved: 0 };
    }
    throw new Error('the callback should have thrown');
  });
  expect((await POST(req(OK))).status).toBe(500);
  expectOneOnSubject('receipt_failed');
  expect(JSON.stringify(refusals()[0])).not.toContain(OTHER);
});

it('success writes no route-level audit row', async () => {
  mockRun.mockImplementation(async (_input: unknown, prepare: (target: string) => Promise<unknown>) => {
    await prepare(SUBJECT);
    return {
      kind: 'anonymised',
      targetUserId: SUBJECT,
      filesRemoved: 0,
      report: { receiptId: 'r', placeholderRef: '0123456789ab', receiptMode: 'anonymised', rowsRemoved: 1, tablesRemoved: 1, rowsBlanked: 0 },
      notes: [],
      serverMs: { check: 1, delete: 1 },
    };
  });
  expect((await POST(req(OK))).status).toBe(200);
  expect(inserted).toHaveLength(0);
});
