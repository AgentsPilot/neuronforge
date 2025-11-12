/**
 * SummarizeHandler
 *
 * Handler for summarization intents
 * Optimized for condensing content while preserving key information
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';
import Anthropic from '@anthropic-ai/sdk';

export class SummarizeHandler extends BaseHandler {
  intent: IntentType = 'summarize';
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
      const estimatedTokens = compressionResult.compressedTokens + 800; // Summaries need more output tokens
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for summarization');
      }

      // Prepare prompts
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(context),
        input,
        context
      );

      // Execute summarization using appropriate model from routing decision
      const model = this.getModelFromRouting(context);
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: Math.min(context.budget.remaining, 2048),
        temperature: 0.5, // Moderate temperature for balanced creativity
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

      // Create success result
      const result = this.createSuccessResult(
        {
          summary: output,
          originalLength: compressionResult.originalTokens,
          summaryLength: tokensUsed.output,
          compressionRatio: 1 - (tokensUsed.output / compressionResult.originalTokens),
        },
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          compressionApplied: compressionResult.strategy !== 'none',
          compressionRatio: compressionResult.ratio,
          model,
        }
      );

      this.logExecution(context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      console.error('[SummarizeHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Build system prompt for summarization
   */
  private buildSystemPrompt(context: HandlerContext): string {
    // Extract target length if specified in input
    const targetLength = this.extractTargetLength(context.input);

    return `You are a summarization specialist. Your task is to create concise, accurate summaries.

INSTRUCTIONS:
- Preserve key information and main ideas
- Remove redundancy and filler content
- Maintain logical flow and coherence
- Focus on actionable insights
${targetLength ? `- Target length: ~${targetLength} words` : '- Keep summary concise but comprehensive'}

OUTPUT FORMAT:
Provide a clear, well-structured summary. Use bullet points for multiple key points if appropriate.`;
  }

  /**
   * Extract target length from input if specified
   */
  private extractTargetLength(input: any): number | null {
    if (typeof input === 'object' && input.targetLength) {
      return parseInt(input.targetLength);
    }

    const inputStr = JSON.stringify(input);
    const lengthMatch = inputStr.match(/(\d+)\s*(words?|tokens?)/i);
    if (lengthMatch) {
      return parseInt(lengthMatch[1]);
    }

    return null;
  }

  /**
   * Get model from routing decision
   */
  private getModelFromRouting(context: HandlerContext): string {
    // Summarization benefits from better models for quality
    // Default to Sonnet if available, fallback to Haiku
    const model = context.routingDecision.model;

    if (context.routingDecision.tier === 'fast') {
      return 'claude-3-haiku-20240307';
    } else if (context.routingDecision.tier === 'powerful') {
      return 'claude-3-5-sonnet-20241022';
    }

    return model || 'claude-3-haiku-20240307';
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
