// Check specific execution
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const executionId = process.argv[2] || '9e843c95-aba9-4498-816c-7df594206510';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkExecution() {
  console.log(`🔍 Checking execution: ${executionId}\n`);

  // Get step executions
  const { data: steps, error } = await supabase
    .from('workflow_step_executions')
    .select('*')
    .eq('workflow_execution_id', executionId)
    .order('created_at');

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log(`Found ${steps?.length || 0} step execution records\n`);

  if (steps && steps.length > 0) {
    steps.forEach((s, i) => {
      console.log(`Step ${i + 1}: ${s.step_name}`);
      console.log(`  Type: ${s.step_type}`);
      console.log(`  Status: ${s.status}`);
      console.log(`  Routing: ${s.selected_tier || 'none'} / ${s.selected_model || 'none'}`);
      console.log('');
    });
  }
}

checkExecution()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
