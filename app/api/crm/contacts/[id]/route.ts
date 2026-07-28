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
import { z } from 'zod';

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

    // 3. Update contact
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
        changes: validated,
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

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
