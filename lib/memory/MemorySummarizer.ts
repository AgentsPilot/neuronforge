// lib/memory/MemorySummarizer.ts
// Async LLM-based memory summarization service

import { createClient } from '@supabase/supabase-js';
import { ProviderFactory, PROVIDERS } from '@/lib/ai/providerFactory';
import { OPENAI_MODELS } from '@/lib/ai/providers/openaiProvider';
import type { CallContext } from '@/lib/ai/providers/baseProvider';
import { MemoryConfigService } from './MemoryConfigService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'MemorySummarizer' });

/**
 * How many times an insert may be renumbered before the memory is given up on.
 *
 * `get_next_run_number` hands out a number and releases its advisory lock
 * before the caller inserts, so two summarizations for the same agent can be
 * handed the same one and the loser gets 23505 on
 * `run_memories_agent_id_run_number_key`. Five attempts covers far more
 * concurrent writers than the three call sites can produce.
 */
const MAX_RUN_NUMBER_ATTEMPTS = 5;

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

export interface SummarizationInput {
  execution_id: string;
  agent_id: string;
  user_id: string;
  run_number: number;

  // Agent context
  agent_name: string;
  agent_description: string;
  agent_mode?: string;

  // Execution data
  input: any;
  output: any;
  status: 'success' | 'failed' | 'error';
  model_used: string;
  credits_consumed: number;
  execution_time_ms: number;
  ais_score?: number;
  error_logs?: string;

  // Recent history for comparison
  recent_runs?: Array<{
    run_number: number;
    summary: string;
    key_outcomes: any;
    patterns_detected: any;
  }>;

  user_feedback?: string;
}

export interface RunMemory {
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  key_outcomes: {
    success: boolean;
    items_processed?: number;
    errors?: string[];
    warnings?: string[];
  };
  patterns_detected: {
    recurring_error?: string;
    success_pattern?: string;
    performance_issue?: string;
  };
  suggestions: {
    improve_prompt?: string;
    adjust_schedule?: string;
    optimize_config?: string;
  };
}

/**
 * Memory Summarization Service
 *
 * Uses LLM (gpt-4o-mini) to create concise, structured memories from executions
 * Runs asynchronously to avoid blocking user-facing responses
 */
export class MemorySummarizer {
  private supabase: any;
  private auditTrail: AuditTrailService;

  constructor(_openaiApiKey?: string) { // Deprecated: ProviderFactory handles API keys
    // Use service role client to bypass RLS policies for memory storage
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // ProviderFactory handles LLM client initialization and token tracking - no direct SDK instantiation needed
    this.auditTrail = AuditTrailService.getInstance();
  }

