// app/api/admin/orchestration-config/route.ts
// API endpoint for managing orchestration configuration (unified routing system)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/orchestration-config
 * Fetch current orchestration configuration
 */
export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch system settings for orchestration and pilot
    const { data: settings, error: settingsError } = await supabase
      .from('system_settings_config')
      .select('key, value')
      .or(
        'key.like.orchestration%,' +
        'key.like.pilot_%,' +
        'key.like.agentkit_%,' +
        'key.like.token_budget%,' +
        'category.eq.orchestration,' +
        'category.eq.pilot,' +
        'category.eq.agentkit_protection'
      );

    if (settingsError) {
      console.error('[Orchestration Config API] Error fetching settings:', settingsError);
      return NextResponse.json(
        { success: false, error: settingsError.message },
        { status: 500 }
      );
    }

    // Fetch complexity configuration from ais_system_config
    const { data: aisConfig, error: aisError } = await supabase
      .from('ais_system_config')
      .select('config_key, config_value')
      .or(
        'config_key.like.pilot_complexity%'
      );

    if (aisError) {
      console.error('[Orchestration Config API] Error fetching AIS config:', aisError);
      return NextResponse.json(
        { success: false, error: aisError.message },
        { status: 500 }
      );
    }

    // Parse settings into config object
    const config: any = {
      enabled: false,
      compressionEnabled: false,
      aisRoutingEnabled: false,
      modelFast: 'claude-3-haiku-20240307',
      modelBalanced: 'gpt-4o-mini',
      modelPowerful: 'claude-3-5-sonnet-20241022',
      fastTierMaxScore: 3.0,
      balancedTierMaxScore: 6.5,
      routingStrategy: {
        aisWeight: 0.6,
        stepWeight: 0.4,
      },
      agentkit: {
        defaultModel: 'gpt-4o-mini',
        temperature: 0.1,
        maxIterations: 10,
        timeoutMs: 120000,
      },
      pilot: {
        enabled: false,
        maxSteps: 50,
        maxExecutionTimeMs: 300000,
        maxParallelSteps: 3,
        retryEnabled: true,
        defaultRetryCount: 3,
        circuitBreakerThreshold: 5,
        checkpointEnabled: true,
        retentionDays: 90,
        maxToolResponseChars: 8000,
        loopDetectionWindow: 3,
        maxSameToolRepeats: 3,
        maxTokensPerIteration: 50000,
        maxTotalExecutionTokens: 200000,
        enableCaching: false,
        continueOnError: false,
        enableProgressTracking: true,
        enableRealTimeUpdates: false,
        enableOptimizations: true,
        cacheStepResults: false,
      },
      tokenBudgets: {
        extract: 1000,
        summarize: 2000,
        generate: 3000,
        validate: 1500,
        send: 500,
        transform: 2000,
        conditional: 1000,
        aggregate: 2500,
        filter: 1000,
        enrich: 2000,
      },
      compressionTargetRatio: 0.5,
      compressionMinQuality: 0.8,
      compressionAggressiveness: 'medium',
      maxTokensPerStep: 10000,
      maxTokensPerWorkflow: 50000,
      budgetOverageAllowed: true,
      budgetOverageThreshold: 1.2,
      budgetAllocationStrategy: 'proportional',
      criticalStepMultiplier: 1.5,
    };

    // Map settings to config
    settings?.forEach((setting) => {
      const value = setting.value;
      switch (setting.key) {
        case 'orchestration_enabled':
          config.enabled = value === 'true' || value === true;
          break;
        case 'orchestration_compression_enabled':
          config.compressionEnabled = value === 'true' || value === true;
          break;
        case 'orchestration_ais_routing_enabled':
          config.aisRoutingEnabled = value === 'true' || value === true;
          break;
        case 'orchestration_routing_model_fast':
          config.modelFast = value?.replace(/"/g, '') || config.modelFast;
          break;
        case 'orchestration_routing_model_balanced':
          config.modelBalanced = value?.replace(/"/g, '') || config.modelBalanced;
          break;
        case 'orchestration_routing_model_powerful':
          config.modelPowerful = value?.replace(/"/g, '') || config.modelPowerful;
          break;
        case 'orchestration_routing_fast_tier_max_score':
          config.fastTierMaxScore = parseFloat(value) || 3.0;
          break;
        case 'orchestration_routing_balanced_tier_max_score':
          config.balancedTierMaxScore = parseFloat(value) || 6.5;
          break;
        case 'orchestration_routing_strategy_balanced':
          try {
            const strategy = JSON.parse(value);
            config.routingStrategy = strategy;
          } catch {
            // Keep default
          }
          break;
        // Token budgets
        case 'orchestration_token_budget_extract':
          config.tokenBudgets.extract = parseInt(value) || 1000;
          break;
        case 'orchestration_token_budget_summarize':
          config.tokenBudgets.summarize = parseInt(value) || 2000;
          break;
        case 'orchestration_token_budget_generate':
          config.tokenBudgets.generate = parseInt(value) || 3000;
          break;
        case 'orchestration_token_budget_validate':
          config.tokenBudgets.validate = parseInt(value) || 1500;
          break;
        case 'orchestration_token_budget_send':
          config.tokenBudgets.send = parseInt(value) || 500;
          break;
        case 'orchestration_token_budget_transform':
          config.tokenBudgets.transform = parseInt(value) || 2000;
          break;
        case 'orchestration_token_budget_conditional':
          config.tokenBudgets.conditional = parseInt(value) || 1000;
          break;
        case 'orchestration_token_budget_aggregate':
          config.tokenBudgets.aggregate = parseInt(value) || 2500;
          break;
        case 'orchestration_token_budget_filter':
          config.tokenBudgets.filter = parseInt(value) || 1000;
          break;
        case 'orchestration_token_budget_enrich':
          config.tokenBudgets.enrich = parseInt(value) || 2000;
          break;
        // Compression
        case 'orchestration_compression_target_ratio':
          config.compressionTargetRatio = parseFloat(value) || 0.5;
          break;
        case 'orchestration_compression_min_quality':
          config.compressionMinQuality = parseFloat(value) || 0.8;
          break;
        case 'orchestration_compression_aggressiveness':
          config.compressionAggressiveness = value?.replace(/"/g, '') || 'medium';
          break;
        // Budget
        case 'orchestration_max_tokens_per_step':
          config.maxTokensPerStep = parseInt(value) || 10000;
          break;
        case 'orchestration_max_tokens_per_workflow':
          config.maxTokensPerWorkflow = parseInt(value) || 50000;
          break;
        case 'orchestration_budget_overage_allowed':
          config.budgetOverageAllowed = value === 'true' || value === true;
          break;
        case 'orchestration_budget_overage_threshold':
          config.budgetOverageThreshold = parseFloat(value) || 1.2;
          break;
        case 'orchestration_budget_allocation_strategy':
          config.budgetAllocationStrategy = value?.replace(/"/g, '') || 'proportional';
          break;
        // Pilot configuration
        case 'pilot_enabled':
          config.pilot.enabled = value === 'true' || value === true;
          break;
        case 'pilot_max_steps':
          config.pilot.maxSteps = parseInt(value) || 50;
          break;
        case 'pilot_max_execution_time_ms':
          config.pilot.maxExecutionTimeMs = parseInt(value) || 300000;
          break;
        case 'pilot_max_parallel_steps':
          config.pilot.maxParallelSteps = parseInt(value) || 3;
          break;
        case 'pilot_retry_enabled':
          config.pilot.retryEnabled = value === 'true' || value === true;
          break;
        case 'pilot_default_retry_count':
          config.pilot.defaultRetryCount = parseInt(value) || 3;
          break;
        case 'pilot_circuit_breaker_threshold':
          config.pilot.circuitBreakerThreshold = parseInt(value) || 5;
          break;
        case 'pilot_checkpoint_enabled':
          config.pilot.checkpointEnabled = value === 'true' || value === true;
          break;
        case 'pilot_retention_days':
          config.pilot.retentionDays = parseInt(value) || 90;
          break;
        case 'agentkit_max_tool_response_chars':
          config.pilot.maxToolResponseChars = parseInt(value) || 8000;
          break;
        case 'agentkit_loop_detection_window':
          config.pilot.loopDetectionWindow = parseInt(value) || 3;
          break;
        case 'agentkit_max_same_tool_repeats':
          config.pilot.maxSameToolRepeats = parseInt(value) || 3;
          break;
        case 'agentkit_max_tokens_per_iteration':
          config.pilot.maxTokensPerIteration = parseInt(value) || 50000;
          break;
        case 'agentkit_max_total_execution_tokens':
          config.pilot.maxTotalExecutionTokens = parseInt(value) || 200000;
          break;
        // AgentKit Core Configuration
        case 'agentkit_default_model':
          config.agentkit.defaultModel = value?.replace(/"/g, '') || 'gpt-4o-mini';
          break;
        case 'agentkit_temperature':
          config.agentkit.temperature = parseFloat(value) || 0.1;
          break;
        case 'agentkit_max_iterations':
          config.agentkit.maxIterations = parseInt(value) || 10;
          break;
        case 'agentkit_timeout_ms':
          config.agentkit.timeoutMs = parseInt(value) || 120000;
          break;
        // Pilot Workflow Execution Options
        case 'pilot_enable_caching':
          config.pilot.enableCaching = value === 'true' || value === true;
          break;
        case 'pilot_continue_on_error':
          config.pilot.continueOnError = value === 'true' || value === true;
          break;
        case 'pilot_enable_progress_tracking':
          config.pilot.enableProgressTracking = value === 'true' || value === true;
          break;
        case 'pilot_enable_real_time_updates':
          config.pilot.enableRealTimeUpdates = value === 'true' || value === true;
          break;
        case 'pilot_enable_optimizations':
          config.pilot.enableOptimizations = value === 'true' || value === true;
          break;
        case 'pilot_cache_step_results':
          config.pilot.cacheStepResults = value === 'true' || value === true;
          break;
        // Token Budget Advanced
        case 'token_budget_critical_step_multiplier':
          config.criticalStepMultiplier = parseFloat(value) || 1.5;
          break;
      }
    });

    // Parse complexity weights and thresholds
    const complexityWeights: any = {};
    const complexityThresholds: any = {};

    aisConfig?.forEach((item) => {
      try {
        const value = JSON.parse(item.config_value);
        const key = item.config_key;

        if (key.startsWith('pilot_complexity_weights_')) {
          const type = key.replace('pilot_complexity_weights_', '');
          complexityWeights[type] = value;
        } else if (key.startsWith('pilot_complexity_thresholds_')) {
          const factor = key.replace('pilot_complexity_thresholds_', '');
          complexityThresholds[factor] = value;
        }
      } catch (err) {
        console.warn('[Orchestration Config API] Failed to parse:', item.config_key, err);
      }
    });

    return NextResponse.json({
      success: true,
      config,
      complexityWeights,
      complexityThresholds,
    });
  } catch (error) {
    console.error('[Orchestration Config API] Exception:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/orchestration-config
 * Update orchestration configuration
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await request.json();
    const { config, complexityWeights, complexityThresholds } = body;

    if (!config) {
      return NextResponse.json(
        { success: false, error: 'Missing config in request body' },
        { status: 400 }
      );
    }

    // Update system_settings_config
    const settingsToUpdate = [
      { key: 'orchestration_enabled', value: config.enabled },
      { key: 'orchestration_compression_enabled', value: config.compressionEnabled },
      { key: 'orchestration_ais_routing_enabled', value: config.aisRoutingEnabled },
      { key: 'orchestration_routing_model_fast', value: `"${config.modelFast}"` },
      { key: 'orchestration_routing_model_balanced', value: `"${config.modelBalanced}"` },
      { key: 'orchestration_routing_model_powerful', value: `"${config.modelPowerful}"` },
      { key: 'orchestration_routing_fast_tier_max_score', value: config.fastTierMaxScore.toString() },
      { key: 'orchestration_routing_balanced_tier_max_score', value: config.balancedTierMaxScore.toString() },
      { key: 'orchestration_routing_strategy_balanced', value: JSON.stringify(config.routingStrategy) },
      // Token budgets
      { key: 'orchestration_token_budget_extract', value: config.tokenBudgets.extract.toString() },
      { key: 'orchestration_token_budget_summarize', value: config.tokenBudgets.summarize.toString() },
      { key: 'orchestration_token_budget_generate', value: config.tokenBudgets.generate.toString() },
      { key: 'orchestration_token_budget_validate', value: config.tokenBudgets.validate.toString() },
      { key: 'orchestration_token_budget_send', value: config.tokenBudgets.send.toString() },
      { key: 'orchestration_token_budget_transform', value: config.tokenBudgets.transform.toString() },
      { key: 'orchestration_token_budget_conditional', value: config.tokenBudgets.conditional.toString() },
      { key: 'orchestration_token_budget_aggregate', value: config.tokenBudgets.aggregate.toString() },
      { key: 'orchestration_token_budget_filter', value: config.tokenBudgets.filter.toString() },
      { key: 'orchestration_token_budget_enrich', value: config.tokenBudgets.enrich.toString() },
      // Compression
      { key: 'orchestration_compression_target_ratio', value: config.compressionTargetRatio.toString() },
      { key: 'orchestration_compression_min_quality', value: config.compressionMinQuality.toString() },
      { key: 'orchestration_compression_aggressiveness', value: `"${config.compressionAggressiveness}"` },
      // Budget
      { key: 'orchestration_max_tokens_per_step', value: config.maxTokensPerStep.toString() },
      { key: 'orchestration_max_tokens_per_workflow', value: config.maxTokensPerWorkflow.toString() },
      { key: 'orchestration_budget_overage_allowed', value: config.budgetOverageAllowed },
      { key: 'orchestration_budget_overage_threshold', value: config.budgetOverageThreshold.toString() },
      { key: 'orchestration_budget_allocation_strategy', value: `"${config.budgetAllocationStrategy}"` },
      // Pilot configuration
      { key: 'pilot_enabled', value: config.pilot.enabled },
      { key: 'pilot_max_steps', value: config.pilot.maxSteps.toString() },
      { key: 'pilot_max_execution_time_ms', value: config.pilot.maxExecutionTimeMs.toString() },
      { key: 'pilot_max_parallel_steps', value: config.pilot.maxParallelSteps.toString() },
      { key: 'pilot_retry_enabled', value: config.pilot.retryEnabled },
      { key: 'pilot_default_retry_count', value: config.pilot.defaultRetryCount.toString() },
      { key: 'pilot_circuit_breaker_threshold', value: config.pilot.circuitBreakerThreshold.toString() },
      { key: 'pilot_checkpoint_enabled', value: config.pilot.checkpointEnabled },
      { key: 'pilot_retention_days', value: config.pilot.retentionDays.toString() },
      { key: 'agentkit_max_tool_response_chars', value: config.pilot.maxToolResponseChars.toString() },
      { key: 'agentkit_loop_detection_window', value: config.pilot.loopDetectionWindow.toString() },
      { key: 'agentkit_max_same_tool_repeats', value: config.pilot.maxSameToolRepeats.toString() },
      { key: 'agentkit_max_tokens_per_iteration', value: config.pilot.maxTokensPerIteration.toString() },
      { key: 'agentkit_max_total_execution_tokens', value: config.pilot.maxTotalExecutionTokens.toString() },
      // AgentKit Core Configuration
      { key: 'agentkit_default_model', value: `"${config.agentkit.defaultModel}"` },
      { key: 'agentkit_temperature', value: config.agentkit.temperature.toString() },
      { key: 'agentkit_max_iterations', value: config.agentkit.maxIterations.toString() },
      { key: 'agentkit_timeout_ms', value: config.agentkit.timeoutMs.toString() },
      // Pilot Workflow Execution Options
      { key: 'pilot_enable_caching', value: config.pilot.enableCaching },
      { key: 'pilot_continue_on_error', value: config.pilot.continueOnError },
      { key: 'pilot_enable_progress_tracking', value: config.pilot.enableProgressTracking },
      { key: 'pilot_enable_real_time_updates', value: config.pilot.enableRealTimeUpdates },
      { key: 'pilot_enable_optimizations', value: config.pilot.enableOptimizations },
      { key: 'pilot_cache_step_results', value: config.pilot.cacheStepResults },
      // Token Budget Advanced
      { key: 'token_budget_critical_step_multiplier', value: config.criticalStepMultiplier.toString() },
    ];

    // Upsert all settings
    for (const setting of settingsToUpdate) {
      const { error } = await supabase
        .from('system_settings_config')
        .upsert(
          {
            key: setting.key,
            value: setting.value,
            category: 'orchestration',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );

      if (error) {
        console.error(`[Orchestration Config API] Failed to update ${setting.key}:`, error);
        return NextResponse.json(
          { success: false, error: `Failed to update ${setting.key}: ${error.message}` },
          { status: 500 }
        );
      }
    }

    // Update complexity weights in ais_system_config
    if (complexityWeights) {
      for (const [type, weights] of Object.entries(complexityWeights)) {
        const { error } = await supabase
          .from('ais_system_config')
          .upsert(
            {
              config_key: `pilot_complexity_weights_${type}`,
              config_value: JSON.stringify(weights),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'config_key' }
          );

        if (error) {
          console.error(`[Orchestration Config API] Failed to update weights for ${type}:`, error);
        }
      }
    }

    // Update complexity thresholds in ais_system_config
    if (complexityThresholds) {
      for (const [factor, threshold] of Object.entries(complexityThresholds)) {
        const { error } = await supabase
          .from('ais_system_config')
          .upsert(
            {
              config_key: `pilot_complexity_thresholds_${factor}`,
              config_value: JSON.stringify(threshold),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'config_key' }
          );

        if (error) {
          console.error(`[Orchestration Config API] Failed to update threshold for ${factor}:`, error);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Orchestration configuration updated successfully',
    });
  } catch (error) {
    console.error('[Orchestration Config API] Exception:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
