/**
 * The Settings → Plan purchase view (plan payments P-4.2; workplan §3.4, §7
 * "Purchase view + my-plan"; SA M-5, F-2, W-2, W-5, W-7, W-8, W-9).
 *
 * Every port is injected: switches, billing reader, key mode, buyable tiers,
 * clock, logger. Resolutions come from the REAL lifecycle derivation over the
 * production cohort config, with cohorts found by STRUCTURE (FR-12: no tier or
 * cohort name is written here).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the plan screen never talks to Stripe (SR-11)');
  },
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { COHORTS, type CohortConfig } from '@/lib/business-os/entitlements/config/cohorts';
import { LIFECYCLE_CONFIG } from '@/lib/business-os/entitlements/config/lifecycle';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { deriveLifecycle, type LifecycleInputs } from '@/lib/business-os/entitlements/lifecycle';
import { account } from '@/lib/business-os/entitlements/__fixtures__/accounts';
import { LIVE_SUBSCRIPTION_STATUSES, type PlanSnapshotLike } from '@/lib/business-os/billing/planCheckout';
import {
  billingEndsWhen,
  billingStateFromRecord,
  readPlanPurchaseView,
  type PlanPurchaseViewDeps,
} from '@/lib/business-os/billing/planPurchaseView';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-13T12:00:00.000Z');
const PAST = '2026-10-01T00:00:00.000Z';
const FUTURE = '2026-11-13T12:00:00.000Z';
const TIER = TIER_ORDER[0];
const ALL_TIERS = [...TIER_ORDER] as string[];

const cohortEntries = Object.entries(COHORTS) as Array<[string, CohortConfig]>;
const ADMIN_DATED = cohortEntries.find(([, config]) => !config.durationHistory)![0];
const TIMED = cohortEntries.find(([, config]) => !!config.durationHistory)![0];
const INPUTS: LifecycleInputs = { cohorts: COHORTS, tierOrder: TIER_ORDER, subscriptionGraceHistory: LIFECYCLE_CONFIG.subscriptionGraceHistory };

function snapshotFor(overrides: Parameters<typeof account>[0]): PlanSnapshotLike {
  const lifecycle = deriveLifecycle(account(overrides), INPUTS, NOW);
  return { unavailable: false, resolution: { basis: lifecycle.basis, lifecycle: { accessEndsAt: lifecycle.accessEndsAt } } };
}

const ON_A_TIER = snapshotFor({ tier: TIER, planVersion: 1, tierExpiresAt: FUTURE });
const OPEN_ENDED = snapshotFor({ cohort: ADMIN_DATED, cohortExpiresAt: null });
const DATED_FREE = snapshotFor({ cohort: ADMIN_DATED, cohortExpiresAt: FUTURE });
const TRIAL = snapshotFor({ cohort: TIMED, onboardingStartedAt: '2026-10-10T00:00:00.000Z' });

type Billing = NonNullable<PlanPurchaseViewDeps['billing']>;
type BillingResult = Awaited<ReturnType<Billing['findByUser']>>;
type Row = NonNullable<BillingResult['data']>;

function row(overrides: Partial<Row> = {}): Row {
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

function harness(
  options: {
    switches?: { checkoutEnabled: boolean; pricesEnabled: boolean };
    billing?: BillingResult | (() => Promise<BillingResult>);
    mode?: () => 'test' | 'live';
    buyable?: readonly string[];
  } = {}
) {
  const reads: Array<[string, boolean]> = [];
  const warns: Array<Record<string, unknown>> = [];
  const deps: PlanPurchaseViewDeps = {
    switches: () => options.switches ?? { checkoutEnabled: true, pricesEnabled: true },
    billing: {
      findByUser: async (userId: string, livemode: boolean) => {
        reads.push([userId, livemode]);
        const answer = options.billing ?? { data: null, error: null };
        return typeof answer === 'function' ? answer() : answer;
      },
    },
    mode: options.mode ?? (() => 'test'),
    buyableTiers: () => options.buyable ?? ALL_TIERS,
    now: () => NOW,
    logger: { warn: (context) => warns.push(context) },
  };
  return { deps, reads, warns };
}

const view = (snapshot: PlanSnapshotLike, deps: PlanPurchaseViewDeps) => readPlanPurchaseView({ userId: USER, accountId: USER, snapshot }, deps);

describe('what it reads, and from whom (SA W-9, tenant isolation)', () => {
  it('reads the billing row by the SESSION user and the server key\'s mode', async () => {
    const test = harness();
    await view(ON_A_TIER, test.deps);
    expect(test.reads).toEqual([[USER, false]]);

    const live = harness({ mode: () => 'live' });
    await view(ON_A_TIER, live.deps);
    expect(live.reads).toEqual([[USER, true]]);
  });

  it('an unreadable plan, or no plan row, offers nothing and reads no billing', async () => {
    for (const snapshot of [
      { unavailable: true, resolution: null },
      { unavailable: false, resolution: null },
      { unavailable: false, resolution: { ...ON_A_TIER.resolution!, anomaly: 'no_plan_row' } },
    ] as PlanSnapshotLike[]) {
      const h = harness();
      expect(await view(snapshot, h.deps)).toBeNull();
      expect(h.reads).toEqual([]);
    }
  });

  it('an unknown key mode offers nothing (the checkout refuses it at step 5), with a warn', async () => {
    const h = harness({
      mode: () => {
        throw new Error('no key');
      },
    });
    expect(await view(ON_A_TIER, h.deps)).toBeNull();
    expect(h.reads).toEqual([]);
    expect(h.warns.map((w) => w.event)).toEqual(['bos_billing_purchase_view_mode_unknown']);
  });

  it('the source imports no Stripe client, is server-only, and reads no request', () => {
    const source = readFileSync(join(process.cwd(), 'lib/business-os/billing/planPurchaseView.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toMatch(/^import 'server-only';/m);
    expect(code).not.toMatch(/StripeService|getStripeService|from 'stripe'|lib\/stripe\//);
    expect(code).not.toMatch(/searchParams|request\.|headers/);
    expect(code).toMatch(/findByUser\(userId, livemode\)/);
  });
});

describe('the offer: planPurchaseOffer over this view\'s own reads (M-1, BQ-P10, SA W-2)', () => {
  it('everything clear → Choose for exactly the buyable tiers', async () => {
    const h = harness({ buyable: [TIER] });
    expect((await view(ON_A_TIER, h.deps))!.offer).toEqual({ kind: 'choose', tiers: [TIER] });
  });

  it('a switch off → none, switches_off', async () => {
    for (const switches of [
      { checkoutEnabled: false, pricesEnabled: true },
      { checkoutEnabled: true, pricesEnabled: false },
    ]) {
      expect((await view(ON_A_TIER, harness({ switches }).deps))!.offer).toEqual({ kind: 'none', reason: 'switches_off' });
    }
  });

  it('BQ-P10: open-ended free access → none, free_access_no_end_date; a dated one and a trial may buy', async () => {
    expect((await view(OPEN_ENDED, harness().deps))!.offer).toEqual({ kind: 'none', reason: 'free_access_no_end_date' });
    expect((await view(DATED_FREE, harness().deps))!.offer.kind).toBe('choose');
    expect((await view(TRIAL, harness().deps))!.offer.kind).toBe('choose');
  });

  it.each(LIVE_SUBSCRIPTION_STATUSES)('a %s subscription on our record → none, paying', async (status) => {
    const h = harness({ billing: { data: row({ subscriptionStatus: status }), error: null } });
    expect((await view(ON_A_TIER, h.deps))!.offer).toEqual({ kind: 'none', reason: 'paying' });
  });

  it('a canceled or incomplete_expired subscription is not live: Choose again', async () => {
    for (const status of ['canceled', 'incomplete_expired'] as const) {
      const h = harness({ billing: { data: row({ subscriptionStatus: status, endedAt: PAST }), error: null } });
      expect((await view(ON_A_TIER, h.deps))!.offer.kind).toBe('choose');
    }
  });

  it('nothing on sale → none, not_on_sale', async () => {
    expect((await view(ON_A_TIER, harness({ buyable: [] }).deps))!.offer).toEqual({ kind: 'none', reason: 'not_on_sale' });
  });

  it('a failed billing read never hides the plan: the offer is computed as if there were no record, billing is null', async () => {
    const errored = harness({ billing: { data: null, error: new Error('db down') } });
    expect(await view(ON_A_TIER, errored.deps)).toEqual({
      offer: { kind: 'choose', tiers: ALL_TIERS },
      billing: null,
      endsFreeAccessOnPurchase: null,
      upgrade: null,
    });
    expect(errored.warns.map((w) => w.event)).toEqual(['bos_billing_purchase_view_billing_unread']);

    const threw = harness({
      billing: async () => {
        throw new Error('network');
      },
    });
    expect((await view(ON_A_TIER, threw.deps))!.billing).toBeNull();
    expect(threw.warns.map((w) => w.event)).toEqual(['bos_billing_purchase_view_billing_unread']);
  });
});

describe('F-2: "Renews on" / "Ends on" from our record only, exactly as SA W-5 words it', () => {
  const at = (overrides: Partial<Row>) => billingStateFromRecord(row(overrides), NOW);

  it('renewing: active, not cancelling, not ended, period end in the future', () => {
    expect(at({ subscriptionStatus: 'active', currentPeriodEnd: FUTURE })).toEqual({ state: 'renewing', date: FUTURE });
  });

  it('ending: active and set to cancel at the period end', () => {
    expect(at({ subscriptionStatus: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: FUTURE })).toEqual({ state: 'ending', date: FUTURE });
  });

  it('null: active but ended, or a period end in the past', () => {
    expect(at({ subscriptionStatus: 'active', currentPeriodEnd: FUTURE, endedAt: PAST })).toBeNull();
    expect(at({ subscriptionStatus: 'active', currentPeriodEnd: PAST })).toBeNull();
  });

  it('null: every other status, past_due included (its period end has not moved)', () => {
    for (const status of ['past_due', 'trialing', 'unpaid', 'incomplete', 'paused', 'canceled', 'incomplete_expired', null] as const) {
      expect(at({ subscriptionStatus: status, currentPeriodEnd: FUTURE })).toBeNull();
    }
  });

  it('null: no period end, or one we cannot read', () => {
    expect(at({ subscriptionStatus: 'active', currentPeriodEnd: null })).toBeNull();
    expect(at({ subscriptionStatus: 'active', currentPeriodEnd: 'not a date' })).toBeNull();
  });

  it('the view carries it, and billingEndsWhen names the sentence', async () => {
    const h = harness({ billing: { data: row({ subscriptionStatus: 'active', currentPeriodEnd: FUTURE }), error: null } });
    const result = await view(ON_A_TIER, h.deps);
    expect(result!.billing).toEqual({ state: 'renewing', date: FUTURE });
    expect(billingEndsWhen(result!.billing)).toEqual({ key: 'plan.renews_on', date: FUTURE });
    expect(billingEndsWhen({ state: 'ending', date: FUTURE })).toEqual({ key: 'plan.ends_on_paid', date: FUTURE });
    expect(billingEndsWhen(null)).toBeNull();
  });
});

describe('endsFreeAccessOnPurchase (SA Q-3 / W-7): structural, and only beside a Choose list', () => {
  it("a live trial → 'trial'; a dated Founding-Partner-like cohort → 'free_access'; a tier → null", async () => {
    expect((await view(TRIAL, harness().deps))!.endsFreeAccessOnPurchase).toBe('trial');
    expect((await view(DATED_FREE, harness().deps))!.endsFreeAccessOnPurchase).toBe('free_access');
    expect((await view(ON_A_TIER, harness().deps))!.endsFreeAccessOnPurchase).toBeNull();
  });

  it('null whenever nothing is offered, even for a trial', async () => {
    const off = harness({ switches: { checkoutEnabled: false, pricesEnabled: true } });
    expect(await view(TRIAL, off.deps)).toEqual({
      offer: { kind: 'none', reason: 'switches_off' },
      billing: null,
      endsFreeAccessOnPurchase: null,
      upgrade: null,
    });
    // And open-ended free access is refused outright (BQ-P10), so no sentence either.
    expect((await view(OPEN_ENDED, harness().deps))!.endsFreeAccessOnPurchase).toBeNull();
  });
});

describe('upgrade (P-7b.1b, workplan §3.6; SA U-2): planUpgradeOffer over this view\'s own billing read', () => {
  const [LOWER, ...ABOVE] = TIER_ORDER as readonly string[];
  const paying = (overrides: Partial<Row> = {}) =>
    row({ subscriptionStatus: 'active', boughtTier: LOWER, stripeSubscriptionId: 'sub_own', currentPeriodEnd: FUTURE, ...overrides });

  it('an active subscription on the lowest tier, switches on → the buyable tiers above it', async () => {
    expect(ABOVE.length).toBeGreaterThan(0);
    const h = harness({ billing: { data: paying(), error: null } });
    const result = await view(ON_A_TIER, h.deps);
    expect(result!.upgrade).toEqual({ tiers: ABOVE });
    // Paying: Choose is still not offered; the upgrade is its own answer.
    expect(result!.offer).toEqual({ kind: 'none', reason: 'paying' });
  });

  it('only the BUYABLE tiers above are listed; none buyable → null', async () => {
    const onlyLower = harness({ billing: { data: paying(), error: null }, buyable: [LOWER] });
    expect((await view(ON_A_TIER, onlyLower.deps))!.upgrade).toBeNull();
  });

  it.each([
    ['switches off', { switches: { checkoutEnabled: false, pricesEnabled: true } }, paying()],
    ['price switch off', { switches: { checkoutEnabled: true, pricesEnabled: false } }, paying()],
    ['no billing row', {}, null],
    ['no bought tier (a held or never-paid account)', {}, paying({ boughtTier: null })],
    ['no subscription id', {}, paying({ stripeSubscriptionId: null })],
    ['past_due', {}, paying({ subscriptionStatus: 'past_due' })],
    ['ended', {}, paying({ endedAt: PAST })],
    ['cancelling at the period end', {}, paying({ cancelAtPeriodEnd: true })],
    ['already on the top tier', {}, paying({ boughtTier: TIER_ORDER[TIER_ORDER.length - 1] })],
  ] as Array<[string, Parameters<typeof harness>[0], Row | null]>)('%s → null', async (_label, options, billingRow) => {
    const h = harness({ ...options, billing: { data: billingRow, error: null } });
    expect((await view(ON_A_TIER, h.deps))!.upgrade).toBeNull();
  });

  it('a failed billing read offers no upgrade (the routes answer billing_row_unreadable)', async () => {
    const h = harness({ billing: { data: null, error: new Error('db down') } });
    expect((await view(ON_A_TIER, h.deps))!.upgrade).toBeNull();
  });

  it('U-2: the plan row\'s tier is not an input (an admin-assigned top tier on a lower paid tier is still offered, Q-5)', async () => {
    const topSnapshot = snapshotFor({ tier: TIER_ORDER[TIER_ORDER.length - 1], planVersion: 1, tierExpiresAt: FUTURE });
    const h = harness({ billing: { data: paying(), error: null } });
    expect((await view(topSnapshot, h.deps))!.upgrade).toEqual({ tiers: ABOVE });
  });
});
