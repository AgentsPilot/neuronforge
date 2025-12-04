// lib/memory/MemoryInjector.ts
// Load and inject memory context into agent execution with token budget

import { SupabaseClient } from '@supabase/supabase-js';
import { MemoryConfigService } from './MemoryConfigService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';

export interface MemoryContext {
  // Recent chronological runs
  recent_runs: Array<{
    run_number: number;
    summary: string;
    sentiment?: 'positive' | 'neutral' | 'negative' | 'mixed';
    key_outcomes: any;
    patterns_detected: any;
    run_timestamp: string;
    ais_score?: number;
    execution_time_ms?: number;
  }>;

  // Semantically relevant memories
  relevant_patterns: Array<{
    content: string;
    memory_type: string;
    confidence: number;
    importance_score: number;
  }>;

  // User preferences (cross-agent)
  user_context: Array<{
    memory_key: string;
    memory_value: any;
    memory_type: string;
    importance: number;
  }>;

  token_count: number;
}

/**
 * Memory Injection Service
 *
 * Loads relevant memory from database and formats it for injection into agent prompts
 * Enforces token budget to prevent context window overflow
 */
export class MemoryInjector {
  private auditTrail: AuditTrailService;

  constructor(private supabase: SupabaseClient) {
    this.auditTrail = AuditTrailService.getInstance();
  }

  /**
   * Build memory context for agent execution
   *
   * This is the main entry point - call this BEFORE agent execution
   *
   * @param agentId - Agent identifier
   * @param userId - User identifier
   * @param currentInput - Current execution input (for semantic search)
   * @returns Memory context within token budget
   */
  async buildMemoryContext(
    agentId: string,
    userId: string,
    currentInput: any
  ): Promise<MemoryContext> {
    console.log(`🧠 [MemoryInjector] Building context for agent ${agentId}`);

    try {
      // Load config from database
      const config = await MemoryConfigService.getInjectionConfig(this.supabase);

      // 1. Fetch recent runs (chronological)
      const recentRuns = await this.getRecentRuns(agentId, config.max_recent_runs);

      // 2. Fetch user context (preferences)
      const userContext = await this.getUserContext(userId);

      // 3. Fetch semantically relevant memories (only if we have query)
      let relevantMemories: any[] = [];
      if (currentInput && config.semantic_search_limit > 0) {
        try {
          relevantMemories = await this.getSemanticMemories(
            agentId,
            currentInput,
            config.semantic_search_limit,
            config.semantic_threshold
          );
          console.log(`🔍 [MemoryInjector] Found ${relevantMemories.length} semantically similar memories`);
        } catch (error) {
          console.warn(`⚠️  [MemoryInjector] Semantic search failed (non-critical):`, error);
        }
      }

      // 4. Build token-limited context
      const context = this.buildTokenLimitedContext(
        {
          recentRuns,
          relevantMemories,
          userContext
        },
        config
      );

      console.log(`✅ [MemoryInjector] Context built: ${context.token_count}/${config.max_tokens} tokens`);

      // Audit: Memory injected
      await this.auditTrail.log({
        action: AUDIT_EVENTS.MEMORY_INJECTED,
        entityType: 'agent',
        entityId: agentId,
        userId: userId,
        details: {
          token_count: context.token_count,
          max_tokens: config.max_tokens,
          recent_runs_count: context.recent_runs.length,
          user_context_count: context.user_context.length,
          has_recent_negative: context.recent_runs.some((r: any) => r.sentiment === 'negative')
        },
        severity: 'info'
      });

      // Audit: User memory injected (if any)
      if (context.user_context.length > 0) {
        await this.auditTrail.log({
          action: AUDIT_EVENTS.USER_MEMORY_INJECTED,
          entityType: 'agent',
          entityId: agentId,
          userId: userId,
          details: {
            user_memories_count: context.user_context.length,
            memory_keys: context.user_context.map((m: any) => m.memory_key)
          },
          severity: 'info'
        });
      }

      return context;
    } catch (error) {
      console.error(`❌ [MemoryInjector] Error building memory context:`, error);

      // Return empty context on error
      return {
        recent_runs: [],
        relevant_patterns: [],
        user_context: [],
        token_count: 0
      };
    }
  }

