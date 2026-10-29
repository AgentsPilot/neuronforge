/**
 * QA gap tests for the plan cancel / keep emails through the REAL routes and the
 * REAL production wiring (`planCancelEmailDeps.ts` → `planCancelEmail.ts` →
 * template), with the engine faked at its own seam (account deletion lifecycle
 * D4a / SX-3; workplan docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md §13).
 *
 * The engine (`managePlanSubscription`) is replaced so each engine answer can be
 * set directly; the identity read goes through the REAL auth-account
 * repository over a fake service-role client, so this file names no
 * repository whose callers are allow-listed (no guard allow-list change).
 *
 * What route.d4a.test.ts did not already pin:
 *   - a send that never answers: the route still answers 200 with the same body,
 *     bounded by the email deadline, audited NOT_SENT `unknown`;
 *   - the email's own audit write throwing: still 200, never a 500;
 *   - the identity read throwing / erroring: still 200, NOT_SENT;
 *   - ended_now with invoicesLeftOpen 0 / >0 / null at the route;
 *   - DR-6 at the route: the engine's null date → no send, NOT_SENT `no_date`;
 *   - no address, name or plan name in ANY route log line or audit row;
 *   - every refusal code and `unchanged` on both routes: no send, no email audit.
 */

import { NextRequest } from 'next/server';

const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = 'qa.route.owner@example.com';
const PLAN_NAME = 'Qa Route Plan Name';
const ENDS = '2026-12-01T05:30:00.000Z';

type Level = 'info' | 'warn' | 'error' | 'debug';
const state: {
  user: { id: string; email?: string } | null;
  result: Record<string, unknown>;
  audits: Array<Record<string, unknown>>;
  auditThrowsFor: RegExp | null;
  sent: Array<Record<string, unknown>>;
  send: 'ok' | 'hang' | 'throws';
  identity: 'ok' | 'error' | 'throws';
  zone: string | null;
  logs: Array<{ level: Level; args: unknown[] }>;
  order: string[];
} = {
  user: null,
  result: {},
  audits: [],
  auditThrowsFor: null,
  sent: [],
  send: 'ok',
  identity: 'ok',
  zone: 'America/Los_Angeles',
  logs: [],
  order: [],
};

jest.mock('@/lib/auth', () => ({ getUser: async () => state.user }));
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    auth: {
      admin: {
        getUserById: async (id: string) => {
          if (state.identity === 'throws') throw new Error('auth admin exploded');
          if (state.identity === 'error') return { data: { user: null }, error: { status: 500, code: 'unexpected_failure', message: 'down' } };
          return { data: { user: { id, email: OWNER, created_at: '2026-01-01T00:00:00Z' } }, error: null };
        },
      },
    },
  },
}));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug', 'fatal', 'trace']) {
      logger[level] = (...args: unknown[]) => state.logs.push({ level: level as Level, args });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make(), logger: make() };
});

jest.mock('@/lib/business-os/billing/planSubscriptionManage', () => ({
  ...jest.requireActual('@/lib/business-os/billing/planSubscriptionManage'),
  managePlanSubscription: async () => {
    state.order.push('engine');
    return state.result;
  },
}));

jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: async (entry: Record<string, unknown>) => {
    state.order.push(`audit:${String(entry.action)}`);
    state.audits.push(entry);
    if (state.auditThrowsFor?.test(String(entry.action))) throw new Error('audit flush exploded');
  },
}));

jest.mock('@/lib/notifications/emailTransport', () => ({
  platformSenderAddress: () => 'notifications@agentspilot.ai',
  sendEmail: (params: Record<string, unknown>) => {
    state.order.push('email:send');
    state.sent.push(params);
    if (state.send === 'hang') return new Promise(() => undefined);
    if (state.send === 'throws') return Promise.reject(new Error('transport exploded'));
    return Promise.resolve({ sent: true, provider: 'resend' });
  },
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findLanguage: async () => ({ data: 'he', error: null }) },
}));
jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
  userPreferencesRepository: {
    findPreferredLanguage: async () => ({ data: null, error: null }),
    findTimezone: async () => ({ data: state.zone, error: null }),
  },
}));
jest.mock('@/lib/business-os/entitlements/planEndingView', () => ({
  readPlanEndingView: async (input: { endsAt: string }) => ({
    kind: 'free_plan',
    endsAt: input.endsAt,
    planName: PLAN_NAME,
    until: input.endsAt,
    credits: 500,
    loses: [],
    thenReadOnlyDays: 7,
    thenPausedFrom: input.endsAt,
  }),
}));

import { formatAccountDay } from '@/components/business-os/settings/planUpgradeCopy';
import { POST as CANCEL } from '@/app/api/business-os/billing/plan/cancel/route';
import { POST as REACTIVATE } from '@/app/api/business-os/billing/plan/reactivate/route';
import { PLAN_CANCEL_EMAIL_POLICY } from '@/lib/business-os/billing/planCancelEmail';
import { PLAN_MANAGE_REFUSALS } from '@/lib/business-os/billing/planSubscriptionManage';

