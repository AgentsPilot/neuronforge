// Script to regenerate input_schema for an agent from its workflow config references
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

// Load environment variables
config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const AGENT_ID = '43ffbc8a-406d-4a43-9f3f-4e7554160eda'; // Invoice extraction agent

async function main() {
  console.log(`🔍 Regenerating input_schema for agent ${AGENT_ID}\n`);

  // Fetch agent
  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, agent_name, pilot_steps, input_schema')
    .eq('id', AGENT_ID)
    .single();

  if (error || !agent) {
    console.error('❌ Error fetching agent:', error);
    return;
  }

  console.log(`📦 Agent: ${agent.agent_name}`);
  console.log(`📝 Current input_schema type:`, Array.isArray(agent.input_schema) ? 'array' : typeof agent.input_schema);
  console.log(`📋 Workflow steps:`, agent.pilot_steps ? agent.pilot_steps.length : 0, 'steps\n');

  if (!agent.pilot_steps || !Array.isArray(agent.pilot_steps)) {
    console.error('❌ No pilot_steps found for this agent');
    return;
  }

  // Extract existing default values if input_schema is an object
  let existingDefaults: Record<string, any> = {};
  if (agent.input_schema && typeof agent.input_schema === 'object' && !Array.isArray(agent.input_schema)) {
    existingDefaults = agent.input_schema;
    console.log(`📦 Found existing default values in object format:`, existingDefaults);
    console.log();
  }

  // Scan workflow for {{config.X}} references
  const configRefs = new Set<string>();

  function scanForConfigRefs(obj: any) {
    if (obj === null || obj === undefined) return;

    if (Array.isArray(obj)) {
      obj.forEach(item => scanForConfigRefs(item));
      return;
    }

    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' && value.match(/\{\{config\.(\w+)\}\}/)) {
          const matches = value.matchAll(/\{\{config\.(\w+)\}\}/g);
          for (const match of matches) {
            configRefs.add(match[1]);
          }
        }
        scanForConfigRefs(value);
      }
    }
  }

  agent.pilot_steps.forEach(step => scanForConfigRefs(step));

  console.log(`🔎 Found ${configRefs.size} config references in workflow:`);
  Array.from(configRefs).forEach(ref => console.log(`  - {{config.${ref}}}`));
  console.log();

  if (configRefs.size === 0) {
    console.log('✅ No config references found - no input_schema needed');
    return;
  }

  // Generate input_schema from config refs with default values
  const inputSchema = Array.from(configRefs).map(configKey => {
    const defaultValue = existingDefaults[configKey];
    const valueType = typeof defaultValue === 'number' ? 'number' :
                     typeof defaultValue === 'boolean' ? 'boolean' :
                     'string';

    return {
      name: configKey,
      type: valueType,
      label: formatLabel(configKey),
      required: false,
      description: `Configuration parameter for ${formatLabel(configKey).toLowerCase()}`,
      placeholder: defaultValue !== undefined ? String(defaultValue) : `Enter ${formatLabel(configKey).toLowerCase()}...`,
      hidden: false,
      default_value: defaultValue
    };
  });

  console.log(`📋 Generated input_schema:`);
  inputSchema.forEach(field => {
    console.log(`  - ${field.name} (${field.type}): ${field.label}`);
  });
  console.log();

  // Update agent
  const { data: updateData, error: updateError } = await supabase
    .from('agents')
    .update({ input_schema: inputSchema })
    .eq('id', AGENT_ID)
    .select();

  if (updateError) {
    console.error('❌ Error updating agent:', updateError);
    return;
  }

  console.log('✅ Agent input_schema regenerated successfully!');
  console.log('📝 New input_schema:', JSON.stringify(inputSchema, null, 2));
  console.log('\n💡 Next steps:');
  console.log('1. Run calibration to populate default_value fields');
  console.log('2. The form should now show these fields dynamically');
}

function formatLabel(name: string): string {
  // Convert snake_case to Title Case
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

main().catch(console.error);
