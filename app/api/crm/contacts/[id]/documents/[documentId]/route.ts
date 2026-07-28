/**
 * GET/PUT/DELETE /api/crm/contacts/[id]/documents/[documentId]
 * Individual document operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { contactDocumentsRepository } from '@/lib/repositories/ContactDocumentsRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';

const logger = createLogger({ module: 'ContactDocumentAPI' });
const auditTrail = AuditTrailService.getInstance();

// Validation schema for update
const updateDocumentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  document_type: z.enum(['contract', 'intake_form', 'invoice', 'receipt', 'id_document', 'medical', 'insurance', 'other']).optional(),
  description: z.string().max(1000).optional().nullable(),
  tags: z.array(z.string()).optional()
});

/**
 * GET - Get document details and download URL
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id: contactId, documentId } = await params;

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Verify contact exists and belongs to user
    const contact = await crmContactRepository.findById(contactId, user.id);
    if (!contact.data) {
      return NextResponse.json(
        { success: false, error: 'Contact not found' },
        { status: 404 }
      );
    }

    // 3. Get document
    const result = await contactDocumentsRepository.findById(documentId, user.id);

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'Document not found' },
        { status: 404 }
      );
    }

    // Verify document belongs to the contact
    if (result.data.contact_id !== contactId) {
      return NextResponse.json(
        { success: false, error: 'Document not found' },
        { status: 404 }
      );
    }

    // 4. Generate signed download URL (valid for 1 hour)
    const { data: signedUrl, error: urlError } = await supabaseServer.storage
      .from(result.data.storage_bucket)
      .createSignedUrl(result.data.storage_path, 3600);

    if (urlError) {
      requestLogger.error({ err: urlError, documentId }, 'Failed to generate download URL');
      return NextResponse.json(
        { success: false, error: 'Failed to generate download URL' },
        { status: 500 }
      );
    }

    // 5. Return document with download URL
    return NextResponse.json({
      success: true,
      document: {
        ...result.data,
        download_url: signedUrl.signedUrl
      }
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

/**
 * PUT - Update document metadata
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id: contactId, documentId } = await params;

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Verify contact exists and belongs to user
    const contact = await crmContactRepository.findById(contactId, user.id);
    if (!contact.data) {
      return NextResponse.json(
        { success: false, error: 'Contact not found' },
        { status: 404 }
      );
    }

    // 3. Verify document exists and belongs to contact
    const existing = await contactDocumentsRepository.findById(documentId, user.id);
    if (!existing.data || existing.data.contact_id !== contactId) {
      return NextResponse.json(
        { success: false, error: 'Document not found' },
        { status: 404 }
      );
    }

    // 4. Validate input
    const body = await request.json();
    const validated = updateDocumentSchema.parse(body);

    requestLogger.info({ userId: user.id, documentId }, 'Updating contact document');

    // 5. Update document
    const result = await contactDocumentsRepository.update(documentId, user.id, validated);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to update document');
      return NextResponse.json(
        { success: false, error: 'Failed to update document' },
        { status: 500 }
      );
    }

    // 6. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'CONTACT_DOCUMENT_UPDATED',
        userId: user.id,
        entityType: 'contact_document',
        entityId: documentId,
        resourceName: result.data!.name,
        metadata: { contactId, changes: validated },
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 7. Return success
    return NextResponse.json({
      success: true,
      document: result.data
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

/**
 * DELETE - Delete a document
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id: contactId, documentId } = await params;

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Verify contact exists and belongs to user
    const contact = await crmContactRepository.findById(contactId, user.id);
    if (!contact.data) {
      return NextResponse.json(
        { success: false, error: 'Contact not found' },
        { status: 404 }
      );
    }

    // 3. Verify document exists and belongs to contact
    const existing = await contactDocumentsRepository.findById(documentId, user.id);
    if (!existing.data || existing.data.contact_id !== contactId) {
      return NextResponse.json(
        { success: false, error: 'Document not found' },
        { status: 404 }
      );
    }

    requestLogger.info({ userId: user.id, documentId, contactId }, 'Deleting contact document');

    // 4. Delete from storage
    const { error: storageError } = await supabaseServer.storage
      .from(existing.data.storage_bucket)
      .remove([existing.data.storage_path]);

    if (storageError) {
      requestLogger.warn({ err: storageError, documentId }, 'Failed to delete file from storage (continuing with soft delete)');
      // Continue with soft delete even if storage delete fails
    }

    // 5. Soft delete document record
    const result = await contactDocumentsRepository.delete(documentId, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to delete document');
      return NextResponse.json(
        { success: false, error: 'Failed to delete document' },
        { status: 500 }
      );
    }

    // 6. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'CONTACT_DOCUMENT_DELETED',
        userId: user.id,
        entityType: 'contact_document',
        entityId: documentId,
        resourceName: existing.data.name,
        metadata: { contactId, fileName: existing.data.file_name },
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 7. Return success
    requestLogger.info({ documentId }, 'Document deleted successfully');

    return NextResponse.json({
      success: true
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
