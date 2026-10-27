/**
 * QA (P-7a.4, 2026-10-27) — POST cancel / reactivate during a failed payment,
 * through the REAL routes and the REAL orchestration. The billing repository is
 * a STATEFUL fake (its mirror writes back into the row the next request reads),
 * Stripe, the session and the audit flush are fakes, and every logger line is
 * captured. SA "QA focus" items 2–5:
 *
 *   2  a cured row (renewal paid, webhook late or replayed): Cancel gives the
 *      period-end answer, never an immediate end, never "has ended";
 *   3  two tabs: the second press writes nothing at Stripe and audits nothing;
 *   4  forced void failure / `has_more` / failed list: 200, invoicesLeftOpen
 *      1 / null, exactly one `error` + `alert: true` line, no key in any log;
 *   5  Reactivate on a failing row → 409 `payment_failed_contact_us`, nothing
 *      written (the screen maps it to `plan.manage.refusal.payment_failed`).
 */

import { NextRequest } from 'next/server';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW_UNIX = Math.floor(Date.now() / 1000);
const PERIOD_END = NOW_UNIX + 86400 * 30;

type Rec = Record<string, unknown>;

const state: {
  log: string[];
  logs: Array<{ level: string; ctx: Rec; msg: string }>;
  audits: Rec[];
  row: Rec;
  subscription: Rec;
  list: { invoices: Rec[]; hasMore: boolean } | 'throw';
  voidAnswer: 'void' | 'throw' | 'open';
  keys: string[];
} = { log: [], logs: [], audits: [], row: {}, subscription: {}, list: { invoices: [], hasMore: false }, voidAnswer: 'void', keys: [] };

jest.mock('@/lib/auth', () => ({ getUser: async () => ({ id: USER, email: 'owner@example.com' }) }));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/logger', () => {
  const make = (): Rec => {
    const logger: Rec = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (ctx: unknown, msg?: unknown) => {
        state.logs.push({ level, ctx: (typeof ctx === 'object' && ctx !== null ? ctx : { value: ctx }) as Rec, msg: String(msg ?? '') });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// STATEFUL: the mirror writes into the row the next request reads (as the CAS would).
jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', () => ({
  businessOsBillingAccountRepository: {
    findByUser: async () => {
      state.log.push('db:findByUser');
      return { data: { ...state.row }, error: null };
    },
    mirrorSubscriptionState: async (input: { status: string; cancelAtPeriodEnd: boolean; endedAtIso: string | null; stripeSubscriptionId: string }) => {
      state.log.push(`db:mirror:${input.status}`);
      if (input.stripeSubscriptionId === state.row.stripeSubscriptionId) {
        state.row = { ...state.row, subscriptionStatus: input.status, cancelAtPeriodEnd: input.cancelAtPeriodEnd, endedAt: input.endedAtIso };
      }
      return { data: { mirrored: true }, error: null };
    },
  },
}));

const mockStripe = {
  retrieveBusinessOsSubscription: jest.fn(async (id: string) => {
    state.log.push(`stripe:retrieve:${id}`);
    return { ...state.subscription };
  }),
  setBusinessOsCancelAtPeriodEnd: jest.fn(async (id: string, value: boolean, opts?: { idempotencyKey?: string }) => {
    state.log.push(`stripe:update:${id}:${value}`);
    if (opts?.idempotencyKey) state.keys.push(opts.idempotencyKey);
    const answer = { id: 'sub_own', status: state.subscription.status, customerId: 'cus_own', livemode: false, cancelAtPeriodEnd: value, cancelAt: value ? PERIOD_END : null, endedAt: null, currentPeriodEnd: PERIOD_END };
    state.subscription = { ...state.subscription, cancelAtPeriodEnd: value, cancelAt: value ? PERIOD_END : null };
    return answer;
  }),
  cancelBusinessOsSubscriptionNow: jest.fn(async (id: string, opts: { idempotencyKey: string }) => {
    state.log.push(`stripe:cancel_now:${id}`);
    state.keys.push(opts.idempotencyKey);
    // Stripe now holds the subscription as ended (X-4b).
    state.subscription = { ...state.subscription, status: 'canceled', endedAt: NOW_UNIX };
    return { id: 'sub_own', status: 'canceled', customerId: 'cus_own', livemode: false, cancelAtPeriodEnd: false, cancelAt: null, endedAt: NOW_UNIX, currentPeriodEnd: PERIOD_END };
  }),
  listBusinessOsOpenSubscriptionInvoices: jest.fn(async (id: string) => {
    state.log.push(`stripe:list_open:${id}`);
    if (state.list === 'throw') throw Object.assign(new Error('list down'), { type: 'StripeAPIError', statusCode: 500 });
    return state.list;
  }),
  voidBusinessOsInvoice: jest.fn(async (id: string, opts: { idempotencyKey: string }) => {
    state.log.push(`stripe:void:${id}`);
    state.keys.push(opts.idempotencyKey);
    if (state.voidAnswer === 'throw') throw Object.assign(new Error(`void failed ${opts.idempotencyKey}`), { type: 'StripeAPIError', statusCode: 500 });
    return { id, status: state.voidAnswer };
  }),
};
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockStripe }));

