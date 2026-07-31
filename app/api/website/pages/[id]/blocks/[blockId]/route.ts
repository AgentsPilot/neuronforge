/**
 * Website Block API
 * GET - Get block by ID
 * PUT - Update block
 * DELETE - Delete block
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository, WebsiteBlockUpdate, BlockType } from '@/lib/repositories/WebsiteBlockRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'WebsiteBlockAPI' });

const UpdateBlockSchema = z.object({
  block_type: z.string().optional(),
  content: z.record(z.unknown()).optional(),
  styles: z.record(z.unknown()).nullable().optional(),
  enabled: z.boolean().optional(),
  capability_config: z.record(z.unknown()).optional()
});

interface RouteParams {
  params: Promise<{ id: string; blockId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id, blockId } = await params;
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
    const result = await blockRepo.findById(blockId);

    if (result.error || !result.data) {
      return NextResponse.json({ success: false, error: 'Block not found' }, { status: 404 });
    }

    // Verify block belongs to page
    if (result.data.page_id !== id) {
      return NextResponse.json({ success: false, error: 'Block not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, block: result.data });
  } catch (error) {
    requestLogger.error({ err: error, pageId: id, blockId }, 'Failed to get block');
    return NextResponse.json(
      { success: false, error: 'Failed to get block' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id, blockId } = await params;
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
    const validated = UpdateBlockSchema.parse(body);

    const blockRepo = new WebsiteBlockRepository(supabaseServer);

    // Verify block belongs to page
    const existingBlock = await blockRepo.findById(blockId);
    if (existingBlock.error || !existingBlock.data || existingBlock.data.page_id !== id) {
      return NextResponse.json({ success: false, error: 'Block not found' }, { status: 404 });
    }

    const updates: WebsiteBlockUpdate = {};
    if (validated.block_type !== undefined) updates.block_type = validated.block_type as BlockType;
    if (validated.content !== undefined) updates.content = validated.content as WebsiteBlockUpdate['content'];
    if (validated.styles !== undefined) updates.styles = validated.styles as WebsiteBlockUpdate['styles'];
    if (validated.enabled !== undefined) updates.enabled = validated.enabled;
    if (validated.capability_config !== undefined) {
      updates.capability_config = validated.capability_config as WebsiteBlockUpdate['capability_config'];
    }

    const result = await blockRepo.update(blockId, updates);

    if (result.error || !result.data) {
      throw result.error || new Error('Failed to update block');
    }

    // Revalidate the public website cache if page has a subdomain
    if (pageResult.data.subdomain) {
      try {
        revalidateTag(`website-${pageResult.data.subdomain}`);
      } catch (revalidateError) {
        requestLogger.warn({ err: revalidateError }, 'Failed to revalidate cache');
      }
    }

    requestLogger.info({ blockId, pageId: id }, 'Updated website block');

    return NextResponse.json({ success: true, block: result.data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error, pageId: id, blockId }, 'Failed to update block');
    return NextResponse.json(
      { success: false, error: 'Failed to update block' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id, blockId } = await params;
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

    // Verify block belongs to page
    const existingBlock = await blockRepo.findById(blockId);
    if (existingBlock.error || !existingBlock.data || existingBlock.data.page_id !== id) {
      return NextResponse.json({ success: false, error: 'Block not found' }, { status: 404 });
    }

    const result = await blockRepo.delete(blockId);

    if (result.error) {
      throw result.error;
    }

    // Revalidate the public website cache if page has a subdomain
    if (pageResult.data.subdomain) {
      try {
        revalidateTag(`website-${pageResult.data.subdomain}`);
      } catch (revalidateError) {
        requestLogger.warn({ err: revalidateError }, 'Failed to revalidate cache');
      }
    }

    requestLogger.info({ blockId, pageId: id }, 'Deleted website block');

    return NextResponse.json({ success: true });
  } catch (error) {
    requestLogger.error({ err: error, pageId: id, blockId }, 'Failed to delete block');
    return NextResponse.json(
      { success: false, error: 'Failed to delete block' },
      { status: 500 }
    );
  }
}
