// lib/ai/providers/kimiProvider.ts
// Kimi (Moonshot AI) provider - OpenAI-compatible API
// API Documentation: https://platform.moonshot.ai
// Base URL: https://api.moonshot.ai/v1

import OpenAI from 'openai';
import { BaseAIProvider, CallContext } from './baseProvider';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { calculateCostSync } from '@/lib/ai/pricing';

/**
 * KimiProvider - Moonshot AI's Kimi LLM Provider
 *
 * Kimi K2 is Moonshot AI's trillion-parameter mixture-of-experts (MoE) model
 * that provides OpenAI-compatible API endpoints. It excels at:
 * - Long context understanding (256K tokens)
 * - Agentic capabilities and tool calling
 * - Reasoning and coding tasks
 * - Context caching for 90% token savings
 *
 * API Compatibility:
 * - Uses OpenAI SDK by changing base URL and API key
 * - Supports standard chat completion format
 * - Compatible with tool calling (function calling)
 *
 * Available Models (as of 2025):
 * - kimi-k2-0711-preview: Original K2 model (July 2025)
 * - kimi-k2-0905-preview: Upgraded version with improved grounding (Sept 2025)
 * - kimi-k2-thinking: Enhanced reasoning capabilities (Nov 2025)
 *
 * Pricing (highly competitive):
 * - K2 Base: $0.15/M input tokens, $2.50/M output tokens
 * - K2 Thinking: $0.60/M input tokens, $2.50/M output tokens
 */
export class KimiProvider extends BaseAIProvider {
  private client: OpenAI;

  /**
   * Initialize Kimi provider with API key
   *
   * @param apiKey - Moonshot AI API key from https://platform.moonshot.ai
   * @param analytics - Optional AI analytics service for tracking
   */
  constructor(apiKey: string, analytics?: any) {
    super(analytics);

    // Initialize OpenAI SDK with Kimi's base URL
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.moonshot.ai/v1'
    });
  }

  /**
   * Static factory method to get a KimiProvider instance with validation
   *
   * @param aiAnalytics - The AI analytics service instance
   * @returns A configured KimiProvider instance
   * @throws Error if KIMI_API_KEY is not configured or aiAnalytics is not provided
   */
  static getInstance(aiAnalytics: AIAnalyticsService): KimiProvider {
    if (!process.env.KIMI_API_KEY) {
      console.error('❌ Missing Kimi API key');
      throw new Error('Kimi API key not configured', { cause: 400 } as any);
    }

    if (!aiAnalytics) {
      console.error('❌ AI Analytics service not provided');
      throw new Error('AI Analytics service not initialized', { cause: 500 } as any);
    }

    // Initialize Kimi provider with analytics
    return new KimiProvider(process.env.KIMI_API_KEY!, aiAnalytics);
  }

  /**
   * Execute a chat completion using Kimi's API
   *
   * Supports all standard OpenAI chat completion parameters:
   * - messages: Conversation history
   * - model: Kimi model name (e.g., 'kimi-k2-0905-preview')
   * - temperature: Randomness (0.0 - 1.0)
   * - max_tokens: Maximum response length
   * - tools: Function calling definitions
   * - tool_choice: How to invoke tools
   *
   * Context Caching:
   * - Kimi automatically caches context for repeated calls
   * - Up to 90% token savings on cached contexts
   * - 83% faster time-to-first-token
   *
   * @param params - OpenAI-compatible chat completion parameters
   * @param context - Analytics context for tracking usage
   * @returns Chat completion response
   */
  async chatCompletion(
    params: OpenAI.Chat.ChatCompletionCreateParams,
    context: CallContext
  ): Promise<OpenAI.Chat.ChatCompletion> {
    // Ensure streaming is disabled for token tracking
    const nonStreamParams = { ...params, stream: false as const };

    return this.callWithTracking(
      context,
      'kimi', // Provider name for analytics
      params.model,
      'chat/completions',
      async () => {
        const result = await this.client.chat.completions.create(nonStreamParams);
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
   * Calculate cost for Kimi API usage
   *
   * Uses the shared pricing service which supports:
   * - Database-backed pricing from ai_model_pricing table
   * - Fallback to hardcoded pricing if DB unavailable
   * - Automatic caching for performance
   *
   * @param model - Kimi model name
   * @param usage - Token usage from API response
   * @returns Cost in USD
   */
  private calculateCost(model: string, usage: any): number {
    return calculateCostSync(
      'kimi',
      model,
      usage?.prompt_tokens || 0,
      usage?.completion_tokens || 0
    );
  }

  /**
   * Get recommended Kimi model for different use cases
   *
   * @param useCase - Use case type
   * @returns Recommended model name
   */
  static getRecommendedModel(useCase: 'general' | 'reasoning' | 'coding' | 'long-context'): string {
    switch (useCase) {
      case 'reasoning':
        return 'kimi-k2-thinking'; // Best for complex reasoning tasks
      case 'coding':
      case 'long-context':
        return 'kimi-k2-0905-preview'; // Improved grounding, great for code
      case 'general':
      default:
        return 'kimi-k2-0905-preview'; // Latest stable version
    }
  }

  /**
   * Check if a model supports context caching
   * All Kimi models support automatic context caching
   */
  static supportsContextCaching(model: string): boolean {
    return model.startsWith('kimi-k2');
  }
}
