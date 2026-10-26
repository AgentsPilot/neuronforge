/**
 * POST /api/business-os/account/delete (data export DE-10b.2; workplan §4.2
 * R-1 … R-15; SA V-1, V-3, V-5, V-6, V-7).
 *
 * The real route, Zod schema, statement matcher, receipt builder, fingerprint
 * and cookie helper, over mocked edges: the session, the throttle, the export
 * facts, the self-service runner (which calls the route's receipt callback as
 * the real runner does), the email and the audit flush. Every case asserts
 * which later steps did NOT run (V-6).
 */

import { NextRequest } from 'next/server';
import { DELETION_STATEMENTS } from '@/lib/business-os/account-deletion/acknowledgement';

const FLAG = 'BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED';
const SECRET_ENV = ['TEST', 'CLEANUP', 'SECRET'].join('_');
const KEY_ENV = ['DELETION', 'RECEIPT', 'FINGERPRINT', 'KEY'].join('_');
const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMAIL = 'jane.owner@example.org';
const REF = 'projref123';

const events: string[] = [];

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
  BusinessOsDataExportJobRepository: jest.fn().mockImplementation(() => ({ findDeletionFacts: (...args: unknown[]) => mockFacts(...args) })),
}));

type Prepare = (target: string) => Promise<Record<string, unknown>>;
const mockRun = jest.fn();
const receipts: Array<Record<string, unknown>> = [];
jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({
  runSelfAccountAnonymise: (...args: unknown[]) => mockRun(...args),
  runAccountDeletionCheck: jest.fn(),
  errorKindFacts: (err: unknown) => ({ kind: null, code: null, name: err instanceof Error ? err.name : null }),
}));

const mockSend = jest.fn();
jest.mock('@/lib/notifications/emailTransport', () => ({ sendEmail: (...args: unknown[]) => mockSend(...args) }));

const mockAudit = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...args: unknown[]) => mockAudit(...args) }));

import { POST } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';

const ANONYMISED = {
  kind: 'anonymised',
  targetUserId: SUBJECT,
  filesRemoved: 2,
  report: { receiptId: 'rcpt-1', placeholderRef: '0123456789ab', receiptMode: 'anonymised', rowsRemoved: 9, tablesRemoved: 3, rowsBlanked: 1 },
  notes: [],
  serverMs: { check: 3, delete: 9 },
};

/** The runner, as the real one: it prepares the receipt for the resolved login before anything else. */
function runnerReturning(outcome: unknown, target = SUBJECT) {
  return async (input: unknown, prepare: Prepare) => {
    events.push('engine');
    receipts.push(await prepare(target));
    return outcome;
  };
}

function req(body: unknown, opts: { raw?: string; cookie?: string } = {}) {
  return new NextRequest('http://localhost/api/business-os/account/delete', {
    method: 'POST',
    body: opts.raw ?? JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-7', ...(opts.cookie ? { cookie: opts.cookie } : {}) },
  });
}

const OK_BODY = { statement: DELETION_STATEMENTS.en, language: 'en' };

