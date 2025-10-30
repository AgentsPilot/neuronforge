// app/api/pricing/config/route.ts
// API endpoint to fetch pricing configuration from database

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

    console.log('📊 [Pricing Config] Fetching pricing configuration...');

    // Fetch pricing config using the database function
    const { data, error } = await supabase.rpc('get_pricing_config').single();

    if (error) {
      console.error('❌ [Pricing Config] Error fetching pricing config:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch pricing configuration: ' + error.message },
        { status: 500 }
      );
    }

    if (!data) {
      console.error('❌ [Pricing Config] No pricing configuration found');
      return NextResponse.json(
        { success: false, error: 'No pricing configuration found' },
        { status: 404 }
      );
    }

    console.log('✅ [Pricing Config] Raw data received:', data);

    // Type assertion for the data structure
    const configData = data as any;

    // Parse AIS tiers - the database returns JSONB which needs to be converted to array
    let aisTiers: any[] = [];
    if (configData.ais_tiers) {
      try {
        const tiersData = typeof configData.ais_tiers === 'string'
          ? JSON.parse(configData.ais_tiers)
          : configData.ais_tiers;

        if (Array.isArray(tiersData)) {
          aisTiers = tiersData.map((tier: any) => ({
            min: parseInt(tier.min),
            max: parseInt(tier.max),
            score: parseFloat(tier.score)
          }));
        }
      } catch (e) {
        console.error('Error parsing AIS tiers:', e);
      }
    }

    // Parse execution steps by plugins
    let executionStepsByPlugins: any[] = [];
    if (configData.execution_steps_by_plugins) {
      try {
        const stepsData = typeof configData.execution_steps_by_plugins === 'string'
          ? JSON.parse(configData.execution_steps_by_plugins)
          : configData.execution_steps_by_plugins;

        if (Array.isArray(stepsData)) {
          executionStepsByPlugins = stepsData.map((item: any) => ({
            plugins: parseInt(item.plugins),
            steps: parseFloat(item.steps)
          }));
        }
      } catch (e) {
        console.error('Error parsing execution steps:', e);
      }
    }

    const config = {
      baseCreditsPerRun: parseFloat(configData.base_credits_per_run),
      pluginOverheadPerRun: parseFloat(configData.plugin_overhead_per_run),
      systemOverheadPerRun: parseFloat(configData.system_overhead_per_run),
      runsPerAgentPerMonth: parseFloat(configData.runs_per_agent_per_month),
      creditCostUsd: parseFloat(configData.credit_cost_usd),
      minimumMonthlyCostUsd: parseFloat(configData.minimum_monthly_cost_usd),
      agentCreationCost: parseFloat(configData.agent_creation_cost || 800),
      executionStepMultiplier: parseFloat(configData.execution_step_multiplier || 1.3),
      aisTiers,
      executionStepsByPlugins
    };

    console.log('✅ [Pricing Config] Returning config:', config);

    return NextResponse.json({
      success: true,
      config
    });
  } catch (error) {
    console.error('Pricing config API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
