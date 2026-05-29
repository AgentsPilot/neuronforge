// lib/services/SystemHealthAggregationService.ts
// Service for aggregating system-wide health metrics across all user agents

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'SystemHealthAggregationService' });

export type TimeRange = '24h' | '7d' | '30d' | '90d' | 'all';

export interface OverviewMetrics {
  status: 'healthy' | 'warning' | 'critical';
  statusMessage: string;
  totalRuns: number;
  totalRunsChange: number; // Percentage change from previous period
  successRate: number;
  moneySaved: number; // Total money saved for the selected period
  timeSavedHours: number;
}

export interface AlertItem {
  agentId: string;
  agentName: string;
  count: number;
  lastFailedAt: string;
  errorMessage: string;
}

export interface WarningItem {
  agentId: string;
  agentName: string;
  type: 'slow_performance' | 'high_credit_usage' | 'integration_issue';
  message: string;
}

export interface SystemAlerts {
  failed: AlertItem[];
  warnings: WarningItem[];
  healthyCount: number;
}

export interface TrendDataPoint {
  date: string;
  successRate: number;
  totalRuns: number;
  failedRuns: number;
}

export interface TopPerformer {
  agentId: string;
  agentName: string;
  successRate: number;
  moneySaved: number; // Total money saved for the selected period
  rank: number;
}

