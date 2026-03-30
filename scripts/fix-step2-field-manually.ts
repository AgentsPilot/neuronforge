import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda';

  // Get current workflow
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', agentId)
    .single();

  if (!agent) {
    console.log('Agent not found');
    return;
  }

  // Find and fix step2
  const steps = agent.pilot_steps || [];
  const step2 = steps.find((s: any) => s.step_id === 'step2');

  if (!step2) {
    console.log('step2 not found');
    return;
  }

  console.log('Current step2 field:', step2.config?.field);

  // Fix the field
  if (!step2.config) {
    step2.config = {};
  }
  step2.config.field = 'attachments';

  console.log('Updating to field:', step2.config.field);

  // Update database
  const { error } = await supabase
    .from('agents')
    .update({
      pilot_steps: steps,
      updated_at: new Date().toISOString()
    })
    .eq('id', agentId);

  if (error) {
    console.log('Error updating:', error);
  } else {
    console.log('✅ Successfully updated step2.config.field to "attachments"');
  }
}

main();
