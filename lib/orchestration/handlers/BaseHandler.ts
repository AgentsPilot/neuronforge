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
import { ProviderFactory } from '@/lib/ai/providerFactory';

export abstract class BaseHandler implements IntentHandler {
  abstract intent: IntentType;
  protected compressionService: CompressionService | null = null;

  constructor() {
    // Note: CompressionService requires Supabase client - will be initialized when needed
    // Compression is handled at orchestration level, not in individual handlers
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
   * Note: Compression is handled at orchestration level before handler execution
   * This method is kept for backward compatibility but compression should be done upstream
   */
  protected async compressInput(
    input: string,
    context: HandlerContext
  ): Promise<{ compressed: string; result: CompressionResult }> {
    // Compression is disabled in handlers - it's done at orchestration level
    // Return input as-is with no-op compression result
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
   * Extract input data from context, excluding circular references
   * stepInput structure: { step, params, context, executionContext }
   * We want just the params for processing
   *
   * ✅ HYBRID EXECUTION FIX: When params is empty but executionContext has step outputs,
   * automatically include previous step data. This handles agents configured with
   * prompt-based variable resolution ({{step1.data.emails}}) running through orchestration.
   */
  protected extractInputData(context: HandlerContext): any {
    const input = context.input;

    // 🔍 DEBUG: Log input structure
    console.log(`🔍 [${this.intent}Handler] extractInputData called`);
    console.log(`🔍 [${this.intent}Handler] input has 'params'?`, input && typeof input === 'object' && 'params' in input);
    console.log(`🔍 [${this.intent}Handler] input.params:`, JSON.stringify(input && typeof input === 'object' && 'params' in input ? input.params : 'N/A'));
    console.log(`🔍 [${this.intent}Handler] input has 'executionContext'?`, input && typeof input === 'object' && 'executionContext' in input);

    // If input has params field (from StepExecutor), use that
    if (input && typeof input === 'object' && 'params' in input) {
      const params = input.params;

      // ✅ FIX: If params is empty or just has empty step refs, try to populate from executionContext
      const isEmptyParams = !params ||
                           Object.keys(params).length === 0 ||
                           (Object.keys(params).length === 1 && params.step1 && Object.keys(params.step1).length === 0);

      if (isEmptyParams && input.executionContext) {
        const executionContext = input.executionContext;

        // 🔍 DEBUG: Log executionContext structure
        console.log(`🔍 [${this.intent}Handler] executionContext.variables keys:`, Object.keys(executionContext.variables || {}));
        console.log(`🔍 [${this.intent}Handler] executionContext has getStepOutput?`, !!executionContext.getStepOutput);
        console.log(`🔍 [${this.intent}Handler] executionContext has getAllStepOutputs?`, !!executionContext.getAllStepOutputs);

        // ✅ CRITICAL FIX: Check stepOutputs Map instead of variables object
        // ExecutionContext stores step results in stepOutputs Map, NOT in variables object
        let availableSteps: string[] = [];

        if (executionContext.getAllStepOutputs) {
          // Get all step outputs from the Map
          const allStepOutputs = executionContext.getAllStepOutputs();
          availableSteps = Array.from(allStepOutputs.keys()).filter(k => k.startsWith('step'));
          console.log(`🔍 [${this.intent}Handler] Found ${availableSteps.length} steps in stepOutputs Map:`, availableSteps);
        } else if (executionContext.getStepOutput) {
          // Fallback: try to find step outputs in variables object (legacy)
          availableSteps = Object.keys(executionContext.variables || {}).filter(k => k.startsWith('step'));
          console.log(`🔍 [${this.intent}Handler] Found ${availableSteps.length} steps in variables (legacy):`, availableSteps);
        }

        if (availableSteps.length > 0) {
          console.log(`🔄 [${this.intent}Handler] Params empty, auto-populating from previous steps: ${availableSteps.join(', ')}`);

          // Build enriched params with all available step outputs
          const enrichedParams: any = {};
          for (const stepKey of availableSteps) {
            const stepOutput = executionContext.getStepOutput(stepKey);
            if (stepOutput) {
              enrichedParams[stepKey] = stepOutput;
            }
          }

          console.log(`✅ [${this.intent}Handler] Enriched params with ${Object.keys(enrichedParams).length} step output(s)`);
          return this.deepClone(enrichedParams);
        }
      }

      // Deep clone params to avoid any circular references from the original object
      return this.deepClone(params);
    }

    // Otherwise return input as-is (may be direct data)
    return input;
  }

  /**
   * Deep clone an object, removing circular references and non-serializable values
   */
  private deepClone(obj: any, seen = new WeakSet()): any {
    // Handle primitives
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    // Handle circular references
    if (seen.has(obj)) {
      return undefined; // or return '[Circular]' for debugging
    }
    seen.add(obj);

    // Handle Date
    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }

    // Handle Array
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item, seen));
    }

    // Handle Object
    const cloned: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        // Skip functions and undefined
        if (typeof obj[key] === 'function' || obj[key] === undefined) {
          continue;
        }
        cloned[key] = this.deepClone(obj[key], seen);
      }
    }

    return cloned;
  }

  /**
   * Resolve variables in input using ExecutionContext
   * Supports {{stepX.data.field}} and other variable patterns
   *
   * ✅ OPTIMIZED: Removed auto-context injection that bloated prompts with ALL step outputs
   * StepExecutor already resolves variables before calling handlers
   */
  protected resolveInputVariables(context: HandlerContext): any {
    let inputData = this.extractInputData(context);

    // Check if executionContext is available for variable resolution
    const executionContext = context.executionContext || context.input?.executionContext;

    if (!executionContext || !executionContext.resolveAllVariables) {
      console.warn(`[${this.intent}Handler] No execution context available for variable resolution, using input as-is`);
      return inputData;
    }

    try {
      // Use ExecutionContext's resolveAllVariables method
      const resolved = executionContext.resolveAllVariables(inputData);
      console.log(`[${this.intent}Handler] ✅ Successfully resolved variables in input`);

      // Deep clone the resolved data to remove any circular references that might have been introduced
      const cleanResolved = this.deepClone(resolved);

      return cleanResolved;
    } catch (error) {
      console.error(`[${this.intent}Handler] ❌ Error resolving variables:`, error);
      // Return original input if resolution fails
      return inputData;
    }
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
   * Call LLM using the provider specified in routing decision
   * This is the unified method that all handlers should use instead of calling provider SDKs directly
   */
  protected async callLLM(
    context: HandlerContext,
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
    maxTokens?: number
  ): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  }> {
    try {
      // ✅ Sanitize model name - remove any quotes that may have been added by JSON serialization
      const sanitizedModel = context.routingDecision.model
        .trim()
        .replace(/^["']|["']$/g, '');  // Remove leading/trailing quotes

      // Get provider from routing decision
      const provider = ProviderFactory.getProvider(
        context.routingDecision.provider as 'openai' | 'anthropic' | 'kimi'
      );

      console.log(
        `🎯 [Handler:${this.intent}] Step ${context.stepId} - LLM Call:`,
        `\n   🤖 Model: ${sanitizedModel}`,
        `\n   🏢 Provider: ${context.routingDecision.provider}`,
        `\n   📊 Tier: ${context.routingDecision.tier}`,
        `\n   🎫 Token Budget: ${context.budget.remaining} remaining`,
        `\n   🔥 Temperature: ${temperature}`
      );

      // Call provider's unified interface
      const response = await provider.chatCompletion(
        {
          model: sanitizedModel,  // ✅ Use sanitized model name
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature,
          max_tokens: maxTokens || Math.min(context.budget.remaining, 4096),
        },
        {
          userId: context.userId,  // ✅ Use userId from context (passed from WorkflowOrchestrator)
          feature: 'orchestration',
          component: `handler_${this.intent}`,
          category: 'workflow_execution',
          activity_type: 'llm_call',
          activity_name: `Handler: ${this.intent}`,
          workflow_step: context.stepId,
          agent_id: context.agentId,  // ✅ Also add agentId for better tracking
          execution_id: context.executionId,  // ✅ Pass execution_id as top-level field for proper DB tracking
          metadata: {
            execution_id: context.executionId,  // Also keep in metadata for backward compatibility
            handler_intent: this.intent,
            routing_tier: context.routingDecision.tier,
          },
        }
      );

      const text = response.choices[0]?.message?.content || '';

      return {
        text,
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        cost: response.usage?.total_cost || 0,
      };
    } catch (error) {
      console.error(`[Handler:${this.intent}] LLM call failed:`, error);
      throw new Error(
        `LLM call failed for ${context.routingDecision.provider}/${context.routingDecision.model}: ` +
        `${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
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
