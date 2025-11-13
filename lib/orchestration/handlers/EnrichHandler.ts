/**
 * EnrichHandler
 *
 * Handler for enrichment intents
 * Optimized for augmenting data with additional information
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';

export class EnrichHandler extends BaseHandler {
  intent: IntentType = 'enrich';

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

      // Apply compression to input if enabled
      const { compressed: input, result: compressionResult } = await this.compressInput(
        JSON.stringify(resolvedInput),
        context
      );

      // Estimate token usage
      const estimatedTokens = compressionResult.compressedTokens + 800;
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for enrichment');
      }

      // Prepare prompts
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(context),
        input,
        context
      );

      // Execute enrichment using provider-agnostic method
      const llmResponse = await this.callLLM(
        context,
        system,
        user,
        0.5, // Moderate temperature for enrichment
        Math.min(context.budget.remaining, 2048)
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

      // Parse enrichment result
      const enrichResult = this.parseEnrichResult(output, context);

      // Create success result
      const result = this.createSuccessResult(
        enrichResult,
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          compressionApplied: compressionResult.strategy !== 'none',
          compressionRatio: compressionResult.ratio,
          model: context.routingDecision.model,
          provider: context.routingDecision.provider,
          enrichmentType: enrichResult.type,
          fieldsAdded: enrichResult.fieldsAdded || 0,
        }
      );

      this.logExecution(context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      console.error('[EnrichHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Build system prompt for enrichment
   */
  private buildSystemPrompt(context: HandlerContext): string {
    const enrichmentType = this.extractEnrichmentType(context.input);

    return `You are a data enrichment specialist. Your task is to augment data with additional information.

ENRICHMENT TYPE: ${enrichmentType}

INSTRUCTIONS:
- Add relevant information to the provided data
- Preserve all original data fields
- Use reliable sources or logical inference
- Clearly mark enriched fields
- Maintain data structure consistency
- Provide confidence scores for inferred data

OUTPUT FORMAT:
Return enriched data in JSON format with:
- All original fields preserved
- New enriched fields clearly marked
- Metadata about enrichment (sources, confidence)`;
  }

  /**
   * Extract enrichment type from input
   */
  private extractEnrichmentType(input: any): string {
    const inputStr = JSON.stringify(input).toLowerCase();

    // Data source enrichment
    if (inputStr.includes('lookup') || inputStr.includes('fetch')) {
      return 'external lookup enrichment';
    } else if (inputStr.includes('api') || inputStr.includes('endpoint')) {
      return 'API enrichment';
    } else if (inputStr.includes('database') || inputStr.includes('db')) {
      return 'database enrichment';
    }

    // Calculation enrichment
    if (inputStr.includes('calculate') || inputStr.includes('derive')) {
      return 'calculated field enrichment';
    } else if (inputStr.includes('aggregate') && inputStr.includes('enrich')) {
      return 'aggregate enrichment';
    }

    // Contextual enrichment
    if (inputStr.includes('infer') || inputStr.includes('deduce')) {
      return 'inferential enrichment';
    } else if (inputStr.includes('context')) {
      return 'contextual enrichment';
    } else if (inputStr.includes('metadata')) {
      return 'metadata enrichment';
    }

    // Transformation enrichment
    if (inputStr.includes('normalize')) {
      return 'normalization enrichment';
    } else if (inputStr.includes('standardize')) {
      return 'standardization enrichment';
    } else if (inputStr.includes('format')) {
      return 'formatting enrichment';
    }

    return 'general enrichment';
  }

  /**
   * Parse enrichment result from LLM response
   */
  private parseEnrichResult(output: string, context: HandlerContext): {
    enriched: any;
    type: string;
    fieldsAdded?: number;
    metadata?: any;
  } {
    const enrichmentType = this.extractEnrichmentType(context.input);

    try {
      // Try to parse as JSON
      const jsonMatch = output.match(/[\{\[][\s\S]*[\}\]]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Count new fields if it's an object
        let fieldsAdded = 0;
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          const originalInput = context.input;
          const originalKeys = typeof originalInput === 'object'
            ? new Set(Object.keys(originalInput))
            : new Set();
          const enrichedKeys = new Set(Object.keys(parsed));

          fieldsAdded = enrichedKeys.size - originalKeys.size;
        }

        return {
          enriched: parsed,
          type: enrichmentType,
          fieldsAdded,
          metadata: {
            enrichmentApplied: true,
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Return as-is if not parseable
      return {
        enriched: output,
        type: enrichmentType,
        metadata: {
          enrichmentApplied: true,
          format: 'text',
        },
      };
    } catch (error) {
      console.warn('[EnrichHandler] Failed to parse enrichment result');
      return {
        enriched: output,
        type: enrichmentType,
        metadata: {
          enrichmentApplied: false,
          parseError: true,
        },
      };
    }
  }
}
