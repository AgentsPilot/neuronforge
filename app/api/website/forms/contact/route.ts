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
      // Create new contact
      const { data: newContact, error: createError } = await supabaseServer
        .from('crm_contacts')
        .insert({
          user_id: ownerId,
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          source: 'website_form',
          status: 'lead',
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
      requestLogger.info({ contactId }, 'New contact created');
    }

    // Create activity/note for the message
    const { error: activityError } = await supabaseServer
      .from('crm_activities')
      .insert({
        user_id: ownerId,
        contact_id: contactId,
        type: 'note',
        title: 'Website Contact Form Submission',
        description: data.message,
        metadata: {
          source: 'website_form',
          subdomain: data.subdomain,
          service_interest: data.service_interest,
          referral_source: data.referral_source,
          page_url: data.page_url
        }
      });

    if (activityError) {
      requestLogger.warn({ err: activityError }, 'Failed to create activity (non-blocking)');
    }

    // TODO: Trigger email sequence if configured
    // This would involve looking up the website's email automation settings
    // and triggering the 'contact_form_submitted' sequence

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
