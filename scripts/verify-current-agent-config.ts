import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('=== VERIFYING CURRENT AGENT STATE ===\n');

  const { data: agent, error } = await supabase
    .from('agents')
    .select('input_schema, updated_at')
    .eq('id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .single();

  if (error || !agent) {
    console.log('Error:', error);
    return;
  }

  console.log('Agent last updated:', agent.updated_at);
  console.log('\n=== FULL INPUT_SCHEMA ===');
  console.log(JSON.stringify(agent.input_schema, null, 2));

  console.log('\n=== CONFIG FIELDS (with default_value) ===');
  if (agent.input_schema && Array.isArray(agent.input_schema)) {
    let configCount = 0;
    agent.input_schema.forEach((field: any) => {
      if (field.default_value !== undefined && field.default_value !== null && field.default_value !== '') {
        configCount++;
        console.log(`\n${configCount}. ${field.name}`);
        console.log(`   Type: ${field.type}`);
        console.log(`   Default: "${field.default_value}"`);
        console.log(`   Description: ${field.description || 'N/A'}`);
      }
    });

    if (configCount === 0) {
      console.log('⚠️  NO CONFIG FIELDS FOUND');
      console.log('This means all default_value fields are undefined, null, or empty strings');
    }
  } else {
    console.log('❌ input_schema is not an array or is missing');
  }

  console.log('\n=== DIGEST_RECIPIENT FIELD ===');
  const digestField = agent.input_schema?.find((f: any) => f.name === 'digest_recipient');
  if (digestField) {
    console.log(JSON.stringify(digestField, null, 2));

    console.log('\n=== ANALYSIS ===');
    if (digestField.default_value) {
      console.log(`✅ default_value is SET: "${digestField.default_value}"`);
      console.log(`✅ Config resolution SHOULD work`);
    } else {
      console.log(`❌ default_value is ${digestField.default_value} (falsy)`);
      console.log(`❌ This would cause {{config.digest_recipient}} to resolve to undefined`);
      console.log(`❌ Result: recipients.to = [undefined] → fails validation`);
    }
  } else {
    console.log('❌ digest_recipient field NOT FOUND in input_schema');
  }
}

main();
