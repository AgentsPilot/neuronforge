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
  /** Whether the client is emailed the form after booking. */
  send_after_booking: z.boolean().optional(),
  /**
   * Accepted and ignored.
   *
   * The form is never a step inside the booking flow now — a long form between
   * a client and the thing they came to do. Kept in the schema so an older
   * client does not get a 400, and in the table so no data is destroyed.
   */
  collect_during_booking: z.boolean().optional()
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

    /**
     * Refuse "enabled, with no form".
     *
     * That state stored cleanly and did nothing: every reader — the booking
     * flow's intake step, the intake email, the manage page — requires a
     * template, so a business could switch intake on, see it saved, and collect
     * nothing, with no error anywhere to explain it.
     *
     * Checked against what would REMAIN after the update, not against the
     * payload, because a partial update that only flips `is_enabled` carries no
     * template_id of its own.
     */
    const { data: existing } = await intakeRepository.getSettings(user.id);

    const willBeEnabled = updates.is_enabled ?? existing?.is_enabled ?? false;
    const willHaveTemplate =
      (updates.template_id !== undefined ? updates.template_id : existing?.template_id) ?? null;

    if (willBeEnabled && !willHaveTemplate) {
      return NextResponse.json(
        {
          success: false,
          error: 'Choose an intake form before turning this on — without one, nothing is collected.',
          code: 'INTAKE_TEMPLATE_REQUIRED'
        },
        { status: 400 }
      );
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
