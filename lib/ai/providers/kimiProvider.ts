// lib/ai/providers/kimiProvider.ts
// Kimi (Moonshot AI) provider - OpenAI-compatible API
// API Documentation: https://platform.moonshot.ai
// Base URL: https://api.moonshot.ai/v1

import OpenAI from 'openai';
import { BaseAIProvider, CallContext } from './baseProvider';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { calculateCostSync } from '@/lib/ai/pricing';

/**
 * Kimi model name constants
 * Use these instead of raw strings when specifying models
 */
export const KIMI_MODELS = {
  // Kimi K2 Series (Latest - 2025)
  K2_PREVIEW: 'kimi-k2-0905-preview', // Latest K2 with 256K context - best for coding, agentic tasks, and instruction following
  K2_THINKING: 'kimi-k2-thinking', // Enhanced reasoning with 256K context - best for complex multi-step reasoning and analysis
  K2_ORIGINAL: 'kimi-k2-0711-preview', // Original K2 with 128K context - stable baseline for general tasks

  // Kimi K1.5 Series (January 2025)
  K15: 'kimi-k1.5', // Multimodal reasoning model - matches OpenAI o1 in math, coding, and multimodal tasks
  K15_LONG: 'kimi-k1.5-long', // Long chain-of-thought mode - best for detailed step-by-step reasoning

  // Kimi Linear Series (October 2025)
  LINEAR: 'kimi-linear-48b', // Ultra-efficient 1M context - 6x faster with 75% less memory, best for extreme long-context tasks

  // Specialized Models
  DEV: 'kimi-dev-72b', // Coding specialist for issue resolution - 60.4% on SWE-bench Verified
  VL: 'kimi-vl' // Vision-Language model - best for multimodal reasoning and image understanding
} as const;

export type KimiModelName = typeof KIMI_MODELS[keyof typeof KIMI_MODELS];

/**
 * KimiProvider - Moonshot AI's Kimi LLM Provider
 *
 * Kimi is Moonshot AI's family of large language models providing
 * OpenAI-compatible API endpoints. The lineup includes:
 *
 * Model Families:
 * - K2 Series: Trillion-parameter MoE models (32B active) for agentic tasks
 * - K1.5 Series: Multimodal reasoning matching OpenAI o1 performance
 * - Linear Series: Ultra-efficient 1M context with 6x faster inference
 * - Specialized: Kimi-Dev (coding), Kimi-VL (vision-language)
 *
 * Key Capabilities:
 * - Long context understanding (up to 1M tokens with Linear)
 * - Agentic capabilities with 200-300 sequential tool calls
 * - Reasoning, coding, and multimodal tasks
 * - Context caching for 90% token savings
 *
 * API Compatibility:
 * - Uses OpenAI SDK by changing base URL and API key
 * - Supports standard chat completion format
 * - Compatible with tool calling (function calling)
 *
 * Available Models (as of 2025):
 * - kimi-k2-0905-preview: Latest K2 with 256K context (Sept 2025)
 * - kimi-k2-thinking: Enhanced reasoning capabilities (Nov 2025)
 * - kimi-k2-0711-preview: Original K2 with 128K context (July 2025)
 * - kimi-k1.5: Multimodal reasoning model (Jan 2025)
 * - kimi-linear-48b: Ultra-efficient 1M context (Oct 2025)
 * - kimi-dev-72b: Coding specialist (60.4% SWE-bench)
 * - kimi-vl: Vision-Language model
 *
 * Pricing (highly competitive):
 * - K2 Base: $0.15/M input tokens, $2.50/M output tokens
 * - K2 Thinking: $0.60/M input tokens, $2.50/M output tokens
 */
export class KimiProvider extends BaseAIProvider {
  private client: OpenAI;

  /** Default model for Kimi */
  readonly defaultModel = KIMI_MODELS.K2_PREVIEW;

  /** Kimi's recommended default for chat completions */
  readonly defaultMaxTokens = 4096;

  /** Kimi does not support OpenAI's response_format parameter */
  readonly supportsResponseFormat = false;

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
   * Chat completion with automatic JSON parsing
   * Convenience method for structured output workflows
   *
   * @param params - OpenAI-compatible chat completion parameters
   * @param context - Analytics tracking context
   * @returns Parsed JSON data and token usage
   */
  async chatCompletionJson<T>(
    params: OpenAI.Chat.ChatCompletionCreateParams,
    context: CallContext
  ): Promise<{ data: T; tokensUsed: { prompt: number; completion: number; total: number } }> {
    const completion = await this.chatCompletion(params, context);
    const rawContent = completion.choices[0]?.message?.content || '{}';

    // Extract JSON from response - model may wrap JSON in markdown code blocks
    const jsonContent = this.extractJsonFromResponse(rawContent);

    return {
      data: JSON.parse(jsonContent) as T,
      tokensUsed: {
        prompt: completion.usage?.prompt_tokens || 0,
        completion: completion.usage?.completion_tokens || 0,
        total: completion.usage?.total_tokens || 0
      }
    };
  }

