/**
 * ValidateHandler
 *
 * Handler for validation intents
 * Optimized for validating data against rules, schemas, and requirements
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';
import Anthropic from '@anthropic-ai/sdk';

export class ValidateHandler extends BaseHandler {
  intent: IntentType = 'validate';
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

      // Estimate token usage
      const estimatedTokens = compressionResult.compressedTokens + 500; // Validation needs moderate output
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for validation');
      }

      // Prepare prompts
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(context),
        input,
        context
      );

      // Execute validation using appropriate model from routing decision
      const model = this.getModelFromRouting(context);
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: Math.min(context.budget.remaining, 1024),
        temperature: 0.2, // Very low temperature for consistent validation
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

      // Parse validation result
      const validationResult = this.parseValidationResult(output);

      // Create success result
      const result = this.createSuccessResult(
        validationResult,
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          compressionApplied: compressionResult.strategy !== 'none',
          compressionRatio: compressionResult.ratio,
          model,
          validationPassed: validationResult.isValid,
        }
      );

      this.logExecution(context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      console.error('[ValidateHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Build system prompt for validation
   */
  private buildSystemPrompt(context: HandlerContext): string {
    // Extract validation type from input
    const validationType = this.extractValidationType(context.input);

    return `You are a validation specialist. Your task is to validate data against rules, schemas, or requirements.

INSTRUCTIONS:
- Carefully check all validation criteria
- Be precise and thorough
- Report all violations, not just the first one
- Provide clear explanations for failures
- Return structured validation results

VALIDATION TYPE: ${validationType}

OUTPUT FORMAT:
Return a JSON object with:
{
  "isValid": true/false,
  "violations": ["array of violation descriptions"],
  "summary": "brief summary of validation result",
  "details": {}
}`;
  }

  /**
   * Extract validation type from input
   */
  private extractValidationType(input: any): string {
    const inputStr = JSON.stringify(input).toLowerCase();

    if (inputStr.includes('schema')) {
      return 'schema validation';
    } else if (inputStr.includes('format')) {
      return 'format validation';
    } else if (inputStr.includes('business rule') || inputStr.includes('rule')) {
      return 'business rule validation';
    } else if (inputStr.includes('constraint')) {
      return 'constraint validation';
    } else if (inputStr.includes('integrity')) {
      return 'data integrity validation';
    }

    return 'general validation';
  }

  /**
   * Parse validation result from LLM response
   */
  private parseValidationResult(output: string): {
    isValid: boolean;
    violations: string[];
    summary: string;
    details?: any;
  } {
    try {
      // Try to parse as JSON first
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          isValid: parsed.isValid || false,
          violations: parsed.violations || [],
          summary: parsed.summary || 'Validation completed',
          details: parsed.details,
        };
      }

      // Fallback: parse from text
      const isValid = output.toLowerCase().includes('valid') &&
                     !output.toLowerCase().includes('invalid') &&
                     !output.toLowerCase().includes('violation');

      return {
        isValid,
        violations: isValid ? [] : ['Validation failed (see details)'],
        summary: isValid ? 'Validation passed' : 'Validation failed',
        details: { raw: output },
      };
    } catch (error) {
      console.warn('[ValidateHandler] Failed to parse validation result');
      return {
        isValid: false,
        violations: ['Failed to parse validation result'],
        summary: 'Validation result parsing error',
        details: { raw: output, error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  /**
   * Get model from routing decision
   */
  private getModelFromRouting(context: HandlerContext): string {
    // Validation needs accuracy, use routed model or Haiku for speed
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
