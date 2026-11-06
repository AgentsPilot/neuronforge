/**
 * POST /api/business-os/account/delete — the deletion REQUEST (DL-1b / D6;
 * workplan §4, T-1, T-8, T-15; SA W-8, W-13, W-14). Until DL-1b this route
 * anonymised the account; it now only records a request.
 *
 * The real route, Zod schema, statement matcher and request orchestration
 * (`closureRequest.ts`), over mocked edges: the session, the throttle, the
 * audit flush and the production ports (`closureRequestDeps`), which return a
 * fake closure store, billing row, check, timezone and cancel engine. Every
 * case asserts which later steps did NOT run.
 */

import { NextRequest } from 'next/server';
import { DELETION_STATEMENTS } from '@/lib/business-os/account-deletion/acknowledgement';
import type { ClosureRequestDeps, BillingRowLike } from '@/lib/business-os/account-deletion/closureRequest';
import type { PlanManageResult } from '@/lib/business-os/billing/planSubscriptionManage';

const FLAG = 'BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED';
const SECRET_ENV = ['TEST', 'CLEANUP', 'SECRET'].join('_');
const KEY_ENV = ['DELETION', 'RECEIPT', 'FINGERPRINT', 'KEY'].join('_');
const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLOSURE = '44444444-4444-4444-8444-444444444444';
const EMAIL = 'jane.owner@example.org';
const ENDS = '2026-11-26T10:00:00.000Z';

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

jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({
  errorKindFacts: (err: unknown) => ({ kind: null, code: null, name: err instanceof Error ? err.name : null }),
}));

const mockDeps = jest.fn();
jest.mock('@/lib/business-os/account-deletion/closureRequestDeps', () => ({
  closureRequestDeps: (...args: unknown[]) => mockDeps(...args),
}));

const mockAudit = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...args: unknown[]) => mockAudit(...args) }));

import { POST } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';

const renewing: BillingRowLike = {
  stripeSubscriptionId: 'sub_own',
  subscriptionStatus: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: ENDS,
  endedAt: null,
  failedAttempts: 0,
  pendingTier: null,
  openCheckoutSessionId: null,
  openCheckoutExpiresAt: null,
};
const ENGINE_AUDIT = { action: 'cancel' as const, outcome: 'cancelled' as const, subscriptionId: 'sub_own', endsOn: ENDS, renewsOn: null, livemode: false, mode: 'period_end' as const, reasonCode: 'other' as const, origin: 'deletion_request' as const };

interface World {
  open: { id: string; status: 'pending' } | null;
  billing: BillingRowLike | null;
  checkRows: Array<{ guard: string; item?: string; found?: number }>;
  engine: PlanManageResult | 'throws';
  transition: boolean;
  depsThrow: boolean;
}
let world: World;
const inserts: unknown[] = [];
const manage = jest.fn();

function fakeDeps(): ClosureRequestDeps {
  if (world.depsThrow) throw new Error(`boom ${EMAIL}`);
  const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
  return {
    closures: {
      findOpenForUser: async () => {
        events.push('closure:open');
        return { data: world.open, error: null };
      },
      insertRequesting: async (input) => {
        events.push('closure:insert');
        inserts.push(input);
        return { data: { id: CLOSURE, status: 'requesting' }, error: null };
      },
      transition: async (_id, _user, from, to) => {
        events.push(`closure:${from}>${to}`);
        return { data: world.transition, error: null };
      },
      deleteRequesting: async () => {
        events.push('closure:delete');
        return { data: true, error: null };
      },
    },
    billingRow: async () => ({ data: world.billing, error: null }),
    livemode: () => false,
    pricesEnabled: () => true,
    runCheck: async () => {
      events.push('check');
      return { kind: 'checked', canDelete: true, targetUserId: SUBJECT, blockers: [], notes: [], guards: [], rows: world.checkRows, verdictBlocked: world.checkRows.length > 0, resolvedThisLogin: true, serverMs: 1 };
    },
    readTimezone: async () => ({ data: 'Asia/Jerusalem', error: null }),
    manage: async (input) => {
      events.push('engine');
      manage(input);
      if (world.engine === 'throws') throw new Error('boom');
      return world.engine;
    },
    now: () => new Date('2026-11-04T10:00:00.000Z'),
    logger: silent,
  };
}

function req(body: unknown, opts: { raw?: string } = {}) {
  return new NextRequest('http://localhost/api/business-os/account/delete', {
    method: 'POST',
    body: opts.raw ?? JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-7' },
  });
}

