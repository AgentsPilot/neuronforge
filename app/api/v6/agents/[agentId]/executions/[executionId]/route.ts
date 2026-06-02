// app/api/v6/agents/[agentId]/executions/[executionId]/route.ts
// Get detailed execution data including insight runs for the drawer

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'API', route: '/api/v6/agents/[agentId]/executions/[executionId]' });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string; executionId: string }> }
) {
  const startTime = Date.now();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const { agentId, executionId } = await params;

  const requestLogger = logger.child({ correlationId, agentId, executionId });
  requestLogger.info('Fetching execution details');

  try {
    // Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Verify agent ownership
    const { data: agent, error: agentError } = await supabaseServer
      .from('agents')
      .select('id, user_id, manual_time_per_item_seconds, workflow_purpose')
      .eq('id', agentId)
      .eq('user_id', user.id)
      .single();

    if (agentError || !agent) {
      requestLogger.warn({ err: agentError }, 'Agent not found or access denied');
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Fetch execution
    const { data: execution, error: execError } = await supabaseServer
      .from('agent_executions')
      .select('*')
      .eq('id', executionId)
      .eq('agent_id', agentId)
      .single();

    if (execError || !execution) {
      requestLogger.warn({ err: execError }, 'Execution not found');
      return NextResponse.json(
        { success: false, error: 'Execution not found' },
        { status: 404 }
      );
    }

    // Fetch execution_insight_runs for this execution
    const { data: insightRuns, error: insightRunsError } = await supabaseServer
      .from('execution_insight_runs')
      .select('*')
      .eq('execution_id', executionId)
      .order('created_at', { ascending: false });

    if (insightRunsError) {
      requestLogger.warn({ err: insightRunsError }, 'Failed to fetch insight runs (non-blocking)');
    }

    // Fetch execution_metrics for this execution (has step_metrics JSONB)
    const { data: metrics, error: metricsError } = await supabaseServer
      .from('execution_metrics')
      .select('*')
      .eq('execution_id', executionId)
      .single();

    if (metricsError && metricsError.code !== 'PGRST116') {
      requestLogger.warn({ err: metricsError }, 'Failed to fetch execution_metrics (non-blocking)');
    }

    // Fetch execution_insights that reference this execution
    const { data: executionInsights, error: insightsError } = await supabaseServer
      .from('execution_insights')
      .select('*')
      .eq('agent_id', agentId)
      .contains('execution_ids', [executionId])
      .order('created_at', { ascending: false });

    if (insightsError) {
      requestLogger.warn({ err: insightsError }, 'Failed to fetch execution_insights (non-blocking)');
    }

    // Get step_metrics from execution_metrics table (primary source)
    // Fallback to logs.stepResults if execution_metrics doesn't have it
    const logs = execution.logs as any;
    const stepMetrics = metrics?.step_metrics || logs?.stepResults || [];

    // Build response
    const response = {
      execution: {
        id: execution.id,
        status: execution.status,
        created_at: execution.created_at,
        completed_at: execution.completed_at,
        execution_duration_ms: execution.execution_duration_ms,
        error_message: execution.error_message,
        output: execution.output,
        logs: execution.logs,
      },
      // Insight runs from the execution_insight_runs table (per-execution)
      insightRuns: insightRuns || [],
      // Execution insights from execution_insights table (agent-level, referencing this execution)
      executionInsights: executionInsights || [],
      // ROI metrics
      roi: metrics ? {
        items_processed: metrics.total_items,
        time_saved_seconds: metrics.time_saved_seconds,
        time_saved_hours: metrics.time_saved_seconds ? metrics.time_saved_seconds / 3600 : 0,
        cost_saved_usd: metrics.cost_saved_usd,
        manual_time_per_item_seconds: metrics.manual_time_per_item_seconds || agent.manual_time_per_item_seconds,
      } : null,
      // Step metrics from execution_metrics.step_metrics or logs
      metrics: {
        total_items: metrics?.total_items || logs?.metrics?.total_items || 0,
        duration_ms: execution.execution_duration_ms,
        has_empty_results: metrics?.has_empty_results || logs?.metrics?.has_empty_results || false,
        failed_step_count: metrics?.failed_step_count || logs?.stepsFailed || 0,
        field_names: metrics?.field_names || logs?.metrics?.field_names || [],
        items_by_field: metrics?.items_by_field || logs?.metrics?.items_by_field || {},
        step_metrics: Array.isArray(stepMetrics) ? stepMetrics.map((step: any, index: number) => ({
          step_index: index,
          step_name: step.step_name || step.stepName || `Step ${index + 1}`,
          plugin: step.plugin || 'unknown',
          action: step.action || 'unknown',
          step_type: step.step_type || step.stepType || 'action',
          status: step.status || (step.error ? 'failed' : 'success'),
          count: step.count || step.resultCount || 0,
          duration_ms: step.duration_ms || step.durationMs,
          fields: step.fields || [],
          error: step.error,
          metadata: step.metadata,
        })) : [],
      },
      // Agent context
      agent: {
        manual_time_per_item_seconds: agent.manual_time_per_item_seconds,
        workflow_purpose: agent.workflow_purpose,
      },
    };

    const duration = Date.now() - startTime;
    requestLogger.info({
      duration,
      insightRunsCount: insightRuns?.length || 0,
      executionInsightsCount: executionInsights?.length || 0,
      hasMetrics: !!metrics,
      stepCount: Array.isArray(stepMetrics) ? stepMetrics.length : 0,
    }, 'Execution details fetched successfully');

    return NextResponse.json({
      success: true,
      data: response,
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Failed to fetch execution details');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
