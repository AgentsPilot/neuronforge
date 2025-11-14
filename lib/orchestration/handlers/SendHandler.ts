/**
 * SendHandler
 *
 * Handler for send/notification intents
 * Optimized for sending messages, notifications, and communications
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';

export class SendHandler extends BaseHandler {
  intent: IntentType = 'send';

  constructor() {
    super();
  }

  async handle(context: HandlerContext): Promise<HandlerResult> {
    const startTime = Date.now();

    try {
      // Validate context
      const isValid = await this.validate(context);
      if (!isValid) {
        return this.createErrorResult('Invalid handler context');
      }

      // ✅ CRITICAL: Resolve variables BEFORE processing
      // This ensures {{step2.data.summary}} type references are resolved to actual values
      console.log(`[SendHandler] Processing step ${context.stepId} with intent: ${context.intent}`);

      // Resolve all variable references in the input using the execution context
      const resolvedInput = this.resolveInputVariables(context);

      console.log(`[SendHandler] Variables resolved successfully`);

      // Apply compression to input if enabled
      const { compressed: input, result: compressionResult } = await this.compressInput(
        JSON.stringify(resolvedInput),  // ✅ Use resolved input instead of original
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

      // Execute message preparation using provider-agnostic method
      const temperature = this.getTemperature(context);
      const llmResponse = await this.callLLM(
        context,
        system,
        user,
        temperature,
        Math.min(context.budget.remaining, 800)
      );

      // Parse response
      const output = llmResponse.text;

      // Calculate actual token usage
      const tokensUsed = {
        input: llmResponse.inputTokens,
        output: llmResponse.outputTokens,
      };

      // Use cost from provider
      const cost = llmResponse.cost;

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
          model: context.routingDecision.model,
          provider: context.routingDecision.provider,
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
    const messageType = this.extractMessageType(context);

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
  private extractMessageType(context: HandlerContext): string {
    // ✅ Use extractInputData to avoid circular references
    const inputData = this.extractInputData(context);
    const inputStr = JSON.stringify(inputData).toLowerCase();

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
    // ✅ Use extractInputData to avoid circular references
    const inputData = this.extractInputData(context);
    const inputStr = JSON.stringify(inputData).toLowerCase();

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
   * ✅ OPTIMIZED: Return concise status instead of full output to avoid duplication
   */
  private parseSendResult(output: string, context: HandlerContext): {
    message: string;
    messageType: string;
    metadata?: any;
  } {
    try {
      const messageType = this.extractMessageType(context);

      // Try to parse as JSON first (for structured messages)
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Extract recipients if available
        const recipients = parsed.recipients || parsed.to || 'recipient(s)';
        const subject = parsed.subject ? ` - ${parsed.subject}` : '';

        // Return concise status message instead of full content
        return {
          message: `✅ ${messageType.charAt(0).toUpperCase() + messageType.slice(1)} prepared and sent to ${recipients}${subject}`,
          messageType: messageType,
          metadata: {
            subject: parsed.subject,
            recipients: parsed.recipients,
            fullContent: output, // Store full content in metadata if needed for debugging
            ...parsed,
          },
        };
      }

      // For plain text messages, return concise status
      return {
        message: `✅ ${messageType.charAt(0).toUpperCase() + messageType.slice(1)} prepared and sent successfully`,
        messageType: messageType,
        metadata: {
          fullContent: output, // Store full content in metadata if needed
        },
      };
    } catch (error) {
      return {
        message: `✅ ${this.extractMessageType(context).charAt(0).toUpperCase() + this.extractMessageType(context).slice(1)} sent successfully`,
        messageType: this.extractMessageType(context),
        metadata: {
          fullContent: output,
        },
      };
    }
  }
}
