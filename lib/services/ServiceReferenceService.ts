import 'server-only';

/**
 * What breaks if a service goes away.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Removing a service used to be checked against one thing: whether it had
 * bookings. Nothing asked what else pointed at it — so a landing page written
 * for that one service stayed published, kept showing the last-known name and
 * price, and offered a Book button that failed at the booking API only after
 * the client had filled in the whole form.
 *
 * The rule this encodes:
 *
 *   Anything scoped to THIS ONE service dies with it.
 *   Anything that lists ALL ACTIVE services heals itself.
 *
 * And a second rule, about HOW it dies, because deleting a service and drafting
 * one are not the same event:
 *
 *   DELETED  the landing page is destroyed. Its copy was generated for that one
 *            service and is meaningless without it.
 *   DRAFTED  the landing page is unpublished and its booking controls render
 *            disabled. The service is coming back; the copy is still true.
 *
 * A landing page is always about a single service, so it has to come down. The
 * website's services and pricing blocks read every active service on each
 * render, so they simply stop listing it and need nothing here. A smart link
 * sits on either side of that line depending on whether it was scoped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY DEACTIVATING COUNTS AS DISAPPEARING
 *
 * The public renderer loads services with `listAll(userId, true)` — active only
 * — then matches the block's `serviceId` against that list. A service that is
 * merely switched off misses the match exactly like a deleted one and produces
 * exactly the same broken page. Both go through here.
 *
 * @module lib/services/ServiceReferenceService
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { getWebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { smartLinkRepository } from '@/lib/repositories/SmartLinkRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'ServiceReferenceService' });

/** A landing page that exists to sell one particular service. */
export interface LandingPageReference {
  id: string;
  title: string;
  slug: string | null;
  /** `live` means it is being served to the public right now. */
  status: string;
}

/**
 * A smart link pinned to specific services.
 *
 * `onlyThisService` decides its fate: a link scoped to this service alone has
 * nowhere to send anyone once it is gone, while one that also carries other
 * services just loses an option.
 */
export interface SmartLinkReference {
  id: string;
  name: string | null;
  code: string;
  onlyThisService: boolean;
}

export interface ServiceReferences {
  landingPages: LandingPageReference[];
  smartLinks: SmartLinkReference[];
  /** True when removing the service would leave something pointing at nothing. */
  hasBlocking: boolean;
}

const EMPTY: ServiceReferences = { landingPages: [], smartLinks: [], hasBlocking: false };

/*
 * These repositories take a client rather than owning one, and the work here is
 * always server-side on behalf of a signed-in owner whose id is checked in
 * every query below.
 */
const pageRepo = new WebsitePageRepository(supabaseServer);
const blockRepo = getWebsiteBlockRepository(supabaseServer);

/**
 * Everything that points at this service and would break without it.
 *
 * Never throws. This runs in front of a destructive action the owner is
 * entitled to take, and a lookup failure must not lock them out of managing
 * their own services — it reports nothing found and says so in the log. The
 * render-time guard is what actually protects the public page.
 */
export async function findServiceReferences(
  serviceId: string,
  userId: string
): Promise<ServiceReferences> {
  try {
    const [pages, links] = await Promise.all([
      findLandingPages(serviceId, userId),
      findSmartLinks(serviceId, userId),
    ]);

    return {
      landingPages: pages,
      smartLinks: links,
      hasBlocking: pages.length > 0 || links.some(l => l.onlyThisService),
    };
  } catch (error) {
    logger.error({ err: error, serviceId, userId }, 'Failed to resolve service references');
    return EMPTY;
  }
}

async function findLandingPages(serviceId: string, userId: string): Promise<LandingPageReference[]> {
  const blockResult = await blockRepo.findPageIdsByServiceId(serviceId);
  if (blockResult.error) throw blockResult.error;
  if (!blockResult.data?.length) return [];

  const pageResult = await pageRepo.findLandingPagesByIds(blockResult.data, userId);
  if (pageResult.error) throw pageResult.error;

  return (pageResult.data ?? []).map(p => ({
    id: p.id,
    title: p.title || 'Untitled page',
    slug: p.slug ?? null,
    status: p.status,
  }));
}

async function findSmartLinks(serviceId: string, userId: string): Promise<SmartLinkReference[]> {
  const result = await smartLinkRepository.findByServiceId(serviceId, userId);
  if (result.error) throw result.error;

  return (result.data ?? []).map(link => {
    const ids = link.metadata?.serviceIds ?? [];
    return {
      id: link.id,
      name: link.name,
      code: link.code,
      onlyThisService: ids.length === 1 && ids[0] === serviceId,
    };
  });
}

/**
 * Destroy what was written for a service that is being DELETED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY DELETE RATHER THAN UNPUBLISH
 *
 * This started as an unpublish, on the reasoning that an owner might bring the
 * service back and their copy was worth keeping. That is true of a service
 * moved to draft and false of one deleted, and the difference is what a landing
 * page IS: it is generated for a single service, and its headline, its body,
 * its objections and its closing section are all written about that one thing.
 * Without the service it is not a page missing a product — it is an article
 * about something that does not exist. Unpublishing left the owner a draft they
 * could never usefully republish, and a growing list of them.
 *
 * Smart links scoped to this service alone are DEACTIVATED rather than deleted:
 * a link is a short code someone may have written down or shared, and its
 * content is not about the service the way a page's is.
 *
 * Anything listing all active services needs nothing either way: it reads them
 * live on every render.
 */
export async function deleteServiceReferences(
  refs: ServiceReferences,
  userId: string
): Promise<{ pagesDeleted: number; linksDisabled: number }> {
  const pageIds = refs.landingPages.map(p => p.id);
  const deadLinkIds = refs.smartLinks.filter(l => l.onlyThisService).map(l => l.id);

  const [pageResult, linkResult] = await Promise.all([
    pageRepo.deleteMany(pageIds, userId),
    smartLinkRepository.deactivateMany(deadLinkIds, userId),
  ]);

  const pagesDeleted = pageResult.data ?? 0;
  const linksDisabled = linkResult.data ?? 0;

  logger.info(
    { userId, pagesDeleted, linksDisabled },
    'Deleted the pages written for a removed service'
  );

  return { pagesDeleted, linksDisabled };
}

/**
 * Take a DRAFTED service's pages out of public view.
 *
 * Unpublish rather than delete, and the distinction from `deleteServiceReferences`
 * is the whole point: a service moved to draft is coming back, its page's copy
 * is still true, and the page's booking controls render disabled — see
 * `bookingIsDead` in `components/website/blocks/bookingAction.ts` — until it
 * does.
 *
 * Failures are logged and swallowed. This runs after the service has already
 * gone, so throwing would report a failed removal that in fact succeeded and
 * leave the owner with no idea what state they are in. The counts returned say
 * what actually happened.
 */
export async function unpublishServiceReferences(
  refs: ServiceReferences,
  userId: string
): Promise<{ pagesUnpublished: number; linksDisabled: number }> {
  const livePageIds = refs.landingPages.filter(p => p.status === 'live').map(p => p.id);
  const deadLinkIds = refs.smartLinks.filter(l => l.onlyThisService).map(l => l.id);

  const [pageResult, linkResult] = await Promise.all([
    pageRepo.unpublishMany(livePageIds, userId),
    smartLinkRepository.deactivateMany(deadLinkIds, userId),
  ]);

  const pagesUnpublished = pageResult.data ?? 0;
  const linksDisabled = linkResult.data ?? 0;

  logger.info(
    { userId, pagesUnpublished, linksDisabled },
    'Took down references to a removed service'
  );

  return { pagesUnpublished, linksDisabled };
}
