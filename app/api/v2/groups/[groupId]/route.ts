/**
 * Individual Workflow Group API
 *
 * GET /api/v2/groups/[groupId] - Get a specific group
 * PUT /api/v2/groups/[groupId] - Update a group
 * DELETE /api/v2/groups/[groupId] - Delete a group
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { OrganizationService } from '@/lib/services/OrganizationService';
import { WorkflowGroupRepository } from '@/lib/repositories/WorkflowGroupRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'WorkflowGroupAPI' });

// Validation schema for updating a group
const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  parent_group_id: z.string().uuid().optional().nullable(),
  display_order: z.number().int().min(0).optional(),
});

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

/**
 * GET - Get a specific workflow group
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { groupId } = await context.params;

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get user's organization to verify ownership
    const orgService = new OrganizationService();
    const org = await orgService.getCurrentOrganization(user.id);

    if (!org) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      );
    }

    // Get the group
    const groupRepo = new WorkflowGroupRepository();
    const result = await groupRepo.findById(groupId);

    if (result.error || !result.data) {
      return NextResponse.json(
        { success: false, error: 'Group not found' },
        { status: 404 }
      );
    }

    // Verify the group belongs to user's organization
    if (result.data.org_id !== org.id) {
      return NextResponse.json(
        { success: false, error: 'Group not found' },
        { status: 404 }
      );
    }

    // Get agents in this group
    const agentIds = await groupRepo.getGroupAgentIds(groupId);

    requestLogger.info({
      userId: user.id,
      groupId,
    }, 'Workflow group retrieved');

    return NextResponse.json({
      success: true,
      data: {
        ...result.data,
        agent_ids: agentIds.data || [],
      },
    });
  } catch (error) {
    requestLogger.error({ err: error, groupId }, 'Failed to get workflow group');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT - Update a workflow group
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { groupId } = await context.params;

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
    const validation = UpdateGroupSchema.safeParse(body);

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
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      );
    }

    // Update the group
    const groupRepo = new WorkflowGroupRepository();
    const result = await groupRepo.update(groupId, org.id, validation.data);

    if (result.error || !result.data) {
      requestLogger.error({ err: result.error }, 'Failed to update workflow group');
      return NextResponse.json(
        { success: false, error: 'Failed to update group' },
        { status: 500 }
      );
    }

    requestLogger.info({
      userId: user.id,
      groupId,
    }, 'Workflow group updated');

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    requestLogger.error({ err: error, groupId }, 'Failed to update workflow group');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Delete a workflow group
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { groupId } = await context.params;

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get user's organization
    const orgService = new OrganizationService();
    const org = await orgService.getCurrentOrganization(user.id);

    if (!org) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      );
    }

    // Delete the group
    const groupRepo = new WorkflowGroupRepository();
    const result = await groupRepo.delete(groupId, org.id);

    if (result.error) {
      requestLogger.error({ err: result.error }, 'Failed to delete workflow group');
      return NextResponse.json(
        { success: false, error: 'Failed to delete group' },
        { status: 500 }
      );
    }

    requestLogger.info({
      userId: user.id,
      groupId,
    }, 'Workflow group deleted');

    return NextResponse.json({
      success: true,
      message: 'Group deleted successfully',
    });
  } catch (error) {
    requestLogger.error({ err: error, groupId }, 'Failed to delete workflow group');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
