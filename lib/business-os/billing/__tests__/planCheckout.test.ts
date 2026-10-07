/**
 * startPlanCheckout (plan payments P-3a, workplan §3.3 and §7; SA rulings
 * Q-1 to Q-12, conditions C-1 to C-4).
 *
 * Every port is a fake that records its call in ONE ordered log, so the tests
 * can say not only what was called but in which order: C-4 requires every
 * database read before any Stripe call, and no Stripe call at all on an early
 * refusal. Tier names come from the config (FR-12: none written here).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
const mockGetStripeService = jest.fn(() => {
  throw new Error('the shared StripeService must not be reached when one is injected');
});
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockGetStripeService() }));

import { readFileSync } from 'fs';
import { join } from 'path';

import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';
import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { BusinessOsStripeCustomerError } from '@/lib/business-os/billing/businessOsStripeCustomer';
import {
  LIVE_SUBSCRIPTION_STATUSES,
  PLAN_CHECKOUT_REFUSALS,
  PLAN_CHECKOUT_RETURN_PATHS,
  PLAN_CHECKOUT_SESSION_LIFETIME_SECONDS,
  planCheckoutReturnUrl,
  startPlanCheckout,
  type PlanCheckoutDeps,
  type PlanCheckoutInput,
  type PlanCheckoutResult,
} from '@/lib/business-os/billing/planCheckout';
import { displayMonthlyPricesUsd, displayPriceInCents, type StripePriceLike } from '@/lib/business-os/billing/planPriceCheck';
import type { BusinessOsBillingAccount } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type { BusinessOsAccountHoldFacts, BusinessOsInviteHoldFacts } from '@/lib/repositories/types';

const USER = '11111111-1111-4111-8111-111111111111';
const INVITE = '66666666-6666-4666-8666-666666666666';
const FRIEND_TIER = TIER_ORDER[0];
const HIGHER_TIER = TIER_ORDER[TIER_ORDER.length - 1];
const NOW = new Date('2026-10-07T10:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
/** Stripe's own expiry differs from the one we asked for, so tests can tell which one the lock stores (C-1). */
const STRIPE_EXPIRES = NOW_SECONDS + PLAN_CHECKOUT_SESSION_LIFETIME_SECONDS + 7;
const SECRET = 'cs_test_secret_never_logged';

function account(overrides: Partial<BusinessOsBillingAccount> = {}): BusinessOsBillingAccount {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_stored',
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    boughtTier: null,
    currentPeriodEnd: null,
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
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
    ...overrides,
  };
}

function priceFor(tier: (typeof TIER_ORDER)[number], overrides: Partial<StripePriceLike> = {}): StripePriceLike {
  return {
    id: `price_${PLAN_STRIPE_PRICES[tier].lookupKey}`,
    lookup_key: PLAN_STRIPE_PRICES[tier].lookupKey,
    active: true,
    currency: 'usd',
    unit_amount: displayPriceInCents(displayMonthlyPricesUsd()[tier]) as number,
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
    tax_behavior: 'exclusive',
    livemode: false,
    ...overrides,
  };
}

const missingCustomer = () => Object.assign(new Error('No such customer'), { type: 'StripeInvalidRequestError', code: 'resource_missing', param: 'customer' });

interface Options {
  pricesEnabled?: boolean;
  modeThrows?: boolean;
  lineage?: BusinessOsAccountHoldFacts | null | 'error';
  invite?: BusinessOsInviteHoldFacts | null;
  snapshot?: { unavailable: boolean; resolution: { anomaly?: string } | null } | 'throw';
  row?: BusinessOsBillingAccount | null | 'error';
  prices?: StripePriceLike[];
  subscriptions?: Array<{ complete: boolean; subscriptions: Array<{ id: string; status: string }> } | Error>;
  sessions?: Array<{ sessionId: string; clientSecret: string; expiresAt: number; livemode: boolean } | Error>;
  customerCreate?: Array<{ customerId: string; created: boolean; livemode: boolean | null } | Error>;
  recorded?: 'ok' | 'error';
  lock?: { acquired: boolean } | 'error';
  expireThrows?: boolean;
  replaceResult?: { replaced: boolean };
}

