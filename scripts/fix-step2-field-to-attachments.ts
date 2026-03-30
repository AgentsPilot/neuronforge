import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  // Find the invoice extraction agent
  const { data: agents } = await supabase
    .from('agents')
    .select('id, agent_name, pilot_steps')
    .ilike('agent_name', '%invoice%')
    .limit(10);

  if (!agents || agents.length === 0) {
    console.log('No invoice agents found');
    return;
  }

  console.log('Found agents:');
  agents.forEach((agent, i) => {
    console.log(`  ${i + 1}. ${agent.agent_name} (${agent.id})`);
  });

  // Use the first one (or let user choose)
  const agent = agents[0];
  console.log(`\nUsing agent: ${agent.agent_name}`);

  // Find step2
  const steps = agent.pilot_steps as any[];
  const step2 = steps.find(s => s.step_id === 'step2' || s.id === 'step2');

  if (!step2) {
    console.log('Step2 not found');
    return;
  }

  console.log('\nCurrent step2 config.field:', step2.config?.field);

  // Update step2 config.field to "attachments"
  if (step2.config) {
    step2.config.field = 'attachments';
  } else {
    step2.config = { field: 'attachments' };
  }

  console.log('New step2 config.field:', step2.config.field);

  // Save back to database
  const { error } = await supabase
    .from('agents')
    .update({ pilot_steps: steps })
    .eq('id', agent.id);

  if (error) {
    console.error('Error updating agent:', error);
  } else {
    console.log('\n✅ Successfully updated step2 config.field to "attachments"');
  }
}

main();
