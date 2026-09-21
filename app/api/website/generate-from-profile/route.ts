/**
 * Website Generation from Profile API
 * POST - Generate complete website based on business profile
 *
 * This endpoint:
 * 1. Fetches business profile and services
 * 2. Uses LLM to generate website content
 * 3. Creates homepage and blocks
 * 4. Updates profile completeness
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { WebsiteGenerationService } from '@/lib/services/WebsiteGenerationService';
import { newBosGroupId } from '@/lib/business-os/llm/callCatalog';
import { runAiAction, markGenerationResult } from '@/lib/business-os/llm/aiActionAudit';
import { AI_UNAVAILABLE_WEBSITE_WRITING } from '@/lib/business-os/llm/aiUnavailableMessages';
import { z } from 'zod';

const logger = createLogger({ module: 'WebsiteGenerationAPI' });

/**
 * A gpt-4o call building a whole website from a ~4k-token prompt routinely takes
 * 20-60s. Without this the platform default kills the function mid-flight, the
 * caller's `await response.json()` throws, and it lands in a swallowed catch —
 * indistinguishable from "the AI just doesn't work". Matches the ceiling the
 * other LLM routes in this repo already declare.
 */
export const maxDuration = 60;


const GenerationRequestSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  // Both optional, and both set by the setup wizard: it has already created
  // the page and the owner has already chosen a template, so generation fills
  // that page in those colours instead of creating a second site.
  pageId: z.string().uuid('Invalid page ID').optional(),
  templateId: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const validationResult = GenerationRequestSchema.safeParse(body);
    if (!validationResult.success) {
      requestLogger.warn({ errors: validationResult.error.flatten() }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const { userId, pageId, templateId } = validationResult.data;

    // 3. Verify user can only generate for themselves
    if (user.id !== userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // One usage group per generation request; never taken from the request.
    const groupId = newBosGroupId();
    requestLogger.info({ userId, pageId, templateId, groupId }, 'Starting website generation');

    // 4. Generate website for the signed-in account (checked equal above)
    const generationService = new WebsiteGenerationService();
    // One AI action, one audit entry (Layer 3, FR-12). Never awaited on the audit.
    const result = await runAiAction(
      { area: 'website', actionType: 'website_full_site', groupId, trigger: 'user', accountId: user.id, correlationId },
      async (h) => {
        /*
         * `'fail'` (RC-W3): this surface can tell the owner. Unlike the
         * onboarding build — where a site written in plain words beats no site
         * — someone pressing "generate from profile" already has a page, so
         * overwriting it with generic starter copy would be a destructive
         * answer to a request we are refusing. There is no separate pre-check:
         * the switch is read once, inside the service, where the settings are
         * resolved, so nothing can change between checking and calling.
         */
        const generated = await generationService.generateWebsite(user.id, {
          groupId,
          pageId,
          templateId,
          onAiDisabled: 'fail',
        });
        markGenerationResult(h, generated);
        return generated;
      }
    );

    /*
     * Switched off (Layer 2 FR-14). HTTP **200** with a code, not a 500: an
     * operator turned the feature off, nothing failed, and NOTHING WAS
     * WRITTEN — the refusal returns before the first write, so the owner's page
     * is exactly as it was. The English sentence rides along for any caller
     * that has no label map; the website page prefers its own translation.
     */
    if (!result.success && result.code === 'ai_unavailable') {
      requestLogger.info({ userId, pageId, reason: 'disabled' }, 'Website generation refused: website AI is switched off');
      return NextResponse.json({
        success: false,
        code: 'ai_unavailable',
        error: AI_UNAVAILABLE_WEBSITE_WRITING.en,
      });
    }

    if (!result.success) {
      requestLogger.error({ userId, error: result.error }, 'Website generation failed');
      return NextResponse.json(
        { success: false, error: result.error || 'Generation failed' },
        { status: 500 }
      );
    }

    requestLogger.info(
      { userId, homepageId: result.homepageId, blocksCreated: result.blocksCreated },
      'Website generation completed'
    );

    return NextResponse.json({
      success: true,
      homepageId: result.homepageId,
      blocksCreated: result.blocksCreated,
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Website generation request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
