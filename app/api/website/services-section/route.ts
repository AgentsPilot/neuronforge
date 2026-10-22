/**
 * Does this business have a website that does not mention what it sells?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GAP THIS CLOSES
 *
 * A site is generated ONCE, at build, from the answers the interview collected.
 * `WebsiteGenerationService.planSections` reads `sellsSomething` and omits the
 * services section when the answer is no — correct at the time, and the right
 * call for a business whose plan is a presence and a contact form.
 *
 * Nothing regenerates it. So an owner who starts with no catalogue, publishes a
 * site, and later publishes their first service ends up with a bookable service
 * and a live website that never mentions it. Nothing tells them: the setup
 * checklist's `website` step is already complete, so it stays silent, and the
 * public route's empty-section filter does not apply — there is no services
 * block to drop.
 *
 * WHY A PROMPT AND NOT AN AUTOMATIC INSERT
 *
 * Writing a section into a page the owner may have since arranged by hand is a
 * surprise that is awkward to undo, and it would fire on a page they
 * deliberately stripped back. Asking costs one click and cannot be wrong.
 *
 * GET answers whether to ask. POST does it, building the block from the same
 * default content the Add Section picker uses.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module app/api/website/services-section
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { SchedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';

const logger = createLogger({ module: 'WebsiteServicesSectionAPI' });

/**
 * What a new services block starts as.
 *
 * `services: []` on purpose — every public surface replaces the stored array
 * with the live catalogue at read time (`loadLiveServiceCards`), so storing a
 * snapshot here would be a second copy that drifts. The title and layout are
 * the ones the Add Section picker writes, so a section added from either place
 * is the same section.
 */
const SERVICES_BLOCK_CONTENT = {
  title: 'Services',
  subtitle: 'What we offer',
  services: [],
  layout: 'grid',
} as const;

/** The homepage, its blocks, and whether anything is bookable. */
async function resolve(userId: string) {
  const pageRepo = new WebsitePageRepository(supabaseServer);
  const blockRepo = new WebsiteBlockRepository(supabaseServer);
  const serviceRepo = new SchedulingServiceRepository(supabaseServer);

  const [homepage, bookable] = await Promise.all([
    pageRepo.getHomepage(userId),
    serviceRepo.listBookable(userId),
  ]);

  const page = homepage.data;
  if (!page) return { page: null, missing: false, blocks: [] };

  const blocks = await blockRepo.findByPageId(page.id);
  const hasServicesBlock = (blocks.data || []).some(block => block.block_type === 'services');

  return {
    page,
    blocks: blocks.data || [],
    /*
     * Only worth asking when there is something to show AND nowhere showing
     * it. A business with no bookable service is the case the omission was
     * right for, and must never be nagged about it.
     */
    missing: !hasServicesBlock && (bookable.data?.length ?? 0) > 0,
  };
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { page, missing } = await resolve(user.id);

    return NextResponse.json({
      success: true,
      data: { missing, pageId: page?.id ?? null },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Could not check for a services section');
    /*
     * Fails towards NOT asking. A failed check must not put a prompt in front
     * of an owner about a page it could not read — the same direction
     * `automationApplies` fails in, and for the same reason.
     */
    return NextResponse.json({ success: true, data: { missing: false, pageId: null } });
  }
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { page, blocks, missing } = await resolve(user.id);

    if (!page) {
      return NextResponse.json(
        { success: false, error: 'There is no website to add a section to.' },
        { status: 404 }
      );
    }

    /*
     * Re-checked here rather than trusting the GET. Two tabs, or a second
     * press before the first returns, would otherwise write two services
     * blocks — and two blocks of one type share an anchor id, which breaks
     * menu navigation silently. The Add Section handler guards the same way
     * for the same reason.
     */
    if (!missing) {
      return NextResponse.json({ success: true, data: { added: false, pageId: page.id } });
    }

    const blockRepo = new WebsiteBlockRepository(supabaseServer);
    const position = Math.max(...blocks.map(block => block.position), -1) + 1;

    const created = await blockRepo.create({
      page_id: page.id,
      block_type: 'services',
      content: { ...SERVICES_BLOCK_CONTENT },
      position,
      is_enabled: true,
    });

    if (created.error) {
      requestLogger.error({ err: created.error, pageId: page.id }, 'Could not add the services section');
      return NextResponse.json(
        { success: false, error: 'Could not add the section. Try again from the website editor.' },
        { status: 500 }
      );
    }

    requestLogger.info({ userId: user.id, pageId: page.id, position }, 'Added a services section to the website');

    return NextResponse.json({ success: true, data: { added: true, pageId: page.id } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Could not add the services section');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not add the section. Try again from the website editor.',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
