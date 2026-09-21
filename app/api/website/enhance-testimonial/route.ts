/**
 * Testimonial Enhancement API
 * POST - Enhance a testimonial quote using AI
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { WebsiteAIContentService } from '@/lib/services/WebsiteAIContentService';
import { newBosGroupId } from '@/lib/business-os/llm/callCatalog';
import { runAiAction } from '@/lib/business-os/llm/aiActionAudit';
import { z } from 'zod';

const logger = createLogger({ module: 'EnhanceTestimonialAPI' });

const EnhanceTestimonialSchema = z.object({
  quote: z.string().min(1).max(2000),
  language: z.enum(['en', 'es', 'he']).optional().default('en')
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = EnhanceTestimonialSchema.parse(body);

    // One usage group per enhancement request; never taken from the request.
    const groupId = newBosGroupId();
    requestLogger.info({ userId: user.id, language: validated.language, groupId }, 'Enhancing testimonial');

    const aiService = new WebsiteAIContentService();
    // One AI action, one audit entry (Layer 3, FR-12).
    const enhanced = await runAiAction(
      { area: 'website', actionType: 'website_testimonial_enhance', groupId, trigger: 'user', accountId: user.id },
      () =>
        aiService.enhanceTestimonial(validated.quote, validated.language, {
          userId: user.id,
          groupId,
        })
    );

    // Switched off (Layer 2 FR-14): HTTP 200 with a code, not a 5xx — see the
    // regenerate route for why. The owner's quote is returned untouched.
    if (!enhanced.ok) {
      requestLogger.info(
        { userId: user.id, reason: 'disabled' },
        'Testimonial enhancement refused: website AI writing is switched off'
      );
      return NextResponse.json({
        success: false,
        code: enhanced.code,
        originalQuote: validated.quote
      });
    }

    requestLogger.info({ userId: user.id }, 'Testimonial enhanced successfully');

    return NextResponse.json({
      success: true,
      enhancedQuote: enhanced.text,
      originalQuote: validated.quote
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to enhance testimonial');
    return NextResponse.json(
      { success: false, error: 'Failed to enhance testimonial' },
      { status: 500 }
    );
  }
}
