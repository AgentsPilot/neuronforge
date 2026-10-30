/**
 * QA, plan payments follow-ups FU-P7a4-5: the my-plan view never shows a
 * Founding Partner cohort end that is not strictly after `now`. Also checks
 * that a row stored `cancelling` by the C-3 mirror (a dashboard cancellation)
 * shows the "ending" state and offers Reactivate.
 *
 * The harness below is copied verbatim from `planPurchaseView.test.ts`.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the plan screen never talks to Stripe (SR-11)');
  },
}));

import { COHORTS } from '@/lib/business-os/entitlements/config/cohorts';
import { LIFECYCLE_CONFIG } from '@/lib/business-os/entitlements/config/lifecycle';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { deriveLifecycle, type LifecycleInputs } from '@/lib/business-os/entitlements/lifecycle';
import { account } from '@/lib/business-os/entitlements/__fixtures__/accounts';
import { type PlanSnapshotLike } from '@/lib/business-os/billing/planCheckout';
import {
  readPlanPurchaseView,
  type PlanPurchaseViewDeps,
} from '@/lib/business-os/billing/planPurchaseView';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-13T12:00:00.000Z');
const PAST = '2026-10-01T00:00:00.000Z';
const FUTURE = '2026-11-13T12:00:00.000Z';
const TIER = TIER_ORDER[0];
const ALL_TIERS = [...TIER_ORDER] as string[];

const INPUTS: LifecycleInputs = {
  cohorts: COHORTS,
  tierOrder: TIER_ORDER,
  subscriptionGraceHistory: LIFECYCLE_CONFIG.subscriptionGraceHistory,
  renewalSettlementMarginHistory: LIFECYCLE_CONFIG.renewalSettlementMarginHistory,
};

function snapshotFor(overrides: Parameters<typeof account>[0]): PlanSnapshotLike {
  const lifecycle = deriveLifecycle(account(overrides), INPUTS, NOW);
  return { unavailable: false, resolution: { basis: lifecycle.basis, lifecycle: { accessEndsAt: lifecycle.accessEndsAt } } };
}

const ON_A_TIER = snapshotFor({ tier: TIER, planVersion: 1, tierExpiresAt: FUTURE });

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

const subscribed = (overrides: Partial<Row> = {}) =>
  row({ stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active', boughtTier: TIER, currentPeriodEnd: FUTURE, ...overrides });

async function withPort(billingRow: Row | null, port: () => Promise<unknown>) {
  const h = harness({ billing: { data: billingRow, error: null } });
  const calls = { n: 0 };
  const result = await readPlanPurchaseView(
    {
      userId: USER,
      accountId: USER,
      snapshot: ON_A_TIER,
      freeAccessAfterPaidTier: (async () => {
        calls.n += 1;
        return port();
      }) as never,
    },
    h.deps
  );
  return { result, calls, warns: h.warns };
}

const failing = () => subscribed({ subscriptionStatus: 'unpaid', currentPeriodEnd: PAST });

describe('QA FU-P7a4-5 · the past cohort end guard', () => {
  it.each<[string, () => unknown]>([
    ['an end in the past (one day before now)', () => ({ endsAt: new Date(NOW.getTime() - 86_400_000).toISOString() })],
    ['an end long in the past', () => ({ endsAt: '2020-01-01T00:00:00.000Z' })],
    ['an end EQUAL to now', () => ({ endsAt: NOW.toISOString() })],
    ['an end equal to now, written with an offset', () => ({ endsAt: '2026-10-13T14:00:00.000+02:00' })],
    ['an end one millisecond BEFORE now', () => ({ endsAt: new Date(NOW.getTime() - 1).toISOString() })],
    ['a null end', () => ({ endsAt: null })],
    ['an undefined end', () => ({})],
    ['an unparseable date string', () => ({ endsAt: 'not-a-date' })],
    ['an empty string', () => ({ endsAt: '' })],
    ['a number instead of a string', () => ({ endsAt: NOW.getTime() + 86_400_000 })],
    ['the port answering null', () => null],
  ])('failing row, %s: no freeAccessAfter, Cancel still offered, no warning', async (_label, answer) => {
    const { result, calls, warns } = await withPort(failing(), async () => answer());
    expect(calls.n).toBe(1);
    expect(result!.manage).toMatchObject({ cancel: true });
    expect(result!.manage).not.toHaveProperty('freeAccessAfter');
    expect(warns).toEqual([]);
  });

  it.each<[string, string]>([
    ['now + 1 ms', new Date(NOW.getTime() + 1).toISOString()],
    ['now + 1 day', new Date(NOW.getTime() + 86_400_000).toISOString()],
  ])('failing row, an end at %s: shown, verbatim', async (_label, endsAt) => {
    const { result } = await withPort(failing(), async () => ({ endsAt }));
    expect(result!.manage).toMatchObject({ cancel: true, freeAccessAfter: { endsAt } });
  });

  it('a renewing row with a past end is also dropped (the guard is not failing-only)', async () => {
    const { result } = await withPort(subscribed(), async () => ({ endsAt: PAST }));
    expect(result!.manage).toMatchObject({ cancel: true });
    expect(result!.manage).not.toHaveProperty('freeAccessAfter');
  });
});

describe('QA C-3 · a row stored cancelling by the mirror reads as ending on my-plan', () => {
  it('cancelAtPeriodEnd true (a mirrored dashboard cancellation): Reactivate offered, no Cancel', async () => {
    const h = harness({ billing: { data: subscribed({ cancelAtPeriodEnd: true }), error: null } });
    const result = await view(ON_A_TIER, h.deps);
    expect(result!.manage).toMatchObject({ reactivate: true });
    expect(result!.manage?.cancel).toBeFalsy();
  });
});
