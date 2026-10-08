/**
 * QA gap tests for startPlanCheckout (plan payments P-3a, QA pass 2026-10-07).
 *
 * Adds the cases the Dev suite (`planCheckout.test.ts`) does not pin:
 * every live status on the RECORD (incl. `paused`), the lock-expiry boundary,
 * a not-held owner buying either tier, the hold failing closed when a reader
 * throws or an admin invite cannot be read, a paid friend no longer held, a
 * partial Stripe listing that already shows a live subscription, and a failed
 * customer replacement mapping to `billing_record_conflict` with no session.
 * Tier names come from the config (FR-12: none written here).
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
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the shared StripeService must not be reached when one is injected');
  },
}));

import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_ORDER, type TierId } from '@/lib/business-os/entitlements/config/tierMatrix';
import {
  LIVE_SUBSCRIPTION_STATUSES,
  PLAN_CHECKOUT_REFUSALS,
  PLAN_CHECKOUT_SESSION_LIFETIME_SECONDS,
  startPlanCheckout,
  type PlanCheckoutDeps,
  type PlanCheckoutInput,
  type PlanCheckoutResult,
} from '@/lib/business-os/billing/planCheckout';
import { displayMonthlyPricesUsd, displayPriceInCents, type StripePriceLike } from '@/lib/business-os/billing/planPriceCheck';
import type { BusinessOsAccountHoldFacts } from '@/lib/repositories/types';
// The row type comes through the service's port, so this file does not name the
// repository (its source guard holds the exact list of files that may).
type BusinessOsBillingAccount = NonNullable<Awaited<ReturnType<NonNullable<PlanCheckoutDeps['repo']>['findByUser']>>['data']>;
type BusinessOsSubscriptionStatus = NonNullable<BusinessOsBillingAccount['subscriptionStatus']>;

const USER = '11111111-1111-4111-8111-111111111111';
const INVITE = '66666666-6666-4666-8666-666666666666';
const FRIEND_TIER = TIER_ORDER[0];
const HIGHER_TIER = TIER_ORDER[TIER_ORDER.length - 1];
const NOW = new Date('2026-10-07T10:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const SECRET = 'cs_test_qa_secret_never_logged';

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

function priceFor(tier: TierId): StripePriceLike {
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
  };
}

const missingCustomer = () => Object.assign(new Error('No such customer'), { code: 'resource_missing', param: 'customer' });

interface Options {
  lineage?: BusinessOsAccountHoldFacts | null;
  lineageThrows?: boolean;
  inviteError?: boolean;
  row?: BusinessOsBillingAccount | null;
  subscriptions?: Array<{ complete: boolean; subscriptions: Array<{ id: string; status: string }> } | Error>;
  sessions?: Array<{ sessionId: string; clientSecret: string; expiresAt: number; livemode: boolean } | Error>;
  replaceError?: boolean;
}

function harness(options: Options = {}) {
  const log: string[] = [];
  const subscriptions = [...(options.subscriptions ?? [{ complete: true, subscriptions: [] }])];
  const sessions = [
    ...(options.sessions ?? [{ sessionId: 'cs_test_qa', clientSecret: SECRET, expiresAt: NOW_SECONDS + PLAN_CHECKOUT_SESSION_LIFETIME_SECONDS, livemode: false }]),
  ];
  const repo = {
    findByUser: jest.fn(async () => {
      log.push('db:findByUser');
      return { data: options.row ?? null, error: null };
    }),
    recordCustomer: jest.fn(async (input: { stripeCustomerId: string }) => {
      log.push('db:recordCustomer');
      return { data: { account: account({ stripeCustomerId: input.stripeCustomerId }), created: true }, error: null };
    }),
    acquireCheckoutLock: jest.fn(async () => {
      log.push('db:acquireCheckoutLock');
      return { data: { acquired: true }, error: null };
    }),
    replaceCustomer: jest.fn(async () => {
      log.push('db:replaceCustomer');
      return options.replaceError ? { data: null, error: new Error('stripe_customer_held_by_another_account') } : { data: { replaced: true }, error: null };
    }),
  };
  const stripe = {
    listPricesByLookupKeys: jest.fn(async () => {
      log.push('stripe:listPrices');
      return TIER_ORDER.map((tier) => priceFor(tier));
    }),
    listCustomerSubscriptions: jest.fn(async (customerId: string) => {
      log.push(`stripe:listSubscriptions:${customerId}`);
      const next = subscriptions.length > 1 ? subscriptions.shift()! : subscriptions[0];
      if (next instanceof Error) throw next;
      return next;
    }),
    createBusinessOsPlanCheckoutSession: jest.fn(async (params: { customerId: string; priceId: string }) => {
      log.push(`stripe:createSession:${params.customerId}`);
      const next = sessions.length > 1 ? sessions.shift()! : sessions[0];
      if (next instanceof Error) throw next;
      return next;
    }),
    expireCheckoutSession: jest.fn(async (sessionId: string) => {
      log.push(`stripe:expire:${sessionId}`);
    }),
    findOrCreatePlatformCustomer: jest.fn(async () => {
      log.push('stripe:createCustomer');
      return { customerId: 'cus_created', created: true, livemode: false };
    }),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const deps: PlanCheckoutDeps = {
    holdReaders: {
      lineage: {
        findHoldFactsForAccount: jest.fn(async () => {
          log.push('db:lineage');
          if (options.lineageThrows) throw new Error('lineage exploded');
          return { data: options.lineage ?? null, error: null };
        }),
      },
      invites: {
        findHoldFactsById: jest.fn(async () => {
          log.push('db:invite');
          return options.inviteError ? { data: null, error: new Error('down') } : { data: { grant_kind: 'tier', language: 'en' }, error: null };
        }),
      },
    } as unknown as PlanCheckoutDeps['holdReaders'],
    readPlanSnapshot: jest.fn(async () => {
      log.push('db:snapshot');
      return { unavailable: false, resolution: {} };
    }),
    logger,
    repo: repo as unknown as PlanCheckoutDeps['repo'],
    stripe: stripe as unknown as PlanCheckoutDeps['stripe'],
    pricesEnabled: () => true,
    mode: () => 'test',
    now: () => NOW,
    attemptId: () => 'qa-attempt',
    origin: () => 'https://app.example',
  };
  const stripeCalls = () => log.filter((entry) => entry.startsWith('stripe:'));
  return { deps, repo, stripe, logger, log, stripeCalls };
}

const INPUT: PlanCheckoutInput = { userId: USER, accountId: USER, email: 'owner@example.com', tier: FRIEND_TIER, returnTo: 'test_harness' };

function expectRefused(result: PlanCheckoutResult, code: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe(code);
  expect(JSON.stringify(result)).not.toContain(SECRET);
}

describe('QA — tier choice', () => {
  it.each(TIER_ORDER.map((tier) => [tier]))('a not-held owner may buy %s, at that tier\'s lookup-key price', async (tier) => {
    const { deps, stripe } = harness();
    const result = await startPlanCheckout({ ...INPUT, tier: tier as TierId }, deps);
    expect(result).toMatchObject({ ok: true, held: false, tier, lookupKey: PLAN_STRIPE_PRICES[tier as TierId].lookupKey });
    const params = stripe.createBusinessOsPlanCheckoutSession.mock.calls[0][0] as { priceId: string };
    expect(params.priceId).toBe(`price_${PLAN_STRIPE_PRICES[tier as TierId].lookupKey}`);
  });

  it('a friend who has already paid (first_paid_at set) is no longer held and may pick the higher tier', async () => {
    const { deps } = harness({ lineage: { invite_id: INVITE, source: 'account_invite', first_paid_at: '2026-10-01T00:00:00.000Z' } });
    expect(await startPlanCheckout({ ...INPUT, tier: HIGHER_TIER }, deps)).toMatchObject({ ok: true, held: false });
  });
});

describe('QA — the hold fails CLOSED', () => {
  it('a hold reader that THROWS → hold_unreadable, no Stripe call, no plan or billing read', async () => {
    const { deps, log, stripeCalls } = harness({ lineageThrows: true });
    expectRefused(await startPlanCheckout(INPUT, deps), 'hold_unreadable');
    expect(stripeCalls()).toEqual([]);
    expect(log).toEqual(['db:lineage']);
  });

  it('a held admin invitee whose invite cannot be read → hold_unreadable, no Stripe call', async () => {
    const { deps, stripeCalls } = harness({ lineage: { invite_id: INVITE, source: 'admin_invite', first_paid_at: null }, inviteError: true });
    expectRefused(await startPlanCheckout(INPUT, deps), 'hold_unreadable');
    expect(stripeCalls()).toEqual([]);
  });

  it.each(TIER_ORDER.map((tier) => [tier]))('a held admin invitee is refused for %s too (until P-9)', async (tier) => {
    const { deps, stripeCalls } = harness({ lineage: { invite_id: INVITE, source: 'admin_invite', first_paid_at: null } });
    expectRefused(await startPlanCheckout({ ...INPUT, tier: tier as TierId }, deps), 'held_tier_unresolved');
    expect(stripeCalls()).toEqual([]);
  });
});

describe('QA — layer 1 from the record', () => {
  it.each(LIVE_SUBSCRIPTION_STATUSES.map((status) => [status]))('a %s subscription on the RECORD → subscription_live, no Stripe call', async (status) => {
    const { deps, stripeCalls } = harness({ row: account({ subscriptionStatus: status as BusinessOsSubscriptionStatus }) });
    expectRefused(await startPlanCheckout(INPUT, deps), 'subscription_live');
    expect(stripeCalls()).toEqual([]);
  });

  it('a lock expiring EXACTLY now is free (boundary matches the CAS `lte`)', async () => {
    const { deps } = harness({ row: account({ openCheckoutSessionId: 'cs_test_old', openCheckoutExpiresAt: NOW.toISOString() }) });
    expect((await startPlanCheckout(INPUT, deps)).ok).toBe(true);
  });

  it('a lock expiring 1 ms from now → checkout_open, no Stripe call', async () => {
    const expires = new Date(NOW.getTime() + 1).toISOString();
    const { deps, stripeCalls } = harness({ row: account({ openCheckoutSessionId: 'cs_test_open', openCheckoutExpiresAt: expires }) });
    expect(await startPlanCheckout(INPUT, deps)).toEqual({ ok: false, code: 'checkout_open', expiresAt: expires });
    expect(stripeCalls()).toEqual([]);
  });
});

describe('QA — layer 1b at Stripe', () => {
  it('an expired lock but a paused subscription at Stripe → subscription_live, no session', async () => {
    const { deps, stripe } = harness({
      row: account({ openCheckoutSessionId: 'cs_test_old', openCheckoutExpiresAt: '2026-10-07T09:00:00.000Z' }),
      subscriptions: [{ complete: true, subscriptions: [{ id: 'sub_paused', status: 'paused' }] }],
    });
    expectRefused(await startPlanCheckout(INPUT, deps), 'subscription_live');
    expect(stripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
  });

  it('a partial listing that already shows a live subscription → subscription_live (still refused)', async () => {
    const { deps, stripe } = harness({ row: account(), subscriptions: [{ complete: false, subscriptions: [{ id: 'sub_live', status: 'active' }] }] });
    expectRefused(await startPlanCheckout(INPUT, deps), 'subscription_live');
    expect(stripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
  });

  it('a partial listing after a replacement → subscription_check_incomplete, no session', async () => {
    const { deps, stripe } = harness({
      row: account({ stripeCustomerId: 'cus_deleted' }),
      subscriptions: [missingCustomer(), { complete: false, subscriptions: [] }],
    });
    expectRefused(await startPlanCheckout(INPUT, deps), 'subscription_check_incomplete');
    expect(stripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
  });
});

describe('QA — customer replacement', () => {
  it('missing at the LIST and again at the SESSION CREATE → one replacement only, stripe_error', async () => {
    const { deps, repo, stripe } = harness({
      row: account({ stripeCustomerId: 'cus_deleted' }),
      subscriptions: [missingCustomer(), { complete: true, subscriptions: [] }],
      sessions: [missingCustomer()],
    });
    expectRefused(await startPlanCheckout(INPUT, deps), 'stripe_error');
    expect(repo.replaceCustomer).toHaveBeenCalledTimes(1);
    expect(stripe.findOrCreatePlatformCustomer).toHaveBeenCalledTimes(1);
    expect(repo.acquireCheckoutLock).not.toHaveBeenCalled();
  });

  it('the replacement cannot be recorded → billing_record_conflict (alert), no session, no retry', async () => {
    const { deps, stripe, logger } = harness({
      row: account({ stripeCustomerId: 'cus_deleted' }),
      subscriptions: [missingCustomer()],
      replaceError: true,
    });
    expectRefused(await startPlanCheckout(INPUT, deps), 'billing_record_conflict');
    expect(stripe.findOrCreatePlatformCustomer).toHaveBeenCalledTimes(1);
    expect(stripe.listCustomerSubscriptions).toHaveBeenCalledTimes(1);
    expect(stripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'billing_record_conflict', alert: true }), expect.any(String));
  });
});

describe('QA — the route status for the money-path refusals (the route maps this table verbatim)', () => {
  it.each([
    ['billing_record_conflict', 500],
    ['subscription_check_incomplete', 503],
    ['plan_unreadable', 503],
    ['hold_unreadable', 503],
    ['no_plan_row', 409],
    ['held_tier_not_allowed', 409],
    ['held_tier_unresolved', 409],
    ['subscription_live', 409],
    ['checkout_open', 409],
    ['checkout_busy', 409],
    ['lock_unavailable', 503],
    ['price_mismatch', 503],
  ] as const)('%s → %d', (code, status) => {
    expect(PLAN_CHECKOUT_REFUSALS[code].status).toBe(status);
  });
});
