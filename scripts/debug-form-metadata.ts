// scripts/debug-form-metadata.ts
// Debug form field metadata generation

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { generateFormFieldMetadata } from '@/lib/agentkit/v6/utils/form-field-metadata-generator';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.error('SUPABASE_SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda';

  console.log('='.repeat(80));
  console.log('DEBUGGING FORM FIELD METADATA');
  console.log('='.repeat(80));
  console.log('');

  // Fetch agent from database
  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, agent_name, input_schema, pilot_steps')
    .eq('id', agentId)
    .single();

  if (error || !agent) {
    console.error('Error fetching agent:', error);
    return;
  }

  console.log('Agent:', agent.agent_name);
  console.log('Agent ID:', agent.id);
  console.log('');

  // Check input schema
  console.log('INPUT SCHEMA:');
  if (!agent.input_schema) {
    console.log('❌ No input schema found!');
    return;
  }

  // Convert input_schema to array format if it's an object
  let inputSchemaArray: Array<{ name: string; type: string; description?: string; required?: boolean }>;

  if (Array.isArray(agent.input_schema)) {
    inputSchemaArray = agent.input_schema;
    console.log('Format: Array');
  } else if (typeof agent.input_schema === 'object') {
    console.log('Format: Object (converting to array)');
    inputSchemaArray = Object.keys(agent.input_schema).map(key => {
      const value = (agent.input_schema as any)[key];
      const type = typeof value === 'number' ? 'number' :
                   typeof value === 'boolean' ? 'boolean' :
                   'string';
      return {
        name: key,
        type,
        required: false,
        description: `Configuration parameter: ${key}`
      };
    });
  } else {
    console.log('❌ Unexpected format:', typeof agent.input_schema);
    return;
  }

  console.log(`Found ${inputSchemaArray.length} fields:`);
  for (const field of inputSchemaArray) {
    console.log(`  - ${field.name} (${field.type})`);
  }
  console.log('');

  // Check pilot steps
  console.log('PILOT STEPS:');
  if (!agent.pilot_steps || !Array.isArray(agent.pilot_steps)) {
    console.log('❌ No pilot steps found!');
    return;
  }
  console.log(`Found ${agent.pilot_steps.length} steps`);
  console.log('');

  // Show steps that have config
  console.log('STEPS WITH CONFIG:');
  for (let i = 0; i < agent.pilot_steps.length; i++) {
    const step = agent.pilot_steps[i];
    if (step.config) {
      console.log(`\nStep ${i}: ${step.step_id || step.id}`);
      console.log(`  Plugin: ${step.plugin}`);
      console.log(`  Action: ${step.action || step.operation}`);
      console.log(`  Config keys: ${Object.keys(step.config).join(', ')}`);

      // Look for config references
      const configStr = JSON.stringify(step.config);
      const matches = configStr.match(/\{\{config\.(\w+)\}\}/g);
      if (matches) {
        console.log(`  Config refs: ${matches.join(', ')}`);
      }
    }

    // Check loop steps
    if (step.loop_steps && Array.isArray(step.loop_steps)) {
      console.log(`  Has ${step.loop_steps.length} loop steps`);
      for (let j = 0; j < step.loop_steps.length; j++) {
        const loopStep = step.loop_steps[j];
        if (loopStep.config) {
          console.log(`    Loop step ${j}: ${loopStep.step_id || loopStep.id}`);
          console.log(`      Plugin: ${loopStep.plugin}`);
          console.log(`      Action: ${loopStep.action || loopStep.operation}`);
          const loopConfigStr = JSON.stringify(loopStep.config);
          const loopMatches = loopConfigStr.match(/\{\{config\.(\w+)\}\}/g);
          if (loopMatches) {
            console.log(`      Config refs: ${loopMatches.join(', ')}`);
          }
        }
      }
    }
  }
  console.log('');

  // Generate metadata
  console.log('='.repeat(80));
  console.log('GENERATING METADATA');
  console.log('='.repeat(80));
  console.log('');

  const pluginManager = await PluginManagerV2.getInstance();
  const metadata = await generateFormFieldMetadata(
    inputSchemaArray,
    agent.pilot_steps,
    pluginManager
  );

  console.log('RESULT:');
  if (metadata.length === 0) {
    console.log('❌ No metadata generated!');
  } else {
    console.log(`✓ Generated ${metadata.length} field(s):`);
    for (const field of metadata) {
      console.log(`\n  ${field.name}:`);
      console.log(`    Plugin: ${field.plugin}`);
      console.log(`    Action: ${field.action}`);
      console.log(`    Parameter: ${field.parameter}`);
      if (field.description) {
        console.log(`    Description: ${field.description}`);
      }
      if (field.depends_on) {
        console.log(`    Depends on: ${field.depends_on.join(', ')}`);
      }
    }
  }
  console.log('');

  // Check if input schema fields match config refs
  console.log('='.repeat(80));
  console.log('MATCHING ANALYSIS');
  console.log('='.repeat(80));
  console.log('');

  const allConfigRefs = new Set<string>();
  const allStepsStr = JSON.stringify(agent.pilot_steps);
  const allMatches = allStepsStr.match(/\{\{config\.(\w+)\}\}/g);
  if (allMatches) {
    allMatches.forEach(match => {
      const key = match.match(/\{\{config\.(\w+)\}\}/)![1];
      allConfigRefs.add(key);
    });
  }

  console.log('Config refs found in workflow:', Array.from(allConfigRefs).join(', '));
  console.log('Input schema fields:', agent.input_schema.map((f: any) => f.name).join(', '));
  console.log('');

  console.log('Matching check:');
  for (const field of agent.input_schema) {
    const hasMatch = allConfigRefs.has(field.name);
    console.log(`  ${hasMatch ? '✓' : '❌'} ${field.name}`);
  }
}

main().catch(console.error);
