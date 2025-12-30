// lib/ai/providers/openaiProvider.ts
import OpenAI from 'openai';
import { BaseAIProvider, CallContext } from './baseProvider';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { calculateCostSync } from '@/lib/ai/pricing';
import { getModelMaxOutputTokens } from '../context-limits';
import { OPENAI_MODELS, type OpenAIModelId } from '../model-constants';

// Re-export for backward compatibility
export { OPENAI_MODELS };
export type OpenAIModelName = OpenAIModelId;

export class OpenAIProvider extends BaseAIProvider {
  private openai: OpenAI;

  /** Default model for OpenAI */
  readonly defaultModel = OPENAI_MODELS.GPT_4O;

  /** Fallback max tokens - prefer using getMaxOutputTokens(model) for model-specific limits */
  readonly defaultMaxTokens = 16384;

  /** OpenAI supports response_format: { type: 'json_object' } */
  readonly supportsResponseFormat = true;

  /**
   * Get the max output tokens for a specific model.
   * Uses centralized MODEL_MAX_OUTPUT_TOKENS config.
   */
  getMaxOutputTokens(model: string): number {
    return getModelMaxOutputTokens(model);
  }

  constructor(apiKey: string, analytics?: any) {
    super(analytics);
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Static factory method to get an OpenAIProvider instance with validation
   *
   * @param aiAnalytics - The AI analytics service instance
   * @returns A configured OpenAIProvider instance
   * @throws Error if OPENAI_API_KEY is not configured or aiAnalytics is not provided
   */
  static getInstance(aiAnalytics: AIAnalyticsService): OpenAIProvider {
    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ Missing OpenAI API key');
      throw new Error('OpenAI API key not configured', { cause: 400 } as any);
    }

    if (!aiAnalytics) {
      console.error('❌ AI Analytics service not provided');
      throw new Error('AI Analytics service not initialized', { cause: 500 } as any);
    }

    // Initialize OpenAI provider with analytics
    return new OpenAIProvider(process.env.OPENAI_API_KEY!, aiAnalytics);
  }

  /**
   * Check if a model uses max_completion_tokens instead of max_tokens.
   * Newer models (GPT-5.x, GPT-4.1, o-series) use the new parameter name.
   */
  private usesMaxCompletionTokens(model: string): boolean {
    return (
      model.startsWith('gpt-5') ||
      model.startsWith('gpt-4.1') ||
      model.startsWith('o3') ||
      model.startsWith('o4')
    );
  }

  async chatCompletion(
    params: OpenAI.Chat.ChatCompletionCreateParams,
    context: CallContext
  ): Promise<OpenAI.Chat.ChatCompletion> {
    // Ensure streaming is disabled for token tracking
    const nonStreamParams = { ...params, stream: false as const };

    // Handle max_tokens vs max_completion_tokens for newer models
    if (this.usesMaxCompletionTokens(params.model) && (nonStreamParams as any).max_tokens) {
      (nonStreamParams as any).max_completion_tokens = (nonStreamParams as any).max_tokens;
      delete (nonStreamParams as any).max_tokens;
    }

    return this.callWithTracking(
      context,
      'openai',
      params.model,
      'chat/completions',
      async () => {
        const result = await this.openai.chat.completions.create(nonStreamParams);
        // Type assertion since we disabled streaming
        return result as OpenAI.Chat.ChatCompletion;
      },
      (result: OpenAI.Chat.ChatCompletion) => ({
        inputTokens: result.usage?.prompt_tokens || 0,
        outputTokens: result.usage?.completion_tokens || 0,
        cost: this.calculateCost(params.model, result.usage),
        responseSize: JSON.stringify(result).length
      })
    ) as Promise<OpenAI.Chat.ChatCompletion>;
  }

  /**
   * Chat completion with automatic JSON parsing
   * Convenience method for structured output workflows
   *
   * @param params - OpenAI chat completion parameters
   * @param context - Analytics tracking context
   * @returns Parsed JSON data and token usage
   */
  async chatCompletionJson<T>(
    params: OpenAI.Chat.ChatCompletionCreateParams,
    context: CallContext
  ): Promise<{ data: T; tokensUsed: { prompt: number; completion: number; total: number } }> {
    const completion = await this.chatCompletion(params, context);
    const content = completion.choices[0]?.message?.content || '{}';

    return {
      data: JSON.parse(content) as T,
      tokensUsed: {
        prompt: completion.usage?.prompt_tokens || 0,
        completion: completion.usage?.completion_tokens || 0,
        total: completion.usage?.total_tokens || 0
      }
    };
  }

