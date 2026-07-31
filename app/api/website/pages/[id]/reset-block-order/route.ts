/**
 * Reset Block Order API
 * POST - Reset blocks to default order (Hero, Services, Process, About, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';

const logger = createLogger({ module: 'ResetBlockOrderAPI' });

// Default block order - process comes right after services
const DEFAULT_BLOCK_ORDER = [
  'header',
  'hero',
  'services',
  'process',      // "How it Works" right after services
  'about',
  'features',
  'testimonials',
  'faq',
  'gallery',
  'team',
  'pricing',
  'cta',
  'contact_form',
  'booking_widget',
  'newsletter',
  'payment_button',
  'intake_form',
  'stats',
  'logo_cloud',
  'video'
];

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

    const pageRepo = new WebsitePageRepository(supabaseServer);
    const blockRepo = new WebsiteBlockRepository(supabaseServer);

    // Verify page ownership
    const pageResult = await pageRepo.findById(pageId, user.id);
    if (pageResult.error || !pageResult.data) {
      return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 });
    }

    // Get all blocks
    const blocksResult = await blockRepo.findByPageId(pageId);
    if (blocksResult.error || !blocksResult.data) {
      return NextResponse.json({ success: false, error: 'Failed to fetch blocks' }, { status: 500 });
    }

    const blocks = blocksResult.data;

    // Sort blocks by default order
    const sortedBlocks = [...blocks].sort((a, b) => {
      const aIndex = DEFAULT_BLOCK_ORDER.indexOf(a.block_type);
      const bIndex = DEFAULT_BLOCK_ORDER.indexOf(b.block_type);
      // If not in default order, put at end
      const aPos = aIndex === -1 ? 999 : aIndex;
      const bPos = bIndex === -1 ? 999 : bIndex;
      return aPos - bPos;
    });

    // Get ordered block IDs
    const orderedBlockIds = sortedBlocks.map(b => b.id);

    // Use reorder to set positions
    const reorderResult = await blockRepo.reorder(pageId, orderedBlockIds);

    if (reorderResult.error) {
      throw reorderResult.error;
    }

    requestLogger.info({
      pageId,
      blockCount: orderedBlockIds.length,
      order: sortedBlocks.map(b => b.block_type)
    }, 'Reset block order to defaults');

    return NextResponse.json({
      success: true,
      blocks: reorderResult.data,
      message: 'Block order reset to defaults'
    });
  } catch (error) {
    requestLogger.error({ err: error, pageId }, 'Failed to reset block order');
    return NextResponse.json(
      { success: false, error: 'Failed to reset block order' },
      { status: 500 }
    );
  }
}
