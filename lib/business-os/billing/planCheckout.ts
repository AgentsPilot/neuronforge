/**
 * Start a Business OS plan checkout (plan payments P-3a, workplan §3.3; SA
 * rulings Q-1 to Q-12 and conditions C-1 to C-4; hardened by P-4.1: M-1, M-3,
 * BQ-P10, SA W-1 to W-4 and W-10).
 *
 * Orchestration over injected ports, so every branch is tested with fakes. It
 * opens an EMBEDDED Stripe subscription checkout and records it as the
 * account's checkout lock. It assigns NO plan: P-3b does that from the webhook.
 *
 * The order is the contract (C-4, as worded by SA for P-4.1, Q-2 / W-10):
 * "Every database read precedes any Stripe call. Every refusal decided from
 * our own data (switches, key mode, hold, plan row, BQ-P10, `availableToBuy`,
 * a live subscription on our record) precedes any Stripe call. The only Stripe
 * calls before the price check are the M-3 retrieve and expire of the session
 * id stored on the account's own billing row, made only while that lock is
 * unexpired."
 *
 *   4  price switch off            → refuse: never sell what the webhook cannot recognise
 *   5  Stripe key mode unknown     → refuse
 *   6  payment hold → eligibility  → refuse when unreadable (fail closed), a held
 *                                    account while a held-payment switch is off
 *                                    (P-5a.2, D5-3), a held friend asking another
 *                                    tier, or a held admin invitee
 *   7  plan row (snapshot)         → refuse when unreadable, or when there is none (Q-4)
 *   8  billing row                 → refuse when unreadable
 *   8a our-data decision, ONCE     → every account: BQ-P10 `free_access_no_end_date`
 *      (SA W-1, W-3)                 (W-3). Held: a live subscription on the record.
 *                                    Not held: `planPurchaseOffer` (M-1): switches,
 *                                    BQ-P10, a live subscription on the record,
 *                                    `availableToBuy` (`price_unavailable`/`tier_not_sold`)
 *   9  the account's own open      → M-3: retrieve the session id stored on OUR row
 *      checkout (M-3)                (never a request value); a customer or mode
 *                                    mismatch → `checkout_open` + alert, nothing
 *                                    expired; `open` → expire it, release the lock by
 *                                    compare-and-set, continue; `expired` → release,
 *                                    continue; `complete` → `checkout_processing`;
 *                                    a Stripe or repository failure → `checkout_open`
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
import { hasOpenEndedFreeAccess } from '@/lib/business-os/entitlements/freeAccess';
import type { FreeAccessResolutionLike } from '@/lib/business-os/entitlements/freeAccess';
import { AWAITING_PAYMENT_PATH, readPaymentHold, type PaymentHold, type PaymentHoldReaders } from '@/lib/business-os/invites/paymentHold';
import { platformOrigin } from '@/lib/utils/origins';
import {
  BusinessOsStripeCustomerError,
  ensureBusinessOsStripeCustomer,
  replaceBusinessOsStripeCustomer,
} from '@/lib/business-os/billing/businessOsStripeCustomer';
import {
  buyableTiers,
  planCheckoutEligibility,
  planPurchaseOffer,
  readHeldPaymentSwitches,
  type HeldPaymentSwitches,
} from '@/lib/business-os/billing/planCheckoutEligibility';
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

/** SR-5 layer 1: does our record's status count as a live subscription? */
export function isLiveSubscriptionStatus(status: BusinessOsSubscriptionStatus | null | undefined): boolean {
  return !!status && LIVE_SUBSCRIPTION_STATUSES.includes(status);
}

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
  | 'held_payment_unavailable'
  | 'plan_unreadable'
  | 'no_plan_row'
  | 'billing_row_unreadable'
  | 'subscription_live'
  | 'checkout_open'
  | 'checkout_processing'
  | 'free_access_no_end_date'
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
  // P-5a.2 (S5-1, D5-3): a held account while a held-payment switch is off.
  held_payment_unavailable: { status: 409, message: 'Payment for your invitation is not open yet.' },
  plan_unreadable: { status: 503, message: 'We could not check your plan right now. Please try again.' },
  no_plan_row: { status: 409, message: 'Your account is not ready for a plan yet.' },
  billing_row_unreadable: { status: 503, message: 'We could not check your billing right now. Please try again.' },
  subscription_live: { status: 409, message: 'You already have a subscription.' },
  checkout_open: { status: 409, message: 'A checkout is already open for your account.' },
  // P-4.1 M-3: the account's own open session reads `complete` at Stripe.
  checkout_processing: { status: 409, message: 'Your payment is being processed.' },
  // P-4.1 BQ-P10: free access an admin has not given an end date.
  free_access_no_end_date: { status: 409, message: 'Your free access has no end date yet, so there is no plan to buy.' },
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
      /** M-3 (SA Q-5): the account's own open session this request expired, if any. */
      replacedSessionId?: string;
    }
  | { ok: false; code: PlanCheckoutRefusalCode; expiresAt?: string };

