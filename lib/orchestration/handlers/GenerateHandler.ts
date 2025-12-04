/**
 * GenerateHandler
 *
 * Handler for content generation intents
 * Optimized for creating new content, reports, and creative outputs
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';

export class GenerateHandler extends BaseHandler {
  intent: IntentType = 'generate';

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

      // Prepare input for LLM
      const input = this.safeStringify(resolvedInput);

      // Estimate token usage - generation typically needs more output tokens
      const inputTokens = this.estimateTokenCount(input);
      const estimatedTokens = inputTokens + 1500;
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for generation');
      }

      // Prepare prompts
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(context),
        input,
        context
      );

      // Execute generation using provider-agnostic method
      const temperature = this.getTemperature(context);
      const llmResponse = await this.callLLM(
        context,
        system,
        user,
        temperature,
        Math.min(context.budget.remaining, 4096) // Generation needs more tokens
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

      // Assess quality if possible
      const quality = this.assessGenerationQuality(output, context);

      // Create success result
      const result = this.createSuccessResult(
        {
          result: output,           // PRIMARY field - matches StepExecutor and Stage 1 expectations
          response: output,         // Alias for compatibility
          output: output,           // Alias for compatibility
          generated: output,        // Keep for backwards compatibility
          quality,
          tokensGenerated: tokensUsed.output,
        },
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          model: context.routingDecision.model,
          provider: context.routingDecision.provider,
          temperature,
        }
      );

      result.quality = quality;

      this.logExecution(context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      console.error('[GenerateHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Build system prompt for generation
   */
  private buildSystemPrompt(context: HandlerContext): string {
    // Extract generation type from input
    const genType = this.extractGenerationType(context.input);

    const basePrompt = `You are a content generation specialist. Your task is to create high-quality ${genType} content.

INSTRUCTIONS:
- Create original, engaging content
- Follow any specific requirements or constraints provided
- Maintain consistency in tone and style
- Ensure accuracy and factual correctness
- Structure content logically and clearly`;

    // Add specific guidance based on generation type
    if (genType === 'report' || genType === 'document') {
      return basePrompt + `\n- Use professional formatting
- Include relevant sections and headings
- Provide clear conclusions or recommendations`;
    } else if (genType === 'code') {
      return basePrompt + `\n- Write clean, maintainable code
- Include comments for complex logic
- Follow best practices and conventions`;
    } else if (genType === 'creative') {
      return basePrompt + `\n- Be creative and original
- Engage the reader
- Use vivid language and imagery`;
    }

    return basePrompt;
  }

  /**
   * Extract generation type from input
   */
  private extractGenerationType(input: any): string {
    const inputStr = this.safeStringify(input).toLowerCase();

    if (inputStr.includes('report') || inputStr.includes('analysis')) {
      return 'report';
    } else if (inputStr.includes('code') || inputStr.includes('function') || inputStr.includes('script')) {
      return 'code';
    } else if (inputStr.includes('story') || inputStr.includes('creative') || inputStr.includes('narrative')) {
      return 'creative';
    } else if (inputStr.includes('email') || inputStr.includes('message')) {
      return 'communication';
    } else if (inputStr.includes('document') || inputStr.includes('article')) {
      return 'document';
    }

    return 'general';
  }

  /**
   * Get temperature based on generation type
   */
  private getTemperature(context: HandlerContext): number {
    const inputStr = this.safeStringify(context.input).toLowerCase();

    // Lower temperature for technical/factual content
    if (inputStr.includes('code') || inputStr.includes('technical') || inputStr.includes('formal')) {
      return 0.3;
    }

    // Medium temperature for reports and documents
    if (inputStr.includes('report') || inputStr.includes('analysis') || inputStr.includes('document')) {
      return 0.5;
    }

    // Higher temperature for creative content
    if (inputStr.includes('creative') || inputStr.includes('story') || inputStr.includes('narrative')) {
      return 0.8;
    }

    // Default: moderate temperature
    return 0.7;
  }

  /**
   * Assess generation quality
   */
  private assessGenerationQuality(output: string, context: HandlerContext): number {
    // Simple heuristic-based quality assessment
    let quality = 0.8; // Base quality

    // Check length (too short or too long might indicate issues)
    const outputLength = output.length;
    if (outputLength < 50) {
      quality -= 0.2; // Too short
    } else if (outputLength > 10000) {
      quality -= 0.1; // Very long, might be verbose
    }

    // Check for structured content (headings, bullets, etc.)
    if (output.includes('\n\n') || output.includes('# ') || output.includes('- ')) {
      quality += 0.1; // Well-structured
    }

    // Check for code blocks if code generation
    const inputStr = this.safeStringify(context.input).toLowerCase();
    if (inputStr.includes('code')) {
      if (output.includes('```')) {
        quality += 0.1; // Proper code formatting
      }
    }

    return Math.max(0, Math.min(1, quality));
  }
}
