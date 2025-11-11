// lib/memory/MemoryEnhancedExecution.ts
// Wrapper service to execute agents with memory enhancement

import { SupabaseClient } from '@supabase/supabase-js';
import { MemoryInjector } from './MemoryInjector';
import { MemorySummarizer, SummarizationInput } from './MemorySummarizer';
import { ModelRouter, ModelSelection } from '@/lib/ai/modelRouter';

export interface AgentExecutionInput {
  agent_id: string;
  user_id: string;
  input: any;

  // Agent details
  agent_name: string;
  agent_description: string;
  agent_mode?: string;
  system_prompt?: string; // Original system prompt

  // Optional overrides
  skip_memory?: boolean; // Disable memory for this execution
}

export interface AgentExecutionResult {
  output: any;
  execution_id: string;
  model_used: string;
  credits_consumed: number;
  execution_time_ms: number;
  ais_score?: number;
  status: 'success' | 'failed' | 'error';
  error_logs?: string;

  // Memory metadata
  memory_injected: boolean;
  memory_token_count: number;
  run_number: number;
}

/**
 * Memory-Enhanced Agent Execution Service
 *
 * This service wraps agent execution to:
 * 1. Load memory context before execution (MemoryInjector)
 * 2. Inject memory into system prompt
 * 3. Execute agent with enhanced context
 * 4. Trigger async memory summarization after execution (MemorySummarizer)
 *
 * INTEGRATION POINT: Use this service instead of direct agent execution
 */
export class MemoryEnhancedExecution {
  private injector: MemoryInjector;
  private summarizer: MemorySummarizer;

  constructor(
    private supabase: SupabaseClient,
    openaiApiKey?: string
  ) {
    this.injector = new MemoryInjector(supabase);
    // MemorySummarizer uses service role client internally for RLS bypass
    this.summarizer = new MemorySummarizer(openaiApiKey);
  }

  /**
   * Execute agent with memory enhancement
   *
   * Call this method for ALL agent executions to enable memory system
   *
   * @param input - Execution input
   * @param executeAgentFn - Your existing agent execution function
   * @returns Enhanced execution result
   */
  async executeWithMemory(
    input: AgentExecutionInput,
    executeAgentFn: (enhancedPrompt: string, model: ModelSelection) => Promise<any>
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    try {
      console.log(`🚀 [MemoryEnhanced] Starting execution for agent ${input.agent_id}`);

      // 1. Get next run number
      const runNumber = await this.injector.getNextRunNumber(input.agent_id);

      // 2. Select model using ModelRouter (this handles AIS routing)
      const modelSelection = await ModelRouter.selectModel(
        input.agent_id,
        this.supabase,
        input.user_id
      );

      console.log(`🎯 [MemoryEnhanced] Model selected: ${modelSelection.model} (${modelSelection.reasoning})`);

      // 3. Load memory context (unless disabled)
      let memoryContext;
      let enhancedPrompt = input.system_prompt || '';

      if (!input.skip_memory) {
        memoryContext = await this.injector.buildMemoryContext(
          input.agent_id,
          input.user_id,
          input.input
        );

        // 4. Inject memory into system prompt
        const memoryPrompt = this.injector.formatForPrompt(memoryContext);
        enhancedPrompt = `${input.system_prompt || ''}\n\n${memoryPrompt}`;

        console.log(`🧠 [MemoryEnhanced] Memory injected: ${memoryContext.token_count} tokens`);
      } else {
        console.log(`⏭️ [MemoryEnhanced] Memory skipped for this execution`);
      }

      // 5. Execute agent with enhanced prompt
      console.log(`⚡ [MemoryEnhanced] Executing agent...`);
      const result = await executeAgentFn(enhancedPrompt, modelSelection);

      const executionTimeMs = Date.now() - startTime;

      // 6. Build execution result
      const executionResult: AgentExecutionResult = {
        output: result.output || result,
        execution_id: result.execution_id || this.generateExecutionId(),
        model_used: modelSelection.model,
        credits_consumed: result.credits_consumed || 0,
        execution_time_ms: executionTimeMs,
        ais_score: modelSelection.intensity_score,
        status: result.status || 'success',
        error_logs: result.error_logs || null,

        memory_injected: !input.skip_memory,
        memory_token_count: memoryContext?.token_count || 0,
        run_number: runNumber
      };

      console.log(`✅ [MemoryEnhanced] Execution completed in ${executionTimeMs}ms`);

      // 7. Trigger async memory summarization (fire-and-forget)
      if (!input.skip_memory) {
        this.summarizeAsync(input, executionResult).catch(err => {
          console.error('❌ [MemoryEnhanced] Async summarization failed (non-critical):', err);
        });
      }

      return executionResult;
    } catch (error) {
      console.error('❌ [MemoryEnhanced] Execution failed:', error);

      return {
        output: null,
        execution_id: this.generateExecutionId(),
        model_used: 'unknown',
        credits_consumed: 0,
        execution_time_ms: Date.now() - startTime,
        status: 'error',
        error_logs: error instanceof Error ? error.message : 'Unknown error',

        memory_injected: false,
        memory_token_count: 0,
        run_number: 0
      };
    }
  }

