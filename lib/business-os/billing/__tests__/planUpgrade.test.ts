/**
 * planUpgrade orchestration (plan payments P-7b.1a, workplan §3.2 to §3.4,
 * §7 "Orchestration"; SA U-1, U-2, U-5, V-1 to V-9, Q-1, Q-2, Q-4, Q-6).
 *
 * Every port is a fake that writes to ONE ordered log, so the order contract
 * (V-9: every database read and every our-data refusal before any Stripe
 * call) is asserted on the log itself. Every logger call is captured, so the
 * confirmation secret can be shown to appear in none of them (V-1).
 *
 * Stripe answers are HAND-BUILT, labelled as such: E-1 (payment state on the
 * invoice) and E-2 (decline shape) have not run, so BOTH decline shapes are
 * mapped and tested (V-7).
 */

import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { displayMonthlyPricesUsd, displayPriceInCents } from '@/lib/business-os/billing/planPriceCheck';
import {
  confirmPlanUpgrade,
  PLAN_UPGRADE_PRORATION_MAX_AGE_SECONDS,
  PLAN_UPGRADE_REFUSALS,
  previewPlanUpgrade,
  type PlanUpgradeDeps,
} from '@/lib/business-os/billing/planUpgrade';
import type { BusinessOsBillingAccount } from '@/lib/repositories/BusinessOsBillingAccountRepository';

const USER = '11111111-1111-4111-8111-111111111111';
const LOWER = TIER_ORDER[0];
const TOP = TIER_ORDER[TIER_ORDER.length - 1];
const PRICE_LOWER = `price_${PLAN_STRIPE_PRICES[LOWER].lookupKey}`;
const PRICE_TOP = `price_${PLAN_STRIPE_PRICES[TOP].lookupKey}`;
const SECRET = 'pi_handbuilt_3ds_secret_for_the_owner_only';
const NOW = Date.parse('2026-10-13T10:00:00.000Z');
const NOW_S = Math.floor(NOW / 1000);
const PERIOD_START = NOW_S - 86400 * 10;
const PERIOD_END = NOW_S + 86400 * 20;

function billingRow(overrides: Partial<BusinessOsBillingAccount> = {}): BusinessOsBillingAccount {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_own',
    stripeSubscriptionId: 'sub_own',
    subscriptionStatus: 'active',
    boughtTier: LOWER,
    currentPeriodEnd: new Date(PERIOD_END * 1000).toISOString(),
    cancelAtPeriodEnd: false,
    pendingTier: null,
    openCheckoutSessionId: null,
    openCheckoutExpiresAt: null,
    lastInvoiceId: null,
    lastPaidAt: null,
    lastPaymentFailedAt: null,
    failedAttempts: 0,
    actionRequiredInvoiceUrl: null,
    founderDiscountAppliedAt: null,
    endedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

type SubscriptionRead = Awaited<ReturnType<NonNullable<PlanUpgradeDeps['stripe']>['retrieveBusinessOsSubscription']>>;

function subscription(overrides: Partial<SubscriptionRead> = {}): SubscriptionRead {
  return {
    id: 'sub_own',
    status: 'active',
    customerId: 'cus_own',
    billingCycleAnchor: PERIOD_START,
    cancelAtPeriodEnd: false,
    endedAt: null,
    livemode: false,
    metadata: {},
    priceIds: [PRICE_LOWER],
    items: [{ id: 'si_own', priceId: PRICE_LOWER, currentPeriodStart: PERIOD_START, currentPeriodEnd: PERIOD_END }],
    pendingUpdate: null,
    latestInvoiceId: 'in_last',
    ...overrides,
  };
}

function priceFor(lookupKey: string, overrides: Record<string, unknown> = {}) {
  const tier = TIER_ORDER.find((candidate) => PLAN_STRIPE_PRICES[candidate].lookupKey === lookupKey) ?? LOWER;
  return {
    id: `price_${lookupKey}`,
    lookup_key: lookupKey,
    active: true,
    currency: 'usd',
    unit_amount: displayPriceInCents(displayMonthlyPricesUsd()[tier]),
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
    tax_behavior: 'exclusive',
    livemode: false,
    ...overrides,
  };
}

const stripeError = (type: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`${type} (hand-built)`), { type, ...extra });

