/**
 * Command Session Repository
 *
 * Handles database operations for command sessions (slot-filling clarification).
 * Sessions persist multi-turn conversation state without requiring LLM re-planning.
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'CommandSessionRepository' });

// =============================================================================
// TYPES
// =============================================================================

export type SessionStatus =
  | 'gathering_params'
  | 'awaiting_confirmation'
  | 'awaiting_choice'
  | 'executing'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface EntityContext {
  type: string;
  id: string;
  data: Record<string, unknown>;
}

export interface PendingChoice {
  id: string;
  label: string;
  entity: Record<string, unknown>;
}

export interface CommandSession {
  id: string;
  user_id: string;
  capability_id: string;
  status: SessionStatus;
  resolved_params: Record<string, unknown>;
  pending_params: string[];
  entity_context: EntityContext | null;
  pending_choices: PendingChoice[] | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  last_user_message: string | null;
  last_assistant_response: string | null;
}

export interface CommandSessionResult<T> {
  data: T | null;
  error: Error | null;
}

// =============================================================================
// REPOSITORY
// =============================================================================

class CommandSessionRepositoryClass {
  private supabase = supabaseServer;

  /**
   * Get active session for user (non-expired, non-terminal status)
   */
  async getActiveSession(userId: string): Promise<CommandSessionResult<CommandSession>> {
    try {
      const { data, error } = await this.supabase
        .from('command_sessions')
        .select('*')
        .eq('user_id', userId)
        .not('status', 'in', '("completed","cancelled","failed")')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      return { data: data || null, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get active session');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get session by ID
   */
  async getById(sessionId: string, userId: string): Promise<CommandSessionResult<CommandSession>> {
    try {
      const { data, error } = await this.supabase
        .from('command_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, sessionId, userId }, 'Failed to get session by ID');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create new session
   * Automatically cancels any existing active sessions for the user
   */
  async create(
    userId: string,
    capabilityId: string,
    initialParams: Record<string, unknown> = {},
    pendingParams: string[] = []
  ): Promise<CommandSessionResult<CommandSession>> {
    try {
      // First, cancel any existing active sessions
      await this.supabase
        .from('command_sessions')
        .update({ status: 'cancelled' })
        .eq('user_id', userId)
        .not('status', 'in', '("completed","cancelled","failed")');

      const { data, error } = await this.supabase
        .from('command_sessions')
        .insert({
          user_id: userId,
          capability_id: capabilityId,
          resolved_params: initialParams,
          pending_params: pendingParams,
          status: pendingParams.length > 0 ? 'gathering_params' : 'awaiting_confirmation',
        })
        .select()
        .single();

      if (error) throw error;
      logger.info(
        { sessionId: data.id, capabilityId, pendingParams },
        'Command session created'
      );
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId, capabilityId }, 'Failed to create session');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update session with new params or status
   */
  async update(
    sessionId: string,
    userId: string,
    updates: Partial<Omit<CommandSession, 'id' | 'user_id' | 'created_at'>>
  ): Promise<CommandSessionResult<CommandSession>> {
    try {
      const { data, error } = await this.supabase
        .from('command_sessions')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
          // Extend expiry on activity
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        })
        .eq('id', sessionId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, sessionId }, 'Failed to update session');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark session as completed/cancelled/failed
   */
  async terminate(
    sessionId: string,
    userId: string,
    status: 'completed' | 'cancelled' | 'failed'
  ): Promise<CommandSessionResult<CommandSession>> {
    return this.update(sessionId, userId, { status });
  }

  /**
   * Add resolved parameter and remove from pending
   * Automatically transitions to 'awaiting_confirmation' when all params filled
   */
  async resolveParameter(
    sessionId: string,
    userId: string,
    paramName: string,
    value: unknown
  ): Promise<CommandSessionResult<CommandSession>> {
    try {
      // Get current session
      const { data: session, error: fetchError } = await this.supabase
        .from('command_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .single();

      if (fetchError) throw fetchError;

      const newResolvedParams = { ...session.resolved_params, [paramName]: value };
      const newPendingParams = (session.pending_params as string[]).filter(
        (p: string) => p !== paramName
      );

      logger.info(
        { sessionId, paramName, remainingParams: newPendingParams },
        'Parameter resolved'
      );

      return this.update(sessionId, userId, {
        resolved_params: newResolvedParams,
        pending_params: newPendingParams,
        status: newPendingParams.length === 0 ? 'awaiting_confirmation' : 'gathering_params',
      });
    } catch (error) {
      logger.error({ err: error, sessionId, paramName }, 'Failed to resolve parameter');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Set choices for disambiguation
   */
  async setChoices(
    sessionId: string,
    userId: string,
    choices: PendingChoice[]
  ): Promise<CommandSessionResult<CommandSession>> {
    return this.update(sessionId, userId, {
      pending_choices: choices,
      status: 'awaiting_choice',
    });
  }

  /**
   * Clear choices after selection
   */
  async clearChoices(
    sessionId: string,
    userId: string
  ): Promise<CommandSessionResult<CommandSession>> {
    return this.update(sessionId, userId, {
      pending_choices: null,
    });
  }

  /**
   * Set entity context for follow-up commands
   */
  async setEntityContext(
    sessionId: string,
    userId: string,
    entityContext: EntityContext
  ): Promise<CommandSessionResult<CommandSession>> {
    return this.update(sessionId, userId, {
      entity_context: entityContext,
    });
  }

  /**
   * Update last messages for context
   */
  async setLastMessages(
    sessionId: string,
    userId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<CommandSessionResult<CommandSession>> {
    return this.update(sessionId, userId, {
      last_user_message: userMessage,
      last_assistant_response: assistantResponse,
    });
  }

  /**
   * Cleanup expired sessions (call via cron)
   */
  async cleanupExpired(): Promise<{ deleted: number }> {
    try {
      const { data, error } = await this.supabase
        .from('command_sessions')
        .delete()
        .lt('expires_at', new Date().toISOString())
        .select('id');

      if (error) throw error;
      const deleted = data?.length || 0;
      if (deleted > 0) {
        logger.info({ deleted }, 'Cleaned up expired sessions');
      }
      return { deleted };
    } catch (error) {
      logger.error({ err: error }, 'Failed to cleanup sessions');
      return { deleted: 0 };
    }
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const commandSessionRepository = new CommandSessionRepositoryClass();
