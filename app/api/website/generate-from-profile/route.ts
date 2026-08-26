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
import { z } from 'zod';

const logger = createLogger({ module: 'WebsiteGenerationAPI' });

const GenerationRequestSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
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

    const { userId } = validationResult.data;

    // 3. Verify user can only generate for themselves
    if (user.id !== userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 403 }
      );
    }

    requestLogger.info({ userId }, 'Starting website generation');

    // 4. Generate website
    const generationService = new WebsiteGenerationService();
    const result = await generationService.generateWebsite(userId);

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
