import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Try agents_v2 first, then agents
  let { data: agent } = await supabase
    .from('agents_v2')
    .select('workflow_structure, input_schema')
    .eq('id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .single();

  if (!agent) {
    console.log('Not found in agents_v2, trying agents table...');
    const result = await supabase
      .from('agents')
      .select('pilot_steps, input_schema')
      .eq('id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
      .single();

    if (result.data) {
      agent = {
        workflow_structure: { steps: result.data.pilot_steps },
        input_schema: result.data.input_schema
      };
    }
  }

  if (!agent) {
    console.log('Agent not found in either table');
    return;
  }

  console.log('=== SEARCHING FOR CONFIG REFERENCES ===');
  const workflow = JSON.stringify(agent.workflow_structure, null, 2);

  // Find all {{config.X}} references
  const configRefs = workflow.match(/\{\{config\.\w+\}\}/g);
  if (configRefs) {
    console.log('Config references found:');
    const unique = [...new Set(configRefs)];
    unique.forEach(ref => console.log('  -', ref));
  } else {
    console.log('No {{config.X}} references found in workflow');
  }

  console.log('\n=== INPUT SCHEMA ===');
  console.log(JSON.stringify(agent.input_schema, null, 2));

  console.log('\n=== EMAIL STEP CONFIG ===');
  const steps = agent.workflow_structure?.steps || [];
  const emailStep = steps.find((s: any) =>
    s.plugin === 'google-mail' &&
    (s.operation === 'send_email' || s.action === 'send_email')
  );

  if (emailStep) {
    console.log('Email step found:', (emailStep as any).step_id || (emailStep as any).id);
    console.log('Recipients config:', JSON.stringify((emailStep as any).config?.recipients || (emailStep as any).params?.recipients, null, 2));
  } else {
    console.log('No email step found');
  }
}

main();
