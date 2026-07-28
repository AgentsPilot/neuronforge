/**
 * IntentExampleRepository
 *
 * Data access for intent_examples table.
 * Stores successful intent → workflow examples for V6 few-shot learning.
 *
 * Part of Phase 7: V6 Learning (Memory System Enhancement)
 *
 * @module lib/repositories/IntentExampleRepository
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'IntentExampleRepository' });

// ============ Types ============

export interface IntentExample {
  id: string;
  user_input_hash: string;
  user_input_normalized: string;
  intent_contract: Record<string, unknown>;
  plugin_set: string[];
  workflow_pattern_hash: string | null;
  success_rate: number;
  calibration_iterations: number;
  token_usage: number | null;
  usage_count: number;
  last_used_at: string | null;
  is_high_quality: boolean;
  is_curated: boolean;
  quality_score: number | null;
  category: string | null;
  complexity: 'simple' | 'standard' | 'complex';
  created_at: string;
  updated_at: string;
}

export interface SimilarExample {
  id: string;
  user_input_normalized: string;
  intent_contract: Record<string, unknown>;
  plugin_set: string[];
  quality_score: number;
  similarity: number;
}

export interface UpsertExampleInput {
  userInputNormalized: string;
  intentContract: Record<string, unknown>;
  pluginSet: string[];
  calibrationIterations?: number;
  tokenUsage?: number;
  category?: string;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// ============ Repository ============

export class IntentExampleRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Upsert an intent example
   *
   * Called after successful calibration to store the example.
   */
  async upsert(input: UpsertExampleInput): Promise<RepositoryResult<string>> {
    try {
      const { data, error } = await this.supabase.rpc('upsert_intent_example', {
        p_user_input_normalized: input.userInputNormalized,
        p_intent_contract: input.intentContract,
        p_plugin_set: input.pluginSet,
        p_calibration_iterations: input.calibrationIterations || 1,
        p_token_usage: input.tokenUsage || 0,
        p_category: input.category || null,
      });

      if (error) {
        logger.error({ err: error }, 'Failed to upsert intent example');
        return { data: null, error: new Error(error.message) };
      }

      return { data: data as string, error: null };
    } catch (err) {
      logger.error({ err }, 'Failed to upsert intent example');
      return { data: null, error: err as Error };
    }
  }

  /**
   * Find similar examples for few-shot learning
   *
   * Returns examples with similar plugin sets for context in generation.
   */
  async findSimilar(
    plugins: string[],
    options: {
      category?: string;
      complexity?: 'simple' | 'standard' | 'complex';
      limit?: number;
    } = {}
  ): Promise<RepositoryResult<SimilarExample[]>> {
    try {
      const { data, error } = await this.supabase.rpc('find_similar_intent_examples', {
        p_plugins: plugins,
        p_category: options.category || null,
        p_complexity: options.complexity || null,
        p_limit: options.limit || 3,
      });

      if (error) {
        logger.error({ err: error }, 'Failed to find similar examples');
        return { data: null, error: new Error(error.message) };
      }

      return { data: (data || []) as SimilarExample[], error: null };
    } catch (err) {
      logger.error({ err }, 'Failed to find similar examples');
      return { data: null, error: err as Error };
    }
  }

  /**
   * Record usage of an example
   *
   * Called when an example is used in few-shot learning.
   * Tracks success rate for quality scoring.
   */
  async recordUsage(exampleId: string, success: boolean): Promise<void> {
    try {
      await this.supabase.rpc('record_intent_example_usage', {
        p_example_id: exampleId,
        p_success: success,
      });
    } catch (err) {
      // Non-blocking
      logger.debug({ err, exampleId }, 'Failed to record example usage');
    }
  }

  /**
   * Get high-quality examples for a category
   */
  async getByCategory(
    category: string,
    limit: number = 10
  ): Promise<RepositoryResult<IntentExample[]>> {
    try {
      const { data, error } = await this.supabase
        .from('intent_examples')
        .select('*')
        .eq('category', category)
        .eq('is_high_quality', true)
        .order('quality_score', { ascending: false })
        .limit(limit);

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      return { data: data as IntentExample[], error: null };
    } catch (err) {
      return { data: null, error: err as Error };
    }
  }

  /**
   * Get curated examples (manually reviewed)
   */
  async getCurated(limit: number = 20): Promise<RepositoryResult<IntentExample[]>> {
    try {
      const { data, error } = await this.supabase
        .from('intent_examples')
        .select('*')
        .eq('is_curated', true)
        .order('quality_score', { ascending: false })
        .limit(limit);

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      return { data: data as IntentExample[], error: null };
    } catch (err) {
      return { data: null, error: err as Error };
    }
  }

  /**
   * Mark an example as curated
   */
  async markCurated(exampleId: string, isCurated: boolean): Promise<void> {
    try {
      await this.supabase
        .from('intent_examples')
        .update({
          is_curated: isCurated,
          updated_at: new Date().toISOString(),
        })
        .eq('id', exampleId);
    } catch (err) {
      logger.error({ err, exampleId }, 'Failed to mark example as curated');
    }
  }

  /**
   * Mark an example as low quality (exclude from few-shot)
   */
  async markLowQuality(exampleId: string): Promise<void> {
    try {
      await this.supabase
        .from('intent_examples')
        .update({
          is_high_quality: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', exampleId);
    } catch (err) {
      logger.error({ err, exampleId }, 'Failed to mark example as low quality');
    }
  }

  /**
   * Get example statistics
   */
  async getStats(): Promise<{
    totalExamples: number;
    highQualityCount: number;
    curatedCount: number;
    avgQualityScore: number;
    byCategory: Record<string, number>;
    byComplexity: Record<string, number>;
  }> {
    try {
      const { data, error } = await this.supabase
        .from('intent_examples')
        .select('is_high_quality, is_curated, quality_score, category, complexity');

      if (error || !data) {
        return {
          totalExamples: 0,
          highQualityCount: 0,
          curatedCount: 0,
          avgQualityScore: 0,
          byCategory: {},
          byComplexity: {},
        };
      }

      const byCategory: Record<string, number> = {};
      const byComplexity: Record<string, number> = {};
      let totalQuality = 0;
      let qualityCount = 0;

      for (const row of data) {
        if (row.category) {
          byCategory[row.category] = (byCategory[row.category] || 0) + 1;
        }
        if (row.complexity) {
          byComplexity[row.complexity] = (byComplexity[row.complexity] || 0) + 1;
        }
        if (row.quality_score !== null) {
          totalQuality += row.quality_score;
          qualityCount++;
        }
      }

      return {
        totalExamples: data.length,
        highQualityCount: data.filter((r) => r.is_high_quality).length,
        curatedCount: data.filter((r) => r.is_curated).length,
        avgQualityScore: qualityCount > 0 ? totalQuality / qualityCount : 0,
        byCategory,
        byComplexity,
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get example stats');
      return {
        totalExamples: 0,
        highQualityCount: 0,
        curatedCount: 0,
        avgQualityScore: 0,
        byCategory: {},
        byComplexity: {},
      };
    }
  }

  /**
   * Format examples for V6 prompt injection
   */
  formatForPrompt(examples: SimilarExample[]): string {
    if (examples.length === 0) {
      return '';
    }

    const lines: string[] = ['## Similar Successful Workflows'];
    lines.push('Use these examples as reference for generating the IntentContract:');
    lines.push('');

    for (let i = 0; i < examples.length; i++) {
      const example = examples[i];
      lines.push(`### Example ${i + 1}`);
      lines.push(`**User Request**: "${example.user_input_normalized}"`);
      lines.push(`**Plugins Used**: ${example.plugin_set.join(', ')}`);
      lines.push(`**Intent Contract**:`);
      lines.push('```json');
      lines.push(JSON.stringify(example.intent_contract, null, 2));
      lines.push('```');
      lines.push('');
    }

    return lines.join('\n');
  }
}

// Singleton factory
let _instance: IntentExampleRepository | null = null;
let _lastSupabase: SupabaseClient | null = null;

export function getIntentExampleRepository(supabase: SupabaseClient): IntentExampleRepository {
  if (!_instance || _lastSupabase !== supabase) {
    _instance = new IntentExampleRepository(supabase);
    _lastSupabase = supabase;
  }
  return _instance;
}
