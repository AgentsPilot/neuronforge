// lib/ai/providers/anthropicProvider.ts
// Anthropic Claude Provider with Tool Use support
// Converts between OpenAI and Claude formats for compatibility

import Anthropic from '@anthropic-ai/sdk';
import { BaseAIProvider, CallContext } from './baseProvider';
import { calculateCostSync } from '../pricing';

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
   * Convert OpenAI messages to Claude format
   *
   * @private
   */
  private convertMessagesToClaudeFormat(
    messages: Array<{ role: string; content: string; tool_call_id?: string }>
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

    response.content.forEach((block, index) => {
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: `call_${block.id}`,
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
