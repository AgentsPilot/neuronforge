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

import { COHORTS } from '@/lib/business-os/entitlements/config/cohorts';
import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';
import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_MATRIX, TIER_ORDER, type TierId } from '@/lib/business-os/entitlements/config/tierMatrix';
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
  type PlanSnapshotLike,
} from '@/lib/business-os/billing/planCheckout';
import { displayMonthlyPricesUsd, displayPriceInCents, type StripePriceLike } from '@/lib/business-os/billing/planPriceCheck';
import type { HeldPaymentSwitches } from '@/lib/business-os/billing/planCheckoutEligibility';
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
const HELD_SWITCHES_ON: HeldPaymentSwitches = { checkoutEnabled: true, pricesEnabled: true, paidInvitesAvailable: true };

/** P-4.1: a resolution with a tier basis (not caught by BQ-P10). The default. */
const TIER_RESOLUTION: NonNullable<PlanSnapshotLike['resolution']> = {
  basis: { kind: 'tier', tier: FRIEND_TIER },
  lifecycle: { accessEndsAt: null },
};

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
  /** P-5a.2: the held-payment switches; default all on, so the held rules decide. */
  heldSwitches?: HeldPaymentSwitches;
  modeThrows?: boolean;
  lineage?: BusinessOsAccountHoldFacts | null | 'error';
  invite?: BusinessOsInviteHoldFacts | null;
  snapshot?: PlanSnapshotLike | 'throw';
  row?: BusinessOsBillingAccount | null | 'error';
  /**
   * P-4.1 M-1: the tiers on sale to a non-held account. Default every priced
   * tier, so the P-3a rows below test what they always tested; `'config'`
   * leaves the dep out, so the production `buyableTiers()` decides.
   */
  buyable?: readonly TierId[] | 'config';
  /** P-4.1 M-3: what Stripe says about the account's own open session. */
  openSession?: { status: 'open' | 'complete' | 'expired' | null; customerId: string | null; livemode: boolean } | Error;
  /** P-4.1 M-3: the compare-and-set release of that session's lock. */
  release?: { released: boolean } | 'error';
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
    releaseCheckoutLock: jest.fn(async (input: { sessionId: string }) => {
      log.push(`db:releaseLock:${input.sessionId}`);
      if (options.release === 'error') return { data: null, error: new Error('down') };
      return { data: options.release ?? { released: true }, error: null };
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
    retrieveCheckoutSessionState: jest.fn(async (sessionId: string) => {
      log.push(`stripe:retrieve:${sessionId}`);
      const state = options.openSession ?? { status: 'open', customerId: 'cus_stored', livemode: false };
      if (state instanceof Error) throw state;
      return state;
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
      return options.snapshot ?? { unavailable: false, resolution: TIER_RESOLUTION };
    }),
    logger,
    repo: repo as unknown as PlanCheckoutDeps['repo'],
    stripe: stripe as unknown as PlanCheckoutDeps['stripe'],
    pricesEnabled: () => options.pricesEnabled ?? true,
    heldPaymentSwitches: () => options.heldSwitches ?? HELD_SWITCHES_ON,
    ...(options.buyable === 'config' ? {} : { buyableTiers: () => (options.buyable as readonly TierId[] | undefined) ?? TIER_ORDER }),
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
    ['no plan row (Q-4)', { snapshot: { unavailable: false, resolution: { ...TIER_RESOLUTION, anomaly: 'no_plan_row' } } }, {}, 'no_plan_row'],
    ['billing row unreadable', { row: 'error' }, {}, 'billing_row_unreadable'],
    ['live subscription on the record', { row: account({ subscriptionStatus: 'active', stripeSubscriptionId: 'sub_1' }) }, {}, 'subscription_live'],
    ['past_due subscription on the record', { row: account({ subscriptionStatus: 'past_due' }) }, {}, 'subscription_live'],
    // P-4.1: an unexpired lock is no longer an early refusal; M-3 replaces it
    // (its own describe block below). These two are the new early refusals.
    ['P-4.1 M-1: a priced tier with availableToBuy off', { buyable: [] }, {}, 'price_unavailable'],
    [
      'P-4.1 BQ-P10: free access with no end date',
      { snapshot: { unavailable: false, resolution: { basis: { kind: 'cohort', cohort: 'x' }, lifecycle: { accessEndsAt: null } } } },
      {},
      'free_access_no_end_date',
    ],
  ];

  it.each(cases)('%s → refused, no Stripe call', async (_label, options, input, code) => {
    const { deps, stripeCalls } = harness(options);
    const result = await startPlanCheckout({ ...INPUT, ...input }, deps);
    expectRefused(result, code);
    expect(stripeCalls()).toEqual([]);
    expect(mockGetStripeService).not.toHaveBeenCalled();
  });

  // Rewritten on purpose for P-4.1 M-3: `checkout_open` now only means the
  // account's own open session could not be read, expired or released.
  it('checkout_open (open session unreadable) carries the open lock\'s expiry', async () => {
    const { deps } = harness({
      row: account({ openCheckoutSessionId: 'cs_test_open', openCheckoutExpiresAt: '2026-10-07T10:20:00.000Z' }),
      openSession: new Error('stripe down'),
    });
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

  // P-5a.2 (S5-1, D5-3, G5-5): the held path needs `paidInvitesAvailable` too.
  it('held + paidInvitesAvailable off → held_payment_unavailable (409), warn with no alert, no Stripe call, nothing read after the hold', async () => {
    const { deps, log, logger, stripeCalls } = harness({
      lineage: friendLineage,
      heldSwitches: { checkoutEnabled: true, pricesEnabled: true, paidInvitesAvailable: false },
    });
    const result = await startPlanCheckout({ ...INPUT, tier: INVITE_ISSUANCE_POLICY.account.grantId as typeof FRIEND_TIER }, deps);
    expectRefused(result, 'held_payment_unavailable');
    expect(PLAN_CHECKOUT_REFUSALS.held_payment_unavailable.status).toBe(409);
    expect(log).toEqual(['db:lineage']);
    expect(stripeCalls()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'bos_billing_checkout_refused', code: 'held_payment_unavailable' }),
      expect.any(String)
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('"alert":true');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('held admin invitee + a switch off → held_payment_unavailable (the switches come first)', async () => {
    const { deps } = harness({
      lineage: adminLineage,
      invite: { grant_kind: 'tier', language: 'en' },
      heldSwitches: { checkoutEnabled: true, pricesEnabled: true, paidInvitesAvailable: false },
    });
    expectRefused(await startPlanCheckout(INPUT, deps), 'held_payment_unavailable');
  });

  // Rewritten on purpose for P-4.1 (M-1, SA W-1): a non-held account now goes
  // through `planPurchaseOffer`, which reads the checkout and price switches
  // (as the Settings view will). `paidInvitesAvailable` still governs held only.
  it('NOT held is unaffected by paidInvitesAvailable', async () => {
    const { deps } = harness({ heldSwitches: { checkoutEnabled: true, pricesEnabled: true, paidInvitesAvailable: false } });
    expect(await startPlanCheckout({ ...INPUT, tier: HIGHER_TIER }, deps)).toMatchObject({ ok: true, held: false });
  });

  it.each([['checkoutEnabled'], ['pricesEnabled']] as const)('NOT held with %s off → checkout_unavailable, no Stripe call', async (off) => {
    const { deps, stripeCalls } = harness({ heldSwitches: { ...HELD_SWITCHES_ON, [off]: false } });
    expectRefused(await startPlanCheckout({ ...INPUT, tier: HIGHER_TIER }, deps), 'checkout_unavailable');
    expect(stripeCalls()).toEqual([]);
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

// ── P-4.1: checkout hardening (M-1, BQ-P10, M-3; SA W-1 to W-4) ──────────

const OPEN_LOCK = { openCheckoutSessionId: 'cs_test_open', openCheckoutExpiresAt: '2026-10-07T10:20:00.000Z' };
const cohortResolution = (accessEndsAt: string | null): PlanSnapshotLike => ({
  unavailable: false,
  resolution: { basis: { kind: 'cohort', cohort: 'any_admin_dated' }, lifecycle: { accessEndsAt } },
});

describe('startPlanCheckout — M-1: availableToBuy is enforced on the server', () => {
  it('a direct POST for a priced tier that is not on sale → price_unavailable / tier_not_sold, no Stripe call', async () => {
    const { deps, logger, stripeCalls } = harness({ buyable: [FRIEND_TIER] });
    expectRefused(await startPlanCheckout({ ...INPUT, tier: HIGHER_TIER }, deps), 'price_unavailable');
    expect(stripeCalls()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'price_unavailable', reason: 'tier_not_sold' }), expect.any(String));
  });

  it('a tier on sale proceeds', async () => {
    const { deps } = harness({ buyable: [FRIEND_TIER] });
    expect(await startPlanCheckout(INPUT, deps)).toMatchObject({ ok: true, tier: FRIEND_TIER });
  });

  // The production config marks every tier availableToBuy (user decision,
  // 2026-10-13, for testing — requirement §9.5 re-checks it at go-live). These
  // two tests leave the dep out, so the REAL `buyableTiers()` reads the real
  // TIER_MATRIX: the config sells what it says, and the flag is what refuses.
  it('the PRODUCTION config (availableToBuy on for every tier since 2026-10-13) sells every tier to a non-held account', async () => {
    for (const tier of TIER_ORDER) {
      const { deps } = harness({ buyable: 'config' });
      expect(await startPlanCheckout({ ...INPUT, tier }, deps)).toMatchObject({ ok: true, tier });
    }
  });

  it.each(TIER_ORDER.map((tier) => [tier]))(
    'the PRODUCTION config with availableToBuy turned OFF for %s refuses exactly that tier, with no Stripe call',
    async (off) => {
      const presentation = TIER_MATRIX.presentation as Record<string, { availableToBuy: boolean }>;
      const saved = presentation[off].availableToBuy;
      presentation[off].availableToBuy = false;
      try {
        const refused = harness({ buyable: 'config' });
        expectRefused(await startPlanCheckout({ ...INPUT, tier: off }, refused.deps), 'price_unavailable');
        expect(refused.stripeCalls()).toEqual([]);
        expect(refused.logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'price_unavailable', reason: 'tier_not_sold' }),
          expect.any(String),
        );
        // Every OTHER tier still sells: the flag is per tier, not a global off.
        for (const tier of TIER_ORDER.filter((t) => t !== off)) {
          const { deps } = harness({ buyable: 'config' });
          expect(await startPlanCheckout({ ...INPUT, tier }, deps)).toMatchObject({ ok: true, tier });
        }
      } finally {
        presentation[off].availableToBuy = saved;
      }
    },
  );

  it('the held path is unchanged: a held friend buys the friend tier even when nothing is availableToBuy', async () => {
    const { deps } = harness({ lineage: friendLineage, buyable: [] });
    const result = await startPlanCheckout({ ...INPUT, tier: INVITE_ISSUANCE_POLICY.account.grantId as typeof FRIEND_TIER }, deps);
    expect(result).toMatchObject({ ok: true, held: true });
  });
});

describe('startPlanCheckout — BQ-P10: free access with no end date', () => {
  it('refused free_access_no_end_date (409), warn with no alert, decided before any Stripe call', async () => {
    const { deps, logger, stripeCalls, log } = harness({ snapshot: cohortResolution(null), row: account() });
    const result = await startPlanCheckout(INPUT, deps);
    expectRefused(result, 'free_access_no_end_date');
    expect(PLAN_CHECKOUT_REFUSALS.free_access_no_end_date.status).toBe(409);
    expect(stripeCalls()).toEqual([]);
    expect(log).toEqual(['db:lineage', 'db:snapshot', 'db:findByUser']);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'free_access_no_end_date' }), expect.any(String));
  });

  it.each([
    ['an admin-dated cohort with an end date', cohortResolution('2026-12-01T00:00:00.000Z')],
    ['an admin-dated cohort in grace (end date passed)', cohortResolution('2026-10-01T00:00:00.000Z')],
    ['a tier (live, or an admin assignment with no end)', { unavailable: false, resolution: TIER_RESOLUTION }],
    ['a paused / expired tier', { unavailable: false, resolution: { basis: { kind: 'tier', tier: FRIEND_TIER }, lifecycle: { accessEndsAt: '2026-10-01T00:00:00.000Z' } } }],
  ] as Array<[string, PlanSnapshotLike]>)('%s → may buy', async (_label, snapshot) => {
    const { deps } = harness({ snapshot });
    expect((await startPlanCheckout(INPUT, deps)).ok).toBe(true);
  });

  it('a timed cohort (a trial: its config has a duration) with no access end is NOT caught', async () => {
    // Found by structure in the production config, never by name.
    const timed = Object.entries(COHORTS).find(([, config]) => 'durationHistory' in config)![0];
    const { deps } = harness({ snapshot: { unavailable: false, resolution: { basis: { kind: 'cohort', cohort: timed }, lifecycle: { accessEndsAt: null } } } });
    expect((await startPlanCheckout(INPUT, deps)).ok).toBe(true);
  });

  // SA W-3: the rule applies to every account, held included.
  it('W-3: a HELD account with open-ended free access is refused too; a held fixture on a tier is not caught', async () => {
    const grant = INVITE_ISSUANCE_POLICY.account.grantId as typeof FRIEND_TIER;
    const caught = harness({ lineage: friendLineage, snapshot: cohortResolution(null) });
    expectRefused(await startPlanCheckout({ ...INPUT, tier: grant }, caught.deps), 'free_access_no_end_date');
    expect(caught.stripeCalls()).toEqual([]);

    const tierHeld = harness({ lineage: friendLineage });
    expect(await startPlanCheckout({ ...INPUT, tier: grant }, tierHeld.deps)).toMatchObject({ ok: true, held: true });
  });
});

