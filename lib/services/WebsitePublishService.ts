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
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { resolveBusinessSubdomain, claimBusinessSubdomain } from '@/lib/business-os/businessSubdomain';
import { websiteBlockEnrichmentService } from '@/lib/services/WebsiteBlockEnrichmentService';
import { journeyGaps, describeJourneyGaps } from '@/lib/business-os/journeyReadiness';

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
  const servicesForJourney = (blocksResult.data || [])
    .filter(block => block.block_type === 'services')
    .flatMap(block => {
      const listed = (block.content as { services?: Array<Record<string, unknown>> })?.services;
      return Array.isArray(listed) ? listed : [];
    })
    .filter(service => service.hidden !== true)
    .map(service => ({
      name: (service.name as string) || null,
      is_scheduled: service.is_scheduled as boolean | null | undefined,
      collection: service.collection as 'online' | 'invoice' | null | undefined,
      price: (service.priceRaw ?? service.price) as number | null | undefined,
    }));

  const gaps = await journeyGaps(userId, servicesForJourney);
  if (gaps.length > 0) {
    return {
      data: null,
      error: new PageNotPublishableError(
        describeJourneyGaps(gaps),
        gaps[0].kind === 'hours' ? 'no_working_hours' : 'no_processor'
      ),
    };
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

  const url = subdomain ? `https://${subdomain}.agentpilot.io` : null;

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
