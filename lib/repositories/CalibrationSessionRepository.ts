/**
 * CalibrationSessionRepository - Database operations for batch calibration sessions
 *
 * Handles CRUD operations for calibration_sessions table using the repository pattern.
 * Provides type-safe interface for storing calibration run results, issues, and fixes.
 *
 * PRIVACY: No client data stored, only metadata and structure information
 *
 * @module lib/repositories/CalibrationSessionRepository
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { CollectedIssue, CalibrationSession } from '@/lib/pilot/types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'CalibrationSessionRepository', service: 'repository' });

export interface CreateSessionInput {
  agent_id: string;
  user_id: string;
  status: CalibrationSession['status'];
  total_steps?: number;
  completed_steps?: number;
  failed_steps?: number;
  skipped_steps?: number;
}

export interface UpdateSessionInput {
  status?: CalibrationSession['status'];
  execution_id?: string;
  issues?: CollectedIssue[];
  issue_summary?: CalibrationSession['issue_summary'];
  auto_repairs_proposed?: any[];
  user_fixes?: Record<string, any>;
  backup_pilot_steps?: any;
  total_steps?: number;
  completed_steps?: number;
  failed_steps?: number;
  skipped_steps?: number;
  completed_at?: string;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export class CalibrationSessionRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create a new calibration session
   */
  async create(input: CreateSessionInput): Promise<RepositoryResult<CalibrationSession>> {
    logger.debug({ agentId: input.agent_id, userId: input.user_id }, 'Creating calibration session');

    try {
      const { data, error } = await this.supabase
        .from('calibration_sessions')
        .insert({
          agent_id: input.agent_id,
          user_id: input.user_id,
          status: input.status,
          total_steps: input.total_steps || 0,
          completed_steps: input.completed_steps || 0,
          failed_steps: input.failed_steps || 0,
          skipped_steps: input.skipped_steps || 0,
          issues: [],
          issue_summary: {},
          auto_repairs_proposed: [],
          user_fixes: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        logger.error({ error, agentId: input.agent_id }, 'Failed to create calibration session');
        return { data: null, error: new Error(error.message) };
      }

      logger.info({ sessionId: data.id, agentId: input.agent_id }, 'Calibration session created');
      return { data, error: null };

    } catch (err: any) {
      logger.error({ error: err, agentId: input.agent_id }, 'Exception creating calibration session');
      return { data: null, error: err };
    }
  }

  /**
   * Find a calibration session by ID
   */
  async findById(id: string): Promise<RepositoryResult<CalibrationSession>> {
    logger.debug({ sessionId: id }, 'Finding calibration session by ID');

    try {
      const { data, error } = await this.supabase
        .from('calibration_sessions')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        logger.error({ error, sessionId: id }, 'Failed to find calibration session');
        return { data: null, error: new Error(error.message) };
      }

      if (!data) {
        logger.warn({ sessionId: id }, 'Calibration session not found');
        return { data: null, error: new Error('Session not found') };
      }

      logger.debug({ sessionId: id, status: data.status }, 'Calibration session found');
      return { data, error: null };

    } catch (err: any) {
      logger.error({ error: err, sessionId: id }, 'Exception finding calibration session');
      return { data: null, error: err };
    }
  }

  /**
   * Find all sessions for a specific agent
   */
  async findByAgent(agentId: string, limit: number = 10): Promise<RepositoryResult<CalibrationSession[]>> {
    logger.debug({ agentId, limit }, 'Finding calibration sessions by agent');

    try {
      const { data, error } = await this.supabase
        .from('calibration_sessions')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        logger.error({ error, agentId }, 'Failed to find calibration sessions by agent');
        return { data: null, error: new Error(error.message) };
      }

      logger.debug({ agentId, count: data?.length || 0 }, 'Calibration sessions found');
      return { data: data || [], error: null };

    } catch (err: any) {
      logger.error({ error: err, agentId }, 'Exception finding calibration sessions by agent');
      return { data: null, error: err };
    }
  }

  /**
   * Find all sessions for a specific user
   */
  async findByUser(userId: string, limit: number = 20): Promise<RepositoryResult<CalibrationSession[]>> {
    logger.debug({ userId, limit }, 'Finding calibration sessions by user');

    try {
      const { data, error } = await this.supabase
        .from('calibration_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        logger.error({ error, userId }, 'Failed to find calibration sessions by user');
        return { data: null, error: new Error(error.message) };
      }

      logger.debug({ userId, count: data?.length || 0 }, 'Calibration sessions found');
      return { data: data || [], error: null };

    } catch (err: any) {
      logger.error({ error: err, userId }, 'Exception finding calibration sessions by user');
      return { data: null, error: err };
    }
  }

  /**
   * Update a calibration session
   */
  async update(id: string, updates: UpdateSessionInput): Promise<RepositoryResult<CalibrationSession>> {
    logger.debug({ sessionId: id, updates }, 'Updating calibration session');

    try {
      const { data, error } = await this.supabase
        .from('calibration_sessions')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        logger.error({ error, sessionId: id }, 'Failed to update calibration session');
        return { data: null, error: new Error(error.message) };
      }

      logger.info({ sessionId: id, status: data.status }, 'Calibration session updated');
      return { data, error: null };

    } catch (err: any) {
      logger.error({ error: err, sessionId: id }, 'Exception updating calibration session');
      return { data: null, error: err };
    }
  }

  /**
   * Delete a calibration session
   */
  async delete(id: string): Promise<RepositoryResult<boolean>> {
    logger.debug({ sessionId: id }, 'Deleting calibration session');

    try {
      const { error } = await this.supabase
        .from('calibration_sessions')
        .delete()
        .eq('id', id);

      if (error) {
        logger.error({ error, sessionId: id }, 'Failed to delete calibration session');
        return { data: false, error: new Error(error.message) };
      }

      logger.info({ sessionId: id }, 'Calibration session deleted');
      return { data: true, error: null };

    } catch (err: any) {
      logger.error({ error: err, sessionId: id }, 'Exception deleting calibration session');
      return { data: false, error: err };
    }
  }

  /**
   * Get the latest session for an agent
   */
  async getLatestForAgent(agentId: string): Promise<RepositoryResult<CalibrationSession>> {
    logger.debug({ agentId }, 'Getting latest calibration session for agent');

    try {
      const { data, error } = await this.supabase
        .from('calibration_sessions')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        logger.error({ error, agentId }, 'Failed to get latest calibration session');
        return { data: null, error: new Error(error.message) };
      }

      logger.debug({ agentId, sessionId: data?.id }, 'Latest calibration session found');
      return { data, error: null };

    } catch (err: any) {
      logger.error({ error: err, agentId }, 'Exception getting latest calibration session');
      return { data: null, error: err };
    }
  }

  /**
   * Mark a session as completed
   */
  async markCompleted(id: string): Promise<RepositoryResult<CalibrationSession>> {
    logger.debug({ sessionId: id }, 'Marking calibration session as completed');

    return this.update(id, {
      status: 'completed',
      completed_at: new Date().toISOString()
    });
  }

  /**
   * Mark a session as failed
   */
  async markFailed(id: string, error?: string): Promise<RepositoryResult<CalibrationSession>> {
    logger.debug({ sessionId: id, error }, 'Marking calibration session as failed');

    return this.update(id, {
      status: 'failed',
      completed_at: new Date().toISOString()
    });
  }

  /**
   * Update session with collected issues
   */
  async updateWithIssues(
    id: string,
    issues: CollectedIssue[],
    summary: {
      critical: number;
      warnings: number;
      autoRepairs: number;
    },
    autoRepairs: any[]
  ): Promise<RepositoryResult<CalibrationSession>> {
    logger.debug({
      sessionId: id,
      issueCount: issues.length,
      criticalCount: summary.critical
    }, 'Updating session with collected issues');

    return this.update(id, {
      status: 'awaiting_fixes',
      issues,
      issue_summary: summary,
      auto_repairs_proposed: autoRepairs
    });
  }

  /**
   * Store user fixes for a session
   */
  async storeUserFixes(
    id: string,
    fixes: Record<string, any>
  ): Promise<RepositoryResult<CalibrationSession>> {
    logger.debug({ sessionId: id, fixCount: Object.keys(fixes).length }, 'Storing user fixes');

    return this.update(id, {
      user_fixes: fixes
    });
  }

  /**
   * Backup pilot_steps before applying fixes
   */
  async backupPilotSteps(
    id: string,
    pilotSteps: any
  ): Promise<RepositoryResult<CalibrationSession>> {
    logger.debug({ sessionId: id }, 'Backing up pilot steps');

    return this.update(id, {
      backup_pilot_steps: pilotSteps
    });
  }
}
