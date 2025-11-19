// app/api/agents/[id]/executions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with Service Role Key
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

// GET /api/agents/[id]/executions - Retrieve agent executions
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit');

    console.log('[Executions API] Request received:', { agentId: id, limit });

    const userId = getUserIdFromRequest(request);
    console.log('[Executions API] User ID:', userId);

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

    const agentId = id;

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      );
    }

    // Verify the agent exists and user owns it
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .maybeSingle();

    if (agentError) {
      console.error('[Executions API] Error checking agent:', agentError);
      return NextResponse.json(
        {
          success: false,
          error: 'Database error',
          details: process.env.NODE_ENV === 'development' ? agentError.message : undefined
        },
        { status: 500 }
      );
    }

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      );
    }

    // Build query for executions
    let query = supabase
      .from('agent_executions')
      .select('id, started_at, completed_at, status')
      .eq('agent_id', agentId)
      .order('started_at', { ascending: false });

    // Apply limit if provided
    if (limit) {
      const limitNum = parseInt(limit, 10);
      if (!isNaN(limitNum) && limitNum > 0) {
        query = query.limit(limitNum);
      }
    }

    const { data: executions, error: executionsError } = await query;

    if (executionsError) {
      console.error('Error fetching executions:', executionsError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch executions' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: executions || []
    });

  } catch (error) {
    console.error('Error in GET /api/agents/[id]/executions:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error instanceof Error ? error.message : String(error) : undefined
      },
      { status: 500 }
    );
  }
}
