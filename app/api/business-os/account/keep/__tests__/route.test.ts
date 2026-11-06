/**
 * POST /api/business-os/account/keep (DL-1b / D6; workplan §5, T-2, T-9,
 * T-15; SA W-8, W-14, Q-13). The real route and Keep orchestration
 * (`closureKeep.ts`) over mocked edges: the session, the throttle, the audit
 * flush and the production ports (`closureKeepDeps`).
 */

import { NextRequest } from 'next/server';
import type { ClosureKeepDeps, KeepClosureRow } from '@/lib/business-os/account-deletion/closureKeep';
import type { PlanManageResult } from '@/lib/business-os/billing/planSubscriptionManage';

const FLAG = 'BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED';
const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLOSURE = '44444444-4444-4444-8444-444444444444';
const EMAIL = 'jane.owner@example.org';
const ENDS = '2026-11-26T10:00:00.000Z';

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

let open: KeepClosureRow | null;
let moved: boolean;
let engine: PlanManageResult;
let depsThrow: boolean;
const manage = jest.fn();
const transitions: unknown[][] = [];
jest.mock('@/lib/business-os/account-deletion/closureKeepDeps', () => ({
  closureKeepDeps: (): ClosureKeepDeps => {
    if (depsThrow) throw new Error('boom');
    return {
      closures: {
        findOpenForUser: async () => ({ data: open, error: null }),
        findById: async () => ({ data: open ? { ...open, status: 'kept' } : null, error: null }),
        transition: async (...args) => {
          transitions.push(args);
          return { data: moved, error: null };
        },
      },
      manage: async (input) => {
        manage(input);
        return engine;
      },
      now: () => new Date('2026-11-04T10:00:00.000Z'),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    };
  },
}));
const mockAudit = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...args: unknown[]) => mockAudit(...args) }));

import { POST } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';

const AUDIT = { action: 'reactivate' as const, outcome: 'reactivated' as const, subscriptionId: 'sub_own', endsOn: null, renewsOn: ENDS, livemode: false, mode: 'period_end' as const, reasonCode: null, origin: 'deletion_keep' as const };

const req = (body: unknown, raw?: string) =>
  new NextRequest('http://localhost/api/business-os/account/keep', {
    method: 'POST',
    body: raw ?? JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-k' },
  });
const audited = () => mockAudit.mock.calls.flatMap((call) => (Array.isArray(call[0]) ? call[0] : [call[0]])) as Array<Record<string, unknown>>;

beforeEach(() => {
  mockLogged.length = 0;
  transitions.length = 0;
  manage.mockReset();
  open = { id: CLOSURE, status: 'pending', renewal_was_on: true, plan_ends_at: ENDS };
  moved = true;
  engine = { ok: true, outcome: 'reactivated', renewsOn: ENDS, audit: AUDIT };
  depsThrow = false;
  process.env[FLAG] = 'true';
  mockSession.mockReset().mockResolvedValue({ id: SUBJECT, email: EMAIL });
  mockRateLimit.mockReset().mockResolvedValue({ allowed: true, hits: 1, degraded: false });
  mockAudit.mockReset().mockResolvedValue(undefined);
});

afterAll(() => {
  delete process.env[FLAG];
});

describe('T-2: Keep is NOT behind the request switch (XC-4)', () => {
  it.each([undefined, 'false'])('switch %s + an open pending row → 200 kept', async (value) => {
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ kept: true, from: 'pending', renewal: 'restored' });
  });
});