interface Harness {
  log: string[];
  logLines: Array<[string, Record<string, unknown>, string]>;
  deps: PlanUpgradeDeps;
  state: {
    row: BusinessOsBillingAccount | null | 'error';
    subscription: SubscriptionRead | Error;
    prices: Array<Record<string, unknown>> | null;
    preview: { amountDueMinor: number; totalMinor: number; taxMinor: number; currency: string } | Error;
    update: Record<string, unknown> | Error;
    invoice: Record<string, unknown> | Error;
    switches: { checkoutEnabled: boolean; pricesEnabled: boolean };
    modeThrows: boolean;
    buyable: readonly string[];
  };
  calls: { update: unknown[]; preview: unknown[]; prices: unknown[]; subscription: unknown[] };
}

function harness(): Harness {
  const log: string[] = [];
  const logLines: Harness['logLines'] = [];
  const calls: Harness['calls'] = { update: [], preview: [], prices: [], subscription: [] };
  const state: Harness['state'] = {
    row: billingRow(),
    subscription: subscription(),
    prices: null,
    preview: { amountDueMinor: 2985, totalMinor: 2985, taxMinor: 0, currency: 'usd' },
    update: {
      subscriptionId: 'sub_own',
      livemode: false,
      pendingUpdate: false,
      pendingUpdateExpiresAt: null,
      invoiceId: 'in_up',
      invoiceStatus: 'paid',
      paymentState: 'succeeded',
      confirmationClientSecret: SECRET,
    },
    invoice: {
      invoiceId: 'in_last',
      subscriptionId: 'sub_own',
      customerId: 'cus_own',
      status: 'open',
      billingReason: 'subscription_update',
      amountDueMinor: 2985,
      livemode: false,
      paymentState: 'requires_action',
      confirmationClientSecret: SECRET,
    },
    switches: { checkoutEnabled: true, pricesEnabled: true },
    modeThrows: false,
    buyable: TIER_ORDER,
  };
  const at = (level: string) => (ctx: Record<string, unknown>, message: string) => {
    logLines.push([level, ctx, message]);
  };
  const deps: PlanUpgradeDeps = {
    logger: { info: at('info'), warn: at('warn'), error: at('error') },
    repo: {
      findByUser: async (userId: string, livemode: boolean) => {
        log.push(`db:findByUser:${userId}:${livemode}`);
        if (state.row === 'error') return { data: null, error: new Error('down') } as never;
        return { data: state.row, error: null };
      },
    },
    stripe: {
      retrieveBusinessOsSubscription: async (id: string) => {
        log.push(`stripe:subscription:${id}`);
        calls.subscription.push(id);
        if (state.subscription instanceof Error) throw state.subscription;
        return state.subscription;
      },
      retrieveBusinessOsUpgradeInvoice: async (id: string) => {
        log.push(`stripe:invoice:${id}`);
        if (state.invoice instanceof Error) throw state.invoice;
        return state.invoice as never;
      },
      previewBusinessOsPlanUpgrade: async (params) => {
        log.push('stripe:preview');
        calls.preview.push(params);
        if (state.preview instanceof Error) throw state.preview;
        return state.preview;
      },
      upgradeBusinessOsPlanSubscription: async (params) => {
        log.push('stripe:update');
        calls.update.push(params);
        if (state.update instanceof Error) throw state.update;
        return state.update as never;
      },
      listPricesByLookupKeys: async (keys: readonly string[]) => {
        log.push(`stripe:prices:${keys.join(',')}`);
        calls.prices.push(keys);
        return (state.prices ?? keys.map((key) => priceFor(key))) as never;
      },
    },
    catalog: {
      load: async () => {
        log.push('stripe:catalog');
        return {
          byPriceId: new Map(TIER_ORDER.map((tier) => [`price_${PLAN_STRIPE_PRICES[tier].lookupKey}`, PLAN_STRIPE_PRICES[tier].lookupKey])),
          fromCache: false,
        };
      },
    },
    switches: () => state.switches,
    buyableTiers: () => state.buyable as never,
    mode: () => {
      if (state.modeThrows) throw new Error('stripe_key_mode_unknown');
      return 'test';
    },
    now: () => new Date(NOW),
  };
  return { log, logLines, deps, state, calls };
}

