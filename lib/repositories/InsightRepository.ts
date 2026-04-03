/**
 * Insight Repository
 *
 * Database access layer for execution insights.
 * Handles CRUD operations and common queries.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ExecutionInsight, InsightStatus } from '../pilot/insight/types';

export class InsightRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create a new insight
   */
  async create(insight: Omit<ExecutionInsight, 'id' | 'created_at' | 'updated_at'>): Promise<ExecutionInsight | null> {
    const { data, error } = await this.supabase
      .from('execution_insights')
      .insert({
        user_id: insight.user_id,
        agent_id: insight.agent_id,
        execution_ids: insight.execution_ids,
        insight_type: insight.insight_type,
        category: insight.category,
        severity: insight.severity,
        confidence: insight.confidence,
        title: insight.title,
        description: insight.description,
        business_impact: insight.business_impact,
        recommendation: insight.recommendation,
        pattern_data: insight.pattern_data,
        metrics: insight.metrics,
        status: insight.status,
        snoozed_until: insight.snoozed_until,
        viewed_at: insight.viewed_at,
        applied_at: insight.applied_at,
      })
      .select()
      .single();

    if (error) {
      console.error('[InsightRepository] Failed to create insight:', error);
      return null;
    }

    return data as ExecutionInsight;
  }

  /**
   * Find insights by agent
   */
  async findByAgent(agentId: string, status?: InsightStatus | string): Promise<ExecutionInsight[]> {
    let query = this.supabase
      .from('execution_insights')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });

    if (status) {
      // Handle comma-separated status values (e.g., "new,viewed")
      const statuses = status.split(',').map(s => s.trim());
      if (statuses.length > 1) {
        query = query.in('status', statuses);
      } else {
        query = query.eq('status', status);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('[InsightRepository] Failed to find insights by agent:', error);
      return [];
    }

    return (data || []) as ExecutionInsight[];
  }

  /**
   * Find insights by user
   */
  async findByUser(userId: string, limit: number = 10): Promise<ExecutionInsight[]> {
    const { data, error } = await this.supabase
      .from('execution_insights')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[InsightRepository] Failed to find insights by user:', error);
      return [];
    }

    return (data || []) as ExecutionInsight[];
  }

  /**
   * Get top insights for user (highest severity, unviewed)
   */
  async getTopInsights(userId: string, limit: number = 5): Promise<ExecutionInsight[]> {
    // Use the database function for optimized query
    const { data, error } = await this.supabase.rpc('get_top_insights', {
      p_limit: limit,
    });

    if (error) {
      console.error('[InsightRepository] Failed to get top insights:', error);
      return [];
    }

    return (data || []) as ExecutionInsight[];
  }

  /**
   * Find insight by ID
   */
  async findById(id: string): Promise<ExecutionInsight | null> {
    const { data, error } = await this.supabase
      .from('execution_insights')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('[InsightRepository] Failed to find insight by ID:', error);
      return null;
    }

    return data as ExecutionInsight;
  }

  /**
   * Update insight status
   */
  async updateStatus(id: string, status: InsightStatus): Promise<boolean> {
    const updates: any = { status };

    // Set timestamps based on status
    if (status === 'viewed' && !updates.viewed_at) {
      updates.viewed_at = new Date().toISOString();
    }
    if (status === 'applied') {
      updates.applied_at = new Date().toISOString();
    }

    const { error } = await this.supabase
      .from('execution_insights')
      .update(updates)
      .eq('id', id);

    if (error) {
      console.error('[InsightRepository] Failed to update status:', error);
      return false;
    }

    return true;
  }

  /**
   * Snooze insight for N days
   */
  async snooze(id: string, days: number): Promise<boolean> {
    const snoozedUntil = new Date();
    snoozedUntil.setDate(snoozedUntil.getDate() + days);

    const { error } = await this.supabase
      .from('execution_insights')
      .update({
        status: 'snoozed',
        snoozed_until: snoozedUntil.toISOString(),
      })
      .eq('id', id);

    if (error) {
      console.error('[InsightRepository] Failed to snooze insight:', error);
      return false;
    }

    return true;
  }

  /**
   * Delete insight
   */
  async delete(id: string): Promise<boolean> {
    const { error } = await this.supabase.from('execution_insights').delete().eq('id', id);

    if (error) {
      console.error('[InsightRepository] Failed to delete insight:', error);
      return false;
    }

    return true;
  }

  /**
   * Get unviewed insights count for an agent
   */
  async getUnviewedCount(agentId: string): Promise<number> {
    const { data, error } = await this.supabase.rpc('get_unviewed_insights_count', {
      p_agent_id: agentId,
    });

    if (error) {
      console.error('[InsightRepository] Failed to get unviewed count:', error);
      return 0;
    }

    return data || 0;
  }

  /**
   * Check if similar insight already exists (deduplication)
   * Returns existing insight ID if found
   */
  async findSimilar(
    agentId: string,
    insightType: string,
    createdAfter: Date
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('execution_insights')
      .select('id')
      .eq('agent_id', agentId)
      .eq('insight_type', insightType)
      .gte('created_at', createdAfter.toISOString())
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return data.id;
  }

  /**
   * Update insight with new execution data (merge)
   */
  async updateWithNewExecution(id: string, executionId: string): Promise<boolean> {
    // Fetch current insight
    const insight = await this.findById(id);
    if (!insight) {
      return false;
    }

    // Add execution ID if not already present
    const executionIds = insight.execution_ids || [];
    if (!executionIds.includes(executionId)) {
      executionIds.push(executionId);
    }

    // Update metrics
    const updatedMetrics = {
      ...insight.metrics,
      total_executions: (insight.metrics.total_executions || 0) + 1,
      last_occurrence: new Date().toISOString(),
    };

    const { error } = await this.supabase
      .from('execution_insights')
      .update({
        execution_ids: executionIds,
        metrics: updatedMetrics,
      })
      .eq('id', id);

    if (error) {
      console.error('[InsightRepository] Failed to update insight with new execution:', error);
      return false;
    }

    return true;
  }

  /**
   * Clean up old snoozed insights (unsnoze if time has passed)
   */
  async unsnoozeExpired(): Promise<number> {
    const { data, error } = await this.supabase
      .from('execution_insights')
      .update({ status: 'new', snoozed_until: null })
      .eq('status', 'snoozed')
      .lt('snoozed_until', new Date().toISOString())
      .select('id');

    if (error) {
      console.error('[InsightRepository] Failed to unsnooze expired insights:', error);
      return 0;
    }

    return data?.length || 0;
  }

  /**
   * Find existing insight by category (for deduplication)
   * Looks for insights in the same category (e.g., 'growth', 'data_quality') created within the specified number of days
   *
   * Note: We query by 'category' not 'insight_type' because the LLM may generate different
   * specific types (scale_opportunity, performance_degradation, reliability_risk) within the same category.
   * This ensures cache hits work correctly.
   */
  async findExistingInsight(
    agentId: string,
    category: string,  // Changed from insightType - now queries by category
    withinDays: number = 7
  ): Promise<ExecutionInsight | null> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - withinDays);

    const { data, error } = await this.supabase
      .from('execution_insights')
      .select('*')
      .eq('agent_id', agentId)
      .eq('category', category)  // ✅ FIXED: Query by category instead of insight_type
      .in('status', ['new', 'viewed']) // Don't match dismissed/snoozed insights
      .gte('created_at', cutoffDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[InsightRepository] Failed to find existing insight:', error);
      return null;
    }

    return data as ExecutionInsight | null;
  }

  /**
   * Find existing insight by title (for unified insights from BusinessInsightGenerator)
   */
  async findExistingByTitle(
    agentId: string,
    title: string,
    withinDays: number = 7
  ): Promise<ExecutionInsight | null> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - withinDays);

    const { data, error } = await this.supabase
      .from('execution_insights')
      .select('*')
      .eq('agent_id', agentId)
      .eq('title', title)
      .in('status', ['new', 'viewed']) // Don't match dismissed/snoozed insights
      .gte('created_at', cutoffDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[InsightRepository] Failed to find existing insight by title:', error);
      return null;
    }

    return data as ExecutionInsight | null;
  }

  /**
   * Add an execution ID to an existing insight
   * Updates the execution_ids array and affected_executions count
   */
  async addExecutionToInsight(insightId: string, executionId: string): Promise<boolean> {
    // Fetch current insight
    const insight = await this.findById(insightId);
    if (!insight) {
      return false;
    }

    // Add execution ID if not already present
    const executionIds = insight.execution_ids || [];
    if (!executionIds.includes(executionId)) {
      executionIds.unshift(executionId); // Add to beginning

      // Keep only last 10 execution IDs
      if (executionIds.length > 10) {
        executionIds.length = 10;
      }
    }

    // Update metrics with new occurrence
    const updatedMetrics = {
      ...insight.metrics,
      affected_executions: (insight.metrics.affected_executions || 0) + 1,
      last_occurrence: new Date().toISOString(),
    };

    const { error } = await this.supabase
      .from('execution_insights')
      .update({
        execution_ids: executionIds,
        metrics: updatedMetrics,
        updated_at: new Date().toISOString(),
      })
      .eq('id', insightId);

    if (error) {
      console.error('[InsightRepository] Failed to add execution to insight:', error);
      return false;
    }

    return true;
  }
}
