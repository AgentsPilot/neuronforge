/**
 * GenerateHandler
 *
 * Handler for content generation intents
 * Optimized for creating new content, reports, and creative outputs
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';
import Anthropic from '@anthropic-ai/sdk';

export class GenerateHandler extends BaseHandler {
  intent: IntentType = 'generate';
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

      // Estimate token usage - generation typically needs more output tokens
      const estimatedTokens = compressionResult.compressedTokens + 1500;
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for generation');
      }

      // Prepare prompts
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(context),
        input,
        context
      );

      // Execute generation using appropriate model from routing decision
      const model = this.getModelFromRouting(context);
      const temperature = this.getTemperature(context);

      const response = await this.anthropic.messages.create({
        model,
        max_tokens: Math.min(context.budget.remaining, 4096), // Generation needs more tokens
        temperature,
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

      // Assess quality if possible
      const quality = this.assessGenerationQuality(output, context);

      // Create success result
      const result = this.createSuccessResult(
        {
          generated: output,
          quality,
          tokensGenerated: tokensUsed.output,
        },
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          compressionApplied: compressionResult.strategy !== 'none',
          compressionRatio: compressionResult.ratio,
          model,
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
    const inputStr = JSON.stringify(input).toLowerCase();

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
    const inputStr = JSON.stringify(context.input).toLowerCase();

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
   * Get model from routing decision
   */
  private getModelFromRouting(context: HandlerContext): string {
    // Generation benefits from more powerful models
    // Use routed model, prefer Sonnet for better quality
    const model = context.routingDecision.model;

    if (context.routingDecision.tier === 'powerful') {
      return 'claude-3-5-sonnet-20241022';
    }

    return model || 'claude-3-haiku-20240307';
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
    const inputStr = JSON.stringify(context.input).toLowerCase();
    if (inputStr.includes('code')) {
      if (output.includes('```')) {
        quality += 0.1; // Proper code formatting
      }
    }

    return Math.max(0, Math.min(1, quality));
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
