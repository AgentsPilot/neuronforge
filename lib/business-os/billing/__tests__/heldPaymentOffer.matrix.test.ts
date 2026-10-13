/**
 * The switch matrix (plan payments P-5a.2; workplan §3.1, §8 "Predicate"; SA
 * S5-2, P5-C5, W-8).
 *
 * For every combination of the three held-payment switches (2³) and every
 * held shape (a friend, an admin invitee, a friend whose tier has no Stripe
 * price), the holding screen offers Pay EXACTLY when the checkout admits the
 * account.
 *
 * Both sides run through the REAL code, reading the REAL switches:
 *   - the screen: `readHeldPaymentView` with its default switch reader;
 *   - the checkout: the REAL route `POST /api/business-os/billing/plan/checkout`
 *     (so its 404 gate on the checkout switch is folded in as "not admitted"),
 *     the REAL `startPlanCheckout` (so the price-switch refusal at step 4 is
 *     too), and "admitted" means it reached Stripe's session create and
 *     answered 200 (W-8). Testing the eligibility against `heldPaymentOffer`
 *     alone would be tautological, since one calls the other.
 * Only the edges are fakes: the session, the repositories, the entitlement
 * snapshot, Stripe and the audit flush.
 *
 * `paidInvitesAvailable` is a code constant (off on main). It is flipped in
 * memory here, the way a local demo flips it, and restored afterwards; this
 * file's module registry is its own.
 */

import { NextRequest } from 'next/server';

import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';
import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { displayMonthlyPricesUsd, displayPriceInCents } from '@/lib/business-os/billing/planPriceCheck';

const USER = '11111111-1111-4111-8111-111111111111';
const INVITE = '66666666-6666-4666-8666-666666666666';
const FRIEND_TIER = TIER_ORDER[0];
const HIGHER_TIER = TIER_ORDER[TIER_ORDER.length - 1];

const state: {
  lineage: Record<string, unknown> | null;
  invite: Record<string, unknown> | null;
  sessionsCreated: number;
} = { lineage: null, invite: null, sessionsCreated: 0 };

jest.mock('@/lib/auth', () => ({ getUser: async () => ({ id: USER, email: 'friend@example.com' }) }));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/utils/origins', () => ({ platformOrigin: () => 'https://app.example' }));
jest.mock('@/lib/repositories/BusinessOsAccountLineageRepository', () => ({
  businessOsAccountLineageRepository: {
    findHoldFactsForAccount: async () => ({ data: state.lineage, error: null }),
  },
}));
jest.mock('@/lib/repositories/BusinessOsInviteRepository', () => ({
  businessOsInviteRepository: {
    findHoldFactsById: async () => ({ data: state.invite, error: null }),
  },
}));
jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', () => ({
  businessOsBillingAccountRepository: {
    // No billing row: nothing live, no open checkout (the screen would show Pay).
    findByUser: async () => ({ data: null, error: null }),
    recordCustomer: async (input: { stripeCustomerId: string }) => ({
      data: {
        account: {
          id: '22222222-2222-4222-8222-222222222222',
          accountId: USER,
          livemode: false,
          stripeCustomerId: input.stripeCustomerId,
          stripeSubscriptionId: null,
          subscriptionStatus: null,
          openCheckoutSessionId: null,
          openCheckoutExpiresAt: null,
        },
        created: true,
      },
      error: null,
    }),
    acquireCheckoutLock: async () => ({ data: { acquired: true }, error: null }),
    replaceCustomer: async () => ({ data: { replaced: true }, error: null }),
  },
}));
jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  // P-4.1: a resolution with a tier basis, which BQ-P10 (W-3: every account) does not catch.
  getEntitlementService: () => ({
    getSnapshot: async () => ({ unavailable: false, resolution: { basis: { kind: 'tier', tier: 'held_fixture_tier' }, lifecycle: { accessEndsAt: null } } }),
  }),
}));
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => ({
    listPricesByLookupKeys: async (keys: readonly string[]) => keys.map((key) => priceFor(key)),
    listCustomerSubscriptions: async () => ({ complete: true, subscriptions: [] }),
    createBusinessOsPlanCheckoutSession: async () => {
      state.sessionsCreated += 1;
      return { sessionId: 'cs_test_matrix', clientSecret: 'cs_test_secret', expiresAt: 1_900_000_000, livemode: false };
    },
    expireCheckoutSession: async () => undefined,
    findOrCreatePlatformCustomer: async () => ({ customerId: 'cus_matrix', created: true, livemode: false }),
  }),
}));
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: async () => undefined }));

import { POST } from '@/app/api/business-os/billing/plan/checkout/route';
import { readHeldPaymentView } from '@/lib/business-os/billing/heldPaymentView';

function priceFor(lookupKey: string): Record<string, unknown> {
  const tier = TIER_ORDER.find((candidate) => PLAN_STRIPE_PRICES[candidate].lookupKey === lookupKey) ?? FRIEND_TIER;
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
  };
}