const stripeCalls = (h: Harness) => h.log.filter((entry) => entry.startsWith('stripe:'));
const refusedLines = (h: Harness) => h.logLines.filter(([, ctx]) => ctx.event === 'bos_billing_upgrade_refused');
const preview = (h: Harness, tier = TOP) => previewPlanUpgrade({ userId: USER, tier }, h.deps);
const confirm = (h: Harness, prorationDate = NOW_S - 30, tier = TOP) => confirmPlanUpgrade({ userId: USER, tier, prorationDate }, h.deps);

/** V-1: the secret is in no log line, no message, no audit fact. */
function expectSecretNowhereButTheBody(h: Harness, result: unknown) {
  expect(JSON.stringify(h.logLines)).not.toContain(SECRET);
  const audit = (result as { audit?: unknown }).audit;
  if (audit !== undefined) expect(JSON.stringify(audit)).not.toContain(SECRET);
}

describe('the preview', () => {
  it('happy path: amounts, tax, the server proration date, the unchanged renewal; DB before Stripe (V-9)', async () => {
    const h = harness();
    const result = await preview(h);
    expect(result).toEqual({
      ok: true,
      fromTier: LOWER,
      tier: TOP,
      lookupKey: PLAN_STRIPE_PRICES[TOP].lookupKey,
      amountDueMinor: 2985,
      totalMinor: 2985,
      taxMinor: 0,
      currency: 'usd',
      prorationDate: NOW_S,
      renewsOn: new Date(PERIOD_END * 1000).toISOString(),
      monthlyPriceMinor: displayPriceInCents(displayMonthlyPricesUsd()[TOP]),
      livemode: false,
    });
    expect(h.log).toEqual([
      `db:findByUser:${USER}:false`,
      'stripe:subscription:sub_own',
      'stripe:catalog',
      `stripe:prices:${PLAN_STRIPE_PRICES[TOP].lookupKey}`,
      'stripe:preview',
    ]);
    // Ids from OUR row and the fresh read; the price is the TARGET's.
    expect(h.calls.preview).toEqual([{ customerId: 'cus_own', subscriptionId: 'sub_own', itemId: 'si_own', priceId: PRICE_TOP, prorationDate: NOW_S }]);
    expect(h.calls.update).toEqual([]);
    expect(h.logLines.find(([, ctx]) => ctx.event === 'bos_billing_upgrade_previewed')).toBeDefined();
  });

  it('a preview whose currency is not USD is refused (price_mismatch, alerted)', async () => {
    const h = harness();
    h.state.preview = { amountDueMinor: 1, totalMinor: 1, taxMinor: 0, currency: 'eur' };
    await expect(preview(h)).resolves.toEqual({ ok: false, code: 'price_mismatch' });
    expect(refusedLines(h)[0][0]).toBe('error');
  });

  it('a preview Stripe does not answer is stripe_error', async () => {
    const h = harness();
    h.state.preview = new Error('timeout');
    await expect(preview(h)).resolves.toEqual({ ok: false, code: 'stripe_error' });
  });
});

