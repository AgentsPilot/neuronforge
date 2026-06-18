/**
 * Group Agents Management API
 *
 * POST /api/v2/groups/[groupId]/agents - Add agents to a group
 * DELETE /api/v2/groups/[groupId]/agents - Remove agents from a group
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { OrganizationService } from '@/lib/services/OrganizationService';
import { WorkflowGroupRepository } from '@/lib/repositories/WorkflowGroupRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'GroupAgentsAPI' });

// Validation schema for agent IDs
const AgentIdsSchema = z.object({
  agent_ids: z.array(z.string().uuid()).min(1),
});

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

/**
 * POST - Add agents to a group
 */
export async function POST(request: NextRequest, context: RouteContext) {
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
    const validation = AgentIdsSchema.safeParse(body);

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

    // Verify organization access
    const orgService = new OrganizationService();
    const org = await orgService.getCurrentOrganization(user.id);

    if (!org) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      );
    }

    // Verify group belongs to user's organization
    const groupRepo = new WorkflowGroupRepository();
    const groupResult = await groupRepo.findById(groupId);

    if (!groupResult.data || groupResult.data.org_id !== org.id) {
      return NextResponse.json(
        { success: false, error: 'Group not found' },
        { status: 404 }
      );
    }

    // Add each agent to the group
    const results = await Promise.all(
      validation.data.agent_ids.map(agentId =>
        groupRepo.addAgentToGroup(agentId, groupId)
      )
    );

    const successCount = results.filter(r => r.data).length;
    const failCount = results.filter(r => r.error).length;

    requestLogger.info({
      userId: user.id,
      groupId,
      successCount,
      failCount,
    }, 'Agents added to group');

    return NextResponse.json({
      success: true,
      data: {
        added: successCount,
        failed: failCount,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error, groupId }, 'Failed to add agents to group');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Remove agents from a group
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

    // Parse and validate body
    const body = await request.json();
    const validation = AgentIdsSchema.safeParse(body);

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

    // Verify organization access
    const orgService = new OrganizationService();
    const org = await orgService.getCurrentOrganization(user.id);

    if (!org) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      );
    }

    // Verify group belongs to user's organization
    const groupRepo = new WorkflowGroupRepository();
    const groupResult = await groupRepo.findById(groupId);

    if (!groupResult.data || groupResult.data.org_id !== org.id) {
      return NextResponse.json(
        { success: false, error: 'Group not found' },
        { status: 404 }
      );
    }

    // Remove each agent from the group
    const results = await Promise.all(
      validation.data.agent_ids.map(agentId =>
        groupRepo.removeAgentFromGroup(agentId, groupId)
      )
    );

    const successCount = results.filter(r => r.data).length;
    const failCount = results.filter(r => r.error).length;

    requestLogger.info({
      userId: user.id,
      groupId,
      successCount,
      failCount,
    }, 'Agents removed from group');

    return NextResponse.json({
      success: true,
      data: {
        removed: successCount,
        failed: failCount,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error, groupId }, 'Failed to remove agents from group');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