const facts = (overrides: Record<string, unknown> = {}) => ({
  action: 'cancel',
  subscriptionId: 'sub_own',
  outcome: 'cancelled',
  endsOn: ENDS,
  renewsOn: null,
  mode: 'period_end',
  livemode: false,
  reasonCode: null,
  ...overrides,
});

function post(url: string, body: unknown = {}) {
  return new NextRequest(`https://example.test${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const cancelPost = () => CANCEL(post('/api/business-os/billing/plan/cancel'));
const reactivatePost = () => REACTIVATE(post('/api/business-os/billing/plan/reactivate'));
const emailAudits = () => state.audits.filter((entry) => String(entry.action).startsWith('BOS_PLAN_CANCEL_EMAIL_'));

const ENV = ['BUSINESS_OS_PLAN_PRICES_ENABLED', 'BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED'] as const;
const savedEnv: Record<string, string | undefined> = {};
const savedDeadline = PLAN_CANCEL_EMAIL_POLICY.deadlineMs;
beforeAll(() => {
  for (const name of ENV) savedEnv[name] = process.env[name];
});
afterAll(() => {
  for (const name of ENV) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  (PLAN_CANCEL_EMAIL_POLICY as { deadlineMs: number }).deadlineMs = savedDeadline;
});

beforeEach(() => {
  process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'true';
  process.env.BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED = 'true';
  (PLAN_CANCEL_EMAIL_POLICY as { deadlineMs: number }).deadlineMs = savedDeadline;
  state.user = { id: USER, email: OWNER };
  state.result = { ok: true, outcome: 'cancelled', endsOn: ENDS, audit: facts() };
  state.audits = [];
  state.auditThrowsFor = null;
  state.sent = [];
  state.send = 'ok';
  state.identity = 'ok';
  state.zone = 'America/Los_Angeles';
  state.logs = [];
  state.order = [];
});

describe('QA: the email never changes the answer', () => {
  it('a send that never answers → 200, same body, within the deadline, audited NOT_SENT unknown', async () => {
    (PLAN_CANCEL_EMAIL_POLICY as { deadlineMs: number }).deadlineMs = 60;
    state.send = 'hang';
    const started = Date.now();
    const response = await cancelPost();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'cancelled', endsOn: ENDS } });
    expect(emailAudits()).toEqual([
      expect.objectContaining({ action: 'BOS_PLAN_CANCEL_EMAIL_NOT_SENT', details: expect.objectContaining({ outcome: 'unknown', reason: 'deadline_exceeded' }) }),
    ]);
  });

  it('the production deadline is 4 s (the bound on the extra wait, plus the bounded audit flush)', () => {
    expect(savedDeadline).toBe(4_000);
  });

  it.each(['cancel', 'reactivate'] as const)('%s: the email audit write throwing → still 200, never a 500', async (route) => {
    state.auditThrowsFor = /^BOS_PLAN_CANCEL_EMAIL_/;
    if (route === 'reactivate') state.result = { ok: true, outcome: 'reactivated', renewsOn: ENDS, audit: facts({ action: 'reactivate', outcome: 'reactivated', endsOn: null, renewsOn: ENDS }) };
    const response = route === 'cancel' ? await cancelPost() : await reactivatePost();
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(state.sent).toHaveLength(1);
  });

  it.each(['error', 'throws'] as const)('identity read %s → 200, nothing sent, NOT_SENT recipient_lookup_failed', async (mode) => {
    state.identity = mode;
    const response = await cancelPost();
    expect(response.status).toBe(200);
    expect(state.sent).toEqual([]);
    expect(emailAudits()[0]).toMatchObject({ action: 'BOS_PLAN_CANCEL_EMAIL_NOT_SENT', details: { reason: 'recipient_lookup_failed' } });
  });

  it('a send that rejects → 200; the order is action audit, send, email audit', async () => {
    state.send = 'throws';
    expect((await cancelPost()).status).toBe(200);
    expect(state.order).toEqual(['engine', 'audit:BOS_BILLING_SUBSCRIPTION_CANCELLED', 'email:send', 'audit:BOS_PLAN_CANCEL_EMAIL_NOT_SENT']);
  });
});

describe('QA: ended_now at the route (DR-7, F-1)', () => {
  it.each([
    [0, true],
    [2, false],
    [null, false],
  ] as const)('invoicesLeftOpen %p → "not charged again" written: %p', async (left, written) => {
    state.result = { ok: true, outcome: 'cancelled', endsOn: ENDS, mode: 'immediate', audit: facts({ mode: 'immediate', invoicesVoided: 1, invoicesLeftOpen: left }) };
    const response = await cancelPost();
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'cancelled', endsOn: ENDS, mode: 'immediate' } });
    expect(state.sent).toHaveLength(1);
    // Hebrew (the business profile language): the subject is the ended one.
    expect(state.sent[0].subject).toBe('התוכנית שלכם הסתיימה');
    expect(/תחויבו שוב/.test(String(state.sent[0].text))).toBe(written);
    expect(emailAudits()[0]).toMatchObject({ action: 'BOS_PLAN_CANCEL_EMAIL_SENT', details: { email: 'ended_now', language: 'he', languageSource: 'business_profiles' } });
  });
});

describe('QA: the date at the route', () => {
  it('DR-6: the engine returns endsOn null → no send, NOT_SENT no_date, still 200', async () => {
    state.result = { ok: true, outcome: 'cancelled', endsOn: null, audit: facts({ endsOn: null }) };
    const response = await cancelPost();
    expect(response.status).toBe(200);
    expect(state.sent).toEqual([]);
    expect(emailAudits()[0]).toMatchObject({ action: 'BOS_PLAN_CANCEL_EMAIL_NOT_SENT', details: { reason: 'no_date', email: 'cancelled' } });
  });

  it('DR-6: reactivated with renewsOn null → no send, NOT_SENT no_date', async () => {
    state.result = { ok: true, outcome: 'reactivated', renewsOn: null, audit: facts({ action: 'reactivate', outcome: 'reactivated', endsOn: null }) };
    expect((await reactivatePost()).status).toBe(200);
    expect(state.sent).toEqual([]);
    expect(emailAudits()[0]).toMatchObject({ details: { reason: 'no_date', email: 'kept' } });
  });

  it.each([
    ['America/Los_Angeles', 'America/Los_Angeles'],
    ['Not/AZone', 'UTC'],
    [null, 'UTC'],
  ])('stored zone %p → the email shows the drawer day on %s', async (zone, effective) => {
    state.zone = zone;
    await cancelPost();
    const day = formatAccountDay(ENDS, 'he', effective) as string;
    expect(String(state.sent[0].text)).toContain(day);
  });
});

describe('QA: no address, name or plan name in any route log line or audit row', () => {
  it.each(['ok', 'hang', 'throws'] as const)('send %s', async (send) => {
    (PLAN_CANCEL_EMAIL_POLICY as { deadlineMs: number }).deadlineMs = 60;
    state.send = send;
    state.user = { id: USER, email: OWNER };
    await cancelPost();
    expect(String(state.sent[0].text)).toContain(PLAN_NAME); // the email itself does name the plan
    const recorded = JSON.stringify({ logs: state.logs.map((line) => line.args), audits: state.audits }, (_key, value) =>
      value instanceof Error ? { message: value.message } : value
    );
    expect(recorded).not.toContain(OWNER);
    expect(recorded).not.toContain(PLAN_NAME);
  });
});

describe('QA: only a real change sends', () => {
  const REFUSAL_CODES = Object.keys(PLAN_MANAGE_REFUSALS);

  it('there are refusal codes to try', () => {
    expect(REFUSAL_CODES.length).toBeGreaterThan(3);
  });

  it.each(REFUSAL_CODES.flatMap((code) => (['cancel', 'reactivate'] as const).flatMap((route) => [false, true].map((unknown) => [route, code, unknown] as const))))(
    '%s refused %s (outcomeUnknown %p) → no send, no email audit',
    async (route, code, outcomeUnknown) => {
      state.result = { ok: false, code, ...(outcomeUnknown ? { outcomeUnknown: true, audit: facts({ outcome: 'unknown', endsOn: null }) } : {}) };
      const response = route === 'cancel' ? await cancelPost() : await reactivatePost();
      expect(response.status).toBe(PLAN_MANAGE_REFUSALS[code as keyof typeof PLAN_MANAGE_REFUSALS].status);
      expect(state.sent).toEqual([]);
      expect(emailAudits()).toEqual([]);
    }
  );

  it.each(['cancel', 'reactivate'] as const)('%s unchanged → no send, no email audit', async (route) => {
    state.result = { ok: true, outcome: 'unchanged', state: route === 'cancel' ? 'cancelling' : 'renewing', date: ENDS };
    const response = route === 'cancel' ? await cancelPost() : await reactivatePost();
    expect(response.status).toBe(200);
    expect(state.sent).toEqual([]);
    expect(emailAudits()).toEqual([]);
  });

  it('the switch off: the routes do not even read the sender or the identity', async () => {
    process.env.BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED = 'false';
    state.identity = 'throws';
    expect((await cancelPost()).status).toBe(200);
    expect(state.sent).toEqual([]);
    expect(emailAudits()).toEqual([]);
    expect(state.order).toEqual(['engine', 'audit:BOS_BILLING_SUBSCRIPTION_CANCELLED']);
  });
});