  /**
   * Format memory context as prompt string for injection
   *
   * This string is inserted into the system prompt before agent execution
   */
  formatForPrompt(context: MemoryContext): string {
    if (context.token_count === 0) {
      return ''; // No memory to inject
    }

    let prompt = '\n--- 🧠 AGENT MEMORY CONTEXT ---\n\n';

    // User profile
    if (context.user_context.length > 0) {
      prompt += '👤 USER PROFILE:\n';
      for (const mem of context.user_context) {
        prompt += `  • ${mem.memory_key}: ${JSON.stringify(mem.memory_value)}\n`;
      }
      prompt += '\n';
    }

    // Recent execution history
    if (context.recent_runs.length > 0) {
      prompt += '📊 RECENT HISTORY:\n';
      for (const run of context.recent_runs) {
        // Icon based on sentiment (fallback to success/failure if no sentiment)
        const sentimentIcons: Record<string, string> = {
          positive: '✅',
          neutral: '➖',
          negative: '❌',
          mixed: '⚠️'
        };
        const icon = run.sentiment ? sentimentIcons[run.sentiment] || '•' : (run.key_outcomes.success ? '✅' : '❌');

        // Format run info with AIS score if available
        const aisInfo = run.ais_score ? ` (AIS: ${run.ais_score.toFixed(1)})` : '';
        const timeInfo = run.execution_time_ms ? ` [${(run.execution_time_ms / 1000).toFixed(1)}s]` : '';

        prompt += `  ${icon} Run #${run.run_number}${aisInfo}${timeInfo}: ${run.summary}\n`;

        // Highlight patterns
        if (run.patterns_detected.recurring_error) {
          prompt += `      ⚠️ Pattern: ${run.patterns_detected.recurring_error}\n`;
        }
        if (run.patterns_detected.success_pattern) {
          prompt += `      ✨ Success: ${run.patterns_detected.success_pattern}\n`;
        }
      }
      prompt += '\n';
    }

    // Learned patterns
    if (context.relevant_patterns.length > 0) {
      prompt += '💡 LEARNED PATTERNS:\n';
      for (const mem of context.relevant_patterns) {
        prompt += `  • ${mem.content} (confidence: ${(mem.confidence * 100).toFixed(0)}%)\n`;
      }
      prompt += '\n';
    }

    prompt += `--- END MEMORY (${context.token_count} tokens) ---\n\n`;
    prompt += 'INSTRUCTIONS: Use memory context to inform your response. Reference past patterns when relevant.\n';

    return prompt;
  }