// ── Ports ───────────────────────────────────────────────────────────────────

/**
 * The facts of an entitlement snapshot this reads. `SnapshotResult` satisfies
 * it. `basis` and `lifecycle.accessEndsAt` feed BQ-P10 (P-4.1).
 */
export interface PlanSnapshotLike {
  unavailable: boolean;
  resolution: ({ anomaly?: string } & FreeAccessResolutionLike) | null;
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
  | 'retrieveCheckoutSessionState'
  | 'findOrCreatePlatformCustomer'
>;

export interface PlanCheckoutDeps {
  holdReaders: PaymentHoldReaders;
  /** Reads the account's entitlement snapshot by ACCOUNT id (the route resolves it). */
  readPlanSnapshot: (accountId: string) => Promise<PlanSnapshotLike>;
  logger: PlanCheckoutLogger;
  repo?: Pick<
    BusinessOsBillingAccountRepository,
    'findByUser' | 'recordCustomer' | 'acquireCheckoutLock' | 'replaceCustomer' | 'releaseCheckoutLock'
  >;
  stripe?: CheckoutStripe;
  prices?: PlanCheckoutPriceResolver;
  pricesEnabled?: () => boolean;
  /**
   * The held-payment switches (P-5a.2, S5-1). Default `readHeldPaymentSwitches`,
   * the same reader the holding screen uses. Read at step 6; it changes the
   * answer for a HELD account only.
   */
  heldPaymentSwitches?: () => HeldPaymentSwitches;
  /**
   * The tiers on sale to a non-held account (P-4.1, M-1). Default
   * `buyableTiers()`: a Stripe price AND `presentation.availableToBuy`.
   */
  buyableTiers?: () => readonly TierId[];
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
  // The held branch delegates to the shared predicate `heldPaymentOffer`
  // (P5-C5); `held_payment_unavailable` is a warn with no alert (S5-1).
  const switches = (deps.heldPaymentSwitches ?? readHeldPaymentSwitches)();
  const eligibility = planCheckoutEligibility(hold, switches);
  if (!eligibility.ok) return refuse(eligibility.code, eligibility.code === 'hold_unreadable' ? 'error' : 'warn');
  // The held path decides its tier here, unchanged (P-5a.2). A non-held
  // account's tiers are decided at 8a, after every read (SA W-1).
  if (eligibility.held && !eligibility.tiers.includes(tier)) return refuse('held_tier_not_allowed', 'warn');

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
  const resolution = snapshot.resolution;

  // 8. The billing row, read before any Stripe call (P-2a).
  const repo = deps.repo ?? businessOsBillingAccountRepository;
  const existing = await repo.findByUser(userId, livemode);
  if (existing.error) return refuse('billing_row_unreadable', 'error');
  const row = existing.data;