function harness(options: Options = {}) {
  const log: string[] = [];
  const attempts = ['attempt-1', 'attempt-2', 'attempt-3'];
  const subscriptions = [...(options.subscriptions ?? [{ complete: true, subscriptions: [] }])];
  const sessions = [...(options.sessions ?? [{ sessionId: 'cs_test_new', clientSecret: SECRET, expiresAt: STRIPE_EXPIRES, livemode: false }])];
  const customerCreate = [...(options.customerCreate ?? [{ customerId: 'cus_created', created: true, livemode: false }])];

  const repo = {
    findByUser: jest.fn(async () => {
      log.push('db:findByUser');
      if (options.row === 'error') return { data: null, error: new Error('down') };
      return { data: options.row ?? null, error: null };
    }),
    recordCustomer: jest.fn(async (input: { userId: string; livemode: boolean; stripeCustomerId: string }) => {
      log.push('db:recordCustomer');
      if (options.recorded === 'error') return { data: null, error: new Error('stripe_customer_held_by_another_account') };
      return { data: { account: account({ stripeCustomerId: input.stripeCustomerId }), created: true }, error: null };
    }),
    acquireCheckoutLock: jest.fn(async () => {
      log.push('db:acquireCheckoutLock');
      if (options.lock === 'error') return { data: null, error: new Error('down') };
      return { data: options.lock ?? { acquired: true }, error: null };
    }),
    replaceCustomer: jest.fn(async () => {
      log.push('db:replaceCustomer');
      return { data: options.replaceResult ?? { replaced: true }, error: null };
    }),
  };

  const stripe = {
    listPricesByLookupKeys: jest.fn(async () => {
      log.push('stripe:listPrices');
      return options.prices ?? TIER_ORDER.map((tier) => priceFor(tier));
    }),
    listCustomerSubscriptions: jest.fn(async (customerId: string) => {
      log.push(`stripe:listSubscriptions:${customerId}`);
      const next = subscriptions.length > 1 ? subscriptions.shift()! : subscriptions[0];
      if (next instanceof Error) throw next;
      return next;
    }),
    createBusinessOsPlanCheckoutSession: jest.fn(async (params: { customerId: string; idempotencyKey: string; expiresAt: number }) => {
      log.push(`stripe:createSession:${params.customerId}`);
      const next = sessions.length > 1 ? sessions.shift()! : sessions[0];
      if (next instanceof Error) throw next;
      return next;
    }),
    expireCheckoutSession: jest.fn(async (sessionId: string) => {
      log.push(`stripe:expire:${sessionId}`);
      if (options.expireThrows) throw new Error('already expired');
    }),
    findOrCreatePlatformCustomer: jest.fn(async () => {
      log.push('stripe:createCustomer');
      const next = customerCreate.length > 1 ? customerCreate.shift()! : customerCreate[0];
      if (next instanceof Error) throw next;
      return next;
    }),
  };

  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const deps: PlanCheckoutDeps = {
    holdReaders: {
      lineage: {
        findHoldFactsForAccount: jest.fn(async () => {
          log.push('db:lineage');
          return options.lineage === 'error' ? { data: null, error: new Error('down') } : { data: options.lineage ?? null, error: null };
        }),
      },
      invites: {
        findHoldFactsById: jest.fn(async () => {
          log.push('db:invite');
          return { data: options.invite ?? null, error: null };
        }),
      },
    } as unknown as PlanCheckoutDeps['holdReaders'],
    readPlanSnapshot: jest.fn(async () => {
      log.push('db:snapshot');
      if (options.snapshot === 'throw') throw new Error('snapshot down');
      return options.snapshot ?? { unavailable: false, resolution: {} };
    }),
    logger,
    repo: repo as unknown as PlanCheckoutDeps['repo'],
    stripe: stripe as unknown as PlanCheckoutDeps['stripe'],
    pricesEnabled: () => options.pricesEnabled ?? true,
    mode: () => {
      if (options.modeThrows) throw new Error('stripe_key_mode_unknown');
      return 'test';
    },
    now: () => NOW,
    attemptId: () => attempts.shift() ?? 'attempt-x',
    origin: () => 'https://app.example',
  };

  const stripeCalls = () => log.filter((entry) => entry.startsWith('stripe:'));
  return { deps, repo, stripe, logger, log, stripeCalls };
}

const INPUT: PlanCheckoutInput = {
  userId: USER,
  accountId: USER,
  email: 'owner@example.com',
  tier: FRIEND_TIER,
  returnTo: 'test_harness',
};

