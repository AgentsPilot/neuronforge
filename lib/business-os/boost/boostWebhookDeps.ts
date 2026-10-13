import 'server-only';

/**
 * Production wiring of the boost webhook resolver and handler (credits boost
 * slice 4a). The resolver is appended to the dispatcher's `DEFAULT_RESOLVERS`;
 * the handler is registered as `BUSINESS_OS_FLOW_HANDLERS.boost` in the Stripe
 * webhook route. Both ship together (SA C-2).
 *
 * The repository is loaded lazily, on the first boost event: the dispatcher is
 * imported by the webhook route at module load, and the repository module
 * creates the service-role client when it is evaluated. Service role by design
 * (R-6): the webhook has no user session, and the account is always the row's.
 *
 * @module lib/business-os/boost/boostWebhookDeps
 */

import type { BusinessOsBoostPurchaseRepository } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { getBusinessOsStripeClient } from '@/lib/business-os/billing/stripeClient';
import { currentStripeMode, isLiveMode } from '@/lib/business-os/billing/stripeMode';
import { createBoostResolver } from '@/lib/business-os/boost/boostWebhookResolver';
import { createBoostWebhookHandler, type BoostWebhookDeps, type BoostWebhookLogger } from '@/lib/business-os/boost/boostWebhookHandler';
import { createBoostChargeHandler } from '@/lib/business-os/boost/boostChargeHandler';
import { isBoostChargeEventType } from '@/lib/business-os/boost/boostChargeEvents';
import type Stripe from 'stripe';
import { recordBoostReceipt, type BoostReceiptStripePort } from '@/lib/business-os/boost/boostReceipt';

async function repository(): Promise<BusinessOsBoostPurchaseRepository> {
  const module = await import('@/lib/repositories/BusinessOsBoostPurchaseRepository');
  return module.businessOsBoostPurchaseRepository;
}

/** The repository calls the webhook makes, each loading the repository on first use. */
const purchases: BoostWebhookDeps['purchases'] &
  Pick<BusinessOsBoostPurchaseRepository, 'recordReceipt' | 'findByPaymentIntentIdForWebhook'> = {
  findBySessionIdForWebhook: async (sessionId) => (await repository()).findBySessionIdForWebhook(sessionId),
  findByIdForWebhook: async (purchaseId) => (await repository()).findByIdForWebhook(purchaseId),
  findByPaymentIntentIdForWebhook: async (paymentIntentId) => (await repository()).findByPaymentIntentIdForWebhook(paymentIntentId),
  credit: async (input) => (await repository()).credit(input),
  transition: async (input) => (await repository()).transition(input),
  recordReceipt: async (input) => (await repository()).recordReceipt(input),
};

export const boostResolver = createBoostResolver({ purchases });

const auditWrite: BoostWebhookDeps['audit'] = (entry, log) =>
  logAndFlush(entry, log, { reason: 'boost webhook', continues: 'the webhook outcome is unaffected' });

/** 4b.1: refunds and disputes on a boost payment. */
const handleBoostChargeEvent = createBoostChargeHandler({ purchases, audit: auditWrite });

const handleBoostSessionEvent = createBoostWebhookHandler({
  purchases,
  audit: auditWrite,
  receipt: (input, log) =>
    recordBoostReceipt(
      input,
      {
        stripe: () => {
          try {
            return getBusinessOsStripeClient() as unknown as BoostReceiptStripePort;
          } catch {
            return null;
          }
        },
        keyIsLive: () => {
          try {
            return isLiveMode(currentStripeMode());
          } catch {
            return null;
          }
        },
        purchases,
      },
      log
    ),
});

/**
 * The boost flow handler registered in the Stripe webhook route: checkout
 * session events (4a) and refund / dispute events (4b.1) on one flow.
 */
export async function handleBoostWebhookEvent(event: Stripe.Event, log: BoostWebhookLogger): Promise<void> {
  if (isBoostChargeEventType(event.type)) return handleBoostChargeEvent(event, log);
  return handleBoostSessionEvent(event, log);
}
