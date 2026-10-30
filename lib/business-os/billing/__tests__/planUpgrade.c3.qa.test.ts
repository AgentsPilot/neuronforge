/**
 * QA, plan payments follow-ups C-3 (SA Q-5, W-6): the upgrade refuses a
 * subscription Stripe has set to end, by the flag OR any `cancel_at`, before
 * any preview or update call; a subscription with neither is still upgraded.
 *
 * The harness below is copied verbatim from `planUpgrade.test.ts` (hand-built
 * Stripe answers, one ordered call log). No database, no Stripe.
 */


import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { displayMonthlyPricesUsd, displayPriceInCents } from '@/lib/business-os/billing/planPriceCheck';
import {
  confirmPlanUpgrade,
  PLAN_UPGRADE_REFUSALS,
  previewPlanUpgrade,
  type PlanUpgradeDeps,
} from '@/lib/business-os/billing/planUpgrade';

// The billing row type, reached through the upgrade's port so this file does not
// name the repository (its caller source guard lists every file that does).
type BusinessOsBillingAccount = NonNullable<Awaited<ReturnType<NonNullable<PlanUpgradeDeps['repo']>['findByUser']>>['data']>;

const USER = '11111111-1111-4111-8111-111111111111';
const LOWER = TIER_ORDER[0];
const TOP = TIER_ORDER[TIER_ORDER.length - 1];
const PRICE_LOWER = `price_${PLAN_STRIPE_PRICES[LOWER].lookupKey}`;
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

const refusedLines = (h: Harness) => h.logLines.filter(([, ctx]) => ctx.event === 'bos_billing_upgrade_refused');
const preview = (h: Harness, tier = TOP) => previewPlanUpgrade({ userId: USER, tier }, h.deps);
const confirm = (h: Harness, prorationDate = NOW_S - 30, tier = TOP) => confirmPlanUpgrade({ userId: USER, tier, prorationDate }, h.deps);

const writesOrPreviews = (h: Harness) => h.log.filter((entry) => entry === 'stripe:preview' || entry === 'stripe:update');

describe('QA C-3 · the upgrade refusal on a subscription set to end', () => {
  it.each([['preview', preview], ['confirm', confirm]] as const)('%s, cancel_at ONLY (flag false): subscription_cancelling, reason stripe_cancel_at, zero preview / update', async (_label, run) => {
    const h = harness();
    h.state.subscription = subscription({ cancelAtPeriodEnd: false, cancelAt: PERIOD_END });
    await expect(run(h)).resolves.toEqual({ ok: false, code: 'subscription_cancelling' });
    expect(writesOrPreviews(h)).toEqual([]);
    expect(h.calls.preview).toEqual([]);
    expect(h.calls.update).toEqual([]);
    expect(refusedLines(h)).toHaveLength(1);
    expect(refusedLines(h)[0][1]).toMatchObject({ code: 'subscription_cancelling', reason: 'stripe_cancel_at' });
  });

  it.each([['preview', preview], ['confirm', confirm]] as const)('%s, a cancel_at LATER than the period end still refuses (any date, SA Q-5)', async (_label, run) => {
    const h = harness();
    h.state.subscription = subscription({ cancelAtPeriodEnd: false, cancelAt: PERIOD_END + 86400 * 60 });
    await expect(run(h)).resolves.toEqual({ ok: false, code: 'subscription_cancelling' });
    expect(writesOrPreviews(h)).toEqual([]);
  });

  it.each([['preview', preview], ['confirm', confirm]] as const)('%s, the FLAG only: subscription_cancelling, reason stripe_cancel_at_period_end, zero preview / update', async (_label, run) => {
    const h = harness();
    h.state.subscription = subscription({ cancelAtPeriodEnd: true });
    await expect(run(h)).resolves.toEqual({ ok: false, code: 'subscription_cancelling' });
    expect(writesOrPreviews(h)).toEqual([]);
    expect(refusedLines(h)[0][1]).toMatchObject({ code: 'subscription_cancelling', reason: 'stripe_cancel_at_period_end' });
  });

  it('both set: the flag reason wins (the first rule)', async () => {
    const h = harness();
    h.state.subscription = subscription({ cancelAtPeriodEnd: true, cancelAt: PERIOD_END });
    await expect(preview(h)).resolves.toEqual({ ok: false, code: 'subscription_cancelling' });
    expect(refusedLines(h)[0][1]).toMatchObject({ reason: 'stripe_cancel_at_period_end' });
  });

  it.each<[string, Record<string, unknown>]>([
    ['cancel_at absent', {}],
    ['cancel_at null', { cancelAt: null }],
    ['cancel_at 0', { cancelAt: 0 }],
  ])('neither (%s): still allowed, preview and confirm go through', async (_label, extra) => {
    const p = harness();
    p.state.subscription = subscription({ cancelAtPeriodEnd: false, ...extra });
    await expect(preview(p)).resolves.toMatchObject({ ok: true });
    expect(p.calls.preview).toHaveLength(1);
    const c = harness();
    c.state.subscription = subscription({ cancelAtPeriodEnd: false, ...extra });
    await expect(confirm(c)).resolves.toMatchObject({ ok: true, outcome: 'upgraded' });
    expect(c.calls.update).toHaveLength(1);
  });

  it('the refusal copy for subscription_cancelling does not say "you cancelled" (true for a dashboard cancellation, W-6)', () => {
    const copy = JSON.stringify((PLAN_UPGRADE_REFUSALS as Record<string, unknown>).subscription_cancelling ?? '');
    expect(copy.length).toBeGreaterThan(2);
    expect(copy.toLowerCase()).not.toMatch(/you cancel/);
  });
});