const OK_BODY = { statement: DELETION_STATEMENTS.en, language: 'en', reasonCode: 'too_expensive' };

/** Every audit entry the route flushed, flattened. */
function audited(): Array<Record<string, unknown>> {
  return mockAudit.mock.calls.flatMap((call) => (Array.isArray(call[0]) ? call[0] : [call[0]])) as Array<Record<string, unknown>>;
}

beforeEach(() => {
  events.length = 0;
  inserts.length = 0;
  mockLogged.length = 0;
  manage.mockReset();
  world = {
    open: null,
    billing: renewing,
    checkRows: [],
    engine: { ok: true, outcome: 'cancelled', endsOn: ENDS, audit: ENGINE_AUDIT },
    transition: true,
    depsThrow: false,
  };
  process.env[FLAG] = 'true';
  process.env[SECRET_ENV] = 's'.repeat(40);
  process.env[KEY_ENV] = 'k'.repeat(48);
  mockSession.mockReset().mockImplementation(async () => {
    events.push('session');
    return { id: SUBJECT, email: EMAIL };
  });
  mockRateLimit.mockReset().mockImplementation(async (_req: unknown, route: string, _rule: unknown, outcome = 'ok') => {
    events.push(`rate:${outcome}:${route}`);
    return { allowed: true, hits: 1, degraded: false };
  });
  mockDeps.mockReset().mockImplementation(() => fakeDeps());
  mockAudit.mockReset().mockResolvedValue(undefined);
});

afterAll(() => {
  delete process.env[FLAG];
  delete process.env[SECRET_ENV];
  delete process.env[KEY_ENV];
});

