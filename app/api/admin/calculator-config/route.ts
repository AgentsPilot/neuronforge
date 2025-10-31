// app/api/admin/calculator-config/route.ts
// API endpoint to update calculator configuration

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await request.json();
    const { updates } = body;

    console.log('📊 [Calculator Config] Updating calculator configuration:', updates);

    // Map frontend keys to database keys
    const configMap: Record<string, string> = {
      // Token estimation
      baseTokens: 'calculator_base_tokens',
      tokensPerPlugin: 'calculator_tokens_per_plugin',
      peakMultiplier: 'calculator_peak_multiplier',
      pluginUsageRate: 'calculator_plugin_usage_rate',
      orchestrationOverheadMs: 'calculator_orchestration_overhead_ms',
      estimatedDurationMs: 'calculator_estimated_duration_ms',
      estimatedFailureRate: 'calculator_estimated_failure_rate',
      estimatedRetryRate: 'calculator_estimated_retry_rate',
      ioRatio: 'calculator_io_ratio',
      // Execution parameters
      baseIterations: 'calculator_base_iterations',
      maxIterations: 'calculator_max_iterations',
      // Pricing parameters
      runsPerAgentPerMonth: 'runs_per_agent_per_month',
      agentCreationCost: 'agent_creation_cost',
      creditCostUsd: 'pilot_credit_cost_usd',
      minimumMonthlyCostUsd: 'min_subscription_usd',
      baseCreditsPerRun: 'base_credits_per_run',
      pluginOverheadPerRun: 'plugin_overhead_per_run',
      systemOverheadPerRun: 'system_overhead_per_run',
      executionStepMultiplier: 'execution_step_multiplier',
      freeTierCredits: 'free_tier_credits'
    };

    const errors = [];
    const successes = [];

    // Update each config value
    for (const [key, value] of Object.entries(updates)) {
      const dbKey = configMap[key];

      if (!dbKey) {
        console.warn(`⚠️ Unknown config key: ${key}`);
        errors.push(`Unknown config key: ${key}`);
        continue;
      }

      console.log(`  Updating ${dbKey} = ${value}`);

      const { error } = await supabase
        .from('ais_system_config')
        .update({ config_value: value })
        .eq('config_key', dbKey);

      if (error) {
        console.error(`❌ Failed to update ${dbKey}:`, error);
        errors.push(`Failed to update ${key}: ${error.message}`);
      } else {
        successes.push(key);
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        error: errors.join(', '),
        partial: successes.length > 0,
        updated: successes
      }, { status: 500 });
    }

    console.log(`✅ [Calculator Config] Successfully updated ${successes.length} values`);

    return NextResponse.json({
      success: true,
      message: `Updated ${successes.length} configuration values`,
      updated: successes
    });

  } catch (error) {
    console.error('❌ [Calculator Config] API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}
