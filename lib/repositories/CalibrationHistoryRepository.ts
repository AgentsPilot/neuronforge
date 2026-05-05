/**
 * CalibrationHistoryRepository
 *
 * Data access layer for calibration_history table.
 * Tracks all calibration runs for analytics and quality insights.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'CalibrationHistoryRepository' });

export interface CalibrationHistoryRecord {
  id?: string;
  agent_id: string;
  session_id?: string | null;
  user_id: string;
  workflow_hash: string;
  workflow_step_count: number;
  input_schema_hash?: string | null;
  status: 'success' | 'failed' | 'needs_review' | 'verification_only';
  iterations: number;
  auto_fixes_applied: number;
  calibration_quality_score?: number | null;
  first_execution_success?: boolean;
  marked_production_ready?: boolean;
  marked_production_ready_at?: string | null;
  issues_found: any[];
  issues_fixed: any[];
  issues_remaining: any[];
  execution_time_ms?: number | null;
  steps_completed: number;
  steps_failed: number;
  steps_skipped: number;
  v6_version?: string | null;
  model_used?: string | null;
  plugins_used?: string[];
  workflow_complexity_score?: number | null;
  dry_run_predicted_success?: boolean | null;
  dry_run_was_accurate?: boolean | null;
  metadata?: Record<string, any>;
  created_at?: string;
  completed_at?: string | null;
}

export interface CalibrationHistoryRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export class CalibrationHistoryRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create a new calibration history record
   */
  async create(
    record: CalibrationHistoryRecord
  ): Promise<CalibrationHistoryRepositoryResult<CalibrationHistoryRecord>> {
    try {
      const { data, error } = await this.supabase
        .from('calibration_history')
        .insert(record)
        .select()
        .single();

      if (error) throw error;

      logger.info(
        {
          calibrationId: data.id,
          agentId: record.agent_id,
          status: record.status,
          iterations: record.iterations,
        },
        'Calibration history record created'
      );

      return { data, error: null };
    } catch (error) {
      logger.error(
        { err: error, agentId: record.agent_id },
        'Failed to create calibration history'
      );
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get the most recent successful calibration for an agent
   */
  async getLastSuccessful(
    agentId: string,
    userId: string
  ): Promise<CalibrationHistoryRepositoryResult<CalibrationHistoryRecord>> {
    try {
      const { data, error } = await this.supabase
        .from('calibration_history')
        .select('*')
        .eq('agent_id', agentId)
        .eq('user_id', userId)
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error(
        { err: error, agentId },
        'Failed to get last successful calibration'
      );
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get all calibration history for an agent
   */
  async getByAgent(
    agentId: string,
    userId: string,
    limit = 10
  ): Promise<CalibrationHistoryRepositoryResult<CalibrationHistoryRecord[]>> {
    try {
      const { data, error } = await this.supabase
        .from('calibration_history')
        .select('*')
        .eq('agent_id', agentId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error(
        { err: error, agentId },
        'Failed to get calibration history for agent'
      );
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get calibration history by session ID
   */
  async getBySession(
    sessionId: string,
    userId: string
  ): Promise<CalibrationHistoryRepositoryResult<CalibrationHistoryRecord[]>> {
    try {
      const { data, error } = await this.supabase
        .from('calibration_history')
        .select('*')
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error(
        { err: error, sessionId },
        'Failed to get calibration history for session'
      );
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get calibration success metrics for analytics
   */
  async getSuccessMetrics(
    userId: string,
    days = 30
  ): Promise<
    CalibrationHistoryRepositoryResult<
      Array<{
        date: string;
        status: string;
        count: number;
        avg_iterations: number;
        avg_fixes: number;
        avg_execution_time_ms: number;
        median_iterations: number;
      }>
    >
  > {
    try {
      // Use the analytics view
      const { data, error } = await this.supabase
        .from('calibration_success_metrics')
        .select('*')
        .gte('date', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get calibration metrics');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Check if workflow has been successfully calibrated with current hash
   */
  async isWorkflowCalibrated(
    agentId: string,
    userId: string,
    workflowHash: string
  ): Promise<CalibrationHistoryRepositoryResult<boolean>> {
    try {
      const { data, error } = await this.supabase
        .from('calibration_history')
        .select('id')
        .eq('agent_id', agentId)
        .eq('user_id', userId)
        .eq('workflow_hash', workflowHash)
        .eq('status', 'success')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      return { data: !!data, error: null };
    } catch (error) {
      logger.error(
        { err: error, agentId, workflowHash },
        'Failed to check if workflow is calibrated'
      );
      return { data: null, error: error as Error };
    }
  }
}