const friendLineage: BusinessOsAccountHoldFacts = { invite_id: INVITE, source: 'account_invite', first_paid_at: null };
const adminLineage: BusinessOsAccountHoldFacts = { invite_id: INVITE, source: 'admin_invite', first_paid_at: null };

function expectRefused(result: PlanCheckoutResult, code: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe(code);
  expect(JSON.stringify(result)).not.toContain(SECRET);
}

describe('startPlanCheckout — the happy path', () => {
  it('a new account: reads first, then price, customer, live check, session (now + 31 min), lock with STRIPE\'s expiry', async () => {
    const { deps, repo, stripe, log } = harness();
    const result = await startPlanCheckout(INPUT, deps);

    expect(result).toEqual({
      ok: true,
      sessionId: 'cs_test_new',
      clientSecret: SECRET,
      expiresAt: new Date(STRIPE_EXPIRES * 1000).toISOString(),
      tier: FRIEND_TIER,
      lookupKey: PLAN_STRIPE_PRICES[FRIEND_TIER].lookupKey,
      livemode: false,
      held: false,
    });

    // C-4: every database read precedes the first Stripe call.
    const firstStripe = log.findIndex((entry) => entry.startsWith('stripe:'));
    expect(log.slice(0, firstStripe)).toEqual(['db:lineage', 'db:snapshot', 'db:findByUser']);
    expect(log).toEqual([
      'db:lineage',
      'db:snapshot',
      'db:findByUser',
      'stripe:listPrices',
      'db:findByUser', // ensureBusinessOsStripeCustomer re-reads (P-2a contract)
      'stripe:createCustomer',
      'db:recordCustomer',
      'stripe:listSubscriptions:cus_created',
      'stripe:createSession:cus_created',
      'db:acquireCheckoutLock',
    ]);

    // C-1: asked for now + 31 minutes; the lock stores what Stripe returned.
    const sessionParams = stripe.createBusinessOsPlanCheckoutSession.mock.calls[0][0] as Record<string, unknown>;
    expect(PLAN_CHECKOUT_SESSION_LIFETIME_SECONDS).toBe(1860);
    expect(sessionParams).toEqual({
      customerId: 'cus_created',
      priceId: `price_${PLAN_STRIPE_PRICES[FRIEND_TIER].lookupKey}`,
      bosUserId: USER,
      returnUrl: 'https://app.example/test-business-os?checkout={CHECKOUT_SESSION_ID}',
      expiresAt: NOW_SECONDS + 1860,
      idempotencyKey: `bos-plan-checkout:${USER}:attempt-1`,
    });
    expect(repo.acquireCheckoutLock).toHaveBeenCalledWith({
      userId: USER,
      livemode: false,
      stripeCustomerId: 'cus_created',
      sessionId: 'cs_test_new',
      expiresAtIso: new Date(STRIPE_EXPIRES * 1000).toISOString(),
      nowIso: NOW.toISOString(),
    });

    // The customer is created with the session's email and the P-2a key.
    expect(((stripe.findOrCreatePlatformCustomer.mock.calls[0] as unknown[])[0] as { idempotencyKey: string }).idempotencyKey).toBe(`bos-customer:${USER}`);
  });

  it('an existing row: its customer is reused, no customer create', async () => {
    const { deps, stripe } = harness({ row: account() });
    const result = await startPlanCheckout(INPUT, deps);
    expect(result.ok).toBe(true);
    expect(stripe.findOrCreatePlatformCustomer).not.toHaveBeenCalled();
    expect(stripe.listCustomerSubscriptions).toHaveBeenCalledWith('cus_stored');
  });

  it('an EXPIRED lock does not block', async () => {
    const { deps } = harness({
      row: account({ openCheckoutSessionId: 'cs_test_old', openCheckoutExpiresAt: '2026-10-07T09:59:59.000Z' }),
    });
    expect((await startPlanCheckout(INPUT, deps)).ok).toBe(true);
  });

  it('a held friend may buy the friend tier (from the invite policy)', async () => {
    const { deps } = harness({ lineage: friendLineage });
    const result = await startPlanCheckout({ ...INPUT, tier: INVITE_ISSUANCE_POLICY.account.grantId as typeof FRIEND_TIER }, deps);
    expect(result).toMatchObject({ ok: true, held: true });
  });

  it.each([
    ['settings_plan', 'https://app.example/business-os/settings?section=plan&checkout={CHECKOUT_SESSION_ID}'],
    ['awaiting_payment', 'https://app.example/invite/awaiting-payment?checkout={CHECKOUT_SESSION_ID}'],
    ['test_harness', 'https://app.example/test-business-os?checkout={CHECKOUT_SESSION_ID}'],
  ] as const)('returnTo %s maps to a fixed server path (Q-7)', (surface, url) => {
    expect(planCheckoutReturnUrl(surface, 'https://app.example')).toBe(url);
    expect(Object.keys(PLAN_CHECKOUT_RETURN_PATHS).sort()).toEqual(['awaiting_payment', 'settings_plan', 'test_harness']);
  });
});

