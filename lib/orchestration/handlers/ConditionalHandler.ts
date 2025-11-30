/**
 * ConditionalHandler
 *
 * Handler for conditional logic intents
 * Optimized for evaluating conditions and making routing decisions
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';

export class ConditionalHandler extends BaseHandler {
  intent: IntentType = 'conditional';

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

      // Resolve variables in input
      const resolvedInput = this.resolveInputVariables(context);

      // Prepare input for LLM
      const input = JSON.stringify(resolvedInput);

      // Estimate token usage - conditionals need minimal output
      const inputTokens = this.estimateTokenCount(input);
      const estimatedTokens = inputTokens + 200;
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for conditional');
      }

      // Prepare prompts
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(),
        input,
        context
      );

      // Execute conditional evaluation using provider-agnostic method
      const llmResponse = await this.callLLM(
        context,
        system,
        user,
        0.1, // Extremely low temperature for deterministic logic
        Math.min(context.budget.remaining, 512) // Very small output
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

      // Parse conditional result
      const conditionalResult = this.parseConditionalResult(output);

      // Create success result
      const result = this.createSuccessResult(
        conditionalResult,
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          model: context.routingDecision.model,
          provider: context.routingDecision.provider,
          conditionMet: conditionalResult.result,
        }
      );

      this.logExecution(context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      console.error('[ConditionalHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Build system prompt for conditional evaluation
   */
  private buildSystemPrompt(): string {
    return `You are a logical evaluation specialist. Your task is to evaluate conditions and return boolean results.

INSTRUCTIONS:
- Evaluate the condition precisely
- Return a clear true/false result
- Provide brief reasoning for the decision
- Be deterministic and consistent
- Handle edge cases explicitly

OUTPUT FORMAT:
Return a JSON object with:
{
  "result": true/false,
  "reasoning": "brief explanation",
  "confidence": 0.0-1.0
}`;
  }

  /**
   * Parse conditional result from LLM response
   */
  private parseConditionalResult(output: string): {
    result: boolean;
    reasoning: string;
    confidence: number;
    branch?: string;
  } {
    try {
      // Try to parse as JSON first
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          result: parsed.result === true || parsed.result === 'true',
          reasoning: parsed.reasoning || 'Condition evaluated',
          confidence: parsed.confidence || 1.0,
          branch: parsed.result ? 'then' : 'else',
        };
      }

      // Fallback: parse from text
      const outputLower = output.toLowerCase();
      const isTrue = outputLower.includes('true') ||
                    outputLower.includes('yes') ||
                    outputLower.includes('condition met') ||
                    outputLower.includes('satisfied');

      const isFalse = outputLower.includes('false') ||
                     outputLower.includes('no') ||
                     outputLower.includes('not met') ||
                     outputLower.includes('not satisfied');

      const result = isTrue && !isFalse;

      return {
        result,
        reasoning: output.substring(0, 200), // Truncate reasoning
        confidence: (isTrue || isFalse) ? 0.9 : 0.5,
        branch: result ? 'then' : 'else',
      };
    } catch (error) {
      console.warn('[ConditionalHandler] Failed to parse conditional result');
      return {
        result: false,
        reasoning: 'Failed to parse conditional result',
        confidence: 0.0,
        branch: 'else',
      };
    }
  }
}
