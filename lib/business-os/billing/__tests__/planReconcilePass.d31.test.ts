/**
 * D3.1 replay safety (plan payments P-8b.2; SA ruling 12): "replaying one
 * `.deleted` event twice produces one end row and one cohort change".
 *
 * The pass never replays a `completed` claim, but it CAN replay a `failed`
 * `customer.subscription.deleted` days later. Here the REAL plan handler, the
 * REAL subscription mirror and the REAL after-plan move
 * (`moveToFreeCohortAfterPlan`, D3.1 / SX-2b, PR #556) run behind the pass, on
 * in-memory ports. The plan store is stateful: a move's write lands on the row
 * the next read returns, as the plan table does (the same store as D's own
 * "replay (P-8b reconcile)" tests in `planSubscriptionMirror.test.ts` and
 * `afterPlanMove.test.ts`).
 *
 *   - a failed `.deleted` replayed by two nightly runs: one end row and ONE
 *     free-cohort move (one write, one `BOS_PLAN_FREE_PERIOD_AFTER_CANCEL`);
 *   - a partial failure (the end row is written, then the move's write fails,
 *     so the claim is marked failed): the next run's replay sees the end row as
 *     a duplicate, writes no second row, and makes the move exactly once; a
 *     third run changes nothing.
 *
 * SA ruling 12's condition on SX-2b is met by D3.1: the move is a target-state
 * compare-and-set guarded by "the row's last move came from this subscription",
 * and it runs outside the "end row is new" branch, so a replay re-runs it.
 */

import fs from 'fs';
import path from 'path';
import type Stripe from 'stripe';

import {
  AFTER_PLAN_MOVE_AUDIT_ACTION,
  moveToFreeCohortAfterPlan,
  type AfterPlanMoveDeps,
  type AfterPlanMoveRead,
  type AfterPlanMoveWrite,
} from '@/lib/business-os/billing/afterPlanMove';
import { createPlanBillingHandler, type PlanBillingHandlerDeps } from '@/lib/business-os/billing/planBillingHandler';
import { createPlanReconcilePass, type PlanClaimStatus, type PlanReconcileDeps } from '@/lib/business-os/billing/planReconcilePass';
import type { ReconcilePassContext } from '@/lib/business-os/billing/reconcilePassRunner';
import { AFTER_PLAN } from '@/lib/business-os/entitlements/config/afterPlan';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import type { RecordPlanChangeInput } from '@/lib/business-os/entitlements/recordPlanChange';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { Logger } from '@/lib/logger';
import type { BusinessOsBillingAccount } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type { BusinessOsBillingEventInput } from '@/lib/repositories/BusinessOsBillingEventRepository';

const NOW = Date.parse('2026-10-28T05:41:00.000Z');
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const SUB = 'sub_D31';
/** As D's mirror tests: a test-clock end after the real-time `NOW`. */
const ENDED_AT = 1_801_211_893;
const ENDED_ISO = new Date(ENDED_AT * 1000).toISOString();

function deletedEvent(): Stripe.Event {
  const file = path.join(__dirname, 'fixtures', 'stripe', 'customer-subscription-deleted.json');
  const event = JSON.parse(fs.readFileSync(file, 'utf8')) as Stripe.Event;
  const subscription = event.data.object as Stripe.Subscription;
  subscription.id = SUB;
  // An owner-started end: the one reason that gives the free period (BQ-20).
  subscription.cancellation_details = { comment: null, feedback: null, reason: 'cancellation_requested' };
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
    boughtTier: TIER_ORDER[TIER_ORDER.length - 1],
    currentPeriodEnd: ENDED_ISO,
    cancelAtPeriodEnd: true,
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

function harness(options: { moveWriteFailsOnce?: boolean } = {}) {
  const event = deletedEvent();
  const state = { row: billingRow() };
  const endRows: BusinessOsBillingEventInput[] = [];
  const mirrorAudits: RecordPlanChangeInput[] = [];
  const moveAudits: RecordPlanChangeInput[] = [];
  const moveWrites: AfterPlanMoveWrite[] = [];
  let moveWriteFails = options.moveWriteFailsOnce ?? false;

  // The plan table, stateful: a move's write lands on the row the next read returns.
  const store: AfterPlanMoveRead = {
    plan: {
      user_id: ACCOUNT,
      tier: TIER_ORDER[TIER_ORDER.length - 1],
      plan_version: 0,
      tier_expires_at: ENDED_ISO,
      cohort: AFTER_PLAN.cohort,
      cohort_expires_at: null,
      onboarding_started_at: '2026-01-01T00:00:00.000Z',
      profile_created_at: null,
      trial_started_at: null,
      trial_ends_at: null,
      grace_ends_at: null,
      period_anchor: '2026-10-01T00:00:00+00:00',
      origin: 'admin',
      updated_by_admin_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.123456+00:00',
    },
    moves: 0,
    lastSubscriptionId: null,
  };
  const moveDeps: AfterPlanMoveDeps = {
    readMoveInputs: async () => ({ data: { plan: { ...store.plan }, moves: store.moves, lastSubscriptionId: store.lastSubscriptionId }, error: null }),
    writeMove: async (input) => {
      moveWrites.push(input);
      if (moveWriteFails) {
        moveWriteFails = false;
        return { data: null, error: new Error('plan write failed') };
      }
      if (input.expected.updatedAt !== store.plan.updated_at || input.expected.moves !== store.moves) return { data: { outcome: 'stale' }, error: null };
      store.plan = {
        ...store.plan,
        cohort: input.cohort,
        trial_started_at: input.trialStartedAt,
        trial_ends_at: input.trialEndsAt,
        grace_ends_at: input.clearGraceEndsAt ? null : store.plan.grace_ends_at,
        period_anchor: input.periodAnchor,
        updated_at: `2026-10-28T05:41:00.${String(store.moves + 1).padStart(6, '0')}+00:00`,
      };
      store.moves += 1;
      store.lastSubscriptionId = input.subscriptionId;
      return { data: { outcome: 'applied', moves: store.moves }, error: null };
    },
    config: () => getEntitlementConfig(),
    recordPlanChange: async (input) => {
      moveAudits.push(input);
    },
    now: () => new Date(NOW),
  };

  const quiet: Record<string, unknown> = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
  quiet.child = () => quiet;
  const log = quiet as unknown as Logger;

  // The real handler, with only the ports a `.deleted` event reaches, and the REAL after-plan move.
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
      mirrorAudits.push(input);
    },
    afterPlanMove: (input: Parameters<typeof moveToFreeCohortAfterPlan>[0], moveLog: Logger) => moveToFreeCohortAfterPlan(input, moveLog, moveDeps),
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
  return { event, state, store, endRows, mirrorAudits, moveAudits, moveWrites, claims, run: () => pass.run(context) };
}

