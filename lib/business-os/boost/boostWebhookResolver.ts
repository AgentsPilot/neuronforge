/**
 * Boost resolver: is this platform event a Business OS credits boost checkout?
 * (credits boost slice 4a; requirement R-6, HP-3, T-4; SA C-8 a, Q-1, Q-3)
 *
 *   - `checkout.session.*` (the four 4a types), `mode = payment`:
 *       row found → `flow: 'boost'`;
 *       no row but the boost marker → `deny metadata_mismatch` (alerted);
 *       no row, no marker → `not_business_os` (agent-platform packs keep their path).
 *   - `mode = subscription`: `not_business_os` (the plan resolver's).
 *   - `charge.refunded`, `charge.dispute.created` / `.closed` /
 *     `.funds_reinstated` (slice 4b.1): the purchase whose STORED payment
 *     intent is the event's → `flow: 'boost'`; no such purchase, or no payment
 *     intent at all → `not_business_os` (the legacy path, unchanged). No
 *     metadata is read and no deny is raised for charge events: a charge does
 *     not carry the session's metadata (SA Q-2, 4a SA N-1).
 *   - anything else: `not_business_os`.
 *
 * Identity is OUR purchase row (a row the platform created), never metadata:
 * one keyed read by session id, and only on a miss the `client_reference_id`
 * fallback (`findBoostPurchaseForSession`). The marker is checked by the
 * handler against the row (SA Q-3), so a disagreement flags that row.
 *
 * R-6's deliberate extension of the dispatcher's "pure apart from the price
 * catalog" rule: this resolver reads the database (one row, two at most). It
 * lives in `lib/business-os/boost/`, outside `billing/`, so the P-1 guard that
 * keeps billing modules DB-free keeps its meaning.
 *
 * A repository error THROWS: "I could not tell" releases the claim so Stripe
 * retries; it is never a final deny (SA Q-6). Connect events never arrive here:
 * the dispatcher returns `not_business_os` for them before any resolver runs.
 * The outcome never carries an account.
 *
 * @module lib/business-os/boost/boostWebhookResolver
 */

import type Stripe from 'stripe';

import type { BusinessOsResolver, DispatchOutcome } from '@/lib/business-os/billing/webhookDispatcher';
import type { BusinessOsBoostPurchaseRepository } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import {
  findBoostPurchaseForSession,
  isBoostSessionEventType,
  sessionKeysOf,
  type BoostPurchaseLookupPort,
} from '@/lib/business-os/boost/boostWebhookSession';
import { isBoostChargeEventType, paymentIntentOfChargeEvent } from '@/lib/business-os/boost/boostChargeEvents';

/** The reads the resolver makes: by session / reference (4a), by stored payment intent (4b.1). */
export type BoostResolverLookupPort = BoostPurchaseLookupPort & Pick<BusinessOsBoostPurchaseRepository, 'findByPaymentIntentIdForWebhook'>;

const NOT_OURS: DispatchOutcome = { kind: 'not_business_os' };

/** Thrown when the purchase lookup fails: the route releases the claim. */
export class BoostResolverLookupError extends Error {
  constructor(readonly cause: Error) {
    super(`Boost resolver could not read the purchase: ${cause.message}`);
    this.name = 'BoostResolverLookupError';
  }
}

export function createBoostResolver(deps: { purchases: BoostResolverLookupPort }): BusinessOsResolver {
  return {
    flow: 'boost',
    async resolve(event: Stripe.Event): Promise<DispatchOutcome> {
      if (event.account) return NOT_OURS; // Belt and braces: the dispatcher already returned.

      if (isBoostChargeEventType(event.type)) {
        // 4b.1: only OUR stored payment intent identifies the purchase.
        const paymentIntentId = paymentIntentOfChargeEvent(event.data.object);
        if (!paymentIntentId) return NOT_OURS; // Not a PaymentIntent charge: never a boost payment.
        const byIntent = await deps.purchases.findByPaymentIntentIdForWebhook(paymentIntentId);
        if (byIntent.error) throw new BoostResolverLookupError(byIntent.error);
        return byIntent.data ? { kind: 'flow', flow: 'boost', lookupKeys: [] } : NOT_OURS;
      }

      if (!isBoostSessionEventType(event.type)) return NOT_OURS;

      const raw = event.data.object as { mode?: unknown };
      if (raw?.mode !== 'payment') return NOT_OURS; // Subscription sessions are the plan resolver's.

      const keys = sessionKeysOf(raw);
      if (!keys) return NOT_OURS;

      const found = await findBoostPurchaseForSession(keys, deps.purchases);
      if (found.kind === 'error') throw new BoostResolverLookupError(found.error);
      if (found.kind === 'by_session' || found.kind === 'by_reference') {
        return { kind: 'flow', flow: 'boost', lookupKeys: [] };
      }
      if (!found.marked) return NOT_OURS; // An agent-platform pack or a foreign session.

      // The session says it is ours, but no purchase row exists: a tamper signal
      // or a lost reservation. Refused and alerted by the route (deny level error).
      return {
        kind: 'deny',
        reason: 'metadata_mismatch',
        detail: {
          eventType: event.type,
          objectId: keys.id,
          priceIds: [],
          lookupKeysMatched: [],
          metadataKeys: Object.keys(keys.metadata ?? {}).sort(),
          livemode: event.livemode,
          flows: ['boost'],
        },
      };
    },
  };
}
