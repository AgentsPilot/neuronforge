/**
 * Website Page Block Enrichment API
 * POST - Sync blocks with real business data (services, profile, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { websiteBlockEnrichmentService } from '@/lib/services/WebsiteBlockEnrichmentService';
import { z } from 'zod';

const logger = createLogger({ module: 'WebsiteEnrichAPI' });

const EnrichSchema = z.object({
  block_types: z.array(z.string()).optional(), // If provided, only enrich these block types
  force: z.boolean().default(false) // Force re-enrichment even if content exists
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: pageId } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const validated = EnrichSchema.parse(body);

    const pageRepo = new WebsitePageRepository(supabaseServer);
    const blockRepo = new WebsiteBlockRepository(supabaseServer);

    // Verify page ownership
    const pageResult = await pageRepo.findById(pageId, user.id);
    if (pageResult.error || !pageResult.data) {
      return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 });
    }

    // Get current blocks
    const blocksResult = await blockRepo.findByPageId(pageId);
    if (blocksResult.error || !blocksResult.data) {
      return NextResponse.json({ success: false, error: 'Failed to fetch blocks' }, { status: 500 });
    }

    const blocks = blocksResult.data;
    requestLogger.info({ pageId, blockCount: blocks.length, userId: user.id }, 'Starting block enrichment');

    // Filter blocks to enrich if block_types specified
    let blocksToEnrich = blocks;
    if (validated.block_types && validated.block_types.length > 0) {
      blocksToEnrich = blocks.filter(b => validated.block_types!.includes(b.block_type));
    }

    // Get enrichment summary first (for response)
    const enrichmentSummary = await websiteBlockEnrichmentService.getEnrichmentSummary(user.id);

    // Enrich each block
    const enrichmentResults = [];
    let enrichedCount = 0;

    // Get page language for localized content
    const pageLanguage = pageResult.data.website_language || 'en';

    for (const block of blocksToEnrich) {
      const result = await websiteBlockEnrichmentService.enrichBlock(
        user.id,
        block.block_type,
        block.content as Record<string, unknown>,
        pageLanguage
      );

      if (result.enriched) {
        // Update block in database
        const updateResult = await blockRepo.update(block.id, { content: result.content });

        if (updateResult.error) {
          requestLogger.warn({ err: updateResult.error, blockId: block.id }, 'Failed to update enriched block');
        } else {
          enrichedCount++;
        }
      }

      enrichmentResults.push({
        block_id: block.id,
        block_type: block.block_type,
        enriched: result.enriched,
        source: result.source,
        enriched_fields: result.enrichedFields
      });
    }

    requestLogger.info({ pageId, enrichedCount, totalBlocks: blocksToEnrich.length }, 'Block enrichment complete');

    return NextResponse.json({
      success: true,
      enriched_count: enrichedCount,
      total_blocks: blocksToEnrich.length,
      results: enrichmentResults,
      data_summary: {
        services_available: enrichmentSummary.serviceCount,
        clients_available: enrichmentSummary.clientCount,
        bookings_available: enrichmentSummary.bookingCount,
        profile_available: enrichmentSummary.hasProfile
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error, pageId }, 'Failed to enrich blocks');
    return NextResponse.json(
      { success: false, error: 'Failed to enrich blocks' },
      { status: 500 }
    );
  }
}

/**
 * GET - Get enrichment summary (what data is available)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: pageId } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const pageRepo = new WebsitePageRepository(supabaseServer);

    // Verify page ownership
    const pageResult = await pageRepo.findById(pageId, user.id);
    if (pageResult.error || !pageResult.data) {
      return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 });
    }

    // Get enrichment summary
    const summary = await websiteBlockEnrichmentService.getEnrichmentSummary(user.id);

    return NextResponse.json({
      success: true,
      summary: {
        has_services: summary.hasServices,
        service_count: summary.serviceCount,
        has_profile: summary.hasProfile,
        has_clients: summary.hasClients,
        client_count: summary.clientCount,
        has_bookings: summary.hasBookings,
        booking_count: summary.bookingCount
      },
      enrichable_blocks: [
        { type: 'services', available: summary.hasServices, description: 'Your services from Scheduling' },
        { type: 'pricing', available: summary.hasServices, description: 'Pricing from your services' },
        { type: 'hero', available: summary.hasProfile, description: 'Company name in headline' },
        { type: 'about', available: summary.hasProfile, description: 'Business profile description' },
        { type: 'stats', available: summary.hasClients || summary.hasBookings, description: 'Client & booking stats' },
        { type: 'contact_form', available: summary.hasProfile, description: 'Company name in form' }
      ]
    });
  } catch (error) {
    requestLogger.error({ err: error, pageId }, 'Failed to get enrichment summary');
    return NextResponse.json(
      { success: false, error: 'Failed to get enrichment summary' },
      { status: 500 }
    );
  }
}
