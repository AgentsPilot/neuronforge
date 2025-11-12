/**
 * SendHandler
 *
 * Handler for send/notification intents
 * Optimized for sending messages, notifications, and communications
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';
import Anthropic from '@anthropic-ai/sdk';

export class SendHandler extends BaseHandler {
  intent: IntentType = 'send';
  private anthropic: Anthropic;

  constructor() {
    super();
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async handle(context: HandlerContext): Promise<HandlerResult> {
    const startTime = Date.now();

    try {
      // Validate context
      const isValid = await this.validate(context);
      if (!isValid) {
        return this.createErrorResult('Invalid handler context');
      }

      // Apply compression to input if enabled
      const { compressed: input, result: compressionResult } = await this.compressInput(
        JSON.stringify(context.input),
        context
      );

      // Estimate token usage - send typically needs less output
      const estimatedTokens = compressionResult.compressedTokens + 400;
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for send');
      }

      // Prepare prompts
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(context),
        input,
        context
      );

      // Execute message preparation using appropriate model
      const model = this.getModelFromRouting(context);
      const temperature = this.getTemperature(context);

      const response = await this.anthropic.messages.create({
        model,
        max_tokens: Math.min(context.budget.remaining, 800),
        temperature,
        system,
        messages: [
          {
            role: 'user',
            content: user,
          },
        ],
      });

      // Parse response
      const output = response.content[0].type === 'text' ? response.content[0].text : '';

      // Calculate actual token usage
      const tokensUsed = {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      };

      // Calculate cost
      const cost = this.calculateCost(tokensUsed, context);

      // Parse send result
      const sendResult = this.parseSendResult(output, context);

      // Create success result
      const result = this.createSuccessResult(
        sendResult,
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          compressionApplied: compressionResult.strategy !== 'none',
          compressionRatio: compressionResult.ratio,
          model,
          messageType: sendResult.messageType,
        }
      );

      this.logExecution(context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      console.error('[SendHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Build system prompt for send
   */
  private buildSystemPrompt(context: HandlerContext): string {
    const messageType = this.extractMessageType(context.input);

    const basePrompt = `You are a communication specialist. Your task is to prepare messages for sending.

MESSAGE TYPE: ${messageType}

INSTRUCTIONS:
- Maintain appropriate tone and formality for the context
- Be clear and concise
- Include all necessary information
- Follow any specified format or requirements
- Ensure proper structure (subject, body, recipients, etc.)`;

    // Add specific guidance based on message type
    if (messageType === 'email') {
      return basePrompt + `\n- Include subject line, greeting, body, and signature
- Use professional email formatting`;
    } else if (messageType === 'notification') {
      return basePrompt + `\n- Keep it brief and actionable
- Include clear call-to-action if needed`;
    } else if (messageType === 'slack' || messageType === 'chat') {
      return basePrompt + `\n- Use casual, friendly tone
- Keep it concise
- Use formatting (bold, lists) for readability`;
    }

    return basePrompt;
  }

  /**
   * Extract message type from input
   */
  private extractMessageType(input: any): string {
    const inputStr = JSON.stringify(input).toLowerCase();

    if (inputStr.includes('email')) {
      return 'email';
    } else if (inputStr.includes('slack') || inputStr.includes('chat')) {
      return 'slack';
    } else if (inputStr.includes('sms') || inputStr.includes('text')) {
      return 'sms';
    } else if (inputStr.includes('notification') || inputStr.includes('alert')) {
      return 'notification';
    } else if (inputStr.includes('webhook')) {
      return 'webhook';
    }

    return 'message';
  }

  /**
   * Get temperature based on message type
   */
  private getTemperature(context: HandlerContext): number {
    const inputStr = JSON.stringify(context.input).toLowerCase();

    // Lower temperature for formal communications
    if (inputStr.includes('formal') || inputStr.includes('professional')) {
      return 0.3;
    }

    // Higher temperature for creative/marketing messages
    if (inputStr.includes('creative') || inputStr.includes('marketing')) {
      return 0.7;
    }

    // Default: moderate temperature
    return 0.5;
  }

  /**
   * Parse send result from LLM response
   */
  private parseSendResult(output: string, context: HandlerContext): {
    message: string;
    messageType: string;
    metadata?: any;
  } {
    try {
      // Try to parse as JSON first (for structured messages)
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          message: parsed.message || parsed.body || output,
          messageType: this.extractMessageType(context.input),
          metadata: {
            subject: parsed.subject,
            recipients: parsed.recipients,
            ...parsed,
          },
        };
      }

      // Return as plain message
      return {
        message: output,
        messageType: this.extractMessageType(context.input),
      };
    } catch (error) {
      return {
        message: output,
        messageType: this.extractMessageType(context.input),
      };
    }
  }

  /**
   * Get model from routing decision
   */
  private getModelFromRouting(context: HandlerContext): string {
    // Send typically uses fast tier for cost efficiency
    return context.routingDecision.model || 'claude-3-haiku-20240307';
  }

  /**
   * Calculate cost based on token usage and routing
   */
  private calculateCost(
    tokensUsed: { input: number; output: number },
    context: HandlerContext
  ): number {
    const model = context.routingDecision.model;
    let inputCost = 0;
    let outputCost = 0;

    if (model.includes('haiku')) {
      inputCost = tokensUsed.input * 0.00000025;
      outputCost = tokensUsed.output * 0.00000125;
    } else if (model.includes('sonnet')) {
      inputCost = tokensUsed.input * 0.000003;
      outputCost = tokensUsed.output * 0.000015;
    } else {
      // Default estimation
      const costPerToken = context.routingDecision.estimatedCost /
                          (context.budget.allocated || 1000);
      inputCost = tokensUsed.input * costPerToken;
      outputCost = tokensUsed.output * costPerToken * 5;
    }

    return inputCost + outputCost;
  }
}
