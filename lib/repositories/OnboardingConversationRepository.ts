/**
 * OnboardingConversationRepository
 * Repository for onboarding_conversations table
 * Handles conversation message storage and retrieval
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'OnboardingConversationRepository' });

/**
 * Row shape for the `onboarding_conversations` table (base CREATE 20260721 — no
 * later ALTERs). Hand-written to mirror generated Supabase types the rest of the
 * repo layer avoids depending on. NOT NULL columns: user_id, message_sequence,
 * role, content.
 */
export interface OnboardingConversation {
  id: string;
  user_id: string;
  message_sequence: number;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
}

/**
 * Insert shape for `onboarding_conversations`. Only NOT NULL columns without a
 * default are required; id/metadata/created_at are optional.
 */
export interface OnboardingConversationInsert {
  id?: string;
  user_id: string;
  message_sequence: number;
  role: string;
  content: string;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
}

export interface OnboardingConversationRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  metadata?: Record<string, any>;
}

export class OnboardingConversationRepository {
  private supabase = supabaseServer;

  /**
   * Get all messages for a user's onboarding conversation
   */
  async findByUserId(userId: string): Promise<OnboardingConversationRepositoryResult<OnboardingConversation[]>> {
    try {
      logger.info({ userId }, 'Finding onboarding conversations by user ID');

      const { data, error } = await this.supabase
        .from('onboarding_conversations')
        .select('*')
        .eq('user_id', userId)
        .order('message_sequence', { ascending: true });

      if (error) throw error;

      logger.info({ userId, messageCount: data?.length || 0 }, 'Onboarding conversations found');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to find onboarding conversations');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Add a message to the conversation
   */
  async addMessage(
    userId: string,
    message: Message
  ): Promise<OnboardingConversationRepositoryResult<OnboardingConversation>> {
    try {
      logger.info({ userId, role: message.role }, 'Adding message to onboarding conversation');

      // Get the current message count to determine sequence number
      const { count, error: countError } = await this.supabase
        .from('onboarding_conversations')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (countError) throw countError;

      const messageSequence = count || 0;

      const insertData: OnboardingConversationInsert = {
        user_id: userId,
        message_sequence: messageSequence,
        role: message.role,
        content: message.content,
        metadata: message.metadata || null
      };

      const { data, error } = await this.supabase
        .from('onboarding_conversations')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      logger.info({ userId, messageId: data.id, sequence: messageSequence }, 'Message added to conversation');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to add message to conversation');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Add multiple messages in batch
   */
  async addMessages(
    userId: string,
    messages: Message[]
  ): Promise<OnboardingConversationRepositoryResult<OnboardingConversation[]>> {
    try {
      logger.info({ userId, messageCount: messages.length }, 'Adding multiple messages to conversation');

      // Get the current message count
      const { count, error: countError } = await this.supabase
        .from('onboarding_conversations')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (countError) throw countError;

      const startSequence = count || 0;

      const insertData: OnboardingConversationInsert[] = messages.map((message, idx) => ({
        user_id: userId,
        message_sequence: startSequence + idx,
        role: message.role,
        content: message.content,
        metadata: message.metadata || null
      }));

      const { data, error } = await this.supabase
        .from('onboarding_conversations')
        .insert(insertData)
        .select();

      if (error) throw error;

      logger.info({ userId, messagesAdded: data.length }, 'Messages added to conversation');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to add messages to conversation');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get conversation history formatted for LLM
   */
  async getConversationHistory(userId: string): Promise<OnboardingConversationRepositoryResult<Message[]>> {
    try {
      const result = await this.findByUserId(userId);

      if (result.error || !result.data) {
        return { data: null, error: result.error };
      }

      const messages: Message[] = result.data.map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
        metadata: msg.metadata as Record<string, any> | undefined
      }));

      logger.info({ userId, messageCount: messages.length }, 'Conversation history retrieved');
      return { data: messages, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get conversation history');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Clear all messages for a user (for restarting onboarding)
   */
  async clearConversation(userId: string): Promise<OnboardingConversationRepositoryResult<boolean>> {
    try {
      logger.info({ userId }, 'Clearing onboarding conversation');

      const { error } = await this.supabase
        .from('onboarding_conversations')
        .delete()
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ userId }, 'Onboarding conversation cleared');
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to clear onboarding conversation');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
export const onboardingConversationRepository = new OnboardingConversationRepository();