describe('startPlanCheckout — early refusals make NO Stripe call (C-4)', () => {
  const cases: Array<[string, Options, Partial<PlanCheckoutInput>, string]> = [
    ['price switch off (never sell what the webhook cannot recognise)', { pricesEnabled: false }, {}, 'checkout_unavailable'],
    ['Stripe key mode unknown', { modeThrows: true }, {}, 'checkout_unavailable'],
    ['hold unreadable (fail closed)', { lineage: 'error' }, {}, 'hold_unreadable'],
    ['held friend asking a higher tier', { lineage: friendLineage }, { tier: HIGHER_TIER }, 'held_tier_not_allowed'],
    ['held admin invitee (until P-9)', { lineage: adminLineage, invite: { grant_kind: 'tier', language: 'en' } }, {}, 'held_tier_unresolved'],
    ['plan snapshot unavailable', { snapshot: { unavailable: true, resolution: null } }, {}, 'plan_unreadable'],
    ['plan snapshot read throws', { snapshot: 'throw' }, {}, 'plan_unreadable'],
    ['no plan row (Q-4)', { snapshot: { unavailable: false, resolution: { anomaly: 'no_plan_row' } } }, {}, 'no_plan_row'],
    ['billing row unreadable', { row: 'error' }, {}, 'billing_row_unreadable'],
    ['live subscription on the record', { row: account({ subscriptionStatus: 'active', stripeSubscriptionId: 'sub_1' }) }, {}, 'subscription_live'],
    ['past_due subscription on the record', { row: account({ subscriptionStatus: 'past_due' }) }, {}, 'subscription_live'],
    [
      'an unexpired checkout lock',
      { row: account({ openCheckoutSessionId: 'cs_test_open', openCheckoutExpiresAt: '2026-10-07T10:20:00.000Z' }) },
      {},
      'checkout_open',
    ],
  ];

  it.each(cases)('%s → refused, no Stripe call', async (_label, options, input, code) => {
    const { deps, stripeCalls } = harness(options);
    const result = await startPlanCheckout({ ...INPUT, ...input }, deps);
    expectRefused(result, code);
    expect(stripeCalls()).toEqual([]);
    expect(mockGetStripeService).not.toHaveBeenCalled();
  });

  it('checkout_open carries the open lock\'s expiry', async () => {
    const { deps } = harness({ row: account({ openCheckoutSessionId: 'cs_test_open', openCheckoutExpiresAt: '2026-10-07T10:20:00.000Z' }) });
    expect(await startPlanCheckout(INPUT, deps)).toEqual({ ok: false, code: 'checkout_open', expiresAt: '2026-10-07T10:20:00.000Z' });
  });

  it('the price switch refusal is logged at error with an alert', async () => {
    const { deps, logger } = harness({ pricesEnabled: false });
    await startPlanCheckout(INPUT, deps);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'checkout_unavailable', reason: 'bos_billing_checkout_prices_switch_off', alert: true }),
      expect.any(String)
    );
  });

  it('a held friend refusal reads no plan row and no billing row', async () => {
    const { deps, log } = harness({ lineage: friendLineage });
    await startPlanCheckout({ ...INPUT, tier: HIGHER_TIER }, deps);
    expect(log).toEqual(['db:lineage']);
  });
});

