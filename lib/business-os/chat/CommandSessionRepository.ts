/**
 * CommandSessionRepository
 *
 * Manages command session persistence for deterministic chat flow.
 * Sessions track the state of multi-turn conversations, enabling
 * confirmations and parameter gathering without re-invoking the LLM.
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'CommandSessionRepository' });

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

export interface SessionChoice {
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
  pending_choices: SessionChoice[] | null;
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
        .maybeSingle();

      if (error) throw error;

      logger.debug({ userId, hasSession: !!data }, 'Got active session');
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
      logger.error({ err: error, sessionId }, 'Failed to get session by ID');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create new session, cancelling any existing active sessions
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

      // Determine initial status
      const initialStatus: SessionStatus = pendingParams.length > 0
        ? 'gathering_params'
        : 'awaiting_confirmation';

      const { data, error } = await this.supabase
        .from('command_sessions')
        .insert({
          user_id: userId,
          capability_id: capabilityId,
          resolved_params: initialParams,
          pending_params: pendingParams,
          status: initialStatus,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      logger.info(
        { sessionId: data.id, capabilityId, pendingParams, status: initialStatus },
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
          // Extend expiry on activity
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        })
        .eq('id', sessionId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.debug({ sessionId, updates: Object.keys(updates) }, 'Session updated');
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
    logger.info({ sessionId, status }, 'Terminating session');
    return this.update(sessionId, userId, { status });
  }

  /**
   * Add resolved parameter and remove from pending
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

      const newResolvedParams = {
        ...session.resolved_params,
        [paramName]: value
      };
      const newPendingParams = (session.pending_params as string[]).filter(
        (p: string) => p !== paramName
      );

      // Determine new status
      const newStatus: SessionStatus = newPendingParams.length === 0
        ? 'awaiting_confirmation'
        : 'gathering_params';

      logger.debug(
        { sessionId, paramName, remainingParams: newPendingParams, newStatus },
        'Parameter resolved'
      );

      return this.update(sessionId, userId, {
        resolved_params: newResolvedParams,
        pending_params: newPendingParams,
        status: newStatus
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
    choices: SessionChoice[]
  ): Promise<CommandSessionResult<CommandSession>> {
    logger.debug({ sessionId, choiceCount: choices.length }, 'Setting choices');
    return this.update(sessionId, userId, {
      pending_choices: choices,
      status: 'awaiting_choice'
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
      pending_choices: null
    });
  }

  /**
   * Set entity context for follow-up commands
   */
  async setEntityContext(
    sessionId: string,
    userId: string,
    context: EntityContext
  ): Promise<CommandSessionResult<CommandSession>> {
    return this.update(sessionId, userId, {
      entity_context: context
    });
  }

  /**
   * Store last messages for minimal context
   */
  async setLastMessages(
    sessionId: string,
    userId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<CommandSessionResult<CommandSession>> {
    return this.update(sessionId, userId, {
      last_user_message: userMessage,
      last_assistant_response: assistantResponse
    });
  }

  /**
   * Cleanup expired sessions (call via cron or scheduled task)
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

  /**
   * Get session statistics for monitoring
   */
  async getStats(userId?: string): Promise<{
    active: number;
    completed: number;
    cancelled: number;
    failed: number;
  }> {
    try {
      let query = this.supabase
        .from('command_sessions')
        .select('status');

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const stats = {
        active: 0,
        completed: 0,
        cancelled: 0,
        failed: 0
      };

      for (const session of data || []) {
        if (['gathering_params', 'awaiting_confirmation', 'awaiting_choice', 'executing'].includes(session.status)) {
          stats.active++;
        } else if (session.status === 'completed') {
          stats.completed++;
        } else if (session.status === 'cancelled') {
          stats.cancelled++;
        } else if (session.status === 'failed') {
          stats.failed++;
        }
      }

      return stats;
    } catch (error) {
      logger.error({ err: error }, 'Failed to get session stats');
      return { active: 0, completed: 0, cancelled: 0, failed: 0 };
    }
  }
}

export const commandSessionRepository = new CommandSessionRepositoryClass();
