/**
 * Health Score API
 *
 * GET /api/v2/analytics/health-score - Calculate business health score
 *
 * Health Score Formula:
 * score = (Reliability × 0.4) + (Efficiency × 0.3) + (Coverage × 0.3)
 *
 * Where:
 * - Reliability = Success Rate % (from agent_executions)
 * - Efficiency = Executions meeting SLA / Total executions %
 * - Coverage = Active Workflows / Total Workflows %
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'HealthScoreAPI' });

export interface HealthScoreResponse {
  score: number;
  status: 'excellent' | 'good' | 'warning' | 'critical';
  breakdown: {
    reliability: number;
    efficiency: number;
    coverage: number;
  };
  details: {
    total_executions_30d: number;
    successful_executions_30d: number;
    total_workflows: number;
    active_workflows: number;
    avg_duration_ms: number | null;
  };
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

    requestLogger.info({ userId: user.id }, 'Calculating health score');

    // 2. Get 30-day execution data
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: executions, error: execError } = await supabaseServer
      .from('agent_executions')
      .select('id, status, agent_id, started_at, completed_at')
      .eq('user_id', user.id)
      .neq('run_mode', 'calibration')
      .gte('started_at', thirtyDaysAgo.toISOString());

    if (execError) throw execError;

    // 3. Get all workflows
    const { data: workflows, error: workflowError } = await supabaseServer
      .from('agents')
      .select('id, status')
      .eq('user_id', user.id)
      .neq('status', 'deleted');

    if (workflowError) throw workflowError;

    // 4. Get SLA data (for efficiency calculation)
    const { data: slas } = await supabaseServer
      .from('automation_slas')
      .select('id, metric_type, threshold_value, operator')
      .eq('user_id', user.id)
      .eq('status', 'active');

    // 5. Calculate metrics
    const totalExecutions = executions?.length || 0;
    const successfulExecutions = executions?.filter(e => e.status === 'completed').length || 0;
    const totalWorkflows = workflows?.length || 0;

    // Active workflows = workflows that have run in the last 30 days
    const activeWorkflowIds = new Set(executions?.map(e => e.agent_id) || []);
    const activeWorkflows = activeWorkflowIds.size;

    // Calculate average duration
    let totalDuration = 0;
    let durationCount = 0;
    executions?.forEach(exec => {
      if (exec.started_at && exec.completed_at) {
        const duration = new Date(exec.completed_at).getTime() - new Date(exec.started_at).getTime();
        totalDuration += duration;
        durationCount++;
      }
    });
    const avgDuration = durationCount > 0 ? totalDuration / durationCount : null;

    // 6. Calculate component scores

    // Reliability: Success rate (0-100)
    const reliability = totalExecutions > 0
      ? (successfulExecutions / totalExecutions) * 100
      : 100; // 100% if no executions

    // Efficiency: Percentage of executions meeting SLA (or 100% if no SLAs defined)
    let efficiency = 100;
    if (slas && slas.length > 0 && avgDuration !== null) {
      // Check against duration SLA if defined
      const durationSla = slas.find(s => s.metric_type === 'avg_duration_ms');
      if (durationSla) {
        const threshold = durationSla.threshold_value;
        // For duration, lower is better, so "lte" operator means meeting SLA
        efficiency = avgDuration <= threshold ? 100 : Math.max(0, (threshold / avgDuration) * 100);
      }
    }

    // Coverage: Active workflows / Total workflows (0-100)
    const coverage = totalWorkflows > 0
      ? (activeWorkflows / totalWorkflows) * 100
      : 0; // 0% if no workflows

    // 7. Calculate overall score with weights
    const score = Math.round(
      (reliability * 0.4) + (efficiency * 0.3) + (coverage * 0.3)
    );

    // 8. Determine status
    let status: 'excellent' | 'good' | 'warning' | 'critical';
    if (score >= 90) {
      status = 'excellent';
    } else if (score >= 75) {
      status = 'good';
    } else if (score >= 50) {
      status = 'warning';
    } else {
      status = 'critical';
    }

    const response: HealthScoreResponse = {
      score,
      status,
      breakdown: {
        reliability: Math.round(reliability),
        efficiency: Math.round(efficiency),
        coverage: Math.round(coverage),
      },
      details: {
        total_executions_30d: totalExecutions,
        successful_executions_30d: successfulExecutions,
        total_workflows: totalWorkflows,
        active_workflows: activeWorkflows,
        avg_duration_ms: avgDuration ? Math.round(avgDuration) : null,
      },
    };

    requestLogger.info({ userId: user.id, score, status }, 'Health score calculated');

    return NextResponse.json({ success: true, data: response });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to calculate health score');
    return NextResponse.json(
      { success: false, error: 'Failed to calculate health score' },
      { status: 500 }
    );
  }
}
