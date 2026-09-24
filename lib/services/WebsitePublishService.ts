/**
 * Putting a website live, and taking it down.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SERVICE
 *
 * Publishing is not a status flip. It is: refusing a page with no address,
 * refusing a page with nothing on it, refreshing every section against the
 * business's current details, and only then going live.
 *
 * Those first two are the ones that matter. A page published without a subdomain
 * is live at no address; a page published with no enabled sections is a live
 * blank page with the business's name on it. Both are worse than not publishing,
 * and both are invisible to whoever asked.
 *
 * The sequence lived inside `POST /api/website/pages/[id]/publish`, so only a
 * click could reach it — the same shape as booking cancellation before it moved.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/WebsitePublishService
 */

import type { NextRequest } from 'next/server';
import { publicSiteUrl } from '@/lib/utils/origins';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { resolveBusinessSubdomain, claimBusinessSubdomain } from '@/lib/business-os/businessSubdomain';
import { websiteBlockEnrichmentService } from '@/lib/services/WebsiteBlockEnrichmentService';
import {
  journeyGaps,
  describeJourneyGaps,
  describeJourneyGap,
  isBlockingGap,
} from '@/lib/business-os/journeyReadiness';

const logger = createLogger({ service: 'WebsitePublishService' });
const auditTrail = AuditTrailService.getInstance();

type ContextLogger = {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
};

/**
 * The page is not ready to go live, and the reason is the owner's to fix.
 *
 * Distinct from a failure: "you have not chosen an address yet" is something a
 * person can act on in a minute, and a generic error would send them looking for
 * a bug instead.
 */
export class PageNotPublishableError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'no_subdomain'
      | 'no_sections'
      | 'not_found'
      /** A service asks clients to pick a time and no working hours are set. */
      | 'no_working_hours'
      /** A service is paid by card and no processor is connected. */
      | 'no_processor'
      /** A service will be invoiced and the details to issue one are missing. */
      | 'no_invoice_details',
    /**
     * Each blocking gap on its own, where there were several.
     *
     * `message` joins them for a caller that wants one sentence. A caller that
     * offers a way to FIX them needs them apart — two problems under one link
     * that addresses only the first is worse than no link.
     */
    readonly gaps: Array<{ kind: string; message: string }> = []
  ) {
    super(message);
    this.name = 'PageNotPublishableError';
  }
}

export interface PublishPageParams {
  pageId: string;
  userId: string;
  request?: NextRequest;
  logger?: ContextLogger;
}

export interface PublishOutcome {
  pageId: string;
  subdomain: string | null;
  url: string | null;
  sectionsEnriched: number;
}

/**
 * Can this page go live — asked without going live.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The editor needs the answer in two places now. Publish needs it to refuse,
 * and PREVIEW needs it to stop sending an owner into a flow that cannot run:
 * a booking step with no working hours behind it shows an empty calendar, and
 * the owner reads that as a bug in the preview rather than as a setting they
 * have not filled in.
 *
 * Exported so both ask the SAME question. A second copy of this check written
 * for the preview would drift from the one that guards the publish, and the two
 * disagreeing about whether a site is ready is worse than neither existing.
 *
 * Returns null when there is nothing blocking.
 */
export async function pagePublishBlocker(
  pageId: string,
  userId: string
): Promise<{
  message: string;
  reason: string;
  /**
   * Each blocking gap on its own, because each is fixed somewhere different.
   *
   * The joined `message` stays for callers that want one sentence; a caller
   * that offers a way to FIX the problem needs them apart, or it ends up
   * showing two problems under one link that addresses only the first.
   */
  gaps: Array<{ kind: string; message: string }>;
} | null> {
  const blockRepo = new WebsiteBlockRepository(supabaseServer);
  const blocksResult = await blockRepo.findByPageId(pageId);

  const services = await servicesOfferedBy(blocksResult.data || [], userId);
  const blocking = (await journeyGaps(userId, services)).filter(isBlockingGap);

  if (blocking.length === 0) return null;
  /*
   * The FIRST blocking gap names the reason.
   *
   * The editor turns this into a link — working hours or invoice details — so
   * it has to say which. Hardcoding 'no_working_hours' sent a business with
   * complete hours and missing invoice fields to the availability settings,
   * where there was nothing to fix.
   */
  return {
    message: describeJourneyGaps(blocking),
    reason: blocking[0].kind === 'invoicing' ? 'no_invoice_details' : 'no_working_hours',
    gaps: blocking.map(gap => ({ kind: gap.kind, message: describeJourneyGap(gap) })),
  };
}

