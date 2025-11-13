// lib/memory/MemorySummarizer.ts
// Async LLM-based memory summarization service

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { MemoryConfigService } from './MemoryConfigService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';

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
  private openai: OpenAI;
  private auditTrail: AuditTrailService;
  private analytics: AIAnalyticsService;

  constructor(openaiApiKey?: string) {
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

    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY
    });
    this.auditTrail = AuditTrailService.getInstance();
    this.analytics = new AIAnalyticsService(this.supabase);
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
      console.log(`🧠 [MemorySummarizer] Starting summarization for execution ${input.execution_id}`);

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

      // 3. Call LLM to generate memory
      console.log(`🤖 [MemorySummarizer] Calling ${config.model} for summarization...`);
      const startTime = Date.now();

      const completion = await this.openai.chat.completions.create({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        response_format: { type: 'json_object' }
      });

      const latency = Date.now() - startTime;

      // Track LLM call analytics and capture token usage
      const usage = completion.usage;
      if (usage) {
        tokensUsed = {
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens
        };
        console.log(`📊 [MemorySummarizer] Token usage:`, tokensUsed);
        const cost = await this.calculateCost(config.model, usage.prompt_tokens, usage.completion_tokens);
        await this.analytics.trackAICall({
          user_id: input.user_id,
          provider: 'openai',
          model_name: config.model,
          input_tokens: usage.prompt_tokens,
          output_tokens: usage.completion_tokens,
          cost_usd: cost,
          latency_ms: latency,
          success: true,
          feature: 'memory_system',
          component: 'memory_summarizer',
          activity_type: 'memory_creation',
          activity_name: 'summarize_execution',
          agent_id: input.agent_id,
          session_id: input.execution_id,
          metadata: {
            run_number: input.run_number,
            agent_name: input.agent_name,
            execution_status: input.status,
            temperature: config.temperature,
            max_tokens: config.max_tokens
          }
        });
      }

      const memoryJson = completion.choices[0].message.content;
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

      console.log(`✅ [MemorySummarizer] Memory generated:`, {
        summary_length: memory.summary.length,
        sentiment: memory.sentiment,
        has_patterns: Object.keys(memory.patterns_detected).length > 0,
        has_suggestions: Object.keys(memory.suggestions).length > 0
      });

      // 4. Calculate importance score
      const importanceScore = this.calculateImportance(memory, input, importanceConfig);

      // 5. Save to database and get memory ID
      const memoryId = await this.saveMemory(input, memory, importanceScore);

      console.log(`💾 [MemorySummarizer] Memory saved for run #${input.run_number}`);

      // 6. Generate embedding immediately (async, non-blocking)
      this.generateEmbeddingAsync(memoryId, memory).catch((err) => {
        console.error(`⚠️  [MemorySummarizer] Embedding generation failed (non-critical):`, err);
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
      console.error(`❌ [MemorySummarizer] Error summarizing execution:`, error);

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

    // Retry logic to handle race conditions with run_number
    const maxRetries = 5;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Calculate run_number atomically right before insert to minimize race window
      const { data: maxRunData } = await this.supabase
        .from('run_memories')
        .select('run_number')
        .eq('agent_id', input.agent_id)
        .order('run_number', { ascending: false })
        .limit(1);

      const runNumber = (maxRunData && maxRunData.length > 0 ? maxRunData[0].run_number : 0) + 1;

      console.log(`📊 [MemorySummarizer] Attempt ${attempt}/${maxRetries}: Calculated run_number=${runNumber} (previous max: ${maxRunData?.[0]?.run_number || 0})`);

      const { data, error } = await this.supabase
        .from('run_memories')
        .insert({
          agent_id: input.agent_id,
          user_id: input.user_id,
          execution_id: input.execution_id,
          run_number: runNumber, // Use freshly calculated run_number
          run_timestamp: new Date().toISOString(),

          summary: memory.summary,
          sentiment: memory.sentiment,
          key_outcomes: memory.key_outcomes,
          patterns_detected: memory.patterns_detected,
          suggestions: memory.suggestions,
          user_feedback: input.user_feedback || null,

          importance_score: importanceScore,
          memory_type: 'run',
          token_count: tokenCount,

          model_used: input.model_used,
          credits_consumed: input.credits_consumed,
          execution_time_ms: input.execution_time_ms,
          ais_score: input.ais_score || null,

          // Embedding will be generated immediately after save
          embedding: null
        })
        .select('id')
        .single();

      // Success - exit retry loop and return ID
      if (!error && data) {
        console.log(`✅ [MemorySummarizer] Memory saved successfully with run_number=${runNumber}, id=${data.id}`);
        return data.id;
      }

      // Check if it's a duplicate key error (23505)
      if (error.code === '23505' && attempt < maxRetries) {
        console.warn(`⚠️  [MemorySummarizer] Duplicate run_number detected (attempt ${attempt}/${maxRetries}), retrying...`);
        lastError = error;
        // Small random delay to reduce collision probability
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
        continue;
      }

      // Other error or max retries reached
      console.error('❌ [MemorySummarizer] Error saving memory to database:', {
        error,
        errorMessage: error?.message,
        errorCode: error?.code,
        errorDetails: error?.details,
        errorHint: error?.hint,
        agentId: input.agent_id,
        userId: input.user_id,
        executionId: input.execution_id,
        runNumber,
        attempt
      });
      throw error;
    }

    // If we get here, we exhausted all retries
    console.error(`❌ [MemorySummarizer] Failed to save memory after ${maxRetries} attempts`);
    throw lastError;
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
      console.error('❌ [MemorySummarizer] Error calculating cost:', error);
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
      console.log(`🔮 [MemorySummarizer] Generating embeddings for ${memoryIds.length} memories in batch...`);

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
          console.error('❌ [MemorySummarizer] Error fetching memories batch:', fetchError);
          continue;
        }

        // Build texts for batch embedding
        const texts = memories.map(m =>
          `${m.summary} ${JSON.stringify(m.key_outcomes)} ${JSON.stringify(m.patterns_detected)}`
        );

        // Generate embeddings in batch
        const response = await this.openai.embeddings.create({
          model: config.model,
          input: texts
        });

        // Validate dimensions
        const expectedDimensions = config.dimensions || 1536;
        if (response.data[0].embedding.length !== expectedDimensions) {
          console.warn(
            `⚠️  [MemorySummarizer] Embedding dimension mismatch! ` +
            `Expected ${expectedDimensions}, got ${response.data[0].embedding.length}. ` +
            `Update memory_embedding_dimensions config to match model ${config.model}.`
          );
        }

        // Save embeddings to database
        const updates = memories.map((m, idx) => ({
          id: m.id,
          embedding: response.data[idx].embedding
        }));

        for (const update of updates) {
          const { error: updateError } = await this.supabase
            .from('run_memories')
            .update({ embedding: update.embedding })
            .eq('id', update.id);

          if (updateError) {
            console.error(`❌ [MemorySummarizer] Error saving embedding for ${update.id}:`, updateError);
          }
        }

        console.log(`✅ [MemorySummarizer] Batch ${i / batchSize + 1}: Generated ${batch.length} embeddings`);
      }

      console.log(`✅ [MemorySummarizer] Batch embedding complete: ${memoryIds.length} total`);
    } catch (error) {
      console.error('❌ [MemorySummarizer] Error in batch embedding generation:', error);
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
        console.error('❌ [MemorySummarizer] Memory not found:', memoryId);
        return;
      }

      // Build text for embedding
      const embeddingText = `${memory.summary} ${JSON.stringify(memory.key_outcomes)} ${JSON.stringify(memory.patterns_detected)}`;

      // Load config
      const config = await MemoryConfigService.getEmbeddingConfig(this.supabase);

      // Generate embedding
      const response = await this.openai.embeddings.create({
        model: config.model,
        input: embeddingText
      });

      const embedding = response.data[0].embedding;

      // Validate dimensions
      const expectedDimensions = config.dimensions || 1536;
      if (embedding.length !== expectedDimensions) {
        console.warn(
          `⚠️  [MemorySummarizer] Embedding dimension mismatch! ` +
          `Expected ${expectedDimensions}, got ${embedding.length}. ` +
          `Update memory_embedding_dimensions config to match model ${config.model}.`
        );
      }

      // Save to database
      const { error: updateError } = await this.supabase
        .from('run_memories')
        .update({ embedding })
        .eq('id', memoryId);

      if (updateError) {
        console.error('❌ [MemorySummarizer] Error saving embedding:', updateError);
      } else {
        console.log(`✅ [MemorySummarizer] Embedding generated for memory ${memoryId}`);
      }
    } catch (error) {
      console.error('❌ [MemorySummarizer] Error generating embedding:', error);
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
      console.log(`🔮 [MemorySummarizer] Generating embedding for memory ${memoryId}...`);

      // Build text for embedding
      const embeddingText = `${memory.summary} ${JSON.stringify(memory.key_outcomes)} ${JSON.stringify(memory.patterns_detected)}`;

      // Load config
      const config = await MemoryConfigService.getEmbeddingConfig(this.supabase);

      // Generate embedding
      const response = await this.openai.embeddings.create({
        model: config.model,
        input: embeddingText
      });

      const embedding = response.data[0].embedding;

      // Validate dimensions
      const expectedDimensions = config.dimensions || 1536;
      if (embedding.length !== expectedDimensions) {
        console.warn(
          `⚠️  [MemorySummarizer] Embedding dimension mismatch! ` +
          `Expected ${expectedDimensions}, got ${embedding.length}. ` +
          `Update memory_embedding_dimensions config to match model ${config.model}.`
        );
      }

      // Save to database
      const { error: updateError } = await this.supabase
        .from('run_memories')
        .update({ embedding })
        .eq('id', memoryId);

      if (updateError) {
        console.error('❌ [MemorySummarizer] Error saving embedding:', updateError);
      } else {
        console.log(`✅ [MemorySummarizer] Embedding generated successfully for memory ${memoryId}`);
      }
    } catch (error) {
      console.error('❌ [MemorySummarizer] Error generating embedding:', error);
      throw error;
    }
  }
}