describe('startPlanCheckout — W-1: refusals from our own data never touch the open session', () => {
  const cases: Array<[string, Options, Partial<PlanCheckoutInput>, string]> = [
    ['tier not on sale (M-1)', { buyable: [FRIEND_TIER] }, { tier: HIGHER_TIER }, 'price_unavailable'],
    ['free access with no end date (BQ-P10)', { snapshot: cohortResolution(null) }, {}, 'free_access_no_end_date'],
    ['a live subscription on the record (SR-5 layer 1)', { row: account({ ...OPEN_LOCK, subscriptionStatus: 'active' }) }, {}, 'subscription_live'],
    ['switches off', { heldSwitches: { ...HELD_SWITCHES_ON, checkoutEnabled: false } }, {}, 'checkout_unavailable'],
  ];

  it.each(cases)('%s, with an unexpired lock present → refused, ZERO Stripe calls, lock untouched', async (_label, options, input, code) => {
    const { deps, repo, stripeCalls } = harness({ row: account(OPEN_LOCK), ...options });
    expectRefused(await startPlanCheckout({ ...INPUT, ...input }, deps), code);
    expect(stripeCalls()).toEqual([]);
    expect(repo.releaseCheckoutLock).not.toHaveBeenCalled();
    expect(mockGetStripeService).not.toHaveBeenCalled();
  });

  it('a held account: BQ-P10 and a live subscription refuse before M-3 as well', async () => {
    const grant = INVITE_ISSUANCE_POLICY.account.grantId as typeof FRIEND_TIER;
    for (const options of [
      { snapshot: cohortResolution(null) },
      { row: account({ ...OPEN_LOCK, subscriptionStatus: 'past_due' as const }) },
    ] as Options[]) {
      const { deps, repo, stripeCalls } = harness({ lineage: friendLineage, row: account(OPEN_LOCK), ...options });
      expect((await startPlanCheckout({ ...INPUT, tier: grant }, deps)).ok).toBe(false);
      expect(stripeCalls()).toEqual([]);
      expect(repo.releaseCheckoutLock).not.toHaveBeenCalled();
    }
  });
});

