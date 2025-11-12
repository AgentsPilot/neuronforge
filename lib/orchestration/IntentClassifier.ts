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

import { supabase } from '@/lib/supabaseClient';
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

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || supabase;
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
      const completion = await provider.chatCompletion(
        {
          model: 'claude-3-haiku-20240307',
          messages: [{ role: 'user', content: classificationPrompt }],
          temperature: 0.1,
          max_tokens: 150,
        },
        {
          userId: 'system',
          feature: 'orchestration',
          component: 'intent_classifier',
          category: 'classification',
        }
      );

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
   * Returns high confidence only for very clear patterns
   */
  private quickPatternCheck(
    prompt: string,
    stepType: string,
    pluginKey: string
  ): IntentClassification | null {
    const lowerPrompt = prompt.toLowerCase();
    const lowerType = stepType.toLowerCase();

    // Very obvious conditional steps
    if (stepType === 'conditional' || lowerType.includes('branch')) {
      return {
        intent: 'conditional',
        confidence: 0.95,
        reasoning: 'Explicit conditional step type',
      };
    }

    // Very obvious send/notification steps
    if (
      pluginKey.includes('email') ||
      pluginKey.includes('slack') ||
      pluginKey.includes('webhook') ||
      pluginKey.includes('notification')
    ) {
      return {
        intent: 'send',
        confidence: 0.95,
        reasoning: 'Notification/messaging plugin detected',
      };
    }

    // Very obvious validation steps
    if (lowerPrompt.startsWith('validate ') || lowerPrompt.startsWith('verify ')) {
      return {
        intent: 'validate',
        confidence: 0.9,
        reasoning: 'Explicit validate/verify instruction',
      };
    }

    // Very obvious summarization
    if (lowerPrompt.startsWith('summarize ') || lowerPrompt.startsWith('condense ')) {
      return {
        intent: 'summarize',
        confidence: 0.9,
        reasoning: 'Explicit summarize instruction',
      };
    }

    // Not obvious enough - needs LLM
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
 */
export const intentClassifier = new IntentClassifier();
