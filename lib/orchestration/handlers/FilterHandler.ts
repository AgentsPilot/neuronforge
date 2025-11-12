/**
 * FilterHandler
 *
 * Handler for filtering intents
 * Optimized for filtering data based on criteria and conditions
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';
import Anthropic from '@anthropic-ai/sdk';

export class FilterHandler extends BaseHandler {
  intent: IntentType = 'filter';
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
      const estimatedTokens = compressionResult.compressedTokens + 500;
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for filtering');
      }

      // Prepare prompts
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(context),
        input,
        context
      );

      // Execute filtering using appropriate model
      const model = this.getModelFromRouting(context);
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: Math.min(context.budget.remaining, 1024),
        temperature: 0.2, // Low temperature for consistent filtering
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

      // Parse filter result
      const filterResult = this.parseFilterResult(output, context);

      // Create success result
      const result = this.createSuccessResult(
        filterResult,
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          compressionApplied: compressionResult.strategy !== 'none',
          compressionRatio: compressionResult.ratio,
          model,
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
    const inputStr = JSON.stringify(input).toLowerCase();

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

  /**
   * Get model from routing decision
   */
  private getModelFromRouting(context: HandlerContext): string {
    // Filtering can use fast tier for efficiency
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
      const costPerToken = context.routingDecision.estimatedCost /
                          (context.budget.allocated || 1000);
      inputCost = tokensUsed.input * costPerToken;
      outputCost = tokensUsed.output * costPerToken * 5;
    }

    return inputCost + outputCost;
  }
}
