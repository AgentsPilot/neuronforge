/**
 * TEST MODE ONLY: the Business OS plan test clock (plan payments P-6a.1,
 * workplan BUSINESS_OS_PLAN_PAYMENTS_P6A_WORKPLAN.md §5.8; SA C-5, C-6, C-7).
 *
 * The three actions behind POST /api/admin/business-os/test/plan-test-clock:
 *
 *   attach   put the account on a fresh Stripe test clock: a new clock, a new
 *            Business OS customer on it, and the billing row moved to that
 *            customer with the WHOLE subscription mirror cleared (C-6).
 *   advance  move the account's clock forward (never back, at most 60 days).
 *   status   read-only: the clock's frozen time, the billing row's failure
 *            fields (never the hosted invoice URL), and the lifecycle derived
 *            AT THE CLOCK'S TIME (C-7). A test clock moves only Stripe's time;
 *            the plan row's dates are in the clock's future, so the admin
 *            Tiers page (real time) keeps reading `active`. This is the one
 *            place the demo reads grace, paused and AC-F6.5 from.
 *
 * The account id is the route's, already tenant-checked (tenant-isolation-guard).
 * Every billing read and write is scoped by that id and `livemode = false`.
 * The route has already refused a live-mode key; each action checks the mode
 * again, and the StripeService methods refuse a non-test key a third time.
 *
 * Refusals are returned (`{ ok: false, code }`, the route answers 409);
 * anything unexpected throws (the route answers 500). Logs carry ids only.
 *
 * Entitlements imports (SA C-12, a recorded non-gate): `deriveLifecycle`,
 * `fromPlanRow`, `getEntitlementConfig`, `lifecycleInputs`, all for DISPLAY in
 * the `status` answer. Nothing here refuses anything by plan.
 *
 * @module lib/business-os/billing/planTestClock
 */

import { createLogger } from '@/lib/logger';
import { getStripeService, type StripeService } from '@/lib/stripe/StripeService';
import {
  businessOsBillingAccountRepository,
  type BusinessOsBillingAccountRepository,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import {
  businessOsAccountPlanRepository,
  type BusinessOsAccountPlanRepository,
} from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { currentStripeMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';
import { isPlanSubscriptionLive } from '@/lib/business-os/purge/adminDeletionRefusals';
import { deriveLifecycle, type LifecycleResult } from '@/lib/business-os/entitlements/lifecycle';
import { fromPlanRow } from '@/lib/business-os/entitlements/account';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { lifecycleInputs } from '@/lib/business-os/entitlements/report';

const logger = createLogger({ module: 'BusinessOsPlanTestClock' });

/** How far one advance may move the clock (workplan §5.8). Stripe has its own, shorter, limits. */
export const TEST_CLOCK_MAX_ADVANCE_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanTestClockRefusal =
  /** The server key is a live-mode key: there are no test clocks there. */
  | 'live_mode_refused'
  /** The account's test-mode subscription is still live: cancel it in Stripe first. */
  | 'subscription_live'
  /** An unexpired plan checkout is open for the account. */
  | 'checkout_open'
  /** The account's customer is not on a test clock (or there is no customer). */
  | 'no_test_clock'
  /** The stored customer's `bos_user_id` is another account. */
  | 'foreign_clock'
  /** The clock is still advancing: wait and read the status again. */
  | 'clock_not_ready'
  | 'target_in_past'
  | 'target_too_far'
  /** Stripe refused the advance (for example its own interval limit). */
  | 'advance_refused'
  /** Another request changed the account's customer meanwhile. */
  | 'concurrent_change';

export type PlanTestClockResult<T> = { ok: true; data: T } | { ok: false; code: PlanTestClockRefusal };

export interface PlanTestClockDeps {
  billing?: Pick<BusinessOsBillingAccountRepository, 'findByUser' | 'recordCustomer' | 'attachTestClockCustomer'>;
  plans?: Pick<BusinessOsAccountPlanRepository, 'findEntitlementInputs'>;
  stripe?: Pick<
    StripeService,
    | 'createBusinessOsTestClockCustomer'
    | 'retrieveBusinessOsCustomerClock'
    | 'retrieveBusinessOsTestClock'
    | 'advanceBusinessOsTestClock'
  >;
  mode?: () => StripeMode;
  now?: () => Date;
}

export interface TestClockFacts {
  testClockId: string;
  frozenTime: string;
  status: string;
}

export interface AttachedTestClock extends TestClockFacts {
  customerId: string;
  /** `recorded`: the account had no test-mode billing row. `replaced`: its row moved to this customer. */
  recordPath: 'recorded' | 'replaced';
  previousCustomerId: string | null;
}

export interface TestClockStatus {
  clock: TestClockFacts;
  /** The test-mode billing row, failure fields included. Never the hosted invoice URL. */
  billing: {
    subscriptionStatus: string | null;
    hasSubscription: boolean;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    lastPaidAt: string | null;
    lastPaymentFailedAt: string | null;
    failedAttempts: number;
    hasActionRequiredUrl: boolean;
    endedAt: string | null;
  };
  plan: {
    tier: string | null;
    tierExpiresAt: string | null;
    cohort: string | null;
    cohortExpiresAt: string | null;
    periodAnchor: string | null;
  } | null;
  /** `deriveLifecycle` at the clock's frozen time (C-7). */
  lifecycle: Pick<LifecycleResult, 'state' | 'reason' | 'basis' | 'accessEndsAt' | 'graceEndsAt'>;
}

function resolveDeps(deps: PlanTestClockDeps) {
  return {
    billing: deps.billing ?? businessOsBillingAccountRepository,
    plans: deps.plans ?? businessOsAccountPlanRepository,
    stripe: deps.stripe ?? getStripeService(),
    mode: deps.mode ?? currentStripeMode,
    now: deps.now ?? (() => new Date()),
  };
}

/** A Stripe API refusal (an `invalid_request_error`), as opposed to a network or server failure. */
function isStripeRefusal(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type?: unknown }).type === 'StripeInvalidRequestError'
  );
}

