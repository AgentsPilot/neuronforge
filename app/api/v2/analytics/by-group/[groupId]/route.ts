/**
 * Group Analytics API
 *
 * GET /api/v2/analytics/by-group/[groupId] - Get analytics for a user-defined group
 *
 * Returns detailed metrics for workflows within a specific group.
 * Used by CategoryDrilldownDrawer for category drill-down view.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { OrganizationService } from '@/lib/services/OrganizationService';
import { WorkflowGroupRepository } from '@/lib/repositories/WorkflowGroupRepository';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'GroupAnalyticsAPI' });

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

interface AgentMetrics {
  agent_id: string;
  agent_name: string;
  status: string;
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  success_rate: number;
  time_saved_seconds: number;
  time_saved_change_pct: number | null;
  last_execution_at: string | null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { groupId } = await context.params;

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Verify organization access
    const orgService = new OrganizationService();
    const org = await orgService.getCurrentOrganization(user.id);

    if (!org) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      );
    }

    // 3. Verify group belongs to user's organization
    const groupRepo = new WorkflowGroupRepository();
    const groupResult = await groupRepo.findById(groupId);

    if (!groupResult.data || groupResult.data.org_id !== org.id) {
      return NextResponse.json(
        { success: false, error: 'Group not found' },
        { status: 404 }
      );
    }

    const group = groupResult.data;

    // 4. Get agent IDs in this group
    const agentIdsResult = await groupRepo.getGroupAgentIds(groupId);
    const agentIds = agentIdsResult.data || [];

    if (agentIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          group: {
            group_id: group.id,
            group_name: group.name,
            group_color: group.color,
            workflow_count: 0,
            workflow_names: [],
            total_time_saved_seconds: 0,
            time_saved_change_pct: null,
          },
          agents: [],
        },
      });
    }

    // 5. Get agent details
    const { data: agents } = await supabaseServer
      .from('agents')
      .select('id, agent_name, status')
      .in('id', agentIds)
      .eq('user_id', user.id);

    // 6. Calculate date ranges
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sixtyDaysAgo = new Date(thirtyDaysAgo);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 30);

    // 7. Get current period executions
    const { data: currentExecutions } = await supabaseServer
      .from('agent_executions')
      .select('id, agent_id, status, started_at')
      .in('agent_id', agentIds)
      .eq('user_id', user.id)
      .neq('run_mode', 'calibration')
      .gte('started_at', thirtyDaysAgo.toISOString());

    // 8. Get previous period executions (for trend calculation)
    const { data: previousExecutions } = await supabaseServer
      .from('agent_executions')
      .select('id, agent_id')
      .in('agent_id', agentIds)
      .eq('user_id', user.id)
      .neq('run_mode', 'calibration')
      .gte('started_at', sixtyDaysAgo.toISOString())
      .lt('started_at', thirtyDaysAgo.toISOString());

    // 9. Get execution metrics for time saved
    const currentExecIds = currentExecutions?.map(e => e.id) || [];
    const previousExecIds = previousExecutions?.map(e => e.id) || [];

    const { data: currentMetrics } = await supabaseServer
      .from('execution_metrics')
      .select('execution_id, time_saved_seconds')
      .in('execution_id', currentExecIds.length > 0 ? currentExecIds : ['none']);

    const { data: previousMetrics } = await supabaseServer
      .from('execution_metrics')
      .select('execution_id, time_saved_seconds')
      .in('execution_id', previousExecIds.length > 0 ? previousExecIds : ['none']);

    // 10. Build lookup maps
    const execToAgentMap = new Map<string, string>();
    currentExecutions?.forEach(e => execToAgentMap.set(e.id, e.agent_id));
    previousExecutions?.forEach(e => execToAgentMap.set(e.id, e.agent_id));

    const currentMetricsMap = new Map<string, number>();
    currentMetrics?.forEach(m => currentMetricsMap.set(m.execution_id, m.time_saved_seconds || 0));

    const previousMetricsMap = new Map<string, number>();
    previousMetrics?.forEach(m => previousMetricsMap.set(m.execution_id, m.time_saved_seconds || 0));

    // 11. Calculate per-agent metrics
    const agentMetricsList: AgentMetrics[] = (agents || []).map(agent => {
      const agentCurrentExecs = currentExecutions?.filter(e => e.agent_id === agent.id) || [];
      const agentPreviousExecs = previousExecutions?.filter(e => e.agent_id === agent.id) || [];

      const totalExecutions = agentCurrentExecs.length;
      const successfulExecutions = agentCurrentExecs.filter(e => e.status === 'completed').length;
      const failedExecutions = agentCurrentExecs.filter(e => e.status === 'failed').length;
      const successRate = totalExecutions > 0 ? Math.round((successfulExecutions / totalExecutions) * 100) : 100;

      // Time saved
      let currentTimeSaved = 0;
      agentCurrentExecs.forEach(exec => {
        currentTimeSaved += currentMetricsMap.get(exec.id) || 0;
      });

      let previousTimeSaved = 0;
      agentPreviousExecs.forEach(exec => {
        previousTimeSaved += previousMetricsMap.get(exec.id) || 0;
      });

      // Trend calculation
      let timeSavedChangePct: number | null = null;
      if (previousTimeSaved > 0) {
        timeSavedChangePct = Math.round(((currentTimeSaved - previousTimeSaved) / previousTimeSaved) * 100);
      } else if (currentTimeSaved > 0) {
        timeSavedChangePct = 100;
      }

      // Last execution
      const sortedExecs = [...agentCurrentExecs].sort((a, b) =>
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
      );
      const lastExecutionAt = sortedExecs.length > 0 ? sortedExecs[0].started_at : null;

      return {
        agent_id: agent.id,
        agent_name: agent.agent_name,
        status: agent.status,
        total_executions: totalExecutions,
        successful_executions: successfulExecutions,
        failed_executions: failedExecutions,
        success_rate: successRate,
        time_saved_seconds: currentTimeSaved,
        time_saved_change_pct: timeSavedChangePct,
        last_execution_at: lastExecutionAt,
      };
    });

    // 12. Calculate group totals
    const totalTimeSaved = agentMetricsList.reduce((sum, a) => sum + a.time_saved_seconds, 0);
    const previousTotalTimeSaved = (previousMetrics || []).reduce((sum, m) => sum + (m.time_saved_seconds || 0), 0);

    let groupTimeSavedChangePct: number | null = null;
    if (previousTotalTimeSaved > 0) {
      groupTimeSavedChangePct = Math.round(((totalTimeSaved - previousTotalTimeSaved) / previousTotalTimeSaved) * 100);
    } else if (totalTimeSaved > 0) {
      groupTimeSavedChangePct = 100;
    }

    // Sort agents by time saved (most valuable first)
    agentMetricsList.sort((a, b) => b.time_saved_seconds - a.time_saved_seconds);

    requestLogger.info({
      userId: user.id,
      groupId,
      agentCount: agentIds.length,
    }, 'Group detail fetched');

    return NextResponse.json({
      success: true,
      data: {
        group: {
          group_id: group.id,
          group_name: group.name,
          group_color: group.color,
          workflow_count: agents?.length || 0,
          workflow_names: agents?.map(a => a.agent_name) || [],
          total_time_saved_seconds: totalTimeSaved,
          time_saved_change_pct: groupTimeSavedChangePct,
        },
        agents: agentMetricsList,
      },
    });

  } catch (error) {
    requestLogger.error({ err: error, groupId }, 'Failed to fetch group analytics');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
