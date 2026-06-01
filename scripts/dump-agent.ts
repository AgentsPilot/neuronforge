import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

config({ path: resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const agentId = process.argv[2];
if (!agentId) {
  console.error('Usage: tsx scripts/dump-agent.ts <agent_id>');
  process.exit(1);
}

(async () => {
  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, agent_name, mode, connected_plugins, user_prompt, system_prompt, pilot_steps, input_schema, output_schema')
    .eq('id', agentId)
    .single();

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  console.log('NAME:', agent.agent_name);
  console.log('MODE:', agent.mode);
  console.log('PLUGINS:', JSON.stringify(agent.connected_plugins));
  console.log('STEP COUNT:', agent.pilot_steps?.length);

  const outPath = `c:/tmp/agent-${agentId.slice(0, 8)}.json`;
  writeFileSync(outPath, JSON.stringify(agent, null, 2));
  console.log('written:', outPath);
})();
