/**
 * EnrichHandler
 *
 * Handler for enrichment intents
 * Optimized for augmenting data with additional information
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';
import Anthropic from '@anthropic-ai/sdk';

export class EnrichHandler extends BaseHandler {
  intent: IntentType = 'enrich';
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

      // Execute enrichment using appropriate model
      const model = this.getModelFromRouting(context);
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: Math.min(context.budget.remaining, 2048),
        temperature: 0.5, // Moderate temperature for enrichment
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
          model,
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

  /**
   * Get model from routing decision
   */
  private getModelFromRouting(context: HandlerContext): string {
    // Enrichment benefits from more capable models
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
