// Test script to verify execution_results are generated correctly
// This checks what gets stored in the new execution_results field

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testExecutionResults() {
  console.log('🔍 Testing execution_results field...\n');

  // Get the latest production execution
  const { data: executions, error } = await supabase
    .from('workflow_executions')
    .select('id, status, execution_results, final_output, started_at')
    .eq('run_mode', 'production')
    .order('started_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!executions || executions.length === 0) {
    console.log('❌ No executions found');
    return;
  }

  console.log(`📋 Found ${executions.length} recent production executions\n`);

  for (const execution of executions) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n📦 Execution: ${execution.id.slice(0, 8)}...`);
    console.log(`   Status: ${execution.status}`);
    console.log(`   Started: ${execution.started_at}`);

    if (execution.execution_results) {
      console.log('\n✅ HAS execution_results:');
      const results = execution.execution_results;

      console.log(`\n   Summary: "${results.summary}"`);
      console.log(`   Total Items: ${results.totalItems}`);
      console.log(`   Total Steps: ${results.totalSteps}`);

      if (results.items && results.items.length > 0) {
        console.log('\n   📊 Items Breakdown:');
        console.table(results.items.map(item => ({
          Step: item.stepName,
          Plugin: item.plugin,
          Action: item.action,
          Count: item.itemCount,
          Type: item.dataType,
          Status: item.status,
          Keys: item.sampleKeys?.join(', ') || 'N/A'
        })));
      }

      // Verify NO client data is stored
      console.log('\n   🔒 Security Check:');
      const resultsJson = JSON.stringify(results);
      const hasEmail = resultsJson.includes('@') || resultsJson.includes('email');
      const hasAmount = resultsJson.match(/\$\d+/);
      const hasName = resultsJson.includes('Corp') || resultsJson.includes('Inc');

      console.log(`      Contains emails: ${hasEmail ? '⚠️  YES (potential leak!)' : '✅ NO'}`);
      console.log(`      Contains amounts: ${hasAmount ? '⚠️  YES (potential leak!)' : '✅ NO'}`);
      console.log(`      Contains names: ${hasName ? '⚠️  YES (potential leak!)' : '✅ NO'}`);

      if (hasEmail || hasAmount || hasName) {
        console.log('\n      🚨 WARNING: Potential client data detected!');
        console.log('      Please review the execution_results structure');
      }
    } else {
      console.log('\n⚠️  NO execution_results (old execution or not yet generated)');
    }

    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Show example of what execution_results looks like
  const withResults = executions.find(e => e.execution_results);
  if (withResults) {
    console.log('📄 Full execution_results example:');
    console.log(JSON.stringify(withResults.execution_results, null, 2));
  }
}

testExecutionResults().catch(console.error);