  /**
   * Creates a new OpenAI thread
   *
   * @param context - Optional analytics context for tracking
   * @returns The created thread object
   */
  async createThread(context?: CallContext): Promise<OpenAI.Beta.Threads.Thread> {
    const startTime = Date.now();

    try {
      const thread = await this.openai.beta.threads.create();

      // Track thread creation if context provided
      if (context && this.analytics) {
        await this.analytics.trackAICall({
          call_id: this.generateCallId(),
          user_id: context.userId,
          session_id: context.sessionId,
          provider: 'openai',
          model_name: 'threads-api',
          endpoint: 'threads/create',
          feature: context.feature,
          component: context.component,
          workflow_step: context.workflow_step,
          category: context.category || 'thread_management',
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
          latency_ms: Date.now() - startTime,
          success: true,
          request_type: 'thread_create',
          activity_type: context.activity_type,
          activity_name: context.activity_name,
          agent_id: context.agent_id,
          activity_step: context.activity_step
        });
      }

      return thread;
    } catch (error: any) {
      // Track failure if context provided
      if (context && this.analytics) {
        await this.analytics.trackAICall({
          call_id: this.generateCallId(),
          user_id: context.userId,
          session_id: context.sessionId,
          provider: 'openai',
          model_name: 'threads-api',
          endpoint: 'threads/create',
          feature: context.feature,
          component: context.component,
          workflow_step: context.workflow_step,
          category: context.category || 'thread_management',
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
          latency_ms: Date.now() - startTime,
          success: false,
          error_code: error.code || 'UNKNOWN',
          error_message: error.message,
          request_type: 'thread_create',
          activity_type: context.activity_type,
          activity_name: context.activity_name,
          agent_id: context.agent_id,
          activity_step: context.activity_step
        });
      }

      throw error;
    }
  }

  /**
   * Adds a message to an existing OpenAI thread
   *
   * @param threadId - The ID of the thread to add the message to
   * @param message - The message object with role and content
   * @param context - Optional analytics context for tracking (currently unused but reserved for future tracking)
   * @returns The created message object
   */
  async addMessageToThread(
    threadId: string,
    message: { role: 'user' | 'assistant', content: string },
    context?: CallContext // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<OpenAI.Beta.Threads.Messages.Message> {
    try {
      // @ts-ignore - Using deprecated but functional signature
      const threadMessage = await this.openai.beta.threads.messages.create(threadId, {
        role: message.role,
        content: message.content
      });

      // Track message creation if context provided (optional, might be too noisy)
      // Uncomment if needed for debugging
      // if (context && this.analytics) {
      //   await this.analytics.trackAICall({...});
      // }

      return threadMessage;
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Deletes an OpenAI thread
   *
   * @param threadId - The ID of the thread to delete
   */
  async deleteThread(threadId: string): Promise<void> {
    try {
      // @ts-ignore - Using correct delete method
      await this.openai.beta.threads.delete(threadId);
    } catch (error: any) {
      console.error(`⚠️ Failed to delete thread ${threadId}:`, error.message);
      // Don't throw - deletion failures shouldn't break the flow
    }
  }

  /**
   * Creates a new thread with system prompt injected as the first message.
   * Combines createThread() and addMessageToThread() with automatic cleanup on failure.
   *
   * @param systemPrompt - The system prompt to inject
   * @param context - Optional analytics context for tracking
   * @returns The created thread object
   * @throws Error if thread creation or prompt injection fails
   */
  async createThreadWithSystemPrompt(
    systemPrompt: string,
    context?: CallContext
  ): Promise<OpenAI.Beta.Threads.Thread> {
    // Step 1: Create thread
    const thread = await this.createThread(context);

    try {
      // Step 2: Inject system prompt as first message
      await this.addMessageToThread(
        thread.id,
        { role: 'assistant', content: systemPrompt },
        context
      );

      return thread;
    } catch (error: any) {
      // Cleanup: delete the thread since we couldn't inject the prompt
      console.error('❌ Failed to inject system prompt, cleaning up thread:', error.message);
      await this.deleteThread(thread.id);

      throw new Error(`Failed to inject system prompt into thread: ${error.message}`);
    }
  }

  /**
   * Retrieves messages from a thread
   *
   * @param threadId - The ID of the thread
   * @param options - Optional parameters for filtering (order, limit)
   * @returns Messages page object
   */
  async getThreadMessages(
    threadId: string,
    options?: { order?: 'asc' | 'desc', limit?: number }
  ): Promise<OpenAI.Beta.Threads.Messages.MessagesPage> {
    try {
      // @ts-ignore - Using deprecated but functional signature
      return await this.openai.beta.threads.messages.list(threadId, {
        order: options?.order || 'asc',
        ...(options?.limit && { limit: options.limit })
      });
    } catch (error: any) {
      throw new Error(`Failed to retrieve thread messages: ${error.message}`);
    }
  }

  /**
   * Builds a conversation array from thread messages for use with Chat Completions API
   *
   * @param messages - Array of thread messages
   * @returns Array of conversation messages formatted for Chat Completions
   */
  buildConversationFromThread(
    messages: OpenAI.Beta.Threads.Messages.Message[]
  ): Array<{ role: 'user' | 'assistant' | 'system', content: string }> {
    const conversation: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = [];

    for (const msg of messages) {
      const content = msg.content[0];
      if (content.type === 'text') {
        conversation.push({
          role: msg.role as 'user' | 'assistant',
          content: content.text.value
        });
      }
    }

    return conversation;
  }

  private calculateCost(model: string, usage: any): number {
    // Use shared pricing service with database-backed pricing
    return calculateCostSync(
      'openai',
      model,
      usage?.prompt_tokens || 0,
      usage?.completion_tokens || 0
    );
  }
}