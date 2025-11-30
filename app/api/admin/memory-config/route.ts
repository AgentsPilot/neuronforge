// app/api/admin/memory-config/route.ts
// Admin API for managing memory system configuration

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
 * Fetch all memory configuration settings
 */
export async function GET() {
  try {
    // Fetch memory configuration from system_settings_config
    const { data: settings, error } = await supabase
      .from('system_settings_config')
      .select('key, value')
      .or('key.like.memory_%,key.like.learning_%');

    if (error) {
      console.error('Error fetching memory config:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch configuration' },
        { status: 500 }
      );
    }

    // Parse settings into structured config with defaults
    const config = {
      global: {
        enabled: true,
        debug_mode: false
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
        async: true,
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
        if (key === 'memory_global_debug_mode') config.global.debug_mode = parsedValue === 'true' || parsedValue === true;

        if (key === 'memory_injection_max_tokens') config.injection.max_tokens = parsedValue;
        if (key === 'memory_injection_min_recent_runs') config.injection.min_recent_runs = parsedValue;
        if (key === 'memory_injection_max_recent_runs') config.injection.max_recent_runs = parsedValue;
        if (key === 'memory_injection_semantic_search_limit') config.injection.semantic_search_limit = parsedValue;
        if (key === 'memory_injection_semantic_threshold') config.injection.semantic_threshold = parsedValue;

        if (key === 'memory_summarization_model') config.summarization.model = parsedValue;
        if (key === 'memory_summarization_temperature') config.summarization.temperature = parsedValue;
        if (key === 'memory_summarization_max_tokens') config.summarization.max_tokens = parsedValue;
        if (key === 'memory_summarization_async') config.summarization.async = parsedValue === 'true' || parsedValue === true;
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
    const upsertData = [
      // Global configuration
      { key: 'memory_global_enabled', value: config.global.enabled.toString(), category: 'memory', description: 'Enable/disable entire memory system' },
      { key: 'memory_global_debug_mode', value: config.global.debug_mode.toString(), category: 'memory', description: 'Enable verbose logging for memory operations' },

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
      { key: 'memory_summarization_async', value: config.summarization.async.toString(), category: 'memory', description: 'Process summarization asynchronously' },
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
      { key: 'memory_retention_consolidation_frequency_days', value: config.retention.consolidation_frequency_days.toString(), category: 'memory', description: 'How often to run consolidation' }
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