  /**
   * Extract JSON from a response that may contain markdown code blocks or extra text
   * @private
   */
  private extractJsonFromResponse(content: string): string {
    let jsonStr = content;

    // Try to extract from markdown code blocks first (```json ... ``` or ``` ... ```)
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      // Try to find JSON object or array in the content
      const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
    }

    // Fix common JSON issues from LLM responses
    jsonStr = this.fixJsonSyntax(jsonStr);

    return jsonStr;
  }

  /**
   * Fix common JSON syntax issues from LLM responses
   * Handles: trailing commas, truncated responses, unclosed brackets
   * @private
   */
  private fixJsonSyntax(jsonStr: string): string {
    // Remove trailing commas before } or ]
    // Match comma followed by optional whitespace/newlines, then } or ]
    let fixed = jsonStr.replace(/,(\s*[\}\]])/g, '$1');

    // Remove any BOM or invisible characters at the start
    fixed = fixed.replace(/^\uFEFF/, '');

    // Try to parse, if it fails, attempt more aggressive fixes
    try {
      JSON.parse(fixed);
      return fixed;
    } catch (e) {
      // More aggressive trailing comma removal (handles nested cases)
      fixed = fixed.replace(/,\s*,/g, ','); // Remove double commas
      fixed = fixed.replace(/,(\s*[\}\]])/g, '$1'); // Another pass for trailing commas

      // Try again after comma fixes
      try {
        JSON.parse(fixed);
        return fixed;
      } catch {
        // Response may be truncated - try to auto-close brackets
        fixed = this.autoCloseBrackets(fixed);
      }

      return fixed;
    }
  }

  /**
   * Auto-close unclosed brackets in truncated JSON responses
   * Counts open/close brackets and adds missing closures
   * @private
   */
  private autoCloseBrackets(jsonStr: string): string {
    let fixed = jsonStr;

    // Remove any incomplete key-value pair at the end (e.g., "key": or "key": "incomplete)
    // This handles cases where response was cut mid-value
    fixed = fixed
      .replace(/,\s*"[^"]*":\s*"[^"]*$/, '')  // incomplete string value
      .replace(/,\s*"[^"]*":\s*$/, '')         // incomplete key with no value
      .replace(/,\s*"[^"]*$/, '')              // incomplete key
      .replace(/,\s*$/, '');                   // trailing comma

    // Count brackets to find what's missing
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < fixed.length; i++) {
      const char = fixed[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') openBraces++;
      else if (char === '}') openBraces--;
      else if (char === '[') openBrackets++;
      else if (char === ']') openBrackets--;
    }

    // If we're still inside a string, close it
    if (inString) {
      fixed += '"';
    }

    // Remove trailing comma before adding closures
    fixed = fixed.replace(/,\s*$/, '');

    // Add missing brackets (in reverse order of nesting)
    // Arrays typically close before objects in our schema
    while (openBrackets > 0) {
      fixed += ']';
      openBrackets--;
    }
    while (openBraces > 0) {
      fixed += '}';
      openBraces--;
    }

    return fixed;
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
  static getRecommendedModel(useCase: 'general' | 'reasoning' | 'coding' | 'long-context' | 'ultra-long-context' | 'multimodal' | 'issue-resolution'): string {
    switch (useCase) {
      case 'reasoning':
        return KIMI_MODELS.K2_THINKING; // Best for complex multi-step reasoning
      case 'coding':
        return KIMI_MODELS.K2_PREVIEW; // Latest K2 with improved coding capabilities
      case 'issue-resolution':
        return KIMI_MODELS.DEV; // Specialized for code issue resolution (60.4% SWE-bench)
      case 'long-context':
        return KIMI_MODELS.K2_PREVIEW; // 256K context with strong grounding
      case 'ultra-long-context':
        return KIMI_MODELS.LINEAR; // 1M context with 6x faster inference
      case 'multimodal':
        return KIMI_MODELS.VL; // Vision-language tasks
      case 'general':
      default:
        return KIMI_MODELS.K2_PREVIEW; // Latest stable version for general use
    }
  }

  /**
   * Check if a model supports context caching
   * All Kimi K2 and K1.5 models support automatic context caching
   */
  static supportsContextCaching(model: string): boolean {
    return model.startsWith('kimi-k2') || model.startsWith('kimi-k1') || model.startsWith('kimi-linear');
  }
}
