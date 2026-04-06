/**
 * Check actual step output structure from recent execution
 * This helps us understand what data format plugins return
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStepOutputStructure() {
  const agentId = process.argv[2] || '408d16ab-fe92-46ac-8aa4-55b016dd42df';

  console.log('🔍 Checking step output structure for agent:', agentId);
  console.log('='.repeat(70));

  // Get latest execution
  const { data: execution, error } = await supabase
    .from('agent_executions')
    .select('id, logs')
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !execution) {
    console.error('❌ Error fetching execution:', error);
    process.exit(1);
  }

  console.log(`\n📋 Execution ID: ${execution.id}`);

  const pilot = execution.logs?.pilot;
  if (!pilot || !pilot.stepExecutions) {
    console.log('❌ No pilot data found');
    process.exit(1);
  }

  console.log(`\n📊 Step Executions (${pilot.stepExecutions.length} steps):\n`);

  pilot.stepExecutions.forEach((step, idx) => {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Step ${idx + 1}: ${step.metadata?.stepName || step.stepId}`);
    console.log(`  Plugin: ${step.plugin}`);
    console.log(`  Action: ${step.action}`);
    console.log(`  Status: ${step.status}`);

    if (step.output) {
      console.log(`\n  Output structure:`);
      const output = step.output;

      // Check if it's an array
      if (Array.isArray(output)) {
        console.log(`    Type: Direct Array`);
        console.log(`    Length: ${output.length}`);
        if (output.length > 0) {
          console.log(`    First item type: ${typeof output[0]}`);
          if (typeof output[0] === 'object') {
            console.log(`    First item keys: ${Object.keys(output[0]).join(', ')}`);
          }
        }
      }
      // Check if it's an object
      else if (output && typeof output === 'object') {
        console.log(`    Type: Object`);
        console.log(`    Keys: ${Object.keys(output).join(', ')}`);

        // Look for nested arrays
        const arrayFields = Object.entries(output).filter(
          ([key, value]) => Array.isArray(value)
        );

        if (arrayFields.length > 0) {
          console.log(`\n    Nested arrays found:`);
          arrayFields.forEach(([key, value]) => {
            console.log(`      - ${key}: Array[${value.length}]`);
            if (value.length > 0 && typeof value[0] === 'object') {
              console.log(`        First item keys: ${Object.keys(value[0]).join(', ')}`);
            }
          });
        }

        // Check for count fields
        const countFields = Object.entries(output).filter(
          ([key, value]) => typeof value === 'number' && (key.includes('count') || key.includes('total') || key.includes('found'))
        );

        if (countFields.length > 0) {
          console.log(`\n    Count/Total fields:`);
          countFields.forEach(([key, value]) => {
            console.log(`      - ${key}: ${value}`);
          });
        }
      }
      // Other types
      else {
        console.log(`    Type: ${typeof output}`);
        console.log(`    Value: ${JSON.stringify(output)}`);
      }

      // Show raw output sample (first 300 chars)
      console.log(`\n  Raw output (sample):`);
      const rawOutput = JSON.stringify(output, null, 2);
      console.log(`    ${rawOutput.substring(0, 300)}${rawOutput.length > 300 ? '...' : ''}`);
    } else {
      console.log(`  ❌ No output data`);
    }
  });

  console.log('\n' + '='.repeat(70));

  // Also check execution_metrics
  const { data: metrics } = await supabase
    .from('execution_metrics')
    .select('step_metrics')
    .eq('execution_id', execution.id)
    .single();

  if (metrics) {
    console.log(`\n📈 Current execution_metrics.step_metrics:`);
    console.log(JSON.stringify(metrics.step_metrics, null, 2));
  }
}

checkStepOutputStructure()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
