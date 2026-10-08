/**
 * The receipt link of a credited boost (credits boost slice 4a; requirement
 * FR-27, T-8; SA C-4, Q-5).
 *
 * The session events carry the payment intent as an id only; the charge and
 * its `receipt_url` are not embedded. So, after a successful credit, ONE
 * `paymentIntents.retrieve(pi, { expand: ['latest_charge'] })`, bounded by
 * REQUEST options `{ timeout: 5000, maxNetworkRetries: 0 }` (per request, so
 * slice 3's checkout client is untouched), plus a hard local bound in case the
 * SDK ever ignores them. Then `recordReceipt` fills the link and the charge id
 * once (it never overwrites).
 *
 * Best effort by contract: crediting is already done when this runs. It NEVER
 * throws and never hangs; every failure is a `warn` and nothing else. A missing
 * receipt is backfilled by slice 4b's reconcile pass.
 *
 * The receipt EMAIL is Stripe's, from `receipt_email` (slice 3), verified on
 * the first live purchase (F-6).
 *
 * @module lib/business-os/boost/boostReceipt
 */

import type { BusinessOsBoostPurchaseRepository } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';

/** Per-request options for the one Stripe read (SA C-4). */
export const BOOST_RECEIPT_REQUEST_OPTIONS = { timeout: 5000, maxNetworkRetries: 0 } as const;

/** A local bound above the request timeout, so a misbehaving client cannot hold the webhook. */
export const BOOST_RECEIPT_HARD_LIMIT_MS = 6000;

/** The one Stripe call, typed structurally so tests need no SDK. */
export interface BoostReceiptStripePort {
  paymentIntents: {
    retrieve(
      id: string,
      params: { expand: string[] },
      options: { timeout: number; maxNetworkRetries: number }
    ): Promise<unknown>;
  };
}

export interface BoostReceiptLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface BoostReceiptDeps {
  /** Null when the Business OS Stripe key is missing (the receipt is then skipped). */
  stripe: () => BoostReceiptStripePort | null;
  /** `true` when the server's Stripe key is live; null when it cannot be told. */
  keyIsLive: () => boolean | null;
  purchases: Pick<BusinessOsBoostPurchaseRepository, 'recordReceipt'>;
}

export type BoostReceiptOutcome =
  | 'recorded'
  | 'already_recorded'
  | 'conflict'
  | 'not_paid'
  | 'not_found'
  | 'skipped_mode'
  | 'skipped_no_client'
  | 'unavailable';

const CHARGE_ID = /^(ch|py)_[A-Za-z0-9_]{1,250}$/;

function chargeFrom(intent: unknown): { id: string; receiptUrl: string } | null {
  const charge = (intent as { latest_charge?: unknown } | null)?.latest_charge;
  if (!charge || typeof charge !== 'object') return null;
  const { id, receipt_url: receiptUrl } = charge as { id?: unknown; receipt_url?: unknown };
  if (typeof id !== 'string' || !CHARGE_ID.test(id)) return null;
  if (typeof receiptUrl !== 'string' || !receiptUrl.startsWith('https://') || receiptUrl.length > 2048) return null;
  return { id, receiptUrl };
}

/** Fill the receipt link of a credited purchase. Never throws, never hangs. */
export async function recordBoostReceipt(
  input: { purchaseId: string; paymentIntentId: string; eventLivemode: boolean },
  deps: BoostReceiptDeps,
  log: BoostReceiptLogger
): Promise<BoostReceiptOutcome> {
  const ids = { purchaseId: input.purchaseId };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const keyIsLive = deps.keyIsLive();
    if (keyIsLive === null || keyIsLive !== input.eventLivemode) {
      // A test key cannot read a live payment (or the reverse), and the row's
      // mode was already checked by the handler: skip quietly.
      log.warn({ ...ids, eventLivemode: input.eventLivemode }, 'bos_boost_receipt_unavailable: Stripe key mode differs from the event');
      return 'skipped_mode';
    }
    const stripe = deps.stripe();
    if (!stripe) {
      log.warn(ids, 'bos_boost_receipt_unavailable: no Business OS Stripe client');
      return 'skipped_no_client';
    }

    const hardLimit = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), BOOST_RECEIPT_HARD_LIMIT_MS);
    });
    const retrieved = await Promise.race([
      stripe.paymentIntents.retrieve(input.paymentIntentId, { expand: ['latest_charge'] }, { ...BOOST_RECEIPT_REQUEST_OPTIONS }),
      hardLimit,
    ]);
    if (retrieved === 'timeout') {
      log.warn({ ...ids, timeoutMs: BOOST_RECEIPT_HARD_LIMIT_MS }, 'bos_boost_receipt_unavailable: the Stripe read did not answer');
      return 'unavailable';
    }

    const charge = chargeFrom(retrieved);
    if (!charge) {
      log.warn(ids, 'bos_boost_receipt_unavailable: the payment has no readable charge or receipt link');
      return 'unavailable';
    }

    const recorded = await deps.purchases.recordReceipt({ purchaseId: input.purchaseId, chargeId: charge.id, receiptUrl: charge.receiptUrl });
    if (recorded.error || !recorded.data) {
      log.warn({ ...ids, errorName: recorded.error?.name ?? null }, 'bos_boost_receipt_unavailable: the receipt could not be stored');
      return 'unavailable';
    }
    const status = recorded.data.status;
    if (status === 'recorded' || status === 'already_recorded') log.info({ ...ids, status }, 'Boost receipt recorded');
    else log.warn({ ...ids, status }, 'bos_boost_receipt_unavailable: the receipt was not stored');
    return status;
  } catch (error) {
    // Facts only: a Stripe error message can echo request values (slice 3 QA3-D2).
    const facts = error as { type?: unknown; code?: unknown; requestId?: unknown; statusCode?: unknown; name?: unknown };
    log.warn(
      {
        ...ids,
        stripe: {
          type: typeof facts?.type === 'string' ? facts.type : null,
          code: typeof facts?.code === 'string' ? facts.code : null,
          requestId: typeof facts?.requestId === 'string' ? facts.requestId : null,
          statusCode: typeof facts?.statusCode === 'number' ? facts.statusCode : null,
        },
        errorName: typeof facts?.name === 'string' ? facts.name : null,
      },
      'bos_boost_receipt_unavailable: the Stripe read failed'
    );
    return 'unavailable';
  } finally {
    if (timer) clearTimeout(timer);
  }
}
