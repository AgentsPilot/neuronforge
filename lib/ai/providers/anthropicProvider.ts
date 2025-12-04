// lib/ai/providers/anthropicProvider.ts
// Anthropic Claude Provider with Tool Use support
// Converts between OpenAI and Claude formats for compatibility

import Anthropic from '@anthropic-ai/sdk';
import { BaseAIProvider, CallContext } from './baseProvider';
import { calculateCostSync } from '../pricing';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';

/**
 * Anthropic model name constants
 * Use these instead of raw strings when specifying models
 */
export const ANTHROPIC_MODELS = {
  CLAUDE_4_OPUS: 'claude-opus-4-20250514',
  CLAUDE_4_SONNET: 'claude-sonnet-4-20250514',
  CLAUDE_35_SONNET: 'claude-3-5-sonnet-20241022',
  CLAUDE_35_HAIKU: 'claude-3-5-haiku-20241022',
  CLAUDE_3_OPUS: 'claude-3-opus-20240229',
  CLAUDE_3_SONNET: 'claude-3-sonnet-20240229',
  CLAUDE_3_HAIKU: 'claude-3-haiku-20240307'
} as const;

export type AnthropicModelName = typeof ANTHROPIC_MODELS[keyof typeof ANTHROPIC_MODELS];

interface ChatCompletionParams {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
  }>;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: any;
    };
  }>;
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
}

/**
 * Anthropic Provider - Handles Claude model API calls
 *
 * Converts between OpenAI format (used by AgentKit) and Claude format
 * Supports tool use (Claude's equivalent of function calling)
 */
export class AnthropicProvider extends BaseAIProvider {
  private client: Anthropic;

  constructor(apiKey: string, analytics?: any) {
    super(analytics);
    this.client = new Anthropic({
      apiKey: apiKey
    });
  }

  /**
   * Static factory method to get an AnthropicProvider instance with validation
   *
   * @param aiAnalytics - The AI analytics service instance
   * @returns A configured AnthropicProvider instance
   * @throws Error if ANTHROPIC_API_KEY is not configured or aiAnalytics is not provided
   */
  static getInstance(aiAnalytics: AIAnalyticsService): AnthropicProvider {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('❌ Missing Anthropic API key');
      throw new Error('Anthropic API key not configured', { cause: 400 } as any);
    }

    if (!aiAnalytics) {
      console.error('❌ AI Analytics service not provided');
      throw new Error('AI Analytics service not initialized', { cause: 500 } as any);
    }