describe('T-15: session, body, throttle', () => {
  it('no session → 401, nothing read', async () => {
    mockSession.mockResolvedValueOnce(null);
    expect((await POST(req({}))).status).toBe(401);
    expect(transitions).toEqual([]);
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ['a userId', { userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
    ['an origin (W-8)', { origin: 'deletion_keep' }],
    ['a status', { status: 'kept' }],
    ['a closure id', { closureId: CLOSURE }],
  ])('%s in the body → 400, nothing read', async (_label, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(transitions).toEqual([]);
  });

  it('unparsable JSON → 400; an empty body reads as {}', async () => {
    expect((await POST(req(null, '{nope'))).status).toBe(400);
    expect((await POST(req(null, ''))).status).toBe(200);
  });

  it('throttled → 429 no-store; the key is account-keep, hashed', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, hits: 9, degraded: false });
    const res = await POST(req({}));
    expect(res.status).toBe(429);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(mockRateLimit.mock.calls[0][1]).toMatch(/^account-keep:[0-9a-f]{16}$/);
    expect(transitions).toEqual([]);
  });
});

describe('T-9: answers', () => {
  it('pending + renewal on → 200 restored; the engine with origin deletion_keep and the session account', async () => {
    const res = await POST(req({}));
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(await res.json()).toEqual({ success: true, data: { kept: true, from: 'pending', renewal: 'restored' }, correlationId: 'corr-k' });
    expect(manage).toHaveBeenCalledWith({ action: 'reactivate', userId: SUBJECT, accountId: SUBJECT, origin: 'deletion_keep' });
  });

  it('a failed renew → 200, the account kept, renewal failed with the code and end date (Q-13)', async () => {
    engine = { ok: false, code: 'payment_failed_contact_us' };
    expect((await (await POST(req({}))).json()).data).toEqual({ kept: true, from: 'pending', renewal: 'failed', code: 'payment_failed_contact_us', planEndsOn: ENDS });
  });

  it.each<[KeepClosureRow | null, number, string]>([
    [null, 409, 'nothing_to_keep'],
    [{ id: CLOSURE, status: 'requesting', renewal_was_on: true, plan_ends_at: null }, 409, 'request_in_progress'],
    [{ id: CLOSURE, status: 'locked', renewal_was_on: false, plan_ends_at: null }, 409, 'locked'],
  ])('%j → %s %s, nothing written, not audited', async (row, status, error) => {
    open = row;
    const res = await POST(req({}));
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(error);
    expect(transitions).toEqual([]);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('the compare-and-set lost → 409 state_changed with the re-read status', async () => {
    moved = false;
    const res = await POST(req({}));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'state_changed', data: { status: 'kept' } });
  });

  it('an unexpected throw → 500, no internals', async () => {
    depsThrow = true;
    const res = await POST(req({}));
    expect(res.status).toBe(500);
    expect((await res.json()).details).toBeUndefined();
  });
});

describe('W-14: the audit rows', () => {
  it('KEPT with no user id (survives E), the owner as actor, source owner; the money row on the owner with origin', async () => {
    await POST(req({}));
    const rows = audited();
    expect(rows.map((r) => r.action)).toEqual([AUDIT_EVENTS.ACCOUNT_DELETION_KEPT, AUDIT_EVENTS.BOS_BILLING_SUBSCRIPTION_REACTIVATED]);
    expect(rows[0]).not.toHaveProperty('userId');
    // SA CR-1: KEPT outlives erasure, so no request context; the money row (on the owner) keeps it.
    expect(rows[0]).not.toHaveProperty('request');
    expect(rows[1]).toHaveProperty('request');
    expect(rows[0]).toMatchObject({ actorId: SUBJECT, entityType: 'user', entityId: SUBJECT, details: { closure_id: CLOSURE, source: 'owner', from: 'pending', renewal: 'restored' } });
    expect(rows[1]).toMatchObject({ userId: SUBJECT, actorId: SUBJECT, details: { origin: 'deletion_keep', closure_id: CLOSURE } });
  });

  it('grace → KEPT only (no engine, no money row); no email in any row or log', async () => {
    open = { id: CLOSURE, status: 'grace', renewal_was_on: false, plan_ends_at: null };
    await POST(req({}));
    expect(audited().map((r) => r.action)).toEqual([AUDIT_EVENTS.ACCOUNT_DELETION_KEPT]);
    expect(manage).not.toHaveBeenCalled();
    expect(JSON.stringify([audited(), mockLogged])).not.toContain(EMAIL);
  });
});
