/**
 * GET/POST /api/crm/contacts/[id]/documents
 * Document management for CRM contacts
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { contactDocumentsRepository, DocumentType } from '@/lib/repositories/ContactDocumentsRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';

const logger = createLogger({ module: 'ContactDocumentsAPI' });
const auditTrail = AuditTrailService.getInstance();

// Validation schemas
const uploadDocumentSchema = z.object({
  name: z.string().min(1).max(255),
  document_type: z.enum(['contract', 'intake_form', 'invoice', 'receipt', 'id_document', 'medical', 'insurance', 'other']).optional(),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string()).optional(),
  file_name: z.string().min(1),
  file_size: z.number().min(1).max(50 * 1024 * 1024), // Max 50MB
  mime_type: z.string().min(1),
  file_content: z.string().min(1) // Base64 encoded file content
});

const listDocumentsSchema = z.object({
  document_type: z.enum(['contract', 'intake_form', 'invoice', 'receipt', 'id_document', 'medical', 'insurance', 'other']).optional(),
  limit: z.number().min(1).max(100).optional(),
  offset: z.number().min(0).optional()
});

/**
 * GET - List documents for a contact
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id: contactId } = await params;

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

    // 3. Parse query parameters
    const { searchParams } = new URL(request.url);
    const rawDocType = searchParams.get('document_type');
    const queryParams = {
      document_type: rawDocType || undefined, // Convert null to undefined
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined
    };

    // Validate
    const validated = listDocumentsSchema.parse(queryParams);

    requestLogger.info({ userId: user.id, contactId, params: validated }, 'Listing contact documents');

    // 4. Get documents
    const result = await contactDocumentsRepository.listByContact(contactId, user.id, validated);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, contactId }, 'Failed to list documents');
      return NextResponse.json(
        { success: false, error: 'Failed to list documents' },
        { status: 500 }
      );
    }

    // 5. Get count
    const countResult = await contactDocumentsRepository.countByContact(contactId, user.id, {
      document_type: validated.document_type
    });

    // 6. Return success
    return NextResponse.json({
      success: true,
      documents: result.data,
      total: countResult.data || 0,
      limit: validated.limit || 50,
      offset: validated.offset || 0
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ err: error }, 'Validation error');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid parameters',
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
 * POST - Upload a document for a contact
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id: contactId } = await params;

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

    // 3. Validate input
    const body = await request.json();
    const validated = uploadDocumentSchema.parse(body);

    requestLogger.info(
      { userId: user.id, contactId, fileName: validated.file_name },
      'Uploading contact document'
    );

    // 4. Decode base64 file content
    const fileBuffer = Buffer.from(validated.file_content, 'base64');

    // 5. Generate storage path
    const timestamp = Date.now();
    const sanitizedFileName = validated.file_name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `${user.id}/${contactId}/${timestamp}_${sanitizedFileName}`;

    // 6. Ensure bucket exists, then upload to Supabase Storage
    const bucketName = 'contact-documents';

    // Check if bucket exists, create if not
    const { data: buckets } = await supabaseServer.storage.listBuckets();
    const bucketExists = buckets?.some(b => b.name === bucketName);

    if (!bucketExists) {
      const { error: createBucketError } = await supabaseServer.storage.createBucket(bucketName, {
        public: false,
        fileSizeLimit: 52428800, // 50MB
        allowedMimeTypes: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'text/plain',
          'text/csv'
        ]
      });

      if (createBucketError) {
        requestLogger.error({ err: createBucketError }, 'Failed to create storage bucket');
        return NextResponse.json(
          { success: false, error: 'Storage configuration error' },
          { status: 500 }
        );
      }
      requestLogger.info({ bucketName }, 'Created storage bucket');
    }

    const { error: uploadError } = await supabaseServer.storage
      .from(bucketName)
      .upload(storagePath, fileBuffer, {
        contentType: validated.mime_type,
        upsert: false
      });

    if (uploadError) {
      requestLogger.error({ err: uploadError, userId: user.id }, 'Failed to upload file to storage');
      return NextResponse.json(
        { success: false, error: 'Failed to upload file' },
        { status: 500 }
      );
    }

    // 7. Create document record
    const result = await contactDocumentsRepository.create({
      user_id: user.id,
      contact_id: contactId,
      name: validated.name,
      document_type: validated.document_type || 'other',
      file_name: validated.file_name,
      file_size: validated.file_size,
      mime_type: validated.mime_type,
      storage_path: storagePath,
      description: validated.description,
      tags: validated.tags
    });

    if (result.error) {
      // Clean up uploaded file if DB insert fails
      await supabaseServer.storage
        .from('contact-documents')
        .remove([storagePath]);

      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to create document record');
      return NextResponse.json(
        { success: false, error: 'Failed to create document' },
        { status: 500 }
      );
    }

    // 8. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'CONTACT_DOCUMENT_UPLOADED',
        userId: user.id,
        entityType: 'contact_document',
        entityId: result.data!.id,
        resourceName: validated.name,
        metadata: {
          contactId,
          documentType: validated.document_type,
          fileName: validated.file_name,
          fileSize: validated.file_size
        },
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 9. Return success
    requestLogger.info(
      { documentId: result.data!.id, userId: user.id, contactId },
      'Document uploaded successfully'
    );

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
