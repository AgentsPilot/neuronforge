/**
 * Website Page Publish API
 * POST - Publish page (draft -> live)
 * DELETE - Unpublish page (live -> draft)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { websiteBlockEnrichmentService } from '@/lib/services/WebsiteBlockEnrichmentService';

const logger = createLogger({ module: 'WebsitePublishAPI' });

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const pageRepo = new WebsitePageRepository(supabaseServer);
    const blockRepo = new WebsiteBlockRepository(supabaseServer);

    // Check page exists and has subdomain
    const pageResult = await pageRepo.findById(id, user.id);
    if (pageResult.error || !pageResult.data) {
      return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 });
    }

    if (!pageResult.data.subdomain) {
      return NextResponse.json(
        { success: false, error: 'Page must have a subdomain before publishing' },
        { status: 400 }
      );
    }

    // Check page has at least one enabled block
    const blocksResult = await blockRepo.findByPageId(id, true);
    if (!blocksResult.data || blocksResult.data.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Page must have at least one section to publish' },
        { status: 400 }
      );
    }

    // Enrich blocks with latest business data before publishing
    requestLogger.info({ pageId: id, blockCount: blocksResult.data.length }, 'Enriching blocks before publish');
    try {
      const blocksForEnrichment = blocksResult.data.map(b => ({
        block_type: b.block_type,
        content: b.content as Record<string, unknown>,
        position: b.position
      }));

      // Use page language for localized content
      const pageLanguage = pageResult.data.website_language || 'en';
      const enrichedBlocks = await websiteBlockEnrichmentService.enrichBlocks(user.id, blocksForEnrichment, pageLanguage, false, user.email);

      // Update each enriched block in the database
      let enrichedCount = 0;
      for (let i = 0; i < blocksResult.data.length; i++) {
        if (enrichedBlocks[i].enriched) {
          await blockRepo.update(blocksResult.data[i].id, {
            content: enrichedBlocks[i].content as Record<string, unknown>
          });
          enrichedCount++;
        }
      }

      requestLogger.info({ pageId: id, enrichedCount }, 'Blocks enriched before publish');
    } catch (enrichError) {
      requestLogger.warn({ err: enrichError, pageId: id }, 'Block enrichment failed during publish, continuing with current content');
    }

    // Publish the page
    const result = await pageRepo.publish(id, user.id);

    if (result.error || !result.data) {
      throw result.error || new Error('Failed to publish page');
    }

    requestLogger.info({ pageId: id, userId: user.id, subdomain: result.data.subdomain }, 'Published website page');

    return NextResponse.json({
      success: true,
      page: result.data,
      url: `https://${result.data.subdomain}.agentpilot.io`
    });
  } catch (error) {
    requestLogger.error({ err: error, id }, 'Failed to publish page');
    return NextResponse.json(
      { success: false, error: 'Failed to publish page' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const pageRepo = new WebsitePageRepository(supabaseServer);

    const result = await pageRepo.unpublish(id, user.id);

    if (result.error || !result.data) {
      throw result.error || new Error('Failed to unpublish page');
    }

    requestLogger.info({ pageId: id, userId: user.id }, 'Unpublished website page');

    return NextResponse.json({ success: true, page: result.data });
  } catch (error) {
    requestLogger.error({ err: error, id }, 'Failed to unpublish page');
    return NextResponse.json(
      { success: false, error: 'Failed to unpublish page' },
      { status: 500 }
    );
  }
}
