/**
 * Insight Repository
 *
 * Data access layer for insights and insight history.
 * Follows the repository pattern established in lib/repositories/.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 * @see docs/REPOSITORY_STRATEGY.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import type { DetectionResult, InsightSeverity } from '../detectors/types';
import type { PrioritizedInsight } from '../prioritizer/InsightPrioritizer';
import type { BusinessEventCategory } from '../events/types';

const logger = createLogger({ service: 'InsightRepository' });

// ===========================
// Types
// ===========================

export type InsightStatus = 'new' | 'viewed' | 'snoozed' | 'dismissed' | 'acted' | 'automated';

export interface Insight {
  id: string;
  user_id: string;
  detector_id: string;
  detection_run_id?: string;
  category: BusinessEventCategory;
  severity: InsightSeverity;
  title: string;
  description: string;
  business_impact?: string;
  recommendation?: string;
  metric_key?: string;
  current_value?: number;
  baseline_value?: number;
  threshold_value?: number;
  percent_change?: number;
  direction?: 'above' | 'below';
  affected_entity_type?: string;
  affected_entity_ids?: string[];
  affected_count: number;
  estimated_impact_usd?: number;
  impact_direction?: 'loss' | 'opportunity' | 'savings';
  impact_period?: 'daily' | 'weekly' | 'monthly';
  paired_process_id?: string;
  process_parameters?: Record<string, unknown>;
  eligible_for_automation: boolean;
  priority_score: number;
  status: InsightStatus;
  snoozed_until?: string;
  dismissed_at?: string;
  dismiss_reason?: string;
  acted_at?: string;
  action_execution_id?: string;
  last_surfaced_at?: string;
  surface_count: number;
  detected_at: string;
  created_at: string;
  updated_at: string;
}

export interface InsightHistoryEntry {
  id: string;
  user_id: string;
  insight_id: string;
  action: 'viewed' | 'acted' | 'dismissed' | 'snoozed' | 'automated';
  detector_id: string;
  category: string;
  severity: string;
  time_to_action_seconds?: number;
  was_helpful?: boolean;
  created_at: string;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export interface CreateInsightParams {
  userId: string;
  detection: DetectionResult;
  priorityScore: number;
  runId?: string;
}

// ===========================
// InsightRepository
// ===========================

export class InsightRepository {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Create a new insight from a detection result
   */
  async create(params: CreateInsightParams): Promise<RepositoryResult<Insight>> {
    try {
      const { userId, detection, priorityScore, runId } = params;

      // Generate title and description (will be enhanced with LLM later)
      const title = this.generateTitle(detection);
      const description = this.generateDescription(detection);
      const recommendation = this.generateRecommendation(detection);

      const { data, error } = await this.supabase
        .from('insights')
        .insert({
          user_id: userId,
          detector_id: detection.detectorId,
          detection_run_id: runId,
          category: detection.category,
          severity: detection.severity,
          title,
          description,
          recommendation,
          metric_key: detection.metricKey,
          current_value: detection.currentValue,
          baseline_value: detection.baselineValue,
          threshold_value: detection.thresholdValue,
          percent_change: detection.percentChange,
          direction: detection.direction,
          affected_entity_type: detection.affectedEntityType,
          affected_entity_ids: detection.affectedEntityIds,
          affected_count: detection.affectedCount,
          estimated_impact_usd: detection.estimatedImpactUsd,
          impact_direction: detection.impactDirection,
          impact_period: detection.impactPeriod,
          paired_process_id: detection.pairedProcessId,
          process_parameters: detection.processParameters,
          eligible_for_automation: detection.eligibleForAutomation,
          priority_score: priorityScore,
          status: 'new',
          detected_at: detection.detectedAt.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      logger.info(
        { userId, insightId: data.id, detectorId: detection.detectorId },
        'Insight created'
      );

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create insight');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create multiple insights from prioritized results
   */
  async createBatch(
    userId: string,
    insights: PrioritizedInsight[],
    runId?: string
  ): Promise<RepositoryResult<Insight[]>> {
    try {
      const results: Insight[] = [];

      for (const insight of insights) {
        const result = await this.create({
          userId,
          detection: insight.detection,
          priorityScore: insight.score,
          runId,
        });

        if (result.data) {
          results.push(result.data);
        }
      }

      return { data: results, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create insight batch');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get insight by ID
   */
  async findById(id: string, userId: string): Promise<RepositoryResult<Insight>> {
    try {
      const { data, error } = await this.supabase
        .from('insights')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get active insights for a user (new status, not snoozed)
   */
  async findActive(
    userId: string,
    limit: number = 10
  ): Promise<RepositoryResult<Insight[]>> {
    try {
      const { data, error } = await this.supabase
        .from('insights')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'new')
        .or(`snoozed_until.is.null,snoozed_until.lt.${new Date().toISOString()}`)
        .order('priority_score', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get insights by status
   */
  async findByStatus(
    userId: string,
    status: InsightStatus,
    limit: number = 50
  ): Promise<RepositoryResult<Insight[]>> {
    try {
      const { data, error } = await this.supabase
        .from('insights')
        .select('*')
        .eq('user_id', userId)
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update insight status
   */
  async updateStatus(
    id: string,
    userId: string,
    status: InsightStatus,
    additionalFields?: Partial<Insight>
  ): Promise<RepositoryResult<Insight>> {
    try {
      const updateData: Record<string, unknown> = {
        status,
        ...additionalFields,
      };

      // Set timestamp fields based on status
      if (status === 'dismissed') {
        updateData.dismissed_at = new Date().toISOString();
      } else if (status === 'acted') {
        updateData.acted_at = new Date().toISOString();
      }

      const { data, error } = await this.supabase
        .from('insights')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      // Log to history
      await this.logHistory(userId, id, status as InsightHistoryEntry['action'], data);

      logger.info({ userId, insightId: id, status }, 'Insight status updated');

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to update insight status');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark insight as surfaced (shown to user)
   */
  async markSurfaced(id: string, userId: string): Promise<RepositoryResult<Insight>> {
    try {
      const { data, error } = await this.supabase
        .from('insights')
        .update({
          last_surfaced_at: new Date().toISOString(),
          surface_count: this.supabase.rpc('increment_surface_count', { insight_id: id }),
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        // Fallback without RPC
        const { data: fallbackData, error: fallbackError } = await this.supabase
          .from('insights')
          .select('surface_count')
          .eq('id', id)
          .eq('user_id', userId)
          .single();

        if (fallbackError) throw fallbackError;

        const { data: updated, error: updateError } = await this.supabase
          .from('insights')
          .update({
            last_surfaced_at: new Date().toISOString(),
            surface_count: (fallbackData?.surface_count || 0) + 1,
          })
          .eq('id', id)
          .eq('user_id', userId)
          .select()
          .single();

        if (updateError) throw updateError;
        return { data: updated, error: null };
      }

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to mark insight surfaced');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Snooze an insight
   */
  async snooze(
    id: string,
    userId: string,
    until: Date
  ): Promise<RepositoryResult<Insight>> {
    return this.updateStatus(id, userId, 'snoozed', {
      snoozed_until: until.toISOString(),
    });
  }

  /**
   * Dismiss an insight
   */
  async dismiss(
    id: string,
    userId: string,
    reason?: string
  ): Promise<RepositoryResult<Insight>> {
    return this.updateStatus(id, userId, 'dismissed', {
      dismiss_reason: reason,
    });
  }

  /**
   * Mark insight as acted upon
   */
  async markActed(
    id: string,
    userId: string,
    executionId?: string
  ): Promise<RepositoryResult<Insight>> {
    return this.updateStatus(id, userId, 'acted', {
      action_execution_id: executionId,
    });
  }

  /**
   * Log insight interaction to history
   */
  private async logHistory(
    userId: string,
    insightId: string,
    action: InsightHistoryEntry['action'],
    insight: Insight
  ): Promise<void> {
    try {
      // Calculate time to action if applicable
      let timeToAction: number | undefined;
      if (insight.last_surfaced_at && (action === 'acted' || action === 'dismissed')) {
        const surfacedAt = new Date(insight.last_surfaced_at);
        timeToAction = Math.round((Date.now() - surfacedAt.getTime()) / 1000);
      }

      await this.supabase.from('owner_insight_history').insert({
        user_id: userId,
        insight_id: insightId,
        action,
        detector_id: insight.detector_id,
        category: insight.category,
        severity: insight.severity,
        time_to_action_seconds: timeToAction,
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to log insight history');
    }
  }

  /**
   * Generate a human-readable title for the insight
   */
  private generateTitle(detection: DetectionResult): string {
    const titles: Record<string, string> = {
      cash_ar_overdue: `$${detection.currentValue?.toLocaleString() || 0} in Overdue Invoices`,
      ret_no_show_spike: `No-Show Rate Up ${Math.abs(detection.percentChange || 0).toFixed(0)}%`,
      sales_stalled: `${detection.affectedCount} Enquiries Waiting for Reply`,
      sales_reply_slow: `Reply Time ${Math.abs(detection.percentChange || 0).toFixed(0)}% Slower`,
      ops_utilization_low: `Calendar Only ${(detection.currentValue || 0).toFixed(0)}% Filled`,
    };

    return titles[detection.detectorId] || `Issue Detected: ${detection.detectorId}`;
  }

  /**
   * Generate a description for the insight
   */
  private generateDescription(detection: DetectionResult): string {
    const descriptions: Record<string, string> = {
      cash_ar_overdue: `You have ${detection.affectedCount} invoice${detection.affectedCount !== 1 ? 's' : ''} totaling $${detection.currentValue?.toLocaleString() || 0} that ${detection.affectedCount !== 1 ? 'are' : 'is'} more than 7 days overdue.`,
      ret_no_show_spike: `Your no-show rate has increased from ${(detection.baselineValue || 0).toFixed(1)}% to ${(detection.currentValue || 0).toFixed(1)}%, which is ${Math.abs(detection.percentChange || 0).toFixed(0)}% above your normal baseline.`,
      sales_stalled: `${detection.affectedCount} potential client${detection.affectedCount !== 1 ? 's' : ''} ${detection.affectedCount !== 1 ? 'have' : 'has'} been waiting 48+ hours without a response.`,
      sales_reply_slow: `Your average reply time is ${(detection.currentValue || 0).toFixed(1)} hours, which is ${Math.abs(detection.percentChange || 0).toFixed(0)}% slower than your baseline of ${(detection.baselineValue || 0).toFixed(1)} hours.`,
      ops_utilization_low: `Your calendar is only ${(detection.currentValue || 0).toFixed(0)}% utilized, with approximately ${detection.affectedCount} hours available this week.`,
    };

    return descriptions[detection.detectorId] || `A pattern was detected that may require attention.`;
  }

  /**
   * Generate a recommendation for the insight
   */
  private generateRecommendation(detection: DetectionResult): string {
    const recommendations: Record<string, string> = {
      cash_ar_overdue: `Send payment reminders to clients with overdue invoices. This could help recover up to $${detection.estimatedImpactUsd?.toLocaleString() || 0}.`,
      ret_no_show_spike: `Consider sending appointment reminders 24 hours before each booking to reduce no-shows.`,
      sales_stalled: `Follow up with these leads to maintain momentum. Quick responses can significantly improve conversion rates.`,
      sales_reply_slow: `Review your enquiry notification settings and consider using templates for faster responses.`,
      ops_utilization_low: `Consider promoting available time slots or running a special offer to fill your calendar.`,
    };

    return recommendations[detection.detectorId] || `Review this pattern and take appropriate action.`;
  }
}

// Singleton export
export const insightRepository = (supabase: SupabaseClient) => new InsightRepository(supabase);