    return new AnthropicProvider(process.env.ANTHROPIC_API_KEY!, aiAnalytics);
  }

  /**
   * Chat completion with OpenAI-compatible interface
   *
   * @param params - Chat completion parameters in OpenAI format
   * @param context - Call context for analytics tracking
   * @returns Response in OpenAI format (converted from Claude)
   */
  async chatCompletion(params: ChatCompletionParams, context: CallContext) {
    // EXTRACT SYSTEM PROMPT from messages array
    // Claude requires system prompt as separate parameter
    const systemMessage = params.messages.find(m => m.role === 'system');
    const systemPrompt = systemMessage?.content || '';

    // REMOVE system messages from messages array (Claude doesn't accept them)
    const claudeMessages = this.convertMessagesToClaudeFormat(
      params.messages.filter(m => m.role !== 'system')
    );

    // Convert tools format if provided
    const claudeTools = params.tools ? this.convertToolsToClaudeFormat(params.tools) : undefined;

    // Log conversion for debugging
    console.log('🔄 Converting OpenAI → Claude format:', {
      original_messages: params.messages.length,
      claude_messages: claudeMessages.length,
      has_system: !!systemPrompt,
      has_tools: !!claudeTools,
      tool_count: claudeTools?.length || 0
    });

    // Use callWithTracking for automatic analytics
    return this.callWithTracking(
      context,
      'anthropic',
      params.model,
      'messages/create',
      async () => {
        // CREATE Claude request with SEPARATE system parameter
        const requestParams: Anthropic.MessageCreateParams = {
          model: params.model,
          messages: claudeMessages,
          max_tokens: params.max_tokens || 4096,
          temperature: params.temperature !== undefined ? params.temperature : 0.1,
        };

        // Only add system if it exists
        if (systemPrompt) {
          requestParams.system = systemPrompt;
        }

        // Only add tools if they exist
        if (claudeTools && claudeTools.length > 0) {
          requestParams.tools = claudeTools;
        }

        // Make API call to Claude
        const response = await this.client.messages.create(requestParams);

        console.log('✅ Claude API call successful:', {
          model: response.model,
          stop_reason: response.stop_reason,
          usage: response.usage
        });

        // Convert Claude response back to OpenAI format for compatibility
        return this.convertClaudeResponseToOpenAIFormat(response);
      },
      (result: any) => {
        // Extract metrics for tracking
        const cost = calculateCostSync(
          'anthropic',
          params.model,
          result.usage?.prompt_tokens || 0,
          result.usage?.completion_tokens || 0
        );

        return {
          inputTokens: result.usage?.prompt_tokens || 0,
          outputTokens: result.usage?.completion_tokens || 0,
          cost: cost,
          responseSize: JSON.stringify(result).length
        };
      }
    );
  }

  /**
   * Chat completion with automatic JSON parsing
   * Convenience method for structured output workflows
   *
   * @param params - Chat completion parameters in OpenAI format
   * @param context - Analytics tracking context
   * @returns Parsed JSON data and token usage
   */
  async chatCompletionJson<T>(
    params: ChatCompletionParams,
    context: CallContext
  ): Promise<{ data: T; tokensUsed: { prompt: number; completion: number; total: number } }> {
    const completion = await this.chatCompletion(params, context);
    const rawContent = completion.choices[0]?.message?.content || '{}';

    // Debug: Log raw response before any manipulation
    console.log('🔍 [AnthropicProvider] Raw response content (length: ' + rawContent.length + '):\n', rawContent);

    // Extract JSON from response - Claude often wraps JSON in markdown code blocks
    const jsonContent = this.extractJsonFromResponse(rawContent);

    // Debug: Log after extraction
    console.log('🔍 [AnthropicProvider] After JSON extraction (length: ' + jsonContent.length + '):\n', jsonContent);

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

    console.log('🔧 [AnthropicProvider] Auto-closed brackets:', {
      addedBrackets: openBrackets < 0 ? 0 : -openBrackets,
      addedBraces: openBraces < 0 ? 0 : -openBraces
    });

    return fixed;
  }

  /**
   * Convert OpenAI messages to Claude format
   *
   * @private
   */
  private convertMessagesToClaudeFormat(
    messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: any[] }>
  ): Anthropic.MessageParam[] {
    return messages.map(m => {
      // Handle tool results (OpenAI: role='tool', Claude: role='user' with tool_result block)
      if (m.role === 'tool' && m.tool_call_id) {
        return {
          role: 'user' as const,
          content: [{
            type: 'tool_result' as const,
            tool_use_id: m.tool_call_id,
            content: m.content
          }]
        };
      }

      // Handle assistant messages with tool calls
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        const content: any[] = [];

        // Add text content if present
        if (m.content && m.content.trim()) {
          content.push({
            type: 'text' as const,
            text: m.content
          });
        }

        // Add tool_use blocks
        m.tool_calls.forEach(toolCall => {
          content.push({
            type: 'tool_use' as const,
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments)
          });
        });

        return {
          role: 'assistant' as const,
          content
        };
      }

      // Standard user/assistant messages
      return {
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content
      };
    });
  }

  /**
   * Convert OpenAI tools to Claude format
   *
   * @private
   */
  private convertToolsToClaudeFormat(
    tools: Array<{ type: 'function'; function: { name: string; description?: string; parameters: any } }>
  ): Anthropic.Tool[] {
    return tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description || '',
      input_schema: tool.function.parameters as Anthropic.Tool.InputSchema
    }));
  }

  /**
   * Convert Claude response to OpenAI format
   *
   * @private
   */
  private convertClaudeResponseToOpenAIFormat(response: Anthropic.Message): any {
    // Extract tool calls from Claude's content blocks
    const toolCalls: any[] = [];
    let textContent = '';

    response.content.forEach((block) => {
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id, // Use Claude's original ID (no prefix needed)
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
          }
        });
      } else if (block.type === 'text') {
        textContent += block.text;
      }
    });

    // Calculate cost
    const cost = calculateCostSync(
      'anthropic',
      response.model,
      response.usage.input_tokens,
      response.usage.output_tokens
    );

    // Return in OpenAI-compatible format
    return {
      id: response.id,
      object: 'chat.completion',
      created: Date.now(),
      model: response.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        },
        finish_reason: response.stop_reason === 'tool_use' ? 'tool_calls' :
                      response.stop_reason === 'end_turn' ? 'stop' :
                      response.stop_reason === 'max_tokens' ? 'length' :
                      'stop'
      }],
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens
      },
      // Add cost for analytics
      _cost: cost
    };
  }
}
