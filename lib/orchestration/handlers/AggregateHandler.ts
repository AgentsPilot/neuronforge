/**
 * AggregateHandler
 *
 * Handler for aggregation intents
 * Optimized for combining, grouping, and aggregating data
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';

export class AggregateHandler extends BaseHandler {
  intent: IntentType = 'aggregate';

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
      const input = JSON.stringify(cleanedData);

      // Estimate token usage
      const inputTokens = this.estimateTokenCount(input);
      const estimatedTokens = inputTokens + 700;
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for aggregation');
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

      // Execute aggregation using provider-agnostic method
      const llmResponse = await this.callLLM(
        context,
        system,
        enrichedUser, // Use enriched prompt with metadata facts
        0.3, // Low temperature for consistent calculations
        Math.min(context.budget.remaining, 1536)
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

      // Parse aggregation result
      const aggregateResult = this.parseAggregateResult(output, context);

      // Create success result
      const result = this.createSuccessResult(
        aggregateResult,
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          model: context.routingDecision.model,
          provider: context.routingDecision.provider,
          aggregationType: aggregateResult.type,
        }
      );

      this.logExecution(context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      console.error('[AggregateHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Build system prompt for aggregation
   */
  private buildSystemPrompt(context: HandlerContext): string {
    const aggregationType = this.extractAggregationType(context.input);

    return `You are a data aggregation specialist. Your task is to combine and aggregate data.

AGGREGATION TYPE: ${aggregationType}

INSTRUCTIONS:
- Process all data items systematically
- Apply the correct aggregation function
- Handle missing or null values appropriately
- Maintain numerical precision for calculations
- Group data correctly if grouping is required
- Provide clear summary statistics

OUTPUT FORMAT:
Return aggregated results in a structured format (JSON preferred) with:
- Aggregation results
- Group keys (if applicable)
- Count of items processed
- Any relevant statistics`;
  }

  /**
   * Extract aggregation type from input
   */
  private extractAggregationType(input: any): string {
    const inputStr = JSON.stringify(input).toLowerCase();

    // Statistical aggregations
    if (inputStr.includes('sum') || inputStr.includes('total')) {
      return 'sum/total';
    } else if (inputStr.includes('average') || inputStr.includes('mean')) {
      return 'average/mean';
    } else if (inputStr.includes('count')) {
      return 'count';
    } else if (inputStr.includes('max') || inputStr.includes('maximum')) {
      return 'maximum';
    } else if (inputStr.includes('min') || inputStr.includes('minimum')) {
      return 'minimum';
    } else if (inputStr.includes('median')) {
      return 'median';
    }

    // Grouping aggregations
    if (inputStr.includes('group by')) {
      return 'group by';
    } else if (inputStr.includes('count by') || inputStr.includes('count per')) {
      return 'count by group';
    }

    // Collection aggregations
    if (inputStr.includes('concat') || inputStr.includes('join')) {
      return 'concatenate/join';
    } else if (inputStr.includes('merge')) {
      return 'merge';
    } else if (inputStr.includes('combine')) {
      return 'combine';
    }

    return 'general aggregation';
  }

  /**
   * Parse aggregation result from LLM response
   */
  private parseAggregateResult(output: string, context: HandlerContext): {
    aggregated: any;
    type: string;
    statistics?: any;
  } {
    const aggregationType = this.extractAggregationType(context.input);

    try {
      // Try to parse as JSON
      const jsonMatch = output.match(/[\{\[][\s\S]*[\}\]]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          aggregated: parsed,
          type: aggregationType,
          statistics: {
            itemsProcessed: parsed.count || parsed.length,
            ...parsed.statistics,
          },
        };
      }

      // Return as text
      return {
        aggregated: output,
        type: aggregationType,
      };
    } catch (error) {
      console.warn('[AggregateHandler] Failed to parse aggregation result as JSON');
      return {
        aggregated: output,
        type: aggregationType,
      };
    }
  }
}
