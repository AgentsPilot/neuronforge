/**
 * TransformHandler
 *
 * Handler for transformation intents
 * Optimized for converting data between formats and structures
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';

export class TransformHandler extends BaseHandler {
  intent: IntentType = 'transform';

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
      const estimatedTokens = inputTokens + 600;
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for transformation');
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

      // Execute transformation using provider-agnostic method
      const llmResponse = await this.callLLM(
        context,
        system,
        enrichedUser, // Use enriched prompt with metadata facts
        0.3, // Low temperature for consistent transformation
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

      // Parse transformation result
      const transformResult = this.parseTransformResult(output, context);

      // Create success result
      const result = this.createSuccessResult(
        transformResult,
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          model: context.routingDecision.model,
          provider: context.routingDecision.provider,
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
    // Use BaseHandler's safe stringify to handle circular references
    const inputStr = this.safeStringify(input).toLowerCase();

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
    result: any;          // PRIMARY field
    response: any;        // Alias
    output: any;          // Alias
    transformed: any;     // Semantic field
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
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            result: parsed,        // PRIMARY field - matches StepExecutor expectations
            response: parsed,      // Alias
            output: parsed,        // Alias
            transformed: parsed,   // Semantic field
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
        result: output,        // PRIMARY field - matches StepExecutor expectations
        response: output,      // Alias
        output: output,        // Alias (note: different from 'output' parameter)
        transformed: output,   // Semantic field
        type: transformType,
        metadata: {
          format: 'text',
          size: output.length,
        },
      };
    } catch (error) {
      console.warn('[TransformHandler] Failed to parse transformation result as JSON');
      return {
        result: output,        // PRIMARY field - matches StepExecutor expectations
        response: output,      // Alias
        output: output,        // Alias
        transformed: output,   // Semantic field
        type: transformType,
        metadata: {
          format: 'text',
          size: output.length,
          parseError: true,
        },
      };
    }
  }
}
