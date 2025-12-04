/**
 * ExtractHandler
 *
 * Handler for data extraction intents
 * Optimized for extracting structured data from unstructured sources
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';

export class ExtractHandler extends BaseHandler {
  intent: IntentType = 'extract';

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
      const estimatedTokens = inputTokens + 500; // Add buffer for output
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for extraction');
      }

      // Prepare prompts
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(),
        input,
        context
      );

      // Calculate dataset size for smart metadata filtering
      const dataSize = Array.isArray(cleanedData) ? cleanedData.length : 0;

      // Inject preprocessing metadata facts into user prompt
      const enrichedUser = this.injectPreprocessingFacts(user, metadata, dataSize);

      // Execute extraction using provider-agnostic method
      const llmResponse = await this.callLLM(
        context,
        system,
        enrichedUser, // Use enriched prompt with metadata facts
        0.3, // Lower temperature for more consistent extraction
        Math.min(context.budget.remaining, context.routingDecision.estimatedLatency > 3000 ? 2048 : 1024)
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

      // Create success result
      const result = this.createSuccessResult(
        this.parseExtractedData(output),
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          model: context.routingDecision.model,
          provider: context.routingDecision.provider,
        }
      );

      this.logExecution(context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      console.error('[ExtractHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Build system prompt for extraction
   */
  private buildSystemPrompt(): string {
    return `You are a data extraction specialist. Your task is to extract structured information from the provided content.

INSTRUCTIONS:
- Extract all relevant data points
- Maintain accuracy and precision
- Return data in a structured format (JSON preferred)
- If data is unclear or missing, indicate with null values
- Do not infer or guess data that is not present

OUTPUT FORMAT:
Return extracted data as valid JSON with clear field names.`;
  }

  /**
   * Parse extracted data from LLM response
   */
  private parseExtractedData(output: string): any {
    try {
      // Try to parse as JSON first
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      // If not JSON, return as structured text
      return {
        raw: output,
        format: 'text',
      };
    } catch (error) {
      console.warn('[ExtractHandler] Failed to parse JSON, returning raw output');
      return {
        raw: output,
        format: 'text',
        parseError: true,
      };
    }
  }
}