  /**
   * Async memory summarization (runs in background)
   *
   * @private
   */
  private async summarizeAsync(
    input: AgentExecutionInput,
    result: AgentExecutionResult
  ): Promise<void> {
    try {
      // Get recent runs for comparison context
      const recentRuns = await this.injector.getRecentRunsForSummarization(
        input.agent_id,
        5
      );

      const summarizationInput: SummarizationInput = {
        execution_id: result.execution_id,
        agent_id: input.agent_id,
        user_id: input.user_id,
        run_number: result.run_number,

        agent_name: input.agent_name,
        agent_description: input.agent_description,
        agent_mode: input.agent_mode,

        input: input.input,
        output: result.output,
        status: result.status,
        model_used: result.model_used,
        credits_consumed: result.credits_consumed,
        execution_time_ms: result.execution_time_ms,
        ais_score: result.ais_score,
        error_logs: result.error_logs,

        recent_runs: recentRuns
      };

      await this.summarizer.summarizeExecution(summarizationInput);

      console.log(`✅ [MemoryEnhanced] Async summarization completed for run #${result.run_number}`);
    } catch (error) {
      console.error('❌ [MemoryEnhanced] Async summarization error:', error);
      // Don't throw - this is background processing
    }
  }

  /**
   * Generate execution ID
   *
   * @private
   */
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Get memory statistics for an agent (useful for UI/monitoring)
   */
  async getAgentMemoryStats(agentId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('agent_memory_stats')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    if (error) {
      console.error('❌ [MemoryEnhanced] Error fetching memory stats:', error);
      return null;
    }

    return data;
  }

  /**
   * Get recent run memories for display in UI
   */
  async getRecentMemories(agentId: string, limit: number = 10): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('run_memories')
      .select('*')
      .eq('agent_id', agentId)
      .order('run_timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('❌ [MemoryEnhanced] Error fetching recent memories:', error);
      return [];
    }

    return data || [];
  }
}

/**
 * USAGE EXAMPLE:
 *
 * import { MemoryEnhancedExecution } from '@/lib/memory/MemoryEnhancedExecution';
 * import { createClient } from '@supabase/supabase-js';
 *
 * const supabase = createClient(...);
 * const memoryService = new MemoryEnhancedExecution(supabase);
 *
 * // Your existing agent execution function
 * async function executeMyAgent(prompt: string, model: ModelSelection) {
 *   // Call OpenAI, Anthropic, or your agent framework
 *   const response = await openai.chat.completions.create({
 *     model: model.model,
 *     messages: [{ role: 'system', content: prompt }, ...]
 *   });
 *   return response;
 * }
 *
 * // Execute with memory
 * const result = await memoryService.executeWithMemory(
 *   {
 *     agent_id: 'agent-123',
 *     user_id: 'user-456',
 *     input: { task: 'Send email to john@example.com' },
 *     agent_name: 'Email Agent',
 *     agent_description: 'Sends emails on behalf of user',
 *     system_prompt: 'You are an email sending assistant...'
 *   },
 *   executeMyAgent
 * );
 *
 * console.log('Agent output:', result.output);
 * console.log('Memory injected:', result.memory_token_count, 'tokens');
 * console.log('Model used:', result.model_used);
 */
