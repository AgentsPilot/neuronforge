/**
 * Workflow Groups API
 *
 * GET /api/v2/groups - Get all groups for the user's organization
 * POST /api/v2/groups - Create a new group
 *
 * Groups are user-defined and domain-agnostic. Users can organize
 * their workflows however they want (by project, priority, client, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { OrganizationService } from '@/lib/services/OrganizationService';
import { WorkflowGroupRepository } from '@/lib/repositories/WorkflowGroupRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'WorkflowGroupsAPI' });

// Validation schema for creating a group
const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  parent_group_id: z.string().uuid().optional().nullable(),
  display_order: z.number().int().min(0).optional(),
});

/**
 * GET - Get all workflow groups for the user's organization
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

    // Ensure organization exists (consistent with POST behavior)
    const org = await orgService.ensureUserOrganization(user.id);
    if (!org) {
      requestLogger.warn({ userId: user.id }, 'No organization found or created for user');
      // Return empty groups instead of error - user might just need to create first group
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    // Check for tree structure query param
    const url = new URL(request.url);
    const asTree = url.searchParams.get('tree') === 'true';

    let groups;
    if (asTree) {
      groups = await orgService.getWorkflowGroupTree(user.id);
    } else {
      groups = await orgService.getWorkflowGroups(user.id);
    }

    requestLogger.info({
      userId: user.id,
      orgId: org.id,
      groupCount: groups.length,
      asTree,
    }, 'Workflow groups retrieved');

    return NextResponse.json({
      success: true,
      data: groups,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to get workflow groups');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST - Create a new workflow group
 */
export async function POST(request: NextRequest) {
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
    const validation = CreateGroupSchema.safeParse(body);

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

    // Get user's organization
    const orgService = new OrganizationService();
    const org = await orgService.getCurrentOrganization(user.id);

    if (!org) {
      // Auto-create organization if it doesn't exist
      const newOrg = await orgService.ensureUserOrganization(user.id);
      if (!newOrg) {
        return NextResponse.json(
          { success: false, error: 'Failed to create organization' },
          { status: 500 }
        );
      }
    }

    const orgId = org?.id || (await orgService.getCurrentOrganization(user.id))?.id;
    if (!orgId) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      );
    }

    // Create the group
    const groupRepo = new WorkflowGroupRepository();
    const result = await groupRepo.create({
      org_id: orgId,
      name: validation.data.name,
      description: validation.data.description,
      color: validation.data.color,
      icon: validation.data.icon,
      parent_group_id: validation.data.parent_group_id,
      display_order: validation.data.display_order,
    });

    if (result.error || !result.data) {
      requestLogger.error({ err: result.error }, 'Failed to create workflow group');
      return NextResponse.json(
        { success: false, error: 'Failed to create group' },
        { status: 500 }
      );
    }

    requestLogger.info({
      userId: user.id,
      groupId: result.data.id,
      groupName: result.data.name,
    }, 'Workflow group created');

    return NextResponse.json(
      {
        success: true,
        data: result.data,
      },
      { status: 201 }
    );
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to create workflow group');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