describe('startPlanCheckout — price and customer refusals', () => {
  it('price mismatch → refused before any customer or session, alert', async () => {
    const { deps, stripe, logger } = harness({ prices: [priceFor(FRIEND_TIER, { unit_amount: 1 })] });
    expectRefused(await startPlanCheckout(INPUT, deps), 'price_mismatch');
    expect(stripe.findOrCreatePlatformCustomer).not.toHaveBeenCalled();
    expect(stripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ alert: true }), expect.any(String));
  });

  it('no price under the lookup key → price_unavailable', async () => {
    const { deps } = harness({ prices: [] });
    expectRefused(await startPlanCheckout(INPUT, deps), 'price_unavailable');
  });

  it('no email and no stored customer → email_required, no customer create', async () => {
    const { deps, stripe } = harness();
    expectRefused(await startPlanCheckout({ ...INPUT, email: null }, deps), 'email_required');
    expect(stripe.findOrCreatePlatformCustomer).not.toHaveBeenCalled();
  });

  it('billing_row_not_recorded → billing_record_conflict, alert, and NO second attempt (P-2a carry-forward)', async () => {
    const { deps, stripe, logger } = harness({ recorded: 'error' });
    expectRefused(await startPlanCheckout(INPUT, deps), 'billing_record_conflict');
    expect(stripe.findOrCreatePlatformCustomer).toHaveBeenCalledTimes(1);
    expect(stripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'billing_record_conflict', alert: true }),
      expect.any(String)
    );
  });

  it('a mode disagreement on the new customer → checkout_unavailable', async () => {
    const { deps } = harness({ customerCreate: [{ customerId: 'cus_live', created: true, livemode: true }] });
    expectRefused(await startPlanCheckout(INPUT, deps), 'checkout_unavailable');
  });

  it('an idempotency error on the customer → retry_later', async () => {
    const { deps } = harness({ customerCreate: [Object.assign(new Error('Keys for idempotent requests'), { type: 'StripeIdempotencyError' })] });
    expectRefused(await startPlanCheckout(INPUT, deps), 'retry_later');
  });

  it('the error code mapping is complete and never leaks a provider message', () => {
    for (const [code, refusal] of Object.entries(PLAN_CHECKOUT_REFUSALS)) {
      expect(refusal.status).toBeGreaterThanOrEqual(400);
      expect(refusal.message).not.toMatch(/stripe|supabase|postgres|sql/i);
      expect(code).toMatch(/^[a-z_]+$/);
    }
    expect(new BusinessOsStripeCustomerError('invalid_input').reason).toBe('invalid_input');
  });
});