describe('T-1: the request switch', () => {
  it.each([undefined, '', 'false', '1', 'TRUE'])('%s → 404 before the session is read', async (value) => {
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(404);
    expect(mockSession).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe('T-15: session, body, throttle', () => {
  it('no session → 401, nothing else', async () => {
    mockSession.mockResolvedValueOnce(null);
    expect((await POST(req(OK_BODY))).status).toBe(401);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockDeps).not.toHaveBeenCalled();
  });

  it('the session read throws → 401', async () => {
    mockSession.mockRejectedValueOnce(new Error('auth down'));
    expect((await POST(req(OK_BODY))).status).toBe(401);
  });

  it.each([
    ['an extra userId', { ...OK_BODY, userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
    ['an extra email', { ...OK_BODY, email: 'other@example.org' }],
    ['an origin (W-8)', { ...OK_BODY, origin: 'owner' }],
    ['a status', { ...OK_BODY, status: 'pending' }],
    ['no reasonCode (W-13: required)', { statement: DELETION_STATEMENTS.en, language: 'en' }],
    ['a reasonCode off the list', { ...OK_BODY, reasonCode: 'i just want to' }],
    ['an unknown language', { ...OK_BODY, language: 'fr' }],
  ])('%s → 400 invalid_body, nothing read', async (_label, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(mockDeps).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it('unparsable JSON → 400; an oversized body → 413', async () => {
    expect((await POST(req(null, { raw: '{nope' }))).status).toBe(400);
    expect((await POST(req(null, { raw: JSON.stringify({ ...OK_BODY, statement: 'x'.repeat(5000) }) }))).status).toBe(413);
  });

  it('throttled → 429 with no-store, nothing read; the key is per account (hashed) and the rule is the write rule', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, hits: 99, degraded: false });
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(429);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(mockDeps).not.toHaveBeenCalled();
    const [, key] = mockRateLimit.mock.calls[0];
    expect(key).toMatch(/^account-delete:[0-9a-f]{16}$/);
    expect(key).not.toContain(SUBJECT);
  });
});

describe('T-8: the typed statement, on the server, in three languages', () => {
  it.each([
    ['en', 'he'],
    ['he', 'en'],
    ['es', 'en'],
  ] as const)('the %s statement is accepted with UI language %s; statement_language is the MATCHED one', async (lang, ui) => {
    const res = await POST(req({ statement: DELETION_STATEMENTS[lang], language: ui, reasonCode: 'other' }));
    expect(res.status).toBe(200);
    expect(inserts[0]).toMatchObject({ statementLanguage: lang, reasonCode: 'other' });
  });

  it.each([
    ['case and spaces', `  ${DELETION_STATEMENTS.en.toUpperCase().replace(/ /g, '  ')} `, 'en'],
    ['marks and niqqud', `‏${DELETION_STATEMENTS.he.replace('הורדתי', 'הוֹרַדְתִּי')}​`, 'he'],
  ])('tolerated difference: %s → accepted', async (_label, statement, lang) => {
    const res = await POST(req({ statement, language: 'en', reasonCode: 'other' }));
    expect(res.status).toBe(200);
    expect(inserts[0]).toMatchObject({ statementLanguage: lang });
  });

  it.each([
    ['a wrong text', 'please delete my account'],
    ['a near miss', DELETION_STATEMENTS.en.slice(0, -3)],
  ])('%s → 400 statement_mismatch, counted, audited, no closure read', async (_label, statement) => {
    const res = await POST(req({ ...OK_BODY, statement }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('statement_mismatch');
    expect(events.filter((e) => e.startsWith('rate:failure:account-delete:'))).toHaveLength(1);
    expect(mockDeps).not.toHaveBeenCalled();
    expect(audited()).toEqual([
      expect.objectContaining({
        action: AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED,
        userId: SUBJECT,
        actorId: SUBJECT,
        details: expect.objectContaining({ reason: 'statement_mismatch', source: 'self_service', stage: 'request' }),
      }),
    ]);
  });

  it('once the failure budget is spent → 429', async () => {
    mockRateLimit.mockImplementation(async (_req: unknown, _route: string, _rule: unknown, outcome = 'ok') => ({ allowed: outcome !== 'failure', hits: 1, degraded: false }));
    expect((await POST(req({ ...OK_BODY, statement: 'nope' }))).status).toBe(429);
  });
});

describe('not available on this deployment (XC-5 keeps the gate)', () => {
  it.each([
    ['no login email', () => mockSession.mockResolvedValueOnce({ id: SUBJECT, email: null })],
    ['no cleanup secret', () => delete process.env[SECRET_ENV]],
    ['no fingerprint key', () => delete process.env[KEY_ENV]],
  ])('%s → 503 not_available, refusal audited, nothing read', async (_label, arrange) => {
    arrange();
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('not_available');
    expect(mockDeps).not.toHaveBeenCalled();
    expect(audited()[0]).toMatchObject({ action: AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED, details: { reason: 'not_available' } });
  });
});

describe('success', () => {
  it('a paid account → 200 pending; the engine called with the session account and a constant origin; nothing deleted', async () => {
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(await res.json()).toEqual({ success: true, data: { status: 'pending', planEndsOn: ENDS, renewalWasOn: true }, correlationId: 'corr-7' });
    expect(manage).toHaveBeenCalledWith({ action: 'cancel', userId: SUBJECT, accountId: SUBJECT, origin: 'deletion_request', reasonCode: 'too_expensive' });
    expect(events.filter((e) => !e.startsWith('rate:'))).toEqual(['session', 'closure:open', 'check', 'closure:insert', 'engine', 'closure:requesting>pending']);
    expect(events).not.toContain('closure:delete');
  });

  it('W-14: CANCELLED on the session user with origin; REQUESTED with NO user id (survives E) and the owner as actor', async () => {
    await POST(req(OK_BODY));
    const rows = audited();
    expect(rows.map((r) => r.action)).toEqual([AUDIT_EVENTS.BOS_BILLING_SUBSCRIPTION_CANCELLED, AUDIT_EVENTS.ACCOUNT_DELETION_REQUESTED]);
    expect(rows[0]).toMatchObject({ userId: SUBJECT, actorId: SUBJECT, entityType: 'business_os_billing_account', details: { origin: 'deletion_request', closure_id: CLOSURE, outcome: 'cancelled' } });
    expect(rows[1]).not.toHaveProperty('userId');
    // SA CR-1: the surviving row carries no request (no IP, user agent or session); the money row does.
    expect(rows[1]).not.toHaveProperty('request');
    expect(rows[0]).toHaveProperty('request');
    expect(rows[1]).toMatchObject({
      actorId: SUBJECT,
      entityType: 'user',
      entityId: SUBJECT,
      details: { closure_id: CLOSURE, status: 'pending', renewal_was_on: true, plan_ends_on: ENDS, reason_code: 'too_expensive', statement_language: 'en', source: 'self_service', stage: 'request' },
    });
  });

  it('a free account → 200 grace with the lock date; REQUESTED + GRACE_STARTED, no money row, no engine', async () => {
    world.billing = null;
    const res = await POST(req(OK_BODY));
    expect(await res.json()).toEqual({ success: true, data: { status: 'grace', lockAt: '2026-11-17T22:00:00.000Z', lockTimezone: 'Asia/Jerusalem' }, correlationId: 'corr-7' });
    expect(manage).not.toHaveBeenCalled();
    const rows = audited();
    expect(rows.map((r) => r.action)).toEqual([AUDIT_EVENTS.ACCOUNT_DELETION_REQUESTED, AUDIT_EVENTS.ACCOUNT_GRACE_STARTED]);
    for (const row of rows) {
      expect(row).not.toHaveProperty('userId');
      // SA CR-1: REQUESTED and GRACE_STARTED outlive erasure, so no request context.
      expect(row).not.toHaveProperty('request');
      expect(row.actorId).toBe(SUBJECT);
    }
    expect(rows[1].details).toMatchObject({ lock_at: '2026-11-17T22:00:00.000Z', lock_timezone: 'Asia/Jerusalem' });
  });

  it('no email or statement text in any audit row, log line or answer', async () => {
    const res = await POST(req(OK_BODY));
    const all = JSON.stringify([audited(), mockLogged, await res.json()]);
    expect(all).not.toContain(EMAIL);
    expect(all).not.toContain(DELETION_STATEMENTS.en);
  });
});

describe('refusals', () => {
  it('an open request → 409 already_requested with its status, no audit row', async () => {
    world.open = { id: CLOSURE, status: 'pending' };
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, error: 'already_requested', data: { status: 'pending' } });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('a blocker at A → 409 blocked with the plain-word list; guard ids only in the audit; nothing written', async () => {
    world.checkRows = [{ guard: 'G-8', found: 1 }, { guard: 'G-6', found: 1 }];
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'blocked', blockers: [{ code: 'stripe_connected' }] });
    expect(inserts).toEqual([]);
    // SA CR-1: a refusal row goes with the account (B-1), so it keeps its request context.
    expect(audited()[0]).toHaveProperty('request');
    expect(audited()).toEqual([
      expect.objectContaining({ action: AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED, userId: SUBJECT, details: expect.objectContaining({ reason: 'blocked', guards: ['G-8'] }) }),
    ]);
  });

  it('a failed last payment → 409 blocked [payment_failed] (BQ-11), no check run', async () => {
    world.billing = { ...renewing, subscriptionStatus: 'past_due' };
    const res = await POST(req(OK_BODY));
    expect(await res.json()).toMatchObject({ error: 'blocked', blockers: [{ code: 'payment_failed' }] });
    expect(events).not.toContain('check');
  });

  it('a lost Stripe answer → 502 outcomeUnknown; the money row (unknown) and the refusal row; nothing deleted', async () => {
    world.engine = { ok: false, code: 'stripe_error', outcomeUnknown: true, audit: { ...ENGINE_AUDIT, outcome: 'unknown', endsOn: null } };
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'stripe_error', outcomeUnknown: true });
    expect(audited().map((r) => [r.action, (r.details as Record<string, unknown>).outcome ?? (r.details as Record<string, unknown>).reason])).toEqual([
      [AUDIT_EVENTS.BOS_BILLING_SUBSCRIPTION_CANCELLED, 'unknown'],
      [AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED, 'plan_outcome_unknown'],
    ]);
    expect(events).not.toContain('closure:delete');
  });

  it('P-8: the plan is set to end but the row did not move → 503 try_again with status requesting; the money row only', async () => {
    world.transition = false;
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'try_again', data: { status: 'requesting' } });
    expect(audited().map((r) => r.action)).toEqual([AUDIT_EVENTS.BOS_BILLING_SUBSCRIPTION_CANCELLED]);
  });

  it('a definite engine refusal → the row withdrawn, mapped, one refusal row', async () => {
    world.engine = { ok: false, code: 'upgrade_pending' };
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('plan_change_pending');
    expect(events).toContain('closure:delete');
    expect(audited().map((r) => r.action)).toEqual([AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED]);
  });

  it('an unexpected throw → 500 request_failed; no internals outside development; the email never logged', async () => {
    world.depsThrow = true;
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'request_failed' });
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(mockLogged)).not.toContain(EMAIL);
    expect(audited()[0]).toMatchObject({ action: AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED, details: { reason: 'unexpected_failed' } });
  });
});
