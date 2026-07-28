/**
 * GET /api/crm/contacts/check-email
 * Check if a contact with the given email already exists
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';

const logger = createLogger({ module: 'CRMCheckEmailAPI' });

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

    // 2. Get email from query params
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // 3. Check for existing contact with this email
    const result = await crmContactRepository.findByEmail(email, user.id);

    if (result.data) {
      // Contact exists
      return NextResponse.json({
        success: true,
        exists: true,
        contact: {
          id: result.data.id,
          first_name: result.data.first_name,
          last_name: result.data.last_name,
          email: result.data.email
        }
      });
    }

    // No duplicate found
    return NextResponse.json({
      success: true,
      exists: false,
      contact: null
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
