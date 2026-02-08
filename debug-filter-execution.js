/**
 * Debug script to trace filter execution and data flow
 * Run this after a calibration run to see what's happening
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  console.error('Make sure .env.local exists with:');
  console.error('  NEXT_PUBLIC_SUPABASE_URL=...');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=...');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function debugFilterExecution(agentId) {
  console.log('\n🔍 DEBUG: Filter Execution Analysis\n');

  // 1. Get the agent workflow
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('id, pilot_steps')
    .eq('id', agentId)
    .single();

  if (agentError || !agent) {
    console.error('❌ Failed to load agent:', agentError?.message);
    return;
  }

  console.log(`📋 Agent: ${agent.id}`);
  console.log(`📊 Total steps: ${agent.pilot_steps?.length || 0}\n`);

  // 2. Check for filter steps in workflow
  const filterSteps = agent.pilot_steps?.filter(step =>
    step.type === 'transform' && step.operation === 'filter'
  ) || [];

  console.log(`🔎 Filter steps found: ${filterSteps.length}`);
  filterSteps.forEach(step => {
    console.log(`  - ${step.id}: ${step.name}`);
    console.log(`    Input: ${step.input}`);
    console.log(`    Condition: ${step.config?.condition}`);
  });

  // 3. Check for map steps (tabular conversion)
  const mapSteps = agent.pilot_steps?.filter(step =>
    step.type === 'transform' && step.operation === 'map' && step.config?.columns
  ) || [];

  console.log(`\n📋 Map steps found: ${mapSteps.length}`);
  mapSteps.forEach(step => {
    console.log(`  - ${step.id}: ${step.name}`);
    console.log(`    Input: ${step.input}`);
    console.log(`    Columns: ${step.config?.columns?.join(', ')}`);
    console.log(`    Add headers: ${step.config?.add_headers}`);

    // Check if step7 has dependencies on it (which would mean it's being used)
    const dependentSteps = agent.pilot_steps?.filter(s =>
      s.dependencies && s.dependencies.includes(step.id)
    ) || [];
    if (dependentSteps.length > 0) {
      console.log(`    ⚠️  Used by: ${dependentSteps.map(s => s.id).join(', ')}`);
    } else if (step.id === 'step7') {
      console.log(`    ⚠️  WARNING: step7 has no dependent steps - it might be orphaned!`);
    }
  });

  // 4. Check for delivery steps
  const deliverySteps = agent.pilot_steps?.filter(step =>
    step.type === 'action' &&
    (step.action === 'append_values' || step.action === 'append_rows' || step.action === 'append_row')
  ) || [];

  console.log(`\n📤 Delivery steps found: ${deliverySteps.length}`);
  deliverySteps.forEach(step => {
    console.log(`  - ${step.id}: ${step.name}`);
    console.log(`    Dependencies: ${step.dependencies?.join(', ') || 'none'}`);
    console.log(`    Values source: ${step.params?.values}`);
    console.log(`    Range: ${step.params?.range}`);

    // Check if this step is using unfiltered data (step7.data or step6.data directly)
    const valuesSource = step.params?.values || '';
    if (valuesSource.includes('step7.data') || valuesSource.includes('step6.data')) {
      console.log(`    ⚠️  WARNING: Using unfiltered data source directly!`);
    }
  });

  // Check if there are any orphaned steps still referencing step7.data
  console.log(`\n🔍 Checking for steps using step7.data (unfiltered):`);
  agent.pilot_steps?.forEach(step => {
    const stepStr = JSON.stringify(step);
    if (stepStr.includes('step7.data')) {
      console.log(`  ⚠️  ${step.id} (${step.type}): Still references step7.data`);
      if (step.type === 'action') {
        console.log(`     THIS IS THE PROBLEM: Delivery step using unfiltered data!`);
      }
    }
  });

  // 5. Check for old parallel step (step10)
  const parallelSteps = agent.pilot_steps?.filter(step =>
    step.type === 'parallel' || step.type === 'parallel_group'
  ) || [];

  if (parallelSteps.length > 0) {
    console.log(`\n⚠️  FOUND OLD PARALLEL STEPS (should not exist after fix):`);
    parallelSteps.forEach(step => {
      console.log(`  - ${step.id}: ${step.name}`);
      console.log(`    Nested steps: ${step.steps?.length || 0}`);
      step.steps?.forEach(nested => {
        console.log(`      - ${nested.id}: ${nested.name}`);
      });
    });
  } else {
    console.log(`\n✅ No parallel steps found (good - fix was applied)`);
  }

  // 6. Get latest execution
  let execution;
  const executionId = process.argv[3]; // Optional execution ID parameter

  if (executionId) {
    const { data, error: execError } = await supabase
      .from('workflow_executions')
      .select('id, status, execution_results, created_at')
      .eq('id', executionId)
      .single();

    if (execError || !data) {
      console.log(`\n⚠️  Execution ${executionId} not found:`, execError?.message);
      return;
    }
    execution = data;
  } else {
    const { data: executions, error: execError } = await supabase
      .from('workflow_executions')
      .select('id, status, execution_results, created_at')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (execError || !executions || executions.length === 0) {
      console.log('\n⚠️  No executions found');
      return;
    }

    execution = executions[0];
  }
  console.log(`\n🚀 Latest execution: ${execution.id}`);
  console.log(`   Status: ${execution.status}`);
  console.log(`   Created: ${execution.created_at}`);

  // 7. Analyze execution output
  const output = execution.execution_results || {};

  console.log(`\n📊 EXECUTION DATA FLOW:\n`);

  // Check step6 (objects)
  if (output.step6) {
    const step6Data = output.step6.data || [];
    console.log(`step6 (objects):`);
    console.log(`  Count: ${Array.isArray(step6Data) ? step6Data.length : 'N/A'}`);
    if (step6Data.length > 0) {
      console.log(`  First item:`, JSON.stringify(step6Data[0], null, 2));
      const classifications = step6Data.map(item => item.classification).filter(Boolean);
      const invoiceCount = classifications.filter(c => c === 'invoice').length;
      const expenseCount = classifications.filter(c => c === 'expense').length;
      console.log(`  Classifications: ${invoiceCount} invoices, ${expenseCount} expenses`);
    }
  }

  // Check step7 (arrays - tabular)
  if (output.step7) {
    const step7Data = output.step7.data || [];
    console.log(`\nstep7 (arrays/tabular):`);
    console.log(`  Row count: ${Array.isArray(step7Data) ? step7Data.length : 'N/A'}`);
    if (step7Data.length > 0) {
      console.log(`  First row:`, JSON.stringify(step7Data[0], null, 2));
    }
  }

  // Check filter outputs
  console.log(`\n🔍 FILTER OUTPUTS:\n`);
  filterSteps.forEach(step => {
    if (output[step.id]) {
      const data = output[step.id].data || [];
      console.log(`${step.id}:`);
      console.log(`  Filtered count: ${Array.isArray(data) ? data.length : 'N/A'}`);
      if (data.length > 0) {
        console.log(`  First item:`, JSON.stringify(data[0], null, 2));
      }
      if (data.length === 0) {
        console.log(`  ⚠️  EMPTY RESULT - Filter might be incorrect!`);
      }
    } else {
      console.log(`${step.id}: ❌ NOT EXECUTED`);
    }
  });

  // Check map outputs
  console.log(`\n📋 MAP OUTPUTS:\n`);
  mapSteps.forEach(step => {
    if (output[step.id]) {
      const data = output[step.id].data || [];
      console.log(`${step.id}:`);
      console.log(`  Row count: ${Array.isArray(data) ? data.length : 'N/A'}`);
      if (data.length > 0) {
        console.log(`  First row:`, JSON.stringify(data[0], null, 2));
        console.log(`  Has headers: ${typeof data[0][0] === 'string' && !data[0][0].match(/^\d/)}`);
      }
    } else {
      console.log(`${step.id}: ❌ NOT EXECUTED`);
    }
  });

  // Check delivery outputs
  console.log(`\n📤 DELIVERY RESULTS:\n`);
  deliverySteps.forEach(step => {
    if (output[step.id]) {
      console.log(`${step.id}:`);
      console.log(`  Success: ${output[step.id].metadata?.success}`);
      console.log(`  Rows sent: ${output[step.id].metadata?.rowCount || 'unknown'}`);
      console.log(`  Range: ${step.params?.range}`);
    } else {
      console.log(`${step.id}: ❌ NOT EXECUTED`);
    }
  });
}

// Get agent ID from command line
const agentId = process.argv[2];

if (!agentId) {
  console.error('Usage: node debug-filter-execution.js <agent-id>');
  process.exit(1);
}

debugFilterExecution(agentId)
  .then(() => {
    console.log('\n✅ Debug complete');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Debug failed:', error);
    process.exit(1);
  });
