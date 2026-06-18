/**
 * Portfolio Analytics API
 *
 * GET /api/v2/analytics/portfolio - Get organization-wide analytics
 *
 * Returns comprehensive metrics for the user's entire automation portfolio.
 * All metrics are domain-agnostic (time, count, percentage).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { OrganizationService, OrganizationAnalytics } from '@/lib/services/OrganizationService';

const logger = createLogger({ module: 'PortfolioAnalyticsAPI' });

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

    // 2. Get analytics
    const orgService = new OrganizationService();
    const analytics = await orgService.getOrganizationAnalytics(user.id);

    if (!analytics) {
      return NextResponse.json(
        { success: false, error: 'Unable to fetch analytics' },
        { status: 500 }
      );
    }

    requestLogger.info({
      userId: user.id,
      orgId: analytics.organization.id,
      agentCount: analytics.stats.agent_count,
      executions30d: analytics.stats.total_executions_30d,
    }, 'Portfolio analytics fetched');

    // 3. Format response with computed metrics
    const response = {
      organization: {
        id: analytics.organization.id,
        name: analytics.organization.name,
      },
      summary: {
        total_workflows: analytics.stats.agent_count,
        total_groups: analytics.stats.group_count,
        team_members: analytics.stats.member_count,
      },
      metrics_30d: {
        total_executions: analytics.stats.total_executions_30d,
        success_rate: analytics.stats.success_rate_30d,
        total_time_saved_seconds: analytics.stats.total_time_saved_seconds_30d,
        total_time_saved_formatted: formatTime(analytics.stats.total_time_saved_seconds_30d),
      },
      groups: analytics.groups.map(group => ({
        id: group.id,
        name: group.name,
        workflow_count: group.agent_count,
        total_executions: group.total_executions || 0,
        time_saved_seconds: group.total_time_saved_seconds || 0,
      })),
      top_agents: analytics.top_agents.map(agent => ({
        id: agent.id,
        name: agent.name,
        execution_count: agent.execution_count,
        success_rate: agent.success_rate,
        time_saved_seconds: agent.time_saved_seconds,
      })),
      generated_at: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      data: response,
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch portfolio analytics');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
