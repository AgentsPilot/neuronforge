/**
 * Start a Business OS plan checkout (plan payments P-3a, workplan §3.3; SA
 * rulings Q-1 to Q-12 and conditions C-1 to C-4).
 *
 * Orchestration over injected ports, so every branch is tested with fakes. It
 * opens an EMBEDDED Stripe subscription checkout and records it as the
 * account's checkout lock. It assigns NO plan: P-3b does that from the webhook.
 *
 * The order is the contract (C-4): every database read (hold, plan row,
 * billing row) happens BEFORE any Stripe call, and every refusal before the
 * price check makes no Stripe call at all.
 *
 *   4  price switch off            → refuse: never sell what the webhook cannot recognise
 *   5  Stripe key mode unknown     → refuse
 *   6  payment hold → eligibility  → refuse when unreadable (fail closed), a held
 *                                    friend asking another tier, or a held admin invitee
 *   7  plan row (snapshot)         → refuse when unreadable, or when there is none (Q-4)
 *   8  billing row                 → refuse when unreadable
 *   9  layer 1, record             → refuse a live subscription or an unexpired lock
 *   10 price                       → refuse unless it equals the display price (SA-P12 b)
 *   11 customer                    → create or reuse (P-2a contract)
 *   12 layer 1b, Stripe            → refuse a live subscription; page through all of
 *                                    them, fail closed on a partial answer (Q-5, C-2)
 *   13 session                     → embedded, card only, USD, Adaptive Pricing off,
 *                                    expires now + 31 min (C-1)
 *   12/13 a customer Stripe reports missing is replaced ONCE, from whichever call
 *         surfaced it, and the step retried ONCE (C-3)
 *   14 lock, compare-and-set       → lost: the new session is expired, never returned
 *
 * Expected refusals are RESULTS, never throws; an unexpected fault throws and
 * the route answers 500. Refusals are logged, never audited (SA Q-9).
 *
 * `userId`, `accountId` and `email` come from the session (SA Q-11), never from
 * the request body.
 *
 * @module lib/business-os/billing/planCheckout
 */

import { randomUUID } from 'crypto';

