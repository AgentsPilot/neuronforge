/**
 * D3.1 replay safety (plan payments P-8b.2; SA ruling 12): "replaying one
 * `.deleted` event twice produces one end row and one cohort change".
 *
 * The pass never replays a `completed` claim, but it CAN replay a `failed`
 * `customer.subscription.deleted` days later. Here the REAL plan handler and
 * the REAL subscription mirror run behind the pass, on in-memory ports:
 *
 *   - a failed `.deleted` replayed by two nightly runs: one end row, one
 *     end-of-subscription plan change (the audit port, which is where SX-2b's
 *     free-cohort move hooks in; until D3.1 lands it is the only side effect);
 *   - a partial failure (the end row is written, then the plan-change step
 *     throws, so the claim is marked failed): the next run's replay sees the
 *     end row as a duplicate, writes no second row and makes no second change.
 *
 * Binding on SX-2b (ruling 12): the cohort move must be a target-state write,
 * guarded by "still the current subscription", and must not depend on the end
 * row being new. When D3.1 lands, its owner extends the second case to assert
 * the cohort row itself.
 */

import fs from 'fs';
import path from 'path';
import type Stripe from 'stripe';

import { createPlanBillingHandler, type PlanBillingHandlerDeps } from '@/lib/business-os/billing/planBillingHandler';
import { createPlanReconcilePass, type PlanClaimStatus, type PlanReconcileDeps } from '@/lib/business-os/billing/planReconcilePass';
import type { ReconcilePassContext } from '@/lib/business-os/billing/reconcilePassRunner';
import type { Logger } from '@/lib/logger';
import type { BusinessOsBillingAccount } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type { BusinessOsBillingEventInput } from '@/lib/repositories/BusinessOsBillingEventRepository';

/** The plan-change port's input, named through the handler's own deps (no entitlements import). */
type RecordPlanChangeInput = Parameters<PlanBillingHandlerDeps['recordPlanChange']>[0];

const NOW = Date.parse('2026-10-28T05:41:00.000Z');
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const SUB = 'sub_D31';
const ENDED_AT = 1_790_600_000;

function deletedEvent(): Stripe.Event {
  const file = path.join(__dirname, 'fixtures', 'stripe', 'customer-subscription-deleted.json');
  const event = JSON.parse(fs.readFileSync(file, 'utf8')) as Stripe.Event;
  (event.data.object as Stripe.Subscription).id = SUB;
  return event;
}

