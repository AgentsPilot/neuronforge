/**
 * The Business OS `plan` flow handler for the Stripe webhook (plan payments
 * P-3b.2, workplan §3.1; registered in `app/api/stripe/webhook/route.ts` as
 * `BUSINESS_OS_FLOW_HANDLERS.plan`).
 *
 * The router (`planInvoiceResolver`) has already decided, by PRICE, that the
 * event is a plan event. This module only switches on the event type:
 *
 * | Event                                          | Use case                                   |
 * |------------------------------------------------|--------------------------------------------|
 * | `invoice.paid`                                 | `applyPaidPlanInvoice` (planPaymentApply)  |
 * | `invoice.payment_failed`                       | `recordFailedPlanInvoice` (SA Q-2)         |
 * | `checkout.session.completed`                   | link the subscription, clear the lock      |
 * | `checkout.session.expired`                     | clear the lock                             |
 * | `customer.subscription.updated` / `.deleted`   | status-only mirror, read fresh (SA Q-1)    |
 *
 * PF-15 FIRST, for every event: the event's `livemode` must equal the mode of
 * this server's Stripe key. Test and live billing rows share one database, so
 * an event from the other mode (e.g. a sandbox forwarding to production) is
 * logged at `error` with `alert: true` and NOTHING is written: no account is
 * even looked up. A key whose mode cannot be read throws.
 *
 * CONTRACT WITH THE ROUTE. Returning means "done": the route completes the
 * claim and answers 200 (this includes refusals, which are recorded and
 * alerted). Throwing means "could not tell": the route releases the claim,
 * answers 500, and Stripe retries.
 *
 * All Business OS billing logic lives in `lib/business-os/billing/`; the route
 * holds the one registration line (SA standards, rule 1; CF-5 coordination).
 *
 * @module lib/business-os/billing/planBillingHandler
 */

import type Stripe from 'stripe';

import type { Logger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { businessOsBillingAccountRepository } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { businessOsBillingEventRepository } from '@/lib/repositories/BusinessOsBillingEventRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { recordPlanChange } from '@/lib/business-os/entitlements/recordPlanChange';
import { planPriceCatalog } from '@/lib/business-os/billing/planPriceCatalog';
import { currentStripeMode, isLiveMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';
import {
  applyPaidPlanInvoice,
  recordFailedPlanInvoice,
  type PlanPaymentDeps,
} from '@/lib/business-os/billing/planPaymentApply';
import {
  onPlanCheckoutSessionCompleted,
  onPlanCheckoutSessionExpired,
  type PlanCheckoutSessionDeps,
} from '@/lib/business-os/billing/planCheckoutSessionEvents';
import { mirrorPlanSubscription, type PlanSubscriptionMirrorDeps } from '@/lib/business-os/billing/planSubscriptionMirror';

export type PlanBillingHandlerDeps = PlanPaymentDeps &
  PlanCheckoutSessionDeps &
  PlanSubscriptionMirrorDeps & {
    /** The mode of this server's Stripe key. Throws when it cannot be read. */
    stripeMode: () => StripeMode;
  };

/** The webhook's handler signature (`BUSINESS_OS_FLOW_HANDLERS`). */
export type BusinessOsFlowHandler = (event: Stripe.Event, log: Logger) => Promise<void>;

export function createPlanBillingHandler(deps: PlanBillingHandlerDeps): BusinessOsFlowHandler {
  return async function handlePlanBillingEvent(event, parentLog) {
    const log = parentLog.child({ flow: 'plan', eventType: event.type });

    // PF-15: never act on an event from the other Stripe mode.
    const serverLivemode = isLiveMode(deps.stripeMode());
    if (event.livemode !== serverLivemode) {
      log.error(
        { event: 'bos_billing_mode_mismatch', eventLivemode: event.livemode, serverLivemode, stripeEventId: event.id, alert: true },
        'Business OS plan event from the other Stripe mode; nothing written'
      );
      return;
    }

    switch (event.type) {
      case 'invoice.paid':
        return applyPaidPlanInvoice(event, log, deps);
      case 'invoice.payment_failed':
        return recordFailedPlanInvoice(event, log, deps);
      case 'checkout.session.completed':
        return onPlanCheckoutSessionCompleted(event, log, deps);
      case 'checkout.session.expired':
        return onPlanCheckoutSessionExpired(event, log, deps);
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return mirrorPlanSubscription(event, log, deps);
      default:
        // The router routes only the types above to `plan`. Anything else is
        // code drift: refuse to guess, release, and let the alert be seen.
        log.error({ event: 'bos_billing_plan_event_type_unhandled', stripeEventId: event.id, alert: true }, 'Plan flow received an event type it does not handle');
        throw new Error(`plan_handler_unhandled_event_type:${event.type}`);
    }
  };
}

/** The handler the webhook registers, on the production ports. */
export const handlePlanBillingEvent: BusinessOsFlowHandler = createPlanBillingHandler({
  billingAccounts: businessOsBillingAccountRepository,
  billingEvents: businessOsBillingEventRepository,
  stripe: () => getStripeService(),
  catalog: planPriceCatalog,
  entitlementConfig: () => getEntitlementConfig(),
  recordPlanChange,
  stripeMode: currentStripeMode,
  now: () => new Date(),
});