const mockLogAndFlush = jest.fn(async (entry: Rec) => {
  state.log.push(`audit:${String(entry.action)}`);
  state.audits.push(entry);
});
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...args: unknown[]) => mockLogAndFlush(...(args as [Rec])),
}));

import { POST as CANCEL } from '@/app/api/business-os/billing/plan/cancel/route';
import { POST as REACTIVATE } from '@/app/api/business-os/billing/plan/reactivate/route';
import { planManageRefusalKey } from '@/components/business-os/settings/planManageCopy';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';

function billingRow(overrides: Rec = {}): Rec {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_own',
    stripeSubscriptionId: 'sub_own',
    subscriptionStatus: 'past_due',
    boughtTier: 'tier_one',
    currentPeriodEnd: new Date((NOW_UNIX - 86400) * 1000).toISOString(),
    cancelAtPeriodEnd: false,
    endedAt: null,
    failedAttempts: 1,
    ...overrides,
  };
}

function subscription(overrides: Rec = {}): Rec {
  return {
    id: 'sub_own',
    status: 'past_due',
    customerId: 'cus_own',
    billingCycleAnchor: PERIOD_END - 86400 * 30,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    endedAt: null,
    livemode: false,
    metadata: {},
    priceIds: ['price_one'],
    items: [{ id: 'si_1', priceId: 'price_one', currentPeriodStart: PERIOD_END - 86400 * 30, currentPeriodEnd: PERIOD_END }],
    pendingUpdate: null,
    latestInvoiceId: 'in_open',
    ...overrides,
  };
}

const openInvoice = (id: string, overrides: Rec = {}): Rec => ({ id, status: 'open', customerId: 'cus_own', subscriptionId: 'sub_own', livemode: false, ...overrides });

