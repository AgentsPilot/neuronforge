/**
 * CRM Documents API
 * GET /api/crm/documents?contact_id=<id>&limit=<n>
 *
 * Lists documents for a contact
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { contactDocumentsRepository } from '@/lib/repositories/ContactDocumentsRepository';

const logger = createLogger({ module: 'CRMDocumentsAPI' });

export async function GET(request: NextRequest) {
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

    // 2. Get query params
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contact_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const documentType = searchParams.get('document_type') as 'contract' | 'intake_form' | 'invoice' | 'receipt' | 'proposal' | 'id_document' | 'medical' | 'insurance' | 'other' | undefined;

    if (!contactId) {
      return NextResponse.json(
        { success: false, error: 'contact_id is required' },
        { status: 400 }
      );
    }

    requestLogger.info({ contactId, limit }, 'Fetching contact documents');

    // 3. Fetch documents
    const result = await contactDocumentsRepository.listByContact(
      contactId,
      user.id,
      {
        document_type: documentType,
        limit,
        status: 'active'
      }
    );

    if (result.error) {
      requestLogger.error({ err: result.error }, 'Failed to fetch documents');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch documents' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      documents: result.data || []
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'CRM Documents API error');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
