/**
 * Website Intake Form Submission API
 * POST - Process intake form submissions from public websites
 *
 * This endpoint:
 * 1. Validates the intake form data (template-specific fields)
 * 2. Creates or updates a CRM contact with intake data
 * 3. Links to existing booking if booking_id is provided
 * 4. Logs a CRM activity for the submission
 *
 * SERVICE ROLE / RLS BYPASS (intentional — CLAUDE.md security rules):
 * this is a public, unauthenticated endpoint, so there is no user session to scope
 * queries with. The tenant is resolved server-side from the `subdomain`
 * (`website_pages.user_id`) and every subsequent repository call is scoped to that
 * `ownerId`; no identity is ever taken from the request body.
 *
 * KNOWN CONTRACT GAP (tracked — see
 * docs/workplans/BUSINESS_OS_WEBSITE_INTAKE_ROUTE_FIX_WORKPLAN.md §1/§2):
 * the only caller (`ProcessFlowSection.handleIntakeSubmit`, the legacy `intake_fields`
 * path) omits the required `template` and sends an `answers` object this schema strips,
 * so its submissions fail validation with 400. Repairing or retiring that legacy path is
 * a separate product decision; this module is correct if called correctly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolvePublicOwner } from '@/lib/business-os/publicOwner';
import { createLogger } from '@/lib/logger';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import type { CRMContactUpdate } from '@/lib/repositories/CRMContactRepository';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
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

/**
 * Split a single free-text name into first/last, mirroring the sibling contact-form
 * route (app/api/website/forms/contact/route.ts) so both public capture surfaces
 * populate `crm_contacts` identically.
 */
function splitName(name: string): { firstName: string; lastName: string | null } {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0] || name,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null
  };
}

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

    // DEFERRED DECISION (merge 2026-09-02) - should completing an intake form advance
    // the contact's CRM pipeline stage?
    //
    // The feature branch computed an `intakeStage` from the tenant's own
    // `crm_pipeline_stages` ('intake' > 'qualified' > 'discovery' > second stage) and
    // wrote it on both the create and the update path. main does not: a new contact is
    // created as 'lead' and an existing contact's stage is never touched, because
    // pipeline vocabulary is per-tenant and completing an intake is not a promotion
    // event. main's guard tests lock both behaviours (route.test.ts:
    // `expect(insert.stage).toBe('lead')` and `expect(patch).not.toHaveProperty('stage')`).
    //
    // main's behaviour is kept for now. The branch's stage lookup was REMOVED rather
    // than left computed-but-unused: it is an extra query on a public unauthenticated
    // endpoint, and it broke the guard tests (the query is unmocked there precisely
    // because main never makes it).
    //
    // To restore: reinstate the crm_pipeline_stages lookup, pass the resolved stage to
    // the create/update below, and update those two test expectations.
    // See D13 / Q9 in docs/requirements/BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md.

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

    // Check if contact already exists (scoped to the site owner)
    const { data: existingContact, error: lookupError } = await crmContactRepository.findByEmail(
      email,
      ownerId
    );

    // A real lookup failure must not fall through to the create branch — that would
    // risk a duplicate contact whenever the read errors transiently.
    if (lookupError) {
      requestLogger.error({ err: lookupError }, 'Failed to look up contact');
      throw lookupError;
    }

    let contactId: string;

    if (existingContact) {
      // Update existing contact with intake data.
      // NOTE: `stage` is deliberately NOT written here — pipeline stage vocabulary is
      // per-tenant (crm_pipeline_stages) and completing an intake is not a promotion
      // event. `updated_at` is set by update_crm_contacts_updated_at_trigger.
      const updatedCustomFields = {
        ...(existingContact.custom_fields || {}),
        intake_data: intakeData,
        intake_submitted_at: new Date().toISOString()
      };

      // Only overwrite the stored phone when the submitter actually supplied one.
      // Typed as CRMContactUpdate so excess/misspelled fields are a compile error.
      const contactPatch: CRMContactUpdate = {
        custom_fields: updatedCustomFields
      };
      if (phone) {
        contactPatch.phone = phone;
      }

      const { data: updatedContact, error: updateError } = await crmContactRepository.update(
        existingContact.id,
        ownerId,
        contactPatch
      );

      if (updateError || !updatedContact) {
        requestLogger.error({ err: updateError }, 'Failed to update contact');
        throw updateError || new Error('Failed to update contact');
      }

      contactId = existingContact.id;
      requestLogger.info({ contactId }, 'Contact updated with intake data');
    } else {
      // Create new contact with intake data
      const { firstName, lastName } = splitName(name);

      const { data: newContact, error: createError } = await crmContactRepository.create({
        user_id: ownerId,
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        source: 'website_intake',
        // Branch feature, re-expressed through the repository rather than a raw
        // insert. Column exists: 20260824_add_conversion_layer.sql.
        source_metadata: attribution as unknown as Record<string, unknown>,
        stage: 'lead',
        custom_fields: {
          intake_data: intakeData,
          intake_submitted_at: new Date().toISOString(),
          page_url
        }
      });

      if (createError || !newContact) {
        requestLogger.error({ err: createError }, 'Failed to create contact');
        throw createError || new Error('Failed to create contact');
      }

      contactId = newContact.id;
      requestLogger.info({ contactId }, 'New contact created with intake data');
    }

    // Link to booking if provided. `contactId` is owner-verified (it came from a
    // user_id-scoped lookup or create above), which is the invariant linkIntakeContact
    // requires; the booking itself is scoped to ownerId, so a foreign booking_id
    // matches no row and simply warns.
    if (booking_id) {
      const { data: linkedBooking, error: bookingError } =
        await schedulingBookingRepository.linkIntakeContact(booking_id, ownerId, contactId);

      if (bookingError) {
        requestLogger.warn({ err: bookingError, booking_id }, 'Failed to link booking (non-blocking)');
      } else if (!linkedBooking) {
        // Distinct from an error: the booking id is absent or belongs to another tenant,
        // so the user_id-scoped update matched no row. Expected on a public endpoint.
        requestLogger.warn({ booking_id }, 'Booking not found for this site owner (non-blocking)');
      } else {
        requestLogger.info({ booking_id, contactId }, 'Intake linked to booking');
      }
    }

    // Create activity for intake submission.
    // The structured payload lives on the contact's custom_fields.intake_data —
    // crm_activities has no metadata column; booking_id is carried in source_entity_id.
    const description = `Client completed the ${template} intake form.\nSite: ${subdomain}`;

    const { error: activityError } = await crmActivityRepository.create({
      user_id: ownerId,
      contact_id: contactId,
      activity_type: 'note',
      title: `Intake Form Completed (${template})`,
      description,
      auto_logged: true,
      source_capability: 'website',
      source_entity_id: booking_id || null,
      activity_date: new Date().toISOString()
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
