/**
 * GET /api/crm/contacts/[id]/emails
 * Get emails sent to a specific contact
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { emailSendRepository } from '@/lib/repositories/EmailAutomationRepository';

const logger = createLogger({ module: 'ContactEmailsAPI' });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { id: contactId } = await params;

    // 2. Parse query parameters
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    requestLogger.info({ userId: user.id, contactId, limit, offset }, 'Fetching contact emails');

    // 3. Get emails for this contact
    const result = await emailSendRepository.list(user.id, {
      contact_id: contactId,
      limit,
      offset
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, contactId }, 'Failed to fetch contact emails');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch emails' },
        { status: 500 }
      );
    }

    // 4. Return success
    return NextResponse.json({
      success: true,
      emails: result.data || [],
      limit,
      offset
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
