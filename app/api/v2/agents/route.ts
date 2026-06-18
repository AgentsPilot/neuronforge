/**
 * Agents List API (V2)
 *
 * GET /api/v2/agents - Get all agents for the authenticated user
 *
 * Returns a simplified list of agents with id, name, and status.
 * Used by ManageCategoriesDrawer for assigning agents to groups.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'AgentsListAPI' });

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

    // 2. Get query params
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
    const includeInactive = url.searchParams.get('includeInactive') === 'true';

    // 3. Fetch agents
    let query = supabaseServer
      .from('agents')
      .select('id, agent_name, status')
      .eq('user_id', user.id)
      .neq('status', 'deleted')
      .order('agent_name', { ascending: true })
      .limit(limit);

    if (!includeInactive) {
      query = query.neq('status', 'inactive');
    }

    const { data: agents, error } = await query;

    if (error) {
      requestLogger.error({ err: error }, 'Failed to fetch agents');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch agents' },
        { status: 500 }
      );
    }

    requestLogger.info({
      userId: user.id,
      agentCount: agents?.length || 0,
    }, 'Agents list fetched');

    return NextResponse.json({
      success: true,
      data: agents || [],
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch agents');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
