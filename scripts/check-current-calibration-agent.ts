import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  const { data: session } = await supabase
    .from('agent_calibration_sessions')
    .select('agent_id, user_id')
    .eq('id', '589b332e-990a-4e42-9aff-f4aeb2e802a8')
    .single();

  if (session) {
    console.log('Agent ID:', session.agent_id);

    const { data: agent } = await supabase
      .from('agents')
      .select('agent_name, pilot_steps')
      .eq('id', session.agent_id)
      .single();

    if (agent) {
      console.log('Agent Name:', agent.agent_name);
      const step2 = (agent.pilot_steps as any[]).find((s: any) => s.step_id === 'step2' || s.id === 'step2');
      console.log('\nStep2 config.field:', step2?.config?.field);
      console.log('Step2 full config:', JSON.stringify(step2?.config, null, 2));
    }
  }
}

main();