describe('startPlanCheckout — layer 1b, the Stripe-side live subscription (Q-5, C-2)', () => {
  it.each(LIVE_SUBSCRIPTION_STATUSES.map((status) => [status]))('a %s subscription at Stripe → subscription_live, no session', async (status) => {
    const { deps, stripe } = harness({
      row: account(),
      subscriptions: [{ complete: true, subscriptions: [{ id: 'sub_old', status: 'canceled' }, { id: 'sub_live', status }] }],
    });
    expectRefused(await startPlanCheckout(INPUT, deps), 'subscription_live');
    expect(stripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
  });

  it('only cancelled / expired subscriptions → proceeds', async () => {
    const { deps } = harness({
      row: account(),
      subscriptions: [{ complete: true, subscriptions: [{ id: 's1', status: 'canceled' }, { id: 's2', status: 'incomplete_expired' }] }],
    });
    expect((await startPlanCheckout(INPUT, deps)).ok).toBe(true);
  });

  it('a partial listing with no live one found → subscription_check_incomplete (fail closed), no session', async () => {
    const { deps, stripe } = harness({ row: account(), subscriptions: [{ complete: false, subscriptions: [{ id: 's1', status: 'canceled' }] }] });
    expectRefused(await startPlanCheckout(INPUT, deps), 'subscription_check_incomplete');
    expect(stripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
  });
});

describe('startPlanCheckout — customer replacement, one replacement and one retry (C-3)', () => {
  it('resource_missing from the LIVE-SUBSCRIPTION LIST → replaced once, retried on the new customer', async () => {
    const { deps, stripe, repo, log } = harness({
      row: account({ stripeCustomerId: 'cus_deleted' }),
      subscriptions: [missingCustomer(), { complete: true, subscriptions: [] }],
      customerCreate: [{ customerId: 'cus_replacement', created: true, livemode: false }],
    });
    const result = await startPlanCheckout(INPUT, deps);
    expect(result.ok).toBe(true);
    expect(stripe.findOrCreatePlatformCustomer).toHaveBeenCalledTimes(1);
    expect(((stripe.findOrCreatePlatformCustomer.mock.calls[0] as unknown[])[0] as { idempotencyKey: string }).idempotencyKey).toBe(
      `bos-customer:${USER}:replaces:cus_deleted`
    );
    expect(repo.replaceCustomer).toHaveBeenCalledTimes(1);
    expect(log).toContain('stripe:listSubscriptions:cus_replacement');
    expect(log).toContain('stripe:createSession:cus_replacement');
    expect(((repo.acquireCheckoutLock.mock.calls[0] as unknown[])[0] as { stripeCustomerId: string }).stripeCustomerId).toBe('cus_replacement');
  });

  it('resource_missing from the SESSION CREATE → replaced once, retried with a NEW idempotency key', async () => {
    const { deps, stripe, repo } = harness({
      row: account({ stripeCustomerId: 'cus_deleted' }),
      sessions: [missingCustomer(), { sessionId: 'cs_test_new', clientSecret: SECRET, expiresAt: STRIPE_EXPIRES, livemode: false }],
      customerCreate: [{ customerId: 'cus_replacement', created: true, livemode: false }],
    });
    expect((await startPlanCheckout(INPUT, deps)).ok).toBe(true);
    const calls = stripe.createBusinessOsPlanCheckoutSession.mock.calls.map((call) => call[0] as { customerId: string; idempotencyKey: string });
    expect(calls.map((call) => call.customerId)).toEqual(['cus_deleted', 'cus_replacement']);
    expect(calls[0].idempotencyKey).not.toBe(calls[1].idempotencyKey);
    expect(repo.replaceCustomer).toHaveBeenCalledTimes(1);
  });

  it('a SECOND resource_missing → stripe_error; never a second replacement or a third attempt', async () => {
    const { deps, stripe, repo } = harness({
      row: account({ stripeCustomerId: 'cus_deleted' }),
      sessions: [missingCustomer(), missingCustomer()],
      customerCreate: [{ customerId: 'cus_replacement', created: true, livemode: false }],
    });
    expectRefused(await startPlanCheckout(INPUT, deps), 'stripe_error');
    expect(stripe.createBusinessOsPlanCheckoutSession).toHaveBeenCalledTimes(2);
    expect(stripe.findOrCreatePlatformCustomer).toHaveBeenCalledTimes(1);
    expect(repo.replaceCustomer).toHaveBeenCalledTimes(1);
  });

  it('a lost replacement race uses the STORED replacement', async () => {
    const { deps, repo, log } = harness({
      row: account({ stripeCustomerId: 'cus_deleted' }),
      subscriptions: [missingCustomer(), { complete: true, subscriptions: [] }],
      customerCreate: [{ customerId: 'cus_mine', created: true, livemode: false }],
      replaceResult: { replaced: false },
    });
    // The re-read after the lost race returns the winner's customer.
    repo.findByUser
      .mockImplementationOnce(async () => {
        log.push('db:findByUser');
        return { data: account({ stripeCustomerId: 'cus_deleted' }), error: null };
      })
      .mockImplementationOnce(async () => {
        log.push('db:findByUser');
        return { data: account({ stripeCustomerId: 'cus_winner' }), error: null };
      });
    expect((await startPlanCheckout(INPUT, deps)).ok).toBe(true);
    expect(log).toContain('stripe:createSession:cus_winner');
  });

  it('another Stripe error on the session → stripe_error, no replacement', async () => {
    const { deps, repo } = harness({ row: account(), sessions: [Object.assign(new Error('rate limited'), { type: 'StripeRateLimitError' })] });
    expectRefused(await startPlanCheckout(INPUT, deps), 'stripe_error');
    expect(repo.replaceCustomer).not.toHaveBeenCalled();
  });

  it('a missing customer with no session email → email_required, nothing replaced', async () => {
    const { deps, repo } = harness({ row: account({ stripeCustomerId: 'cus_deleted' }), subscriptions: [missingCustomer()] });
    expectRefused(await startPlanCheckout({ ...INPUT, email: null }, deps), 'email_required');
    expect(repo.replaceCustomer).not.toHaveBeenCalled();
  });
});

describe('startPlanCheckout — the lock race (SA Q-2)', () => {
  it('lock lost → the new session is expired at Stripe, checkout_busy, its client secret never returned', async () => {
    const { deps, stripe, logger } = harness({ row: account(), lock: { acquired: false } });
    const result = await startPlanCheckout(INPUT, deps);
    expectRefused(result, 'checkout_busy');
    expect(stripe.expireCheckoutSession).toHaveBeenCalledWith('cs_test_new');
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'bos_billing_checkout_lock_lost' }), expect.any(String));
  });

  it('two concurrent clicks: one wins, the loser is expired and refused', async () => {
    let lockHeld = false;
    const first = harness({ row: account() });
    const second = harness({ row: account(), sessions: [{ sessionId: 'cs_test_two', clientSecret: 'other_secret', expiresAt: STRIPE_EXPIRES, livemode: false }] });
    const cas = async () => {
      if (lockHeld) return { data: { acquired: false }, error: null };
      lockHeld = true;
      return { data: { acquired: true }, error: null };
    };
    first.repo.acquireCheckoutLock.mockImplementation(cas);
    second.repo.acquireCheckoutLock.mockImplementation(cas);
    const [a, b] = await Promise.all([startPlanCheckout(INPUT, first.deps), startPlanCheckout(INPUT, second.deps)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const loser = a.ok ? second : first;
    expect(loser.stripe.expireCheckoutSession).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(a.ok ? b : a)).not.toContain('secret');
  });

  it('an expire failure on the loser → still checkout_busy, logged at warn', async () => {
    const { deps, logger } = harness({ row: account(), lock: { acquired: false }, expireThrows: true });
    expectRefused(await startPlanCheckout(INPUT, deps), 'checkout_busy');
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: 'lock_lost' }), expect.any(String));
  });

  it('a lock that cannot be written → the session is expired and refused (never returned without a lock)', async () => {
    const { deps, stripe } = harness({ row: account(), lock: 'error' });
    expectRefused(await startPlanCheckout(INPUT, deps), 'lock_unavailable');
    expect(stripe.expireCheckoutSession).toHaveBeenCalledWith('cs_test_new');
  });

  it('a session in the wrong mode → expired and refused', async () => {
    const { deps, stripe } = harness({ row: account(), sessions: [{ sessionId: 'cs_live_x', clientSecret: SECRET, expiresAt: STRIPE_EXPIRES, livemode: true }] });
    expectRefused(await startPlanCheckout(INPUT, deps), 'checkout_unavailable');
    expect(stripe.expireCheckoutSession).toHaveBeenCalledWith('cs_live_x');
  });
});

