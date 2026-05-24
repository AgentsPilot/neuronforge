/**
 * AgentPromptThreadRepository
 *
 * Data access layer for agent_prompt_threads table.
 * Centralizes all database operations with logging and duration tracking.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLogger, type Logger } from '@/lib/logger';
import type {
  AgentPromptThread,
  CreateAgentPromptThread,
  UpdateAgentPromptThread
} from '@/components/agent-creation/types/agent-prompt-threads';

const logger = createLogger({ service: 'AgentPromptThreadRepository' });

export class AgentPromptThreadRepository {
  private supabase: SupabaseClient;
  private readonly tableName = 'agent_prompt_threads';

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  /**
   * Defensive coercion for legacy threads that still have `current_phase = 4` in the DB.
   *
   * Phase 4 was removed from the agent-creation flow in R1 (see
   * V2_AGENT_CREATION_R1_PHASE4_CLEANUP_REQUIREMENT.md FR10-12). The `ThreadPhase`
   * union is now `1 | 2 | 3`, but the database column can still contain `4` for rows
   * created against the v14 prompt. We coerce those rows to `current_phase = 3,
   * status = 'completed'` on read so downstream code only ever sees the new contract.
   *
   * The cast on `current_phase as number` is necessary because narrowing the TS union
   * does not retroactively narrow the underlying DB column.
   *
   * NOTE: The DB migration is intentionally deferred per R1 requirement Q3 — the read
   * path is the SOLE owner of this coercion. Do NOT write a migration to rewrite
   * legacy `current_phase = 4` rows without re-reading R1 (Q3) and consulting SA;
   * that decision was deliberate to avoid touching production data.
   */
  private coerceLegacyPhase4<T extends AgentPromptThread | null>(
    thread: T,
    repoLogger: Logger
  ): T {
    if (!thread) return thread;
    if ((thread.current_phase as number) === 4) {
      repoLogger.info(
        { threadId: thread.id, originalPhase: 4 },
        'Legacy phase-4 thread coerced to phase-3 completed'
      );
      return { ...thread, current_phase: 3, status: 'completed' } as T;
    }
    return thread;
  }

  /**
   * Create a new thread record
   */
  async createThread(data: CreateAgentPromptThread): Promise<AgentPromptThread> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'createThread', userId: data.user_id });

    repoLogger.debug({ openaiThreadId: data.openai_thread_id }, 'Creating thread record');

    try {
      const { data: record, error } = await this.supabase
        .from(this.tableName)
        .insert(data)
        .select()
        .single();

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to create thread record');
        throw new RepositoryError('Failed to create thread record', error);
      }

      repoLogger.info(
        {
          threadId: record.id,
          openaiThreadId: record.openai_thread_id,
          aiProvider: record.ai_provider,
          aiModel: record.ai_model,
          duration
        },
        'Thread record created'
      );

      return record as AgentPromptThread;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof RepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error creating thread');
      throw new RepositoryError('Unexpected error creating thread', error);
    }
  }

  /**
   * Get thread by OpenAI thread ID and user ID
   */
  async getThreadByOpenAIId(
    openaiThreadId: string,
    userId: string
  ): Promise<AgentPromptThread | null> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'getThreadByOpenAIId', openaiThreadId, userId });

    repoLogger.debug('Fetching thread by OpenAI ID');

    try {
      const { data: record, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('openai_thread_id', openaiThreadId)
        .eq('user_id', userId)
        .single();

      const duration = Date.now() - startTime;

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned - not an error, just not found
          repoLogger.debug({ duration }, 'Thread not found');
          return null;
        }
        repoLogger.error({ err: error, duration }, 'Failed to fetch thread');
        throw new RepositoryError('Failed to fetch thread', error);
      }

      repoLogger.debug(
        {
          threadId: record.id,
          status: record.status,
          currentPhase: record.current_phase,
          aiProvider: record.ai_provider,
          aiModel: record.ai_model,
          duration
        },
        'Thread fetched'
      );

      return this.coerceLegacyPhase4(record as AgentPromptThread, repoLogger);
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof RepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error fetching thread');
      throw new RepositoryError('Unexpected error fetching thread', error);
    }
  }

  /**
   * Get thread by internal ID
   */
  async getThreadById(id: string): Promise<AgentPromptThread | null> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'getThreadById', threadId: id });

    repoLogger.debug('Fetching thread by ID');

    try {
      const { data: record, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      const duration = Date.now() - startTime;

      if (error) {
        if (error.code === 'PGRST116') {
          repoLogger.debug({ duration }, 'Thread not found');
          return null;
        }
        repoLogger.error({ err: error, duration }, 'Failed to fetch thread by ID');
        throw new RepositoryError('Failed to fetch thread by ID', error);
      }

      repoLogger.debug(
        { status: record.status, currentPhase: record.current_phase, duration },
        'Thread fetched by ID'
      );

      return this.coerceLegacyPhase4(record as AgentPromptThread, repoLogger);
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof RepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error fetching thread by ID');
      throw new RepositoryError('Unexpected error fetching thread by ID', error);
    }
  }

  /**
   * Update thread record
   */
  async updateThread(id: string, data: UpdateAgentPromptThread): Promise<void> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'updateThread', threadId: id });

    repoLogger.debug({ updateFields: Object.keys(data) }, 'Updating thread record');

    try {
      const { error } = await this.supabase
        .from(this.tableName)
        .update(data)
        .eq('id', id);

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to update thread');
        throw new RepositoryError('Failed to update thread', error);
      }

      repoLogger.debug({ duration }, 'Thread updated');
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof RepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error updating thread');
      throw new RepositoryError('Unexpected error updating thread', error);
    }
  }

  /**
   * Mark thread as expired
   */
  async markThreadExpired(id: string): Promise<void> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'markThreadExpired', threadId: id });

    repoLogger.debug('Marking thread as expired');

    try {
      const { error } = await this.supabase
        .from(this.tableName)
        .update({ status: 'expired' })
        .eq('id', id);

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to mark thread as expired');
        throw new RepositoryError('Failed to mark thread as expired', error);
      }

      repoLogger.info({ duration }, 'Thread marked as expired');
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof RepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error marking thread expired');
      throw new RepositoryError('Unexpected error marking thread expired', error);
    }
  }

  /**
   * Update thread phase and metadata
   */
  async updateThreadPhase(
    id: string,
    phase: number,
    status: 'active' | 'completed',
    metadata?: Record<string, any>
  ): Promise<void> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'updateThreadPhase', threadId: id, phase });

    repoLogger.debug({ status, hasMetadata: !!metadata }, 'Updating thread phase');

    try {
      const updateData: UpdateAgentPromptThread = {
        current_phase: phase as 1 | 2 | 3,
        status
      };

      if (metadata) {
        updateData.metadata = metadata;
      }

      const { error } = await this.supabase
        .from(this.tableName)
        .update(updateData)
        .eq('id', id);

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to update thread phase');
        throw new RepositoryError('Failed to update thread phase', error);
      }

      repoLogger.debug({ duration }, 'Thread phase updated');
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof RepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error updating thread phase');
      throw new RepositoryError('Unexpected error updating thread phase', error);
    }
  }

  /**
   * Delete thread record
   */
  async deleteThread(id: string): Promise<void> {
    const startTime = Date.now();
    const repoLogger = logger.child({ operation: 'deleteThread', threadId: id });

    repoLogger.debug('Deleting thread record');

    try {
      const { error } = await this.supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      const duration = Date.now() - startTime;

      if (error) {
        repoLogger.error({ err: error, duration }, 'Failed to delete thread');
        throw new RepositoryError('Failed to delete thread', error);
      }

      repoLogger.info({ duration }, 'Thread deleted');
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error instanceof RepositoryError) throw error;
      repoLogger.error({ err: error, duration }, 'Unexpected error deleting thread');
      throw new RepositoryError('Unexpected error deleting thread', error);
    }
  }

  /**
   * Check if thread is expired
   */
  isThreadExpired(thread: AgentPromptThread): boolean {
    if (thread.status === 'expired') return true;
    const now = new Date();
    const expiresAt = new Date(thread.expires_at);
    return now > expiresAt;
  }
}

/**
 * Custom error class for repository operations
 */
export class RepositoryError extends Error {
  public readonly cause: any;

  constructor(message: string, cause?: any) {
    super(message);
    this.name = 'RepositoryError';
    this.cause = cause;
  }
}

// Singleton instance for convenience
let repositoryInstance: AgentPromptThreadRepository | null = null;

export function getAgentPromptThreadRepository(): AgentPromptThreadRepository {
  if (!repositoryInstance) {
    repositoryInstance = new AgentPromptThreadRepository();
  }
  return repositoryInstance;
}