describe('D3.1 replay safety: one .deleted event replayed twice (SA ruling 12)', () => {
  it('a failed .deleted replayed by two nightly runs: one end row and one free-cohort move', async () => {
    const h = harness();
    const first = await h.run();
    const afterFirst = JSON.parse(JSON.stringify(h.store)) as AfterPlanMoveRead;
    const second = await h.run();
    expect(first.replayed).toBe(1);
    expect(second.replayed).toBe(0);

    expect(h.endRows).toHaveLength(1);
    expect(h.endRows[0]).toMatchObject({ kind: 'subscription_ended', stripeEventId: h.event.id, accountId: ACCOUNT });
    expect(h.mirrorAudits.map((c) => c.action)).toEqual(['BOS_BILLING_SUBSCRIPTION_ENDED']);

    // The move: one write, one audit, the row moved and stamped with this subscription.
    expect(h.moveWrites).toHaveLength(1);
    expect(h.moveAudits.map((c) => c.action)).toEqual([AFTER_PLAN_MOVE_AUDIT_ACTION]);
    expect(h.store.moves).toBe(1);
    expect(h.store.lastSubscriptionId).toBe(SUB);
    expect(h.store).toEqual(afterFirst);

    expect(h.claims.get(h.event.id)).toBe('completed');
    expect(h.state.row.endedAt).toBe(ENDED_ISO);
  });

  it('a partial failure (end row written, then the move write fails): the retry sees a duplicate, no second row, the move exactly once', async () => {
    const h = harness({ moveWriteFailsOnce: true });
    const first = await h.run();
    expect(first).toMatchObject({ replayed: 0, replayFailed: 1 });
    expect(h.claims.get(h.event.id)).toBe('failed');
    expect(h.endRows).toHaveLength(1);
    expect(h.store.moves).toBe(0);

    const second = await h.run();
    expect(second).toMatchObject({ replayed: 1, replayFailed: 0 });
    expect(h.endRows).toHaveLength(1);
    // The end audit is written only with a NEW end row, so once.
    expect(h.mirrorAudits).toHaveLength(1);
    // One failed write attempt, then the one that landed.
    expect(h.moveWrites).toHaveLength(2);
    expect(h.store.moves).toBe(1);
    expect(h.moveAudits.map((c) => c.action)).toEqual([AFTER_PLAN_MOVE_AUDIT_ACTION]);
    expect(h.claims.get(h.event.id)).toBe('completed');

    // A third run finds it completed and replays nothing.
    const afterSecond = JSON.parse(JSON.stringify(h.store)) as AfterPlanMoveRead;
    expect((await h.run()).replayed).toBe(0);
    expect(h.endRows).toHaveLength(1);
    expect(h.moveWrites).toHaveLength(2);
    expect(h.store).toEqual(afterSecond);
  });

  it('the move is idempotent on its own: forcing the claim back to failed and replaying again moves nothing more', async () => {
    const h = harness();
    await h.run();
    h.claims.set(h.event.id, 'failed');
    expect((await h.run()).replayed).toBe(1);
    expect(h.endRows).toHaveLength(1);
    expect(h.moveWrites).toHaveLength(1);
    expect(h.store.moves).toBe(1);
    expect(h.moveAudits).toHaveLength(1);
  });
});
