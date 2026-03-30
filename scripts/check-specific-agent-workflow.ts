import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda'; // From the logs

  const { data: agent } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .single();

  if (!agent) {
    console.log('Agent not found');
    return;
  }

  console.log('=== AGENT ===');
  console.log('Name:', agent.agent_name);
  console.log('ID:', agent.id);

  const steps = agent.pilot_steps || agent.workflow_steps || [];
  console.log(`\nTotal steps: ${steps.length}`);

  // Find step6 in the scatter-gather
  const step4 = steps.find((s: any) => (s.id || s.step_id) === 'step4');
  if (step4?.scatter?.steps) {
    const step6 = step4.scatter.steps.find((s: any) => (s.id || s.step_id) === 'step6');
    if (step6) {
      console.log('\n=== STEP6 (Document Extractor) ===');
      console.log('Action:', step6.operation);
      console.log('Fields:', JSON.stringify(step6.config?.fields, null, 2));
    }

    const step7 = step4.scatter.steps.find((s: any) => (s.id || s.step_id) === 'step7');
    if (step7) {
      console.log('\n=== STEP7 (Get/Create Folder) ===');
      console.log('Action:', step7.operation);
      console.log('Config:', JSON.stringify(step7.config, null, 2));
    }
  }

  // Save for inspection
  const outputPath = path.join(process.cwd(), 'agent-43ffbc8a-workflow.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    agent_id: agent.id,
    agent_name: agent.agent_name,
    workflow_steps: steps
  }, null, 2));
  console.log('\n=== Workflow saved to:', outputPath);
}

main().catch(console.error);