describe('our-data refusals make ZERO Stripe calls (V-9, U-2)', () => {
  const cases: Array<[string, (h: Harness) => void, string]> = [
    ['prices switch off', (h) => { h.state.switches = { checkoutEnabled: true, pricesEnabled: false }; }, 'upgrade_unavailable'],
    ['checkout switch off (the route 404s first; the predicate agrees)', (h) => { h.state.switches = { checkoutEnabled: false, pricesEnabled: true }; }, 'upgrade_unavailable'],
    ['key mode unknown', (h) => { h.state.modeThrows = true; }, 'upgrade_unavailable'],
    ['billing row unreadable', (h) => { h.state.row = 'error'; }, 'billing_row_unreadable'],
    ['no billing row', (h) => { h.state.row = null; }, 'not_subscribed'],
    ['no bought tier (held-shaped)', (h) => { h.state.row = billingRow({ boughtTier: null }); }, 'not_subscribed'],
    ['no subscription id', (h) => { h.state.row = billingRow({ stripeSubscriptionId: null }); }, 'not_subscribed'],
    ['record status past_due', (h) => { h.state.row = billingRow({ subscriptionStatus: 'past_due' }); }, 'subscription_not_active'],
    ['record cancelling', (h) => { h.state.row = billingRow({ cancelAtPeriodEnd: true }); }, 'subscription_cancelling'],
    ['already on the top tier', (h) => { h.state.row = billingRow({ boughtTier: TOP }); }, 'not_an_upgrade'],
    ['target not on sale', (h) => { h.state.buyable = [LOWER]; }, 'price_unavailable'],
  ];

  it.each(cases)('preview: %s → %s', async (_label, arrange, code) => {
    const h = harness();
    arrange(h);
    await expect(preview(h)).resolves.toEqual({ ok: false, code });
    expect(stripeCalls(h)).toEqual([]);
  });

  it.each(cases)('confirm: %s → %s', async (_label, arrange, code) => {
    const h = harness();
    arrange(h);
    await expect(confirm(h)).resolves.toEqual({ ok: false, code });
    expect(stripeCalls(h)).toEqual([]);
  });

  it.each([
    ['prices switch off', (h: Harness) => { h.state.switches = { checkoutEnabled: true, pricesEnabled: false }; }, 'bos_billing_prices_switch_off'],
    ['key mode unknown', (h: Harness) => { h.state.modeThrows = true; }, 'stripe_key_mode_unknown'],
  ])('SA F-3: %s is a configuration fault → logged at error with alert: true (as the checkout); code unchanged', async (_label, arrange, reason) => {
    for (const run of [confirm, preview] as const) {
      const h = harness();
      arrange(h);
      await expect(run(h)).resolves.toEqual({ ok: false, code: 'upgrade_unavailable' });
      expect(refusedLines(h)).toEqual([['error', expect.objectContaining({ code: 'upgrade_unavailable', reason, alert: true }), 'Plan upgrade refused']]);
    }
  });

  it('SA F-3: the checkout switch off (purchase_switches_off) stays a warn with no alert', async () => {
    const h = harness();
    h.state.switches = { checkoutEnabled: false, pricesEnabled: true };
    await expect(confirm(h)).resolves.toEqual({ ok: false, code: 'upgrade_unavailable' });
    expect(refusedLines(h)[0][0]).toBe('warn');
    expect(refusedLines(h)[0][1]).toMatchObject({ reason: 'purchase_switches_off' });
    expect(refusedLines(h)[0][1]).not.toHaveProperty('alert');
  });

  it('the target equal to the bought tier → not_an_upgrade, no Stripe call', async () => {
    const h = harness();
    await expect(preview(h, LOWER)).resolves.toEqual({ ok: false, code: 'not_an_upgrade' });
    expect(stripeCalls(h)).toEqual([]);
  });

  it.each([
    ['in the future beyond the 60 s skew', NOW_S + 61],
    ['older than 15 minutes', NOW_S - PLAN_UPGRADE_PRORATION_MAX_AGE_SECONDS - 1],
  ])('Q-1 / V-8: a proration date %s → preview_expired, before any Stripe call', async (_label, prorationDate) => {
    const h = harness();
    await expect(confirm(h, prorationDate)).resolves.toEqual({ ok: false, code: 'preview_expired' });
    expect(stripeCalls(h)).toEqual([]);
  });

  it('the edges of the clock window are admitted', async () => {
    for (const prorationDate of [NOW_S + 60, NOW_S - PLAN_UPGRADE_PRORATION_MAX_AGE_SECONDS]) {
      const h = harness();
      await expect(confirm(h, prorationDate)).resolves.toMatchObject({ ok: true, outcome: 'upgraded' });
    }
  });
});

