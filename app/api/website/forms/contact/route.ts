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
import { activitySentence } from '@/lib/business-os/activityText';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { notifyOwnerOfLead } from '@/lib/services/LeadAlertService';
import { buildAttributionFromRequest } from '@/lib/utils/attribution';
import { enrichCaptureAttribution } from '@/lib/business-os/enrichCaptureAttribution';
import { ConsentInputSchema } from '@/lib/validation/consent';
import { recordConsent } from '@/lib/consent/recordConsent';
import { beginDoubleOptIn } from '@/lib/consent/doubleOptIn';
import { businessSubscriberRepository } from '@/lib/repositories/BusinessSubscriberRepository';


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
  email: z.string().email('Invalid email address'),
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
      const { data: websitePage, error: pageError } = await supabaseServer
        .from('website_pages')
        .select('user_id')
        .eq('subdomain', data.subdomain)
        .single();

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

    // Get user's first pipeline stage (or fallback to 'lead')
    const { data: pipelineStages } = await supabaseServer
      .from('crm_pipeline_stages')
      .select('stage_key')
      .eq('user_id', ownerId)
      .order('position', { ascending: true })
      .limit(1);

    /*
     * A newsletter signup does NOT arrive here any more.
     *
     * It posts to `/api/public/newsletter/subscribe`, which writes
     * `business_subscribers` and creates no contact at all. This endpoint is
     * for enquiries again: everything below treats the sender as somebody
     * waiting for a reply, which is exactly what a subscriber is not.
     */
    const initialStage = pipelineStages?.[0]?.stage_key || 'lead';

    requestLogger.debug({ initialStage, ownerId }, 'Resolved pipeline stage for new contact');

    // Check if contact already exists
    const { data: existingContact } = await supabaseServer
      .from('crm_contacts')
      .select('id, custom_fields')
      .eq('user_id', ownerId)
      .eq('email', data.email)
      .single();

    let contactId: string;
    let isNewContact = false;

    if (existingContact) {
      // Update existing contact
      const updatedCustomFields = {
        ...(existingContact.custom_fields || {}),
        last_website_message: data.message,
        last_website_contact: new Date().toISOString(),
        service_interest: data.service_interest || existingContact.custom_fields?.service_interest
      };

      const { error: updateError } = await supabaseServer
        .from('crm_contacts')
        .update({
          phone: data.phone || existingContact.custom_fields?.phone,
          custom_fields: updatedCustomFields,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingContact.id);

      if (updateError) {
        requestLogger.error({ err: updateError }, 'Failed to update contact');
        throw updateError;
      }

      contactId = existingContact.id;
      requestLogger.info({ contactId }, 'Contact updated');
    } else {
      /*
       * Parse the name into first and last — and leave BOTH null when there is
       * none. A newsletter signup gives an address and nothing else, and the
       * column is nullable precisely so an unnamed contact can be stored as
       * one. The CRM shows the address; the owner sees what they actually have.
       */
      const trimmedName = data.name?.trim();
      const nameParts = trimmedName ? trimmedName.split(/\s+/) : [];
      const firstName = nameParts[0] ?? null;
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

      // Create new contact with attribution
      const { data: newContact, error: createError } = await supabaseServer
        .from('crm_contacts')
        .insert({
          user_id: ownerId,
          first_name: firstName,
          last_name: lastName,
          email: data.email,
          phone: data.phone || null,
          // A subscriber is not an enquiry, and the owner should be able to
          // tell them apart without reading the message text.
          source: data.source ?? 'website_form',
          stage: initialStage,  // Use user's first pipeline stage
          source_metadata: attribution as unknown as Record<string, unknown>,  // Store full attribution data
          custom_fields: {
            first_website_message: data.message,
            service_interest: data.service_interest,
            referral_source: data.referral_source,
            page_url: data.page_url
          }
        })
        .select('id')
        .single();

      if (createError || !newContact) {
        requestLogger.error({ err: createError }, 'Failed to create contact');
        throw createError || new Error('Failed to create contact');
      }

      contactId = newContact.id;
      isNewContact = true;
      requestLogger.info({ contactId }, 'New contact created');
    }

    // Create activity/note for the message
    // Build description with context
    let activityDescription = data.message;
    if (data.service_interest) {
      activityDescription += `\n\nService Interest: ${data.service_interest}`;
    }
    if (data.referral_source) {
      activityDescription += `\nReferral Source: ${data.referral_source}`;
    }

    const { data: ownerProfile } = await supabaseServer
      .from('business_profiles')
      .select('language')
      .eq('user_id', ownerId)
      .maybeSingle();
    const ownerLocale = ownerProfile?.language || 'en';

    const { error: activityError } = await supabaseServer
      .from('crm_activities')
      .insert({
        user_id: ownerId,
        contact_id: contactId,
        activity_type: 'note',
        // The business's language, not English: this is its own history.
        title: activitySentence('website_contact_form', {}, ownerLocale),
        description: activityDescription,
        activity_date: new Date().toISOString(),
        auto_logged: true,
        source_capability: 'website'
      });

    if (activityError) {
      requestLogger.error({ err: activityError }, 'Failed to create activity');
    } else {
      requestLogger.info({ contactId }, 'Activity created for contact form submission');
    }

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