/**
 * The services a page actually offers, as the journey check wants them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO KINDS OF PAGE SELL IN TWO DIFFERENT SHAPES.
 *
 * A WEBSITE lists its catalogue in a `services` block, and that block carries
 * each service's facts inline. The filtering matters: a `hidden` service is not
 * offered, and `priceRaw` is the number while `price` may be a formatted
 * string like "$200".
 *
 * A LANDING PAGE sells ONE service and names it by id, in a `pricing` or `cta`
 * block. It has no `services` block at all — so reading only that block type
 * found nothing, returned no services, and concluded every landing page was
 * ready. The page most likely to exist for a single paid service was the one
 * never checked.
 *
 * The ids are resolved against `scheduling_services` because the stored block
 * does not hold the journey facts: `is_scheduled` and `collection` are injected
 * at read time by the routes that render it, so they are absent from the row
 * this reads.
 */
async function servicesOfferedBy(
  blocks: Array<{ block_type: string; content: unknown }>,
  userId: string
) {
  const listed = blocks
    .filter(block => block.block_type === 'services')
    .flatMap(block => {
      const services = (block.content as { services?: Array<Record<string, unknown>> })?.services;
      return Array.isArray(services) ? services : [];
    })
    .filter(service => service.hidden !== true)
    .map(service => ({
      name: (service.name as string) || null,
      is_scheduled: service.is_scheduled as boolean | null | undefined,
      collection: service.collection as 'online' | 'invoice' | null | undefined,
      price: (service.priceRaw ?? service.price) as number | null | undefined,
    }));

  /*
   * The one service a landing page is about, named by id.
   *
   * Taken from the block itself and from its plans, because the generator has
   * written it in both places at different times.
   */
  const ids = new Set<string>();
  for (const block of blocks) {
    if (block.block_type !== 'pricing' && block.block_type !== 'cta') continue;
    const content = block.content as {
      serviceId?: unknown;
      plans?: Array<{ serviceId?: unknown }>;
    } | null;

    if (typeof content?.serviceId === 'string' && content.serviceId) ids.add(content.serviceId);
    for (const plan of content?.plans ?? []) {
      if (typeof plan?.serviceId === 'string' && plan.serviceId) ids.add(plan.serviceId);
    }
  }

  if (ids.size === 0) return listed;

  const { data, error } = await supabaseServer
    .from('scheduling_services')
    .select('service_name, is_scheduled, collection, price')
    .eq('user_id', userId)
    .eq('is_active', true)
    .in('id', Array.from(ids));

  if (error) {
    // Never block on our own failure to look: the page is no less ready than
    // it was before the question was asked.
    logger.warn({ err: error, userId }, 'Could not resolve a page\'s named services');
    return listed;
  }

  return [
    ...listed,
    ...(data || []).map(service => ({
      name: service.service_name,
      is_scheduled: service.is_scheduled,
      collection: service.collection,
      price: service.price,
    })),
  ];
}

