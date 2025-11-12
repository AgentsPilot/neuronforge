/**
 * TransformHandler
 *
 * Handler for transformation intents
 * Optimized for converting data between formats and structures
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';
import Anthropic from '@anthropic-ai/sdk';

export class TransformHandler extends BaseHandler {
  intent: IntentType = 'transform';
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
      const estimatedTokens = compressionResult.compressedTokens + 600;
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for transformation');
      }

      // Prepare prompts
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(context),
        input,
        context
      );

      // Execute transformation using appropriate model
      const model = this.getModelFromRouting(context);
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: Math.min(context.budget.remaining, 2048),
        temperature: 0.3, // Low temperature for consistent transformation
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

      // Parse transformation result
      const transformResult = this.parseTransformResult(output, context);

      // Create success result
      const result = this.createSuccessResult(
        transformResult,
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          compressionApplied: compressionResult.strategy !== 'none',
          compressionRatio: compressionResult.ratio,
          model,
          transformationType: transformResult.type,
        }
      );

      this.logExecution(context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      console.error('[TransformHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Build system prompt for transformation
   */
  private buildSystemPrompt(context: HandlerContext): string {
    const transformType = this.extractTransformationType(context.input);

    return `You are a data transformation specialist. Your task is to convert data between formats.

TRANSFORMATION TYPE: ${transformType}

INSTRUCTIONS:
- Maintain data integrity during transformation
- Follow the target format specifications exactly
- Preserve all important information
- Handle edge cases and null values appropriately
- Ensure output is valid in the target format

OUTPUT FORMAT:
Return the transformed data in the requested format. If the format is structured (JSON, XML, CSV), ensure proper syntax.`;
  }

  /**
   * Extract transformation type from input
   */
  private extractTransformationType(input: any): string {
    const inputStr = JSON.stringify(input).toLowerCase();

    // Format conversions
    if (inputStr.includes('json') && inputStr.includes('xml')) {
      return 'JSON ↔ XML conversion';
    } else if (inputStr.includes('json') && inputStr.includes('csv')) {
      return 'JSON ↔ CSV conversion';
    } else if (inputStr.includes('xml') && inputStr.includes('csv')) {
      return 'XML ↔ CSV conversion';
    } else if (inputStr.includes('yaml') || inputStr.includes('yml')) {
      return 'YAML conversion';
    }

    // Data structure transformations
    if (inputStr.includes('flatten')) {
      return 'flatten nested structure';
    } else if (inputStr.includes('nest') || inputStr.includes('group')) {
      return 'nest/group data';
    } else if (inputStr.includes('pivot')) {
      return 'pivot transformation';
    } else if (inputStr.includes('merge') || inputStr.includes('join')) {
      return 'merge/join data';
    }

    // Field transformations
    if (inputStr.includes('map') || inputStr.includes('rename')) {
      return 'field mapping/renaming';
    } else if (inputStr.includes('filter fields') || inputStr.includes('select')) {
      return 'field selection';
    } else if (inputStr.includes('calculate') || inputStr.includes('derive')) {
      return 'field calculation';
    }

    return 'general data transformation';
  }

  /**
   * Parse transformation result from LLM response
   */
  private parseTransformResult(output: string, context: HandlerContext): {
    transformed: any;
    type: string;
    metadata?: any;
  } {
    const transformType = this.extractTransformationType(context.input);

    try {
      // Try to parse as JSON if that's the target format
      if (transformType.toLowerCase().includes('json') ||
          output.trim().startsWith('{') ||
          output.trim().startsWith('[')) {
        const jsonMatch = output.match(/[\{\[][\s\S]*[\}\]]/);
        if (jsonMatch) {
          return {
            transformed: JSON.parse(jsonMatch[0]),
            type: transformType,
            metadata: {
              format: 'json',
              size: jsonMatch[0].length,
            },
          };
        }
      }

      // For other formats, return as-is
      return {
        transformed: output,
        type: transformType,
        metadata: {
          format: 'text',
          size: output.length,
        },
      };
    } catch (error) {
      console.warn('[TransformHandler] Failed to parse transformation result as JSON');
      return {
        transformed: output,
        type: transformType,
        metadata: {
          format: 'text',
          size: output.length,
          parseError: true,
        },
      };
    }
  }

  /**
   * Get model from routing decision
   */
  private getModelFromRouting(context: HandlerContext): string {
    // Transform benefits from accuracy, use routed model
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
