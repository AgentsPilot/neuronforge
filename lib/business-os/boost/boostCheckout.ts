/**
 * Starting a boost purchase (credits boost slice 3, workplan §3.2; FR-8 to
 * FR-12, FR-20 to FR-23; SA R-1, R-9, R-10, T-4, C-2, C-3; slice 1 QA E-2;
 * slice 2 §3.4b).
 *
 * Pure orchestration over injected dependencies (the `creditAdminOps.ts`
 * pattern), so every branch is tested without HTTP, a database or Stripe. The
 * route (`app/api/business-os/credits/boost/checkout`) only parses, checks the
 * session and the flag, and maps the outcome.
 *
 * ── The steps, in order ────────────────────────────────────────────────────
 *   1. payment hold, FAIL CLOSED (R-1): an account awaiting payment cannot buy;
 *      an unreadable hold refuses too;
 *   2. the package from the catalogue: ANY rejection of the source refuses
 *      (QA E-2), not only `BoostCatalogueInvalidError`;
 *   3. the Stripe mode from the server key (R-10);
 *   4. reserve under the cap (FR-20, FR-23): the purchase row IS the reservation;
 *   5. create the Stripe session and cross-check what came back;
 *   6. attach the session to the reservation, right after creating it (§3.4b);
 *   7. hand back the client secret.
 *
 * ── Never leave a payable session without its row (SA C-2) ─────────────────
 * After a failure, a session that was created is EXPIRED first (one retry).
 * The reservation is abandoned only when no session exists or the expiry
 * succeeded. If the session cannot be expired, the row is left `pending` and an
 * `error` with `alert: true` (`bos_boost_orphan_session`) names both ids: if
 * that session is then paid, 4a reaches the row and 2b's `credit` flags it, so
 * the money is visible and refundable — never silently uncredited.
 * Clean-up never changes the answer, and never throws.
 *
 * ── An unknown create is not a failed create (SA CR-1) ──────────────────────
 * Only a definite Stripe rejection (invalid request, auth, permission, rate
 * limit, card) proves no session exists. A timeout, a connection error or a 5xx
 * is retried once with the SAME idempotency key; a session that comes back is
 * expired, then the reservation abandoned. If the retry fails too — even with a
 * definite rejection, because the FIRST attempt may still have created a
 * session — the row is left `pending` and `bos_boost_session_unknown` alerts.
 *
 * ── Logs (QA3-D2) ───────────────────────────────────────────────────────────
 * A Stripe error is logged as `stripeErrorFacts` only (type, code, param,
 * request id, status): its message can echo the buyer's email.
 *
 * The account id and email are the SESSION's, passed in by the route; nothing
 * here reads a request.
 *
 * @module lib/business-os/boost/boostCheckout
 */

import type Stripe from 'stripe';

import type { StripeMode } from '@/lib/business-os/billing/stripeMode';
import type { BoostPackage, BoostPackageSource } from '@/lib/business-os/entitlements/boostCatalogue';
import type { BoostPurchaseCap } from '@/lib/business-os/entitlements/config/boostPackages';
import { readPaymentHold, type PaymentHold, type PaymentHoldReaders } from '@/lib/business-os/invites/paymentHold';
import type { BusinessOsBoostPurchaseRepository } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';

import {
  BOOST_CHECKOUT_TTL_SECONDS,
  buildBoostCheckoutSessionParams,
  createBoostCheckoutSession,
  expireBoostCheckoutSession,
  type BoostStripeClient,
} from './boostCheckoutSession';

export type BoostCheckoutRefusal =
  | 'payment_hold_check_failed'
  | 'awaiting_payment'
  | 'catalogue_unavailable'
  | 'unknown_package'
  | 'payments_unavailable'
  | 'not_eligible'
  | 'cap_reached'
  | 'reservation_failed'
  | 'checkout_unavailable';

/** The HTTP status of each refusal, for the route. */
export const BOOST_CHECKOUT_REFUSAL_STATUS: Readonly<Record<BoostCheckoutRefusal, number>> = {
  payment_hold_check_failed: 500,
  awaiting_payment: 409,
  catalogue_unavailable: 503,
  unknown_package: 404,
  payments_unavailable: 500,
  not_eligible: 403,
  cap_reached: 409,
  reservation_failed: 500,
  checkout_unavailable: 502,
};

