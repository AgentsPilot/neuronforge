/**
 * AgentPromptWorkflowGenerationSessionRepository
 *
 * Data access layer for agent_prompt_workflow_generation_sessions table.
 * Tracks V5 Workflow Generator pipeline stages (System 2).
 * Centralizes all database operations with logging and duration tracking.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import type {
  WorkflowGenerationSession,
  CreateWorkflowGenerationSession,
  UpdateWorkflowGenerationSession,
  WorkflowGenerationStage,
  WorkflowGenerationStatus,
  WorkflowBlockingIssue,
  CreateStageParams,
  CompleteStageParams,
} from '@/components/agent-creation/types/workflow-generation-session';

const logger = createLogger({ module: 'Repository', component: 'WorkflowGenerationSessionRepository' });

export class AgentPromptWorkflowGenerationSessionRepository {
  private supabase: SupabaseClient;
  private readonly tableName = 'agent_prompt_workflow_generation_sessions';

  constructor(supabaseClient?: SupabaseClient) {
    // Use supabaseServer singleton (service role, bypasses RLS)
    // See docs/SUPABASE_CLIENTS.md for usage guidelines
    this.supabase = supabaseClient || supabaseServer;
  }

  // ============================================================================
  // Session CRUD Operations
  // ============================================================================

  /**
   * Create a new workflow generation session
   */
  async createSession(data: CreateWorkflowGenerationSession): Promise<WorkflowGenerationSession> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'createSession', userId: data.user_id });

    repoLogger.debug(
      { inputPath: data.input_path, threadId: data.openai_thread_id },
      'Creating workflow generation session'
    );

    try {
      const insertData = {
        ...data,
        stages: data.stages || [],
        status: 'in_progress' as WorkflowGenerationStatus,
        total_input_tokens: 0,
        total_output_tokens: 0,
      };

      const { data: record, error } = await this.supabase
        .from(this.tableName)
        .insert(insertData)
        .select()
        .single();

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to create session');
        throw new WorkflowGenerationRepositoryError('Failed to create session', error);
      }

      repoLogger.info(
        {
          sessionId: record.id,
          inputPath: record.input_path,
          threadId: record.openai_thread_id,
          reviewerAiProvider: record.reviewer_ai_provider,
          reviewerAiModel: record.reviewer_ai_model,
          duration,
        },
        'Workflow generation session created'
      );

      return record as WorkflowGenerationSession;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof WorkflowGenerationRepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error creating session');
      throw new WorkflowGenerationRepositoryError('Unexpected error creating session', error);
    }
  }

  /**
   * Get session by ID
   */
  async getSessionById(id: string): Promise<WorkflowGenerationSession | null> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'getSessionById', sessionId: id });

    repoLogger.debug('Fetching session by ID');

    try {
      const { data: record, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      const duration = Date.now() - startTime;

      if (error) {
        if (error.code === 'PGRST116') {
          repoLogger.debug({ duration }, 'Session not found');
          return null;
        }
        repoLogger.error({ err: error, duration }, 'Failed to fetch session');
        throw new WorkflowGenerationRepositoryError('Failed to fetch session', error);
      }

      repoLogger.debug(
        { status: record.status, stageCount: record.stages?.length || 0, duration },
        'Session fetched'
      );

      return record as WorkflowGenerationSession;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof WorkflowGenerationRepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error fetching session');
      throw new WorkflowGenerationRepositoryError('Unexpected error fetching session', error);
    }
  }

  /**
   * Get session by OpenAI thread ID
   * Returns the most recent session for the given thread
   */
  async getSessionByThreadId(
    openaiThreadId: string,
    userId: string
  ): Promise<WorkflowGenerationSession | null> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'getSessionByThreadId', openaiThreadId, userId });

    repoLogger.debug('Fetching session by thread ID');

    try {
      const { data: record, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('openai_thread_id', openaiThreadId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const duration = Date.now() - startTime;

      if (error) {
        if (error.code === 'PGRST116') {
          repoLogger.debug({ duration }, 'Session not found for thread');
          return null;
        }
        repoLogger.error({ err: error, duration }, 'Failed to fetch session by thread');
        throw new WorkflowGenerationRepositoryError('Failed to fetch session by thread', error);
      }

      repoLogger.debug(
        { sessionId: record.id, status: record.status, duration },
        'Session fetched by thread ID'
      );

      return record as WorkflowGenerationSession;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof WorkflowGenerationRepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error fetching session by thread');
      throw new WorkflowGenerationRepositoryError('Unexpected error fetching session by thread', error);
    }
  }

  /**
   * Get recent sessions for a user
   */
  async getRecentSessionsByUser(
    userId: string,
    limit: number = 10,
    statusFilter?: WorkflowGenerationStatus[]
  ): Promise<WorkflowGenerationSession[]> {
    const startTime = Date.now();
    const repoLogger = logger.child({
      operation: 'getRecentSessionsByUser',
      userId,
      limit,
      statusFilter,
    });

    repoLogger.debug('Fetching recent sessions for user');

    try {
      let query = this.supabase
        .from(this.tableName)
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (statusFilter && statusFilter.length > 0) {
        query = query.in('status', statusFilter);
      }

      const { data: records, error } = await query;

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to fetch recent sessions');
        throw new WorkflowGenerationRepositoryError('Failed to fetch recent sessions', error);
      }

      repoLogger.info({ count: records?.length || 0, duration }, 'Recent sessions fetched');

      return (records || []) as WorkflowGenerationSession[];
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof WorkflowGenerationRepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error fetching recent sessions');
      throw new WorkflowGenerationRepositoryError('Unexpected error fetching recent sessions', error);
    }
  }

  /**
   * Update session record
   */
  async updateSession(id: string, data: UpdateWorkflowGenerationSession): Promise<void> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'updateSession', sessionId: id });

    repoLogger.debug({ updateFields: Object.keys(data) }, 'Updating session');

    try {
      const { error } = await this.supabase
        .from(this.tableName)
        .update(data)
        .eq('id', id);

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to update session');
        throw new WorkflowGenerationRepositoryError('Failed to update session', error);
      }

      repoLogger.debug({ duration }, 'Session updated');
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof WorkflowGenerationRepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error updating session');
      throw new WorkflowGenerationRepositoryError('Unexpected error updating session', error);
    }
  }

  // ============================================================================
  // Stage Management
  // ============================================================================

  /**
   * Add a new stage to the session
   * Returns the updated stages array
   */
  async addStage(
    sessionId: string,
    params: CreateStageParams
  ): Promise<WorkflowGenerationStage[]> {
    const startTime = Date.now();
    const repoLogger = logger.child({
      operation: 'addStage',
      sessionId,
      stageName: params.stage_name,
      stageIndex: params.stage_index,
    });

    repoLogger.debug('Adding stage to session');

    try {
      // Fetch current session
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new WorkflowGenerationRepositoryError('Session not found');
      }

      // Create new stage
      const newStage: WorkflowGenerationStage = {
        stage_name: params.stage_name,
        stage_index: params.stage_index,
        started_at: new Date().toISOString(),
        status: 'running',
        input_data: params.input_data,
        input_summary: params.input_summary,
      };

      // Append to stages array
      const updatedStages = [...(session.stages || []), newStage];

      // Update session
      const { error } = await this.supabase
        .from(this.tableName)
        .update({ stages: updatedStages })
        .eq('id', sessionId);

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to add stage');
        throw new WorkflowGenerationRepositoryError('Failed to add stage', error);
      }

      repoLogger.debug({ stageCount: updatedStages.length, duration }, 'Stage added');

      return updatedStages;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof WorkflowGenerationRepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error adding stage');
      throw new WorkflowGenerationRepositoryError('Unexpected error adding stage', error);
    }
  }

  /**
   * Complete a stage (update with output data and mark as completed/failed)
   */
  async completeStage(
    sessionId: string,
    stageIndex: number,
    params: CompleteStageParams
  ): Promise<WorkflowGenerationStage[]> {
    const startTime = Date.now();
    const repoLogger = logger.child({
      operation: 'completeStage',
      sessionId,
      stageIndex,
      hasError: !!params.error,
    });

    repoLogger.debug('Completing stage');

    try {
      // Fetch current session
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new WorkflowGenerationRepositoryError('Session not found');
      }

      // Find and update the stage
      const stages = [...(session.stages || [])];
      const stageToUpdate = stages.find((s) => s.stage_index === stageIndex);

      if (!stageToUpdate) {
        throw new WorkflowGenerationRepositoryError(`Stage ${stageIndex} not found`);
      }

      // Calculate duration
      const startedAt = new Date(stageToUpdate.started_at);
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      // Update stage fields
      stageToUpdate.completed_at = completedAt.toISOString();
      stageToUpdate.duration_ms = durationMs;
      stageToUpdate.status = params.error ? 'failed' : 'completed';
      stageToUpdate.error = params.error;
      stageToUpdate.output_data = params.output_data;
      stageToUpdate.output_summary = params.output_summary;
      stageToUpdate.llm_call = params.llm_call;
      stageToUpdate.validation = params.validation;
      stageToUpdate.repair = params.repair;

      // Calculate new token totals if LLM call was made
      let totalInputTokens = session.total_input_tokens;
      let totalOutputTokens = session.total_output_tokens;

      if (params.llm_call) {
        totalInputTokens += params.llm_call.input_tokens;
        totalOutputTokens += params.llm_call.output_tokens;
      }

      // Update session
      const { error } = await this.supabase
        .from(this.tableName)
        .update({
          stages,
          total_input_tokens: totalInputTokens,
          total_output_tokens: totalOutputTokens,
        })
        .eq('id', sessionId);

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to complete stage');
        throw new WorkflowGenerationRepositoryError('Failed to complete stage', error);
      }

      repoLogger.debug(
        {
          stageDurationMs: durationMs,
          stageStatus: stageToUpdate.status,
          totalInputTokens,
          totalOutputTokens,
          duration,
        },
        'Stage completed'
      );

      return stages;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof WorkflowGenerationRepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error completing stage');
      throw new WorkflowGenerationRepositoryError('Unexpected error completing stage', error);
    }
  }

  // ============================================================================
  // Session Completion Methods
  // ============================================================================

  /**
   * Mark session as completed with output DSL
   */
  async completeSession(
    sessionId: string,
    outputDsl: Record<string, any>
  ): Promise<void> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'completeSession', sessionId });

    repoLogger.debug('Completing session');

    try {
      // Fetch current session to calculate total duration
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new WorkflowGenerationRepositoryError('Session not found');
      }

      const createdAt = new Date(session.created_at);
      const completedAt = new Date();
      const totalDurationMs = completedAt.getTime() - createdAt.getTime();

      const { error } = await this.supabase
        .from(this.tableName)
        .update({
          status: 'completed' as WorkflowGenerationStatus,
          output_dsl: outputDsl,
          completed_at: completedAt.toISOString(),
          total_duration_ms: totalDurationMs,
        })
        .eq('id', sessionId);

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to complete session');
        throw new WorkflowGenerationRepositoryError('Failed to complete session', error);
      }

      repoLogger.info(
        {
          totalDurationMs,
          totalInputTokens: session.total_input_tokens,
          totalOutputTokens: session.total_output_tokens,
          duration,
        },
        'Session completed successfully'
      );
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof WorkflowGenerationRepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error completing session');
      throw new WorkflowGenerationRepositoryError('Unexpected error completing session', error);
    }
  }

  /**
   * Mark session as failed with error message
   */
  async failSession(sessionId: string, errorMessage: string): Promise<void> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'failSession', sessionId });

    repoLogger.debug({ errorMessage }, 'Failing session');

    try {
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new WorkflowGenerationRepositoryError('Session not found');
      }

      const createdAt = new Date(session.created_at);
      const completedAt = new Date();
      const totalDurationMs = completedAt.getTime() - createdAt.getTime();

      const { error } = await this.supabase
        .from(this.tableName)
        .update({
          status: 'failed' as WorkflowGenerationStatus,
          error: errorMessage,
          completed_at: completedAt.toISOString(),
          total_duration_ms: totalDurationMs,
        })
        .eq('id', sessionId);

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to mark session as failed');
        throw new WorkflowGenerationRepositoryError('Failed to mark session as failed', error);
      }

      repoLogger.warn({ totalDurationMs, errorMessage, duration }, 'Session marked as failed');
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof WorkflowGenerationRepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error failing session');
      throw new WorkflowGenerationRepositoryError('Unexpected error failing session', error);
    }
  }

  /**
   * Mark session as blocked with blocking issues
   */
  async blockSession(
    sessionId: string,
    blockingIssues: WorkflowBlockingIssue[]
  ): Promise<void> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'blockSession', sessionId });

    repoLogger.debug({ issueCount: blockingIssues.length }, 'Blocking session');

    try {
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new WorkflowGenerationRepositoryError('Session not found');
      }

      const createdAt = new Date(session.created_at);
      const completedAt = new Date();
      const totalDurationMs = completedAt.getTime() - createdAt.getTime();

      const { error } = await this.supabase
        .from(this.tableName)
        .update({
          status: 'blocked' as WorkflowGenerationStatus,
          blocking_issues: blockingIssues,
          completed_at: completedAt.toISOString(),
          total_duration_ms: totalDurationMs,
        })
        .eq('id', sessionId);

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to block session');
        throw new WorkflowGenerationRepositoryError('Failed to block session', error);
      }

      repoLogger.warn(
        { totalDurationMs, issueCount: blockingIssues.length, duration },
        'Session marked as blocked'
      );
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof WorkflowGenerationRepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error blocking session');
      throw new WorkflowGenerationRepositoryError('Unexpected error blocking session', error);
    }
  }

  /**
   * Link session to an agent after agent creation
   */
  async linkToAgent(sessionId: string, agentId: string): Promise<void> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'linkToAgent', sessionId, agentId });

    repoLogger.debug('Linking session to agent');

    try {
      const { error } = await this.supabase
        .from(this.tableName)
        .update({ agent_id: agentId })
        .eq('id', sessionId);

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to link session to agent');
        throw new WorkflowGenerationRepositoryError('Failed to link session to agent', error);
      }

      repoLogger.info({ duration }, 'Session linked to agent');
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof WorkflowGenerationRepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error linking session to agent');
      throw new WorkflowGenerationRepositoryError('Unexpected error linking session to agent', error);
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Delete session record
   */
  async deleteSession(id: string): Promise<void> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'deleteSession', sessionId: id });

    repoLogger.debug('Deleting session');

    try {
      const { error } = await this.supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to delete session');
        throw new WorkflowGenerationRepositoryError('Failed to delete session', error);
      }

      repoLogger.info({ duration }, 'Session deleted');
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof WorkflowGenerationRepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error deleting session');
      throw new WorkflowGenerationRepositoryError('Unexpected error deleting session', error);
    }
  }
}

/**
 * Custom error class for repository operations
 */
export class WorkflowGenerationRepositoryError extends Error {
  public readonly cause: any;

  constructor(message: string, cause?: any) {
    super(message);
    this.name = 'WorkflowGenerationRepositoryError';
    this.cause = cause;
  }
}

// Singleton instance for convenience
let repositoryInstance: AgentPromptWorkflowGenerationSessionRepository | null = null;

export function getWorkflowGenerationSessionRepository(): AgentPromptWorkflowGenerationSessionRepository {
  if (!repositoryInstance) {
    repositoryInstance = new AgentPromptWorkflowGenerationSessionRepository();
  }
  return repositoryInstance;
}
