/**
 * ValidateHandler
 *
 * Handler for validation intents
 * Optimized for validating data against rules, schemas, and requirements
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';

export class ValidateHandler extends BaseHandler {
  intent: IntentType = 'validate';

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

      // Apply preprocessing to clean data and extract metadata
      const { data: cleanedData, metadata } = await this.applyPreprocessing(resolvedInput);

      // Prepare input for LLM
      const input = this.safeStringify(cleanedData);

      // Estimate token usage
      const inputTokens = this.estimateTokenCount(input);
      const estimatedTokens = inputTokens + 500; // Validation needs moderate output
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for validation');
      }

      // Prepare prompts
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(context),
        input,
        context
      );

      // Calculate dataset size for smart metadata filtering
      const dataSize = Array.isArray(cleanedData) ? cleanedData.length : 0;

      // Inject preprocessing metadata facts into user prompt
      const enrichedUser = this.injectPreprocessingFacts(user, metadata, dataSize);

      // Execute validation using provider-agnostic method
      const llmResponse = await this.callLLM(
        context,
        system,
        enrichedUser, // Use enriched prompt with metadata facts
        0.2, // Very low temperature for consistent validation
        Math.min(context.budget.remaining, 1024)
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

      // Parse validation result
      const validationResult = this.parseValidationResult(output);

      // Create success result
      const result = this.createSuccessResult(
        validationResult,
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          model: context.routingDecision.model,
          provider: context.routingDecision.provider,
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
    const inputStr = this.safeStringify(input).toLowerCase();

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
}
