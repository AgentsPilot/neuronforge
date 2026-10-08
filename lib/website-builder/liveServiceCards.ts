/**
 * The business's real services, as the cards every public surface renders.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Three surfaces show a services block, and a visitor should not be able to
 * tell them apart:
 *
 *   the published site     `/api/website/public/[subdomain]`
 *   the website preview    `/api/website/pages/[id]/blocks-with-content`
 *   the landing preview    `/api/website/landing-pages/preview`
 *
 * The first two replace whatever the generator wrote with the live catalogue.
 * The third did not, and the difference was not cosmetic: a stored card carries
 * a name and a price and NONE of `id`, `is_scheduled`, `collection` or
 * `sale_mode` — the facts `flowForService` reads to decide a service's journey.
 * So on a landing page every service fell back to the page's default flow, and
 * a card the generator had invented ("קורס מומחים", on an account with no such
 * service) matched nothing at all.
 *
 * `toServiceCard` already exists because this MAPPING had been copied five
 * times and the copies drifted. This is the other half: the READ, so a fourth
 * surface cannot fetch a slightly different pair of things and call it the same
 * catalogue.
 *
 * Server-only: both reads hold the service-role client and are scoped by
 * `userId`.
 *
 * @module lib/website-builder/liveServiceCards
 */

import { SchedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { loadServicePaymentPlans, type ServicePaymentPlan } from '@/lib/business-os/servicePaymentPlan';
import { toServiceCard, type ServiceCard } from '@/lib/website-builder/serviceCard';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'LiveServiceCards' });

export interface LiveServiceCard extends ServiceCard {
  /** Undefined where the business offers no plan, which is most of them. */
  paymentPlan?: ServicePaymentPlan;
  /** Set by the caller from the block's saved flags; never by this read. */
  hidden?: boolean;
}

/**
 * Every bookable service this business sells, mapped for a block.
 *
 * Returns an empty array rather than throwing: a services block with no cards
 * is a page that needs attention, while a failed read that takes the whole
 * page down is an outage. Both callers log and carry on.
 */
export async function loadLiveServiceCards(userId: string): Promise<LiveServiceCard[]> {
  try {
    // Both in one pass, the same pair the public route loads — the editor and
    // the live site have to describe a service identically.
    const [servicesResult, plansByService] = await Promise.all([
      new SchedulingServiceRepository(supabaseServer).listBookable(userId),
      loadServicePaymentPlans(userId),
    ]);

    if (!servicesResult.data?.length) return [];

    return servicesResult.data.map(service => ({
      ...toServiceCard(service),
      paymentPlan: plansByService[service.id],
      hidden: false,
    }));
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to load live service cards');
    return [];
  }
}

/**
 * The one service a LANDING page sells, or the whole catalogue.
 *
 * A landing page is written to sell one thing, and that is the only way it
 * should differ from the website: one card instead of several, behaving exactly
 * as that service behaves everywhere else.
 *
 * An id that matches nothing live returns an empty list on purpose. The service
 * has been deleted or deactivated, and showing the rest of the catalogue in its
 * place would answer a page about one service with an offer of five others.
 */
export function narrowToPageService(
  cards: LiveServiceCard[],
  serviceId: string | null | undefined
): LiveServiceCard[] {
  if (!serviceId) return cards;
  return cards.filter(card => card.id === serviceId);
}
