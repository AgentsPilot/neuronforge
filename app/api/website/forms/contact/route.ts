/**
 * Website Contact Form Submission API
 * POST - Process contact form submissions from public websites
 *
 * This endpoint:
 * 1. Validates the form data
 * 2. Creates or updates a CRM contact (source: 'website_form')
 * 3. Alerts the business owner by email (LeadAlertService)
 * 4. Optionally triggers an email sequence
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { captureEnquiry } from '@/lib/business-os/leads/captureEnquiry';
import { z } from 'zod';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { notifyOwnerOfLead } from '@/lib/services/LeadAlertService';
import { buildAttributionFromRequest } from '@/lib/utils/attribution';
import { enrichCaptureAttribution } from '@/lib/business-os/enrichCaptureAttribution';
import { ConsentInputSchema } from '@/lib/validation/consent';
import { recordConsent } from '@/lib/consent/recordConsent';
import { beginDoubleOptIn } from '@/lib/consent/doubleOptIn';
import { businessSubscriberRepository } from '@/lib/repositories/BusinessSubscriberRepository';
import { getWebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';


const logger = createLogger({ module: 'WebsiteContactFormAPI' });

// Form submission schema
// Supports both subdomain (website) and userCode (standalone conversion pages)
const ContactFormSchema = z.object({
  subdomain: z.string().optional(),
  userCode: z.string().optional(),
  /*
   * OPTIONAL, because the newsletter surfaces genuinely have no name to give.
   * They used to invent one from the address — `offir.omer@…` became a contact
   * called "offir.omer" — which put fabricated personal data in the CRM and
   * made it indistinguishable from a name someone actually typed.
   * `first_name` is nullable; an unnamed contact is honest.
   */
  name: z.string().max(200).optional(),
  /*
   * TRIMMED AND LOWERCASED BEFORE IT IS VALIDATED, NOT AFTER.
   *
   * `z.string().email()` REJECTS a stray space: " a@b.com" is invalid to Zod
   * and the route answered 400 "Invalid email address" over a perfectly good
   * address. The public booking form made that routine — it tested
   * `clientEmail.trim()` and then submitted `clientEmail` — so a visitor whose
   * keyboard or paste left a trailing space was told their own email was wrong,
   * with nothing to act on because it looks correct on screen.
   *
   * Lowercased for the other half: a domain is case-insensitive by spec and
   * every real provider treats the local part that way too, while the contact
   * lookups match with `=`. `Offir.Omer@…` therefore missed the existing
   * `offir.omer@…` row and created a SECOND contact, with its own bookings and
   * its own money hanging off it.
   *
   * At the boundary rather than the call sites: everything downstream — the
   * lookup, the insert, the email that gets sent — then works from one spelling.
   */
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  phone: z.string().optional(),
  message: z.string().min(1, 'Message is required').max(5000),
  service_interest: z.string().optional(),
  referral_source: z.string().optional(),
  /** Which form this came from, where it is not the general contact form. */
  source: z.enum(['website_form', 'newsletter']).optional(),
  /*
   * Marketing consent now lives in `marketing_consent_events`, which records
   * the wording, the method and the moment. The boolean that used to sit here
   * went into a JSONB blob with none of that, was never sent by any UI, and is
   * `false` on every row that has it. A second, weaker copy of an authoritative
   * record is guaranteed to drift, so it is gone rather than kept in sync.
   */
  consent: ConsentInputSchema,
  page_url: z.string().optional()
}).refine(data => data.subdomain || data.userCode, {
  message: 'Either subdomain or userCode is required'
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json();

    // Validate input
    const validationResult = ContactFormSchema.safeParse(body);
    if (!validationResult.success) {
      requestLogger.warn({ errors: validationResult.error.flatten() }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid form data', details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const data = validationResult.data;

    // Extract attribution data from request (UTM params, referrer, etc.)
    const attribution = buildAttributionFromRequest(request, {
      captureChannel: 'form',
      pageUrl: data.page_url,
      generateSessionId: true
    });

    /*
     * Where they came from: the page KIND, and the smart link if one sent them.
     * Shared with every other capture route, because five copies of this had
     * drifted into three different answers — see `enrichCaptureAttribution`.
     */
    await enrichCaptureAttribution(attribution, {
      subdomain: data.subdomain,
      pageUrl: data.page_url,
    });

    let ownerId: string;

    // Look up owner by subdomain (website) or userCode (standalone conversion page)
    if (data.subdomain) {
      const { data: websitePage, error: pageError } = await getWebsitePageRepository(supabaseServer).findBySubdomainAny(data.subdomain);

      if (pageError || !websitePage) {
        requestLogger.warn({ subdomain: data.subdomain }, 'Website not found');
        return NextResponse.json(
          { success: false, error: 'Website not found' },
          { status: 404 }
        );
      }
      ownerId = websitePage.user_id;
    } else if (data.userCode) {
      const { data: businessProfile, error: profileError } = await supabaseServer
        .from('business_profiles')
        .select('user_id')
        .eq('user_code', data.userCode.toLowerCase())
        .single();

      if (profileError || !businessProfile) {
        requestLogger.warn({ userCode: data.userCode }, 'User code not found');
        return NextResponse.json(
          { success: false, error: 'User not found' },
          { status: 404 }
        );
      }
      ownerId = businessProfile.user_id;
    } else {
      return NextResponse.json(
        { success: false, error: 'Either subdomain or userCode is required' },
        { status: 400 }
      );
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * COMPATIBILITY SHIM — delete once no stale bundles remain in the wild.
     *
     * Newsletter signups now post to `/api/public/newsletter/subscribe`. A
     * visitor holding the previous JavaScript bundle still posts HERE with
     * `source: 'newsletter'`, and the two obvious responses are both bad:
     * rejecting it loses the address silently, because the form shows its
     * thank-you either way; accepting it as an enquiry recreates the exact bug
     * this work removes — a subscriber filed as a lead and chased for a message
     * they never sent.
     *
     * So it is routed to the subscriber path and returns before any contact
     * exists.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (data.source === 'newsletter') {
      const { error: subscribeError } = await businessSubscriberRepository.subscribe({
        userId: ownerId,
        email: data.email,
        name: data.name?.trim() || null,
        source: 'newsletter',
        attribution: { ...attribution } as Record<string, unknown>,
      });

      if (subscribeError) {
        requestLogger.error({ err: subscribeError, ownerId }, 'Legacy newsletter signup failed');
        return NextResponse.json(
          { success: false, error: 'Could not complete the signup' },
          { status: 500 }
        );
      }

      void beginDoubleOptIn({
        userId: ownerId,
        contactId: null,
        email: data.email,
        sourceSurface: 'newsletter',
        locale: data.consent?.statement_locale,
      });

      requestLogger.info({ ownerId }, 'Newsletter signup received on the legacy endpoint');
      return NextResponse.json({ success: true, message: 'Thank you for subscribing.' });
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE ROW THIS BECOMES IS NOT THIS ROUTE'S RULE ANY MORE.
     *
     * Stage resolution, find-or-create by address, which of
     * `first_website_message` / `last_website_message` gets written, and the
     * note in the owner's own language all moved to `captureEnquiry`. They
     * were inline here because this form was the only caller; it is not any
     * more, and the one thing that must hold is that an enquiry read out of a
     * mailbox becomes the SAME row as one typed into this form.
     *
     * Everything below — consent, the owner's alert, the greeting — stays,
     * because none of it is part of "which row does this become".
     * ───────────────────────────────────────────────────────────────────────
     */
    const { contactId, isNewContact } = await captureEnquiry({
      ownerId,
      email: data.email,
      name: data.name,
      phone: data.phone,
      message: data.message,
      serviceInterest: data.service_interest,
      referralSource: data.referral_source,
      pageUrl: data.page_url,
      source: data.source ?? 'website_form',
      attribution: attribution as unknown as Record<string, unknown>,
    });

    // Send appropriate email based on whether contact is new or returning (non-blocking)
    /*
     * A display name for the emails and the owner alert. The address is the
     * fallback, and only HERE — it is how to address someone in a sentence,
     * not a value written into the name column.
     */
    const displayName = data.name?.trim() || data.email;

    const emailData = {
      name: displayName,
      email: data.email,
      message: data.message,
      serviceInterest: data.service_interest
    };

    /*
     * Marketing consent, where the visitor gave it.
     *
     * Deliberately after the contact exists and deliberately non-blocking: a
     * failure here must lose a consent record, never a lead. `recordConsent`
     * swallows its own errors for the same reason, and an untouched checkbox
     * writes nothing at all rather than recording a withdrawal.
     */
    void recordConsent({
      userId: ownerId,
      contactId,
      email: data.email,
      consent: data.consent,
      sourceSurface: 'website_form',
      sourcePageUrl: data.page_url ?? null,
      attribution,
    });

    /*
     * Tell the OWNER. This is the step both of these routes claimed to do in
     * their header and never did — the two sends below go to the visitor, and
     * nothing went to the business at all, so an enquiry sat unseen until
     * somebody happened to open the CRM.
     *
     * Non-blocking, like the sends below it: a visitor's form must not fail
     * because a mail provider is slow.
     */
    notifyOwnerOfLead({
      ownerId,
      contactId,
      kind: 'enquiry',
      contactName: displayName,
      contactEmail: data.email,
      phone: data.phone,
      message: data.message,
      serviceInterest: data.service_interest,
      referralSource: data.referral_source,
      pageUrl: data.page_url,
    }).catch(err => requestLogger.warn({ err, contactId }, 'Owner alert failed (non-blocking)'));

    if (isNewContact) {
      BookingEmailService.sendWelcomeEmail(contactId, ownerId, emailData)
        .catch(err => requestLogger.warn({ err }, 'Welcome email failed (non-blocking)'));
    } else {
      BookingEmailService.sendReturningContactEmail(contactId, ownerId, emailData)
        .catch(err => requestLogger.warn({ err }, 'Returning contact email failed (non-blocking)'));
    }

    requestLogger.info(
      { subdomain: data.subdomain, contactId, email: data.email },
      'Contact form processed successfully'
    );

    return NextResponse.json({
      success: true,
      message: 'Thank you for your message. We will get back to you soon.',
      contactId
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Contact form processing failed');
    return NextResponse.json(
      { success: false, error: 'Failed to process form submission' },
      { status: 500 }
    );
  }
}
