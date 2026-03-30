// Update agent's input_schema from IntentContract config
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

config({ path: path.join(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda';

async function updateAgentInputSchema() {
  console.log('=== UPDATING AGENT INPUT SCHEMA ===\n');

  // Load IntentContract
  const intentPath = path.join(process.cwd(), 'output/vocabulary-pipeline/intent-contract.json');
  const intent = JSON.parse(fs.readFileSync(intentPath, 'utf-8'));

  console.log(`Loaded IntentContract with ${intent.config?.length || 0} config parameters`);

  if (!intent.config || intent.config.length === 0) {
    console.log('⚠️  No config parameters found in IntentContract');
    return;
  }

  // Convert config parameters to input_schema format
  const inputSchema = intent.config.map((configParam: any) => ({
    name: configParam.key,
    type: configParam.type,
    label: formatLabel(configParam.key),
    description: configParam.description || '',
    required: true,
    default_value: configParam.default
  }));

  console.log('\nGenerated input_schema:');
  inputSchema.forEach((field: any) => {
    console.log(`  - ${field.name} (${field.type}): ${field.default_value}`);
  });

  // Update agent in database
  const { data, error } = await supabase
    .from('agents')
    .update({ input_schema: inputSchema })
    .eq('id', agentId)
    .select();

  if (error) {
    console.error('\n❌ Error updating agent:', error);
    return;
  }

  console.log('\n✅ Agent input_schema updated successfully!');
  console.log('The form should now show these fields dynamically');
}

function formatLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

updateAgentInputSchema().catch(console.error);
