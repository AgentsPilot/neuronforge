/**
 * Testimonial Enhancement API
 * POST - Enhance a testimonial quote using AI
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { WebsiteAIContentService } from '@/lib/services/WebsiteAIContentService';
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

    requestLogger.info({ userId: user.id, language: validated.language }, 'Enhancing testimonial');

    const aiService = new WebsiteAIContentService();
    const enhancedQuote = await aiService.enhanceTestimonial(validated.quote, validated.language);

    requestLogger.info({ userId: user.id }, 'Testimonial enhanced successfully');

    return NextResponse.json({
      success: true,
      enhancedQuote,
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