export async function publishPage(
  params: PublishPageParams
): Promise<{ data: PublishOutcome | null; error: Error | null }> {
  const { pageId, userId, request } = params;
  const log = params.logger ?? logger;

  const pageRepo = new WebsitePageRepository(supabaseServer);
  const blockRepo = new WebsiteBlockRepository(supabaseServer);

  const pageResult = await pageRepo.findById(pageId, userId);
  if (!pageResult.data) {
    return {
      data: null,
      error: new PageNotPublishableError('That page was not found.', 'not_found'),
    };
  }

  /*
   * A page with no address of its own takes the business's.
   *
   * The subdomain belongs to the business — every surface publishes under the
   * same one — but it was only ever stored per page and only ever read off the
   * homepage. So a landing page created by a business with no website was born
   * with `subdomain: null` and this refused it, naming a setting that lives in
   * the website's own settings screen. A business reaching clients by link
   * alone could never publish a landing page at all.
   *
   * Resolved and PERSISTED, so the page carries its address from here on and
   * every URL built from the row is right.
   */
  // Named `address` rather than `subdomain`: the published row is re-read
  // further down and that result already owns the name.
  let address = pageResult.data.subdomain;

  if (!address) {
    address = await resolveBusinessSubdomain(userId);

    if (address) {
      const adopted = await pageRepo.update(pageId, userId, { subdomain: address });
      if (adopted.error) {
        log.warn({ err: adopted.error, pageId }, 'Could not store the resolved subdomain');
      } else {
        log.info({ pageId, subdomain: address }, 'Page adopted the business web address');
      }
    }
  }

  if (!address) {
    return {
      data: null,
      error: new PageNotPublishableError(
        'This page has no web address yet. Choose a subdomain before publishing it.',
        'no_subdomain'
      ),
    };
  }

  // `true` = enabled blocks only. A page whose every section is hidden would
  // publish as a blank page carrying the business's name.
  const blocksResult = await blockRepo.findByPageId(pageId, true);
  if (!blocksResult.data || blocksResult.data.length === 0) {
    return {
      data: null,
      error: new PageNotPublishableError(
        'This page has no sections to show. Add at least one before publishing.',
        'no_sections'
      ),
    };
  }

  /*
   * Can the journeys this page sells actually be walked?
   *
   * A service can carry a booking step with no working hours behind it, or a
   * card step with no processor connected. Both were advice until now — the
   * readiness chain drew the step dashed, the journey strip named what it was
   * waiting for, and publishing went ahead regardless. The first person to find
   * out was a client, halfway through.
   *
   * Asked of the SERVICES this page offers rather than of the business, so a
   * page selling one invoiced programme is never asked for Stripe.
   */
  const servicesForJourney = await servicesOfferedBy(blocksResult.data || [], userId);

  /*
   * Only a gap that makes the journey IMPOSSIBLE stops a publish.
   *
   * This refused to publish on either gap, which meant a business that invoices
   * for everything could not put its site live until it connected Stripe — over
   * a payment step its clients would never have seen, because `journeySteps`
   * drops that step when there is no processor and the booking is invoiced
   * instead. See `isBlockingGap` for why hours are different.
   *
   * The advisory gap is not discarded: it is logged here and still surfaced by
   * the readiness chain, so a business that MEANT to take cards is told it is
   * not — it simply does not stand between them and a live page.
   */
  const gaps = await journeyGaps(userId, servicesForJourney);
  const blocking = gaps.filter(isBlockingGap);

  if (blocking.length > 0) {
    return {
      data: null,
      error: new PageNotPublishableError(
        describeJourneyGaps(blocking),
        blocking[0].kind === 'invoicing' ? 'no_invoice_details' : 'no_working_hours',
        blocking.map(gap => ({ kind: gap.kind, message: describeJourneyGap(gap) }))
      ),
    };
  }

  const advisory = gaps.filter(gap => !isBlockingGap(gap));
  if (advisory.length > 0) {
    logger.info(
      { userId, pageId, gaps: advisory.map(g => g.kind) },
      'Publishing with an advisory journey gap'
    );
  }

  // Refresh the sections against the business's current details, so a site that
  // has been sitting in draft does not go live quoting last month's services.
  // Best effort: publishing slightly stale content beats not publishing.
  let sectionsEnriched = 0;
  try {
    const language = pageResult.data.website_language || 'en';
    const enriched = await websiteBlockEnrichmentService.enrichBlocks(
      userId,
      blocksResult.data.map((b) => ({
        block_type: b.block_type,
        content: b.content as Record<string, unknown>,
        position: b.position,
      })),
      language,
      false,
      undefined,
      // A landing page is about one service; enrichment must not refill its
      // sections from the whole catalogue.
      pageResult.data.page_type === 'landing'
    );

    for (let i = 0; i < blocksResult.data.length; i++) {
      if (enriched[i]?.enriched) {
        await blockRepo.update(blocksResult.data[i].id, {
          content: enriched[i].content as Record<string, unknown>,
        });
        sectionsEnriched++;
      }
    }
  } catch (err) {
    log.warn({ err, pageId }, 'Block enrichment failed during publish; publishing as-is');
  }

  const result = await pageRepo.publish(pageId, userId);
  if (result.error || !result.data) {
    return { data: null, error: result.error || new Error('Failed to publish page') };
  }

  const subdomain = result.data.subdomain;

  /*
   * The first surface published under an address makes it the business's.
   *
   * Without this the address chosen while publishing a landing page lived only
   * on that page, and a website created afterwards would mint a different one —
   * leaving the business split across two addresses with no way to see it. Does
   * nothing once a claim exists.
   */
  await claimBusinessSubdomain(userId, subdomain);

  const url = subdomain ? publicSiteUrl(subdomain) : null;

  auditTrail
    .log({
      action: 'WEBSITE_PAGE_PUBLISHED',
      userId,
      entityType: 'website_page',
      entityId: pageId,
      resourceName: result.data.title ?? subdomain ?? pageId,
      details: { subdomain, sectionsEnriched },
      request,
    })
    .catch((err) => log.warn({ err, pageId }, 'Audit failed (non-blocking)'));

  log.info({ pageId, userId, subdomain, sectionsEnriched }, 'Website page published');

  return { data: { pageId, subdomain, url, sectionsEnriched }, error: null };
}

/** Take the page off the web. The content stays; only its visibility changes. */
export async function unpublishPage(
  params: PublishPageParams
): Promise<{ data: PublishOutcome | null; error: Error | null }> {
  const { pageId, userId, request } = params;
  const log = params.logger ?? logger;

  const pageRepo = new WebsitePageRepository(supabaseServer);
  const result = await pageRepo.unpublish(pageId, userId);

  if (result.error || !result.data) {
    return { data: null, error: result.error || new Error('Failed to unpublish page') };
  }

  auditTrail
    .log({
      action: 'WEBSITE_PAGE_UNPUBLISHED',
      userId,
      entityType: 'website_page',
      entityId: pageId,
      resourceName: result.data.title ?? pageId,
      request,
    })
    .catch((err) => log.warn({ err, pageId }, 'Audit failed (non-blocking)'));

  log.info({ pageId, userId }, 'Website page unpublished');

  return {
    data: { pageId, subdomain: result.data.subdomain, url: null, sectionsEnriched: 0 },
    error: null,
  };
}
