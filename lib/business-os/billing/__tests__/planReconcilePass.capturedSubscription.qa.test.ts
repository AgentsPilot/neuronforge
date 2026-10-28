/**
 * QA (plan payments P-8b.2, SA condition Q-C1): a REAL captured Stripe
 * subscription object, through a mocked `stripe.subscriptions.list`, the REAL
 * `StripeService.listBusinessOsSubscriptionsByPrice` mapping, and the REAL
 * Step B of `createPlanReconcilePass`.
 *
 * Fixture: `captured-p7b1-e1b-06-subscription-after-pay.json`, an SDK response
 * at the pin `2025-10-29.clover` (the version `subscriptions.list` answers in),
 * scrubbed. The tier comes from the fixture's own lookup key through the real
 * `planTierForLookupKey`. No database, no network, no Stripe write.
 */

const mockEventsList = jest.fn();
const mockSubscriptionsList = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    events: { list: (...args: unknown[]) => mockEventsList(...args) },
    subscriptions: { list: (...args: unknown[]) => mockSubscriptionsList(...args) },
  }))
);

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  createPlanReconcilePass,
  type PlanReconcileBillingRow,
  type PlanReconcileDeps,
  type PlanReconcilePlanFacts,
} from '@/lib/business-os/billing/planReconcilePass';
import type { ReconcilePassContext } from '@/lib/business-os/billing/reconcilePassRunner';
import { planTierForLookupKey } from '@/lib/business-os/billing/planPriceCatalog';
import { StripeService } from '@/lib/stripe/StripeService';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- a JSON fixture, read as Stripe sent it
const CAPTURED = require('./fixtures/stripe/captured-p7b1-e1b-06-subscription-after-pay.json') as {
  _fixture_api_version?: string;
  _fixture_source: string;
  id: string;
  object: string;
  status: string;
  livemode: boolean;
  items: { data: Array<{ price: { id: string; lookup_key: string }; current_period_start: number; current_period_end: number }>; has_more: boolean };
};

