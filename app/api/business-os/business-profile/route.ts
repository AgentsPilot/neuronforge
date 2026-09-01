/**
 * Business Profile API Endpoint
 *
 * Lightweight endpoint to fetch user's business vertical and language
 * for UI components that need personalization context.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'BusinessProfileAPI' });
const auditTrail = AuditTrailService.getInstance();

/**
 * Branding a business owns and every surface reads: the logo, and whether the
 * public smart-link pages wear it. An explicit null clears the logo, which is
 * why the field is nullable rather than merely optional.
 */
const brandingSchema = z.object({
  logo_url: z.string().url().nullable().optional(),
  show_logo_on_smart_links: z.boolean().optional(),
  /**
   * The business look — colours and fonts.
   *
   * Shared by the website, landing pages, smart links, transactional emails
   * and the invoice PDF, which is why it lives on the business rather than on
   * one web page. Passed through as an object: the shape is the page theme's
   * and is validated where it is rendered, not narrowed here into something
   * the renderers would then have to widen again.
   */
  theme: z.record(z.any()).nullable().optional(),
});

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

    requestLogger.info({ userId: user.id }, 'Fetching business profile context');

    // 2. Fetch business profile
    const { data: profile, error } = await supabaseServer
      .from('business_profiles')
      .select('vertical, sub_vertical, language, company_size, logo_url, show_logo_on_smart_links')
      .eq('user_id', user.id)
      .single();

    if (error) {
      requestLogger.error({ err: error, userId: user.id }, 'Failed to fetch business profile');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch business profile' },
        { status: 500 }
      );
    }

    // 3. Return profile context
    return NextResponse.json({
      success: true,
      vertical: profile?.vertical || null,
      sub_vertical: profile?.sub_vertical || null,
      language: profile?.language || 'en',
      company_size: profile?.company_size || null,
      logo_url: profile?.logo_url || null,
      // Absent means opted in, matching the column default.
      show_logo_on_smart_links: profile?.show_logo_on_smart_links ?? true,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Business profile request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT — update the business's branding.
 *
 * The one write path for the logo. Deliberately separate from invoice settings,
 * which used to own the column and blanked it on every save.
 */
export async function PUT(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = brandingSchema.parse(body);

    if (Object.keys(validated).length === 0) {
      return NextResponse.json(
        { success: false, error: 'Nothing to update' },
        { status: 400 }
      );
    }

    requestLogger.info({ userId: user.id, fields: Object.keys(validated) }, 'Updating business branding');

    const { error } = await businessProfileRepository.updateBranding(user.id, validated);
    if (error) {
      requestLogger.error({ err: error, userId: user.id }, 'Failed to update business branding');
      return NextResponse.json(
        { success: false, error: 'Failed to update branding' },
        { status: 500 }
      );
    }

    auditTrail
      .log({
        action: 'BUSINESS_BRANDING_UPDATED',
        userId: user.id,
        entityType: 'business_profile',
        entityId: user.id,
        changes: validated,
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({ success: true, data: validated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ errors: error.errors }, 'Invalid branding payload');
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Business branding update failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
