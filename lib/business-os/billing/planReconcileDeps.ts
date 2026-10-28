import 'server-only';

/**
 * Production wiring of the plan reconcile pass (plan payments P-8b.2, workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8B_WORKPLAN.md §4.2). Used by the
 * `bos-billing-reconcile` cron through `reconcilePasses.ts`, the same seam as
 * the boost pass (`lib/business-os/boost/boostReconcileDeps.ts`).
 *
 * Service role by design (durable-queue-drain, tenant-isolation-guard): a cron
 * has no user session. The pass takes no account id from any input. Its reads
 * are cross-account by row (`PlanReconcileReadRepository`, named `…AllAccounts`),
 * its only own writes are claim rows (`ProcessedWebhookEventRepository`), and
 * every business write is the plan handler's, which finds the account from our
 * own billing record (SR-8).
 *
 * WHAT IS REUSED, NOT COPIED (SR-3, SR-4; SA rulings 2 and 3):
 *   - the webhook's own dispatcher (`dispatchBusinessOsEvent`) to classify an
 *     event, so a replay can never reach a flow the webhook would not;
 *   - the webhook's own plan handler (`handlePlanBillingEvent`) and its event
 *     type set (`PLAN_HANDLER_EVENT_TYPES`);
 *   - the webhook's stale-claim age (`STALE_CLAIM_AGE_MS`) and the plan
 *     handler's verified (api_version, type) pairs
 *     (`PLAN_HANDLER_VERIFIED_EVENT_SHAPES`, SA API-version ruling (b)).
 *
 * Everything is loaded LAZILY, on the first run, as in the boost wiring: so
 * importing this module (the cron route does, through the pass list) creates
 * no client and pulls in no handler.
 *
 * @module lib/business-os/billing/planReconcileDeps
 */

import type Stripe from 'stripe';

import { createLogger } from '@/lib/logger';
import type { ReconcilePass, ReconcilePassContext, ReconcilePassCounts } from '@/lib/business-os/billing/reconcilePassRunner';
import { createPlanReconcilePass, type PlanReconcileDeps, type PlanReconcilePlanFacts } from '@/lib/business-os/billing/planReconcilePass';

const logger = createLogger({ module: 'PlanReconcilePass' });

/** Account ids per plan-row read: the plan repository refuses a larger batch. */
const PLAN_FACTS_CHUNK = 100;

function eventLogger(event: Stripe.Event) {
  // The handler and the dispatcher take a full Pino logger (they call `.child`).
  return logger.child({ source: 'plan_reconcile', stripeEventId: event.id, eventType: event.type, livemode: event.livemode });
}

/** Builds the production ports on first use. Exported for the wiring test only. */
export async function buildPlanReconcileDeps(): Promise<PlanReconcileDeps> {
  const [handlerModule, dispatcherModule, claimModule, readModule, planModule, stripeModule, catalogModule, modeModule] =
    await Promise.all([
      import('@/lib/business-os/billing/planBillingHandler'),
      import('@/lib/business-os/billing/webhookDispatcher'),
      import('@/lib/repositories/ProcessedWebhookEventRepository'),
      import('@/lib/repositories/PlanReconcileReadRepository'),
      import('@/lib/repositories/BusinessOsAccountPlanRepository'),
      import('@/lib/stripe/StripeService'),
      import('@/lib/business-os/billing/planPriceCatalog'),
      import('@/lib/business-os/billing/stripeMode'),
    ]);
  const claims = claimModule.processedWebhookEventRepository;
  const reads = readModule.planReconcileReadRepository;

  return {
    eventTypes: handlerModule.PLAN_HANDLER_EVENT_TYPES,
    verifiedShapes: handlerModule.PLAN_HANDLER_VERIFIED_EVENT_SHAPES,
    staleClaimAgeMs: claimModule.STALE_CLAIM_AGE_MS,
    keyLivemode: () => {
      try {
        return modeModule.isLiveMode(modeModule.currentStripeMode());
      } catch {
        return null;
      }
    },
    stripe: () => {
      try {
        return stripeModule.getStripeService();
      } catch {
        return null;
      }
    },
    claims: {
      findClaim: (eventId) => claims.findClaim(eventId),
      insertClaim: (row) => claims.insertClaim(row),
      reclaimStale: (eventId, cutoffIso) => claims.reclaimStale(eventId, cutoffIso),
      reclaimFailedIfStillFailed: (eventId) => claims.reclaimFailedIfStillFailed(eventId),
      complete: (eventId) => claims.complete(eventId),
      markFailed: (eventId, message) => claims.markFailed(eventId, message),
    },
    dispatch: async (event) => {
      const outcome = await dispatcherModule.dispatchBusinessOsEvent(event, { log: eventLogger(event) });
      return outcome.kind === 'flow' && outcome.flow === 'plan' ? { kind: 'plan' } : { kind: 'other' };
    },
    handle: (event) => handlerModule.handlePlanBillingEvent(event, eventLogger(event)),
    recentRuns: (sinceIso) => reads.listRecentReconcileRunsAllJobs(sinceIso),
    billingRows: (livemode) => reads.listPlanSubscriptionRowsAllAccounts(livemode),
    recordedPayments: (livemode, ids) => reads.findRecordedPlanPaymentsAllAccounts(livemode, ids),
    planFacts: async (accountIds) => {
      const facts: Record<string, PlanReconcilePlanFacts> = {};
      for (let i = 0; i < accountIds.length; i += PLAN_FACTS_CHUNK) {
        // READ ONLY, and the one plan-repository method this wiring calls (RC-15 pins it).
        const read = await planModule.businessOsAccountPlanRepository.findEntitlementInputsBatch(accountIds.slice(i, i + PLAN_FACTS_CHUNK));
        if (read.error || read.data === null) return { data: null, error: read.error ?? new Error('plan_rows_unreadable') };
        for (const [accountId, inputs] of Object.entries(read.data)) {
          if (inputs.plan) facts[accountId] = { tier: inputs.plan.tier, tierExpiresAt: inputs.plan.tier_expires_at };
        }
      }
      return { data: facts, error: null };
    },
    planPrices: async () => {
      const known = await catalogModule.planPriceCatalog.load();
      const tiers = new Map<string, string>();
      for (const [priceId, lookupKey] of known.byPriceId) {
        const tier = catalogModule.planTierForLookupKey(lookupKey);
        if (tier !== null) tiers.set(priceId, tier);
      }
      return tiers;
    },
    clock: () => Date.now(),
  };
}

let built: Promise<ReconcilePass> | null = null;

/** The plan pass of `bos-billing-reconcile`. Its ports are built on its first run. */
export const planReconcilePass: ReconcilePass = {
  name: 'plan',
  async run(context: ReconcilePassContext): Promise<ReconcilePassCounts> {
    if (built === null) {
      built = buildPlanReconcileDeps().then(createPlanReconcilePass);
      // A failed load must not be cached: the next run tries again.
      built.catch(() => {
        built = null;
      });
    }
    return (await built).run(context);
  },
};
