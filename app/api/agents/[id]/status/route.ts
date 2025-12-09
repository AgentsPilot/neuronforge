// app/api/agents/[id]/status/route.ts
// API route for updating agent status using AgentRepository

import { NextRequest, NextResponse } from 'next/server';
import { agentRepository } from '@/lib/repositories';
import type { AgentStatus } from '@/lib/repositories';

// Helper function to extract user ID from request
function getUserIdFromRequest(request: NextRequest): string | null {
  const userIdHeader = request.headers.get('x-user-id');
  const authHeader = request.headers.get('authorization');

  if (userIdHeader) {
    return userIdHeader;
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    // JWT token handling would go here
  }

  return null;
}

// PATCH /api/agents/[id]/status - Update agent status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params;
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized - Please provide user authentication',
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { status } = body as { status: AgentStatus };

    if (!status) {
      return NextResponse.json(
        { success: false, error: 'Status is required' },
        { status: 400 }
      );
    }

    // Use repository to update status (includes validation)
    const { data: agent, error } = await agentRepository.updateStatus(
      agentId,
      userId,
      status
    );

    if (error) {
      console.error('Error updating agent status:', error);
      return NextResponse.json(
        {
          success: false,
          error: error.message || 'Failed to update agent status',
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      agent,
    });

  } catch (error) {
    console.error('Unexpected error in PATCH /api/agents/[id]/status:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development'
          ? (error instanceof Error ? error.message : String(error))
          : undefined
      },
      { status: 500 }
    );
  }
}
