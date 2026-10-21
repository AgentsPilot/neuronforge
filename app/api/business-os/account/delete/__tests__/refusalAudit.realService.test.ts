/**
 * QA B-1 / SA addendum (2026-10-21): the refused-attempt audit row, through the
 * REAL `logAndFlush` → `AuditTrailService.buildLogEntry` → insert.
 *
 * `buildLogEntry` rewrites a NULL `userId` to `SYSTEM_ADMIN_USER_ID` and sets
 * `details.system_action: true`. The route-level suite mocks `logAndFlush` and
 * so cannot see that. Here only the Supabase client is faked (its
 * `from('audit_trail').insert(rows)` captures the rows), with the session,
 * throttle, export facts and runner mocked as in route.test.ts.
 *
 * (a) a wrong statement, (b) an engine refusal after the storage step and a
 * `not_available`, all on the session user; (c) a negative control proving the
 * harness would catch a NULL user.
 */

import { NextRequest } from 'next/server';
import { DELETION_STATEMENTS } from '@/lib/business-os/account-deletion/acknowledgement';

const FLAG = 'BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED';
const SECRET_ENV = ['TEST', 'CLEANUP', 'SECRET'].join('_');
const KEY_ENV = ['DELETION', 'RECEIPT', 'FINGERPRINT', 'KEY'].join('_');
const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SYSTEM_ADMIN = '55555555-5555-4555-8555-555555555555';
const EMAIL = 'jane.owner@example.org';

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
jest.mock('@/lib/security/rateLimit', () => {
  const actual = jest.requireActual('@/lib/security/rateLimit');
  return { ...actual, rateLimit: async () => ({ allowed: true, hits: 1, degraded: false }) };
});
jest.mock('@/lib/repositories/BusinessOsDataExportJobRepository', () => ({
  BusinessOsDataExportJobRepository: jest.fn().mockImplementation(() => ({
    findDeletionFacts: async () => ({ data: { ownerLastExportReadyAt: null, ownerExportDownloadedAt: null, adminExportExisted: false }, error: null }),
  })),
}));
const mockRun = jest.fn();
jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({
  runSelfAccountAnonymise: (...args: unknown[]) => mockRun(...args),
  runAccountDeletionCheck: jest.fn(),
  errorKindFacts: () => ({ kind: null, code: null, name: null }),
}));
jest.mock('@/lib/notifications/emailTransport', () => ({ sendEmail: async () => ({ sent: true, provider: 'resend' }) }));

import { POST } from '../route';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';

const quietLogger = { warn: () => undefined, error: () => undefined };

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/business-os/account/delete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-b1' },
  });

beforeEach(() => {
  inserted.length = 0;
  process.env[FLAG] = 'true';
  process.env[SECRET_ENV] = 's'.repeat(40);
  process.env[KEY_ENV] = 'k'.repeat(48);
  process.env.SYSTEM_ADMIN_USER_ID = SYSTEM_ADMIN;
  mockSession.mockReset().mockResolvedValue({ id: SUBJECT, email: EMAIL });
  mockRun.mockReset();
});

afterAll(() => {
  delete process.env[FLAG];
  delete process.env[SECRET_ENV];
  delete process.env[KEY_ENV];
  delete process.env.SYSTEM_ADMIN_USER_ID;
});

function refusalRows() {
  return inserted.filter((row) => row.action === AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED);
}

function expectOnSessionUser(row: Record<string, unknown>, reason: string) {
  const details = row.details as Record<string, unknown>;
  expect(row.user_id).toBe(SUBJECT);
  expect(row.actor_id).toBe(SUBJECT);
  expect(row.entity_id).toBe(SUBJECT);
  expect(row.user_id).not.toBe(SYSTEM_ADMIN);
  expect(row.actor_id).not.toBe(SYSTEM_ADMIN);
  expect(details.reason).toBe(reason);
  expect(details.source).toBe('self_service');
  expect(details.correlation_id).toBe('corr-b1');
  expect(details.system_action).toBeUndefined();
  const serialised = JSON.stringify(row);
  expect(serialised).not.toContain(EMAIL);
  expect(serialised).not.toContain(DELETION_STATEMENTS.en);
  expect(serialised).not.toMatch(/[0-9a-f]{64}/);
}

it('(a) a wrong statement: one refusal row on the session user, never the platform admin', async () => {
  const res = await POST(req({ statement: `${EMAIL} ${DELETION_STATEMENTS.en.slice(0, 20)}`, language: 'en' }));
  expect(res.status).toBe(400);
  const rows = refusalRows();
  expect(rows).toHaveLength(1);
  expectOnSessionUser(rows[0], 'statement_mismatch');
});

it('(b) an engine refusal after the storage step: on the session user, files_removed > 0', async () => {
  mockRun.mockImplementation(async (_input: unknown, prepare: (target: string) => Promise<unknown>) => {
    await prepare(SUBJECT);
    return {
      kind: 'refused',
      reason: 'blocked',
      targetUserId: SUBJECT,
      guards: ['G-9'],
      blockers: [],
      filesRemoved: 2,
      filesRemovedThenRefused: true,
      message: 'Files removed, account kept',
    };
  });
  const res = await POST(req({ statement: DELETION_STATEMENTS.en, language: 'en' }));
  expect(res.status).toBe(409);
  const rows = refusalRows();
  expect(rows).toHaveLength(1);
  expectOnSessionUser(rows[0], 'blocked');
  expect((rows[0].details as Record<string, unknown>).files_removed).toBe(2);
  expect((rows[0].details as Record<string, unknown>).guards).toEqual(['G-9']);
});

it('(b) not_available: on the session user, the engine never called', async () => {
  delete process.env[SECRET_ENV];
  const res = await POST(req({ statement: DELETION_STATEMENTS.en, language: 'en' }));
  expect(res.status).toBe(503);
  expect(mockRun).not.toHaveBeenCalled();
  const rows = refusalRows();
  expect(rows).toHaveLength(1);
  expectOnSessionUser(rows[0], 'not_available');
});

it('(c) negative control: the same harness records a NULL user as the platform admin with system_action', async () => {
  await logAndFlush(
    {
      action: AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED,
      entityType: 'user',
      entityId: SUBJECT,
      userId: null,
      actorId: null,
      details: { source: 'self_service', reason: 'statement_mismatch' },
    },
    quietLogger,
    { reason: 'negative control', continues: 'continuing' }
  );
  const rows = refusalRows();
  expect(rows).toHaveLength(1);
  expect(rows[0].user_id).toBe(SYSTEM_ADMIN);
  expect((rows[0].details as Record<string, unknown>).system_action).toBe(true);
});