describe('after the fresh read (U-2, V-2, V-8)', () => {
  it('a Stripe read failure is stripe_error, alerted, and nothing is written', async () => {
    const h = harness();
    h.state.subscription = new Error('stripe down');
    await expect(confirm(h)).resolves.toEqual({ ok: false, code: 'stripe_error' });
    expect(h.calls.update).toEqual([]);
    expect(refusedLines(h)[0]).toEqual(['error', expect.objectContaining({ code: 'stripe_error', alert: true }), 'Plan upgrade refused']);
  });

  it('billing_record_mismatch is alerted; nothing is written', async () => {
    const h = harness();
    h.state.subscription = subscription({ customerId: 'cus_someone_else' });
    await expect(confirm(h)).resolves.toEqual({ ok: false, code: 'billing_record_mismatch' });
    expect(h.calls.update).toEqual([]);
    expect(refusedLines(h)[0]).toEqual(['error', expect.objectContaining({ alert: true }), 'Plan upgrade refused']);
  });

  it('V-2: Stripe already bills the higher tier → upgrade_processing, a warn with NO alert', async () => {
    const h = harness();
    h.state.subscription = subscription({ items: [{ id: 'si_own', priceId: PRICE_TOP, currentPeriodStart: PERIOD_START, currentPeriodEnd: PERIOD_END }] });
    await expect(confirm(h)).resolves.toEqual({ ok: false, code: 'upgrade_processing' });
    expect(refusedLines(h)[0][0]).toBe('warn');
    expect(refusedLines(h)[0][1]).not.toHaveProperty('alert');
    expect(h.calls.update).toEqual([]);
  });

  it('V-8: a preview taken before a renewal and confirmed after it (proration date before the ITEM period start) → preview_expired', async () => {
    const h = harness();
    h.state.subscription = subscription({ items: [{ id: 'si_own', priceId: PRICE_LOWER, currentPeriodStart: NOW_S - 10, currentPeriodEnd: PERIOD_END }] });
    await expect(confirm(h, NOW_S - 30)).resolves.toEqual({ ok: false, code: 'preview_expired' });
    expect(h.calls.update).toEqual([]);
  });

  it('the runtime price check is on the TARGET and refuses a mismatch before the write', async () => {
    const h = harness();
    h.state.prices = [priceFor(PLAN_STRIPE_PRICES[TOP].lookupKey, { unit_amount: 1 })];
    await expect(confirm(h)).resolves.toEqual({ ok: false, code: 'price_mismatch' });
    expect(h.calls.prices).toEqual([[PLAN_STRIPE_PRICES[TOP].lookupKey]]);
    expect(h.calls.update).toEqual([]);
  });
});