const ENV = ['BUSINESS_OS_PLAN_CHECKOUT_ENABLED', 'BUSINESS_OS_PLAN_PRICES_ENABLED', 'STRIPE_SECRET_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};
const policy = INVITE_ISSUANCE_POLICY as { paidInvitesAvailable: boolean; account: { grantId: string } };
const saved = { paidInvitesAvailable: policy.paidInvitesAvailable, grantId: policy.account.grantId };

beforeAll(() => {
  for (const name of ENV) savedEnv[name] = process.env[name];
  process.env.STRIPE_SECRET_KEY = 'sk_test_matrix';
});
afterAll(() => {
  for (const name of ENV) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  policy.paidInvitesAvailable = saved.paidInvitesAvailable;
  policy.account.grantId = saved.grantId;
});
afterEach(() => {
  policy.paidInvitesAvailable = saved.paidInvitesAvailable;
  policy.account.grantId = saved.grantId;
});

type Shape = 'friend' | 'admin invitee' | 'friend, tier unpriced';

function arrange(shape: Shape) {
  state.sessionsCreated = 0;
  if (shape === 'admin invitee') {
    state.lineage = { invite_id: INVITE, source: 'admin_invite', first_paid_at: null };
    state.invite = { grant_kind: 'tier', language: 'en' };
  } else {
    state.lineage = { invite_id: INVITE, source: 'account_invite', first_paid_at: null };
    state.invite = { grant_kind: 'tier', language: 'en' };
  }
  // A friend tier with no Stripe price: the invite policy names a tier nobody sells.
  if (shape === 'friend, tier unpriced') policy.account.grantId = 'tier_without_a_price';
}

const HOLDS = {
  friend: { ok: true, held: true, inviteId: INVITE, source: 'account_invite' },
  'admin invitee': { ok: true, held: true, inviteId: INVITE, source: 'admin_invite' },
  'friend, tier unpriced': { ok: true, held: true, inviteId: INVITE, source: 'account_invite' },
} as const;

async function checkoutAdmits(tier: string): Promise<boolean> {
  const before = state.sessionsCreated;
  const response = await POST(
    new NextRequest('https://example.test/api/business-os/billing/plan/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier, returnTo: 'awaiting_payment' }),
    })
  );
  const reachedStripe = state.sessionsCreated > before;
  // Never a 200 without a session, nor a session without a 200.
  expect(response.status === 200).toBe(reachedStripe);
  return reachedStripe;
}

const BOOLS = [false, true] as const;
const COMBINATIONS = BOOLS.flatMap((checkoutEnabled) =>
  BOOLS.flatMap((pricesEnabled) => BOOLS.map((paidInvitesAvailable) => ({ checkoutEnabled, pricesEnabled, paidInvitesAvailable })))
);
const SHAPES: Shape[] = ['friend', 'admin invitee', 'friend, tier unpriced'];
const CASES = COMBINATIONS.flatMap((switches) => SHAPES.map((shape) => [shape, switches] as const));

describe('the screen offers Pay ⇔ the real checkout admits the account (P5-C5, W-8)', () => {
  it('covers 8 switch combinations × 3 held shapes', () => {
    expect(COMBINATIONS).toHaveLength(8);
    expect(CASES).toHaveLength(24);
  });

  it.each(CASES)('%s, switches %j', async (shape, switches) => {
    process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED = String(switches.checkoutEnabled);
    process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = String(switches.pricesEnabled);
    policy.paidInvitesAvailable = switches.paidInvitesAvailable;
    arrange(shape);

    const view = await readHeldPaymentView({
      userId: USER,
      accountId: USER,
      hold: HOLDS[shape],
      language: 'en',
      checkoutReturned: false,
    });
    const offersPay = view.kind === 'pay';

    // The tier the screen would buy, or (when it offers none) every tier there is.
    const tiers = view.kind === 'pay' ? [view.tier] : [...TIER_ORDER];
    const admitted: boolean[] = [];
    for (const tier of tiers) admitted.push(await checkoutAdmits(tier));

    if (offersPay) {
      expect(admitted).toEqual([true]);
    } else {
      expect(admitted.every((value) => !value)).toBe(true);
      expect(view.kind).toBe('coming_soon');
    }

    // Non-vacuity: Pay is offered in exactly one cell per shape row, the friend with all three on.
    const allOn = switches.checkoutEnabled && switches.pricesEnabled && switches.paidInvitesAvailable;
    expect(offersPay).toBe(allOn && shape === 'friend');
  });

  it('when Pay is offered, the higher tier is still refused to the held friend', async () => {
    process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED = 'true';
    process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'true';
    policy.paidInvitesAvailable = true;
    arrange('friend');
    expect(HIGHER_TIER).not.toBe(FRIEND_TIER);
    expect(await checkoutAdmits(HIGHER_TIER)).toBe(false);
  });
});
