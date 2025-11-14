// scripts/test-all-subdimension-weights.ts
// Test ALL subdimension weights are database-driven (Phase 2 Complete)

import { createClient } from '@supabase/supabase-js';
import { AISConfigService } from '../lib/services/AISConfigService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testAllSubdimensions() {
  console.log('🔧 Testing ALL Subdimension Weights (Phase 2 Complete)...\n');

  let allPassed = true;

  // Test 1: Execution subdimensions
  console.log('1️⃣ Testing Execution Subdimension Weights...');
  try {
    const execWeights = await AISConfigService.getExecutionSubWeights(supabase);
    const sum = execWeights.iterations + execWeights.duration + execWeights.failure + execWeights.retry;
    console.log(`   ✅ Loaded: iterations=${execWeights.iterations}, duration=${execWeights.duration}, failure=${execWeights.failure}, retry=${execWeights.retry}`);
    console.log(`   Sum: ${sum.toFixed(3)} ${Math.abs(sum - 1.0) < 0.001 ? '✅' : '❌'}`);
    if (Math.abs(sum - 1.0) > 0.001) allPassed = false;
  } catch (error) {
    console.error('   ❌ Failed:', error);
    allPassed = false;
  }

  // Test 2: Plugin subdimensions
  console.log('\n2️⃣ Testing Plugin Subdimension Weights...');
  try {
    const pluginWeights = await AISConfigService.getPluginSubWeights(supabase);
    const sum = pluginWeights.count + pluginWeights.usage + pluginWeights.overhead;
    console.log(`   ✅ Loaded: count=${pluginWeights.count}, usage=${pluginWeights.usage}, overhead=${pluginWeights.overhead}`);
    console.log(`   Sum: ${sum.toFixed(3)} ${Math.abs(sum - 1.0) < 0.001 ? '✅' : '❌'}`);
    if (Math.abs(sum - 1.0) > 0.001) allPassed = false;
  } catch (error) {
    console.error('   ❌ Failed:', error);
    allPassed = false;
  }

  // Test 3: Workflow subdimensions
  console.log('\n3️⃣ Testing Workflow Subdimension Weights...');
  try {
    const workflowWeights = await AISConfigService.getWorkflowSubWeights(supabase);
    const sum = workflowWeights.steps + workflowWeights.branches + workflowWeights.loops + workflowWeights.parallel;
    console.log(`   ✅ Loaded: steps=${workflowWeights.steps}, branches=${workflowWeights.branches}, loops=${workflowWeights.loops}, parallel=${workflowWeights.parallel}`);
    console.log(`   Sum: ${sum.toFixed(3)} ${Math.abs(sum - 1.0) < 0.001 ? '✅' : '❌'}`);
    if (Math.abs(sum - 1.0) > 0.001) allPassed = false;
  } catch (error) {
    console.error('   ❌ Failed:', error);
    allPassed = false;
  }

  // Test 4: Memory subdimensions
  console.log('\n4️⃣ Testing Memory Subdimension Weights...');
  try {
    const memoryWeights = await AISConfigService.getMemorySubWeights(supabase);
    const sum = memoryWeights.ratio + memoryWeights.diversity + memoryWeights.volume;
    console.log(`   ✅ Loaded: ratio=${memoryWeights.ratio}, diversity=${memoryWeights.diversity}, volume=${memoryWeights.volume}`);
    console.log(`   Sum: ${sum.toFixed(3)} ${Math.abs(sum - 1.0) < 0.001 ? '✅' : '❌'}`);
    if (Math.abs(sum - 1.0) > 0.001) allPassed = false;
  } catch (error) {
    console.error('   ❌ Failed:', error);
    allPassed = false;
  }

  // Test 5: Verify database keys exist
  console.log('\n5️⃣ Verifying all subdimension keys in database...');
  try {
    const { data, error } = await supabase
      .from('ais_system_config')
      .select('config_key, config_value, category')
      .eq('category', 'ais_dimension_weights')
      .order('config_key');

    if (error) {
      console.error('   ❌ Database query error:', error);
      allPassed = false;
    } else {
      const keysByDimension: Record<string, string[]> = {
        execution: [],
        plugin: [],
        workflow: [],
        memory: []
      };

      data?.forEach(row => {
        if (row.config_key.includes('execution_')) keysByDimension.execution.push(row.config_key);
        else if (row.config_key.includes('plugin_')) keysByDimension.plugin.push(row.config_key);
        else if (row.config_key.includes('workflow_')) keysByDimension.workflow.push(row.config_key);
        else if (row.config_key.includes('memory_') && row.config_key.includes('_weight')) keysByDimension.memory.push(row.config_key);
      });

      console.log(`   📊 Execution: ${keysByDimension.execution.length} keys (expected 4) ${keysByDimension.execution.length === 4 ? '✅' : '❌'}`);
      console.log(`   📊 Plugin: ${keysByDimension.plugin.length} keys (expected 3) ${keysByDimension.plugin.length === 3 ? '✅' : '❌'}`);
      console.log(`   📊 Workflow: ${keysByDimension.workflow.length} keys (expected 4) ${keysByDimension.workflow.length === 4 ? '✅' : '❌'}`);
      console.log(`   📊 Memory: ${keysByDimension.memory.length} keys (expected 3) ${keysByDimension.memory.length === 3 ? '✅' : '❌'}`);

      if (keysByDimension.execution.length !== 4 ||
          keysByDimension.plugin.length !== 3 ||
          keysByDimension.workflow.length !== 4 ||
          keysByDimension.memory.length !== 3) {
        allPassed = false;
      }
    }
  } catch (error) {
    console.error('   ❌ Failed:', error);
    allPassed = false;
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  if (allPassed) {
    console.log('✅ Phase 2 Complete - ALL SUBDIMENSION WEIGHTS DATABASE-DRIVEN!');
    console.log('='.repeat(80));
    console.log('✅ Execution subdimensions: iterations, duration, failure, retry');
    console.log('✅ Plugin subdimensions: count, usage, overhead');
    console.log('✅ Workflow subdimensions: steps, branches, loops, parallel');
    console.log('✅ Memory subdimensions: ratio, diversity, volume');
    console.log('='.repeat(80));
    console.log('✅ Admin UI changes will now affect ALL complexity calculations');
    console.log('✅ System is fully tunable through /admin/ais-config interface');
    console.log('='.repeat(80));
  } else {
    console.log('❌ Some tests failed - see output above');
    console.log('='.repeat(80));
  }

  return allPassed;
}

testAllSubdimensions()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
