/**
 * GET /api/v2/organizations/current
 * Get the current user's organization (auto-creates if doesn't exist)
 *
 * PUT /api/v2/organizations/current
 * Update the current user's organization settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { OrganizationService } from '@/lib/services/OrganizationService';
import { z } from 'zod';

const logger = createLogger({ module: 'OrganizationsCurrentAPI' });

// Validation schema for updates
const UpdateOrganizationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  settings: z.record(z.unknown()).optional(),
});

/**
 * GET - Get current user's organization
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

    const orgService = new OrganizationService();

    // Get or create organization
    const organization = await orgService.ensureUserOrganization(user.id);
    if (!organization) {
      return NextResponse.json(
        { success: false, error: 'Failed to get organization' },
        { status: 500 }
      );
    }

    // Get organization with stats
    const orgWithStats = await orgService.getOrganizationWithStats(user.id);

    requestLogger.info({
      userId: user.id,
      orgId: organization.id,
    }, 'Organization retrieved');

    return NextResponse.json({
      success: true,
      data: orgWithStats || organization,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to get organization');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT - Update current user's organization
 */
export async function PUT(request: NextRequest) {
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

    // Parse and validate body
    const body = await request.json();
    const validation = UpdateOrganizationSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: validation.error.errors,
        },
        { status: 400 }
      );
    }

    const orgService = new OrganizationService();
    const updatedOrg = await orgService.updateOrganization(user.id, validation.data);

    if (!updatedOrg) {
      return NextResponse.json(
        { success: false, error: 'Failed to update organization' },
        { status: 500 }
      );
    }

    requestLogger.info({
      userId: user.id,
      orgId: updatedOrg.id,
    }, 'Organization updated');

    return NextResponse.json({
      success: true,
      data: updatedOrg,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to update organization');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
