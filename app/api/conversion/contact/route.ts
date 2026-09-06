/**
 * Conversion Contact Form API
 * POST - Process contact form submissions from standalone pages (userCode-based)
 *
 * This endpoint:
 * 1. Looks up the business by userCode
 * 2. Creates or updates a CRM contact
 * 3. Triggers email notification to the business owner
 *
 * This is a PUBLIC endpoint - no authentication required
 * Used by standalone conversion pages (/c/[userCode]/contact)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { buildAttributionFromRequest } from '@/lib/utils/attribution';

const logger = createLogger({ module: 'ConversionContactAPI' });

// Form submission schema
const ContactFormSchema = z.object({
  userCode: z.string().min(6).max(10).regex(/^[a-z0-9]+$/i, 'Invalid user code format'),
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  message: z.string().min(1, 'Message is required').max(5000),
  service_interest: z.string().optional()
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
      generateSessionId: true
    });

    // Look up business profile by userCode
    const { data: businessProfile, error: profileError } = await supabaseServer
      .from('business_profiles')
      .select('user_id, company_name')
      .eq('user_code', data.userCode.toLowerCase())
      .single();

    if (profileError || !businessProfile) {
      requestLogger.warn({ userCode: data.userCode }, 'Business not found');
      return NextResponse.json(
        { success: false, error: 'Business not found' },
        { status: 404 }
      );
    }

    const ownerId = businessProfile.user_id;

    // Get user's first pipeline stage (or fallback to 'lead')
    const { data: pipelineStages } = await supabaseServer
      .from('crm_pipeline_stages')
      .select('stage_key')
      .eq('user_id', ownerId)
      .order('position', { ascending: true })
      .limit(1);

    const initialStage = pipelineStages?.[0]?.stage_key || 'lead';
    requestLogger.debug({ initialStage, ownerId }, 'Using pipeline stage for new contact');

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
          source_metadata: attribution as unknown as Record<string, unknown>,
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

      // Create new contact with attribution
      const { data: newContact, error: createError } = await supabaseServer
        .from('crm_contacts')
        .insert({
          user_id: ownerId,
          first_name: firstName,
          last_name: lastName,
          email: data.email,
          phone: data.phone || null,
          source: 'conversion_form',
          stage: initialStage,  // Use user's first pipeline stage
          source_metadata: attribution as unknown as Record<string, unknown>,
          custom_fields: {
            first_website_message: data.message,
            service_interest: data.service_interest,
            capture_source: 'standalone_contact_form'
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
    let activityDescription = data.message;
    if (data.service_interest) {
      activityDescription += `\n\nService Interest: ${data.service_interest}`;
    }

    const { error: activityError } = await supabaseServer
      .from('crm_activities')
      .insert({
        user_id: ownerId,
        contact_id: contactId,
        activity_type: 'note',
        title: 'Contact Form Submission (Standalone)',
        description: activityDescription,
        activity_date: new Date().toISOString(),
        auto_logged: true,
        source_capability: 'conversion'
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
      { userCode: data.userCode, contactId, email: data.email },
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