import { getStripeService, type StripeService } from '@/lib/stripe/StripeService';
import {
  businessOsBillingAccountRepository,
  type BusinessOsBillingAccountRepository,
  type BusinessOsSubscriptionStatus,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type { TierId } from '@/lib/business-os/entitlements/config/tierMatrix';
import { AWAITING_PAYMENT_PATH, readPaymentHold, type PaymentHold, type PaymentHoldReaders } from '@/lib/business-os/invites/paymentHold';
import { platformOrigin } from '@/lib/utils/origins';
import {
  BusinessOsStripeCustomerError,
  ensureBusinessOsStripeCustomer,
  replaceBusinessOsStripeCustomer,
} from '@/lib/business-os/billing/businessOsStripeCustomer';
import { planCheckoutEligibility } from '@/lib/business-os/billing/planCheckoutEligibility';
import { createPlanCheckoutPriceResolver, type PlanCheckoutPriceResolver } from '@/lib/business-os/billing/planCheckoutPrice';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { currentStripeMode, isLiveMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';

// ── Return surfaces (SA Q-7) ────────────────────────────────────────────────

/** The surfaces a checkout may return to. A free URL is never accepted (open redirect). */
export const PLAN_CHECKOUT_RETURN_SURFACES = ['settings_plan', 'awaiting_payment', 'test_harness'] as const;
export type PlanCheckoutReturnSurface = (typeof PLAN_CHECKOUT_RETURN_SURFACES)[number];

/** Fixed server-side paths, one per surface. */
export const PLAN_CHECKOUT_RETURN_PATHS: Readonly<Record<PlanCheckoutReturnSurface, string>> = {
  settings_plan: '/business-os/settings?section=plan',
  awaiting_payment: AWAITING_PAYMENT_PATH,
  test_harness: '/test-business-os',
};

/** Stripe fills `{CHECKOUT_SESSION_ID}` itself. */
export function planCheckoutReturnUrl(surface: PlanCheckoutReturnSurface, origin: string): string {
  const path = PLAN_CHECKOUT_RETURN_PATHS[surface];
  return `${origin}${path}${path.includes('?') ? '&' : '?'}checkout={CHECKOUT_SESSION_ID}`;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** C-1: Stripe refuses an expiry under 30 minutes measured at its side, so 31. */
export const PLAN_CHECKOUT_SESSION_LIFETIME_SECONDS = 31 * 60;

/**
 * Subscription statuses that count as LIVE for SR-5: a second subscription
 * must not be sold beside one of these. `paused` is included (fail closed: a
 * paused subscription resumes without a new checkout).
 */
export const LIVE_SUBSCRIPTION_STATUSES: readonly BusinessOsSubscriptionStatus[] = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'paused',
];

/** The Stripe idempotency key of one checkout attempt: a fresh UUID per Stripe create. */
export function planCheckoutIdempotencyKey(userId: string, attemptId: string): string {
  return `bos-plan-checkout:${userId}:${attemptId}`;
}

// ── Results ─────────────────────────────────────────────────────────────────

export type PlanCheckoutRefusalCode =
  | 'checkout_unavailable'
  | 'hold_unreadable'
  | 'held_tier_not_allowed'
  | 'held_tier_unresolved'
  | 'plan_unreadable'
  | 'no_plan_row'
  | 'billing_row_unreadable'
  | 'subscription_live'
  | 'checkout_open'
  | 'subscription_check_incomplete'
  | 'price_unavailable'
  | 'price_mismatch'
  | 'email_required'
  | 'billing_record_conflict'
  | 'retry_later'
  | 'stripe_error'
  | 'lock_unavailable'
  | 'checkout_busy';

/** HTTP status and owner-facing message per refusal. Never a Stripe or database message. */
export const PLAN_CHECKOUT_REFUSALS: Readonly<Record<PlanCheckoutRefusalCode, { status: number; message: string }>> = {
  checkout_unavailable: { status: 503, message: 'Checkout is not available right now. Please try again later.' },
  hold_unreadable: { status: 503, message: 'We could not check your account right now. Please try again.' },
  held_tier_not_allowed: { status: 409, message: 'Your invitation is for a different plan.' },
  held_tier_unresolved: { status: 409, message: 'Your invitation cannot be paid for yet.' },
  plan_unreadable: { status: 503, message: 'We could not check your plan right now. Please try again.' },
  no_plan_row: { status: 409, message: 'Your account is not ready for a plan yet.' },
  billing_row_unreadable: { status: 503, message: 'We could not check your billing right now. Please try again.' },
  subscription_live: { status: 409, message: 'You already have a subscription.' },
  checkout_open: { status: 409, message: 'A checkout is already open for your account.' },
  subscription_check_incomplete: { status: 503, message: 'We could not check your subscriptions right now. Please try again.' },
  price_unavailable: { status: 503, message: 'This plan cannot be bought right now. Please try again later.' },
  price_mismatch: { status: 503, message: 'This plan cannot be bought right now. Please try again later.' },
  email_required: { status: 422, message: 'Your account needs an email address before you can pay.' },
  billing_record_conflict: { status: 500, message: 'We could not set up billing for your account. Please contact support.' },
  retry_later: { status: 409, message: 'Please wait a moment and try again.' },
  stripe_error: { status: 502, message: 'The payment provider did not respond. Please try again.' },
  lock_unavailable: { status: 503, message: 'Checkout is not available right now. Please try again.' },
  checkout_busy: { status: 409, message: 'A checkout is already being opened for your account.' },
};

export type PlanCheckoutResult =
  | {
      ok: true;
      sessionId: string;
      clientSecret: string;
      /** Stripe's expiry, which is what the lock holds (C-1). */
      expiresAt: string;
      tier: TierId;
      lookupKey: string;
      livemode: boolean;
      held: boolean;
    }
  | { ok: false; code: PlanCheckoutRefusalCode; expiresAt?: string };

// ── Ports ───────────────────────────────────────────────────────────────────

/** The two facts of an entitlement snapshot this reads. `SnapshotResult` satisfies it. */
export interface PlanSnapshotLike {
  unavailable: boolean;
  resolution: { anomaly?: string } | null;
}

export interface PlanCheckoutLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

type CheckoutStripe = Pick<
  StripeService,
  | 'listPricesByLookupKeys'
  | 'listCustomerSubscriptions'
  | 'createBusinessOsPlanCheckoutSession'
  | 'expireCheckoutSession'
  | 'findOrCreatePlatformCustomer'
>;

export interface PlanCheckoutDeps {
  holdReaders: PaymentHoldReaders;
  /** Reads the account's entitlement snapshot by ACCOUNT id (the route resolves it). */
  readPlanSnapshot: (accountId: string) => Promise<PlanSnapshotLike>;
  logger: PlanCheckoutLogger;
  repo?: Pick<BusinessOsBillingAccountRepository, 'findByUser' | 'recordCustomer' | 'acquireCheckoutLock' | 'replaceCustomer'>;
  stripe?: CheckoutStripe;
  prices?: PlanCheckoutPriceResolver;
  pricesEnabled?: () => boolean;
  mode?: () => StripeMode;
  now?: () => Date;
  attemptId?: () => string;
  origin?: () => string;
}

export interface PlanCheckoutInput {
  userId: string;
  accountId: string;
  /** The session's email. Needed only to create (or replace) the Stripe customer. */
  email: string | null;
  name?: string;
  tier: TierId;
  returnTo: PlanCheckoutReturnSurface;
}

let defaultPriceResolver: PlanCheckoutPriceResolver | null = null;

/** One resolver per server instance, so its 60 s cache is shared by every request. */
function sharedPriceResolver(): PlanCheckoutPriceResolver {
  if (!defaultPriceResolver) {
    defaultPriceResolver = createPlanCheckoutPriceResolver({
      listPricesByLookupKeys: (keys) => getStripeService().listPricesByLookupKeys(keys),
    });
  }
  return defaultPriceResolver;
}

/** Stripe's error for an id it does not know, on the `customer` parameter. */
export function isMissingCustomerError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { code, param } = err as { code?: unknown; param?: unknown };
  return code === 'resource_missing' && param === 'customer';
}

function isIdempotencyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { type?: unknown }).type === 'StripeIdempotencyError';
}

