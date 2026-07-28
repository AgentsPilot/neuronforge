/**
 * GET /api/intake/templates/[id] - Get intake form template by ID
 * Returns a single template with all fields and multilingual labels
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'IntakeTemplateByIdAPI' });

const paramsSchema = z.object({
  id: z.string().uuid()
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // 2. Validate template ID
    const resolvedParams = await params;
    const validation = paramsSchema.safeParse({ id: resolvedParams.id });
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid template ID' },
        { status: 400 }
      );
    }

    const { id: templateId } = validation.data;
    requestLogger.info({ userId: user.id, templateId }, 'Fetching intake template by ID');

    // 3. Get template
    const { data: template, error } = await intakeRepository.getTemplateById(templateId);
    if (error) {
      throw error;
    }

    if (!template) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 }
      );
    }

    requestLogger.info({ userId: user.id, templateId }, 'Template fetched successfully');

    return NextResponse.json({
      success: true,
      template
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch intake template');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
