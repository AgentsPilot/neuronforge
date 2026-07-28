/**
 * Website Blocks API
 * GET - List blocks for a page
 * POST - Add a new block
 * PUT - Reorder blocks
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository, WebsiteBlockInsert, BlockType } from '@/lib/repositories/WebsiteBlockRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'WebsiteBlocksAPI' });

const CreateBlockSchema = z.object({
  block_type: z.string(),
  content: z.record(z.unknown()),
  styles: z.record(z.unknown()).optional(),
  position: z.number().optional(),
  capability_config: z.record(z.unknown()).optional()
});

const ReorderBlocksSchema = z.object({
  block_ids: z.array(z.string().uuid())
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Verify page ownership
    const pageRepo = new WebsitePageRepository(supabaseServer);
    const pageResult = await pageRepo.findById(id, user.id);
    if (pageResult.error || !pageResult.data) {
      return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 });
    }

    const blockRepo = new WebsiteBlockRepository(supabaseServer);
    const result = await blockRepo.findByPageId(id);

    if (result.error) {
      throw result.error;
    }

    return NextResponse.json({ success: true, blocks: result.data });
  } catch (error) {
    requestLogger.error({ err: error, pageId: id }, 'Failed to list blocks');
    return NextResponse.json(
      { success: false, error: 'Failed to list blocks' },
      { status: 500 }
    );
  }
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

    // Verify page ownership
    const pageRepo = new WebsitePageRepository(supabaseServer);
    const pageResult = await pageRepo.findById(id, user.id);
    if (pageResult.error || !pageResult.data) {
      return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 });
    }

    const body = await request.json();
    const validated = CreateBlockSchema.parse(body);

    const blockRepo = new WebsiteBlockRepository(supabaseServer);

    // Get current max position
    const existingBlocks = await blockRepo.findByPageId(id);
    const maxPosition = existingBlocks.data
      ? Math.max(...existingBlocks.data.map(b => b.position), -1)
      : -1;

    const blockData: WebsiteBlockInsert = {
      page_id: id,
      block_type: validated.block_type as BlockType,
      content: validated.content as WebsiteBlockInsert['content'],
      styles: validated.styles as WebsiteBlockInsert['styles'],
      position: validated.position ?? maxPosition + 1,
      capability_config: validated.capability_config as WebsiteBlockInsert['capability_config']
    };

    const result = await blockRepo.create(blockData);

    if (result.error || !result.data) {
      throw result.error || new Error('Failed to create block');
    }

    requestLogger.info({ blockId: result.data.id, pageId: id }, 'Created website block');

    return NextResponse.json({ success: true, block: result.data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error, pageId: id }, 'Failed to create block');
    return NextResponse.json(
      { success: false, error: 'Failed to create block' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Verify page ownership
    const pageRepo = new WebsitePageRepository(supabaseServer);
    const pageResult = await pageRepo.findById(id, user.id);
    if (pageResult.error || !pageResult.data) {
      return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 });
    }

    const body = await request.json();
    const validated = ReorderBlocksSchema.parse(body);

    const blockRepo = new WebsiteBlockRepository(supabaseServer);
    const result = await blockRepo.reorder(id, validated.block_ids);

    if (result.error) {
      throw result.error;
    }

    requestLogger.info({ pageId: id, count: validated.block_ids.length }, 'Reordered blocks');

    return NextResponse.json({ success: true, blocks: result.data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error, pageId: id }, 'Failed to reorder blocks');
    return NextResponse.json(
      { success: false, error: 'Failed to reorder blocks' },
      { status: 500 }
    );
  }
}
