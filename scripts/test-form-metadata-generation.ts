// Script to test form-metadata generation for an agent
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2';
import { generateFormFieldMetadata } from '../lib/agentkit/v6/utils/form-field-metadata-generator';

// Load environment variables
config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const AGENT_ID = '43ffbc8a-406d-4a43-9f3f-4e7554160eda';

async function main() {
  console.log(`🔍 Testing form-metadata generation for agent ${AGENT_ID}\n`);

  // Fetch agent
  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, agent_name, input_schema, pilot_steps')
    .eq('id', AGENT_ID)
    .single();

  if (error || !agent) {
    console.error('❌ Error fetching agent:', error);
    return;
  }

  console.log(`📦 Agent: ${agent.agent_name}`);
  console.log(`📝 Input schema fields: ${agent.input_schema?.length || 0}`);
  console.log(`📋 Workflow steps: ${agent.pilot_steps?.length || 0}\n`);

  if (!agent.input_schema || agent.input_schema.length === 0) {
    console.error('❌ Agent has no input_schema');
    return;
  }

  if (!agent.pilot_steps || agent.pilot_steps.length === 0) {
    console.error('❌ Agent has no pilot_steps');
    return;
  }

  // Get plugin manager
  const pluginManager = await PluginManagerV2.getInstance();
  console.log('✅ PluginManager initialized\n');

  // Generate form field metadata
  console.log('🔧 Generating form field metadata...\n');
  const metadata = await generateFormFieldMetadata(
    agent.input_schema,
    agent.pilot_steps,
    pluginManager
  );

  console.log(`📊 Generated metadata for ${metadata.length} fields:\n`);
  metadata.forEach(field => {
    console.log(`✓ ${field.name}`);
    console.log(`  Plugin: ${field.plugin}`);
    console.log(`  Action: ${field.action}`);
    console.log(`  Parameter: ${field.parameter}`);
    if (field.depends_on) {
      console.log(`  Depends on: ${field.depends_on.join(', ')}`);
    }
    if (field.description) {
      console.log(`  Description: ${field.description}`);
    }
    console.log();
  });

  // Check which fields should have dynamic dropdowns
  const fieldsWithDropdowns = metadata.filter(m => {
    const actionDef = pluginManager.getActionDefinition(m.plugin, m.action);
    const paramSchema = actionDef?.parameters?.properties?.[m.parameter];
    return paramSchema && (paramSchema as any)['x-dynamic-options'];
  });

  console.log(`\n💡 Fields with dynamic dropdowns: ${fieldsWithDropdowns.length}`);
  fieldsWithDropdowns.forEach(field => {
    const actionDef = pluginManager.getActionDefinition(field.plugin, field.action);
    const paramSchema = actionDef?.parameters?.properties?.[field.parameter];
    const dynamicOptions = (paramSchema as any)['x-dynamic-options'];

    console.log(`\n✓ ${field.name}:`);
    console.log(`  Source: ${dynamicOptions.source}`);
    if (dynamicOptions.depends_on) {
      console.log(`  Depends on: ${dynamicOptions.depends_on.join(', ')}`);
    }
  });

  // Check for fields WITHOUT metadata
  const fieldsWithoutMetadata = agent.input_schema.filter(
    (field: any) => !metadata.find(m => m.name === field.name)
  );

  if (fieldsWithoutMetadata.length > 0) {
    console.log(`\n⚠️  Fields without metadata (will show as plain inputs):`);
    fieldsWithoutMetadata.forEach((field: any) => {
      console.log(`  - ${field.name}`);
    });
  }

  console.log('\n✅ Test complete!');
}

main().catch(console.error);