export type BoostCheckoutOutcome =
  | {
      ok: true;
      purchaseId: string;
      clientSecret: string;
      expiresAt: string;
      packageId: string;
      packageVersion: number;
      priceMinor: number;
      currency: 'USD';
      livemode: boolean;
    }
  | { ok: false; error: BoostCheckoutRefusal };

export interface BoostCheckoutLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface BoostCheckoutDeps {
  holdReaders: PaymentHoldReaders;
  packageSource: BoostPackageSource;
  cap: BoostPurchaseCap;
  repo: Pick<BusinessOsBoostPurchaseRepository, 'reserve' | 'attachCheckout' | 'abandon'>;
  /** Lazy: a missing key throws, and that is `payments_unavailable`. */
  stripe: () => BoostStripeClient;
  /** Throws on an unknown key (fail closed). */
  mode: () => StripeMode;
  now: () => Date;
}

export interface BoostCheckoutInput {
  accountId: string;
  email: string | null;
  packageId: string;
  returnUrl: string;
}

const refuse = (error: BoostCheckoutRefusal): BoostCheckoutOutcome => ({ ok: false, error });

/** Start one boost purchase. Never throws. */
export async function runBoostCheckout(deps: BoostCheckoutDeps, input: BoostCheckoutInput, log: BoostCheckoutLogger): Promise<BoostCheckoutOutcome> {
  const { accountId } = input;

  // ── 1. Payment hold, fail closed (R-1) ──────────────────────────────────
  let hold: PaymentHold;
  try {
    hold = await readPaymentHold(accountId, deps.holdReaders);
  } catch (error) {
    log.error({ err: error, userId: accountId }, 'bos_boost_checkout_refused: payment hold read threw');
    return refuse('payment_hold_check_failed');
  }
  if (!hold.ok) {
    log.error({ userId: accountId }, 'bos_boost_checkout_refused: payment hold unreadable');
    return refuse('payment_hold_check_failed');
  }
  if (hold.held) {
    log.warn({ userId: accountId, code: 'awaiting_payment' }, 'bos_boost_checkout_refused');
    return refuse('awaiting_payment');
  }

  // ── 2. The package: ANY source rejection refuses (QA E-2) ────────────────
  let pkg: BoostPackage | null;
  try {
    pkg = await deps.packageSource.getActive(input.packageId);
  } catch (error) {
    const issues = (error as { issues?: unknown } | null)?.issues;
    log.error({ err: error, issues, packageId: input.packageId }, 'bos_boost_checkout_refused: catalogue unavailable');
    return refuse('catalogue_unavailable');
  }
  if (pkg === null) {
    log.warn({ userId: accountId, packageId: input.packageId, code: 'unknown_package' }, 'bos_boost_checkout_refused');
    return refuse('unknown_package');
  }

  // ── 3. Stripe mode from the key (R-10) and the client ────────────────────
  let livemode: boolean;
  let stripe: BoostStripeClient;
  try {
    livemode = deps.mode() === 'live';
    stripe = deps.stripe();
  } catch (error) {
    log.error({ errorName: asError(error).name, reason: asError(error).message === 'stripe_key_missing' || asError(error).message === 'stripe_key_mode_unknown' ? asError(error).message : 'other' }, 'bos_boost_checkout_refused: payments unavailable');
    return refuse('payments_unavailable');
  }

  // ── 4. Reserve under the cap (FR-20, FR-23) ──────────────────────────────
  // QA3-D1: the repository never throws by contract; a throw anyway is an { error }.
  const reservation = await deps.repo.reserve({
    accountId,
    livemode,
    packageId: pkg.id,
    packageVersion: pkg.version,
    retailVersion: pkg.retailVersion,
    creditValueVersion: pkg.creditValueVersion,
    priceMinor: pkg.priceMinor,
    currency: pkg.currency,
    creditsBase: pkg.baseCredits,
    creditsBonus: pkg.bonusCredits,
    defaultCapMinor: deps.cap.amountMinor,
    windowDays: deps.cap.windowDays,
    checkoutTtlSeconds: BOOST_CHECKOUT_TTL_SECONDS,
  }).catch((thrown: unknown) => ({ data: null, error: asError(thrown) }));
  if (reservation.error || !reservation.data) {
    // Deterministic (2b N-1 / I-3): never retried here.
    log.error({ err: reservation.error, userId: accountId }, 'bos_boost_checkout_refused: reservation failed');
    return refuse('reservation_failed');
  }
  if (reservation.data.outcome === 'no_plan_row') {
    log.warn({ userId: accountId, code: 'not_eligible' }, 'bos_boost_checkout_refused');
    return refuse('not_eligible');
  }
  if (reservation.data.outcome === 'cap_reached') {
    // Q-7: logged, not audited; the counted amount, never the email.
    log.warn(
      { userId: accountId, code: 'cap_reached', capMinor: reservation.data.capMinor, countedMinor: reservation.data.countedMinor },
      'bos_boost_checkout_refused'
    );
    return refuse('cap_reached');
  }
  const purchaseId = reservation.data.purchaseId;

  // ── 5. The Stripe session, cross-checked ─────────────────────────────────
  let params: Stripe.Checkout.SessionCreateParams;
  try {
    params = buildBoostCheckoutSessionParams({ pkg, purchaseId, email: input.email, returnUrl: input.returnUrl, now: deps.now() });
  } catch (error) {
    // Thrown before any request: Stripe has nothing, so the reservation can go.
    log.error({ errorName: asError(error).name, purchaseId }, 'bos_boost_checkout_refused: session parameters not built');
    await release(deps, stripe, accountId, purchaseId, null, log);
    return refuse('checkout_unavailable');
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await createBoostCheckoutSession(stripe, params, purchaseId);
  } catch (error) {
    if (isDefiniteStripeRejection(error)) {
      // SA CR-1: Stripe answered and created nothing, so the reservation can go.
      log.error({ stripe: stripeErrorFacts(error), purchaseId }, 'bos_boost_checkout_refused: Stripe refused the session');
      await release(deps, stripe, accountId, purchaseId, null, log);
      return refuse('checkout_unavailable');
    }
    // SA CR-1: a timeout, a connection error or a 5xx may have created a session
    // we never saw. Ask again with the SAME idempotency key: Stripe answers the
    // same session if it made one.
    log.warn({ stripe: stripeErrorFacts(error), purchaseId }, 'bos_boost_session_create_indeterminate: retrying with the same idempotency key');
    let retried: Stripe.Checkout.Session;
    try {
      retried = await createBoostCheckoutSession(stripe, params, purchaseId);
    } catch (retryError) {
      // Still unknown: a payable session may exist. Leave the row pending (never
      // abandon it), so 4a can still reach it, and alert.
      log.error({ alert: true, stripe: stripeErrorFacts(retryError), purchaseId }, 'bos_boost_session_unknown');
      return refuse('checkout_unavailable');
    }
    // The session exists, but this request already failed once: close it (C-2
    // rules) rather than hand out a session the caller may never have seen.
    await release(deps, stripe, accountId, purchaseId, retried.id, log);
    return refuse('checkout_unavailable');
  }

  const mismatch =
    session.livemode !== livemode ||
    session.amount_subtotal !== pkg.priceMinor ||
    session.currency !== 'usd' ||
    session.client_reference_id !== purchaseId ||
    typeof session.client_secret !== 'string' ||
    typeof session.expires_at !== 'number';
  if (mismatch) {
    log.error(
      { purchaseId, sessionId: session.id, livemode: session.livemode, amountSubtotal: session.amount_subtotal, currency: session.currency },
      'bos_boost_session_mismatch'
    );
    await release(deps, stripe, accountId, purchaseId, session.id, log);
    return refuse('checkout_unavailable');
  }

  // ── 6. Attach right away (slice 2 §3.4b) ─────────────────────────────────
  const expiresAt = new Date((session.expires_at as number) * 1000).toISOString();
  // QA3-D1: a throw is treated like { error }: release (expire, then abandon per C-2).
  const attach = await deps.repo
    .attachCheckout({ accountId, purchaseId, sessionId: session.id, checkoutExpiresAt: expiresAt })
    .catch((thrown: unknown) => ({ data: null, error: asError(thrown) }));
  const attached = !attach.error && (attach.data?.status === 'attached' || attach.data?.status === 'already_attached');
  if (!attached) {
    log.error(
      { err: attach.error, purchaseId, sessionId: session.id, attachStatus: attach.data?.status ?? null },
      'bos_boost_checkout_refused: session not attached'
    );
    await release(deps, stripe, accountId, purchaseId, session.id, log);
    return refuse('checkout_unavailable');
  }

  // ── 7. Done ───────────────────────────────────────────────────────────────
  log.info({ userId: accountId, purchaseId, packageId: pkg.id, livemode }, 'bos_boost_checkout_started');
  return {
    ok: true,
    purchaseId,
    clientSecret: session.client_secret as string,
    expiresAt,
    packageId: pkg.id,
    packageVersion: pkg.version,
    priceMinor: pkg.priceMinor,
    currency: pkg.currency,
    livemode,
  };
}