function customerFailureCode(err: unknown): PlanCheckoutRefusalCode {
  if (err instanceof BusinessOsStripeCustomerError) {
    switch (err.reason) {
      case 'invalid_input':
        return 'email_required';
      case 'billing_row_unreadable':
        return 'billing_row_unreadable';
      case 'stripe_mode_mismatch':
        return 'checkout_unavailable';
      case 'billing_row_not_recorded':
        // Carry-forward from the P-2a review: a refused checkout with an alert, never a retry loop.
        return 'billing_record_conflict';
    }
  }
  return isIdempotencyError(err) ? 'retry_later' : 'stripe_error';
}

// ── The orchestration ───────────────────────────────────────────────────────

export async function startPlanCheckout(input: PlanCheckoutInput, deps: PlanCheckoutDeps): Promise<PlanCheckoutResult> {
  const { userId, accountId, email, name, tier, returnTo } = input;
  const log = deps.logger;
  const now = deps.now ?? (() => new Date());

  const refuse = (
    code: PlanCheckoutRefusalCode,
    level: 'warn' | 'error',
    context: Record<string, unknown> = {},
    expiresAt?: string
  ): PlanCheckoutResult => {
    log[level](
      { event: 'bos_billing_checkout_refused', code, userId, tier, ...(level === 'error' ? { alert: true } : {}), ...context },
      'Plan checkout refused'
    );
    return expiresAt ? { ok: false, code, expiresAt } : { ok: false, code };
  };

  // 4. Never take money the webhook cannot recognise.
  if (!(deps.pricesEnabled ?? isPlanPriceRecognitionEnabled)()) {
    return refuse('checkout_unavailable', 'error', { reason: 'bos_billing_checkout_prices_switch_off' });
  }

  // 5. The Stripe mode of the server key decides which billing row is ours.
  let mode: StripeMode;
  try {
    mode = (deps.mode ?? currentStripeMode)();
  } catch {
    return refuse('checkout_unavailable', 'error', { reason: 'stripe_key_mode_unknown' });
  }
  const livemode = isLiveMode(mode);

  // 6. The payment hold decides what may be bought, so it fails CLOSED (SA-P11).
  let hold: PaymentHold;
  try {
    hold = await readPaymentHold(accountId, deps.holdReaders);
  } catch (err) {
    log.error({ err, userId }, 'Payment hold read threw during plan checkout');
    hold = { ok: false };
  }
  const eligibility = planCheckoutEligibility(hold);
  if (!eligibility.ok) return refuse(eligibility.code, eligibility.code === 'hold_unreadable' ? 'error' : 'warn');
  if (!eligibility.tiers.includes(tier)) {
    return eligibility.held ? refuse('held_tier_not_allowed', 'warn') : refuse('price_unavailable', 'error', { reason: 'tier_not_sold' });
  }

  // 7. P-3b applies a payment only to an account with a plan row (Q-4).
  let snapshot: PlanSnapshotLike;
  try {
    snapshot = await deps.readPlanSnapshot(accountId);
  } catch (err) {
    log.error({ err, userId }, 'Plan snapshot read threw during plan checkout');
    snapshot = { unavailable: true, resolution: null };
  }
  if (snapshot.unavailable || !snapshot.resolution) return refuse('plan_unreadable', 'error');
  if (snapshot.resolution.anomaly === 'no_plan_row') return refuse('no_plan_row', 'warn');

  // 8. The billing row, read before any Stripe call (P-2a).
  const repo = deps.repo ?? businessOsBillingAccountRepository;
  const existing = await repo.findByUser(userId, livemode);
  if (existing.error) return refuse('billing_row_unreadable', 'error');
  const row = existing.data;

  // 9. SR-5 / SA-P14 layer 1, from the record. Cheap: no Stripe call.
  if (row?.subscriptionStatus && LIVE_SUBSCRIPTION_STATUSES.includes(row.subscriptionStatus)) {
    return refuse('subscription_live', 'warn', { source: 'record', subscriptionStatus: row.subscriptionStatus });
  }
  const nowAtStart = now();
  if (row?.openCheckoutSessionId && row.openCheckoutExpiresAt && Date.parse(row.openCheckoutExpiresAt) > nowAtStart.getTime()) {
    return refuse('checkout_open', 'warn', { openSessionId: row.openCheckoutSessionId }, row.openCheckoutExpiresAt);
  }

  // 10. The price must equal the price we show (SA-P12 b).
  const stripe = deps.stripe ?? getStripeService();
  const prices =
    deps.prices ??
    (deps.stripe
      ? createPlanCheckoutPriceResolver({ listPricesByLookupKeys: (keys) => stripe.listPricesByLookupKeys(keys) })
      : sharedPriceResolver());
  const price = await prices.resolve(tier, livemode, log);
  if (!price.ok) return refuse(price.code, 'error', { lookupKey: price.lookupKey });

  // 11. The Business OS customer: the stored one, or a new one (P-2a contract).
  let customerId: string;
  if (row) {
    customerId = row.stripeCustomerId;
  } else {
    if (!email) return refuse('email_required', 'warn');
    try {
      customerId = (await ensureBusinessOsStripeCustomer({ userId, email, name }, { repo, stripe, mode: () => mode })).customerId;
    } catch (err) {
      const code = customerFailureCode(err);
      return refuse(code, code === 'retry_later' ? 'warn' : 'error', { err, step: 'customer' });
    }
  }

  // 12 + 13, with at most one customer replacement and one retry (C-3).
  const returnUrl = planCheckoutReturnUrl(returnTo, (deps.origin ?? platformOrigin)());
  let replaced = false;
  let session: { sessionId: string; clientSecret: string; expiresAt: number; livemode: boolean } | null = null;

  for (let attempt = 0; attempt < 2 && !session; attempt += 1) {
    try {
      // 12. Layer 1b: Stripe's own answer, every subscription of the customer (C-2).
      const subscriptions = await stripe.listCustomerSubscriptions(customerId);
      const live = subscriptions.subscriptions.find((subscription) =>
        (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(subscription.status)
      );
      if (live) {
        return refuse('subscription_live', 'warn', { source: 'stripe', subscriptionId: live.id, subscriptionStatus: live.status });
      }
      if (!subscriptions.complete) {
        return refuse('subscription_check_incomplete', 'error', { customerId, seen: subscriptions.subscriptions.length });
      }

      // 13. The session. A fresh attempt id per create, so a retry never replays.
      const nowSeconds = Math.floor(now().getTime() / 1000);
      session = await stripe.createBusinessOsPlanCheckoutSession({
        customerId,
        priceId: price.priceId,
        bosUserId: userId,
        returnUrl,
        expiresAt: nowSeconds + PLAN_CHECKOUT_SESSION_LIFETIME_SECONDS,
        idempotencyKey: planCheckoutIdempotencyKey(userId, (deps.attemptId ?? randomUUID)()),
      });
    } catch (err) {
      if (isMissingCustomerError(err) && !replaced) {
        replaced = true;
        if (!email) return refuse('email_required', 'warn', { step: 'customer_replacement' });
        try {
          customerId = (
            await replaceBusinessOsStripeCustomer({ userId, email, name, oldCustomerId: customerId }, { repo, stripe, mode: () => mode, now })
          ).customerId;
        } catch (replaceErr) {
          const code = customerFailureCode(replaceErr);
          return refuse(code, code === 'retry_later' ? 'warn' : 'error', { err: replaceErr, step: 'customer_replacement' });
        }
        continue;
      }
      return refuse(isIdempotencyError(err) ? 'retry_later' : 'stripe_error', 'error', { err, step: 'session', customerId });
    }
  }
  if (!session) return refuse('stripe_error', 'error', { step: 'session', reason: 'no_session_after_retry' });

  const expiresAtIso = new Date(session.expiresAt * 1000).toISOString();
  const expireLoser = async (reason: string) => {
    try {
      await stripe.expireCheckoutSession(session!.sessionId);
    } catch (err) {
      // Its client secret is never returned, and it expires on its own anyway.
      log.warn({ err, userId, sessionId: session!.sessionId, reason }, 'Could not expire an unreturned plan checkout session');
    }
  };

  if (session.livemode !== livemode) {
    await expireLoser('mode_mismatch');
    return refuse('checkout_unavailable', 'error', { reason: 'session_mode_mismatch', sessionId: session.sessionId });
  }

  // 14. The lock, by compare-and-set. Lost or unwritten: the session is never returned.
  const lock = await repo.acquireCheckoutLock({
    userId,
    livemode,
    stripeCustomerId: customerId,
    sessionId: session.sessionId,
    expiresAtIso,
    nowIso: now().toISOString(),
  });
  if (lock.error || !lock.data) {
    await expireLoser('lock_not_written');
    return refuse('lock_unavailable', 'error', { sessionId: session.sessionId });
  }
  if (!lock.data.acquired) {
    await expireLoser('lock_lost');
    log.warn({ event: 'bos_billing_checkout_lock_lost', userId, sessionId: session.sessionId }, 'Plan checkout lost the lock race');
    return refuse('checkout_busy', 'warn', { sessionId: session.sessionId });
  }

  log.info(
    { event: 'bos_billing_checkout_started', userId, tier, lookupKey: price.lookupKey, sessionId: session.sessionId, livemode, held: eligibility.held, customerReplaced: replaced },
    'Plan checkout started'
  );
  return {
    ok: true,
    sessionId: session.sessionId,
    clientSecret: session.clientSecret,
    expiresAt: expiresAtIso,
    tier,
    lookupKey: price.lookupKey,
    livemode,
    held: eligibility.held,
  };
}
