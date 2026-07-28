/**
 * GET /api/intake/templates - List intake form templates
 * Returns templates filtered by user's vertical, or all templates if vertical unknown
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'IntakeTemplatesAPI' });

export async function GET(request: NextRequest) {
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

    requestLogger.info({ userId: user.id }, 'Fetching intake templates');

    // 2. Get user's vertical from business profile
    const { data: profile } = await businessProfileRepository.findByUserId(user.id);
    const vertical = profile?.vertical || 'other';

    // 3. Get templates for user's vertical
    const { data: verticalTemplates, error: verticalError } = await intakeRepository.listTemplatesByVertical(vertical);
    if (verticalError) {
      throw verticalError;
    }

    // 4. Also get generic templates if vertical is not 'other'
    let allTemplates = verticalTemplates || [];
    if (vertical !== 'other') {
      const { data: genericTemplates } = await intakeRepository.listTemplatesByVertical('other');
      if (genericTemplates && genericTemplates.length > 0) {
        allTemplates = [...allTemplates, ...genericTemplates];
      }
    }

    requestLogger.info(
      { userId: user.id, vertical, count: allTemplates.length },
      'Templates fetched successfully'
    );

    return NextResponse.json({
      success: true,
      vertical,
      templates: allTemplates
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch intake templates');
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
