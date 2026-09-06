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
import { isPlausiblePhone, PHONE_MAX_LENGTH } from '@/lib/branding/phone';
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

  /**
   * The number this business publishes to its own clients.
   *
   * Validated against the shared rule rather than a regex written here, so the
   * number this accepts and the number the public pages can turn into a
   * WhatsApp link cannot drift apart. An empty string clears it, which is what
   * the settings form sends when the owner empties the field.
   */
  phone: z
    .string()
    .trim()
    .max(PHONE_MAX_LENGTH, 'Phone number is too long')
    .refine(isPlausiblePhone, 'That does not look like a phone number')
    .nullable()
    .optional(),

  /**
   * The address clients email, and the address they come to.
   *
   * Both accept an empty string, which is how the settings form says "cleared";
   * `.email()` alone would reject that and leave the owner unable to remove a
   * value they had entered.
   *
   * The postal address is free text on purpose. A display address is written
   * the way the business writes it — floor numbers, building names, a landmark
   * — and imposing a structure here would force those into fields that do not
   * fit them. The structured one still exists as `invoice_address`, where it is
   * needed because an invoice is a legal document.
   */
  email: z
    .string()
    .trim()
    .max(200, 'Email address is too long')
    .refine(v => v === '' || z.string().email().safeParse(v).success, 'That does not look like an email address')
    .nullable()
    .optional(),

  address: z
    .string()
    .trim()
    .max(300, 'Address is too long')
    .nullable()
    .optional(),
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
      .select('vertical, sub_vertical, language, company_size, logo_url, show_logo_on_smart_links, phone, email, address')
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
      phone: profile?.phone || null,
      email: profile?.email || null,
      address: profile?.address || null,
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
 * PUT — update the business's branding and contact details.
 *
 * The one write path for the logo and for the published phone number.
 * Deliberately separate from invoice settings, which used to own the logo
 * column and blanked it on every save.
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

    requestLogger.info({ userId: user.id, fields: Object.keys(validated) }, 'Updating business profile');

    /*
     * Branding and contact details are written through separate repository
     * methods, so saving one cannot blank the other. The request may carry
     * either or both.
     */
    const { phone, email, address, ...branding } = validated;
    const contact = { phone, email, address };
    const hasContact = Object.values(contact).some(value => value !== undefined);

    let error: Error | null = null;

    if (Object.keys(branding).length > 0) {
      ({ error } = await businessProfileRepository.updateBranding(user.id, branding));
    }

    if (!error && hasContact) {
      ({ error } = await businessProfileRepository.updateContactDetails(user.id, contact));
    }

    if (error) {
      requestLogger.error({ err: error, userId: user.id }, 'Failed to update business profile');
      return NextResponse.json(
        { success: false, error: 'Failed to update business profile' },
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
      requestLogger.warn({ errors: error.errors }, 'Invalid business profile payload');
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Business profile update failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
