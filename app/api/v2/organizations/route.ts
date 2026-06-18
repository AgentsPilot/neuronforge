/**
 * GET /api/v2/organizations
 * Get all organizations the user belongs to
 *
 * Note: Currently returns only the user's own organization (1 org = 1 user).
 * In the future with teams support, this will return all orgs the user is a member of.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { OrganizationRepository } from '@/lib/repositories/OrganizationRepository';

const logger = createLogger({ module: 'OrganizationsAPI' });

/**
 * GET - Get all organizations for the current user
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const orgRepo = new OrganizationRepository();
    const result = await orgRepo.findByUserId(user.id);

    if (result.error) {
      requestLogger.error({ err: result.error }, 'Failed to get organizations');
      return NextResponse.json(
        { success: false, error: 'Failed to get organizations' },
        { status: 500 }
      );
    }

    requestLogger.info({
      userId: user.id,
      orgCount: result.data?.length || 0,
    }, 'Organizations retrieved');

    return NextResponse.json({
      success: true,
      data: result.data || [],
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to get organizations');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
