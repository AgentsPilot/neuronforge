// app/api/pricing/config/route.ts
// API endpoint to fetch pricing configuration from ais_system_config table

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for consistent access
    );

    console.log('📊 [Pricing Config] Fetching calculator configuration from ais_system_config...');

    // NEW: Fetch from calculator_config view (reads from ais_system_config table)
    const { data, error } = await supabase
      .from('calculator_config')
      .select('*')
      .single();

    if (error) {
      console.error('❌ [Pricing Config] Error fetching calculator config:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch calculator configuration: ' + error.message },
        { status: 500 }
      );
    }

    if (!data) {
      console.error('❌ [Pricing Config] No calculator configuration found');
      return NextResponse.json(
        { success: false, error: 'No calculator configuration found' },
        { status: 404 }
      );
    }

    console.log('✅ [Pricing Config] Raw data received from calculator_config view');

    // Transform view data to match expected calculator format
    const config = {
      // Calculator estimation formulas
      calculatorEstimation: {
        baseTokens: parseFloat(data.base_tokens ?? 0),
        tokensPerPlugin: parseFloat(data.tokens_per_plugin ?? 0),
        peakMultiplier: parseFloat(data.peak_multiplier ?? 0),
        baseIterations: parseFloat(data.base_iterations ?? 0),
        maxIterations: parseFloat(data.max_iterations ?? 0),
        pluginUsageRate: parseFloat(data.plugin_usage_rate ?? 0),
        orchestrationOverheadMs: parseFloat(data.orchestration_overhead_ms ?? 0),
        estimatedDurationMs: parseFloat(data.estimated_duration_ms ?? 0),
        estimatedFailureRate: parseFloat(data.estimated_failure_rate ?? 0),
        estimatedRetryRate: parseFloat(data.estimated_retry_rate ?? 0),
        ioRatio: parseFloat(data.io_ratio ?? 0),
      },

      // AIS dimension weights
      aisWeights: {
        tokens: parseFloat(data.weight_tokens || 0.35),
        execution: parseFloat(data.weight_execution || 0.25),
        plugins: parseFloat(data.weight_plugins || 0.25),
        workflow: parseFloat(data.weight_workflow || 0.15),
      },

      // AIS sub-dimension weights (both formats for compatibility)
      aisSubWeights: {
        token: {
          volume: parseFloat(data.token_volume_weight || 0.5),
          peak: parseFloat(data.token_peak_weight || 0.3),
          io: parseFloat(data.token_io_weight || 0.2),
        },
        execution: {
          iterations: parseFloat(data.execution_iterations_weight || 0.35),
          duration: parseFloat(data.execution_duration_weight || 0.30),
          failure: parseFloat(data.execution_failure_weight || 0.20),
          retry: parseFloat(data.execution_retry_weight || 0.15),
        },
        plugin: {
          count: parseFloat(data.plugin_count_weight || 0.4),
          usage: parseFloat(data.plugin_usage_weight || 0.35),
          overhead: parseFloat(data.plugin_overhead_weight || 0.25),
        },
        workflow: {
          steps: parseFloat(data.workflow_steps_weight || 0.4),
          branches: parseFloat(data.workflow_branches_weight || 0.25),
          loops: parseFloat(data.workflow_loops_weight || 0.20),
          parallel: parseFloat(data.workflow_parallel_weight || 0.15),
        },
      },

      // Alternative naming for frontend compatibility
      tokenSubWeights: {
        volume: parseFloat(data.token_volume_weight || 0.5),
        peak: parseFloat(data.token_peak_weight || 0.3),
        io: parseFloat(data.token_io_weight || 0.2),
      },
      executionSubWeights: {
        iterations: parseFloat(data.execution_iterations_weight || 0.35),
        duration: parseFloat(data.execution_duration_weight || 0.30),
        failure: parseFloat(data.execution_failure_weight || 0.20),
        retry: parseFloat(data.execution_retry_weight || 0.15),
      },
      pluginSubWeights: {
        count: parseFloat(data.plugin_count_weight || 0.4),
        usage: parseFloat(data.plugin_usage_weight || 0.35),
        overhead: parseFloat(data.plugin_overhead_weight || 0.25),
      },
      workflowSubWeights: {
        steps: parseFloat(data.workflow_steps_weight || 0.4),
        branches: parseFloat(data.workflow_branches_weight || 0.25),
        loops: parseFloat(data.workflow_loops_weight || 0.20),
        parallel: parseFloat(data.workflow_parallel_weight || 0.15),
      },

      // System limits (need to fetch from ais_system_config separately since not in view)
      minAgentIntensity: 0.0,
      maxAgentIntensity: 10.0,
      minExecutionsForScore: 5,

      // Pricing parameters (legacy field names for backward compatibility)
      baseCreditsPerRun: parseFloat(data.base_credits_per_run ?? 0),
      pluginOverheadPerRun: parseFloat(data.plugin_overhead_per_run ?? 0),
      systemOverheadPerRun: parseFloat(data.system_overhead_per_run ?? 0),
      runsPerAgentPerMonth: parseFloat(data.runs_per_agent_per_month ?? 0),
      creditCostUsd: parseFloat(data.credit_cost_usd ?? 0),
      minimumMonthlyCostUsd: parseFloat(data.minimum_monthly_cost_usd ?? 0),
      agentCreationCost: parseFloat(data.agent_creation_cost ?? 0),
      executionStepMultiplier: parseFloat(data.execution_step_multiplier ?? 0),
      freeTierCredits: parseFloat(data.free_tier_credits ?? 0),

      // Empty arrays for backward compatibility (not used by new calculator)
      aisTiers: [],
      executionStepsByPlugins: []
    };

    // Fetch system limits separately (not in calculator_config view)
    console.log('🔍 [Pricing Config] Fetching system limits...');

    // Create a fresh Supabase client with global options to disable caching
    const freshSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        global: {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        }
      }
    );

    // Bypass Supabase query caching by ordering by updated_at DESC
    // This makes each query slightly different and prevents caching
    const { data: limitsData, error: limitsError } = await freshSupabase
      .from('ais_system_config')
      .select('config_key, config_value')
      .in('config_key', ['min_agent_intensity', 'max_agent_intensity', 'min_executions_for_score'])
      .order('updated_at', { ascending: false });

    if (limitsError) {
      console.error('❌ [Pricing Config] Error fetching limits:', limitsError);
    }

    console.log('📊 [Pricing Config] Raw limitsData from DB:', JSON.stringify(limitsData, null, 2));
    console.log('📊 [Pricing Config] Number of rows:', limitsData?.length);

    if (limitsData) {
      limitsData.forEach((item, index) => {
        console.log(`📊 [Pricing Config] Processing row ${index}:`, JSON.stringify(item));
        if (item.config_key === 'min_agent_intensity') {
          const rawValue = item.config_value;
          const parsedValue = parseFloat(rawValue || 0);
          console.log(`  🔍 min_agent_intensity: raw=${rawValue} (type=${typeof rawValue}), parsed=${parsedValue}`);
          config.minAgentIntensity = parsedValue;
          console.log(`  ✅ Set minAgentIntensity = ${config.minAgentIntensity}`);
        } else if (item.config_key === 'max_agent_intensity') {
          const rawValue = item.config_value;
          const parsedValue = parseFloat(rawValue || 10);
          console.log(`  🔍 max_agent_intensity: raw=${rawValue} (type=${typeof rawValue}), parsed=${parsedValue}`);
          config.maxAgentIntensity = parsedValue;
          console.log(`  ✅ Set maxAgentIntensity = ${config.maxAgentIntensity}`);
        } else if (item.config_key === 'min_executions_for_score') {
          const rawValue = item.config_value;
          const parsedValue = parseInt(rawValue || 5);
          console.log(`  🔍 min_executions_for_score: raw=${rawValue} (type=${typeof rawValue}), parsed=${parsedValue}`);
          config.minExecutionsForScore = parsedValue;
          console.log(`  ✅ Set minExecutionsForScore = ${config.minExecutionsForScore}`);
        }
      });
    }

    console.log('📊 [Pricing Config] Final config values:');
    console.log(`  minAgentIntensity: ${config.minAgentIntensity}`);
    console.log(`  maxAgentIntensity: ${config.maxAgentIntensity}`);
    console.log(`  minExecutionsForScore: ${config.minExecutionsForScore}`);

    console.log('✅ [Pricing Config] Returning config with', Object.keys(config).length, 'fields');
    console.log('📊 [Pricing Config] AIS weights sum:',
      config.aisWeights.tokens +
      config.aisWeights.execution +
      config.aisWeights.plugins +
      config.aisWeights.workflow
    );

    const response = NextResponse.json({
      success: true,
      config
    });

    // Prevent caching to ensure fresh data
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');

    return response;
  } catch (error) {
    console.error('❌ [Pricing Config] API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