export class SystemHealthAggregationService {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || supabaseServer;
  }

  /**
   * Get date range for queries based on TimeRange
   */
  private getDateRange(range: TimeRange): { startDate: Date | null; endDate: Date } {
    const now = new Date();
    let startDate: Date | null = new Date();

    switch (range) {
      case '24h':
        startDate.setHours(now.getHours() - 24);
        break;
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      case 'all':
        startDate = null; // No date filter
        break;
    }

    return { startDate, endDate: now };
  }

  /**
   * Calculate health status based on metrics
   */
  private calculateHealthStatus(metrics: {
    successRate: number;
    failedCount24h: number;
    criticalInsights: number;
  }): { status: 'healthy' | 'warning' | 'critical'; message: string } {
    // Critical: Success rate < 80% OR 5+ failures in 24h OR critical insights
    if (metrics.successRate < 80 || metrics.failedCount24h >= 5 || metrics.criticalInsights > 0) {
      const issues: string[] = [];
      if (metrics.failedCount24h >= 5) {
        issues.push(`${metrics.failedCount24h} agents failed`);
      }
      if (metrics.successRate < 80) {
        issues.push(`${Math.round(metrics.successRate)}% success rate`);
      }
      if (metrics.criticalInsights > 0) {
        issues.push(`${metrics.criticalInsights} critical issues`);
      }
      return {
        status: 'critical',
        message: issues.join(', ') + ' - immediate attention needed'
      };
    }

    // Warning: Success rate < 95% OR 1-4 failures in 24h
    if (metrics.successRate < 95 || metrics.failedCount24h > 0) {
      const issues: string[] = [];
      if (metrics.failedCount24h > 0) {
        issues.push(`${metrics.failedCount24h} agent${metrics.failedCount24h > 1 ? 's' : ''} need attention`);
      } else {
        issues.push(`${Math.round(metrics.successRate)}% success rate`);
      }
      return {
        status: 'warning',
        message: issues.join(', ')
      };
    }

    // Healthy: Everything else
    return {
      status: 'healthy',
      message: 'All systems operating normally'
    };
  }

  /**
   * Get system-wide overview metrics
   */
  async getOverviewMetrics(userId: string, range: TimeRange): Promise<OverviewMetrics> {
    const methodLogger = logger.child({ method: 'getOverviewMetrics', userId, range });
    const startTime = Date.now();

    try {
      const { startDate } = this.getDateRange(range);

      // Build query for executions in current period
      let currentQuery = this.supabase
        .from('agent_executions')
        .select('id, status, logs, started_at')
        .eq('user_id', userId)
        .neq('run_mode', 'calibration');

      if (startDate) {
        currentQuery = currentQuery.gte('started_at', startDate.toISOString());
      }

      const { data: currentExecutions, error: currentError } = await currentQuery;
      if (currentError) throw currentError;

      // Get previous period executions for comparison (same duration, shifted back)
      let previousPeriodStart: Date | null = null;
      if (startDate) {
        const rangeDuration = Date.now() - startDate.getTime();
        previousPeriodStart = new Date(startDate.getTime() - rangeDuration);
      }

      let previousQuery = this.supabase
        .from('agent_executions')
        .select('id, status')
        .eq('user_id', userId)
        .neq('run_mode', 'calibration');

      if (previousPeriodStart && startDate) {
        previousQuery = previousQuery
          .gte('started_at', previousPeriodStart.toISOString())
          .lt('started_at', startDate.toISOString());
      }

      const { data: previousExecutions, error: previousError } = await previousQuery;
      if (previousError) throw previousError;

      // Calculate metrics from current period
      const totalRuns = currentExecutions?.length || 0;
      const successfulRuns = currentExecutions?.filter(e => e.status === 'completed').length || 0;
      const successRate = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 100;

      // Calculate change from previous period
      const previousTotalRuns = previousExecutions?.length || 0;
      const totalRunsChange = previousTotalRuns > 0
        ? ((totalRuns - previousTotalRuns) / previousTotalRuns) * 100
        : 0;

      // Calculate time saved and money saved using the same method as Agent Analytics
      // This ensures consistency between System Health and Agent Analytics dashboards

      // 1. Get user's hourly rate from profile
      const { data: profile } = await this.supabase
        .from('profiles')
        .select('hourly_rate_usd')
        .eq('id', userId)
        .single();

      const hourlyRate = profile?.hourly_rate_usd ?? 50; // Default $50/hour if not set

      // 2. Get all active agents for this user
      const { data: agents } = await this.supabase
        .from('agents')
        .select('id, manual_time_per_item_seconds')
        .eq('user_id', userId)
        .eq('status', 'active');

      // 3. Calculate ROI from execution_metrics (same as Agent Analytics)
      let totalTimeSavedSeconds = 0;

      for (const agent of agents || []) {
        if (!agent.manual_time_per_item_seconds || agent.manual_time_per_item_seconds <= 0) {
          continue; // Skip agents without ROI configuration
        }

        // Build query for execution metrics in current period
        let metricsQuery = this.supabase
          .from('execution_metrics')
          .select(`
            total_items,
            workflow_executions!inner(run_mode)
          `)
          .eq('agent_id', agent.id)
          .neq('workflow_executions.run_mode', 'calibration');

        if (startDate) {
          metricsQuery = metricsQuery.gte('executed_at', startDate.toISOString());
        }

        const { data: metrics } = await metricsQuery;

        const totalItems = metrics?.reduce((sum, m) => sum + (m.total_items || 0), 0) || 0;
        totalTimeSavedSeconds += totalItems * agent.manual_time_per_item_seconds;
      }

      // Calculate money saved for the selected period
      const timeSavedHours = totalTimeSavedSeconds / 3600;
      const moneySaved = Math.round(timeSavedHours * hourlyRate);

      // Get failures in last 24h for health status
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const { count: failedCount24h } = await this.supabase
        .from('agent_executions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'failed')
        .neq('run_mode', 'calibration')
        .gte('started_at', twentyFourHoursAgo.toISOString());

      // Get critical insights count
      const { count: criticalInsights } = await this.supabase
        .from('execution_insights')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('severity', 'critical')
        .in('status', ['new', 'viewed']);

      // Calculate health status
      const healthStatus = this.calculateHealthStatus({
        successRate,
        failedCount24h: failedCount24h || 0,
        criticalInsights: criticalInsights || 0
      });

      const duration = Date.now() - startTime;
      methodLogger.info({ duration, totalRuns, successRate }, 'Overview metrics calculated');

      return {
        status: healthStatus.status,
        statusMessage: healthStatus.message,
        totalRuns,
        totalRunsChange: Math.round(totalRunsChange * 10) / 10, // Round to 1 decimal
        successRate: Math.round(successRate),
        moneySaved,
        timeSavedHours: Math.round(timeSavedHours)
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to get overview metrics');
      throw error;
    }
  }

  /**
   * Get system alerts (failed executions, warnings, healthy count)
   */
  async getSystemAlerts(userId: string, range: TimeRange): Promise<SystemAlerts> {
    const methodLogger = logger.child({ method: 'getSystemAlerts', userId, range });
    const startTime = Date.now();

    try {
      const { startDate } = this.getDateRange(range);

      // Get all agents for the user
      const { data: agents, error: agentsError } = await this.supabase
        .from('agents')
        .select('id, agent_name')
        .eq('user_id', userId)
        .neq('status', 'deleted');

      if (agentsError) throw agentsError;

      const agentMap = new Map(agents?.map(a => [a.id, a.agent_name]) || []);

      // Get failed executions grouped by agent
      let failedQuery = this.supabase
        .from('agent_executions')
        .select('agent_id, status, started_at, logs')
        .eq('user_id', userId)
        .eq('status', 'failed')
        .neq('run_mode', 'calibration')
        .order('started_at', { ascending: false });

      if (startDate) {
        failedQuery = failedQuery.gte('started_at', startDate.toISOString());
      }

      const { data: failedExecutions, error: failedError } = await failedQuery;
      if (failedError) throw failedError;

      // Group failures by agent
      const failuresByAgent = new Map<string, { count: number; lastFailedAt: string; errorMessage: string }>();
      failedExecutions?.forEach((execution: any) => {
        const existing = failuresByAgent.get(execution.agent_id);
        const errorMessage = execution.logs?.error || execution.logs?.errorMessage || 'Unknown error';

        if (!existing || new Date(execution.started_at) > new Date(existing.lastFailedAt)) {
          failuresByAgent.set(execution.agent_id, {
            count: (existing?.count || 0) + 1,
            lastFailedAt: execution.started_at,
            errorMessage
          });
        } else {
          failuresByAgent.set(execution.agent_id, {
            ...existing,
            count: existing.count + 1
          });
        }
      });

      // Build failed alerts array
      const failed: AlertItem[] = Array.from(failuresByAgent.entries()).map(([agentId, data]) => ({
        agentId,
        agentName: agentMap.get(agentId) || 'Unknown Agent',
        count: data.count,
        lastFailedAt: data.lastFailedAt,
        errorMessage: data.errorMessage
      })).sort((a, b) => b.count - a.count); // Sort by failure count desc

      // TODO: Get performance warnings (slow executions, high credit usage)
      // For now, return empty array
      const warnings: WarningItem[] = [];

      // Calculate healthy agents count
      const totalAgents = agents?.length || 0;
      const agentsWithIssues = new Set([...failuresByAgent.keys()]);
      const healthyCount = totalAgents - agentsWithIssues.size;

      const duration = Date.now() - startTime;
      methodLogger.info({ duration, failedCount: failed.length, healthyCount }, 'System alerts retrieved');

      return {
        failed,
        warnings,
        healthyCount
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to get system alerts');
      throw error;
    }
  }

  /**
   * Get performance trends over time
   */
  async getPerformanceTrends(userId: string, range: TimeRange): Promise<TrendDataPoint[]> {
    const methodLogger = logger.child({ method: 'getPerformanceTrends', userId, range });
    const startTime = Date.now();

    try {
      const { startDate } = this.getDateRange(range);

      // Get all executions in range
      let query = this.supabase
        .from('agent_executions')
        .select('status, started_at')
        .eq('user_id', userId)
        .neq('run_mode', 'calibration')
        .order('started_at', { ascending: true });

      if (startDate) {
        query = query.gte('started_at', startDate.toISOString());
      }

      const { data: executions, error } = await query;
      if (error) throw error;

      // Group by date
      const dataByDate = new Map<string, { total: number; successful: number; failed: number }>();

      executions?.forEach((execution: any) => {
        const date = new Date(execution.started_at).toISOString().split('T')[0]; // YYYY-MM-DD
        const existing = dataByDate.get(date) || { total: 0, successful: 0, failed: 0 };

        existing.total++;
        if (execution.status === 'completed') {
          existing.successful++;
        } else if (execution.status === 'failed') {
          existing.failed++;
        }

        dataByDate.set(date, existing);
      });

      // Convert to array and calculate success rates
      const trends: TrendDataPoint[] = Array.from(dataByDate.entries())
        .map(([date, data]) => ({
          date,
          successRate: data.total > 0 ? Math.round((data.successful / data.total) * 100) : 100,
          totalRuns: data.total,
          failedRuns: data.failed
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const duration = Date.now() - startTime;
      methodLogger.info({ duration, dataPoints: trends.length }, 'Performance trends calculated');

      return trends;
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to get performance trends');
      throw error;
    }
  }

  /**
   * Get top performing agents
   */
  async getTopPerformers(userId: string, range: TimeRange, limit: number = 5): Promise<TopPerformer[]> {
    const methodLogger = logger.child({ method: 'getTopPerformers', userId, range, limit });
    const startTime = Date.now();

    try {
      const { startDate } = this.getDateRange(range);

      // Get all executions in range with agent info
      let query = this.supabase
        .from('agent_executions')
        .select('agent_id, status, logs')
        .eq('user_id', userId)
        .neq('run_mode', 'calibration');

      if (startDate) {
        query = query.gte('started_at', startDate.toISOString());
      }

      const { data: executions, error: execError } = await query;
      if (execError) throw execError;

      // Get agent names
      const { data: agents, error: agentsError } = await this.supabase
        .from('agents')
        .select('id, agent_name')
        .eq('user_id', userId)
        .neq('status', 'deleted');

      if (agentsError) throw agentsError;

      const agentMap = new Map(agents?.map(a => [a.id, a.agent_name]) || []);

      // Group by agent and calculate metrics
      const agentStats = new Map<string, { total: number; successful: number; timeSavedSeconds: number }>();

      executions?.forEach((execution: any) => {
        const existing = agentStats.get(execution.agent_id) || { total: 0, successful: 0, timeSavedSeconds: 0 };

        existing.total++;
        if (execution.status === 'completed') {
          existing.successful++;
        }

        // Calculate time saved
        const logs = execution.logs as any;
        const timeSaved = logs?.metrics?.time_saved_seconds;
        if (timeSaved > 0) {
          existing.timeSavedSeconds += timeSaved;
        } else {
          const itemsProcessed = logs?.metrics?.total_items || logs?.itemsProcessed || 0;
          const stepsCompleted = logs?.stepsCompleted || 0;
          if (itemsProcessed > 0) {
            existing.timeSavedSeconds += itemsProcessed * 120;
          } else if (stepsCompleted > 0) {
            existing.timeSavedSeconds += stepsCompleted * 300;
          }
        }

        agentStats.set(execution.agent_id, existing);
      });

      // Calculate success rates and money saved, then rank
      const DEFAULT_HOURLY_RATE = 50;
      const MIN_RUNS_THRESHOLD = 3; // Minimum runs to be considered a top performer

      const performers: TopPerformer[] = Array.from(agentStats.entries())
        .map(([agentId, stats]) => {
          const successRate = stats.total > 0 ? (stats.successful / stats.total) * 100 : 0;
          const timeSavedHours = stats.timeSavedSeconds / 3600;
          const moneySaved = Math.round(timeSavedHours * DEFAULT_HOURLY_RATE);

          return {
            agentId,
            agentName: agentMap.get(agentId) || 'Unknown Agent',
            successRate: Math.round(successRate),
            moneySaved,
            totalRuns: stats.total,
            rank: 0 // Will be set after sorting
          };
        })
        .filter(p => p.successRate >= 90 && p.totalRuns >= MIN_RUNS_THRESHOLD) // Only include high performers with minimum runs
        .sort((a, b) => {
          // Primary: Success rate (descending)
          if (b.successRate !== a.successRate) {
            return b.successRate - a.successRate;
          }
          // Secondary: Total runs (descending) - reliability indicator
          if (b.totalRuns !== a.totalRuns) {
            return b.totalRuns - a.totalRuns;
          }
          // Tertiary: Money saved (descending)
          return b.moneySaved - a.moneySaved;
        })
        .slice(0, limit)
        .map((p, index) => ({ ...p, rank: index + 1 }));

      const duration = Date.now() - startTime;
      methodLogger.info({ duration, performersCount: performers.length }, 'Top performers retrieved');

      return performers;
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to get top performers');
      throw error;
    }
  }
}

// Export singleton instance
export const systemHealthAggregationService = new SystemHealthAggregationService();
