/**
 * Automation Advisor API (USER-TRIGGERED ONLY)
 *
 * GET /api/v2/advisor - Get cached report ONLY (no LLM call if no cache)
 * GET /api/v2/advisor?refresh=true - Generate/regenerate report (triggers LLM)
 * GET /api/v2/advisor?quick=true - Get quick recommendations (3 items)
 *
 * Reports are cached in the database for 24 hours.
 * Generation ONLY happens when user explicitly requests via ?refresh=true.
 *
 * For status/data availability checks without LLM: use /api/v2/advisor/status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { AutomationAdvisor } from '@/lib/pilot/insight/AutomationAdvisor';
import { CorrelationEngine } from '@/lib/pilot/insight/CorrelationEngine';
import { PredictiveAnalytics } from '@/lib/pilot/insight/PredictiveAnalytics';
import { OrganizationService } from '@/lib/services/OrganizationService';

const logger = createLogger({ module: 'AdvisorAPI' });

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

    // 2. Get user's organization
    const orgService = new OrganizationService();
    const org = await orgService.getCurrentOrganization(user.id);

    if (!org) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      );
    }

    // 3. Parse query params
    const { searchParams } = new URL(request.url);
    const quickMode = searchParams.get('quick') === 'true';
    const forceRefresh = searchParams.get('refresh') === 'true';
    const includeCorrelations = searchParams.get('correlations') !== 'false';
    const includePredictions = searchParams.get('predictions') !== 'false';

    requestLogger.info({
      userId: user.id,
      orgId: org.id,
      quickMode,
      forceRefresh,
      includeCorrelations,
      includePredictions,
    }, 'Advisor report requested');

    // 4. Check for cached report
    if (!quickMode) {
      const { data: cachedReport } = await supabaseServer
        .from('advisor_reports')
        .select('report_data, generated_at, expires_at')
        .eq('user_id', user.id)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (cachedReport && !forceRefresh) {
        requestLogger.info({
          userId: user.id,
          cachedAt: cachedReport.generated_at,
        }, 'Returning cached advisor report with fresh portfolio metrics');

        // Refresh portfolio metrics while keeping cached recommendations
        const advisor = new AutomationAdvisor();
        const freshMetrics = await advisor.getPortfolioMetrics(user.id);

        const reportData = cachedReport.report_data as Record<string, unknown>;
        const cachedPortfolio = reportData.portfolio as Record<string, unknown> | undefined;

        // Merge fresh metrics into cached portfolio (keep other portfolio fields like groups, top_performers, etc.)
        const refreshedPortfolio = cachedPortfolio
          ? {
              ...cachedPortfolio,
              ...(freshMetrics || {}),
            }
          : freshMetrics;

        return NextResponse.json({
          success: true,
          data: {
            ...reportData,
            portfolio: refreshedPortfolio,
            generated_at: cachedReport.generated_at,
            cached: true,
            metrics_refreshed: true,
          },
        });
      }

      // If no cache and no refresh requested, return empty (user-triggered only)
      if (!cachedReport && !forceRefresh) {
        requestLogger.info({
          userId: user.id,
        }, 'No cached report, returning empty (user must trigger generation)');

        return NextResponse.json({
          success: true,
          data: null,
          message: 'No cached report. Use ?refresh=true to generate.',
        });
      }
    }

    // 5. Generate new report (only when ?refresh=true or quickMode)
    const advisor = new AutomationAdvisor();

    if (quickMode) {
      // Quick mode: just recommendations (no caching)
      const recommendations = await advisor.getQuickRecommendations(user.id);

      return NextResponse.json({
        success: true,
        data: {
          recommendations,
          generated_at: new Date().toISOString(),
        },
      });
    }

    // 6. Full report mode - generate and cache
    const [report, correlations, predictions] = await Promise.all([
      advisor.generateReport(user.id),
      includeCorrelations
        ? new CorrelationEngine().analyzePortfolio(user.id, org.id)
        : Promise.resolve([]),
      includePredictions
        ? new PredictiveAnalytics().predictForOrganization(org.id, org.name)
        : Promise.resolve(null),
    ]);

    const fullReport = {
      ...report,
      correlations,
      predictions,
    };

    // 7. Cache the report (upsert - replace if exists)
    const { error: cacheError } = await supabaseServer
      .from('advisor_reports')
      .upsert({
        user_id: user.id,
        org_id: org.id,
        report_data: fullReport,
        generated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (cacheError) {
      requestLogger.warn({ err: cacheError }, 'Failed to cache advisor report (non-blocking)');
    }

    requestLogger.info({
      userId: user.id,
      recommendationCount: report.recommendations.length,
      correlationCount: correlations.length,
      predictionCount: predictions?.predictions.length ?? 0,
    }, 'Advisor report generated and cached');

    return NextResponse.json({
      success: true,
      data: {
        ...fullReport,
        generated_at: new Date().toISOString(),
        cached: false,
      },
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to generate advisor report');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
