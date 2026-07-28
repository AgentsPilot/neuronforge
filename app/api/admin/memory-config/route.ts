// app/api/admin/memory-config/route.ts
// Admin API for managing memory system configuration
// Consolidated page for Memory + Insights configuration

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'MemoryConfigAPI' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Disable caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/memory-config
 *
 * Fetch all memory and insights configuration settings
 */
export async function GET() {
  try {
    // Fetch all memory and insights configuration from system_settings_config
    const { data: settings, error } = await supabase
      .from('system_settings_config')
      .select('key, value')
      .or('key.like.memory_%,key.like.insights_%');

    if (error) {
      logger.error({ err: error }, 'Error fetching memory config');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch configuration' },
        { status: 500 }
      );
    }

    // Parse settings into structured config with defaults
    const config = {
      global: {
        enabled: true
      },
      injection: {
        max_tokens: 4000,
        min_recent_runs: 2,
        max_recent_runs: 5,
        semantic_search_limit: 10,
        semantic_threshold: 0.7
      },
      summarization: {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 1000,
        input_truncate_chars: 300,
        output_truncate_chars: 400,
        recent_history_count: 2,
        recent_history_summary_chars: 100
      },
      embedding: {
        model: 'text-embedding-3-small',
        batch_size: 100,
        dimensions: 1536
      },
      importance: {
        base_score: 0.5,
        error_bonus: 0.3,
        pattern_bonus: 0.2,
        user_feedback_bonus: 0.4,
        first_run_bonus: 0.1,
        milestone_bonus: 0.15
      },
      retention: {
        run_memories_days: 90,
        low_importance_days: 30,
        consolidation_threshold: 100,
        consolidation_frequency_days: 7
      },
      user_extraction: {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 1000,
        confidence_threshold: 0.7
      },
      // Insights/Learning Configuration
      baseline: {
        enabled: true,
        min_samples: 5,
        zscore_threshold: 2.0,
        zscore_warning: 2.5,
        zscore_critical: 4.0,
        step_deviation_threshold: 50,
        retry_deviation_threshold: 100,
        duration_spike_factor: 2.0
      },
      error_learning: {
        enabled: true,
        min_occurrences: 3,
        min_success_rate: 0.5,
        min_attempts_for_evaluation: 5
      },
      plugin_performance: {
        enabled: true,
        min_executions_agent: 10,
        min_executions_userwide: 20,
        success_drop_factor: 0.7,
        duration_spike_factor: 2.0,
        duration_critical_factor: 3.0,
        error_rate_threshold: 0.1
      },
      pattern_learning: {
        enabled: true,
        min_executions: 10,
        min_success_rate: 0.7
      },
      intent_examples: {
        enabled: true,
        default_limit: 3,
        max_limit: 10
      }
    };

    // Override defaults with database values if they exist
    if (settings && settings.length > 0) {
      settings.forEach((setting) => {
        const { key, value } = setting;

        // Parse JSON values
        let parsedValue;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // If not JSON, use as-is (for primitives stored as strings)
          parsedValue = isNaN(Number(value)) ? value : Number(value);
        }

        // Map database keys to config structure
        if (key === 'memory_global_enabled') config.global.enabled = parsedValue === 'true' || parsedValue === true;

        if (key === 'memory_injection_max_tokens') config.injection.max_tokens = parsedValue;
        if (key === 'memory_injection_min_recent_runs') config.injection.min_recent_runs = parsedValue;
        if (key === 'memory_injection_max_recent_runs') config.injection.max_recent_runs = parsedValue;
        if (key === 'memory_injection_semantic_search_limit') config.injection.semantic_search_limit = parsedValue;
        if (key === 'memory_injection_semantic_threshold') config.injection.semantic_threshold = parsedValue;

        if (key === 'memory_summarization_model') config.summarization.model = parsedValue;
        if (key === 'memory_summarization_temperature') config.summarization.temperature = parsedValue;
        if (key === 'memory_summarization_max_tokens') config.summarization.max_tokens = parsedValue;
        if (key === 'memory_summarization_input_truncate_chars') config.summarization.input_truncate_chars = parsedValue;
        if (key === 'memory_summarization_output_truncate_chars') config.summarization.output_truncate_chars = parsedValue;
        if (key === 'memory_summarization_recent_history_count') config.summarization.recent_history_count = parsedValue;
        if (key === 'memory_summarization_recent_history_summary_chars') config.summarization.recent_history_summary_chars = parsedValue;

        if (key === 'memory_embedding_model') config.embedding.model = parsedValue;
        if (key === 'memory_embedding_batch_size') config.embedding.batch_size = parsedValue;
        if (key === 'memory_embedding_dimensions') config.embedding.dimensions = parsedValue;

        if (key === 'memory_importance_base_score') config.importance.base_score = parsedValue;
        if (key === 'memory_importance_error_bonus') config.importance.error_bonus = parsedValue;
        if (key === 'memory_importance_pattern_bonus') config.importance.pattern_bonus = parsedValue;
        if (key === 'memory_importance_user_feedback_bonus') config.importance.user_feedback_bonus = parsedValue;
        if (key === 'memory_importance_first_run_bonus') config.importance.first_run_bonus = parsedValue;
        if (key === 'memory_importance_milestone_bonus') config.importance.milestone_bonus = parsedValue;

        if (key === 'memory_retention_run_memories_days') config.retention.run_memories_days = parsedValue;
        if (key === 'memory_retention_low_importance_days') config.retention.low_importance_days = parsedValue;
        if (key === 'memory_retention_consolidation_threshold') config.retention.consolidation_threshold = parsedValue;
        if (key === 'memory_retention_consolidation_frequency_days') config.retention.consolidation_frequency_days = parsedValue;

        // User Extraction
        if (key === 'memory_user_extraction_model') config.user_extraction.model = parsedValue;
        if (key === 'memory_user_extraction_temperature') config.user_extraction.temperature = parsedValue;
        if (key === 'memory_user_extraction_max_tokens') config.user_extraction.max_tokens = parsedValue;
        if (key === 'memory_user_extraction_confidence_threshold') config.user_extraction.confidence_threshold = parsedValue;

        // Insights: Baseline
        if (key === 'insights_baseline_enabled') config.baseline.enabled = parsedValue === 'true' || parsedValue === true;
        if (key === 'insights_baseline_min_samples') config.baseline.min_samples = parsedValue;
        if (key === 'insights_baseline_zscore_threshold') config.baseline.zscore_threshold = parsedValue;
        if (key === 'insights_baseline_zscore_warning') config.baseline.zscore_warning = parsedValue;
        if (key === 'insights_baseline_zscore_critical') config.baseline.zscore_critical = parsedValue;
        if (key === 'insights_baseline_step_deviation_threshold') config.baseline.step_deviation_threshold = parsedValue;
        if (key === 'insights_baseline_retry_deviation_threshold') config.baseline.retry_deviation_threshold = parsedValue;
        if (key === 'insights_baseline_duration_spike_factor') config.baseline.duration_spike_factor = parsedValue;

        // Insights: Error Learning
        if (key === 'insights_error_learning_enabled') config.error_learning.enabled = parsedValue === 'true' || parsedValue === true;
        if (key === 'insights_error_learning_min_occurrences') config.error_learning.min_occurrences = parsedValue;
        if (key === 'insights_error_learning_min_success_rate') config.error_learning.min_success_rate = parsedValue;
        if (key === 'insights_error_learning_min_attempts_for_evaluation') config.error_learning.min_attempts_for_evaluation = parsedValue;

        // Insights: Plugin Performance
        if (key === 'insights_plugin_performance_enabled') config.plugin_performance.enabled = parsedValue === 'true' || parsedValue === true;
        if (key === 'insights_plugin_performance_min_executions_agent') config.plugin_performance.min_executions_agent = parsedValue;
        if (key === 'insights_plugin_performance_min_executions_userwide') config.plugin_performance.min_executions_userwide = parsedValue;
        if (key === 'insights_plugin_performance_success_drop_factor') config.plugin_performance.success_drop_factor = parsedValue;
        if (key === 'insights_plugin_performance_duration_spike_factor') config.plugin_performance.duration_spike_factor = parsedValue;
        if (key === 'insights_plugin_performance_duration_critical_factor') config.plugin_performance.duration_critical_factor = parsedValue;
        if (key === 'insights_plugin_performance_error_rate_threshold') config.plugin_performance.error_rate_threshold = parsedValue;

        // Insights: Pattern Learning
        if (key === 'insights_pattern_learning_enabled') config.pattern_learning.enabled = parsedValue === 'true' || parsedValue === true;
        if (key === 'insights_pattern_learning_min_executions') config.pattern_learning.min_executions = parsedValue;
        if (key === 'insights_pattern_learning_min_success_rate') config.pattern_learning.min_success_rate = parsedValue;

        // Insights: Intent Examples
        if (key === 'insights_intent_examples_enabled') config.intent_examples.enabled = parsedValue === 'true' || parsedValue === true;
        if (key === 'insights_intent_examples_default_limit') config.intent_examples.default_limit = parsedValue;
        if (key === 'insights_intent_examples_max_limit') config.intent_examples.max_limit = parsedValue;
      });
    }

    return NextResponse.json({
      success: true,
      config
    });
  } catch (error: any) {
    console.error('Exception in GET /api/admin/memory-config:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/memory-config
 *
 * Update memory configuration settings
 */
export async function PUT(request: NextRequest) {
  try {
    const { config } = await request.json();

    if (!config) {
      return NextResponse.json(
        { success: false, error: 'Configuration data is required' },
        { status: 400 }
      );
    }

    // Prepare upsert data for all config keys
    const upsertData: Array<{ key: string; value: string; category: string; description: string }> = [
      // Global configuration
      { key: 'memory_global_enabled', value: config.global.enabled.toString(), category: 'memory', description: 'Enable/disable entire memory system' },

      // Injection configuration
      { key: 'memory_injection_max_tokens', value: config.injection.max_tokens.toString(), category: 'memory', description: 'Maximum tokens to inject from memory' },
      { key: 'memory_injection_min_recent_runs', value: config.injection.min_recent_runs.toString(), category: 'memory', description: 'Minimum recent runs to include' },
      { key: 'memory_injection_max_recent_runs', value: config.injection.max_recent_runs.toString(), category: 'memory', description: 'Maximum recent runs to include' },
      { key: 'memory_injection_semantic_search_limit', value: config.injection.semantic_search_limit.toString(), category: 'memory', description: 'Number of semantic search results' },
      { key: 'memory_injection_semantic_threshold', value: config.injection.semantic_threshold.toString(), category: 'memory', description: 'Minimum similarity score (0.0-1.0)' },

      // Summarization configuration
      { key: 'memory_summarization_model', value: JSON.stringify(config.summarization.model), category: 'memory', description: 'Model to use for summarization' },
      { key: 'memory_summarization_temperature', value: config.summarization.temperature.toString(), category: 'memory', description: 'Model temperature (0.0-2.0)' },
      { key: 'memory_summarization_max_tokens', value: config.summarization.max_tokens.toString(), category: 'memory', description: 'Maximum tokens for summary' },
      { key: 'memory_summarization_input_truncate_chars', value: config.summarization.input_truncate_chars.toString(), category: 'memory', description: 'Maximum characters of input to include in summarization' },
      { key: 'memory_summarization_output_truncate_chars', value: config.summarization.output_truncate_chars.toString(), category: 'memory', description: 'Maximum characters of output to include in summarization' },
      { key: 'memory_summarization_recent_history_count', value: config.summarization.recent_history_count.toString(), category: 'memory', description: 'Number of recent runs to include in history' },
      { key: 'memory_summarization_recent_history_summary_chars', value: config.summarization.recent_history_summary_chars.toString(), category: 'memory', description: 'Maximum characters of each historical summary' },

      // Embedding configuration
      { key: 'memory_embedding_model', value: JSON.stringify(config.embedding.model), category: 'memory', description: 'Embedding model to use' },
      { key: 'memory_embedding_batch_size', value: config.embedding.batch_size.toString(), category: 'memory', description: 'Number of items to embed in one batch' },
      { key: 'memory_embedding_dimensions', value: config.embedding.dimensions.toString(), category: 'memory', description: 'Embedding vector dimensions' },

      // Importance scoring
      { key: 'memory_importance_base_score', value: config.importance.base_score.toString(), category: 'memory', description: 'Base importance score (0.0-1.0)' },
      { key: 'memory_importance_error_bonus', value: config.importance.error_bonus.toString(), category: 'memory', description: 'Bonus for error-related memories (0.0-1.0)' },
      { key: 'memory_importance_pattern_bonus', value: config.importance.pattern_bonus.toString(), category: 'memory', description: 'Bonus for pattern-related memories (0.0-1.0)' },
      { key: 'memory_importance_user_feedback_bonus', value: config.importance.user_feedback_bonus.toString(), category: 'memory', description: 'Bonus for user feedback (0.0-1.0)' },
      { key: 'memory_importance_first_run_bonus', value: config.importance.first_run_bonus.toString(), category: 'memory', description: 'Bonus for first-time patterns (0.0-1.0)' },
      { key: 'memory_importance_milestone_bonus', value: config.importance.milestone_bonus.toString(), category: 'memory', description: 'Bonus for milestone achievements (0.0-1.0)' },

      // Retention policy
      { key: 'memory_retention_run_memories_days', value: config.retention.run_memories_days.toString(), category: 'memory', description: 'Days to retain run memories' },
      { key: 'memory_retention_low_importance_days', value: config.retention.low_importance_days.toString(), category: 'memory', description: 'Days to retain low-importance memories' },
      { key: 'memory_retention_consolidation_threshold', value: config.retention.consolidation_threshold.toString(), category: 'memory', description: 'Number of memories before consolidation' },
      { key: 'memory_retention_consolidation_frequency_days', value: config.retention.consolidation_frequency_days.toString(), category: 'memory', description: 'How often to run consolidation' },

      // User Extraction
      { key: 'memory_user_extraction_model', value: JSON.stringify(config.user_extraction.model), category: 'memory', description: 'Model for user memory extraction' },
      { key: 'memory_user_extraction_temperature', value: config.user_extraction.temperature.toString(), category: 'memory', description: 'Temperature for extraction' },
      { key: 'memory_user_extraction_max_tokens', value: config.user_extraction.max_tokens.toString(), category: 'memory', description: 'Maximum tokens for extraction' },
      { key: 'memory_user_extraction_confidence_threshold', value: config.user_extraction.confidence_threshold.toString(), category: 'memory', description: 'Minimum confidence to store memory' },

      // Insights: Baseline & Anomaly Detection
      { key: 'insights_baseline_enabled', value: config.baseline.enabled.toString(), category: 'insights', description: 'Enable baseline & anomaly detection' },
      { key: 'insights_baseline_min_samples', value: config.baseline.min_samples.toString(), category: 'insights', description: 'Minimum samples before detection' },
      { key: 'insights_baseline_zscore_threshold', value: config.baseline.zscore_threshold.toString(), category: 'insights', description: 'Z-score threshold for anomaly' },
      { key: 'insights_baseline_zscore_warning', value: config.baseline.zscore_warning.toString(), category: 'insights', description: 'Z-score for warning severity' },
      { key: 'insights_baseline_zscore_critical', value: config.baseline.zscore_critical.toString(), category: 'insights', description: 'Z-score for critical severity' },
      { key: 'insights_baseline_step_deviation_threshold', value: config.baseline.step_deviation_threshold.toString(), category: 'insights', description: 'Step count deviation percent' },
      { key: 'insights_baseline_retry_deviation_threshold', value: config.baseline.retry_deviation_threshold.toString(), category: 'insights', description: 'Retry count deviation percent' },
      { key: 'insights_baseline_duration_spike_factor', value: config.baseline.duration_spike_factor.toString(), category: 'insights', description: 'Duration spike detection factor' },

      // Insights: Error Learning
      { key: 'insights_error_learning_enabled', value: config.error_learning.enabled.toString(), category: 'insights', description: 'Enable error pattern learning' },
      { key: 'insights_error_learning_min_occurrences', value: config.error_learning.min_occurrences.toString(), category: 'insights', description: 'Min occurrences before suggesting fix' },
      { key: 'insights_error_learning_min_success_rate', value: config.error_learning.min_success_rate.toString(), category: 'insights', description: 'Min success rate to keep auto-fix' },
      { key: 'insights_error_learning_min_attempts_for_evaluation', value: config.error_learning.min_attempts_for_evaluation.toString(), category: 'insights', description: 'Min attempts before evaluating' },

      // Insights: Plugin Performance
      { key: 'insights_plugin_performance_enabled', value: config.plugin_performance.enabled.toString(), category: 'insights', description: 'Enable plugin performance tracking' },
      { key: 'insights_plugin_performance_min_executions_agent', value: config.plugin_performance.min_executions_agent.toString(), category: 'insights', description: 'Min executions per agent' },
      { key: 'insights_plugin_performance_min_executions_userwide', value: config.plugin_performance.min_executions_userwide.toString(), category: 'insights', description: 'Min executions user-wide' },
      { key: 'insights_plugin_performance_success_drop_factor', value: config.plugin_performance.success_drop_factor.toString(), category: 'insights', description: 'Success rate drop detection' },
      { key: 'insights_plugin_performance_duration_spike_factor', value: config.plugin_performance.duration_spike_factor.toString(), category: 'insights', description: 'Duration spike factor' },
      { key: 'insights_plugin_performance_duration_critical_factor', value: config.plugin_performance.duration_critical_factor.toString(), category: 'insights', description: 'Critical duration spike factor' },
      { key: 'insights_plugin_performance_error_rate_threshold', value: config.plugin_performance.error_rate_threshold.toString(), category: 'insights', description: 'Error rate alert threshold' },

      // Insights: Pattern Learning
      { key: 'insights_pattern_learning_enabled', value: config.pattern_learning.enabled.toString(), category: 'insights', description: 'Enable pattern learning' },
      { key: 'insights_pattern_learning_min_executions', value: config.pattern_learning.min_executions.toString(), category: 'insights', description: 'Min executions for pattern' },
      { key: 'insights_pattern_learning_min_success_rate', value: config.pattern_learning.min_success_rate.toString(), category: 'insights', description: 'Min success rate for pattern' },

      // Insights: Intent Examples
      { key: 'insights_intent_examples_enabled', value: config.intent_examples.enabled.toString(), category: 'insights', description: 'Enable V6 intent examples' },
      { key: 'insights_intent_examples_default_limit', value: config.intent_examples.default_limit.toString(), category: 'insights', description: 'Default examples to fetch' },
      { key: 'insights_intent_examples_max_limit', value: config.intent_examples.max_limit.toString(), category: 'insights', description: 'Max examples allowed' },
    ];

    // Upsert all settings
    const { error } = await supabase
      .from('system_settings_config')
      .upsert(
        upsertData.map(item => ({ ...item, updated_at: new Date().toISOString() })),
        { onConflict: 'key' }
      );

    if (error) {
      console.error('Error saving memory config:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to save configuration' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Memory configuration saved successfully'
    });
  } catch (error: any) {
    console.error('Exception in PUT /api/admin/memory-config:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

