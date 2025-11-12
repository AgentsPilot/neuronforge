/**
 * BaseHandler
 *
 * Abstract base class for intent handlers
 * Provides common functionality for all intent-specific handlers
 */

import type {
  IntentHandler,
  IntentType,
  HandlerContext,
  HandlerResult,
  CompressionResult,
} from '../types';
import { CompressionService } from '../CompressionService';
import { OrchestrationError } from '../types';

export abstract class BaseHandler implements IntentHandler {
  abstract intent: IntentType;
  protected compressionService: CompressionService;

  constructor() {
    this.compressionService = new CompressionService();
  }

  /**
   * Main handler method - to be implemented by concrete handlers
   */
  abstract handle(context: HandlerContext): Promise<HandlerResult>;

  /**
   * Estimate token usage for handler
   */
  async estimateTokens(context: HandlerContext): Promise<number> {
    // Default estimation: use allocated budget
    return context.budget.allocated;
  }

  /**
   * Validate handler context
   */
  async validate(context: HandlerContext): Promise<boolean> {
    // Check required fields
    if (!context.stepId || !context.intent || !context.budget) {
      console.error('[Handler] Invalid context: missing required fields');
      return false;
    }

    // Check budget availability
    if (context.budget.remaining <= 0) {
      console.error('[Handler] No budget remaining for step');
      return false;
    }

    return true;
  }

  /**
   * Apply compression to input if enabled
   */
  protected async compressInput(
    input: string,
    context: HandlerContext
  ): Promise<{ compressed: string; result: CompressionResult }> {
    if (!context.compressionPolicy.enabled) {
      const tokens = this.estimateTokenCount(input);
      return {
        compressed: input,
        result: {
          original: input,
          compressed: input,
          originalTokens: tokens,
          compressedTokens: tokens,
          ratio: 1.0,
          qualityScore: 1.0,
          strategy: 'none',
        },
      };
    }

    const result = await this.compressionService.compress(
      input,
      context.compressionPolicy,
      context.intent
    );

    return {
      compressed: result.compressed,
      result,
    };
  }

  /**
   * Create error result
   */
  protected createErrorResult(
    error: Error | string,
    tokensUsed: number = 0
  ): HandlerResult {
    return {
      success: false,
      output: null,
      tokensUsed: {
        input: tokensUsed,
        output: 0,
        total: tokensUsed,
      },
      cost: 0,
      latency: 0,
      error: error instanceof Error ? error.message : error,
    };
  }

  /**
   * Create success result
   */
  protected createSuccessResult(
    output: any,
    tokensUsed: { input: number; output: number },
    cost: number,
    latency: number,
    metadata?: Record<string, any>
  ): HandlerResult {
    return {
      success: true,
      output,
      tokensUsed: {
        input: tokensUsed.input,
        output: tokensUsed.output,
        total: tokensUsed.input + tokensUsed.output,
      },
      cost,
      latency,
      metadata,
    };
  }

  /**
   * Estimate token count (rough approximation)
   */
  protected estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if budget allows execution
   */
  protected checkBudget(context: HandlerContext, estimatedTokens: number): boolean {
    if (context.budget.remaining < estimatedTokens) {
      if (context.budget.overageAllowed) {
        const overageLimit = context.budget.overageLimit || context.budget.allocated * 0.2;
        const totalUsedWithEstimate = context.budget.used + estimatedTokens;
        const totalAllowed = context.budget.allocated + overageLimit;

        if (totalUsedWithEstimate > totalAllowed) {
          console.warn(
            `[Handler] Budget exceeded even with overage allowance: ` +
            `${totalUsedWithEstimate} > ${totalAllowed} tokens`
          );
          return false;
        }
      } else {
        console.warn(
          `[Handler] Budget exceeded: ${estimatedTokens} tokens needed, ` +
          `${context.budget.remaining} remaining`
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Format prompt for LLM execution
   */
  protected formatPrompt(
    systemPrompt: string,
    userPrompt: string,
    context: HandlerContext
  ): { system: string; user: string } {
    // Add memory context if available (using formatted version for better LLM parsing)
    let enhancedUserPrompt = userPrompt;
    if (context.memory) {
      // Format memory context in human-readable way (same as AgentKit)
      const memoryPrompt = this.formatMemoryForPrompt(context.memory);
      if (memoryPrompt) {
        enhancedUserPrompt = `${memoryPrompt}\n\n${userPrompt}`;
      }
    }

    return {
      system: systemPrompt,
      user: enhancedUserPrompt,
    };
  }

  /**
   * Format memory context in human-readable way for LLM consumption
   *
   * @private
   */
  private formatMemoryForPrompt(memory: any): string {
    if (!memory || memory.token_count === 0) {
      return '';
    }

    let prompt = '\n--- 🧠 AGENT MEMORY CONTEXT ---\n\n';

    // User profile
    if (memory.user_context && memory.user_context.length > 0) {
      prompt += '👤 USER PROFILE:\n';
      for (const mem of memory.user_context) {
        prompt += `  • ${mem.memory_key}: ${JSON.stringify(mem.memory_value)}\n`;
      }
      prompt += '\n';
    }

    // Recent execution history
    if (memory.recent_runs && memory.recent_runs.length > 0) {
      prompt += '📊 RECENT HISTORY:\n';
      for (const run of memory.recent_runs) {
        const sentimentIcons: Record<string, string> = {
          positive: '✅',
          neutral: '➖',
          negative: '❌',
          mixed: '⚠️'
        };
        const icon = run.sentiment ? sentimentIcons[run.sentiment] || '•' : (run.key_outcomes?.success ? '✅' : '❌');
        const aisInfo = run.ais_score ? ` (AIS: ${run.ais_score.toFixed(1)})` : '';
        const timeInfo = run.execution_time_ms ? ` [${(run.execution_time_ms / 1000).toFixed(1)}s]` : '';

        prompt += `  ${icon} Run #${run.run_number}${aisInfo}${timeInfo}: ${run.summary}\n`;

        if (run.patterns_detected?.recurring_error) {
          prompt += `      ⚠️ Pattern: ${run.patterns_detected.recurring_error}\n`;
        }
        if (run.patterns_detected?.success_pattern) {
          prompt += `      ✨ Success: ${run.patterns_detected.success_pattern}\n`;
        }
      }
      prompt += '\n';
    }

    // Learned patterns
    if (memory.relevant_patterns && memory.relevant_patterns.length > 0) {
      prompt += '💡 LEARNED PATTERNS:\n';
      for (const mem of memory.relevant_patterns) {
        prompt += `  • ${mem.content} (confidence: ${(mem.confidence * 100).toFixed(0)}%)\n`;
      }
      prompt += '\n';
    }

    prompt += `--- END MEMORY (${memory.token_count} tokens) ---\n\n`;
    prompt += 'INSTRUCTIONS: Use memory context to inform your response. Reference past patterns when relevant.\n';

    return prompt;
  }

  /**
   * Log handler execution
   */
  protected logExecution(
    context: HandlerContext,
    result: HandlerResult,
    duration: number
  ): void {
    console.log(
      `[Handler:${this.intent}] Step ${context.stepId} completed in ${duration}ms: ` +
      `${result.success ? 'SUCCESS' : 'FAILED'} ` +
      `(${result.tokensUsed.total} tokens, $${result.cost.toFixed(4)})`
    );

    if (!result.success && result.error) {
      console.error(`[Handler:${this.intent}] Error: ${result.error}`);
    }
  }
}
