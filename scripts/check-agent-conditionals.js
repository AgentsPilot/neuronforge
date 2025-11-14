const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data, error } = await supabase
    .from('agents')
    .select('id, agent_name, workflow_steps, pilot_steps')
    .ilike('agent_name', '%customer%order%')
    .limit(1)
    .single();

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('\n📦 Agent:', data.agent_name);
  console.log('\n📋 Workflow Steps (UI format):');
  console.log(JSON.stringify(data.workflow_steps, null, 2));

  console.log('\n\n⚙️  Pilot Steps (Execution format):');
  console.log(JSON.stringify(data.pilot_steps, null, 2));

  // Check for conditionals
  const hasConditionals = data.pilot_steps?.some(s => s.type === 'conditional');
  const hasExecuteIf = data.pilot_steps?.some(s => s.executeIf);

  console.log('\n\n🔍 Conditional Analysis:');
  console.log('   Has conditional steps:', hasConditionals ? '✅ YES' : '❌ NO');
  console.log('   Has executeIf clauses:', hasExecuteIf ? '✅ YES' : '❌ NO');

  if (!hasConditionals && !hasExecuteIf) {
    console.log('\n⚠️  This agent could benefit from conditional logic!');
    console.log('   Consider regenerating with the new AI system.');
  }
}

check().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
