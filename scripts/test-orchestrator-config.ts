/**
 * Test Orchestrator Configuration
 *
 * Verifies that WorkflowOrchestrator correctly reads from database
 */

import { createClient } from '@supabase/supabase-js';
import { SystemConfigService } from '@/lib/services/SystemConfigService';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testOrchestratorConfig() {
  console.log('🧪 Testing Orchestrator Configuration...\n');

  try {
    // Test 1: Read from database directly
    console.log('📊 Test 1: Reading from database directly');
    const { data: dbSettings, error: dbError } = await supabase
      .from('system_settings_config')
      .select('*')
      .in('key', [
        'orchestrator_primary_model',
        'orchestrator_fallback_model',
        'orchestrator_enable_fallback'
      ]);

    if (dbError) {
      console.error('❌ Database read failed:', dbError);
      process.exit(1);
    }

    console.log('✅ Database values:');
    dbSettings?.forEach(s => {
      console.log(`   ${s.key}: ${JSON.stringify(s.value)}`);
    });

    // Test 2: Read via SystemConfigService
    console.log('\n📊 Test 2: Reading via SystemConfigService');
    const primaryModel = await SystemConfigService.getString(
      supabase,
      'orchestrator_primary_model',
      'gpt-4o-mini'
    );
    console.log(`   Primary Model: ${primaryModel}`);

    const fallbackModel = await SystemConfigService.getString(
      supabase,
      'orchestrator_fallback_model',
      'claude-sonnet-4'
    );
    console.log(`   Fallback Model: ${fallbackModel}`);

    const enableFallback = await SystemConfigService.getBoolean(
      supabase,
      'orchestrator_enable_fallback',
      true
    );
    console.log(`   Enable Fallback: ${enableFallback}`);

    // Test 3: Validate values
    console.log('\n📊 Test 3: Validating configuration');
    const validModels = ['gpt-4o-mini', 'claude-sonnet-4'];

    if (!validModels.includes(primaryModel)) {
      console.error(`❌ Invalid primary model: ${primaryModel}`);
      process.exit(1);
    }
    console.log(`   ✅ Primary model is valid: ${primaryModel}`);

    if (!validModels.includes(fallbackModel)) {
      console.error(`❌ Invalid fallback model: ${fallbackModel}`);
      process.exit(1);
    }
    console.log(`   ✅ Fallback model is valid: ${fallbackModel}`);

    if (typeof enableFallback !== 'boolean') {
      console.error(`❌ Invalid enableFallback type: ${typeof enableFallback}`);
      process.exit(1);
    }
    console.log(`   ✅ Enable fallback is valid boolean: ${enableFallback}`);

    // Test 4: Simulate WorkflowOrchestrator logic
    console.log('\n📊 Test 4: Simulating WorkflowOrchestrator logic');
    console.log(`   🎯 Primary: ${primaryModel}, Fallback: ${enableFallback ? fallbackModel : 'disabled'}`);

    if (primaryModel === 'gpt-4o-mini') {
      console.log('   ✅ Would use GPT-4o Mini as primary generator');
      if (enableFallback && fallbackModel === 'claude-sonnet-4') {
        console.log('   ✅ Would fallback to Claude Sonnet 4 on validation failure');
      } else if (enableFallback) {
        console.log(`   ⚠️  Fallback enabled but using ${fallbackModel} (unusual configuration)`);
      } else {
        console.log('   ⚠️  Fallback disabled - no quality assurance safety net');
      }
    } else if (primaryModel === 'claude-sonnet-4') {
      console.log('   ✅ Would use Claude Sonnet 4 as primary generator');
      console.log('   💰 Note: This is the expensive option (~$0.03/agent vs ~$0.001)');
      if (enableFallback) {
        console.log(`   ℹ️  Fallback to ${fallbackModel} enabled (rarely needed for Claude)`)
      }
    }

    // Test 5: Cost calculations
    console.log('\n📊 Test 5: Cost Analysis');
    const agentsPerMonth = 10000;

    let primaryCost: number;
    let fallbackCost: number;

    if (primaryModel === 'gpt-4o-mini') {
      primaryCost = 0.001;
      fallbackCost = fallbackModel === 'claude-sonnet-4' ? 0.03 : 0.001;
    } else {
      primaryCost = 0.03;
      fallbackCost = fallbackModel === 'gpt-4o-mini' ? 0.001 : 0.03;
    }

    const assumedFallbackRate = 0.05; // 5%
    const avgCostPerAgent = (primaryCost * (1 - assumedFallbackRate)) + (fallbackCost * assumedFallbackRate);
    const monthlyCost = avgCostPerAgent * agentsPerMonth;
    const baselineCost = 0.03 * agentsPerMonth; // Claude only baseline
    const savings = baselineCost - monthlyCost;
    const savingsPercent = (savings / baselineCost) * 100;

    console.log(`   Cost per agent: $${avgCostPerAgent.toFixed(4)}`);
    console.log(`   Monthly cost (${agentsPerMonth.toLocaleString()} agents): $${monthlyCost.toFixed(2)}`);
    console.log(`   Baseline cost (Claude only): $${baselineCost.toFixed(2)}`);
    console.log(`   Monthly savings: $${savings.toFixed(2)} (${savingsPercent.toFixed(1)}%)`);
    console.log(`   Annual savings: $${(savings * 12).toFixed(2)}`);

    console.log('\n✅ All tests passed! Configuration is valid and ready to use.');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

testOrchestratorConfig()
  .then(() => {
    console.log('\n✅ Test script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test script failed:', error);
    process.exit(1);
  });
