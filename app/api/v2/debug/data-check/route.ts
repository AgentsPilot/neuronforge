/**
 * Debug API - Data Check
 *
 * GET /api/v2/debug/data-check
 *
 * Returns diagnostic information about the current user's data access.
 * This helps verify if the seeded data is visible to the authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'DebugDataCheck' });

export async function GET(request: NextRequest) {
  try {
    // 1. Check authentication
    const user = await getUser();

    if (!user) {
      return NextResponse.json({
        authenticated: false,
        message: 'No authenticated user found. You must be logged in to see data.',
        expected_user_id: '868fda6a-59fa-4e99-8930-9951484078bf',
      });
    }

    const expectedUserId = '868fda6a-59fa-4e99-8930-9951484078bf';
    const userIdMatches = user.id === expectedUserId;

    // 2. Count data for this user
    const [
      { count: orgCount },
      { count: groupCount },
      { count: agentCount },
      { count: slaCount },
      { count: executionCount },
    ] = await Promise.all([
      supabaseServer.from('organizations').select('*', { count: 'exact', head: true }).eq('owner_user_id', user.id),
      supabaseServer.from('workflow_groups').select('*', { count: 'exact', head: true }).eq('org_id', (await supabaseServer.from('organizations').select('id').eq('owner_user_id', user.id).single()).data?.id || ''),
      supabaseServer.from('agents').select('*', { count: 'exact', head: true }).eq('user_id', user.id).neq('status', 'deleted'),
      supabaseServer.from('automation_slas').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
      supabaseServer.from('agent_executions').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    ]);

    // 3. Get org details
    const { data: org } = await supabaseServer
      .from('organizations')
      .select('id, name')
      .eq('owner_user_id', user.id)
      .single();

    logger.info({
      userId: user.id,
      userIdMatches,
      orgCount,
      groupCount,
      agentCount,
      slaCount,
    }, 'Debug data check');

    return NextResponse.json({
      authenticated: true,
      current_user: {
        id: user.id,
        email: user.email,
      },
      expected_user_id: expectedUserId,
      user_id_matches_seed: userIdMatches,
      organization: org,
      data_counts: {
        organizations: orgCount || 0,
        workflow_groups: groupCount || 0,
        agents: agentCount || 0,
        automation_slas: slaCount || 0,
        agent_executions: executionCount || 0,
      },
      message: userIdMatches
        ? 'User ID matches the seeded data. If counts are 0, the seed script may not have run successfully.'
        : `User ID mismatch! Logged in as ${user.id}, but data was seeded for ${expectedUserId}. Run the seed script with YOUR user ID.`,
    });
  } catch (error) {
    logger.error({ err: error }, 'Debug data check failed');
    return NextResponse.json({
      error: 'Check failed',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
