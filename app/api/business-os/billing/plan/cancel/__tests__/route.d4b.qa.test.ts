/**
 * QA gap tests for the U-3 / R-D covered mark through the REAL cancel and
 * reactivate routes and the REAL production wiring (`planCancelEmailDeps.ts` →
 * `coverReminderAfterCancelEmail` → the REAL billing-account repository over a
 * fake service-role client), with the engine faked at its own seam (account
 * deletion lifecycle D4b / SX-3 part 2; workplan
 * docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md D4b addendum
 * R-D, SA code review F-3; §13 QA report).
 *
 * The repository is reached through `@/lib/supabaseServer`, so this file names
 * no repository whose callers are allow-listed (no guard allow-list change).
 *
 *   - cancel, end ≤ 3 days, email sent or unknown → ONE update of
 *     `cancel_reminder_sent_for` only, CAS on the session user + mode +
 *     subscription + period end + still set to end, count exact;
 *   - end > 3 days, or already past → no write;
 *   - not_sent (transport refused / rejected / identity unreadable) → no write;
 *   - the mark never answers → cut at 2 s (F-3), `warn mark_timed_out`, the
 *     response is the unchanged 200;
 *   - the mark errors or throws → 200, `warn`;
 *   - ended_now, reactivated (kept), switch off → never a write;
 *   - no address, name or plan name in any log line.
 */

import { NextRequest } from 'next/server';

const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = 'qa.d4b.owner@example.com';
const PLAN_NAME = 'Qa D4b Plan Name';
const SUB = 'sub_qaD4bOwn1';
const HOUR = 60 * 60 * 1000;
const isoIn = (ms: number) => new Date(Math.floor((Date.now() + ms) / 1000) * 1000).toISOString();

type Level = 'info' | 'warn' | 'error' | 'debug';
type Update = { table: string; payload: Record<string, unknown>; options: unknown; filters: Array<[string, unknown]>; selected: boolean; ored: boolean };
const state: {
  user: { id: string; email?: string } | null;
  result: Record<string, unknown>;
  sent: Array<Record<string, unknown>>;
  send: 'ok' | 'refused' | 'throws' | 'hang';
  identity: 'ok' | 'error';
  mark: 'ok' | 'zero' | 'error' | 'throws' | 'hang';
  updates: Update[];
  logs: Array<{ level: Level; args: unknown[] }>;
} = { user: null, result: {}, sent: [], send: 'ok', identity: 'ok', mark: 'ok', updates: [], logs: [] };