describe('logging', () => {
  it('never logs the client secret or the email', async () => {
    const { deps, logger } = harness({ lock: { acquired: false } });
    await startPlanCheckout(INPUT, deps);
    const happy = harness();
    await startPlanCheckout(INPUT, happy.deps);
    const lines = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
      ...happy.logger.info.mock.calls,
      ...happy.logger.warn.mock.calls,
      ...happy.logger.error.mock.calls,
    ]);
    expect(lines).not.toContain(SECRET);
    expect(lines).not.toContain('owner@example.com');
    expect(happy.logger.info).toHaveBeenCalledWith(expect.objectContaining({ event: 'bos_billing_checkout_started' }), expect.any(String));
  });
});

describe('source guards (CF-4, C-3, FR-12, tenant isolation)', () => {
  const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const FILES = [
    'lib/business-os/billing/planCheckout.ts',
    'lib/business-os/billing/planCheckoutPrice.ts',
    'lib/business-os/billing/planCheckoutEligibility.ts',
    'lib/business-os/billing/planCheckoutFlag.ts',
    'lib/business-os/billing/businessOsStripeCustomer.ts',
    'app/api/business-os/billing/plan/checkout/route.ts',
    'components/test-business-os/PlanCheckoutPanel.tsx',
  ];

  it.each(FILES)('%s writes no legacy Pilot-Credit metadata key and no tier name', (file) => {
    const text = code(read(file));
    expect(text).not.toMatch(/['"`](user_id|credits|pilot_credits)['"`]/);
    expect(text).not.toMatch(/\buser_id\s*:/);
    for (const tier of TIER_ORDER) expect(text).not.toMatch(new RegExp(`['"\`]${tier}['"\`]`));
  });

  it('the orchestration never takes an account, customer or price from its caller beyond the session facts', () => {
    const text = code(read('lib/business-os/billing/planCheckout.ts'));
    const inputBlock = text.slice(text.indexOf('export interface PlanCheckoutInput'), text.indexOf('}', text.indexOf('export interface PlanCheckoutInput')));
    expect(inputBlock).not.toMatch(/customerId|priceId|amount|currency/);
  });
});
