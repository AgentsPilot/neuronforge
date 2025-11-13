/**
 * useThreadManagement Hook
 *
 * Handles OpenAI thread lifecycle for agent creation:
 * - Thread initialization
 * - Message processing across phases 1-3
 * - Error handling and retries
 */

import { useRef, useCallback } from 'react';
import { useThreadBasedAgentCreation } from '@/lib/utils/featureFlags';
import type {
  InitThreadResponse,
  ThreadResumeResponse,
  ThreadErrorResponse
} from '@/components/agent-creation/types/agent-prompt-threads';

interface ProcessMessageRequest {
  thread_id: string;
  phase: 1 | 2 | 3;
  user_prompt: string;
  user_context?: {
    full_name?: string;
    email?: string;
  };
  connected_services?: string[];
  clarification_answers?: Record<string, string>;
  metadata?: {
    declined_plugins?: string[];
    [key: string]: any;
  };
}

interface ProcessMessageResponse {
  success: boolean;
  phase: number;
  clarityScore?: number;
  needsClarification?: boolean;
  missingPlugins?: string[];
  pluginWarning?: any;
  analysis?: any;
  questionsSequence?: any[];
  enhanced_prompt?: any;
  requiredServices?: string[];
  suggestions?: string[];
  // Additional fields from backend enrichment (if implemented)
  connectedPlugins?: string[];
  connectedPluginsData?: any[];
  conversationalSummary?: string; // LLM-generated friendly summary
}


export function useThreadManagement() {
  const threadId = useRef<string | null>(null);
  const useThreadFlow = useThreadBasedAgentCreation();

  /**
   * Initialize a new OpenAI thread with system prompt
   */
  const initializeThread = useCallback(async (): Promise<string | null> => {
    if (!useThreadFlow) {
      console.log('⚠️ Thread-based flow is disabled, skipping thread initialization');
      return null;
    }

    try {
      console.log('🧵 Initializing thread...');

      const response = await fetch('/api/agent-creation/init-thread', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData: ThreadErrorResponse = await response.json();
        throw new Error(errorData.error || 'Failed to initialize thread');
      }

      const data: InitThreadResponse = await response.json();

      if (!data.success || !data.thread_id) {
        throw new Error('Thread initialization returned invalid response');
      }

      threadId.current = data.thread_id;
      console.log('✅ Thread initialized:', data.thread_id);

      return data.thread_id;

    } catch (error: any) {
      console.error('❌ Thread initialization failed:', error);
      throw new Error(`Thread initialization failed: ${error.message}`);
    }
  }, [useThreadFlow]);

  /**
   * Process a message in the thread (Phase 1, 2, or 3)
   */
  const processMessageInThread = useCallback(async (
    phase: 1 | 2 | 3,
    userPrompt: string,
    clarificationAnswers?: Record<string, string>,
    userContext?: { full_name?: string; email?: string },
    connectedServices?: string[],
    metadata?: { declined_plugins?: string[]; [key: string]: any }
  ): Promise<ProcessMessageResponse> => {
    if (!threadId.current) {
      throw new Error('Thread not initialized. Call initializeThread() first.');
    }

    try {
      console.log(`📨 Processing message in thread (Phase ${phase})...`);

      const requestBody: ProcessMessageRequest = {
        thread_id: threadId.current,
        phase,
        user_prompt: userPrompt,
      };

      // Add optional fields
      if (userContext) {
        requestBody.user_context = userContext;
      }

      if (connectedServices && connectedServices.length > 0) {
        console.log('🔌 Frontend sending connected_services to backend:', connectedServices);
        requestBody.connected_services = connectedServices;
      } else {
        console.log('⚠️ No connected_services being sent to backend (will fetch from DB)');
      }

      if (clarificationAnswers && Object.keys(clarificationAnswers).length > 0) {
        requestBody.clarification_answers = clarificationAnswers;
      }

      if (metadata && Object.keys(metadata).length > 0) {
        console.log('📋 Frontend sending metadata to backend:', metadata);
        requestBody.metadata = metadata;
      }

      const response = await fetch('/api/agent-creation/process-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData: ThreadErrorResponse = await response.json();
        throw new Error(errorData.error || `Phase ${phase} processing failed`);
      }

      const data: ProcessMessageResponse = await response.json();

      if (!data.success) {
        throw new Error(`Phase ${phase} returned unsuccessful response`);
      }

      console.log(`✅ Phase ${phase} completed successfully`);

      return data;

    } catch (error: any) {
      console.error(`❌ Phase ${phase} processing failed:`, error);
      throw new Error(`Phase ${phase} failed: ${error.message}`);
    }
  }, []);

  /**
   * Get current thread ID
   */
  const getThreadId = useCallback(() => {
    return threadId.current;
  }, []);

  /**
   * Resume an existing thread by loading its state
   */
  const resumeThread = useCallback(async (existingThreadId: string): Promise<ThreadResumeResponse | null> => {
    if (!useThreadFlow) {
      console.log('⚠️ Thread-based flow is disabled, skipping thread resume');
      return null;
    }

    try {
      console.log('🔄 Resuming thread:', existingThreadId);

      const response = await fetch(`/api/agent-creation/thread/${existingThreadId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData: ThreadErrorResponse = await response.json();
        throw new Error(errorData.error || 'Failed to resume thread');
      }

      const data: ThreadResumeResponse = await response.json();

      if (!data.success || !data.thread) {
        throw new Error('Thread resume returned invalid response');
      }

      // Set the thread ID for continued use
      threadId.current = existingThreadId;
      console.log('✅ Thread resumed:', existingThreadId, '- Phase:', data.thread.current_phase);

      return data;

    } catch (error: any) {
      console.error('❌ Thread resume failed:', error);
      throw new Error(`Thread resume failed: ${error.message}`);
    }
  }, [useThreadFlow]);

  /**
   * Reset thread (for new conversation)
   */
  const resetThread = useCallback(() => {
    console.log('🔄 Resetting thread');
    threadId.current = null;
  }, []);

  return {
    threadId: threadId.current,
    useThreadFlow,
    initializeThread,
    processMessageInThread,
    resumeThread,
    getThreadId,
    resetThread,
  };
}

export type UseThreadManagementReturn = ReturnType<typeof useThreadManagement>;
