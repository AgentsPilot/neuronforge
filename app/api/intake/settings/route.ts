/**
 * GET/POST /api/intake/settings - User intake form settings
 * GET: Retrieve user's current intake settings
 * POST: Save/update user's intake settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'IntakeSettingsAPI' });

// Validation schema for POST
const updateSettingsSchema = z.object({
  template_id: z.string().uuid().nullable().optional(),
  is_enabled: z.boolean().optional(),
  collect_during_booking: z.boolean().optional(),
  send_after_booking: z.boolean().optional()
});

/**
 * GET /api/intake/settings
 * Get user's current intake settings with template details
 */
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

    requestLogger.info({ userId: user.id }, 'Fetching intake settings');

    // 2. Get settings with template
    const { data: settings, error } = await intakeRepository.getSettingsWithTemplate(user.id);
    if (error) {
      throw error;
    }

    // Return default settings if none exist
    if (!settings) {
      return NextResponse.json({
        success: true,
        settings: {
          is_enabled: false,
          template_id: null,
          template: null,
          collect_during_booking: true,
          send_after_booking: false
        }
      });
    }

    requestLogger.info({ userId: user.id, isEnabled: settings.is_enabled }, 'Settings fetched');

    return NextResponse.json({
      success: true,
      settings
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch intake settings');
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

/**
 * POST /api/intake/settings
 * Save/update user's intake settings
 */
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
    const validation = updateSettingsSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', details: validation.error.errors },
        { status: 400 }
      );
    }

    const updates = validation.data;
    requestLogger.info({ userId: user.id, updates }, 'Updating intake settings');

    // 3. Validate template_id exists if provided
    if (updates.template_id) {
      const { data: template, error: templateError } = await intakeRepository.getTemplateById(updates.template_id);
      if (templateError) {
        throw templateError;
      }
      if (!template) {
        return NextResponse.json(
          { success: false, error: 'Template not found' },
          { status: 400 }
        );
      }
    }

    // 4. Upsert settings
    const { data: settings, error } = await intakeRepository.upsertSettings(user.id, updates);
    if (error) {
      throw error;
    }

    // 5. Fetch full settings with template for response
    const { data: fullSettings } = await intakeRepository.getSettingsWithTemplate(user.id);

    requestLogger.info({ userId: user.id, settingsId: settings?.id }, 'Settings saved');

    return NextResponse.json({
      success: true,
      settings: fullSettings || settings
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to save intake settings');
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
