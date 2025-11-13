/**
 * SummarizeHandler
 *
 * Handler for summarization intents
 * Optimized for condensing content while preserving key information
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';

export class SummarizeHandler extends BaseHandler {
  intent: IntentType = 'summarize';

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

      // Execute summarization using provider-agnostic method
      const llmResponse = await this.callLLM(
        context,
        system,
        user,
        0.5, // Moderate temperature for balanced creativity
        Math.min(context.budget.remaining, 2048)
      );

      // Parse response
      const output = llmResponse.text;

      // Extract clean summary by removing meta-commentary and narrative
      const cleanSummary = this.extractCleanSummary(output);

      // Calculate actual token usage
      const tokensUsed = {
        input: llmResponse.inputTokens,
        output: llmResponse.outputTokens,
      };

      // Use cost from provider
      const cost = llmResponse.cost;

      // Create success result
      const result = this.createSuccessResult(
        {
          summary: cleanSummary,  // Use cleaned version instead of raw output
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
          model: context.routingDecision.model,
          provider: context.routingDecision.provider,
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
   * ✅ OPTIMIZED: Simplified to reduce token overhead (~150 tokens vs ~300)
   * ✅ FIXED: Explicitly instruct to output ONLY the summary content
   */
  private buildSystemPrompt(context: HandlerContext): string {
    const targetLength = this.extractTargetLength(context);

    return `You are a summarization specialist. Create concise, accurate summaries.

- Preserve key information and main ideas
- Remove redundancy
- Focus on actionable insights
${targetLength ? `- Target: ~${targetLength} words` : '- Be concise but comprehensive'}

CRITICAL: Output ONLY the summary content itself. Do NOT include:
- Meta-commentary about what you're doing
- Phrases like "I will now...", "Let me...", "Executing..."
- Any narrative about next steps or actions
- Just the pure summary content

Example of CORRECT output:
"The analysis of the last 10 emails reveals... [summary content]"

Example of INCORRECT output:
"The analysis reveals... [summary]. I will now send this to the user."`;
  }

  /**
   * Extract target length from input if specified
   */
  private extractTargetLength(context: HandlerContext): number | null {
    // ✅ Use extractInputData to avoid circular references
    const inputData = this.extractInputData(context);

    if (typeof inputData === 'object' && inputData.targetLength) {
      return parseInt(inputData.targetLength);
    }

    const inputStr = JSON.stringify(inputData);
    const lengthMatch = inputStr.match(/(\d+)\s*(words?|tokens?)/i);
    if (lengthMatch) {
      return parseInt(lengthMatch[1]);
    }

    return null;
  }

  /**
   * Extract clean summary content by removing meta-commentary and narrative
   * ✅ CRITICAL FIX: Prevents duplicate summaries in email output
   */
  private extractCleanSummary(output: string): string {
    let cleaned = output;

    // Remove leading meta-commentary patterns (from start of text)
    const leadingPatterns = [
      /^I will (now )?analyze[^\n]*(\n\n|\n)/i,
      /^I will (now )?summarize[^\n]*(\n\n|\n)/i,
      /^Let me (now )?analyze[^\n]*(\n\n|\n)/i,
      /^Let me (now )?summarize[^\n]*(\n\n|\n)/i,
      /^Now,? I will send[^\n]*(\n\n|\n)/i,
      /^I will (now )?send[^\n]*(\n\n|\n)/i,
      /^Executing[^\n]*(\n\n|\n)/i,
      /^Processing[^\n]*(\n\n|\n)/i,
    ];

    for (const pattern of leadingPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // Remove trailing meta-commentary patterns (from end of text)
    // Split into sections first to avoid regex complexity
    const sections = cleaned.split(/\n\n+/);
    const cleanedSections = sections.filter(section => {
      const lower = section.toLowerCase().trim();
      // Remove sections that are purely narrative about sending
      if (lower.startsWith('now,') && lower.includes('send')) return false;
      if (lower.startsWith('i will') && lower.includes('send')) return false;
      if (lower.startsWith('let me send')) return false;
      if (lower.startsWith('### sending')) return false;
      if (lower.startsWith('---') && lower.includes('send')) return false;
      return true;
    });

    cleaned = cleanedSections.join('\n\n');

    // Trim whitespace
    cleaned = cleaned.trim();

    // If the cleaning removed too much (less than 50 chars), return original
    // This prevents over-aggressive cleaning
    if (cleaned.length < 50) {
      console.warn('[SummarizeHandler] Clean summary too short, using original output');
      return output;
    }

    console.log(`[SummarizeHandler] Cleaned summary: ${cleaned.length} chars (was ${output.length} chars)`);

    return cleaned;
  }
}
