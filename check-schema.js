// Check table schema
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSchema() {
  // Get one row to see the columns
  const { data: exec, error } = await supabase
    .from('workflow_executions')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (exec && exec.length > 0) {
    console.log('workflow_executions columns:');
    Object.keys(exec[0]).forEach(col => {
      console.log(`  - ${col}: ${typeof exec[0][col]}`);
    });
  }

  console.log('\n---\n');

  // Check step executions
  const { data: step, error: stepErr } = await supabase
    .from('workflow_step_executions')
    .select('*')
    .limit(1);

  if (stepErr) {
    console.error('Error:', stepErr);
    return;
  }

  if (step && step.length > 0) {
    console.log('workflow_step_executions columns:');
    const routingCols = [];
    const otherCols = [];

    Object.keys(step[0]).forEach(col => {
      if (col.includes('complexity') || col.includes('ais_') || col.includes('selected_') || col.includes('routing') || col === 'routed_at') {
        routingCols.push(col);
      } else {
        otherCols.push(col);
      }
    });

    console.log('\n🎯 Routing-related columns:');
    routingCols.forEach(col => console.log(`  ✅ ${col}`));

    console.log('\n📋 Other columns:');
    otherCols.forEach(col => console.log(`  - ${col}`));
  }
}

checkSchema().then(() => process.exit(0)).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