describe('the confirm: outcomes (U-5, V-3, V-4, V-7, Q-4, Q-6)', () => {
  it('paid at once → upgraded; the write uses OUR row, the fresh item and the TARGET price; audit facts returned', async () => {
    const h = harness();
    const result = await confirm(h);
    expect(result).toEqual({
      ok: true,
      outcome: 'upgraded',
      audit: {
        fromTier: LOWER,
        toTier: TOP,
        lookupKey: PLAN_STRIPE_PRICES[TOP].lookupKey,
        prorationDate: NOW_S - 30,
        outcome: 'upgraded',
        invoiceId: 'in_up',
        subscriptionId: 'sub_own',
        livemode: false,
        resumed: false,
      },
    });
    expect(h.calls.update).toEqual([{ subscriptionId: 'sub_own', itemId: 'si_own', priceId: PRICE_TOP, prorationDate: NOW_S - 30 }]);
    const order = h.log.filter((entry) => entry.startsWith('db:') || entry === 'stripe:update');
    expect(order).toEqual([`db:findByUser:${USER}:false`, 'stripe:update']);
    expectSecretNowhereButTheBody(h, result);
  });

  it('3-D Secure asked → action_required with the secret, which no log line carries (V-1)', async () => {
    const h = harness();
    h.state.update = { ...(h.state.update as object), pendingUpdate: true, pendingUpdateExpiresAt: NOW_S + 3600, invoiceStatus: 'open', paymentState: 'requires_action' };
    const result = await confirm(h);
    expect(result).toMatchObject({ ok: true, outcome: 'action_required', clientSecret: SECRET, resumed: false, audit: { outcome: 'action_required' } });
    expectSecretNowhereButTheBody(h, result);
  });

  it('V-7: a returned pending update with requires_payment_method → declined, with retryAfter (Q-6)', async () => {
    const h = harness();
    h.state.update = { ...(h.state.update as object), pendingUpdate: true, pendingUpdateExpiresAt: NOW_S + 3600, invoiceStatus: 'open', paymentState: 'requires_payment_method' };
    const result = await confirm(h);
    expect(result).toEqual({
      ok: true,
      outcome: 'declined',
      retryAfter: new Date((NOW_S + 3600) * 1000).toISOString(),
      audit: expect.objectContaining({ outcome: 'declined', invoiceId: 'in_up' }),
    });
    expectSecretNowhereButTheBody(h, result);
  });

  it('V-7: a card error THROWN by the call → declined, audited; the error object is never logged', async () => {
    const h = harness();
    h.state.update = stripeError('StripeCardError', { code: 'card_declined', payment_intent: { client_secret: SECRET } });
    const result = await confirm(h);
    expect(result).toEqual({ ok: true, outcome: 'declined', audit: expect.objectContaining({ outcome: 'declined', invoiceId: null }) });
    expectSecretNowhereButTheBody(h, result);
  });

  it('V-4 / Q-4: processing is its own outcome', async () => {
    const h = harness();
    h.state.update = { ...(h.state.update as object), pendingUpdate: true, invoiceStatus: 'open', paymentState: 'processing' };
    await expect(confirm(h)).resolves.toMatchObject({ ok: true, outcome: 'processing', audit: { outcome: 'processing' } });
  });

  it.each([
    ['StripeIdempotencyError'],
    ['StripeInvalidRequestError'],
    ['StripeAPIError'],
  ])('V-7 / SA F-2: idempotency_key_in_use as %s (matched by CODE, whatever the class) → upgrade_busy, a refusal: no audit', async (type) => {
    const h = harness();
    h.state.update = stripeError(type, { code: 'idempotency_key_in_use' });
    const result = await confirm(h);
    expect(result).toEqual({ ok: false, code: 'upgrade_busy' });
    expect(result).not.toHaveProperty('audit');
    expect(h.logLines.some(([, ctx]) => ctx.event === 'bos_billing_upgrade_requested')).toBe(false);
    expect(refusedLines(h)[0][0]).toBe('warn');
  });

  it('V-7: any other idempotency error → stripe_error, alerted, no audit', async () => {
    const h = harness();
    h.state.update = stripeError('StripeIdempotencyError', { code: 'idempotency_error' });
    await expect(confirm(h)).resolves.toEqual({ ok: false, code: 'stripe_error' });
    expect(refusedLines(h)[0][1]).toMatchObject({ alert: true, reason: 'idempotency_error' });
  });

  it('a request Stripe refused before running it (invalid request) → stripe_error, no audit', async () => {
    const h = harness();
    h.state.update = stripeError('StripeInvalidRequestError', { code: 'parameter_invalid' });
    await expect(confirm(h)).resolves.toEqual({ ok: false, code: 'stripe_error' });
  });

  it.each([
    ['a 5xx', stripeError('StripeAPIError')],
    ['a connection error', stripeError('StripeConnectionError')],
    ['an untyped timeout', new Error('ETIMEDOUT')],
  ])('V-3: %s on the write → stripe_error with outcomeUnknown, alerted, audited as unknown', async (_label, err) => {
    const h = harness();
    h.state.update = err;
    const result = await confirm(h);
    expect(result).toEqual({
      ok: false,
      code: 'stripe_error',
      outcomeUnknown: true,
      audit: expect.objectContaining({ outcome: 'unknown', invoiceId: null, prorationDate: NOW_S - 30 }),
    });
    expect(refusedLines(h)[0][1]).toMatchObject({ alert: true, reason: 'outcome_unknown' });
  });

  it('V-3: a pending update whose payment state cannot be read is "unknown", never "nothing changed"', async () => {
    const h = harness();
    h.state.update = { ...(h.state.update as object), pendingUpdate: true, invoiceStatus: 'open', paymentState: 'none' };
    await expect(confirm(h)).resolves.toMatchObject({ ok: false, code: 'stripe_error', outcomeUnknown: true, audit: { outcome: 'unknown' } });
  });

  it('Try again after an unknown result re-posts the same proration date: the write is called with identical params (same key)', async () => {
    const h = harness();
    h.state.update = stripeError('StripeConnectionError');
    await confirm(h, NOW_S - 30);
    h.state.update = { ...harness().state.update as object };
    await confirm(h, NOW_S - 30);
    expect(h.calls.update).toHaveLength(2);
    expect(h.calls.update[0]).toEqual(h.calls.update[1]);
  });
});

