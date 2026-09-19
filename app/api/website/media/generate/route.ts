/**
 * Make a picture for this business.
 *
 * Sits behind the button in the editor's image picker. Stock covers the common
 * case for free; this is for when the owner wants something stock cannot give.
 *
 * @module app/api/website/media/generate
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { generateImage, generationAllowance } from '@/lib/services/GeneratedImageService';
import { newBosGroupId } from '@/lib/business-os/llm/callCatalog';
import { runAiAction } from '@/lib/business-os/llm/aiActionAudit';

const logger = createLogger({ module: 'WebsiteMediaGenerateAPI' });

const GenerateSchema = z.object({
  /*
   * Bounded deliberately. A few words describe a picture; a paragraph is
   * somebody pasting their whole page in, which produces a worse image and a
   * larger bill.
   */
  prompt: z.string().trim().min(3).max(300),
  aspect: z.enum(['wide', 'portrait', 'square']).default('wide'),
  section: z.string().trim().max(40).optional(),
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const validated = GenerateSchema.parse(await request.json());

    /*
     * One grouping id per owner request, minted here — the only entry point —
     * and logged with the correlation id, so the image's ledger row can be tied
     * back to this request. The account is the session user; nothing about
     * attribution is read from the body (Layer 1.5 FR-11, FR-12).
     */
    const groupId = newBosGroupId();
    requestLogger.info({ userId: user.id, groupId, section: validated.section }, 'Image generation requested');

    // One AI action, one audit entry (Layer 3, FR-15). A reuse-cache hit, a
    // refusal or the daily cap makes no provider call, so it writes none.
    const result = await runAiAction(
      { area: 'images', actionType: 'image_generation', groupId, trigger: 'user', accountId: user.id, correlationId },
      async (h) => {
        const outcome = await generateImage(
          { userId: user.id, groupId },
          validated.prompt,
          validated.aspect,
          validated.section ?? 'custom'
        );
        if (!outcome.ok && outcome.reason === 'failed') h.markFailed('image_failed');
        return outcome;
      }
    );

    if (!result.ok) {
      /*
       * Each of these is something the owner can act on, so each says which it
       * is rather than collapsing into "something went wrong": no generation
       * configured, a request for a photograph of people, or a genuine failure.
       */
      const status =
        result.reason === 'depicts_people' ? 400
        : result.reason === 'limit_reached' ? 429
        : 503;
      requestLogger.info({ userId: user.id, reason: result.reason }, 'Image generation declined');
      return NextResponse.json(
        {
          success: false,
          reason: result.reason,
          // The picker prints the numbers, so it has to be told them rather
          // than left to phrase a limit it cannot see.
          ...(result.reason === 'limit_reached'
            ? { allowance: { used: result.used, limit: result.limit, remaining: 0 } }
            : {}),
        },
        { status }
      );
    }

    requestLogger.info({ userId: user.id, section: validated.section }, 'Generated a picture');

    /*
     * The allowance travels with every successful generation.
     *
     * Pictures can be generated from the media picker on any block, on any
     * page, and from the wizard — so a count held by one screen is stale as
     * soon as another is used. Returning it here keeps whichever screen the
     * owner is on truthful without it having to ask again.
     */
    return NextResponse.json({
      success: true,
      data: { url: result.url, description: result.description },
      allowance: await generationAllowance(user.id),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }
    requestLogger.error({ err: error }, 'Image generation failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
