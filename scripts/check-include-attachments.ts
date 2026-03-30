import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: agents } = await supabase
    .from('agents')
    .select('id, agent_name, pilot_steps')
    .ilike('agent_name', '%invoice%')
    .limit(5);

  if (!agents || agents.length === 0) {
    console.log('No agents found');
    return;
  }

  const agent = agents[0];
  console.log('Agent:', agent.agent_name);
  console.log('Agent ID:', agent.id);

  const step1 = (agent.pilot_steps as any[]).find((s: any) =>
    s.step_id === 'step1' || s.id === 'step1'
  );

  if (step1) {
    console.log('\nStep1 config:');
    console.log(JSON.stringify(step1.config, null, 2));

    if (step1.config?.include_attachments) {
      console.log('\n✅ include_attachments is TRUE in database');
    } else {
      console.log('\n❌ include_attachments is FALSE or missing in database');
    }
  } else {
    console.log('Step1 not found');
  }
}

main();
