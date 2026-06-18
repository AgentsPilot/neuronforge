/**
 * Business Settings API
 *
 * GET /api/v2/settings/business - Get current business settings
 * PUT /api/v2/settings/business - Update business settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { OrganizationSettingsService } from '@/lib/services/OrganizationSettingsService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { z } from 'zod';

const logger = createLogger({ module: 'BusinessSettingsAPI' });
const auditTrail = AuditTrailService.getInstance();

const updateSchema = z.object({
  hourly_rate_usd: z.number().min(0).max(10000).optional(),
  currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD']).optional(),
  work_hours_per_day: z.number().min(1).max(24).optional(),
});

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID();
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

    requestLogger.info({ userId: user.id }, 'Fetching business settings');

    // 2. Get settings
    const settingsService = new OrganizationSettingsService();
    const result = await settingsService.getSettings(user.id);

    if (result.error) {
      requestLogger.error({ err: result.error }, 'Failed to get settings');
      return NextResponse.json(
        { success: false, error: 'Failed to load settings' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: result.data });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch business settings');
    return NextResponse.json(
      { success: false, error: 'Failed to load settings' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const correlationId = crypto.randomUUID();
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

    // 2. Validate request body
    const body = await request.json();
    const validationResult = updateSchema.safeParse(body);

    if (!validationResult.success) {
      requestLogger.warn({ errors: validationResult.error }, 'Invalid request body');
      return NextResponse.json(
        { success: false, error: 'Invalid request body', details: validationResult.error.issues },
        { status: 400 }
      );
    }

    requestLogger.info({ userId: user.id, updates: validationResult.data }, 'Updating business settings');

    // 3. Update settings
    const settingsService = new OrganizationSettingsService();
    const result = await settingsService.updateSettings(user.id, validationResult.data);

    if (result.error) {
      requestLogger.error({ err: result.error }, 'Failed to update settings');
      return NextResponse.json(
        { success: false, error: result.error.message || 'Failed to update settings' },
        { status: 400 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail.log({
      action: 'SETTINGS_UPDATED',
      entityType: 'organization',
      entityId: user.id,
      userId: user.id,
      resourceName: 'Business Settings',
      changes: validationResult.data,
      severity: 'info',
      request,
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info({ userId: user.id }, 'Business settings updated');

    return NextResponse.json({ success: true, data: result.data });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to update business settings');
    return NextResponse.json(
      { success: false, error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
