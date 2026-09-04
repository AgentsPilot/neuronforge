/**
 * GET /api/crm/contacts/[id]
 * PUT /api/crm/contacts/[id]
 * DELETE /api/crm/contacts/[id]
 * Individual contact operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { generateDiff } from '@/lib/audit/diff';
import { z } from 'zod';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { activitySentence, activityFieldName, activityRecord } from '@/lib/business-os/activityText';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'CRMContactAPI' });
const auditTrail = AuditTrailService.getInstance();

// Validation schema
// Note: stage accepts any string since stages are dynamic from crm_pipeline_stages table
const updateContactSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  stage: z.string().min(1).max(50).optional(),
  source: z.string().min(1).max(50).optional(),
  tags: z.array(z.string()).optional(),
  custom_fields: z.record(z.any()).optional()
});

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { id } = params;
    requestLogger.info({ userId: user.id, contactId: id }, 'Getting CRM contact');

    // 2. Get contact
    const result = await crmContactRepository.findById(id, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, contactId: id, userId: user.id }, 'Failed to get contact');
      return NextResponse.json(
        { success: false, error: 'Contact not found' },
        { status: 404 }
      );
    }

    // 3. Return success
    return NextResponse.json({
      success: true,
      contact: result.data
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    // 2. Validate input
    const { id } = params;
    const body = await request.json();
    const validated = updateContactSchema.parse(body);

    requestLogger.info({ userId: user.id, contactId: id }, 'Updating CRM contact');

    // 3. Update contact. The previous row is read first so the audit entry can
    // say what the value changed FROM — passing the request payload alone
    // records only where a field landed, which is the less useful half.
    const before = await crmContactRepository.findById(id, user.id);
    const result = await crmContactRepository.update(id, user.id, validated);

    if (result.error) {
      requestLogger.error({ err: result.error, contactId: id, userId: user.id }, 'Failed to update contact');
      return NextResponse.json(
        { success: false, error: 'Failed to update contact' },
        { status: 500 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'CRM_CONTACT_UPDATED',
        userId: user.id,
        entityType: 'crm_contact',
        entityId: id,
        resourceName: `${result.data!.first_name || ''} ${result.data!.last_name || ''}`.trim() || result.data!.email || 'Contact',
        // A real before/after diff where the previous row could be read; the
        // submitted values alone when it could not.
        // updated_at moves on every write, so it would appear in every entry
        // and say nothing.
        changes: (before.data
          ? generateDiff(before.data, result.data!, { ignoreFields: ['updated_at'] })
          : validated) ?? undefined,
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    /*
     * The change, on the contact's own timeline.
     *
     * The audit trail already recorded a before/after diff, but the audit trail
     * is a compliance log nobody opens day to day — so an owner asking "when did
     * this number change, and what was it?" had nowhere to look. The same diff
     * belongs where they are already standing.
     *
     * Only fields a person would recognise, and only when something actually
     * changed: a save that altered nothing writes no row, or the timeline fills
     * with entries recording that somebody pressed Save.
     */
    const { data: ownerProfile } = await supabaseServer
      .from('business_profiles')
      .select('language')
      .eq('user_id', user.id)
      .maybeSingle();
    const ownerLocale = ownerProfile?.language || 'en';

    if (before.data && result.data) {
      const diff = generateDiff(before.data, result.data, { ignoreFields: ['updated_at'] });
      const VISIBLE_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'stage', 'source', 'company', 'notes'];
      const shown = Object.entries(diff || {}).filter(([field]) => VISIBLE_FIELDS.includes(field));

      if (shown.length > 0) {
        const isStageMove = shown.some(([field]) => field === 'stage');
        const fieldList = shown
          .map(([field]) => activityFieldName(field, ownerLocale))
          .join(', ');

        crmActivityRepository.create({
          user_id: user.id,
          contact_id: id,
          // `stage` moving is its own event — it is the one field that means
          // something changed about the relationship, not about the record.
          activity_type: isStageMove ? 'stage_changed' : 'contact_updated',
          // Written in the business's language now; the diff rides along in
          // `description` so the row can open to show what each value was
          // before. The sentence lives in `title`, which is NOT NULL.
          title: activitySentence(
            isStageMove ? 'stage_changed' : 'contact_updated',
            { fields: fieldList },
            ownerLocale
          ),
          description: JSON.stringify({
            kind: 'contact_updated',
            changes: Object.fromEntries(shown),
          }),
          auto_logged: true,
          source_capability: 'crm',
          source_entity_id: id,
        }).catch(err => requestLogger.warn({ err }, 'Contact-change activity logging failed (non-blocking)'));
      }
    }

    // 5. Return success
    requestLogger.info({ contactId: id, userId: user.id }, 'Contact updated successfully');
    return NextResponse.json({
      success: true,
      contact: result.data
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ err: error }, 'Validation error');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { id } = params;
    requestLogger.info({ userId: user.id, contactId: id }, 'Deleting CRM contact');

    // 2. Get contact first for audit log
    const contact = await crmContactRepository.findById(id, user.id);

    // 3. Delete contact
    const result = await crmContactRepository.delete(id, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, contactId: id, userId: user.id }, 'Failed to delete contact');
      return NextResponse.json(
        { success: false, error: 'Failed to delete contact' },
        { status: 500 }
      );
    }

    // 4. Audit log (non-blocking)
    if (contact.data) {
      auditTrail
        .log({
          action: 'CRM_CONTACT_DELETED',
          userId: user.id,
          entityType: 'crm_contact',
          entityId: id,
          resourceName: `${contact.data.first_name || ''} ${contact.data.last_name || ''}`.trim() || contact.data.email || 'Contact',
          request
        })
        .catch(err => requestLogger.error({ err }, 'Audit failed'));
    }

    // 5. Return success
    requestLogger.info({ contactId: id, userId: user.id }, 'Contact deleted successfully');
    return NextResponse.json({
      success: true,
      message: 'Contact deleted'
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