const post = (handler: (request: NextRequest) => Promise<Response>, path: string, body: unknown) =>
  handler(new NextRequest(`https://example.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const cancelPost = (body: unknown = {}) => post(CANCEL, '/api/business-os/billing/plan/cancel', body);
const reactivatePost = (body: unknown = {}) => post(REACTIVATE, '/api/business-os/billing/plan/reactivate', body);

const stripeWrites = () => state.log.filter((e) => /^stripe:(update|cancel_now|void)/.test(e));
const alertLines = () => state.logs.filter((l) => l.level === 'error' && l.ctx.alert === true);

const ENV = ['BUSINESS_OS_PLAN_PRICES_ENABLED', 'STRIPE_SECRET_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const name of ENV) savedEnv[name] = process.env[name];
});
afterAll(() => {
  for (const name of ENV) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

beforeEach(() => {
  process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  state.log = [];
  state.logs = [];
  state.audits = [];
  state.keys = [];
  state.row = billingRow();
  state.subscription = subscription();
  state.list = { invoices: [openInvoice('in_open')], hasMore: false };
  state.voidAnswer = 'void';
  mockLogAndFlush.mockClear();
  for (const fn of Object.values(mockStripe)) fn.mockClear();
});

// ── Focus 2 ─────────────────────────────────────────────────────────────────

describe('QA focus 2: a cured row (renewal paid, webhook late or replayed) never ends now', () => {
  it.each([
    ['past_due row, Stripe active', billingRow(), subscription({ status: 'active' })],
    ['unpaid row, Stripe active', billingRow({ subscriptionStatus: 'unpaid' }), subscription({ status: 'active' })],
    ['active row with failed_attempts, Stripe active', billingRow({ subscriptionStatus: 'active', failedAttempts: 2 }), subscription({ status: 'active' })],
    ['past_due row, Stripe trialing', billingRow(), subscription({ status: 'trialing' })],
  ])('%s → period-end write, `cancelled` with the period end and NO mode; no immediate end, no list, no void', async (_label, row, sub) => {
    state.row = row;
    state.subscription = sub;
    const response = await cancelPost({});
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, data: { outcome: 'cancelled', endsOn: new Date(PERIOD_END * 1000).toISOString() } });
    expect(stripeWrites()).toEqual(['stripe:update:sub_own:true']);
    expect(mockStripe.cancelBusinessOsSubscriptionNow).not.toHaveBeenCalled();
    expect(mockStripe.listBusinessOsOpenSubscriptionInvoices).not.toHaveBeenCalled();
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ details: { mode: 'period_end', outcome: 'cancelled' } });
    // The mirror heals our row to Stripe's cured status.
    expect(state.row.subscriptionStatus).toBe(sub.status);
  });

  it('cured AND already set to end at Stripe (a replayed press) → unchanged / cancelling with the date, nothing written, not audited', async () => {
    state.subscription = subscription({ status: 'active', cancelAtPeriodEnd: true, cancelAt: PERIOD_END });
    const response = await cancelPost({});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'unchanged', state: 'cancelling', date: new Date(PERIOD_END * 1000).toISOString() } });
    expect(stripeWrites()).toEqual([]);
    expect(state.audits).toEqual([]);
    // Healed, so the next view reads "cancelling", not "failing".
    expect(state.row).toMatchObject({ subscriptionStatus: 'active', cancelAtPeriodEnd: true });
  });
});

// ── Focus 3 ─────────────────────────────────────────────────────────────────

describe('QA focus 3: two tabs', () => {
  it('tab B presses while our row still lags (mirror not landed) → unchanged / ended; no Stripe write, no audit', async () => {
    const first = await cancelPost({});
    expect((await first.json()).data).toMatchObject({ outcome: 'cancelled', mode: 'immediate' });
    expect(state.audits).toHaveLength(1);
    // Simulate the lagging row (e.g. a mirror that failed): the row still says past_due.
    state.row = billingRow();
    state.log = [];
    const second = await cancelPost({});
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ success: true, data: { outcome: 'unchanged', state: 'ended', date: new Date(NOW_UNIX * 1000).toISOString() } });
    expect(stripeWrites()).toEqual([]);
    expect(mockStripe.cancelBusinessOsSubscriptionNow).toHaveBeenCalledTimes(1);
    expect(mockStripe.voidBusinessOsInvoice).toHaveBeenCalledTimes(1);
    expect(state.audits).toHaveLength(1);
  });

  // QA E-1, closed by TL ruling 2026-10-27: tab B now reads "has ended", from our row.
  it('tab B presses AFTER our mirror landed (the usual case) → 200 unchanged / ended, read from our row: no Stripe call at all, no audit (QA E-1 closed)', async () => {
    const first = await cancelPost({});
    expect(first.status).toBe(200);
    const endedIso = new Date(NOW_UNIX * 1000).toISOString();
    expect(state.row).toMatchObject({ subscriptionStatus: 'canceled', endedAt: endedIso });
    state.log = [];
    const second = await cancelPost({});
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body).toEqual({ success: true, data: { outcome: 'unchanged', state: 'ended', date: endedIso } });
    expect(state.log).toEqual(['db:findByUser']);
    expect(mockStripe.cancelBusinessOsSubscriptionNow).toHaveBeenCalledTimes(1);
    expect(state.audits).toHaveLength(1);
    // The refusal-key map is no longer involved: the screen reads "has ended" from `state: 'ended'`.
    expect(typeof planManageRefusalKey).toBe('function');
  });
});

// ── Focus 4 ─────────────────────────────────────────────────────────────────

describe('QA focus 4: a void that cannot be done never fails the request, and is alerted once', () => {
  const leftOpenAlerts = () => alertLines().filter((l) => l.ctx.event === 'bos_billing_cancel_now_invoice_left_open');

  it.each([
    ['the void throws', () => { state.voidAnswer = 'throw'; }, 0, 1],
    ['the void answers not void', () => { state.voidAnswer = 'open'; }, 0, 1],
    ['the list throws', () => { state.list = 'throw'; }, 0, null],
    ['has_more (a second page)', () => { state.list = { invoices: [openInvoice('in_open')], hasMore: true }; }, 1, null],
    ['an invoice of another customer', () => { state.list = { invoices: [openInvoice('in_other', { customerId: 'cus_other' })], hasMore: false }; }, 0, 1],
  ])('%s → 200 immediate, audited with its void counts, exactly one alert line, no key anywhere', async (_label, arrange, voided, leftOpen) => {
    (arrange as () => void)();
    const response = await cancelPost({ reasonCode: 'too_expensive' });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ success: true, data: { outcome: 'cancelled', endsOn: new Date(NOW_UNIX * 1000).toISOString(), mode: 'immediate' } });
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ details: { mode: 'immediate', outcome: 'cancelled', invoicesVoided: voided, invoicesLeftOpen: leftOpen } });
    expect(leftOpenAlerts()).toHaveLength(1);
    expect(alertLines()).toHaveLength(1);
    // The mirror still ran: the plan ended.
    expect(state.row).toMatchObject({ subscriptionStatus: 'canceled' });

    // No idempotency key, nor its attempt id, in any log line, the response, or the audit.
    expect(state.keys.length).toBeGreaterThan(0);
    const attemptIds = state.keys.map((k) => k.split(':').pop() as string);
    const haystack = JSON.stringify(state.logs) + text + JSON.stringify(state.audits.map((a) => a.details));
    for (const key of state.keys) expect(haystack).not.toContain(key);
    for (const id of attemptIds) expect(haystack).not.toContain(id);
    expect(haystack).not.toContain('bos-plan-manage:');
  });

  it('every key is per attempt: two presses on two failing subscriptions never share a key', async () => {
    await cancelPost({});
    state.row = billingRow();
    state.subscription = subscription();
    await cancelPost({});
    const cancelKeys = state.keys.filter((k) => k.includes(':cancel_now:'));
    expect(cancelKeys).toHaveLength(2);
    expect(new Set(cancelKeys).size).toBe(2);
    for (const k of state.keys) expect(k).toMatch(/^bos-plan-manage:(sub_own:cancel_now|in_open:void):[0-9a-f-]{36}$/);
  });
});

// ── Focus 5 ─────────────────────────────────────────────────────────────────

describe('QA focus 5: Reactivate during a failed payment', () => {
  it('a failing row → 409 payment_failed_contact_us before any Stripe call; nothing written, not audited', async () => {
    const response = await reactivatePost({});
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, code: 'payment_failed_contact_us' });
    expect(state.log).toEqual(['db:findByUser']);
    expect(state.audits).toEqual([]);
  });

  it('a stale cancelling row while Stripe says past_due → the row is `failing` (failure first) → same 409, no Stripe call', async () => {
    state.row = billingRow({ subscriptionStatus: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: new Date(PERIOD_END * 1000).toISOString(), failedAttempts: 1 });
    const response = await reactivatePost({});
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('payment_failed_contact_us');
    expect(stripeWrites()).toEqual([]);
  });

  it('a renewing row (no failure recorded) while Stripe says past_due → 409 after the one fresh read, nothing written', async () => {
    state.row = billingRow({ subscriptionStatus: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: new Date(PERIOD_END * 1000).toISOString(), failedAttempts: 0 });
    const response = await reactivatePost({});
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('payment_failed_contact_us');
    expect(state.log).toEqual(['db:findByUser', 'stripe:retrieve:sub_own']);
    expect(state.audits).toEqual([]);
  });

  it('the screen reads the new line for that code in en / he / es (never the server English)', () => {
    const key = planManageRefusalKey({ httpStatus: 409, code: 'payment_failed_contact_us', outcomeUnknown: false });
    expect(key).toBe('plan.manage.refusal.payment_failed');
    const dict = { en, he, es } as unknown as Record<'en' | 'he' | 'es', Record<string, string>>;
    for (const lang of ['en', 'he', 'es'] as const) {
      expect(dict[lang][key]).toBeTruthy();
      expect(dict[lang][key]).not.toMatch(/contact us/i);
    }
    expect(dict.he[key]).toMatch(/[֐-׿]/);
    expect(dict.es[key]).not.toBe(dict.en[key]);
  });
});