describe('Q-2: resume an abandoned 3-D Secure (server half)', () => {
  const pendingForTarget = (h: Harness, overrides: Partial<SubscriptionRead> = {}) => {
    h.state.subscription = subscription({ pendingUpdate: { expiresAt: NOW_S + 3600, priceIds: [PRICE_TOP] }, latestInvoiceId: 'in_last', ...overrides });
  };

  it('confirm: our pending upgrade to the target, open, requires_action → the SAME confirmation, no new update, audited resumed', async () => {
    const h = harness();
    pendingForTarget(h);
    const result = await confirm(h);
    expect(result).toEqual({
      ok: true,
      outcome: 'action_required',
      clientSecret: SECRET,
      resumed: true,
      audit: expect.objectContaining({ outcome: 'action_required', resumed: true, invoiceId: 'in_last', lookupKey: null }),
    });
    expect(h.calls.update).toEqual([]);
    expect(stripeCalls(h)).toEqual(['stripe:subscription:sub_own', 'stripe:catalog', 'stripe:invoice:in_last']);
    expectSecretNowhereButTheBody(h, result);
  });

  it('preview: the same case → upgrade_awaiting_confirmation with the pending amount and a fresh proration date, NEVER a secret', async () => {
    const h = harness();
    pendingForTarget(h);
    const result = await preview(h);
    expect(result).toEqual({ ok: false, code: 'upgrade_awaiting_confirmation', amountDueMinor: 2985, prorationDate: NOW_S });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expectSecretNowhereButTheBody(h, result);
    expect(h.calls.preview).toEqual([]);
  });

  it.each([
    ['declined (requires_payment_method)', (h: Harness) => { h.state.invoice = { ...(h.state.invoice as object), paymentState: 'requires_payment_method' }; }],
    ['another target', (h: Harness) => pendingForTarget(h, { pendingUpdate: { expiresAt: NOW_S + 3600, priceIds: [PRICE_LOWER] } })],
    ['an invoice of another subscription', (h: Harness) => { h.state.invoice = { ...(h.state.invoice as object), subscriptionId: 'sub_other' }; }],
    ['an invoice of another customer', (h: Harness) => { h.state.invoice = { ...(h.state.invoice as object), customerId: 'cus_other' }; }],
    // SA F-4 (kills mutation M8): the invoice in the other mode than our test-mode row.
    ['an invoice in the other mode (livemode true against a test row)', (h: Harness) => { h.state.invoice = { ...(h.state.invoice as object), livemode: true }; }],
    ['a renewal invoice', (h: Harness) => { h.state.invoice = { ...(h.state.invoice as object), billingReason: 'subscription_cycle' }; }],
    ['an invoice no longer open', (h: Harness) => { h.state.invoice = { ...(h.state.invoice as object), status: 'void' }; }],
    ['no confirmation secret', (h: Harness) => { h.state.invoice = { ...(h.state.invoice as object), confirmationClientSecret: null }; }],
    ['no latest invoice', (h: Harness) => pendingForTarget(h, { latestInvoiceId: null })],
  ])('every other pending case stays upgrade_pending with retryAfter: %s', async (_label, arrange) => {
    for (const run of [confirm, preview] as const) {
      const h = harness();
      pendingForTarget(h);
      arrange(h);
      const result = await run(h);
      expect(result).toEqual({ ok: false, code: 'upgrade_pending', retryAfter: new Date((NOW_S + 3600) * 1000).toISOString() });
      expect(h.calls.update).toEqual([]);
      expectSecretNowhereButTheBody(h, result);
    }
  });

  it('V-9: the invoice read happens only after the subscription read showed a pending update', async () => {
    const h = harness();
    await confirm(h);
    expect(h.log.some((entry) => entry.startsWith('stripe:invoice:'))).toBe(false);
  });

  it('a failed invoice read is stripe_error, nothing written', async () => {
    const h = harness();
    pendingForTarget(h);
    h.state.invoice = new Error('down');
    await expect(confirm(h)).resolves.toEqual({ ok: false, code: 'stripe_error' });
    expect(h.calls.update).toEqual([]);
  });
});

describe('the refusal table', () => {
  it('every code has a status and an owner message that names no internal', () => {
    for (const [code, { status, message }] of Object.entries(PLAN_UPGRADE_REFUSALS)) {
      expect({ code, status: [409, 502, 503].includes(status) }).toEqual({ code, status: true });
      expect(message).not.toMatch(/stripe|supabase|sub_|cus_|price_/i);
    }
  });
});