describe('startPlanCheckout — M-3: the account\'s own open checkout is replaced (SA W-4)', () => {
  it('open → expired at Stripe, lock released by compare-and-set, a NEW checkout returned; replacedSessionId recorded and logged', async () => {
    const { deps, repo, stripe, log, logger } = harness({ row: account(OPEN_LOCK) });
    const result = await startPlanCheckout(INPUT, deps);

    expect(result).toMatchObject({ ok: true, sessionId: 'cs_test_new', replacedSessionId: 'cs_test_open' });
    // Every DB read first; then the M-3 retrieve and expire (W-10 wording), then the rest.
    expect(log.slice(0, 6)).toEqual([
      'db:lineage',
      'db:snapshot',
      'db:findByUser',
      'stripe:retrieve:cs_test_open',
      'stripe:expire:cs_test_open',
      'db:releaseLock:cs_test_open',
    ]);
    expect(log).toContain('stripe:createSession:cus_stored');
    // The session id came from OUR row; the release is keyed by the session user and mode.
    expect(stripe.retrieveCheckoutSessionState).toHaveBeenCalledWith('cs_test_open');
    expect(repo.releaseCheckoutLock).toHaveBeenCalledWith({ userId: USER, livemode: false, sessionId: 'cs_test_open', nowIso: NOW.toISOString() });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'bos_billing_checkout_replaced', replacedSessionId: 'cs_test_open', previousStatus: 'open', expiredByUs: true }),
      expect.any(String)
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'bos_billing_checkout_started', replacedSessionId: 'cs_test_open' }),
      expect.any(String)
    );
  });

  it('expired → released and continued; nothing expired by us, so no replacedSessionId', async () => {
    const { deps, stripe, repo } = harness({ row: account(OPEN_LOCK), openSession: { status: 'expired', customerId: 'cus_stored', livemode: false } });
    const result = await startPlanCheckout(INPUT, deps);
    expect(result.ok).toBe(true);
    expect(result.ok && result.replacedSessionId).toBeUndefined();
    expect(stripe.expireCheckoutSession).not.toHaveBeenCalled();
    expect(repo.releaseCheckoutLock).toHaveBeenCalledTimes(1);
  });

  it('complete → checkout_processing (409), no expire, no release, no new session', async () => {
    const { deps, stripe, repo } = harness({ row: account(OPEN_LOCK), openSession: { status: 'complete', customerId: 'cus_stored', livemode: false } });
    const result = await startPlanCheckout(INPUT, deps);
    expect(result).toEqual({ ok: false, code: 'checkout_processing' });
    expect(PLAN_CHECKOUT_REFUSALS.checkout_processing.status).toBe(409);
    expect(stripe.expireCheckoutSession).not.toHaveBeenCalled();
    expect(repo.releaseCheckoutLock).not.toHaveBeenCalled();
    expect(stripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
  });

  it.each([
    ['customer mismatch', { status: 'open', customerId: 'cus_someone_else', livemode: false }],
    ['mode mismatch', { status: 'open', customerId: 'cus_stored', livemode: true }],
  ] as const)('%s → checkout_open, error with an alert, and NOTHING expired or released', async (_label, openSession) => {
    const { deps, stripe, repo, logger } = harness({ row: account(OPEN_LOCK), openSession });
    expect(await startPlanCheckout(INPUT, deps)).toEqual({ ok: false, code: 'checkout_open', expiresAt: OPEN_LOCK.openCheckoutExpiresAt });
    expect(stripe.expireCheckoutSession).not.toHaveBeenCalled();
    expect(repo.releaseCheckoutLock).not.toHaveBeenCalled();
    expect(stripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'checkout_open', reason: 'open_session_ownership_mismatch', alert: true }),
      expect.any(String)
    );
  });

  it('retrieve throws → checkout_open, nothing expired or released', async () => {
    const { deps, stripe, repo } = harness({ row: account(OPEN_LOCK), openSession: new Error('stripe down') });
    expectRefused(await startPlanCheckout(INPUT, deps), 'checkout_open');
    expect(stripe.expireCheckoutSession).not.toHaveBeenCalled();
    expect(repo.releaseCheckoutLock).not.toHaveBeenCalled();
  });

  it('an unknown status → checkout_open, nothing expired', async () => {
    const { deps, stripe } = harness({ row: account(OPEN_LOCK), openSession: { status: null, customerId: 'cus_stored', livemode: false } });
    expectRefused(await startPlanCheckout(INPUT, deps), 'checkout_open');
    expect(stripe.expireCheckoutSession).not.toHaveBeenCalled();
  });

  it('expire throws → checkout_open (it may still be payable), no release, no new session', async () => {
    const { deps, stripe, repo } = harness({ row: account(OPEN_LOCK), expireThrows: true });
    expectRefused(await startPlanCheckout(INPUT, deps), 'checkout_open');
    expect(repo.releaseCheckoutLock).not.toHaveBeenCalled();
    expect(stripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
  });

  it('a repository error on the release → checkout_open with an alert, no new session', async () => {
    const { deps, stripe, logger } = harness({ row: account(OPEN_LOCK), release: 'error' });
    expectRefused(await startPlanCheckout(INPUT, deps), 'checkout_open');
    expect(stripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ step: 'release_open_session_lock', alert: true }), expect.any(String));
  });

  it('released: false is NOT a failure (W-4 d): it continues and step 14 arbitrates', async () => {
    const { deps, repo } = harness({ row: account(OPEN_LOCK), release: { released: false } });
    expect((await startPlanCheckout(INPUT, deps)).ok).toBe(true);
    expect(repo.acquireCheckoutLock).toHaveBeenCalledTimes(1);
  });

  it('two requests race on the same open session: one new checkout wins, the loser\'s new session is expired and never returned', async () => {
    // One shared world: the lock row and the Stripe session states.
    let lock: string | null = 'cs_test_open';
    const sessionStatus: Record<string, 'open' | 'expired'> = { cs_test_open: 'open' };
    const first = harness({ row: account(OPEN_LOCK) });
    const second = harness({
      row: account(OPEN_LOCK),
      sessions: [{ sessionId: 'cs_test_two', clientSecret: 'other_secret', expiresAt: STRIPE_EXPIRES, livemode: false }],
    });
    for (const side of [first, second]) {
      side.stripe.retrieveCheckoutSessionState.mockImplementation(async (id: string) => ({
        status: sessionStatus[id] ?? 'open',
        customerId: 'cus_stored',
        livemode: false,
      }));
      side.stripe.expireCheckoutSession.mockImplementation(async (id: string) => {
        sessionStatus[id] = 'expired';
      });
      side.repo.releaseCheckoutLock.mockImplementation(async (input: { sessionId: string }) => {
        const released = lock === input.sessionId;
        if (released) lock = null;
        return { data: { released }, error: null };
      });
      side.repo.acquireCheckoutLock.mockImplementation(async (...args: unknown[]) => {
        const input = args[0] as { sessionId: string };
        if (lock !== null) return { data: { acquired: false }, error: null };
        lock = input.sessionId;
        return { data: { acquired: true }, error: null };
      });
    }

    const [a, b] = await Promise.all([startPlanCheckout(INPUT, first.deps), startPlanCheckout(INPUT, second.deps)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const loserResult = a.ok ? b : a;
    const loser = a.ok ? second : first;
    expect(loserResult).toEqual({ ok: false, code: 'checkout_busy' });
    // The loser expired the session IT created; its secret never left.
    const loserNew = loser === first ? 'cs_test_new' : 'cs_test_two';
    expect(loser.stripe.expireCheckoutSession).toHaveBeenCalledWith(loserNew);
    expect(JSON.stringify(loserResult)).not.toContain('secret');
    // The old session can no longer be paid, and the lock holds the winner's new one.
    expect(sessionStatus.cs_test_open).toBe('expired');
    expect(lock).toBe(a.ok ? 'cs_test_new' : 'cs_test_two');
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
