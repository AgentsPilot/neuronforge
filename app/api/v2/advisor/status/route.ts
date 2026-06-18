/**
 * Advisor Status API
 *
 * GET /api/v2/advisor/status - Check cached report and data availability
 *
 * Returns:
 * - cached_report: The cached advisor report if available
 * - data_availability: Info about user's data for progressive disclosure
 *
 * This endpoint NEVER triggers LLM calls - it's for checking status only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { AutomationAdvisor } from '@/lib/pilot/insight/AutomationAdvisor';

const logger = createLogger({ module: 'AdvisorStatusAPI' });

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

    // 2. Check for cached report
    const { data: cachedReport } = await supabaseServer
      .from('advisor_reports')
      .select('report_data, generated_at, expires_at')
      .eq('user_id', user.id)
      .gt('expires_at', new Date().toISOString())
      .single();

    // 3. Get data availability stats
    // First get user's agents
    const { data: userAgents } = await supabaseServer
      .from('agents')
      .select('id')
      .eq('user_id', user.id)
      .neq('status', 'deleted');

    const agentIds = userAgents?.map(a => a.id) || [];
    const automationCount = agentIds.length;

    // Then count executions for those agents
    let executionCount = 0;
    if (agentIds.length > 0) {
      const { count } = await supabaseServer
        .from('workflow_executions')
        .select('id', { count: 'exact', head: true })
        .in('agent_id', agentIds)
        .eq('run_mode', 'production')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

      executionCount = count || 0;
    }

    // Ready for analysis if: has at least 1 automation AND at least 3 executions
    const readyForAnalysis = automationCount > 0 && executionCount >= 3;

    const dataAvailability = {
      has_automations: automationCount > 0,
      has_executions: executionCount > 0,
      automation_count: automationCount,
      execution_count: executionCount,
      ready_for_analysis: readyForAnalysis,
    };

    requestLogger.info({
      userId: user.id,
      hasCachedReport: !!cachedReport,
      dataAvailability,
    }, 'Advisor status checked');

    // If we have a cached report, refresh portfolio metrics
    let cachedReportData = null;
    if (cachedReport) {
      const advisor = new AutomationAdvisor();
      const freshMetrics = await advisor.getPortfolioMetrics(user.id);

      const reportData = cachedReport.report_data as Record<string, unknown>;
      const cachedPortfolio = reportData.portfolio as Record<string, unknown> | undefined;

      // Merge fresh metrics into cached portfolio
      const refreshedPortfolio = cachedPortfolio
        ? {
            ...cachedPortfolio,
            ...(freshMetrics || {}),
          }
        : freshMetrics;

      cachedReportData = {
        ...reportData,
        portfolio: refreshedPortfolio,
        generated_at: cachedReport.generated_at,
        cached: true,
        metrics_refreshed: true,
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        cached_report: cachedReportData,
        data_availability: dataAvailability,
      },
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to check advisor status');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
