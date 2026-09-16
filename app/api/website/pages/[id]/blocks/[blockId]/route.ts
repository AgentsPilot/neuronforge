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
  capability_config: z.record(z.unknown()).optional(),
  /*
   * Moving ONE block, without re-sequencing the page.
   *
   * The only way to change an order was `PUT /blocks` (reorder), which rewrites
   * every row on the page: it sets all of them to negative positions, then
   * assigns 0..n-1, then rescues any it missed — three passes, no transaction,
   * and it depends on an RPC (`clear_block_positions`) that does not exist in
   * any migration, so it has always taken the un-guarded fallback. Running that
   * whole machine to nudge one block is a large risk for a small change.
   *
   * The caller is responsible for picking a free slot: there is a unique index
   * on (page_id, position), so writing an occupied one fails loudly rather than
   * overwriting anything.
   */
  position: z.number().int().optional()
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
    if (validated.position !== undefined) updates.position = validated.position;
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

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE HEADER, THE FOOTER AND HOW IT WORKS CANNOT BE DELETED.
     *
     * Enforced here and not only in the editor, which hides their delete
     * buttons: a page without a footer has no copyright line, no closing
     * action, and nowhere for the contact details and opening hours to appear —
     * and the footer is the block the recipes treat as the boundary that new
     * sections are inserted above, so losing it silently changes where
     * everything added afterwards lands. A page arrived in exactly that state
     * and there was no way, anywhere in the product, to put one back.
     *
     * `process` is here for a second reason as well: `/api/website/booking/
     * intake` reads `services_only` off that block to decide whether a visitor
     * is offered an intake form. Delete the block and the setting goes with it,
     * silently changing what the booking flow does. Hidden is fine — a hidden
     * block still holds its content.
     *
     * Turning it OFF is still allowed and is the right way to take it off the
     * site: `PUT` with `enabled: false` stops it rendering publicly and keeps
     * the block, the owner's settings, and a way back.
     */
    const UNDELETABLE = new Set(['header', 'footer', 'process']);
    if (UNDELETABLE.has(existingBlock.data.block_type)) {
      requestLogger.warn(
        { blockId, pageId: id, blockType: existingBlock.data.block_type },
        'Refused to delete a required block'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'This section cannot be deleted. Switch it off instead to hide it from your site.',
          code: 'BLOCK_REQUIRED'
        },
        { status: 409 }
      );
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
