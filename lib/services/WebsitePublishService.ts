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
import { websiteBlockEnrichmentService } from '@/lib/services/WebsiteBlockEnrichmentService';

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
    readonly reason: 'no_subdomain' | 'no_sections' | 'not_found'
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

  if (!pageResult.data.subdomain) {
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
      false
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