/** Read the account's test-mode row and its customer's clock, refusing anything that is not this account's test clock. */
async function clockOf(
  accountId: string,
  d: ReturnType<typeof resolveDeps>
): Promise<PlanTestClockResult<{ testClockId: string; row: NonNullable<Awaited<ReturnType<BusinessOsBillingAccountRepository['findByUser']>>['data']> }>> {
  const read = await d.billing.findByUser(accountId, false);
  if (read.error) throw read.error;
  if (!read.data) return { ok: false, code: 'no_test_clock' };

  const customer = await d.stripe.retrieveBusinessOsCustomerClock(read.data.stripeCustomerId);
  if (customer.deleted || !customer.testClockId) return { ok: false, code: 'no_test_clock' };
  if (customer.bosUserId !== accountId) {
    logger.warn({ accountId, customerId: read.data.stripeCustomerId }, 'Test clock refused: the customer belongs to another account');
    return { ok: false, code: 'foreign_clock' };
  }
  return { ok: true, data: { testClockId: customer.testClockId, row: read.data } };
}

/** C-6: a fresh clock and customer, and the account's test-mode row moved onto it. */
export async function attachPlanTestClock(
  accountId: string,
  deps: PlanTestClockDeps = {}
): Promise<PlanTestClockResult<AttachedTestClock>> {
  const d = resolveDeps(deps);
  if (d.mode() !== 'test') return { ok: false, code: 'live_mode_refused' };

  const now = d.now();
  const read = await d.billing.findByUser(accountId, false);
  if (read.error) throw read.error;
  const row = read.data;

  if (row) {
    if (isPlanSubscriptionLive({ status: row.subscriptionStatus, stripeSubscriptionId: row.stripeSubscriptionId, endedAt: row.endedAt })) {
      return { ok: false, code: 'subscription_live' };
    }
    if (row.openCheckoutSessionId && row.openCheckoutExpiresAt && Date.parse(row.openCheckoutExpiresAt) > now.getTime()) {
      return { ok: false, code: 'checkout_open' };
    }
  }

  const created = await d.stripe.createBusinessOsTestClockCustomer({
    bosUserId: accountId,
    frozenTimeUnix: Math.floor(now.getTime() / 1000),
  });
  // PF-15: never record a live customer on a test-mode row.
  if (created.livemode) throw new Error('test_clock_customer_mode_mismatch');

  const base = { testClockId: created.testClockId, frozenTime: created.frozenTime, status: 'ready', customerId: created.customerId };

  if (!row) {
    const recorded = await d.billing.recordCustomer({ userId: accountId, livemode: false, stripeCustomerId: created.customerId });
    if (recorded.error || !recorded.data) throw recorded.error ?? new Error('test_clock_customer_not_recorded');
    if (!recorded.data.created) {
      logger.warn({ accountId, testClockId: created.testClockId, customerId: created.customerId }, 'Test clock attach lost a race; the clock and customer are left unused');
      return { ok: false, code: 'concurrent_change' };
    }
    logger.info({ accountId, testClockId: created.testClockId, customerId: created.customerId }, 'Test clock attached (new billing row)');
    return { ok: true, data: { ...base, recordPath: 'recorded', previousCustomerId: null } };
  }

  const replaced = await d.billing.attachTestClockCustomer({
    userId: accountId,
    oldCustomerId: row.stripeCustomerId,
    newCustomerId: created.customerId,
    nowIso: now.toISOString(),
  });
  if (replaced.error || !replaced.data) throw replaced.error ?? new Error('test_clock_customer_not_recorded');
  if (!replaced.data.replaced) {
    logger.warn({ accountId, testClockId: created.testClockId, customerId: created.customerId }, 'Test clock attach lost a race; the clock and customer are left unused');
    return { ok: false, code: 'concurrent_change' };
  }
  logger.info(
    { accountId, testClockId: created.testClockId, customerId: created.customerId, previousCustomerId: row.stripeCustomerId },
    'Test clock attached (billing row moved to the new customer, subscription mirror cleared)'
  );
  return { ok: true, data: { ...base, recordPath: 'replaced', previousCustomerId: row.stripeCustomerId } };
}

