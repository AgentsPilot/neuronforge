/**
 * Group Metrics API
 *
 * GET /api/v2/analytics/by-group - Get metrics aggregated by workflow group
 *
 * Returns metrics for each user-defined workflow group:
 * - Total executions, success rate
 * - Time saved, money saved
 * - Trend vs previous period
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { OrganizationSettingsService } from '@/lib/services/OrganizationSettingsService';

const logger = createLogger({ module: 'GroupMetricsAPI' });

export interface GroupMetrics {
  group_id: string;
  group_name: string;
  group_color: string | null;
  group_icon: string | null;
  workflow_count: number;
  workflow_names: string[];
  total_executions: number;
  successful_executions: number;
  success_rate: number;
  total_time_saved_seconds: number;
  total_money_saved_usd: number;
  time_saved_change_pct: number | null;
}

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID();
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

    requestLogger.info({ userId: user.id }, 'Fetching group metrics');

    // 2. Get user's organization
    const { data: org } = await supabaseServer
      .from('organizations')
      .select('id')
      .eq('owner_user_id', user.id)
      .single();

    if (!org) {
      return NextResponse.json({ success: true, data: [] });
    }

    // 3. Get all workflow groups
    const { data: groups, error: groupsError } = await supabaseServer
      .from('workflow_groups')
      .select('id, name, color, icon')
      .eq('org_id', org.id)
      .order('display_order', { ascending: true });

    if (groupsError) throw groupsError;

    if (!groups || groups.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // 4. Get group memberships with agent names
    const { data: memberships } = await supabaseServer
      .from('agent_group_memberships')
      .select('agent_id, group_id, agents!inner(id, agent_name, user_id)')
      .in('group_id', groups.map(g => g.id));

    // Build map of group_id -> agent info
    const groupAgentMap = new Map<string, { id: string; name: string }[]>();
    memberships?.forEach((m: any) => {
      if (m.agents?.user_id === user.id) {
        const agents = groupAgentMap.get(m.group_id) || [];
        agents.push({ id: m.agent_id, name: m.agents.agent_name });
        groupAgentMap.set(m.group_id, agents);
      }
    });

    // 5. Get 30-day execution data for all user's agents
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const previousThirtyDays = new Date(thirtyDaysAgo);
    previousThirtyDays.setDate(previousThirtyDays.getDate() - 30);

    const { data: currentExecutions } = await supabaseServer
      .from('agent_executions')
      .select('id, agent_id, status')
      .eq('user_id', user.id)
      .neq('run_mode', 'calibration')
      .gte('started_at', thirtyDaysAgo.toISOString());

    const { data: previousExecutions } = await supabaseServer
      .from('agent_executions')
      .select('id, agent_id, status')
      .eq('user_id', user.id)
      .neq('run_mode', 'calibration')
      .gte('started_at', previousThirtyDays.toISOString())
      .lt('started_at', thirtyDaysAgo.toISOString());

    // Get execution metrics
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

    // Build maps for quick lookup
    const execToAgentMap = new Map<string, string>();
    currentExecutions?.forEach(e => execToAgentMap.set(e.id, e.agent_id));
    previousExecutions?.forEach(e => execToAgentMap.set(e.id, e.agent_id));

    const currentMetricsMap = new Map<string, number>();
    currentMetrics?.forEach(m => currentMetricsMap.set(m.execution_id, m.time_saved_seconds || 0));

    const previousMetricsMap = new Map<string, number>();
    previousMetrics?.forEach(m => previousMetricsMap.set(m.execution_id, m.time_saved_seconds || 0));

    // 6. Get hourly rate
    const settingsService = new OrganizationSettingsService();
    const hourlyRate = await settingsService.getHourlyRate(user.id);

    // 7. Calculate metrics per group
    const groupMetrics: GroupMetrics[] = groups.map(group => {
      const agents = groupAgentMap.get(group.id) || [];
      const agentIds = new Set(agents.map(a => a.id));

      // Current period metrics
      const groupCurrentExecs = currentExecutions?.filter(e => agentIds.has(e.agent_id)) || [];
      const totalExecutions = groupCurrentExecs.length;
      const successfulExecutions = groupCurrentExecs.filter(e => e.status === 'completed').length;
      const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0;

      // Calculate time saved
      let totalTimeSaved = 0;
      groupCurrentExecs.forEach(exec => {
        totalTimeSaved += currentMetricsMap.get(exec.id) || 0;
      });

      // Previous period time saved (for trend)
      const groupPreviousExecs = previousExecutions?.filter(e => agentIds.has(e.agent_id)) || [];
      let previousTimeSaved = 0;
      groupPreviousExecs.forEach(exec => {
        previousTimeSaved += previousMetricsMap.get(exec.id) || 0;
      });

      // Calculate trend
      let timeSavedChangePct: number | null = null;
      if (previousTimeSaved > 0) {
        timeSavedChangePct = Math.round(
          ((totalTimeSaved - previousTimeSaved) / previousTimeSaved) * 100
        );
      } else if (totalTimeSaved > 0) {
        timeSavedChangePct = 100; // 100% increase from 0
      }

      const moneySaved = (totalTimeSaved / 3600) * hourlyRate;

      return {
        group_id: group.id,
        group_name: group.name,
        group_color: group.color,
        group_icon: group.icon,
        workflow_count: agents.length,
        workflow_names: agents.map(a => a.name),
        total_executions: totalExecutions,
        successful_executions: successfulExecutions,
        success_rate: Math.round(successRate),
        total_time_saved_seconds: totalTimeSaved,
        total_money_saved_usd: Math.round(moneySaved),
        time_saved_change_pct: timeSavedChangePct,
      };
    });

    // Sort by time saved (most valuable first)
    groupMetrics.sort((a, b) => b.total_time_saved_seconds - a.total_time_saved_seconds);

    requestLogger.info({ userId: user.id, groupCount: groupMetrics.length }, 'Group metrics fetched');

    return NextResponse.json({ success: true, data: groupMetrics });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch group metrics');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch group metrics' },
      { status: 500 }
    );
  }
}