/**
 * SA CR-1: errors after which Stripe has definitely created nothing. Anything
 * else (a timeout, a connection error, a 5xx, an idempotency error, an unknown
 * error) is indeterminate. Matched on the error's `type`, which every Stripe
 * error carries, so a plain test double can stand in for the SDK classes.
 */
const DEFINITE_STRIPE_REJECTIONS: ReadonlySet<string> = new Set([
  'StripeInvalidRequestError',
  'StripeAuthenticationError',
  'StripePermissionError',
  'StripeRateLimitError',
  'StripeCardError',
]);

/**
 * QA3-D2: what may be logged about a Stripe error. Its message can echo request
 * values (the customer email, the return URL), so only these fields are kept:
 * never the object, never the message.
 */
export function stripeErrorFacts(error: unknown): Record<string, string | number | null> {
  const source = (error ?? {}) as { type?: unknown; code?: unknown; param?: unknown; requestId?: unknown; statusCode?: unknown };
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    type: text(source.type),
    code: text(source.code),
    param: text(source.param),
    requestId: text(source.requestId),
    statusCode: typeof source.statusCode === 'number' ? source.statusCode : null,
  };
}

function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

export function isDefiniteStripeRejection(error: unknown): boolean {
  const type = (error as { type?: unknown } | null)?.type;
  return typeof type === 'string' && DEFINITE_STRIPE_REJECTIONS.has(type);
}

