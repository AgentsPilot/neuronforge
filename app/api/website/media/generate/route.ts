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
import { generateImage } from '@/lib/services/GeneratedImageService';

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

    const result = await generateImage(
      user.id,
      validated.prompt,
      validated.aspect,
      validated.section ?? 'custom'
    );

    if (!result.ok) {
      /*
       * Each of these is something the owner can act on, so each says which it
       * is rather than collapsing into "something went wrong": no generation
       * configured, a request for a photograph of people, or a genuine failure.
       */
      const status = result.reason === 'depicts_people' ? 400 : 503;
      requestLogger.info({ userId: user.id, reason: result.reason }, 'Image generation declined');
      return NextResponse.json({ success: false, reason: result.reason }, { status });
    }

    requestLogger.info({ userId: user.id, section: validated.section }, 'Generated a picture');
    return NextResponse.json({ success: true, data: { url: result.url, description: result.description } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }
    requestLogger.error({ err: error }, 'Image generation failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