  // 8a. Every refusal decided from our own data, ONCE, after every database
  // read and before any Stripe call (SA W-1), so a refused request never
  // touches the account's open session (M-3 below). SR-5 layer 1 lives here.
  const openEndedFreeAccess = hasOpenEndedFreeAccess(resolution);
  const subscriptionLive = isLiveSubscriptionStatus(row?.subscriptionStatus);
  const liveContext = { source: 'record', subscriptionStatus: row?.subscriptionStatus };
  if (eligibility.held) {
    // W-3: BQ-P10 applies to every account, held included (fail closed).
    if (openEndedFreeAccess) return refuse('free_access_no_end_date', 'warn');
    if (subscriptionLive) return refuse('subscription_live', 'warn', liveContext);
  } else {
    const offer = planPurchaseOffer({ openEndedFreeAccess, subscriptionLive }, switches, (deps.buyableTiers ?? buyableTiers)());
    if (offer.kind === 'none') {
      switch (offer.reason) {
        case 'switches_off':
          return refuse('checkout_unavailable', 'warn', { reason: 'purchase_switches_off' });
        case 'free_access_no_end_date':
          return refuse('free_access_no_end_date', 'warn');
        case 'paying':
          return refuse('subscription_live', 'warn', liveContext);
        case 'not_on_sale':
          return refuse('price_unavailable', 'error', { reason: 'tier_not_sold' });
      }
    }
    if (!offer.tiers.includes(tier)) return refuse('price_unavailable', 'error', { reason: 'tier_not_sold' });
  }

  const stripe = deps.stripe ?? getStripeService();

  // 9. M-3: the account's own unexpired checkout is replaced, not a 31-minute
  // block. The session id comes ONLY from our own row, read by the session
  // user and the server key's mode (SA W-4 a); never from the request.
  let replacedSessionId: string | undefined;
  const nowAtStart = now();
  if (row?.openCheckoutSessionId && row.openCheckoutExpiresAt && Date.parse(row.openCheckoutExpiresAt) > nowAtStart.getTime()) {
    const openSessionId = row.openCheckoutSessionId;
    const openExpiresAt = row.openCheckoutExpiresAt;

    let state: Awaited<ReturnType<CheckoutStripe['retrieveCheckoutSessionState']>>;
    try {
      state = await stripe.retrieveCheckoutSessionState(openSessionId);
    } catch (err) {
      return refuse('checkout_open', 'warn', { err, step: 'retrieve_open_session', openSessionId }, openExpiresAt);
    }

    // Ownership backstop (tenant-isolation-guard, W-4 c): the session must be
    // our row's customer, in our row's mode. Otherwise nothing is expired.
    if (state.customerId !== row.stripeCustomerId || state.livemode !== row.livemode) {
      return refuse(
        'checkout_open',
        'error',
        {
          reason: 'open_session_ownership_mismatch',
          openSessionId,
          customerMatches: state.customerId === row.stripeCustomerId,
          modeMatches: state.livemode === row.livemode,
        },
        openExpiresAt
      );
    }

    if (state.status === 'complete') {
      // Paid, or being paid: the webhook takes it from here. Never a second one.
      return refuse('checkout_processing', 'warn', { openSessionId });
    }
    if (state.status !== 'open' && state.status !== 'expired') {
      return refuse('checkout_open', 'warn', { reason: 'open_session_status_unknown', openSessionId }, openExpiresAt);
    }

    if (state.status === 'open') {
      try {
        await stripe.expireCheckoutSession(openSessionId);
      } catch (err) {
        // It may still be payable: no new session beside it (SR-5).
        return refuse('checkout_open', 'warn', { err, step: 'expire_open_session', openSessionId }, openExpiresAt);
      }
      replacedSessionId = openSessionId;
    }

    // Compare-and-set on that session id. `released: false` is not a failure
    // (W-4 d): a racing request or the `checkout.session.expired` webhook
    // cleared it first, and step 14's compare-and-set is the arbiter.
    const released = await repo.releaseCheckoutLock({ userId, livemode, sessionId: openSessionId, nowIso: now().toISOString() });
    if (released.error) {
      return refuse('checkout_open', 'error', { step: 'release_open_session_lock', openSessionId }, openExpiresAt);
    }
    log.info(
      {
        event: 'bos_billing_checkout_replaced',
        userId,
        tier,
        replacedSessionId: openSessionId,
        previousStatus: state.status,
        expiredByUs: state.status === 'open',
        lockReleased: released.data?.released ?? false,
      },
      "Plan checkout replaces the account's own open checkout"
    );
  }

  // 10. The price must equal the price we show (SA-P12 b).
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
    {
      event: 'bos_billing_checkout_started',
      userId,
      tier,
      lookupKey: price.lookupKey,
      sessionId: session.sessionId,
      livemode,
      held: eligibility.held,
      customerReplaced: replaced,
      ...(replacedSessionId ? { replacedSessionId } : {}),
    },
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
    ...(replacedSessionId ? { replacedSessionId } : {}),
  };
}
