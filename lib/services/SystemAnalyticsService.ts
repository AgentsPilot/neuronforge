// lib/services/SystemAnalyticsService.ts
// Business-focused analytics service for transforming technical metrics into actionable insights

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import type {
  TimeRange,
  BusinessAnalyticsData,
  VolumeTrendPoint,
  CostTrendPoint,
  AgentBreakdownItem
} from '@/types/analytics';

interface HeroMetrics {
  totalRuns: number;
  totalRunsChange: number;
  successRate: number;
  moneySaved: number;
  costPerExecution: number;
  hoursAutomated: number;
}

interface SystemHealth {
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  failedRuns24h: number;
  activeInsights: number;
}

export class SystemAnalyticsService {
  private supabase: SupabaseClient;
  private logger: ReturnType<typeof createLogger>;

  constructor() {
    this.supabase = supabaseServer;
    this.logger = createLogger({ service: 'SystemAnalyticsService' });
  }

  /**
   * Get comprehensive business-focused analytics overview
   */
  async getBusinessOverview(userId: string, timeRange: TimeRange): Promise<BusinessAnalyticsData> {
    const methodLogger = this.logger.child({ method: 'getBusinessOverview', userId, timeRange });
    const startTime = Date.now();

    try {
      const { startDate, endDate, days } = this.getDateRange(timeRange);

      methodLogger.info({ startDate, endDate, days }, 'Fetching business analytics');

      // Fetch all data in parallel for optimal performance
      const [heroMetrics, volumeTrends, costTrends, agentBreakdown, systemHealth] = await Promise.all([
        this.getHeroMetrics(userId, startDate, endDate, days),
        this.getVolumeTrends(userId, startDate, endDate),
        this.getCostTrends(userId, startDate, endDate),
        this.getAgentBreakdown(userId, startDate, endDate),
        this.getSystemHealth(userId, startDate, endDate),
      ]);

      const duration = Date.now() - startTime;
      methodLogger.info({ duration }, 'Business analytics fetched successfully');

      return {
        timeRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          days,
        },
        heroMetrics,
        volumeTrends,
        costTrends,
        agentBreakdown,
        systemHealth,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch business analytics');
      throw error;
    }
  }