  /**
   * Get recent runs for this agent
   *
   * @private
   */
  private async getRecentRuns(
    agentId: string,
    limit: number
  ): Promise<Array<any>> {
    const { data, error } = await this.supabase
      .from('run_memories')
      .select('run_number, summary, sentiment, key_outcomes, patterns_detected, run_timestamp, ais_score, execution_time_ms')
      .eq('agent_id', agentId)
      .order('run_timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('❌ [MemoryInjector] Error fetching recent runs:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Get user context (preferences, profile)
   *
   * @private
   */
  private async getUserContext(userId: string): Promise<Array<any>> {
    const { data, error } = await this.supabase
      .from('user_memory')
      .select('memory_key, memory_value, memory_type, importance')
      .eq('user_id', userId)
      .order('importance', { ascending: false })
      .limit(10);

    if (error) {
      console.error('❌ [MemoryInjector] Error fetching user context:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Get semantically similar memories using pgvector
   *
   * @private
   */
  private async getSemanticMemories(
    agentId: string,
    query: any,
    limit: number,
    threshold: number
  ): Promise<Array<any>> {
    // Import OpenAI for embedding generation
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Load embedding config
    const { MemoryConfigService } = await import('./MemoryConfigService');
    const embeddingConfig = await MemoryConfigService.getEmbeddingConfig(this.supabase);

    // Build query string from input
    const queryString = typeof query === 'string'
      ? query
      : JSON.stringify(query).substring(0, 1000);

    // Generate embedding for query
    const embeddingResponse = await openai.embeddings.create({
      model: embeddingConfig.model,
      input: queryString
    });
    const queryEmbedding = embeddingResponse.data[0].embedding;

    // Search using pgvector cosine similarity
    // Note: This uses the <=> operator for cosine distance (1 - similarity)
    const { data, error } = await this.supabase.rpc('search_similar_memories', {
      query_embedding: queryEmbedding,
      query_agent_id: agentId,
      match_threshold: 1 - threshold, // Convert similarity to distance
      match_count: limit
    });

    if (error) {
      // If RPC function doesn't exist, fall back to manual query
      // This is expected on first run before migration is applied
      if (process.env.NODE_ENV !== 'production') {
        console.warn('⚠️  [MemoryInjector] RPC function not found, using manual query. Run migration: supabase/migrations/20251201000000_create_search_similar_memories_function.sql');
      }

      const { data: manualData, error: manualError } = await this.supabase
        .from('run_memories')
        .select('id, summary, key_outcomes, patterns_detected, importance_score, embedding')
        .eq('agent_id', agentId)
        .not('embedding', 'is', null)
        .limit(100); // Get top 100 to filter locally

      if (manualError || !manualData) {
        throw manualError;
      }

      // Calculate cosine similarity locally
      const results = manualData
        .map((memory: any) => {
          const similarity = this.cosineSimilarity(queryEmbedding, memory.embedding);
          return {
            content: memory.summary,
            memory_type: 'run',
            confidence: similarity,
            importance_score: memory.importance_score,
            patterns: memory.patterns_detected
          };
        })
        .filter((m: any) => m.confidence >= threshold)
        .sort((a: any, b: any) => b.confidence - a.confidence)
        .slice(0, limit);

      return results;
    }

    // Transform RPC results to expected format
    return (data || []).map((row: any) => ({
      content: row.summary,
      memory_type: 'run',
      confidence: row.similarity,
      importance_score: row.importance_score,
      patterns: row.patterns_detected
    }));
  }

  /**
   * Calculate cosine similarity between two vectors
   *
   * @private
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Build context within token budget
   *
   * Priority: User context > Recent runs (min 3) > Semantic memories
   *
   * @private
   */
  private buildTokenLimitedContext(
    input: {
      recentRuns: any[];
      relevantMemories: any[];
      userContext: any[];
    },
    config: any
  ): MemoryContext {
    const maxTokens = config.max_tokens || 800;
    const minRecentRuns = config.min_recent_runs || 3;

    let tokenCount = 0;
    const context: MemoryContext = {
      recent_runs: [],
      relevant_patterns: [],
      user_context: [],
      token_count: 0
    };

    // PRIORITY 1: User context (small, always include)
    for (const mem of input.userContext) {
      const tokens = this.estimateTokens(JSON.stringify(mem));
      if (tokenCount + tokens <= maxTokens) {
        context.user_context.push(mem);
        tokenCount += tokens;
      } else {
        break; // Budget exhausted
      }
    }

    // PRIORITY 2: Recent runs (minimum minRecentRuns, then fill to budget)
    for (let i = 0; i < input.recentRuns.length; i++) {
      const run = input.recentRuns[i];
      const tokens = this.estimateTokens(run.summary);

      // Always include first minRecentRuns
      if (i < minRecentRuns) {
        context.recent_runs.push(run);
        tokenCount += tokens;
      } else if (tokenCount + tokens <= maxTokens) {
        context.recent_runs.push(run);
        tokenCount += tokens;
      } else {
        break; // Budget exhausted
      }
    }

    // PRIORITY 3: Semantic memories (space permitting)
    for (const mem of input.relevantMemories) {
      const tokens = this.estimateTokens(mem.content);
      if (tokenCount + tokens <= maxTokens) {
        context.relevant_patterns.push(mem);
        tokenCount += tokens;
      } else {
        break;
      }
    }

    // Safety: If over budget, truncate oldest runs (but keep minimum)
    while (tokenCount > maxTokens && context.recent_runs.length > minRecentRuns) {
      const removed = context.recent_runs.pop()!;
      tokenCount -= this.estimateTokens(removed.summary);
    }

    context.token_count = tokenCount;

    console.log(`📊 [MemoryInjector] Context allocation:`, {
      user_context: context.user_context.length,
      recent_runs: context.recent_runs.length,
      patterns: context.relevant_patterns.length,
      tokens: `${tokenCount}/${maxTokens}`
    });

    return context;
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
   * Get the next run number for this agent
   *
   * Used when creating new memories
   */
  async getNextRunNumber(agentId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('run_memories')
      .select('run_number')
      .eq('agent_id', agentId)
      .order('run_number', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return 1; // First run
    }

    return data.run_number + 1;
  }

  /**
   * Get recent runs for providing to summarizer (for comparison context)
   */
  async getRecentRunsForSummarization(
    agentId: string,
    limit: number = 5
  ): Promise<Array<any>> {
    return this.getRecentRuns(agentId, limit);
  }
}
