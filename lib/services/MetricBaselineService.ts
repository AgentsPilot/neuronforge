/**
 * MetricBaselineService - Historical metric baselines for trend analysis
 *
 * Provides functionality to:
 * - Calculate and store periodic metric snapshots
 * - Compare current metrics against historical baselines
 * - Generate trend percentages (e.g., "+18% vs last month")
 *
 * @module lib/services/MetricBaselineService
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { OrganizationSettingsService } from './OrganizationSettingsService';

const logger = createLogger({ service: 'MetricBaselineService' });

// ============================================================================
// Types
// ============================================================================

export type PeriodType = 'daily' | 'weekly' | 'monthly';

export interface MetricBaseline {
  id: string;
  user_id: string;
  org_id: string | null;
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  success_rate: number | null;
  total_items_processed: number;
  total_time_saved_seconds: number;
  total_money_saved_usd: number;
  avg_execution_duration_ms: number | null;
  executions_change_pct: number | null;
  time_saved_change_pct: number | null;
  money_saved_change_pct: number | null;
  created_at: string;
  updated_at: string;
}

export interface TrendComparison {
  current: {
    executions: number;
    time_saved_seconds: number;
    money_saved_usd: number;
    success_rate: number;
    items_processed: number;
  };
  previous: {
    executions: number;
    time_saved_seconds: number;
    money_saved_usd: number;
    success_rate: number;
    items_processed: number;
  };
  trends: {
    executions_change_pct: number;
    time_saved_change_pct: number;
    money_saved_change_pct: number;
    success_rate_change: number; // Absolute change, not percentage
    items_change_pct: number;
  };
}

// ============================================================================
// Service
// ============================================================================

export class MetricBaselineService {
  private supabase: SupabaseClient;
  private settingsService: OrganizationSettingsService;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.settingsService = new OrganizationSettingsService(this.supabase);
  }

  /**
   * Calculate and store a baseline for a specific period
   */
  async calculateAndStoreBaseline(
    userId: string,
    periodType: PeriodType,
    periodStart?: Date
  ): Promise<MetricBaseline | null> {
    try {
      const { start, end } = this.getPeriodDates(periodType, periodStart);
      const startStr = start.toISOString().split('T')[0];
      const endStr = end.toISOString().split('T')[0];

      logger.info({ userId, periodType, startStr, endStr }, 'Calculating baseline');

      // Get executions for this period
      const { data: executions, error: execError } = await this.supabase
        .from('agent_executions')
        .select('id, status, started_at, agent_id')
        .eq('user_id', userId)
        .neq('run_mode', 'calibration')
        .gte('started_at', start.toISOString())
        .lte('started_at', end.toISOString());

      if (execError) throw execError;

      const totalExecutions = executions?.length || 0;
      const successfulExecutions = executions?.filter(e => e.status === 'completed').length || 0;
      const failedExecutions = executions?.filter(e =>
        e.status === 'failed' || e.status === 'error'
      ).length || 0;
      const successRate = totalExecutions > 0
        ? (successfulExecutions / totalExecutions) * 100
        : null;

      // Get execution metrics
      const executionIds = executions?.map(e => e.id) || [];
      let totalItemsProcessed = 0;
      let totalTimeSaved = 0;
      let totalDuration = 0;
      let durationCount = 0;

      if (executionIds.length > 0) {
        const { data: metrics } = await this.supabase
          .from('execution_metrics')
          .select('total_items, time_saved_seconds, duration_ms')
          .in('execution_id', executionIds);

        metrics?.forEach(m => {
          totalItemsProcessed += m.total_items || 0;
          totalTimeSaved += m.time_saved_seconds || 0;
          if (m.duration_ms) {
            totalDuration += m.duration_ms;
            durationCount++;
          }
        });
      }

      const avgDuration = durationCount > 0 ? totalDuration / durationCount : null;

      // Calculate money saved
      const hourlyRate = await this.settingsService.getHourlyRate(userId);
      const moneySaved = (totalTimeSaved / 3600) * hourlyRate;

      // Get previous period for trend calculation
      const prevBaseline = await this.getBaseline(
        userId,
        periodType,
        this.getPreviousPeriodStart(periodType, start)
      );

      const executionsChangePct = prevBaseline?.total_executions
        ? ((totalExecutions - prevBaseline.total_executions) / prevBaseline.total_executions) * 100
        : null;
      const timeSavedChangePct = prevBaseline?.total_time_saved_seconds
        ? ((totalTimeSaved - prevBaseline.total_time_saved_seconds) / prevBaseline.total_time_saved_seconds) * 100
        : null;
      const moneySavedChangePct = prevBaseline?.total_money_saved_usd
        ? ((moneySaved - prevBaseline.total_money_saved_usd) / prevBaseline.total_money_saved_usd) * 100
        : null;

      // Get org_id
      const { data: org } = await this.supabase
        .from('organizations')
        .select('id')
        .eq('owner_user_id', userId)
        .single();

      // Upsert baseline
      const { data: baseline, error: upsertError } = await this.supabase
        .from('metric_baselines')
        .upsert({
          user_id: userId,
          org_id: org?.id || null,
          period_type: periodType,
          period_start: startStr,
          period_end: endStr,
          total_executions: totalExecutions,
          successful_executions: successfulExecutions,
          failed_executions: failedExecutions,
          success_rate: successRate,
          total_items_processed: totalItemsProcessed,
          total_time_saved_seconds: totalTimeSaved,
          total_money_saved_usd: moneySaved,
          avg_execution_duration_ms: avgDuration,
          executions_change_pct: executionsChangePct,
          time_saved_change_pct: timeSavedChangePct,
          money_saved_change_pct: moneySavedChangePct,
        }, {
          onConflict: 'user_id,period_type,period_start',
        })
        .select()
        .single();

      if (upsertError) throw upsertError;

      logger.info({ userId, periodType, baseline: baseline?.id }, 'Baseline stored');
      return baseline;
    } catch (error) {
      logger.error({ err: error, userId, periodType }, 'Failed to calculate baseline');
      return null;
    }
  }

  /**
   * Get a specific baseline by period
   */
  async getBaseline(
    userId: string,
    periodType: PeriodType,
    periodStart: Date
  ): Promise<MetricBaseline | null> {
    try {
      const startStr = periodStart.toISOString().split('T')[0];

      const { data, error } = await this.supabase
        .from('metric_baselines')
        .select('*')
        .eq('user_id', userId)
        .eq('period_type', periodType)
        .eq('period_start', startStr)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      return data;
    } catch (error) {
      logger.error({ err: error, userId, periodType }, 'Failed to get baseline');
      return null;
    }
  }

  /**
   * Get trend comparison for current vs previous period
   */
  async getTrendComparison(
    userId: string,
    periodType: PeriodType = 'monthly'
  ): Promise<TrendComparison> {
    try {
      const now = new Date();
      const { start: currentStart, end: currentEnd } = this.getPeriodDates(periodType);
      const previousStart = this.getPreviousPeriodStart(periodType, currentStart);
      const { end: previousEnd } = this.getPeriodDates(periodType, previousStart);

      // Calculate current period metrics on-the-fly
      const current = await this.calculatePeriodMetrics(userId, currentStart, currentEnd);
      const previous = await this.calculatePeriodMetrics(userId, previousStart, previousEnd);

      // Calculate trends
      const calcChangePct = (curr: number, prev: number): number => {
        if (prev === 0) return curr > 0 ? 100 : 0;
        return ((curr - prev) / prev) * 100;
      };

      return {
        current,
        previous,
        trends: {
          executions_change_pct: Math.round(calcChangePct(current.executions, previous.executions) * 10) / 10,
          time_saved_change_pct: Math.round(calcChangePct(current.time_saved_seconds, previous.time_saved_seconds) * 10) / 10,
          money_saved_change_pct: Math.round(calcChangePct(current.money_saved_usd, previous.money_saved_usd) * 10) / 10,
          success_rate_change: Math.round((current.success_rate - previous.success_rate) * 10) / 10,
          items_change_pct: Math.round(calcChangePct(current.items_processed, previous.items_processed) * 10) / 10,
        },
      };
    } catch (error) {
      logger.error({ err: error, userId, periodType }, 'Failed to get trend comparison');
      // Return zeros on error
      const empty = {
        executions: 0,
        time_saved_seconds: 0,
        money_saved_usd: 0,
        success_rate: 0,
        items_processed: 0,
      };
      return {
        current: empty,
        previous: empty,
        trends: {
          executions_change_pct: 0,
          time_saved_change_pct: 0,
          money_saved_change_pct: 0,
          success_rate_change: 0,
          items_change_pct: 0,
        },
      };
    }
  }

  /**
   * Calculate metrics for a specific date range
   */
  private async calculatePeriodMetrics(
    userId: string,
    start: Date,
    end: Date
  ): Promise<{
    executions: number;
    time_saved_seconds: number;
    money_saved_usd: number;
    success_rate: number;
    items_processed: number;
  }> {
    // Get executions
    const { data: executions } = await this.supabase
      .from('agent_executions')
      .select('id, status')
      .eq('user_id', userId)
      .neq('run_mode', 'calibration')
      .gte('started_at', start.toISOString())
      .lte('started_at', end.toISOString());

    const totalExecutions = executions?.length || 0;
    const successfulExecutions = executions?.filter(e => e.status === 'completed').length || 0;
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0;

    // Get metrics
    const executionIds = executions?.map(e => e.id) || [];
    let totalTimeSaved = 0;
    let totalItems = 0;

    if (executionIds.length > 0) {
      const { data: metrics } = await this.supabase
        .from('execution_metrics')
        .select('time_saved_seconds, total_items')
        .in('execution_id', executionIds);

      metrics?.forEach(m => {
        totalTimeSaved += m.time_saved_seconds || 0;
        totalItems += m.total_items || 0;
      });
    }

    // Calculate money saved
    const hourlyRate = await this.settingsService.getHourlyRate(userId);
    const moneySaved = (totalTimeSaved / 3600) * hourlyRate;

    return {
      executions: totalExecutions,
      time_saved_seconds: totalTimeSaved,
      money_saved_usd: Math.round(moneySaved * 100) / 100,
      success_rate: Math.round(successRate * 10) / 10,
      items_processed: totalItems,
    };
  }

  /**
   * Get period start and end dates
   */
  private getPeriodDates(
    periodType: PeriodType,
    referenceDate?: Date
  ): { start: Date; end: Date } {
    const now = referenceDate || new Date();
    let start: Date;
    let end: Date;

    switch (periodType) {
      case 'daily':
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        end.setUTCMilliseconds(-1);
        break;

      case 'weekly':
        // Start of week (Sunday)
        const dayOfWeek = now.getUTCDay();
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek));
        end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 7);
        end.setUTCMilliseconds(-1);
        break;

      case 'monthly':
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
        break;
    }

    return { start, end };
  }

  /**
   * Get the start date of the previous period
   */
  private getPreviousPeriodStart(periodType: PeriodType, currentStart: Date): Date {
    const prev = new Date(currentStart);

    switch (periodType) {
      case 'daily':
        prev.setUTCDate(prev.getUTCDate() - 1);
        break;
      case 'weekly':
        prev.setUTCDate(prev.getUTCDate() - 7);
        break;
      case 'monthly':
        prev.setUTCMonth(prev.getUTCMonth() - 1);
        break;
    }

    return prev;
  }
}

// Singleton export for convenience
export const metricBaselineService = new MetricBaselineService();