  /**
   * Summarize an execution and save to run_memories table
   *
   * This is the main entry point - call this after agent execution completes
   *
   * @returns Token usage from memory summarization {prompt, completion, total}
   */
  async summarizeExecution(input: SummarizationInput): Promise<{ tokensUsed: { prompt: number; completion: number; total: number } }> {
    // Initialize token tracking
    let tokensUsed = { prompt: 0, completion: 0, total: 0 };

    try {
      logger.info({ executionId: input.execution_id, agentId: input.agent_id }, 'Starting summarization');

      // Audit: Summarization started
      await this.auditTrail.log({
        action: AUDIT_EVENTS.MEMORY_SUMMARIZATION_STARTED,
        entityType: 'agent',
        entityId: input.agent_id,
        userId: input.user_id,
        resourceName: input.agent_name,
        details: {
          execution_id: input.execution_id,
          run_number: input.run_number,
          model: input.model_used,
          status: input.status
        },
        severity: 'info'
      });

      // 1. Load configuration from database
      const config = await MemoryConfigService.getSummarizationConfig(this.supabase);
      const importanceConfig = await MemoryConfigService.getImportanceConfig(this.supabase);

      // 2. Build summarization prompt with dynamic truncation
      const prompt = this.buildSummarizationPrompt(input, config);

      // 3. Call LLM to generate memory via ProviderFactory (handles token tracking)
      logger.info({ model: config.model }, 'Calling model for summarization');
      const startTime = Date.now();

      // Get provider from factory for centralized token tracking
      const provider = ProviderFactory.getProvider(PROVIDERS.OPENAI);
      const llmContext: CallContext = {
        userId: input.user_id,
        feature: 'memory_system',
        component: 'MemorySummarizer',
        category: 'memory_creation',
        activity_type: 'memory_summarization',
        activity_name: 'summarize_execution',
      };

      const completion = await provider.chatCompletion({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        response_format: { type: 'json_object' }
      }, llmContext);

      const latency = Date.now() - startTime;

      // Token tracking is now handled automatically by ProviderFactory
      // Just extract usage for local logging
      const usage = completion.usage;
      if (usage) {
        tokensUsed = {
          prompt: usage.prompt_tokens || 0,
          completion: usage.completion_tokens || 0,
          total: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)
        };
        logger.info({ tokensUsed, latencyMs: latency }, 'Summarization token usage');
      }

      // ProviderFactory returns OpenAI-compatible format
      const memoryJson = completion.choices?.[0]?.message?.content;
      if (!memoryJson) {
        throw new Error('Empty response from LLM');
      }

      const memory: RunMemory = JSON.parse(memoryJson);

      // Ensure patterns_detected and suggestions are objects (LLM might return null)
      if (!memory.patterns_detected || typeof memory.patterns_detected !== 'object') {
        memory.patterns_detected = {};
      }
      if (!memory.suggestions || typeof memory.suggestions !== 'object') {
        memory.suggestions = {};
      }

      // Ensure sentiment is valid (fallback to neutral if invalid/missing)
      const validSentiments = ['positive', 'neutral', 'negative', 'mixed'];
      if (!memory.sentiment || !validSentiments.includes(memory.sentiment)) {
        memory.sentiment = 'neutral';
      }

      logger.info({
        summaryLength: memory.summary.length,
        sentiment: memory.sentiment,
        hasPatterns: Object.keys(memory.patterns_detected).length > 0,
        hasSuggestions: Object.keys(memory.suggestions).length > 0
      }, 'Memory generated');

      // 4. Calculate importance score
      const importanceScore = this.calculateImportance(memory, input, importanceConfig);

      // 5. Save to database and get memory ID
      const memoryId = await this.saveMemory(input, memory, importanceScore);

      logger.debug({ executionId: input.execution_id, memoryId }, 'Memory saved, generating embedding');

      // 6. Generate embedding immediately (async, non-blocking)
      this.generateEmbeddingAsync(memoryId, memory).catch((err) => {
        logger.error({ err, memoryId }, 'Embedding generation failed (non-critical)');
      });

      // Audit: Memory created successfully
      await this.auditTrail.log({
        action: AUDIT_EVENTS.MEMORY_SUMMARIZATION_COMPLETED,
        entityType: 'agent',
        entityId: input.agent_id,
        userId: input.user_id,
        resourceName: input.agent_name,
        details: {
          execution_id: input.execution_id,
          run_number: input.run_number,
          sentiment: memory.sentiment,
          importance_score: importanceScore,
          has_patterns: Object.keys(memory.patterns_detected || {}).length > 0,
          has_suggestions: Object.keys(memory.suggestions || {}).length > 0,
          summary_length: memory.summary.length,
          token_count: this.estimateTokens(memory.summary)
        },
        severity: 'info'
      });

      // Audit: Sentiment detected (if not neutral)
      if (memory.sentiment && memory.sentiment !== 'neutral') {
        await this.auditTrail.log({
          action: AUDIT_EVENTS.MEMORY_SENTIMENT_DETECTED,
          entityType: 'agent',
          entityId: input.agent_id,
          userId: input.user_id,
          resourceName: input.agent_name,
          details: {
            execution_id: input.execution_id,
            run_number: input.run_number,
            sentiment: memory.sentiment,
            success: memory.key_outcomes.success,
            errors: memory.key_outcomes.errors
          },
          severity: memory.sentiment === 'negative' ? 'warning' : 'info'
        });
      }

      // Audit: Pattern detected
      if (memory.patterns_detected.recurring_error || memory.patterns_detected.performance_issue) {
        await this.auditTrail.log({
          action: AUDIT_EVENTS.MEMORY_PATTERN_DETECTED,
          entityType: 'agent',
          entityId: input.agent_id,
          userId: input.user_id,
          resourceName: input.agent_name,
          details: {
            execution_id: input.execution_id,
            run_number: input.run_number,
            recurring_error: memory.patterns_detected.recurring_error,
            performance_issue: memory.patterns_detected.performance_issue
          },
          severity: 'warning'
        });
      }

      // Return token usage for tracking
      return { tokensUsed };
    } catch (error) {
      logger.error({ err: error, agentId: input.agent_id, executionId: input.execution_id }, 'Error summarizing execution');

      // Audit: Memory summarization failed
      await this.auditTrail.log({
        action: AUDIT_EVENTS.MEMORY_SUMMARIZATION_FAILED,
        entityType: 'agent',
        entityId: input.agent_id,
        userId: input.user_id,
        resourceName: input.agent_name,
        details: {
          execution_id: input.execution_id,
          run_number: input.run_number,
          error: error instanceof Error ? error.message : 'Unknown error'
        },
        severity: 'critical'
      });

      // Return zero tokens on error (don't throw - summarization failures should not break execution)
      return { tokensUsed };
    }
  }

  /**
   * Build the LLM prompt for memory creation
   *
   * @private
   */
  private buildSummarizationPrompt(input: SummarizationInput, config: any): string {
    // ✅ OPTIMIZED: Use config to control history truncation
    // Get truncation limits from config (with fallback defaults)
    const inputTruncate = config.input_truncate_chars || 300;
    const outputTruncate = config.output_truncate_chars || 400;
    const historyCount = config.recent_history_count !== undefined ? config.recent_history_count : 2;
    const historySummaryChars = config.recent_history_summary_chars || 100;

    // Build recent history context with configured truncation
    const recentContext = input.recent_runs
      ?.slice(-historyCount) // Use configured count (0 = no history)
      ?.map((r) => `Run ${r.run_number}: ${r.summary.substring(0, historySummaryChars)}... [${r.key_outcomes.success ? 'OK' : 'FAIL'}]`)
      .join('\n') || 'No history';

    // ✅ OPTIMIZED: Condensed prompt - removed verbose examples and guidelines
    return `Summarize this agent execution. Return JSON only.

Agent: ${input.agent_name}
Recent: ${recentContext}

Execution:
Status: ${input.status}
Credits: ${input.credits_consumed} | Time: ${input.execution_time_ms}ms
Input: ${JSON.stringify(input.input).substring(0, inputTruncate)}
Output: ${JSON.stringify(input.output).substring(0, outputTruncate)}
${input.error_logs ? `Errors: ${input.error_logs.substring(0, 200)}` : ''}

Return JSON:
{
  "summary": "2-3 sentences highlighting key outcomes and changes",
  "sentiment": "positive|neutral|negative|mixed",
  "key_outcomes": {
    "success": boolean,
    "items_processed": number|null,
    "errors": [string]|null,
    "warnings": [string]|null
  },
  "patterns_detected": {
    "recurring_error": "description"|null,
    "success_pattern": "description"|null,
    "performance_issue": "description"|null
  },
  "suggestions": {
    "improve_prompt": "specific"|null,
    "adjust_schedule": "specific"|null,
    "optimize_config": "specific"|null
  }
}

Rules: All objects required (never null). Only fields can be null. Be specific and concise.

Good (pattern detected):
{
  "summary": "Gmail API rate limit error (429) occurred for 3rd consecutive weekend run. Pattern: high user activity weekends trigger rate limiting.",
  "sentiment": "negative",
  "key_outcomes": {"success": false, "items_processed": 0, "errors": ["Gmail API 429"], "warnings": null},
  "patterns_detected": {"recurring_error": "Weekend rate limiting (3 consecutive occurrences)", "success_pattern": null, "performance_issue": null},
  "suggestions": {"improve_prompt": null, "adjust_schedule": "Move weekend runs to off-peak hours (early morning)", "optimize_config": null}
}

Good (improvement):
{
  "summary": "Newsletter filtering (from Run 1 suggestion) reduced processing time 8.3s→4.1s (50% faster). Relevant emails: 47→31.",
  "sentiment": "positive",
  "key_outcomes": {"success": true, "items_processed": 31, "errors": null, "warnings": null},
  "patterns_detected": {"recurring_error": null, "success_pattern": "Newsletter filtering effective (16 items filtered)", "performance_issue": null},
  "suggestions": {"improve_prompt": null, "adjust_schedule": null, "optimize_config": null}
}

Bad (too verbose):
"The agent executed at 9 AM and connected to Gmail successfully. Retrieved emails..."

Response (JSON only):`;
  }

  /**
   * Calculate importance score (1-10) based on memory content
   *
   * @private
   */
  private calculateImportance(
    memory: RunMemory,
    input: SummarizationInput,
    config: any
  ): number {
    let score = config.base_score || 5;

    // Errors are important (learn from failures)
    if (!memory.key_outcomes.success) {
      score += config.error_bonus || 2;
    }

    // Patterns are very important
    if (memory.patterns_detected.recurring_error) {
      score += config.pattern_bonus || 2;
    }
    if (memory.patterns_detected.success_pattern) {
      score += 1;
    }
    if (memory.patterns_detected.performance_issue) {
      score += 1;
    }

    // User feedback is critical
    if (input.user_feedback) {
      score += config.user_feedback_bonus || 3;
    }

    // Suggestions indicate actionable insights
    const hasSuggestions = Object.values(memory.suggestions).some(v => v !== null);
    if (hasSuggestions) {
      score += 1;
    }

    // Reduce for routine success
    if (memory.key_outcomes.success && !memory.patterns_detected.recurring_error) {
      score -= 1;
    }

    // Milestone runs
    if (input.run_number === 1) {
      score += config.first_run_bonus || 2; // First run always important
    }
    if (input.run_number % 10 === 0) {
      score += config.milestone_bonus || 1; // Every 10th run
    }

    return Math.max(1, Math.min(10, score));
  }

  /**
   * Save memory to database
   *
   * @private
   * @returns The ID of the created memory record
   */
  private async saveMemory(
    input: SummarizationInput,
    memory: RunMemory,
    importanceScore: number
  ): Promise<string> {
    const tokenCount = this.estimateTokens(memory.summary);

    // Numbering and insert are two round trips, and `get_next_run_number`
    // releases its advisory lock before it returns — so between the two, a
    // concurrent summarization for the same agent can be handed the same
    // number and one of the inserts loses on
    // run_memories_agent_id_run_number_key (23505). Three call sites fire
    // summarization fire-and-forget (WorkflowPilot execute and resume,
    // runAgentKit), so this happens in production.
    //
    // Migration 20261106 renumbers a colliding row inside the database, where
    // the lock is still held at commit. This retry is what keeps the memory
    // until that migration is applied, and costs nothing once it is.
    let lastError: any = null;

    for (let attempt = 1; attempt <= MAX_RUN_NUMBER_ATTEMPTS; attempt++) {
      const runNumber = await this.nextRunNumber(input.agent_id);

      const { data, error } = await this.supabase
        .from('run_memories')
        .insert({
          agent_id: input.agent_id,
          user_id: input.user_id,
          execution_id: input.execution_id,
          run_number: runNumber,
          run_timestamp: new Date().toISOString(),

          summary: memory.summary,
          sentiment: memory.sentiment,
          key_outcomes: memory.key_outcomes,
          patterns_detected: memory.patterns_detected,
          suggestions: memory.suggestions,
          user_feedback: input.user_feedback || null,

          importance_score: Math.floor(importanceScore),
          memory_type: 'run',
          token_count: tokenCount,

          model_used: input.model_used,
          credits_consumed: input.credits_consumed,
          execution_time_ms: input.execution_time_ms ? Math.floor(Number(input.execution_time_ms)) : null,
          ais_score: input.ais_score ? Math.floor(Number(input.ais_score)) : null,

          // Embedding will be generated immediately after save
          embedding: null
        })
        .select('id, run_number')
        .single();

      if (!error) {
        logger.info(
          {
            agentId: input.agent_id,
            executionId: input.execution_id,
            // What the row actually got: 20261106's trigger may have renumbered it
            runNumber: data.run_number ?? runNumber,
            requestedRunNumber: runNumber,
            memoryId: data.id,
            attempt
          },
          'Memory saved'
        );
        return data.id;
      }

      lastError = error;

      if (error?.code !== UNIQUE_VIOLATION) {
        logger.error(
          {
            err: error,
            errorCode: error?.code,
            errorDetails: error?.details,
            errorHint: error?.hint,
            agentId: input.agent_id,
            userId: input.user_id,
            executionId: input.execution_id,
            runNumber
          },
          'Error saving memory to database'
        );
        throw error;
      }

      logger.warn(
        {
          errorCode: error.code,
          errorDetails: error.details,
          agentId: input.agent_id,
          executionId: input.execution_id,
          runNumber,
          attempt,
          maxAttempts: MAX_RUN_NUMBER_ATTEMPTS
        },
        'run_number was taken by a concurrent summarization, renumbering'
      );

      // Jittered, so two writers that collided do not collide again in step
      await new Promise(resolve => setTimeout(resolve, 50 + Math.floor(Math.random() * 200)));
    }

    logger.error(
      {
        err: lastError,
        errorCode: lastError?.code,
        errorDetails: lastError?.details,
        agentId: input.agent_id,
        userId: input.user_id,
        executionId: input.execution_id,
        attempts: MAX_RUN_NUMBER_ATTEMPTS
      },
      'Error saving memory to database: run_number still taken after every attempt'
    );
    throw lastError;
  }

  /**
   * Ask the database for this agent's next run_number.
   *
   * Advisory only. The answer can be stale by the time the insert lands (see
   * `saveMemory`), which is why the caller retries and why migration 20261106
   * has the final say inside the insert's own transaction.
   *
   * @private
   */
  private async nextRunNumber(agentId: string): Promise<number> {
    const { data, error } = await this.supabase
      .rpc('get_next_run_number', { p_agent_id: agentId });

    if (error) {
      logger.error({ err: error, agentId }, 'Error getting next run_number');
      throw error;
    }

    // Supabase RPC may return it as various types
    const runNumber = Math.floor(Number(data));
    logger.debug({ agentId, runNumber }, 'Got next run_number');
    return runNumber;
  }

  /**
   * Estimate token count (rough approximation)
   *
   * @private
   */
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate cost for LLM call using centralized pricing service
   *
   * @private
   */
  private async calculateCost(model: string, inputTokens: number, outputTokens: number): Promise<number> {
    try {
      // Import centralized pricing service
      const { calculateCost } = await import('@/lib/ai/pricing');

      // Determine provider from model name
      let provider = 'openai'; // Default
      if (model.includes('claude')) {
        provider = 'anthropic';
      } else if (model.includes('gemini')) {
        provider = 'google';
      }

      // Use centralized pricing service (queries ai_model_pricing table with caching)
      const cost = await calculateCost(provider, model, inputTokens, outputTokens);

      // If centralized service returns 0 (no pricing found), use fallback
      if (cost === 0) {
        // Fallback: gpt-4o-mini pricing ($0.15/M input, $0.60/M output)
        return ((inputTokens / 1000000) * 0.15) + ((outputTokens / 1000000) * 0.60);
      }

      return cost;
    } catch (error) {
      logger.error({ err: error, model }, 'Error calculating cost');
      // Fallback on error: gpt-4o-mini pricing
      return ((inputTokens / 1000000) * 0.15) + ((outputTokens / 1000000) * 0.60);
    }
  }

  /**
   * Generate embeddings in batch for multiple memories (uses batch_size config)
   */
  async generateEmbeddingsBatch(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) {
      return;
    }

    try {
      logger.info({ memoryCount: memoryIds.length }, 'Generating embeddings in batch');

      // Load config
      const config = await MemoryConfigService.getEmbeddingConfig(this.supabase);
      const batchSize = config.batch_size || 100;

      // Process in batches
      for (let i = 0; i < memoryIds.length; i += batchSize) {
        const batch = memoryIds.slice(i, Math.min(i + batchSize, memoryIds.length));

        // Fetch batch of memories
        const { data: memories, error: fetchError } = await this.supabase
          .from('run_memories')
          .select('id, summary, key_outcomes, patterns_detected')
          .in('id', batch);

        if (fetchError || !memories) {
          logger.error({ err: fetchError }, 'Error fetching memories batch');
          continue;
        }

        // Build texts for batch embedding
        const texts = memories.map(m =>
          `${m.summary} ${JSON.stringify(m.key_outcomes)} ${JSON.stringify(m.patterns_detected)}`
        );

        // Get provider from factory for centralized token tracking
        const provider = ProviderFactory.getProvider(PROVIDERS.OPENAI);
        const embeddingContext: CallContext = {
          userId: 'system',
          feature: 'memory_system',
          component: 'MemorySummarizer',
          category: 'embedding_generation',
          activity_type: 'batch_embedding',
          activity_name: 'generate_embeddings_batch',
        };

        // Generate embeddings in batch with retry logic
        let response;
        const maxRetries = 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            response = await provider.createEmbedding({
              model: config.model,
              input: texts
            }, embeddingContext);
            break; // Success - exit retry loop
          } catch (error: any) {
            lastError = error;
            if (attempt < maxRetries) {
              const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
              logger.warn({ attempt, maxRetries, delayMs }, 'Embedding API error, retrying');
              await new Promise(resolve => setTimeout(resolve, delayMs));
            } else {
              logger.error({ err: error, maxRetries }, 'Failed to generate embeddings after every attempt');
              throw error;
            }
          }
        }

        if (!response) {
          throw lastError || new Error('Failed to generate embeddings');
        }

        // Validate dimensions
        const expectedDimensions = config.dimensions || 1536;
        if (response.data[0].embedding.length !== expectedDimensions) {
          logger.warn(
            {
              expectedDimensions,
              actualDimensions: response.data[0].embedding.length,
              model: config.model
            },
            'Embedding dimension mismatch, update the memory_embedding_dimensions config to match the model'
          );
        }

        // Save embeddings to database in a single batch upsert
        // This eliminates N+1 query problem (was doing 100 individual updates)
        const updates = memories.map((m: any, idx: any) => ({
          id: m.id,
          embedding: response.data[idx].embedding
        }));

        const { error: batchUpdateError } = await this.supabase
          .from('run_memories')
          .upsert(updates, {
            onConflict: 'id',
            ignoreDuplicates: false
          });

        if (batchUpdateError) {
          logger.error({ err: batchUpdateError }, 'Error saving batch embeddings');
          throw batchUpdateError;
        }

        logger.info({ batchNumber: i / batchSize + 1, generated: batch.length }, 'Batch embeddings generated');
      }

      logger.info({ total: memoryIds.length }, 'Batch embedding complete');
    } catch (error) {
      logger.error({ err: error }, 'Error in batch embedding generation');
      throw error;
    }
  }

  /**
   * Generate embedding for existing memory (can be called in batch)
   */
  async generateEmbedding(memoryId: string): Promise<void> {
    try {
      // Get memory text
      const { data: memory, error: fetchError } = await this.supabase
        .from('run_memories')
        .select('summary, key_outcomes, patterns_detected')
        .eq('id', memoryId)
        .single();

      if (fetchError || !memory) {
        logger.error({ err: fetchError, memoryId }, 'Memory not found');
        return;
      }

      // Build text for embedding
      const embeddingText = `${memory.summary} ${JSON.stringify(memory.key_outcomes)} ${JSON.stringify(memory.patterns_detected)}`;

      // Load config
      const config = await MemoryConfigService.getEmbeddingConfig(this.supabase);

      // Get provider from factory for centralized token tracking
      const provider = ProviderFactory.getProvider(PROVIDERS.OPENAI);
      const embeddingContext: CallContext = {
        userId: 'system',
        feature: 'memory_system',
        component: 'MemorySummarizer',
        category: 'embedding_generation',
        activity_type: 'single_embedding',
        activity_name: 'generate_embedding',
      };

      // Generate embedding with retry logic
      let response;
      const maxRetries = 3;
      let lastError;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await provider.createEmbedding({
            model: config.model,
            input: embeddingText
          }, embeddingContext);
          break; // Success - exit retry loop
        } catch (error: any) {
          lastError = error;
          if (attempt < maxRetries) {
            const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
            logger.warn({ attempt, maxRetries, delayMs }, 'Embedding API error, retrying');
            await new Promise(resolve => setTimeout(resolve, delayMs));
          } else {
            logger.error({ err: error, maxRetries }, 'Failed to generate embedding after every attempt');
            throw error;
          }
        }
      }

      if (!response) {
        throw lastError || new Error('Failed to generate embedding');
      }

      const embedding = response.data[0].embedding;

      // Validate dimensions
      const expectedDimensions = config.dimensions || 1536;
      if (embedding.length !== expectedDimensions) {
        logger.warn(
          {
            expectedDimensions,
            actualDimensions: embedding.length,
            model: config.model
          },
          'Embedding dimension mismatch, update the memory_embedding_dimensions config to match the model'
        );
      }

      // Save to database
      const { error: updateError } = await this.supabase
        .from('run_memories')
        .update({ embedding })
        .eq('id', memoryId);

      if (updateError) {
        logger.error({ err: updateError, memoryId }, 'Error saving embedding');
      } else {
        logger.info({ memoryId }, 'Embedding generated');
      }
    } catch (error) {
      logger.error({ err: error, memoryId }, 'Error generating embedding');
    }
  }

  /**
   * Generate embedding immediately after memory creation (async, non-blocking)
   * Optimized version that doesn't need to re-fetch the memory
   *
   * @private
   */
  private async generateEmbeddingAsync(memoryId: string, memory: RunMemory): Promise<void> {
    try {
      logger.debug({ memoryId }, 'Generating embedding');

      // Build text for embedding
      const embeddingText = `${memory.summary} ${JSON.stringify(memory.key_outcomes)} ${JSON.stringify(memory.patterns_detected)}`;

      // Load config
      const config = await MemoryConfigService.getEmbeddingConfig(this.supabase);

      // Get provider from factory for centralized token tracking
      const provider = ProviderFactory.getProvider(PROVIDERS.OPENAI);
      const embeddingContext: CallContext = {
        userId: 'system',
        feature: 'memory_system',
        component: 'MemorySummarizer',
        category: 'embedding_generation',
        activity_type: 'async_embedding',
        activity_name: 'generate_embedding_async',
      };

      // Generate embedding with retry logic
      let response;
      const maxRetries = 3;
      let lastError;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await provider.createEmbedding({
            model: config.model,
            input: embeddingText
          }, embeddingContext);
          break; // Success - exit retry loop
        } catch (error: any) {
          lastError = error;
          if (attempt < maxRetries) {
            const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
            logger.warn({ attempt, maxRetries, delayMs }, 'Embedding API error, retrying');
            await new Promise(resolve => setTimeout(resolve, delayMs));
          } else {
            logger.error({ err: error, maxRetries }, 'Failed to generate embedding after every attempt');
            throw error;
          }
        }
      }

      if (!response) {
        throw lastError || new Error('Failed to generate embedding');
      }

      const embedding = response.data[0].embedding;

      // Validate dimensions
      const expectedDimensions = config.dimensions || 1536;
      if (embedding.length !== expectedDimensions) {
        logger.warn(
          {
            expectedDimensions,
            actualDimensions: embedding.length,
            model: config.model
          },
          'Embedding dimension mismatch, update the memory_embedding_dimensions config to match the model'
        );
      }

      // Save to database
      const { error: updateError } = await this.supabase
        .from('run_memories')
        .update({ embedding })
        .eq('id', memoryId);

      if (updateError) {
        logger.error({ err: updateError, memoryId }, 'Error saving embedding');
      } else {
        logger.info({ memoryId }, 'Embedding generated');
      }
    } catch (error) {
      logger.error({ err: error, memoryId }, 'Error generating embedding');
      throw error;
    }
  }
}