  /**
   * Calculate date range based on time filter
   * IMPORTANT: All dates are calculated in UTC to avoid timezone mismatches
   */
  private getDateRange(range: TimeRange): { startDate: Date; endDate: Date; days: number } {
    const now = new Date();

    // Get today's date at midnight UTC (start of day)
    const endDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23, 59, 59, 999 // End of day UTC
    ));

    let startDate: Date;
    let days: number;

    switch (range) {
      case '7d':
        days = 7;
        // 7 days ago from today (start of that day in UTC)
        startDate = new Date(Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - 7,
          0, 0, 0, 0
        ));
        break;
      case '30d':
        days = 30;
        // 30 days ago from today (start of that day in UTC)
        startDate = new Date(Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - 30,
          0, 0, 0, 0
        ));
        break;
      case '90d':
        days = 90;
        // 90 days ago from today (start of that day in UTC)
        startDate = new Date(Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - 90,
          0, 0, 0, 0
        ));
        break;
      case 'all':
        days = 365 * 10; // 10 years (effectively all time)
        startDate = new Date(0); // Unix epoch
        break;
    }

    return { startDate, endDate, days };
  }

  /**
   * Get hero metrics (top 4 business KPIs)
   */
  private async getHeroMetrics(
    userId: string,
    startDate: Date,
    endDate: Date,
    days: number
  ): Promise<HeroMetrics> {
    // 1. Get current period executions (excluding calibration runs)
    // Include logs to get token usage for cost calculation
    const { data: currentExecutions, error: currentError } = await this.supabase
      .from('agent_executions')
      .select('id, status, started_at, agent_id, logs')
      .eq('user_id', userId)
      .neq('run_mode', 'calibration') // Only production runs
      .gte('started_at', startDate.toISOString())
      .lte('started_at', endDate.toISOString());

    if (currentError) throw currentError;

    // 2. Get previous period for trend comparison
    const previousPeriodDuration = endDate.getTime() - startDate.getTime();
    const previousStartDate = new Date(startDate.getTime() - previousPeriodDuration);

    const { data: previousExecutions } = await this.supabase
      .from('agent_executions')
      .select('id, status')
      .eq('user_id', userId)
      .neq('run_mode', 'calibration')
      .gte('started_at', previousStartDate.toISOString())
      .lt('started_at', startDate.toISOString());

    // 3. Calculate run metrics
    const totalRuns = currentExecutions?.length || 0;
    const previousRuns = previousExecutions?.length || 0;
    const totalRunsChange = previousRuns > 0
      ? ((totalRuns - previousRuns) / previousRuns) * 100
      : totalRuns > 0 ? 100 : 0; // 100% if first period, 0 if no data

    const successfulRuns = currentExecutions?.filter(e => e.status === 'completed').length || 0;
    const successRate = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0;

    // 4. Get execution metrics for ROI calculation
    const executionIds = currentExecutions?.map(e => e.id) || [];

    if (executionIds.length === 0) {
      // No executions - return zeros
      return {
        totalRuns: 0,
        totalRunsChange: 0,
        successRate: 0,
        moneySaved: 0,
        costPerExecution: 0,
        hoursAutomated: 0,
      };
    }

    const { data: metrics } = await this.supabase
      .from('execution_metrics')
      .select('execution_id, total_items, duration_ms, time_saved_seconds')
      .in('execution_id', executionIds);

    // 5. Get user's hourly rate from profile
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('hourly_rate_usd')
      .eq('id', userId)
      .single();

    const hourlyRate = profile?.hourly_rate_usd || 50; // Default $50/hour

    // 6. Calculate time saved and money saved
    // IMPORTANT: Use pre-calculated time_saved_seconds from execution_metrics
    // This respects both per-item and bulk workflow calculations done by MetricsCollector
    let totalTimeSavedSeconds = 0;

    metrics?.forEach(metric => {
      if (metric.time_saved_seconds) {
        totalTimeSavedSeconds += metric.time_saved_seconds;
      }
    });

    const hoursAutomated = totalTimeSavedSeconds / 3600;
    const moneySaved = hoursAutomated * hourlyRate;

    // 9. Calculate platform cost from execution logs (tokensUsed)
    // Approximate pricing: $0.002 per 1K input tokens, $0.006 per 1K output tokens (GPT-4o-mini rates)
    const totalPlatformCost = currentExecutions?.reduce((sum, execution) => {
      const logs = execution.logs as any;
      const tokensUsed = logs?.tokensUsed;

      if (!tokensUsed) return sum;

      // Use prompt/completion if available, otherwise use total with estimated split
      const promptTokens = tokensUsed.prompt || (tokensUsed.total ? tokensUsed.total * 0.7 : 0);
      const completionTokens = tokensUsed.completion || (tokensUsed.total ? tokensUsed.total * 0.3 : 0);

      const inputCost = (promptTokens / 1000) * 0.002;
      const outputCost = (completionTokens / 1000) * 0.006;

      return sum + inputCost + outputCost;
    }, 0) || 0;
    const costPerExecution = totalRuns > 0 ? totalPlatformCost / totalRuns : 0;

    return {
      totalRuns,
      totalRunsChange: Math.round(totalRunsChange * 10) / 10, // Round to 1 decimal
      successRate: Math.round(successRate), // Round to integer
      moneySaved: Math.round(moneySaved), // Round to integer USD
      costPerExecution: Number(costPerExecution.toFixed(3)), // 3 decimal precision
      hoursAutomated: Math.round(hoursAutomated * 10) / 10, // Round to 1 decimal
    };
  }

  /**
   * Get volume trends over time (time-series data)
   */
  private async getVolumeTrends(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<VolumeTrendPoint[]> {
    const { data: executions, error } = await this.supabase
      .from('agent_executions')
      .select('status, started_at')
      .eq('user_id', userId)
      .neq('run_mode', 'calibration')
      .gte('started_at', startDate.toISOString())
      .lte('started_at', endDate.toISOString())
      .order('started_at', { ascending: true });

    if (error) throw error;

    // Group by date using UTC to avoid timezone issues
    const dataByDate = new Map<string, { total: number; successful: number; failed: number }>();

    executions?.forEach(execution => {
      // Extract UTC date to match the date range we're querying
      const executionDate = new Date(execution.started_at);
      const year = executionDate.getUTCFullYear();
      const month = String(executionDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(executionDate.getUTCDate()).padStart(2, '0');
      const date = `${year}-${month}-${day}`; // YYYY-MM-DD in UTC

      const existing = dataByDate.get(date) || { total: 0, successful: 0, failed: 0 };

      existing.total++;
      if (execution.status === 'completed') {
        existing.successful++;
      } else if (execution.status === 'failed' || execution.status === 'error') {
        existing.failed++;
      }

      dataByDate.set(date, existing);
    });

    // For "all time" view, only include dates with actual data to avoid massive date ranges
    // For specific time ranges (7d, 30d, 90d), fill in missing dates with zeros
    const isAllTime = startDate.getTime() === 0;

    if (isAllTime) {
      // All time: only return dates with actual executions
      return Array.from(dataByDate.entries())
        .map(([date, data]) => ({
          date,
          totalRuns: data.total,
          successfulRuns: data.successful,
          failedRuns: data.failed,
          successRate: data.total > 0 ? Math.round((data.successful / data.total) * 100) : 0,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    // Fill in missing dates with zero values to show complete timeline
    const result: VolumeTrendPoint[] = [];

    // Helper function to format date as YYYY-MM-DD in UTC
    const formatUTCDate = (date: Date) => {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    // Get today's date string in UTC to ensure we always include it
    const todayStr = formatUTCDate(endDate);

    // Iterate through each day from start to end in UTC
    const currentDate = new Date(startDate);
    const currentDateStr = formatUTCDate(currentDate);

    // Keep looping until we've included today
    while (true) {
      const dateStr = formatUTCDate(currentDate);
      const data = dataByDate.get(dateStr) || { total: 0, successful: 0, failed: 0 };

      result.push({
        date: dateStr,
        totalRuns: data.total,
        successfulRuns: data.successful,
        failedRuns: data.failed,
        successRate: data.total > 0 ? Math.round((data.successful / data.total) * 100) : 0,
      });

      // If we just added today, we're done
      if (dateStr === todayStr) {
        break;
      }

      // Move to next day in UTC
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    return result;
  }

  /**
   * Get cost trends broken down by category (stacked area chart data)
   */
  private async getCostTrends(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<CostTrendPoint[]> {
    // Get all token usage within period
    const { data: tokenUsage, error } = await this.supabase
      .from('token_usage')
      .select('created_at, cost_usd, agent_id, activity_type')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Group by date and category
    const dataByDate = new Map<string, { creationCost: number; executionCost: number; pluginCost: number }>();

    tokenUsage?.forEach(usage => {
      const date = new Date(usage.created_at).toISOString().split('T')[0];
      const existing = dataByDate.get(date) || { creationCost: 0, executionCost: 0, pluginCost: 0 };

      const cost = usage.cost_usd || 0;

      // Categorize based on activity type
      if (usage.activity_type === 'agent_creation') {
        existing.creationCost += cost;
      } else if (usage.agent_id) {
        // Has agent_id = execution-related
        existing.executionCost += cost;
      } else {
        // Fallback: plugin/API calls
        existing.pluginCost += cost;
      }

      dataByDate.set(date, existing);
    });

    // Convert to array and sort
    return Array.from(dataByDate.entries())
      .map(([date, costs]) => ({
        date,
        creationCost: Number(costs.creationCost.toFixed(2)),
        executionCost: Number(costs.executionCost.toFixed(2)),
        pluginCost: Number(costs.pluginCost.toFixed(2)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get per-agent breakdown (for advanced mode drill-down)
   */
  private async getAgentBreakdown(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<AgentBreakdownItem[]> {
    // Get all agents for this user
    const { data: agents, error: agentsError } = await this.supabase
      .from('agents')
      .select('id, agent_name, status')
      .eq('user_id', userId)
      .neq('status', 'deleted'); // Exclude soft-deleted

    if (agentsError) throw agentsError;

    if (!agents || agents.length === 0) {
      return [];
    }

    const agentIds = agents.map(a => a.id);

    // Get executions for these agents in the time period
    const { data: executions } = await this.supabase
      .from('agent_executions')
      .select('id, agent_id, status, started_at')
      .in('agent_id', agentIds)
      .neq('run_mode', 'calibration')
      .gte('started_at', startDate.toISOString())
      .lte('started_at', endDate.toISOString());

    // Get execution metrics for ROI calculation
    // IMPORTANT: Use pre-calculated time_saved_seconds (respects bulk workflows)
    const executionIds = executions?.map(e => e.id) || [];
    const { data: metrics } = await this.supabase
      .from('execution_metrics')
      .select('execution_id, time_saved_seconds')
      .in('execution_id', executionIds);

    // Get user hourly rate
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('hourly_rate_usd')
      .eq('id', userId)
      .single();

    const hourlyRate = profile?.hourly_rate_usd || 50;

    // Build a map of execution_id to time_saved_seconds
    const metricsMap = new Map(metrics?.map(m => [m.execution_id, m.time_saved_seconds || 0]) || []);

    return agents.map(agent => {
      const agentExecutions = executions?.filter(e => e.agent_id === agent.id) || [];
      const totalRuns = agentExecutions.length;
      const successfulRuns = agentExecutions.filter(e => e.status === 'completed').length;
      const successRate = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0;

      // Calculate money saved using pre-calculated time_saved_seconds
      let totalTimeSaved = 0;
      agentExecutions.forEach(execution => {
        totalTimeSaved += metricsMap.get(execution.id) || 0;
      });

      const hoursSaved = totalTimeSaved / 3600;
      const moneySaved = hoursSaved * hourlyRate;

      // Get last run timestamp
      const lastRun = agentExecutions.length > 0
        ? agentExecutions.reduce((latest, exec) =>
            exec.started_at > latest ? exec.started_at : latest, agentExecutions[0].started_at)
        : null;

      return {
        agentId: agent.id,
        agentName: agent.agent_name,
        status: agent.status as 'active' | 'paused' | 'draft',
        totalRuns,
        successRate: Math.round(successRate),
        moneySaved: Math.round(moneySaved),
        lastRun,
      };
    })
    .filter(agent => agent.totalRuns > 0) // Only include agents with executions
    .sort((a, b) => b.totalRuns - a.totalRuns); // Sort by most runs
  }

  /**
   * Get system health status for the specified time range
   */
  private async getSystemHealth(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<SystemHealth> {
    // Get failed runs in the selected time period
    const { data: periodExecutions } = await this.supabase
      .from('agent_executions')
      .select('status')
      .eq('user_id', userId)
      .neq('run_mode', 'calibration')
      .gte('started_at', startDate.toISOString())
      .lte('started_at', endDate.toISOString());

    const failedRunsInPeriod = periodExecutions?.filter(e =>
      e.status === 'failed' || e.status === 'error'
    ).length || 0;

    const totalRunsInPeriod = periodExecutions?.length || 0;

    // Get active insights count (not time-filtered as insights are always current)
    const { data: insights } = await this.supabase
      .from('execution_insights')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'new');

    const activeInsights = insights?.length || 0;

    // Determine system health status based on failure rate
    let status: 'healthy' | 'warning' | 'critical';
    let message: string;

    if (failedRunsInPeriod === 0) {
      status = 'healthy';
      message = 'All systems operating normally';
    } else if (totalRunsInPeriod > 0) {
      const failureRate = (failedRunsInPeriod / totalRunsInPeriod) * 100;

      if (failureRate < 5) {
        status = 'healthy';
        message = `${failedRunsInPeriod} operations need attention`;
      } else if (failureRate < 10) {
        status = 'warning';
        message = `${failedRunsInPeriod} operations need attention`;
      } else {
        status = 'critical';
        message = `${failedRunsInPeriod} operations failed - action required`;
      }
    } else {
      status = 'healthy';
      message = 'No operations in this period';
    }

    return {
      status,
      message,
      failedRuns24h: failedRunsInPeriod, // Renamed variable but keeping the property name for API compatibility
      activeInsights,
    };
  }
}