/**
 * Best-effort clean-up after a failure (SA C-2). Expire the session first (one
 * retry); abandon the reservation only when there is no session or it is
 * expired. Never throws and never changes the caller's answer.
 */
async function release(
  deps: BoostCheckoutDeps,
  stripe: BoostStripeClient,
  accountId: string,
  purchaseId: string,
  sessionId: string | null,
  log: BoostCheckoutLogger
): Promise<void> {
  if (sessionId !== null) {
    let expired = false;
    for (let attempt = 1; attempt <= 2 && !expired; attempt += 1) {
      try {
        await expireBoostCheckoutSession(stripe, sessionId);
        expired = true;
      } catch (error) {
        log.warn({ stripe: stripeErrorFacts(error), purchaseId, sessionId, attempt }, 'bos_boost_session_expire_failed');
      }
    }
    if (!expired) {
      log.error({ alert: true, purchaseId, sessionId }, 'bos_boost_orphan_session');
      return;
    }
  }

  try {
    const result = await deps.repo.abandon({ accountId, purchaseId });
    const status = result.data?.status;
    if (result.error || (status !== 'abandoned' && status !== 'already_abandoned')) {
      log.error({ err: result.error, purchaseId, abandonStatus: status ?? null }, 'bos_boost_abandon_failed');
    }
  } catch (error) {
    log.error({ err: error, purchaseId }, 'bos_boost_abandon_failed');
  }
}
