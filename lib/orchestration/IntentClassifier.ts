/**
 * IntentClassifier
 *
 * Classifies workflow steps by intent to enable:
 * - Token budget allocation
 * - Compression strategy selection
 * - Model routing decisions
 *
 * Uses LLM-based classification for accuracy on complex business scenarios
 * Optimized for speed with batch processing and caching
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IntentType,
  IntentClassification,
  IIntentClassifier,
} from './types';
import { ProviderFactory } from '@/lib/ai/providerFactory';

export class IntentClassifier implements IIntentClassifier {
  private supabase: SupabaseClient;
  private confidenceThreshold: number | null = null;
  private classificationCache: Map<string, IntentClassification> = new Map();
  private classificationTokensUsed: number = 0;  // ✅ Track tokens used for classification overhead

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Get total tokens used for intent classification (orchestration overhead)
   */
  getClassificationTokensUsed(): number {
    return this.classificationTokensUsed;
  }

  /**
   * Reset token counter (call at start of new workflow)
   */
  resetTokenCounter(): void {
    this.classificationTokensUsed = 0;
  }

  /**
   * Classify a workflow step by intent using LLM
   * Supports complex business scenarios with context-aware classification
   */
  async classify(step: any): Promise<IntentClassification> {
    const startTime = Date.now();

    try {
      // Generate cache key from step content
      const cacheKey = this.generateCacheKey(step);

      // Check cache first
      const cached = this.classificationCache.get(cacheKey);
      if (cached) {
        console.log(`[IntentClassifier] Cache hit for step classification`);
        return cached;
      }

      // Extract step information
      const prompt = step.prompt || step.instruction || step.description || '';
      const stepType = step.step_type || step.type || '';
      const pluginKey = step.plugin_key || step.plugin || '';
      const inputSchema = step.input_schema || {};
      const outputSchema = step.output_schema || {};

      // Quick pattern-based pre-filter for obvious cases (optimization)
      const quickCheck = this.quickPatternCheck(prompt, stepType, pluginKey);
      if (quickCheck && quickCheck.confidence >= 0.9) {
        this.classificationCache.set(cacheKey, quickCheck);
        const elapsed = Date.now() - startTime;
        console.log(
          `[IntentClassifier] Quick classified as "${quickCheck.intent}" in ${elapsed}ms`
        );
        return quickCheck;
      }

      // Use LLM for complex classification
      const classification = await this.classifyWithLLM(
        prompt,
        stepType,
        pluginKey,
        inputSchema,
        outputSchema
      );

      // Cache the result
      this.classificationCache.set(cacheKey, classification);

      const elapsed = Date.now() - startTime;
      console.log(
        `[IntentClassifier] LLM classified as "${classification.intent}" (${(classification.confidence * 100).toFixed(0)}% confidence) in ${elapsed}ms`
      );

      return classification;
    } catch (error) {
      console.error('[IntentClassifier] Classification error:', error);
      // Fallback to 'generate' intent on error
      return {
        intent: 'generate',
        confidence: 0.5,
        reasoning: 'Fallback to generate intent due to classification error',
      };
    }
  }

  /**
   * Classify using LLM for complex scenarios
   */
  private async classifyWithLLM(
    prompt: string,
    stepType: string,
    pluginKey: string,
    inputSchema: any,
    outputSchema: any
  ): Promise<IntentClassification> {
    // Get fast model for classification (use Haiku)
    const provider = ProviderFactory.getProvider('anthropic');

    const classificationPrompt = `You are an expert at classifying workflow step intents for orchestration optimization.

Analyze the following workflow step and classify it into ONE of these intent types:

**Intent Types:**
- extract: Fetching data from external sources (APIs, databases, files, web scraping)
- summarize: Condensing or summarizing large content into concise form
- generate: Creating new content (text, code, documents, creative writing)
- validate: Verifying data correctness, compliance, or business rules
- send: Sending data externally (emails, webhooks, API posts, notifications)
- transform: Converting data format or structure (JSON to CSV, data mapping)
- conditional: Branching logic based on conditions
- aggregate: Combining multiple data sources or rolling up data
- filter: Selecting subset of data based on criteria
- enrich: Adding additional data to existing records (lookups, joins)

**Workflow Step Details:**
Prompt/Instruction: ${prompt}
Step Type: ${stepType || 'not specified'}
Plugin: ${pluginKey || 'none'}
Has Input Schema: ${Object.keys(inputSchema).length > 0 ? 'yes' : 'no'}
Has Output Schema: ${Object.keys(outputSchema).length > 0 ? 'yes' : 'no'}

**Instructions:**
1. Analyze the primary purpose of this step in a business workflow
2. Consider the context: what is this step trying to accomplish?
3. Choose the MOST appropriate intent type
4. Provide a confidence score (0.0-1.0)
5. Explain your reasoning briefly

**Response Format (JSON):**
{
  "intent": "<one of the intent types>",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation>"
}

Respond with ONLY valid JSON, no additional text.`;

    try {
      // Use system admin user ID for orchestration overhead tracking
      const SYSTEM_USER_ID = process.env.SYSTEM_ADMIN_USER_ID || '00000000-0000-0000-0000-000000000000';

      const completion = await provider.chatCompletion(
        {
          model: 'claude-3-haiku-20240307',
          messages: [{ role: 'user', content: classificationPrompt }],
          temperature: 0.1,
          max_tokens: 150,
        },
        {
          userId: SYSTEM_USER_ID,
          feature: 'orchestration',
          component: 'intent_classifier',
          category: 'classification',
        }
      );

      // ✅ Track tokens used for classification (orchestration overhead)
      const tokensUsed = (completion.usage?.prompt_tokens || 0) + (completion.usage?.completion_tokens || 0);
      this.classificationTokensUsed += tokensUsed;

      const response = completion.choices?.[0]?.message?.content || '';

      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate intent type
      const validIntents: IntentType[] = [
        'extract', 'summarize', 'generate', 'validate', 'send',
        'transform', 'conditional', 'aggregate', 'filter', 'enrich'
      ];

      if (!validIntents.includes(parsed.intent)) {
        throw new Error(`Invalid intent type: ${parsed.intent}`);
      }

      return {
        intent: parsed.intent as IntentType,
        confidence: Math.max(0, Math.min(1, parsed.confidence)),
        reasoning: parsed.reasoning || 'LLM classification',
      };
    } catch (error) {
      console.error('[IntentClassifier] LLM classification failed:', error);
      // Fallback to pattern-based if LLM fails
      const fallback = this.quickPatternCheck(prompt, stepType, pluginKey);
      return fallback || {
        intent: 'generate',
        confidence: 0.5,
        reasoning: 'Fallback after LLM error',
      };
    }
  }

  /**
   * Quick pattern check for obvious cases (optimization)
   * Enhanced with comprehensive keyword matching to eliminate 85-90% of LLM calls
   */
  private quickPatternCheck(
    prompt: string,
    stepType: string,
    pluginKey: string
  ): IntentClassification | null {
    const lowerPrompt = prompt.toLowerCase();
    const lowerType = stepType.toLowerCase();
    const lowerPlugin = pluginKey.toLowerCase();

    // ===== DETERMINISTIC CLASSIFICATIONS (100% confidence) =====

    // 1. Action steps - ALWAYS deterministic based on step type
    if (stepType === 'action') {
      // Classify by plugin action semantics
      const isSend = /send|email|notify|webhook|slack|sms|push|post|publish/.test(lowerPlugin + ' ' + lowerPrompt);
      return {
        intent: isSend ? 'send' : 'extract',
        confidence: 1.0,
        reasoning: 'Action step type - deterministic classification',
      };
    }

    // 2. Explicit conditional steps
    if (stepType === 'conditional' || lowerType.includes('branch')) {
      return {
        intent: 'conditional',
        confidence: 1.0,
        reasoning: 'Explicit conditional step type',
      };
    }

    // ===== KEYWORD-BASED CLASSIFICATIONS (90-95% confidence) =====

    // 3. Summarization patterns
    if (/\b(summarize|summary|recap|digest|overview|condense|brief)\b/.test(lowerPrompt)) {
      return {
        intent: 'summarize',
        confidence: 0.95,
        reasoning: 'Summarization keywords detected',
      };
    }

    // 4. Extraction patterns
    if (/\b(extract|find|get|retrieve|fetch|pull|list|search|query|read)\b/.test(lowerPrompt)) {
      return {
        intent: 'extract',
        confidence: 0.95,
        reasoning: 'Extraction keywords detected',
      };
    }

    // 5. Generation patterns
    if (/\b(create|generate|write|compose|draft|build|produce|make)\b/.test(lowerPrompt)) {
      return {
        intent: 'generate',
        confidence: 0.95,
        reasoning: 'Generation keywords detected',
      };
    }

    // 6. Validation patterns
    if (/\b(validate|verify|check|confirm|ensure|test|assert)\b/.test(lowerPrompt)) {
      return {
        intent: 'validate',
        confidence: 0.95,
        reasoning: 'Validation keywords detected',
      };
    }

    // 7. Send/notification patterns
    if (
      lowerPlugin.match(/email|slack|webhook|notification|sms/) ||
      /\b(send|email|notify|alert|message|post|publish|deliver)\b/.test(lowerPrompt)
    ) {
      return {
        intent: 'send',
        confidence: 0.95,
        reasoning: 'Send/notification keywords detected',
      };
    }

    // 8. Transformation patterns
    if (/\b(convert|transform|map|format|parse|restructure|reshape|modify)\b/.test(lowerPrompt)) {
      return {
        intent: 'transform',
        confidence: 0.95,
        reasoning: 'Transformation keywords detected',
      };
    }

    // 9. Filter patterns
    if (/\b(filter|where|select|exclude|remove|keep|only|match)\b/.test(lowerPrompt)) {
      return {
        intent: 'filter',
        confidence: 0.9,
        reasoning: 'Filter keywords detected',
      };
    }

    // 10. Conditional patterns (for ai_processing steps with conditional logic)
    if (/\b(if|when|unless|depending|based on|condition|decide)\b/.test(lowerPrompt)) {
      return {
        intent: 'conditional',
        confidence: 0.9,
        reasoning: 'Conditional keywords detected',
      };
    }

    // 11. Aggregation patterns
    if (/\b(sum|count|total|average|group|combine|merge|aggregate|rollup)\b/.test(lowerPrompt)) {
      return {
        intent: 'aggregate',
        confidence: 0.9,
        reasoning: 'Aggregation keywords detected',
      };
    }

    // 12. Enrichment patterns
    if (/\b(enrich|lookup|join|append|add|enhance|augment)\b/.test(lowerPrompt)) {
      return {
        intent: 'enrich',
        confidence: 0.9,
        reasoning: 'Enrichment keywords detected',
      };
    }

    // No clear pattern match - return null to trigger LLM classification
    return null;
  }

  /**
   * Generate cache key for step
   */
  private generateCacheKey(step: any): string {
    const prompt = step.prompt || step.instruction || step.description || '';
    const stepType = step.step_type || step.type || '';
    const pluginKey = step.plugin_key || step.plugin || '';

    // Simple hash-like key
    return `${stepType}:${pluginKey}:${prompt.slice(0, 100)}`;
  }

  /**
   * Get confidence threshold from database configuration
   */
  async getConfidenceThreshold(): Promise<number> {
    // Cache the threshold to avoid repeated DB queries
    if (this.confidenceThreshold !== null) {
      return this.confidenceThreshold;
    }

    try {
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('value')
        .eq('key', 'orchestration_intent_classification_confidence_threshold')
        .single();

      if (error || !data) {
        console.warn(
          '[IntentClassifier] Could not fetch confidence threshold, using default 0.7'
        );
        this.confidenceThreshold = 0.7;
        return 0.7;
      }

      this.confidenceThreshold = parseFloat(data.value);
      return this.confidenceThreshold;
    } catch (error) {
      console.error('[IntentClassifier] Error fetching confidence threshold:', error);
      this.confidenceThreshold = 0.7;
      return 0.7;
    }
  }

  /**
   * Batch classify multiple steps
   * Uses parallel processing for efficiency
   */
  async classifyBatch(steps: any[]): Promise<IntentClassification[]> {
    const startTime = Date.now();

    // Process in parallel with concurrency limit
    const BATCH_SIZE = 5; // Process 5 at a time to avoid rate limits
    const results: IntentClassification[] = [];

    for (let i = 0; i < steps.length; i += BATCH_SIZE) {
      const batch = steps.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((step) => this.classify(step))
      );
      results.push(...batchResults);
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[IntentClassifier] Batch classified ${steps.length} steps in ${elapsed}ms (${(elapsed / steps.length).toFixed(1)}ms avg per step)`
    );

    return results;
  }

  /**
   * Get intent distribution statistics (for monitoring)
   */
  getIntentDistribution(classifications: IntentClassification[]): Record<
    IntentType,
    number
  > {
    const distribution: Record<string, number> = {};

    for (const classification of classifications) {
      distribution[classification.intent] =
        (distribution[classification.intent] || 0) + 1;
    }

    return distribution as Record<IntentType, number>;
  }

  /**
   * Clear classification cache
   */
  clearCache(): void {
    this.classificationCache.clear();
    console.log('[IntentClassifier] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hits: number } {
    return {
      size: this.classificationCache.size,
      hits: 0, // TODO: Implement hit counter if needed
    };
  }

  /**
   * Reload configuration from database
   * Call this to refresh cached config values
   */
  async reloadConfig(): Promise<void> {
    this.confidenceThreshold = null;
    await this.getConfidenceThreshold();
  }
}

/**
 * Singleton instance for convenient access
 * @deprecated Use instance-based approach with proper Supabase client
 * This singleton will fail on server-side because it requires a Supabase client
 * Usage: Create instance via OrchestrationService (already has IntentClassifier instance)
 */
// export const intentClassifier = new IntentClassifier(); // Disabled - requires Supabase client
