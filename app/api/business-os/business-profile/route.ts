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
import { organizationRepository } from '@/lib/repositories/OrganizationRepository';
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

  /**
   * Send the morning briefing by email as well as showing it on the dashboard.
   *
   * Off unless the owner turns it on. Meaningful only once a timezone is set on
   * user_preferences — without one "morning" resolves to UTC, and the settings
   * form gates the switch on that rather than sending at the wrong hour.
   */
  daily_briefing_email_enabled: z.boolean().optional(),

  /**
   * The alert that fires the moment somebody reaches this business.
   *
   * Unlike the briefing above, it defaults ON: it only ever sends because a
   * real person submitted a form or booked, and not being told was the bug.
   */
  lead_alert_email_enabled: z.boolean().optional(),

  /**
   * Reply to a new lead automatically, ~15 minutes after the owner is alerted.
   *
   * OFF by default, unlike the alert above. Being told is something every
   * business wants; having the platform write to a client on their behalf is a
   * decision they should make deliberately.
   */
  lead_autosend_enabled: z.boolean().optional(),

  /**
   * The organisation's own name and the four answers stored beside it.
   *
   * Written here rather than by the settings form itself, which reached
   * straight into `organizations` from the browser and skipped the write
   * entirely when the account had no row — which is every account built by the
   * onboarding chat, because nothing in that path creates one. The form
   * reported success and stored nothing.
   */
  organization: z
    .object({
      name: z.string().trim().max(200).optional(),
      industry: z.string().trim().max(100).nullable().optional(),
      company_size: z.string().trim().max(50).nullable().optional(),
      primary_goal: z.string().trim().max(100).nullable().optional(),
      technical_level: z.string().trim().max(50).nullable().optional(),
      work_hours_per_day: z.number().min(1).max(24).optional(),
    })
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

    /*
     * The briefing opt-in, read separately and tolerantly.
     *
     * Deliberately NOT added to the select above. Postgres rejects the entire
     * select for one unknown column, so naming a freshly-migrated column there
     * takes the whole settings page down on any environment where
     * 20260911_daily_briefing.sql has not been applied yet — and this repo has
     * carried an unapplied migration for over a week before now. Its own query
     * fails alone, and the switch reads as off until the column exists.
     */
    let dailyBriefingEmailEnabled = false;
    /*
     * Defaults to TRUE where the briefing defaults to false, matching the two
     * column defaults. An unreadable switch must not report "off" here: the
     * send path treats an unreadable switch as ON, and a settings screen that
     * disagreed with it would show the alert disabled while mail kept arriving.
     */
    let leadAlertEmailEnabled = true;
    /** Opt-in, so an unreadable switch reports off — the safe direction here. */
    let leadAutosendEnabled = false;
    try {
      const { data: notifyPrefs, error: notifyError } = await supabaseServer
        .from('business_profiles')
        .select('daily_briefing_email_enabled, lead_alert_email_enabled, lead_autosend_enabled')
        .eq('user_id', user.id)
        .maybeSingle();

      if (notifyError) throw notifyError;
      dailyBriefingEmailEnabled = Boolean(notifyPrefs?.daily_briefing_email_enabled);
      leadAlertEmailEnabled = notifyPrefs?.lead_alert_email_enabled ?? true;
      leadAutosendEnabled = Boolean(notifyPrefs?.lead_autosend_enabled);
    } catch (notifyError) {
      requestLogger.warn(
        { err: notifyError, userId: user.id },
        'Notification preferences unreadable; briefing reported off, lead alert on'
      );
    }

    // 3. Return profile context
    return NextResponse.json({
      success: true,
      daily_briefing_email_enabled: dailyBriefingEmailEnabled,
      lead_alert_email_enabled: leadAlertEmailEnabled,
      lead_autosend_enabled: leadAutosendEnabled,
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
    const {
      phone,
      email,
      address,
      daily_briefing_email_enabled,
      lead_alert_email_enabled,
      lead_autosend_enabled,
      organization,
      ...branding
    } = validated;
    const contact = { phone, email, address };
    const hasContact = Object.values(contact).some(value => value !== undefined);

    let error: Error | null = null;

    if (Object.keys(branding).length > 0) {
      ({ error } = await businessProfileRepository.updateBranding(user.id, branding));
    }

    if (!error && hasContact) {
      ({ error } = await businessProfileRepository.updateContactDetails(user.id, contact));
    }

    /*
     * Notification preferences get their own write for the same reason as the
     * two above, and one more: `updateBranding` takes a field allow-list, so
     * letting this ride along in the rest-spread would have it silently
     * dropped — a switch that flips in the UI, reports success, and is off
     * again on the next reload.
     */
    if (
      !error &&
      (daily_briefing_email_enabled !== undefined ||
        lead_alert_email_enabled !== undefined ||
        lead_autosend_enabled !== undefined)
    ) {
      ({ error } = await businessProfileRepository.updateNotificationPreferences(user.id, {
        daily_briefing_email_enabled,
        lead_alert_email_enabled,
        lead_autosend_enabled,
      }));
    }

    /*
     * The organisation row, CREATED if it is not there.
     *
     * `getOrCreateForUser` rather than an update: an account built by the
     * onboarding chat has no organisation at all, and the settings form's old
     * `if (orgId)` guard meant those four answers were dropped on the floor
     * while the form said "Saved". Merged into whatever the row already holds,
     * so writing one answer cannot blank the other three.
     */
    if (!error && organization) {
      const { name, ...orgSettings } = organization;
      const { data: org, error: orgError } = await organizationRepository.getOrCreateForUser(user.id);

      if (orgError || !org) {
        error = orgError || new Error('Could not resolve an organization for this user');
      } else {
        ({ error } = await organizationRepository.update(org.id, user.id, {
          ...(name !== undefined ? { name } : {}),
          settings: { ...(org.settings || {}), ...orgSettings },
        }));
      }
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