jest.mock('@/lib/auth', () => ({ getUser: async () => state.user }));
jest.mock('@/lib/supabaseServer', () => {
  const from = (table: string) => ({
    update: (payload: Record<string, unknown>, options: unknown) => {
      const record: Update = { table, payload, options, filters: [], selected: false, ored: false };
      state.updates.push(record);
      const chain: Record<string, unknown> = {
        eq: (column: string, value: unknown) => {
          record.filters.push([column, value]);
          return chain;
        },
        select: () => {
          record.selected = true;
          return chain;
        },
        or: () => {
          record.ored = true;
          return chain;
        },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          if (state.mark === 'hang') return new Promise(() => undefined);
          if (state.mark === 'throws') return Promise.reject(new Error('network exploded')).then(resolve, reject);
          if (state.mark === 'error') return Promise.resolve({ error: { message: 'db down', code: '57014' }, count: null }).then(resolve, reject);
          return Promise.resolve({ error: null, count: state.mark === 'zero' ? 0 : 1 }).then(resolve, reject);
        },
      };
      return chain;
    },
  });
  return {
    supabaseServer: {
      from,
      auth: {
        admin: {
          getUserById: async (id: string) => {
            if (state.identity === 'error') return { data: { user: null }, error: { status: 500, code: 'unexpected_failure', message: 'down' } };
            return { data: { user: { id, email: OWNER, created_at: '2026-01-01T00:00:00Z' } }, error: null };
          },
        },
      },
    },
  };
});
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
  managePlanSubscription: async () => state.result,
}));
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  ...jest.requireActual('@/lib/audit/boundedAuditFlush'),
  logAndFlush: async () => undefined,
}));
jest.mock('@/lib/notifications/emailTransport', () => ({
  platformSenderAddress: () => 'notifications@agentspilot.ai',
  sendEmail: (params: Record<string, unknown>) => {
    state.sent.push(params);
    if (state.send === 'hang') return new Promise(() => undefined);
    if (state.send === 'throws') return Promise.reject(new Error('transport exploded'));
    if (state.send === 'refused') return Promise.resolve({ sent: false, provider: 'none', error: 'refused' });
    return Promise.resolve({ sent: true, provider: 'resend' });
  },
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findLanguage: async () => ({ data: 'en', error: null }) },
}));
jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
  userPreferencesRepository: {
    findPreferredLanguage: async () => ({ data: null, error: null }),
    findTimezone: async () => ({ data: 'Asia/Jerusalem', error: null }),
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

import { POST as CANCEL } from '@/app/api/business-os/billing/plan/cancel/route';
import { POST as REACTIVATE } from '@/app/api/business-os/billing/plan/reactivate/route';
import { PLAN_CANCEL_EMAIL_POLICY, PLAN_CANCEL_REMINDER_COVER_TIMEOUT_MS } from '@/lib/business-os/billing/planCancelEmail';

const facts = (overrides: Record<string, unknown> = {}) => ({
  action: 'cancel',
  subscriptionId: SUB,
  outcome: 'cancelled',
  endsOn: null,
  renewsOn: null,
  mode: 'period_end',
  livemode: false,
  reasonCode: null,
  ...overrides,
});

function post(url: string) {
  return new NextRequest(`https://example.test${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}
const cancelPost = () => CANCEL(post('/api/business-os/billing/plan/cancel'));
const reactivatePost = () => REACTIVATE(post('/api/business-os/billing/plan/reactivate'));
const billingWrites = () => state.updates.filter((u) => u.table === 'business_os_billing_accounts');
const cancelledAt = (endsOn: string, extra: Record<string, unknown> = {}) => ({ ok: true, outcome: 'cancelled', endsOn, audit: facts({ endsOn, ...extra }) });

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
  state.result = cancelledAt(isoIn(48 * HOUR));
  state.sent = [];
  state.send = 'ok';
  state.identity = 'ok';
  state.mark = 'ok';
  state.updates = [];
  state.logs = [];
});

describe('QA R-D: a cancel inside the last 3 days marks the reminder covered', () => {
  it.each([
    ['2 days', 48 * HOUR],
    ['1 hour', HOUR],
    ['2 days 23 hours', 71 * HOUR],
  ])('end in %s, email sent → ONE CAS write of cancel_reminder_sent_for only, on the session user; 200 unchanged', async (_label, ahead) => {
    const endsOn = isoIn(ahead);
    state.result = cancelledAt(endsOn);
    const response = await cancelPost();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'cancelled', endsOn } });
    expect(state.sent).toHaveLength(1);
    const writes = billingWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toEqual({ cancel_reminder_sent_for: endsOn });
    expect(writes[0].options).toEqual({ count: 'exact' });
    expect(writes[0].selected).toBe(false);
    expect(writes[0].ored).toBe(false);
    expect(writes[0].filters).toEqual([
      ['user_id', USER],
      ['livemode', false],
      ['stripe_subscription_id', SUB],
      ['current_period_end', endsOn],
      ['cancel_at_period_end', true],
    ]);
    expect(Object.keys(writes[0].payload)).not.toContain('updated_at');
  });

  it('email outcome unknown (the send never answers) → still marked (S-3 b: it may have gone)', async () => {
    (PLAN_CANCEL_EMAIL_POLICY as { deadlineMs: number }).deadlineMs = 50;
    state.send = 'hang';
    const response = await cancelPost();
    expect(response.status).toBe(200);
    expect(billingWrites()).toHaveLength(1);
  });

  it('a non-canonical endsOn (+00:00) is written in the canonical ISO form', async () => {
    const canonical = isoIn(24 * HOUR);
    const offset = canonical.replace('.000Z', '+00:00');
    state.result = cancelledAt(offset);
    await cancelPost();
    expect(billingWrites()[0].payload).toEqual({ cancel_reminder_sent_for: canonical });
  });

  it.each([
    ['3 days + 1 minute', 72 * HOUR + 60_000],
    ['10 days', 240 * HOUR],
    ['already past', -HOUR],
  ])('end %s away → no write', async (_label, ahead) => {
    state.result = cancelledAt(isoIn(ahead));
    expect((await cancelPost()).status).toBe(200);
    expect(state.sent).toHaveLength(1);
    expect(billingWrites()).toEqual([]);
  });

  it.each([
    ['the transport refuses', () => (state.send = 'refused')],
    ['the transport rejects', () => (state.send = 'throws')],
    ['the identity read fails', () => (state.identity = 'error')],
  ])('not_sent (%s) → no write: the reminder still goes', async (_label, arrange) => {
    arrange();
    expect((await cancelPost()).status).toBe(200);
    expect(billingWrites()).toEqual([]);
  });

  it('switch off → nothing sent, nothing written', async () => {
    process.env.BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED = 'false';
    expect((await cancelPost()).status).toBe(200);
    expect(state.sent).toEqual([]);
    expect(billingWrites()).toEqual([]);
  });

  it('the row moved on (count 0) → 200, no error log', async () => {
    state.mark = 'zero';
    expect((await cancelPost()).status).toBe(200);
    expect(billingWrites()).toHaveLength(1);
    expect(state.logs.some((l) => l.level === 'error')).toBe(false);
  });
});

describe('QA F-3: a failed or slow mark never changes the answer', () => {
  it(`the mark never answers → cut at ${PLAN_CANCEL_REMINDER_COVER_TIMEOUT_MS} ms, warn mark_timed_out, the same 200`, async () => {
    state.mark = 'hang';
    const endsOn = isoIn(48 * HOUR);
    state.result = cancelledAt(endsOn);
    const started = Date.now();
    const response = await cancelPost();
    const took = Date.now() - started;
    expect(PLAN_CANCEL_REMINDER_COVER_TIMEOUT_MS).toBe(2_000);
    expect(took).toBeGreaterThanOrEqual(PLAN_CANCEL_REMINDER_COVER_TIMEOUT_MS - 50);
    expect(took).toBeLessThan(PLAN_CANCEL_REMINDER_COVER_TIMEOUT_MS + 2_000);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'cancelled', endsOn } });
    expect(state.logs.some((l) => l.level === 'warn' && (l.args[0] as Record<string, unknown>)?.reason === 'mark_timed_out')).toBe(true);
  }, 10_000);

  it.each(['error', 'throws'] as const)('the mark %s → 200 unchanged, logged warn mark_failed', async (mode) => {
    state.mark = mode;
    const response = await cancelPost();
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(state.logs.some((l) => l.level === 'warn' && (l.args[0] as Record<string, unknown>)?.reason === 'mark_failed')).toBe(true);
  });
});

describe('QA: the emails that never mark', () => {
  it('ended_now inside the window → sent, never marked', async () => {
    const endsOn = isoIn(-60_000);
    state.result = { ok: true, outcome: 'cancelled', endsOn, mode: 'immediate', audit: facts({ endsOn, mode: 'immediate', invoicesVoided: 0, invoicesLeftOpen: 0 }) };
    expect((await cancelPost()).status).toBe(200);
    expect(state.sent).toHaveLength(1);
    expect(billingWrites()).toEqual([]);
  });

  it('ended_now with an end that is still a few hours ahead (should not happen, defensive) → never marked', async () => {
    const endsOn = isoIn(5 * HOUR);
    state.result = { ok: true, outcome: 'cancelled', endsOn, mode: 'immediate', audit: facts({ endsOn, mode: 'immediate', invoicesVoided: 0, invoicesLeftOpen: 0 }) };
    await cancelPost();
    expect(billingWrites()).toEqual([]);
  });

  it('reactivated (kept) with a renewal inside 3 days → sent, never marked', async () => {
    const renewsOn = isoIn(48 * HOUR);
    state.result = { ok: true, outcome: 'reactivated', renewsOn, audit: facts({ action: 'reactivate', outcome: 'reactivated', renewsOn }) };
    expect((await reactivatePost()).status).toBe(200);
    expect(state.sent).toHaveLength(1);
    expect(billingWrites()).toEqual([]);
  });
});

describe('QA: no personal data in any log line', () => {
  it.each(['ok', 'hang', 'error'] as const)('mark %s: no address, no plan name', async (mode) => {
    state.mark = mode;
    await cancelPost();
    const dump = JSON.stringify(state.logs.map((l) => l.args));
    expect(dump).not.toContain(OWNER);
    expect(dump).not.toContain(PLAN_NAME);
  }, 10_000);
});
