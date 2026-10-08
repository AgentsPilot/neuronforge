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
import { createBoostWebhookHandler, type BoostWebhookDeps } from '@/lib/business-os/boost/boostWebhookHandler';
import { recordBoostReceipt, type BoostReceiptStripePort } from '@/lib/business-os/boost/boostReceipt';

async function repository(): Promise<BusinessOsBoostPurchaseRepository> {
  const module = await import('@/lib/repositories/BusinessOsBoostPurchaseRepository');
  return module.businessOsBoostPurchaseRepository;
}

/** The repository calls the webhook makes, each loading the repository on first use. */
const purchases: BoostWebhookDeps['purchases'] & { recordReceipt: BusinessOsBoostPurchaseRepository['recordReceipt'] } = {
  findBySessionIdForWebhook: async (sessionId) => (await repository()).findBySessionIdForWebhook(sessionId),
  findByIdForWebhook: async (purchaseId) => (await repository()).findByIdForWebhook(purchaseId),
  credit: async (input) => (await repository()).credit(input),
  transition: async (input) => (await repository()).transition(input),
  recordReceipt: async (input) => (await repository()).recordReceipt(input),
};

export const boostResolver = createBoostResolver({ purchases });

export const handleBoostWebhookEvent = createBoostWebhookHandler({
  purchases,
  audit: (entry, log) => logAndFlush(entry, log, { reason: 'boost webhook', continues: 'the webhook outcome is unaffected' }),
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
