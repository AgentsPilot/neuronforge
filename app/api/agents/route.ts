// app/api/agents/route.ts
// API route for listing agents using AgentRepository

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

// GET /api/agents - List all agents for a user
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized - Please provide user authentication',
          details: 'Missing x-user-id header or authorization token'
        },
        { status: 401 }
      );
    }

    // Get optional status filter from query params
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') as AgentStatus | null;
    const includeInactive = searchParams.get('includeInactive') === 'true';

    // Use repository to fetch agents
    const { data: agents, error } = await agentRepository.findAllByUser(userId, {
      status: statusFilter || undefined,
      includeInactive,
    });

    if (error) {
      console.error('Error fetching agents:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch agents',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      agents: agents || [],
    });

  } catch (error) {
    console.error('Unexpected error in GET /api/agents:', error);

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