/** Move the account's clock forward to `toIso`: never back, at most 60 days from its frozen time. */
export async function advancePlanTestClock(
  accountId: string,
  toIso: string,
  deps: PlanTestClockDeps = {}
): Promise<PlanTestClockResult<TestClockFacts>> {
  const d = resolveDeps(deps);
  if (d.mode() !== 'test') return { ok: false, code: 'live_mode_refused' };

  const found = await clockOf(accountId, d);
  if (!found.ok) return found;

  const clock = await d.stripe.retrieveBusinessOsTestClock(found.data.testClockId);
  if (clock.status !== 'ready') return { ok: false, code: 'clock_not_ready' };

  const target = Date.parse(toIso);
  const frozen = Date.parse(clock.frozenTime);
  if (!(target > frozen)) return { ok: false, code: 'target_in_past' };
  if (target - frozen > TEST_CLOCK_MAX_ADVANCE_DAYS * DAY_MS) return { ok: false, code: 'target_too_far' };

  try {
    const advanced = await d.stripe.advanceBusinessOsTestClock(found.data.testClockId, Math.floor(target / 1000));
    logger.info({ accountId, testClockId: advanced.testClockId, frozenTime: advanced.frozenTime }, 'Test clock advance requested');
    return { ok: true, data: advanced };
  } catch (err) {
    if (isStripeRefusal(err)) {
      const code = (err as { code?: unknown }).code;
      logger.warn({ accountId, testClockId: found.data.testClockId, stripeCode: typeof code === 'string' ? code : null }, 'Stripe refused the test clock advance');
      return { ok: false, code: 'advance_refused' };
    }
    throw err;
  }
}

/** Read-only: the clock, the billing row and the lifecycle AT THE CLOCK'S TIME (C-7). */
export async function planTestClockStatus(
  accountId: string,
  deps: PlanTestClockDeps = {}
): Promise<PlanTestClockResult<TestClockStatus>> {
  const d = resolveDeps(deps);
  if (d.mode() !== 'test') return { ok: false, code: 'live_mode_refused' };

  const found = await clockOf(accountId, d);
  if (!found.ok) return found;
  const { row } = found.data;

  const clock = await d.stripe.retrieveBusinessOsTestClock(found.data.testClockId);
  const inputs = await d.plans.findEntitlementInputs(accountId);
  if (inputs.error || !inputs.data) throw inputs.error ?? new Error('plan_row_unreadable');
  const plan = inputs.data.plan;

  const config = getEntitlementConfig();
  const lifecycle = deriveLifecycle(plan ? fromPlanRow(plan) : null, lifecycleInputs(config), new Date(clock.frozenTime));

  return {
    ok: true,
    data: {
      clock,
      billing: {
        subscriptionStatus: row.subscriptionStatus,
        hasSubscription: row.stripeSubscriptionId !== null,
        currentPeriodEnd: row.currentPeriodEnd,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        lastPaidAt: row.lastPaidAt,
        lastPaymentFailedAt: row.lastPaymentFailedAt,
        failedAttempts: row.failedAttempts,
        // A bearer link to the owner's invoice: only whether one is stored.
        hasActionRequiredUrl: row.actionRequiredInvoiceUrl !== null,
        endedAt: row.endedAt,
      },
      plan: plan
        ? {
            tier: plan.tier,
            tierExpiresAt: plan.tier_expires_at,
            cohort: plan.cohort,
            cohortExpiresAt: plan.cohort_expires_at,
            periodAnchor: plan.period_anchor,
          }
        : null,
      lifecycle: {
        state: lifecycle.state,
        reason: lifecycle.reason,
        basis: lifecycle.basis,
        accessEndsAt: lifecycle.accessEndsAt,
        graceEndsAt: lifecycle.graceEndsAt,
      },
    },
  };
}
