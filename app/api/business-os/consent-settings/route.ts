/**
 * Marketing consent settings.
 * GET/PUT /api/business-os/consent-settings
 *
 * The business's own wording, its privacy notice, and its postal address —
 * plus, on GET, the two numbers that make the send gate legible: how many
 * contacts there are, and how many of them can actually be emailed.
 *
 * Without those two numbers the owner meets the gate as the platform silently
 * refusing to send, and files it as a bug.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';
import { defaultStatement } from '@/lib/consent/defaultStatements';
import { generatePrivacyPolicy } from '@/lib/consent/privacyPolicy';
import { MARKETING_SENDING_ENABLED } from '@/lib/consent/marketingGate';

const logger = createLogger({ module: 'ConsentSettingsAPI' });

const SettingsSchema = z.object({
  capture_enabled: z.boolean().optional(),
  statement_en: z.string().max(2000).nullable().optional(),
  statement_he: z.string().max(2000).nullable().optional(),
  statement_es: z.string().max(2000).nullable().optional(),
  privacy_policy_mode: z.enum(['hosted', 'url', 'none']).optional(),
  privacy_policy_url: z.string().max(2048).nullable().optional(),
  privacy_policy_body: z.string().max(50000).nullable().optional(),
  postal_address: z.string().max(500).nullable().optional(),
  label_as_advertisement: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const [{ data: settings }, { data: profile }, { data: mailable }, { data: total }] =
      await Promise.all([
        marketingConsentRepository.settings(user.id),
        businessProfileRepository.findByUserId(user.id),
        marketingConsentRepository.countMailable(user.id),
        marketingConsentRepository.countContacts(user.id),
      ]);

    const businessName = profile?.company_name || 'this business';

    return NextResponse.json({
      success: true,
      data: {
        settings,
        /* Shown greyed in each empty field, so an owner can see what their
           visitors are being asked before deciding to change it. */
        defaults: {
          statement_en: defaultStatement('en', businessName),
          statement_he: defaultStatement('he', businessName),
          statement_es: defaultStatement('es', businessName),
          privacy_policy_body: generatePrivacyPolicy({
            businessName,
            postalAddress: settings?.postal_address ?? null,
          }),
        },
        counts: { mailable: mailable ?? 0, contacts: total ?? 0 },
        /*
         * What still stands between a consented contact and an actual email.
         * Reported rather than inferred: an owner who has collected fifty
         * opt-ins deserves to know why nothing is going out.
         */
        sending: {
          enabled: MARKETING_SENDING_ENABLED,
          hasPostalAddress: Boolean(settings?.postal_address?.trim()),
        },
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to load consent settings');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = SettingsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid settings', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const patch: Record<string, unknown> = { ...parsed.data };

    // Stamped only when the text actually changes, so the "last updated" line
    // on the public page means what it says.
    if (parsed.data.privacy_policy_body !== undefined) {
      patch.privacy_policy_updated_at = new Date().toISOString();
    }

    const { data, error } = await marketingConsentRepository.upsertSettings(user.id, patch);
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to save consent settings');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
