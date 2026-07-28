/**
 * PatternExtractor
 *
 * Extracts anonymized workflow patterns from successful executions
 * for platform-wide learning and V6 generation suggestions.
 *
 * Part of Phase 3: Platform Learning (Memory System Enhancement)
 *
 * PRIVACY: Only extracts structural patterns (plugin sequences, step types).
 * NO user data, field names, or values are stored.
 *
 * @module lib/services/PatternExtractor
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'PatternExtractor' });

// ============ Types ============

export interface WorkflowPattern {
  id: string;
  plugin_sequence: string[];
  trigger_type: string;
  step_count: number;
  category: string;
  popularity: number;
  avg_success_rate: number;
  similarity?: number;
}

export interface ExtractPatternInput {
  workflow: {
    steps: Array<{
      type: string;
      plugin?: string;
      action?: string;
    }>;
    trigger_type?: string;
  };
  executionSuccess: boolean;
  executionTimeMs: number;
  tokenUsage: number;
}

// Category detection rules (based on plugin combinations)
const CATEGORY_RULES: Array<{
  plugins: string[];
  category: string;
}> = [
  { plugins: ['hubspot', 'salesforce', 'pipedrive'], category: 'crm' },
  { plugins: ['slack', 'discord', 'teams'], category: 'notification' },
  { plugins: ['google-sheets', 'airtable', 'notion'], category: 'data-sync' },
  { plugins: ['gmail', 'outlook'], category: 'email' },
  { plugins: ['google-drive', 'dropbox', 'onedrive'], category: 'file-management' },
  { plugins: ['chatgpt-research'], category: 'ai-research' },
];

// ============ Service ============

export class PatternExtractor {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Extract pattern from a completed workflow execution
   *
   * Call this after successful workflow execution to contribute
   * to platform-wide learning.
   *
   * @param input - Workflow and execution data
   */
  async extractAndStore(input: ExtractPatternInput): Promise<string | null> {
    try {
      const { workflow, executionSuccess, executionTimeMs, tokenUsage } = input;

      if (!workflow?.steps || workflow.steps.length === 0) {
        return null;
      }

      // Extract plugin sequence (ordered list of plugins used)
      const pluginSequence = this.extractPluginSequence(workflow.steps);

      if (pluginSequence.length === 0) {
        return null;
      }

      // Detect category from plugin combination
      const category = this.detectCategory(pluginSequence);

      // Use RPC for atomic upsert
      const { data, error } = await this.supabase.rpc('upsert_workflow_pattern', {
        p_plugin_sequence: pluginSequence,
        p_trigger_type: workflow.trigger_type || 'manual',
        p_step_count: workflow.steps.length,
        p_category: category,
        p_success: executionSuccess,
        p_execution_time_ms: executionTimeMs,
        p_token_usage: tokenUsage,
      });

      if (error) {
        logger.debug({ err: error }, 'Failed to store pattern (non-blocking)');
        return null;
      }

      logger.debug(
        { patternId: data, plugins: pluginSequence, category },
        'Workflow pattern extracted'
      );

      return data as string;
    } catch (err) {
      // Non-blocking - don't fail execution
      logger.debug({ err }, 'Pattern extraction failed (non-blocking)');
      return null;
    }
  }

  /**
   * Get similar patterns for V6 generation suggestions
   *
   * @param plugins - List of plugins being used in the new workflow
   * @param limit - Maximum number of patterns to return
   */
  async getSimilarPatterns(
    plugins: string[],
    limit: number = 5
  ): Promise<WorkflowPattern[]> {
    try {
      const { data, error } = await this.supabase.rpc('get_similar_patterns', {
        p_plugins: plugins,
        p_limit: limit,
      });

      if (error || !data) {
        return [];
      }

      return data as WorkflowPattern[];
    } catch (err) {
      logger.error({ err }, 'Failed to get similar patterns');
      return [];
    }
  }

  /**
   * Get popular patterns for a category
   *
   * @param category - Category filter (optional)
   * @param limit - Maximum number of patterns
   */
  async getPopularPatterns(
    category?: string,
    limit: number = 10
  ): Promise<WorkflowPattern[]> {
    try {
      let query = this.supabase
        .from('workflow_patterns')
        .select('*')
        .gte('total_executions', 10)
        .gte('avg_success_rate', 0.7)
        .order('popularity', { ascending: false })
        .limit(limit);

      if (category) {
        query = query.eq('category', category);
      }

      const { data, error } = await query;

      if (error || !data) {
        return [];
      }

      return data as WorkflowPattern[];
    } catch (err) {
      logger.error({ err }, 'Failed to get popular patterns');
      return [];
    }
  }

  /**
   * Format patterns as suggestions for V6 prompt injection
   */
  formatForV6Prompt(patterns: WorkflowPattern[]): string {
    if (patterns.length === 0) {
      return '';
    }

    const lines: string[] = ['## Similar Successful Workflows'];

    for (const pattern of patterns.slice(0, 3)) {
      const successRate = (pattern.avg_success_rate * 100).toFixed(0);
      lines.push(
        `- ${pattern.plugin_sequence.join(' → ')} (${successRate}% success, ${pattern.popularity} users)`
      );
      if (pattern.category) {
        lines.push(`  Category: ${pattern.category}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get pattern statistics for a user's plugins
   */
  async getPatternStats(plugins: string[]): Promise<{
    totalPatterns: number;
    avgSuccessRate: number;
    mostPopularCategory: string | null;
  }> {
    try {
      const patterns = await this.getSimilarPatterns(plugins, 50);

      if (patterns.length === 0) {
        return {
          totalPatterns: 0,
          avgSuccessRate: 0,
          mostPopularCategory: null,
        };
      }

      const avgSuccessRate =
        patterns.reduce((sum, p) => sum + p.avg_success_rate, 0) / patterns.length;

      // Count categories
      const categoryCounts: Record<string, number> = {};
      for (const p of patterns) {
        if (p.category) {
          categoryCounts[p.category] = (categoryCounts[p.category] || 0) + p.popularity;
        }
      }

      const mostPopularCategory =
        Object.entries(categoryCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || null;

      return {
        totalPatterns: patterns.length,
        avgSuccessRate,
        mostPopularCategory,
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get pattern stats');
      return {
        totalPatterns: 0,
        avgSuccessRate: 0,
        mostPopularCategory: null,
      };
    }
  }

  // ============ Private Methods ============

  /**
   * Extract ordered plugin sequence from workflow steps
   */
  private extractPluginSequence(
    steps: Array<{ type: string; plugin?: string; action?: string }>
  ): string[] {
    const plugins: string[] = [];

    for (const step of steps) {
      // Get plugin name (from plugin field or derive from type)
      const plugin = step.plugin || this.derivePluginFromType(step.type);

      if (plugin && !plugins.includes(plugin)) {
        // Add unique plugins in order
        plugins.push(plugin);
      }
    }

    return plugins;
  }

  /**
   * Derive plugin name from step type (for non-plugin steps)
   */
  private derivePluginFromType(type: string): string | null {
    // Map step types to pseudo-plugins for pattern matching
    const typeMap: Record<string, string> = {
      llm_decision: 'ai-decision',
      transform: 'data-transform',
      comparison: 'data-compare',
      validation: 'data-validate',
      parallel: 'parallel-exec',
      control: 'flow-control',
    };

    return typeMap[type] || null;
  }

  /**
   * Detect workflow category from plugin combination
   */
  private detectCategory(plugins: string[]): string {
    // Check against category rules
    for (const rule of CATEGORY_RULES) {
      if (rule.plugins.some((p) => plugins.includes(p))) {
        return rule.category;
      }
    }

    // Default category based on plugin count
    if (plugins.length <= 2) {
      return 'simple';
    } else if (plugins.length <= 4) {
      return 'standard';
    } else {
      return 'complex';
    }
  }
}

// Singleton factory
let _instance: PatternExtractor | null = null;
let _lastSupabase: SupabaseClient | null = null;

export function getPatternExtractor(supabase: SupabaseClient): PatternExtractor {
  if (!_instance || _lastSupabase !== supabase) {
    _instance = new PatternExtractor(supabase);
    _lastSupabase = supabase;
  }
  return _instance;
}