const ITEM = CAPTURED.items.data[0];
const PRICE_ID = ITEM.price.id;
const TIER = planTierForLookupKey(ITEM.price.lookup_key);
/** Any tier string other than the captured one: Step B compares tiers as strings. */
const OTHER_TIER = `${TIER}_other`;
const PERIOD_START_MS = ITEM.current_period_start * 1000;
const PERIOD_END_ISO = new Date(ITEM.current_period_end * 1000).toISOString();
/** Five days into the captured period: older than the 24-hour settle rule, before its end. */
const NOW = PERIOD_START_MS + 5 * 24 * 60 * 60 * 1000;
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const TYPES = [
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

function billingRow(overrides: Partial<PlanReconcileBillingRow> = {}): PlanReconcileBillingRow {
  return {
    id: 'billing_row_1',
    user_id: ACCOUNT,
    stripe_subscription_id: CAPTURED.id,
    subscription_status: CAPTURED.status,
    bought_tier: TIER,
    current_period_end: PERIOD_END_ISO,
    cancel_at_period_end: false,
    ended_at: null,
    ...overrides,
  };
}

function planRow(overrides: Partial<PlanReconcilePlanFacts> = {}): Record<string, PlanReconcilePlanFacts> {
  return { [ACCOUNT]: { tier: TIER, tierExpiresAt: PERIOD_END_ISO, ...overrides } };
}

function harness(rows: PlanReconcileBillingRow[], plans: Record<string, PlanReconcilePlanFacts>, now: number = NOW) {
  const service = new StripeService('sk_test_unit');
  const claimCalls: string[] = [];
  const handled: string[] = [];
  const record = (name: string) => async () => {
    claimCalls.push(name);
    return { data: null, error: null };
  };
  const deps: PlanReconcileDeps = {
    eventTypes: TYPES,
    verifiedShapes: { '2025-10-29.clover': TYPES },
    staleClaimAgeMs: 15 * 60 * 1000,
    keyLivemode: () => false,
    stripe: () => service,
    claims: {
      findClaim: record('findClaim'),
      insertClaim: record('insertClaim'),
      reclaimStale: record('reclaimStale'),
      reclaimFailedIfStillFailed: record('reclaimFailedIfStillFailed'),
      complete: record('complete'),
      markFailed: record('markFailed'),
    },
    dispatch: async () => ({ kind: 'plan' }),
    handle: async (event) => {
      handled.push(event.id);
    },
    recentRuns: async () => ({ data: [], error: null }),
    billingRows: async () => ({ data: rows, error: null }),
    planFacts: async () => ({ data: plans, error: null }),
    recordedPayments: async () => ({ data: { eventIds: [], invoiceIds: [] }, error: null }),
    planPrices: async () => new Map([[PRICE_ID, TIER as string]]),
    clock: () => now,
  };
  const lines: Array<{ level: string; ctx: Record<string, unknown> }> = [];
  const at = (level: string) => (ctx: Record<string, unknown>) => {
    lines.push({ level, ctx });
  };
  const context: ReconcilePassContext = {
    deadlineAt: now + 45_000,
    now: new Date(now),
    log: { info: at('info'), warn: at('warn'), error: at('error') },
    trigger: 'nightly',
  };
  const findings = () => lines.filter((line) => line.ctx.event === 'bos_plan_reconcile_finding');
  return { run: () => createPlanReconcilePass(deps).run(context), findings, claimCalls, handled };
}

beforeEach(() => {
  mockEventsList.mockReset();
  mockSubscriptionsList.mockReset();
  mockEventsList.mockResolvedValue({ data: [], has_more: false });
  // Stripe's list answer, with the captured subscription exactly as the SDK returned it.
  mockSubscriptionsList.mockResolvedValue({ object: 'list', data: [CAPTURED], has_more: false });
});

describe('Q-C1: a captured subscription through the real list mapping into Step B', () => {
  it('the fixture is what the condition names: a subscription at the 2025-10-29.clover pin, active, one plan item, a known tier', () => {
    expect(CAPTURED.object).toBe('subscription');
    expect(CAPTURED._fixture_source).toMatch(/2025-10-29\.clover/);
    expect(CAPTURED.status).toBe('active');
    expect(CAPTURED.livemode).toBe(false);
    expect(CAPTURED.items.has_more).toBe(false);
    expect(CAPTURED.items.data).toHaveLength(1);
    expect(TIER).not.toBeNull();
    expect(NOW - PERIOD_START_MS).toBeGreaterThan(24 * 60 * 60 * 1000);
    expect(NOW).toBeLessThan(ITEM.current_period_end * 1000);
  });

  it('a matching billing row and plan row: no finding, and Stripe is asked by the plan price, 100 per page', async () => {
    const h = harness([billingRow()], planRow());
    const counts = await h.run();
    expect(h.findings()).toEqual([]);
    expect(counts).toMatchObject({ mismatch: 0, orphan: 0, checkIncomplete: 0 });
    expect(mockSubscriptionsList).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionsList).toHaveBeenCalledWith({ price: PRICE_ID, limit: 100 });
    // Step B never writes and never runs the handler.
    expect(h.claimCalls).toEqual([]);
    expect(h.handled).toEqual([]);
  });

  it('a planted bought_tier difference: exactly one tier_differs and planMismatch = 1', async () => {
    const h = harness([billingRow({ bought_tier: OTHER_TIER })], planRow());
    const counts = await h.run();
    expect(h.findings().map((line) => line.ctx)).toEqual([
      { event: 'bos_plan_reconcile_finding', kind: 'tier_differs', billingAccountId: 'billing_row_1', stripeSubscriptionId: CAPTURED.id, alert: true },
    ]);
    expect(counts.mismatch).toBe(1);
    expect(counts.orphan).toBe(0);
    expect(h.claimCalls).toEqual([]);
  });

  it('a planted current_period_end difference (period started over 24 h ago): exactly one period_differs', async () => {
    const h = harness([billingRow({ current_period_end: new Date(PERIOD_START_MS).toISOString() })], planRow());
    const counts = await h.run();
    expect(h.findings().map((line) => line.ctx.kind)).toEqual(['period_differs']);
    expect(counts.mismatch).toBe(1);
  });

  it('control: the same period difference while the period is under 24 h old is not a finding', async () => {
    const h = harness([billingRow({ current_period_end: new Date(PERIOD_START_MS).toISOString() })], planRow(), PERIOD_START_MS + 60 * 60 * 1000);
    const counts = await h.run();
    expect(h.findings()).toEqual([]);
    expect(counts.mismatch).toBe(0);
  });

  it('control: the captured subscription with no billing row is one orphan (complete list)', async () => {
    const h = harness([], {});
    const counts = await h.run();
    expect(h.findings().map((line) => [line.ctx.kind, line.ctx.stripeSubscriptionId])).toEqual([['orphan', CAPTURED.id]]);
    expect(counts.orphan).toBe(1);
  });

  it('control: the same list with has_more and no further pages (page cap 10) gives no orphan, checkIncomplete', async () => {
    mockSubscriptionsList.mockResolvedValue({ object: 'list', data: [CAPTURED], has_more: true });
    const h = harness([], {});
    const counts = await h.run();
    expect(mockSubscriptionsList).toHaveBeenCalledTimes(10);
    expect(h.findings()).toEqual([]);
    expect(counts).toMatchObject({ orphan: 0, checkIncomplete: 1 });
  });
});
