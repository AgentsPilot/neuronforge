/**
 * FilterHandler
 *
 * Handler for filtering intents
 * Optimized for filtering data based on criteria and conditions
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';

export class FilterHandler extends BaseHandler {
  intent: IntentType = 'filter';

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
      const estimatedTokens = inputTokens + 500;
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for filtering');
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

      // Execute filtering using provider-agnostic method
      const llmResponse = await this.callLLM(
        context,
        system,
        enrichedUser, // Use enriched prompt with metadata facts
        0.2, // Low temperature for consistent filtering
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

      // Parse filter result
      const filterResult = this.parseFilterResult(output, context);

      // Create success result
      const result = this.createSuccessResult(
        filterResult,
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          model: context.routingDecision.model,
          provider: context.routingDecision.provider,
          itemsFiltered: filterResult.filtered?.length || 0,
          itemsRemoved: filterResult.removed || 0,
        }
      );

      this.logExecution(context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      console.error('[FilterHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Build system prompt for filtering
   */
  private buildSystemPrompt(context: HandlerContext): string {
    const filterType = this.extractFilterType(context.input);

    return `You are a data filtering specialist. Your task is to filter data based on specified criteria.

FILTER TYPE: ${filterType}

INSTRUCTIONS:
- Evaluate each item against the filter criteria
- Be precise and consistent in evaluation
- Preserve items that meet ALL criteria (AND logic by default)
- Return filtered results in the same structure as input
- Provide count of items kept and removed

OUTPUT FORMAT:
Return a JSON object with:
{
  "filtered": [array of items that passed the filter],
  "removed": count of items filtered out,
  "criteria": "description of filter criteria applied"
}`;
  }

  /**
   * Extract filter type from input
   */
  private extractFilterType(input: any): string {
    const inputStr = this.safeStringify(input).toLowerCase();

    // Value-based filters
    if (inputStr.includes('greater than') || inputStr.includes('>')) {
      return 'greater than filter';
    } else if (inputStr.includes('less than') || inputStr.includes('<')) {
      return 'less than filter';
    } else if (inputStr.includes('equal') || inputStr.includes('==')) {
      return 'equality filter';
    } else if (inputStr.includes('between') || inputStr.includes('range')) {
      return 'range filter';
    }

    // Pattern-based filters
    if (inputStr.includes('contains') || inputStr.includes('includes')) {
      return 'contains filter';
    } else if (inputStr.includes('starts with') || inputStr.includes('begins')) {
      return 'prefix filter';
    } else if (inputStr.includes('ends with')) {
      return 'suffix filter';
    } else if (inputStr.includes('regex') || inputStr.includes('pattern')) {
      return 'pattern/regex filter';
    }

    // Property-based filters
    if (inputStr.includes('has') || inputStr.includes('exists')) {
      return 'existence filter';
    } else if (inputStr.includes('not null') || inputStr.includes('non-null')) {
      return 'non-null filter';
    } else if (inputStr.includes('unique') || inputStr.includes('distinct')) {
      return 'uniqueness filter';
    }

    // Logical filters
    if (inputStr.includes('and')) {
      return 'AND filter (multiple criteria)';
    } else if (inputStr.includes('or')) {
      return 'OR filter (any criteria)';
    } else if (inputStr.includes('not')) {
      return 'NOT filter (exclusion)';
    }

    return 'general filter';
  }

  /**
   * Parse filter result from LLM response
   */
  private parseFilterResult(output: string, context: HandlerContext): {
    filtered: any[];
    removed: number;
    criteria?: string;
    originalCount?: number;
  } {
    try {
      // Try to parse as JSON
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const filtered = Array.isArray(parsed.filtered) ? parsed.filtered :
                        Array.isArray(parsed) ? parsed : [parsed];

        return {
          filtered,
          removed: parsed.removed || 0,
          criteria: parsed.criteria,
          originalCount: filtered.length + (parsed.removed || 0),
        };
      }

      // Try to parse as array
      const arrayMatch = output.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        const filtered = JSON.parse(arrayMatch[0]);
        return {
          filtered: Array.isArray(filtered) ? filtered : [filtered],
          removed: 0,
        };
      }

      // Return empty result
      return {
        filtered: [],
        removed: 0,
        criteria: 'Failed to parse filter result',
      };
    } catch (error) {
      console.warn('[FilterHandler] Failed to parse filter result');
      return {
        filtered: [],
        removed: 0,
        criteria: 'Parse error',
      };
    }
  }
}
