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
 * | `invoice.payment_failed`                       | `recordFailedPlanInvoice` (SA Q-2, P-6a.2) |
 * | `invoice.payment_action_required` (P-6a.2)     | `recordActionRequiredPlanInvoice`          |
 * | `checkout.session.completed`                   | link the subscription, clear the lock      |
 * | `checkout.session.expired`                     | clear the lock                             |
 * | `customer.subscription.updated` / `.deleted`   | status mirror, read fresh (SA Q-1); on     |
 * |                                                | `.deleted` the ended history + audit (P-6a.2) |
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
 * P-5b.1 (N-2): the production ports include `firstPaymentNotifier`, the
 * champion's "your friend subscribed" email (`lib/business-os/invites/
 * championSubscribedNotification.ts`). This is the only place it is built
 * (SA C-5); boost never reaches it.
 *
 * @module lib/business-os/billing/planBillingHandler
 */

import type Stripe from 'stripe';

import type { Logger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { businessOsBillingAccountRepository } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { businessOsBillingEventRepository } from '@/lib/repositories/BusinessOsBillingEventRepository';
import { businessOsAccountLineageRepository } from '@/lib/repositories/BusinessOsAccountLineageRepository';
import { businessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import { createFirstPaymentNotifier, writeChampionNotificationAudit } from '@/lib/business-os/invites/championSubscribedNotification';
import { buildInviterNotificationDeps } from '@/lib/business-os/invites/inviterNotificationDeps';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { recordPlanChange } from '@/lib/business-os/entitlements/recordPlanChange';
import { planPriceCatalog } from '@/lib/business-os/billing/planPriceCatalog';
import { currentStripeMode, isLiveMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';
import {
  applyPaidPlanInvoice,
  recordActionRequiredPlanInvoice,
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

/**
 * Every event type this handler's `switch` acts on, declared ONCE (plan
 * payments P-8b.2, SA ruling 3). The nightly plan reconcile pass lists exactly
 * these from Stripe and replays them; it keeps no second, hand-written list.
 * A test pins this set to the `case` labels below, both ways.
 */
export const PLAN_HANDLER_EVENT_TYPES = [
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const satisfies readonly Stripe.Event.Type[];

export type PlanHandlerEventType = (typeof PLAN_HANDLER_EVENT_TYPES)[number];

/**
 * The (Stripe API version, event type) pairs whose payload shape this handler
 * has been VERIFIED against (plan payments P-8b.2, SA API-version ruling,
 * option (b); amends D-10 to two exports). The nightly reconcile replays an
 * event only when its own `api_version` is a key here and its type is in that
 * version's set; anything else is skipped and counted, never replayed in an
 * unchecked shape. (`events.list` returns each event as rendered at the
 * account's default version when it was created, which may differ from both
 * the webhook endpoint's version and the SDK pin.)
 *
 * ADDING A VERSION OR A TYPE REQUIRES a captured fixture at that version in
 * `lib/business-os/billing/__tests__/fixtures/stripe/` that passes the C-6
 * field check (`planStripeFields.c6.test.ts`), AND SA review. The ratchet in
 * V-4 ratchet in `__tests__/planStripeFields.c6.test.ts` fails otherwise.
 *
 *   - `2025-10-29.clover`: the SDK pin. All 7 (hand-built fixtures; the
 *     action-required invoice is the same object as the failed one).
 *   - `2025-09-30.clover`: the same major as the pin (monthly releases within a
 *     major are additive), and what production's endpoint delivers. All 7.
 *   - `2026-09-30.endive`: only the types captured at endive from the sandbox.
 *     `checkout.session.expired` has no endive capture, so it is not verified.
 */
export const PLAN_HANDLER_VERIFIED_EVENT_SHAPES: Readonly<Record<string, readonly PlanHandlerEventType[]>> = {
  '2025-10-29.clover': PLAN_HANDLER_EVENT_TYPES,
  '2025-09-30.clover': PLAN_HANDLER_EVENT_TYPES,
  '2026-09-30.endive': [
    'invoice.paid',
    'invoice.payment_failed',
    'invoice.payment_action_required',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    // P-8b.2 V-3: captured read-only from the sandbox on 2026-10-28.
    'checkout.session.completed',
  ],
};

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
      case 'invoice.payment_action_required':
        return recordActionRequiredPlanInvoice(event, log, deps);
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
  // P-5a.1: one read of the lineage source, only after a first payment stamp (SA Q-2).
  lineage: businessOsAccountLineageRepository,
  // P-5b.1 (N-2, SA C-5): the champion's "your friend subscribed" email. Built
  // here and nowhere else. Only the one invite read is handed over (SA N-3).
  firstPaymentNotifier: createFirstPaymentNotifier({
    invites: { findInviterNotificationFactsById: (id) => businessOsInviteRepository.findInviterNotificationFactsById(id) },
    inviterDeps: buildInviterNotificationDeps,
    writeAudit: writeChampionNotificationAudit,
  }),
  stripeMode: currentStripeMode,
  now: () => new Date(),
});