beforeEach(() => {
  events.length = 0;
  receipts.length = 0;
  mockLogged.length = 0;
  process.env[FLAG] = 'true';
  process.env[SECRET_ENV] = 's'.repeat(40);
  process.env[KEY_ENV] = 'k'.repeat(48);
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${REF}.supabase.co`;
  mockSession.mockReset().mockImplementation(async () => {
    events.push('session');
    return { id: SUBJECT, email: EMAIL };
  });
  mockRateLimit.mockReset().mockImplementation(async (_req: unknown, route: string, _rule: unknown, outcome = 'ok') => {
    events.push(`rate:${outcome}:${route}`);
    return { allowed: true, hits: 1, degraded: false };
  });
  mockFacts.mockReset().mockImplementation(async (id: string) => {
    events.push(`facts:${id}`);
    return { data: { ownerLastExportReadyAt: null, ownerExportDownloadedAt: null, adminExportExisted: false }, error: null };
  });
  mockRun.mockReset().mockImplementation(runnerReturning(ANONYMISED));
  mockSend.mockReset().mockImplementation(async () => {
    events.push('email');
    return { sent: true, provider: 'resend' };
  });
  mockAudit.mockReset().mockImplementation(async () => {
    events.push('audit');
  });
});

afterAll(() => {
  delete process.env[FLAG];
  delete process.env[SECRET_ENV];
  delete process.env[KEY_ENV];
});

const did = (prefix: string) => events.some((event) => event.startsWith(prefix));

describe('R-1 the off switch', () => {
  it.each([undefined, 'false', '1'])('%p → 404 before the session is read', async (value) => {
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(404);
    expect(events).toEqual([]);
  });
});

describe('R-2 no session', () => {
  it('401, nothing else runs', async () => {
    mockSession.mockImplementation(async () => {
      events.push('session');
      return null;
    });
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(401);
    expect(events).toEqual(['session']);
  });

  it('a session read that throws is a 401 too', async () => {
    mockSession.mockRejectedValue(new Error('auth down'));
    expect((await POST(req(OK_BODY))).status).toBe(401);
    expect(did('rate')).toBe(false);
  });
});

describe('R-3 the body is .strict()', () => {
  it.each([
    [{ ...OK_BODY, email: 'other@example.org' }],
    [{ ...OK_BODY, userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
    [{ ...OK_BODY, extra: 1 }],
    [{ statement: DELETION_STATEMENTS.en }],
    [{ ...OK_BODY, language: 'fr' }],
    [{ ...OK_BODY, statement: '' }],
    [{ ...OK_BODY, statement: 'x'.repeat(501) }],
  ])('%j → 400, no throttle, no engine', async (body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(events).toEqual(['session']);
  });

  it('invalid JSON → 400', async () => {
    expect((await POST(req(null, { raw: '{' }))).status).toBe(400);
    expect(did('rate')).toBe(false);
  });
});

describe('R-14 the throttle comes before the statement', () => {
  it('429, no statement check, no audit, no engine', async () => {
    mockRateLimit.mockImplementation(async () => ({ allowed: false, hits: 21, degraded: false }));
    const res = await POST(req({ ...OK_BODY, statement: 'wrong' }));
    expect(res.status).toBe(429);
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockAudit).not.toHaveBeenCalled();
    expect(did('engine')).toBe(false);
  });

  it('the key is per account (hashed) and the rule is the write rule', async () => {
    await POST(req(OK_BODY));
    const [, route, rule] = mockRateLimit.mock.calls[0];
    expect(route).toMatch(/^account-delete:[0-9a-f]{16}$/);
    expect(route).not.toContain(SUBJECT);
    expect(rule).toEqual({ limit: 20, failureLimit: 10, windowSeconds: 300 });
  });
});

describe('R-4 a wrong statement', () => {
  it('400, counted in the failure budget, audited with the reason only, nothing else', async () => {
    const res = await POST(req({ ...OK_BODY, statement: 'I want my account deleted' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('statement_mismatch');
    expect(events.filter((e) => e.startsWith('rate:failure'))).toHaveLength(1);
    expect(did('facts')).toBe(false);
    expect(did('engine')).toBe(false);
    const [entry] = mockAudit.mock.calls[0];
    expect(entry).toMatchObject({
      action: AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED,
      entityType: 'user',
      entityId: SUBJECT,
      userId: SUBJECT,
      actorId: SUBJECT,
      details: { source: 'self_service', reason: 'statement_mismatch', guards: [], files_removed: 0 },
    });
    expect(JSON.stringify(entry.details)).not.toContain('deleted');
  });

  it('once the failure budget is spent → 429', async () => {
    mockRateLimit.mockImplementation(async (_r: unknown, _route: string, _rule: unknown, outcome = 'ok') => ({
      allowed: outcome === 'ok',
      hits: 11,
      degraded: false,
    }));
    expect((await POST(req({ ...OK_BODY, statement: 'nope' }))).status).toBe(429);
    expect(did('engine')).toBe(false);
  });
});

describe('R-5 tolerated differences are accepted', () => {
  it.each([
    ['case and spaces', `  ${DELETION_STATEMENTS.en.toUpperCase().replace(/ /g, '  ')} `, 'en'],
    ['marks and niqqud', `‏${DELETION_STATEMENTS.he.replace('הורדתי', 'הוֹרַדְתִּי')}​`, 'he'],
    ['English typed in the Hebrew UI', DELETION_STATEMENTS.en, 'he'],
  ])('%s', async (_name, statement, language) => {
    const res = await POST(req({ statement, language }));
    expect(res.status).toBe(200);
  });

  it('V-5: the receipt records the MATCHED language and the exact typed text, not the UI language', async () => {
    const typed = ` ${DELETION_STATEMENTS.en} `;
    await POST(req({ statement: typed, language: 'he' }));
    expect(receipts[0]).toMatchObject({ statement_language: 'en', statement_text: typed });
    expect((await POST(req({ statement: DELETION_STATEMENTS.en, language: 'he' }))).status).toBe(200);
  });
});

describe('R-6 not available', () => {
  it.each([
    ['the cleanup secret', () => delete process.env[SECRET_ENV]],
    ['the fingerprint key', () => delete process.env[KEY_ENV]],
    ['a short fingerprint key', () => (process.env[KEY_ENV] = 'short')],
    ['a login email (V-1)', () => mockSession.mockResolvedValue({ id: SUBJECT, email: null })],
  ])('missing %s → 503 not_available, no facts, no engine', async (_name, arrange) => {
    arrange();
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('not_available');
    expect(did('facts')).toBe(false);
    expect(did('engine')).toBe(false);
    expect(mockAudit.mock.calls[0][0].details.reason).toBe('not_available');
  });
});

describe('V-6 the order', () => {
  it('session → throttle → facts → engine → email', async () => {
    await POST(req(OK_BODY));
    expect(events.filter((e) => !e.startsWith('audit'))).toEqual([
      'session',
      expect.stringMatching(/^rate:ok:account-delete:/),
      `facts:${SUBJECT}`,
      'engine',
      'email',
    ]);
  });

  it('a facts failure → 500, no engine', async () => {
    mockFacts.mockResolvedValue({ data: null, error: new Error('db') });
    expect((await POST(req(OK_BODY))).status).toBe(500);
    expect(did('engine')).toBe(false);
  });
});

describe('R-7 blocked on the check', () => {
  it('409 with plain-word codes, no files removed, audited', async () => {
    mockRun.mockImplementation(async () => {
      events.push('engine');
      return {
        kind: 'refused',
        reason: 'blocked',
        targetUserId: SUBJECT,
        guards: ['G-6', 'G-8', 'G-9'],
        blockers: [
          { guard: 'G-6', item: 'no live plan subscription', found: 1, clears: '' },
          { guard: 'G-8', item: 'no Stripe account connected', found: 1, clears: '' },
          { guard: 'G-9', item: 'money in flight: recurring payment plan(s) still running', found: 2, clears: '' },
        ],
        filesRemoved: 0,
        filesRemovedThenRefused: false,
        message: 'BLOCKED',
      };
    });
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({
      error: 'blocked',
      filesRemoved: false,
      blockers: [{ code: 'plan_running' }, { code: 'stripe_connected' }, { code: 'client_plans_running', count: 2 }],
    });
    expect(did('email')).toBe(false);
    expect(mockAudit.mock.calls[0][0].details).toMatchObject({ reason: 'blocked', guards: ['G-6', 'G-8', 'G-9'], files_removed: 0 });
  });
});

describe('R-8 notes only → proceeds', () => {
  it('a sent invoice, consent rows and past payments do not block', async () => {
    mockRun.mockImplementation(
      runnerReturning({ ...ANONYMISED, notes: [{ guard: 'G-9' }, { guard: 'G-14' }, { guard: 'G-5' }], report: { ...ANONYMISED.report, receiptMode: 'pseudonymised_billing_kept' } })
    );
    expect((await POST(req(OK_BODY))).status).toBe(200);
  });
});

describe('R-9 the subject comes from the session only', () => {
  it('the runner gets the session id and email', async () => {
    await POST(req(OK_BODY));
    expect(mockRun.mock.calls[0][0]).toEqual({ email: EMAIL, subject: SUBJECT });
  });

  it('a check that resolved another login stops before any file goes (receipt stage)', async () => {
    mockRun.mockImplementation(async (_input: unknown, prepare: Prepare) => {
      try {
        await prepare('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
        return ANONYMISED;
      } catch (error) {
        return { kind: 'failed', stage: 'receipt', targetUserId: null, filesRemoved: 0, error };
      }
    });
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).filesRemoved).toBe(false);
  });
});

describe('R-10 the receipt', () => {
  it('origin owner, self-service, fingerprint, export facts copied; "no export on record" when empty (N-3)', async () => {
    await POST(req(OK_BODY));
    expect(receipts[0]).toMatchObject({
      origin: 'owner',
      executor_kind: 'self_service',
      executor_admin_email: null,
      reason_category: null,
      statement_language: 'en',
      statement_text: DELETION_STATEMENTS.en,
      owner_last_export_ready_at: null,
      owner_export_downloaded_at: null,
      admin_export_existed: false,
      correlation_id: 'corr-7',
    });
    expect(receipts[0].email_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('export facts are copied when present', async () => {
    mockFacts.mockResolvedValue({
      data: { ownerLastExportReadyAt: '2026-10-10 10:00:00+00', ownerExportDownloadedAt: '2026-10-10T11:00:00Z', adminExportExisted: true },
      error: null,
    });
    await POST(req(OK_BODY));
    expect(receipts[0]).toMatchObject({
      owner_last_export_ready_at: '2026-10-10T10:00:00.000Z',
      owner_export_downloaded_at: '2026-10-10T11:00:00.000Z',
      admin_export_existed: true,
    });
  });
});

describe('R-11 blocked after the storage step (C2-11)', () => {
  it('409 with filesRemoved true, audited with files_removed', async () => {
    mockRun.mockImplementation(
      runnerReturning({
        kind: 'refused',
        reason: 'blocked',
        targetUserId: SUBJECT,
        guards: ['G-9'],
        blockers: [],
        filesRemoved: 3,
        filesRemovedThenRefused: true,
        message: 'Files removed, account kept',
      })
    );
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ filesRemoved: true, blockers: [{ code: 'contact_support' }] });
    expect(mockAudit.mock.calls[0][0].details).toMatchObject({ files_removed: 3 });
    expect(did('email')).toBe(false);
  });

  it('unavailable after storage → 503 and says files went; a delete failure → 500', async () => {
    mockRun.mockImplementation(runnerReturning({ kind: 'unavailable', reason: 'not_authorised', targetUserId: SUBJECT, filesRemoved: 1, error: null }));
    let res = await POST(req(OK_BODY));
    expect(res.status).toBe(503);
    expect((await res.json()).filesRemoved).toBe(true);
    mockRun.mockImplementation(runnerReturning({ kind: 'failed', stage: 'delete', targetUserId: SUBJECT, filesRemoved: 0, error: new Error('x') }));
    res = await POST(req(OK_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).filesRemoved).toBe(false);
  });
});

describe('R-12 success', () => {
  it('200 + redirect, no-store, the session cookies expired (and nothing else), one email to the old address', async () => {
    const res = await POST(
      req({ statement: DELETION_STATEMENTS.he, language: 'he' }, { cookie: `sb-${REF}-auth-token.0=a; sb-${REF}-auth-token.1=b; bos_language=he` })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { redirect: '/account-deleted?lang=he' } });
    expect(res.headers.get('cache-control')).toContain('no-store');
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const line of cookies) {
      expect(line).toMatch(new RegExp(`^sb-${REF}-auth-token\\.[01]=;`));
      expect(line).toMatch(/Max-Age=0/);
    }
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toMatchObject({ to: [EMAIL], kind: 'transactional', redactRecipientInLogs: true });
    expect(mockSend.mock.calls[0][0].html).toContain('dir="rtl"');
    expect(mockSend.mock.calls[0][0]).not.toHaveProperty('ownerUserId');
    // O2-3: no route-level success audit row; the function writes ACCOUNT_PSEUDONYMISED.
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe('R-13 the email never changes the 200', () => {
  it.each([
    ['rejects', () => mockSend.mockRejectedValue(new Error(`bounce for ${EMAIL}`))],
    ['returns sent: false', () => mockSend.mockResolvedValue({ sent: false, provider: 'none', error: `no ${EMAIL}` })],
  ])('sendEmail %s → still 200, ids-only log', async (_name, arrange) => {
    arrange();
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(200);
    expect(JSON.stringify(mockLogged)).not.toContain(EMAIL);
  });
});

describe('R-15 privacy scan', () => {
  it('no log or audit argument holds the email, the statement text or a 64-hex fingerprint; refusal rows are on the session user', async () => {
    const statementWithMark = `${DELETION_STATEMENTS.en}`;
    const scenarios: Array<() => void> = [
      () => undefined,
      () => mockRun.mockImplementation(runnerReturning({ kind: 'failed', stage: 'storage', targetUserId: SUBJECT, filesRemoved: 0, error: new Error(EMAIL) })),
      () => mockRun.mockImplementation(async () => Promise.reject(new Error(`boom ${EMAIL}`))),
    ];
    for (const arrange of scenarios) {
      arrange();
      await POST(req({ statement: statementWithMark, language: 'en' }));
      await POST(req({ statement: `${EMAIL} please delete`, language: 'en' }));
    }
    const everything = JSON.stringify([mockLogged, mockAudit.mock.calls.map((call) => call[0])]);
    expect(everything).not.toContain(EMAIL);
    expect(everything).not.toContain(DELETION_STATEMENTS.en);
    expect(everything).not.toMatch(/[0-9a-f]{64}/);
    for (const [entry] of mockAudit.mock.calls) {
      // SA addendum B-1: every refusal row is on the session user.
      expect(entry.userId).toBe(SUBJECT);
      expect(entry.actorId).toBe(SUBJECT);
      expect(entry.entityId).toBe(SUBJECT);
    }
  });
});

describe('SA code review N-1, N-2, N-6', () => {
  it('N-1: a refusal whose rows all map to nothing (G-12 only) still names contact_support', async () => {
    mockRun.mockImplementation(
      runnerReturning({
        kind: 'refused',
        reason: 'blocked',
        targetUserId: SUBJECT,
        guards: ['G-12'],
        blockers: [{ guard: 'G-12', item: 'files', found: 2, clears: '' }],
        filesRemoved: 0,
        filesRemovedThenRefused: false,
        message: 'BLOCKED',
      })
    );
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).blockers).toEqual([{ code: 'contact_support' }]);
  });

  it('N-2: both 429s carry no-store', async () => {
    mockRateLimit.mockImplementation(async () => ({ allowed: false, hits: 99, degraded: false }));
    const first = await POST(req(OK_BODY));
    expect(first.status).toBe(429);
    expect(first.headers.get('cache-control')).toContain('no-store');
    expect(first.headers.get('retry-after')).toBe('300');

    mockRateLimit.mockImplementation(async (_r: unknown, _route: string, _rule: unknown, outcome = 'ok') => ({
      allowed: outcome === 'ok',
      hits: 11,
      degraded: false,
    }));
    const second = await POST(req({ ...OK_BODY, statement: 'nope' }));
    expect(second.status).toBe(429);
    expect(second.headers.get('cache-control')).toContain('no-store');
  });

  it('N-6: a declared body over 4 KB → 413 before it is read; nothing else runs', async () => {
    const big = JSON.stringify({ statement: 'x'.repeat(5000), language: 'en' });
    const res = await POST(
      new NextRequest('http://localhost/api/business-os/account/delete', {
        method: 'POST',
        body: big,
        headers: { 'content-type': 'application/json', 'content-length': String(big.length) },
      })
    );
    expect(res.status).toBe(413);
    expect(events).toEqual(['session']);
  });

  it('N-6: an undeclared body over 4 KB is refused once read', async () => {
    const res = await POST(req({ statement: 'x'.repeat(5000), language: 'en' }));
    expect(res.status).toBe(413);
    expect(did('rate')).toBe(false);
  });

  it('N-6: a 4 KB-or-smaller body still reaches Zod', async () => {
    expect((await POST(req({ statement: 'x'.repeat(600), language: 'en' }))).status).toBe(400);
  });
});
