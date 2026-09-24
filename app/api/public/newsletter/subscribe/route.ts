/**
 * A newsletter signup on a business's own public page.
 *
 * NOT `/api/newsletter/subscribe`, which is AgentPilot's own website footer and
 * writes `newsletter_subscribers` — a table with no `user_id` at all. This one is
 * per business, and it deliberately does NOT create a CRM contact: a subscriber
 * is an audience, not a deal, and a contact carrying a stage no pipeline column
 * recognises is invisible, while one carrying `lead` gets chased by the cold-lead
 * detector for an enquiry they never made.
 *
 * Public and unauthenticated, like the other website form routes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { businessSubscriberRepository } from '@/lib/repositories/BusinessSubscriberRepository';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';
import { beginDoubleOptIn } from '@/lib/consent/doubleOptIn';
import { buildAttributionFromRequest } from '@/lib/utils/attribution';
import { enrichCaptureAttribution } from '@/lib/business-os/enrichCaptureAttribution';

const logger = createLogger({ module: 'PublicNewsletterSubscribeAPI' });

const SubscribeSchema = z
  .object({
    subdomain: z.string().max(100).optional(),
    userCode: z.string().max(100).optional(),
    email: z.string().email('A valid email is required').max(200),
    /** Only where a surface actually collects one. Never derived from the address. */
    name: z.string().max(200).optional(),
    locale: z.string().max(8).optional(),
    page_url: z.string().max(2048).optional(),
  })
  .refine((d) => Boolean(d.subdomain || d.userCode), {
    message: 'Either subdomain or userCode is required',
  });

/** Same resolution the other public form routes use. */
async function resolveOwner(subdomain?: string, userCode?: string): Promise<string | null> {
  if (subdomain) {
    const { data } = await supabaseServer
      .from('website_pages')
      .select('user_id')
      .eq('subdomain', subdomain)
      .limit(1)
      .maybeSingle();
    return data?.user_id ?? null;
  }

  if (userCode) {
    const { data } = await supabaseServer
      .from('business_profiles')
      .select('user_id')
      .eq('user_code', userCode.toLowerCase())
      .maybeSingle();
    return data?.user_id ?? null;
  }

  return null;
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = SubscribeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const ownerId = await resolveOwner(data.subdomain, data.userCode);

    if (!ownerId) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE DEDUPE RULE, and the reason it lives here.
     *
     * Subscribers are not contacts, so the same person can exist in two stores.
     * If this address is ALREADY a contact of this business — a client, an
     * enquiry — then they are not a new subscriber: they are an existing person
     * giving permission. Record the consent against the contact they already
     * are and create no roster row.
     *
     * This is the only place the split can be prevented. Every other route that
     * creates a contact is covered from the other direction by the
     * `link_subscriber_to_contact` trigger.
     * ───────────────────────────────────────────────────────────────────────
     */
    const { data: existingContact } = await supabaseServer
      .from('crm_contacts')
      .select('id')
      .eq('user_id', ownerId)
      .ilike('email', data.email.trim())
      .limit(1)
      .maybeSingle();

    const attribution = buildAttributionFromRequest(request, {
      captureChannel: 'form',
      pageUrl: data.page_url,
      generateSessionId: true,
    });

    /*
     * Where they came from: the page KIND, and the smart link if one sent them.
     * Shared with every other capture route — see `enrichCaptureAttribution`.
     */
    await enrichCaptureAttribution(attribution, {
      subdomain: data.subdomain,
      pageUrl: data.page_url,
    });

    /*
     * The roster row comes FIRST, before any decision about the email.
     *
     * It used to come after an "already consented, nothing to do" early return,
     * which meant somebody who had consented through an older flow — or through
     * a different form — could sign up to the newsletter and never appear on
     * the list at all. The early return made that permanent: every subsequent
     * attempt took the same branch. Whether to send a confirmation is a
     * separate question from whether they belong on the roster.
     */
    if (!existingContact) {
      const { error } = await businessSubscriberRepository.subscribe({
        userId: ownerId,
        email: data.email,
        name: data.name?.trim() || null,
        source: 'newsletter',
        attribution: { ...attribution } as Record<string, unknown>,
      });

      if (error) {
        // The roster row IS the signup. Losing it loses the person, so unlike
        // the confirmation email this failure is reported rather than swallowed.
        requestLogger.error({ err: error, ownerId }, 'Could not record the subscriber');
        return NextResponse.json(
          { success: false, error: 'Could not complete the signup' },
          { status: 500 }
        );
      }
    }

    /*
     * Already consented? Then they are on the list, and asking them to confirm
     * something they confirmed already is noise. The roster is brought into
     * line with that, and the caller is told so it can say "you are already
     * subscribed" rather than "check your email" for a message that is not
     * coming.
     */
    const { data: consent } = await marketingConsentRepository.getState(ownerId, data.email);
    if (consent?.consented) {
      await businessSubscriberRepository.markConfirmed(ownerId, data.email);

      requestLogger.info({ ownerId }, 'Signup for an address that had already confirmed');
      return NextResponse.json({ success: true, data: { alreadySubscribed: true } });
    }

    void beginDoubleOptIn({
      userId: ownerId,
      contactId: existingContact?.id ?? null,
      email: data.email,
      sourceSurface: 'newsletter',
      locale: data.locale,
    });

    requestLogger.info(
      { ownerId, existingContact: Boolean(existingContact) },
      'Newsletter signup recorded; confirmation requested'
    );

    return NextResponse.json({ success: true, data: { alreadySubscribed: false } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Newsletter signup failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
