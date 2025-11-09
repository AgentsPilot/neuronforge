const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data, error } = await supabase
    .from('agents')
    .select('id, agent_name, workflow_steps, pilot_steps')
    .not('pilot_steps', 'is', null)
    .limit(3);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`\n✅ Found ${data.length} agents with pilot_steps:\n`);

  data.forEach((agent, idx) => {
    console.log(`${idx + 1}. ${agent.agent_name}`);
    console.log(`   workflow_steps: ${agent.workflow_steps?.length || 0} steps`);
    console.log(`   pilot_steps: ${agent.pilot_steps?.length || 0} steps`);
    console.log(`   First pilot step:`, JSON.stringify(agent.pilot_steps[0], null, 2));
    console.log('');
  });
}

check().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
