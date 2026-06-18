/**
 * Agent-Group Memberships API
 *
 * GET /api/v2/groups/memberships - Get all agent-group memberships for the user's organization
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { OrganizationService } from '@/lib/services/OrganizationService';
import { WorkflowGroupRepository } from '@/lib/repositories/WorkflowGroupRepository';

const logger = createLogger({ module: 'GroupMembershipsAPI' });

/**
 * GET - Get all agent-group memberships for the user's organization
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
    const org = await orgService.getCurrentOrganization(user.id);

    if (!org) {
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    const groupRepo = new WorkflowGroupRepository();
    const result = await groupRepo.getAllMemberships(org.id);

    if (result.error) {
      requestLogger.error({ err: result.error }, 'Failed to get memberships');
      return NextResponse.json(
        { success: false, error: 'Failed to get memberships' },
        { status: 500 }
      );
    }

    requestLogger.info({
      userId: user.id,
      orgId: org.id,
      membershipCount: result.data?.length || 0,
    }, 'Group memberships retrieved');

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to get group memberships');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
