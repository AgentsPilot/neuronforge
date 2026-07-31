/**
 * Website Contact Form Submission API
 * POST - Process contact form submissions from public websites
 *
 * This endpoint:
 * 1. Validates the form data
 * 2. Creates or updates a CRM contact (source: 'website_form')
 * 3. Triggers email notification to the website owner
 * 4. Optionally triggers an email sequence
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';
import { BookingEmailService } from '@/lib/services/BookingEmailService';

const logger = createLogger({ module: 'WebsiteContactFormAPI' });

// Form submission schema
const ContactFormSchema = z.object({
  subdomain: z.string().min(1, 'Subdomain is required'),
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  message: z.string().min(1, 'Message is required').max(5000),
  service_interest: z.string().optional(),
  referral_source: z.string().optional(),
  consent_marketing: z.boolean().optional().default(false),
  page_url: z.string().optional()
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

    // Look up the website owner by subdomain
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

    const ownerId = websitePage.user_id;

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
        service_interest: data.service_interest || existingContact.custom_fields?.service_interest,
        consent_marketing: data.consent_marketing
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
      // Parse name into first_name and last_name
      const nameParts = data.name.trim().split(/\s+/);
      const firstName = nameParts[0] || data.name;
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

      // Create new contact
      const { data: newContact, error: createError } = await supabaseServer
        .from('crm_contacts')
        .insert({
          user_id: ownerId,
          first_name: firstName,
          last_name: lastName,
          email: data.email,
          phone: data.phone || null,
          source: 'website_form',
          stage: 'lead',
          custom_fields: {
            first_website_message: data.message,
            service_interest: data.service_interest,
            referral_source: data.referral_source,
            consent_marketing: data.consent_marketing,
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

    const { error: activityError } = await supabaseServer
      .from('crm_activities')
      .insert({
        user_id: ownerId,
        contact_id: contactId,
        activity_type: 'note',
        title: 'Website Contact Form Submission',
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
    const emailData = {
      name: data.name,
      email: data.email,
      message: data.message,
      serviceInterest: data.service_interest
    };

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