function billingRow(): BusinessOsBillingAccount {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    accountId: ACCOUNT,
    livemode: false,
    stripeCustomerId: 'cus_d31',
    stripeSubscriptionId: SUB,
    subscriptionStatus: 'active',
    boughtTier: 'tier_one',
    currentPeriodEnd: '2026-11-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    pendingTier: null,
    openCheckoutSessionId: null,
    openCheckoutExpiresAt: null,
    lastInvoiceId: 'in_1',
    lastPaidAt: '2026-10-01T00:00:00.000Z',
    lastPaymentFailedAt: null,
    failedAttempts: 0,
    actionRequiredInvoiceUrl: null,
    founderDiscountAppliedAt: null,
    endedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function harness(options: { planChangeThrowsOnce?: boolean } = {}) {
  const event = deletedEvent();
  const state = { row: billingRow() };
  const endRows: BusinessOsBillingEventInput[] = [];
  const planChanges: RecordPlanChangeInput[] = [];
  let planChangeThrows = options.planChangeThrowsOnce ?? false;

  const quiet: Record<string, unknown> = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
  quiet.child = () => quiet;
  const log = quiet as unknown as Logger;

  // The real handler, with only the ports a `.deleted` event reaches.
  const handlerDeps = {
    stripeMode: () => 'test',
    now: () => new Date(NOW),
    stripe: () => ({
      retrieveBusinessOsSubscription: async () => ({
        id: SUB,
        status: 'canceled',
        customerId: 'cus_d31',
        billingCycleAnchor: 1,
        cancelAtPeriodEnd: false,
        endedAt: ENDED_AT,
        livemode: false,
        metadata: {},
        priceIds: [],
        items: [],
        pendingUpdate: null,
        latestInvoiceId: null,
      }),
    }),
    billingAccounts: {
      findByStripeSubscription: async (id: string, livemode: boolean) => ({
        data: state.row.stripeSubscriptionId === id && state.row.livemode === livemode ? state.row : null,
        error: null,
      }),
      mirrorSubscriptionState: async (input: { status: string; cancelAtPeriodEnd: boolean; endedAtIso: string | null }) => {
        state.row = {
          ...state.row,
          subscriptionStatus: input.status as BusinessOsBillingAccount['subscriptionStatus'],
          cancelAtPeriodEnd: input.cancelAtPeriodEnd,
          endedAt: input.endedAtIso,
        };
        return { data: { mirrored: true }, error: null };
      },
    },
    billingEvents: {
      // Unique on the Stripe event id, as the table is.
      recordEvent: async (input: BusinessOsBillingEventInput) => {
        if (endRows.some((row) => row.stripeEventId === input.stripeEventId)) return { data: { outcome: 'duplicate' }, error: null };
        endRows.push(input);
        return { data: { outcome: 'recorded', eventRowId: '44444444-4444-4444-8444-000000000001' }, error: null };
      },
    },
    recordPlanChange: async (input: RecordPlanChangeInput) => {
      planChanges.push(input);
      if (planChangeThrows) {
        planChangeThrows = false;
        throw new Error('plan change step failed');
      }
    },
  } as unknown as PlanBillingHandlerDeps;
  const handler = createPlanBillingHandler(handlerDeps);

  // The claim table: the event's earlier webhook attempt failed.
  const claims = new Map<string, PlanClaimStatus>([[event.id, 'failed']]);
  const deps: PlanReconcileDeps = {
    eventTypes: ['customer.subscription.deleted'],
    verifiedShapes: { [event.api_version as string]: ['customer.subscription.deleted'] },
    staleClaimAgeMs: 15 * 60 * 1000,
    keyLivemode: () => false,
    stripe: () => ({
      listBusinessOsPlanEvents: async () => ({ items: [event], complete: true }),
      listBusinessOsSubscriptionsByPrice: async () => ({ items: [], complete: true }),
    }),
    claims: {
      findClaim: async (id) => ({ data: claims.has(id) ? { event_id: id, status: claims.get(id) as PlanClaimStatus } : null, error: null }),
      insertClaim: async () => ({ error: { code: '23505' } }),
      reclaimStale: async () => ({ data: { won: false }, error: null }),
      reclaimFailedIfStillFailed: async (id) => {
        if (claims.get(id) !== 'failed') return { data: { won: false }, error: null };
        claims.set(id, 'processing');
        return { data: { won: true }, error: null };
      },
      complete: async (id) => {
        claims.set(id, 'completed');
        return { error: null };
      },
      markFailed: async (id) => {
        claims.set(id, 'failed');
        return { error: null };
      },
    },
    dispatch: async () => ({ kind: 'plan' }),
    handle: (replayed) => handler(replayed, log),
    recentRuns: async () => ({ data: [], error: null }),
    billingRows: async () => ({ data: [], error: null }),
    planFacts: async () => ({ data: {}, error: null }),
    recordedPayments: async () => ({ data: { eventIds: [], invoiceIds: [] }, error: null }),
    planPrices: async () => new Map(),
    clock: () => NOW,
  };
  const pass = createPlanReconcilePass(deps);
  const context: ReconcilePassContext = {
    deadlineAt: NOW + 45_000,
    now: new Date(NOW),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    trigger: 'nightly',
  };
  return { event, state, endRows, planChanges, claims, run: () => pass.run(context) };
}

describe('D3.1 replay safety: one .deleted event replayed twice (SA ruling 12)', () => {
  it('a failed .deleted replayed by two nightly runs: one end row and one plan change', async () => {
    const h = harness();
    const first = await h.run();
    const second = await h.run();
    expect(first.replayed).toBe(1);
    expect(second.replayed).toBe(0);
    expect(h.endRows).toHaveLength(1);
    expect(h.endRows[0]).toMatchObject({ kind: 'subscription_ended', stripeEventId: h.event.id, accountId: ACCOUNT });
    expect(h.planChanges.map((c) => c.action)).toEqual(['BOS_BILLING_SUBSCRIPTION_ENDED']);
    expect(h.claims.get(h.event.id)).toBe('completed');
    expect(h.state.row.endedAt).toBe(new Date(ENDED_AT * 1000).toISOString());
  });

  it('a partial failure (end row written, then the plan-change step throws): the retry sees a duplicate, no second row, no second change', async () => {
    const h = harness({ planChangeThrowsOnce: true });
    const first = await h.run();
    expect(first).toMatchObject({ replayed: 0, replayFailed: 1 });
    expect(h.claims.get(h.event.id)).toBe('failed');

    const second = await h.run();
    expect(second).toMatchObject({ replayed: 1, replayFailed: 0 });
    expect(h.endRows).toHaveLength(1);
    expect(h.planChanges).toHaveLength(1);
    expect(h.claims.get(h.event.id)).toBe('completed');

    // A third run finds it completed and replays nothing.
    expect((await h.run()).replayed).toBe(0);
    expect(h.endRows).toHaveLength(1);
  });
});
