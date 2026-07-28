/**
 * Insights API - Execution Optimization & Anomaly Detection
 *
 * GET /api/insights - Get user's optimization summary
 * GET /api/insights?agentId=xxx - Get specific agent analysis
 *
 * Part of Memory System Phase 6: Execution Optimization
 *
 * @module app/api/insights/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { getWorkflowOptimizer } from '@/lib/services/WorkflowOptimizer';
import { getAnomalyDetector } from '@/lib/services/AnomalyDetector';
import { getBaselineService } from '@/lib/services/BaselineService';

const logger = createLogger({ module: 'InsightsAPI' });

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

    // 2. Parse query params
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const includeAnomalies = searchParams.get('includeAnomalies') !== 'false';
    const includeBaseline = searchParams.get('includeBaseline') !== 'false';

    const supabase = supabaseServer;
    const optimizer = getWorkflowOptimizer(supabase);
    const anomalyDetector = getAnomalyDetector(supabase);
    const baselineService = getBaselineService(supabase);

    // 3. Get specific agent analysis or user summary
    if (agentId) {
      requestLogger.info({ userId: user.id, agentId }, 'Getting agent insights');

      const [analysis, anomalies, baseline, healthScore] = await Promise.all([
        optimizer.analyzeWorkflow(agentId, user.id),
        includeAnomalies
          ? anomalyDetector.getUnresolvedAnomalies(agentId, user.id)
          : Promise.resolve([]),
        includeBaseline
          ? baselineService.getBaseline(agentId, user.id)
          : Promise.resolve(null),
        optimizer.calculateHealthScore(agentId, user.id),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          agentId,
          analysis,
          healthScore,
          anomalies,
          baseline: baseline
            ? {
                sampleCount: baseline.sample_count,
                avgDurationMs: baseline.avg_duration_ms,
                stddevDurationMs: baseline.stddev_duration_ms,
                avgTokenUsage: baseline.avg_token_usage,
                stddevTokenUsage: baseline.stddev_token_usage,
                avgStepCount: baseline.avg_step_count,
                avgRetryCount: baseline.avg_retry_count,
                successRate: baseline.success_rate,
              }
            : null,
        },
      });
    }

    // 4. Get user-wide summary
    requestLogger.info({ userId: user.id }, 'Getting user insights summary');

    const [summary, anomalySummary] = await Promise.all([
      optimizer.getUserOptimizationSummary(user.id),
      anomalyDetector.getAnomalySummary(user.id),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        optimization: summary,
        anomalies: anomalySummary,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Insights request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
