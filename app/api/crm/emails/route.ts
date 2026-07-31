/**
 * GET /api/crm/emails
 * List emails sent to a contact
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { emailSendRepository } from '@/lib/repositories/EmailAutomationRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'CRMEmailsAPI' });

const querySchema = z.object({
  contact_id: z.string().uuid(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0)
});

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

    // 2. Parse and validate query params
    const { searchParams } = new URL(request.url);
    const queryParams = {
      contact_id: searchParams.get('contact_id'),
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset')
    };

    const validated = querySchema.parse(queryParams);
    requestLogger.info({ userId: user.id, contactId: validated.contact_id }, 'Fetching contact emails');

    // 3. Fetch emails for this contact
    const result = await emailSendRepository.list(user.id, {
      contact_id: validated.contact_id,
      limit: validated.limit,
      offset: validated.offset
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to fetch emails');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch emails' },
        { status: 500 }
      );
    }

    // 4. Return success
    return NextResponse.json({
      success: true,
      emails: result.data || [],
      limit: validated.limit,
      offset: validated.offset
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
