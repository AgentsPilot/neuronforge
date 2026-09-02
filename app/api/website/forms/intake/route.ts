/**
 * Website Intake Form Submission API
 * POST - Process intake form submissions from public websites
 *
 * This endpoint:
 * 1. Validates the intake form data (template-specific fields)
 * 2. Creates or updates a CRM contact with intake data
 * 3. Links to existing booking if booking_id is provided
 * 4. Triggers confirmation email sequence
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolvePublicOwner } from '@/lib/business-os/publicOwner';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';
import { buildAttributionFromRequest } from '@/lib/utils/attribution';

const logger = createLogger({ module: 'WebsiteIntakeFormAPI' });

// Base intake form schema
const IntakeFormBaseSchema = z.object({
  // Optional now: a smart link has no subdomain and identifies its business by
  // short code instead. One of the two is still required, enforced below.
  subdomain: z.string().optional(),
  user_code: z.string().optional(),
  template: z.enum(['general', 'therapist', 'coach', 'consultant', 'fitness']),
  booking_id: z.string().uuid().optional(),
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  date_of_birth: z.string().optional(),
  emergency_contact: z.object({
    name: z.string(),
    phone: z.string(),
    relationship: z.string()
  }).optional(),
  page_url: z.string().optional()
});

// Template-specific fields
const TherapistIntakeFields = z.object({
  presenting_concerns: z.string().optional(),
  therapy_history: z.string().optional(),
  medications: z.string().optional(),
  goals: z.string().optional(),
  preferred_communication: z.enum(['phone', 'email', 'text']).optional(),
  consent_treatment: z.boolean().optional()
});

const CoachIntakeFields = z.object({
  coaching_goals: z.string().optional(),
  biggest_challenges: z.string().optional(),
  previous_coaching: z.boolean().optional(),
  commitment_level: z.enum(['low', 'medium', 'high']).optional(),
  preferred_session_frequency: z.string().optional()
});

const ConsultantIntakeFields = z.object({
  business_type: z.string().optional(),
  company_size: z.string().optional(),
  current_challenges: z.string().optional(),
  desired_outcomes: z.string().optional(),
  budget_range: z.string().optional(),
  timeline: z.string().optional()
});

const FitnessIntakeFields = z.object({
  fitness_goals: z.string().optional(),
  current_activity_level: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']).optional(),
  injuries_limitations: z.string().optional(),
  dietary_restrictions: z.string().optional(),
  preferred_workout_time: z.string().optional()
});

// Combined schema with dynamic fields
const IntakeFormSchema = IntakeFormBaseSchema.and(
  z.union([
    TherapistIntakeFields,
    CoachIntakeFields,
    ConsultantIntakeFields,
    FitnessIntakeFields,
    z.object({}) // general template - no extra fields required
  ])
);

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json();

    // Validate input
    const validationResult = IntakeFormSchema.safeParse(body);
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

    // Either identifier resolves the business — the schema no longer demands a
    // subdomain, so the requirement is enforced here where it can say which.
    if (!data.subdomain && !data.user_code) {
      return NextResponse.json(
        { success: false, error: 'Either subdomain or user_code is required' },
        { status: 400 }
      );
    }

    const owner = await resolvePublicOwner({ subdomain: data.subdomain, userCode: data.user_code });

    if (!owner) {
      requestLogger.warn({ subdomain: data.subdomain, userCode: data.user_code }, 'Website not found');
      return NextResponse.json(
        { success: false, error: 'Website not found' },
        { status: 404 }
      );
    }

    const ownerId = owner.userId;

    // Get user's pipeline stages to find appropriate stage for intake completion
    // Intake forms indicate engagement - look for 'qualified', 'intake', or a mid-pipeline stage
    const { data: pipelineStages } = await supabaseServer
      .from('crm_pipeline_stages')
      .select('stage_key, position')
      .eq('user_id', ownerId)
      .order('position', { ascending: true });

    // Find the best stage for intake completion
    // Priority: 'intake' > 'qualified' > 'discovery' > second stage (position 1) > first stage
    let intakeStage = 'qualified'; // fallback
    if (pipelineStages && pipelineStages.length > 0) {
      const stageKeys = pipelineStages.map(s => s.stage_key);
      if (stageKeys.includes('intake')) {
        intakeStage = 'intake';
      } else if (stageKeys.includes('qualified')) {
        intakeStage = 'qualified';
      } else if (stageKeys.includes('discovery')) {
        intakeStage = 'discovery';
      } else if (pipelineStages.length > 1) {
        // Use the second stage (after initial lead stage)
        intakeStage = pipelineStages[1].stage_key;
      } else {
        // Only one stage, use it
        intakeStage = pipelineStages[0].stage_key;
      }
    }

    requestLogger.debug({ intakeStage, pipelineStages }, 'Determined intake completion stage');

    // Extract template-specific fields
    const { subdomain, template, booking_id, name, email, phone, date_of_birth, emergency_contact, page_url, ...templateFields } = data;

    // Build intake data object
    const intakeData = {
      template,
      submitted_at: new Date().toISOString(),
      date_of_birth,
      emergency_contact,
      ...templateFields
    };

    // Check if contact already exists
    const { data: existingContact } = await supabaseServer
      .from('crm_contacts')
      .select('id, custom_fields')
      .eq('user_id', ownerId)
      .eq('email', email)
      .single();

    let contactId: string;

    if (existingContact) {
      // Update existing contact with intake data
      const updatedCustomFields = {
        ...(existingContact.custom_fields || {}),
        intake_data: intakeData,
        intake_submitted_at: new Date().toISOString()
      };

      const { error: updateError } = await supabaseServer
        .from('crm_contacts')
        .update({
          phone: phone || existingContact.custom_fields?.phone,
          custom_fields: updatedCustomFields,
          stage: intakeStage, // Upgrade to appropriate pipeline stage when intake is submitted
          updated_at: new Date().toISOString()
        })
        .eq('id', existingContact.id);

      if (updateError) {
        requestLogger.error({ err: updateError }, 'Failed to update contact');
        throw updateError;
      }

      contactId = existingContact.id;
      requestLogger.info({ contactId }, 'Contact updated with intake data');
    } else {
      // Parse name into first_name and last_name
      const nameParts = name.trim().split(/\s+/);
      const firstName = nameParts[0] || name;
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

      // Create new contact with intake data and attribution
      const { data: newContact, error: createError } = await supabaseServer
        .from('crm_contacts')
        .insert({
          user_id: ownerId,
          first_name: firstName,
          last_name: lastName,
          email,
          phone: phone || null,
          source: 'website_intake',
          stage: intakeStage, // Use appropriate pipeline stage for intake completion
          source_metadata: attribution as unknown as Record<string, unknown>,  // Store full attribution data
          custom_fields: {
            intake_data: intakeData,
            intake_submitted_at: new Date().toISOString(),
            page_url
          }
        })
        .select('id')
        .single();

      if (createError || !newContact) {
        requestLogger.error({ err: createError }, 'Failed to create contact');
        throw createError || new Error('Failed to create contact');
      }

      contactId = newContact.id;
      requestLogger.info({ contactId }, 'New contact created with intake data');
    }

    // Link to booking if provided
    if (booking_id) {
      const { error: bookingError } = await supabaseServer
        .from('scheduling_bookings')
        .update({
          contact_id: contactId,
          intake_completed: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', booking_id)
        .eq('user_id', ownerId);

      if (bookingError) {
        requestLogger.warn({ err: bookingError, booking_id }, 'Failed to link booking (non-blocking)');
      } else {
        requestLogger.info({ booking_id, contactId }, 'Intake linked to booking');
      }
    }

    // Create activity for intake submission
    const { error: activityError } = await supabaseServer
      .from('crm_activities')
      .insert({
        user_id: ownerId,
        contact_id: contactId,
        activity_type: 'note',
        title: `Intake Form Completed (${template})`,
        description: `Client completed the ${template} intake form.`,
        activity_date: new Date().toISOString(),
        auto_logged: true,
        source_capability: 'website'
      });

    if (activityError) {
      requestLogger.warn({ err: activityError }, 'Failed to create activity (non-blocking)');
    }

    // TODO: Trigger 'intake_completed' email sequence
    // This would send a confirmation email to the client and notify the owner

    requestLogger.info(
      { subdomain, contactId, template, booking_id },
      'Intake form processed successfully'
    );

    return NextResponse.json({
      success: true,
      message: 'Thank you for completing the intake form.',
      contactId
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Intake form processing failed');
    return NextResponse.json(
      { success: false, error: 'Failed to process intake form' },
      { status: 500 }
    );
  }
}
