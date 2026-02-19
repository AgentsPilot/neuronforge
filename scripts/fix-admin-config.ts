/**
 * Fix Admin Configuration in Database
 *
 * Corrects provider/model mismatches in the database by inferring
 * the correct provider from the model name.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { join } from 'path';

// Load environment variables
dotenv.config({ path: join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function inferProvider(modelName: string): 'openai' | 'anthropic' {
  const modelLower = modelName.toLowerCase();
  if (
    modelLower.includes('claude') ||
    modelLower.includes('opus') ||
    modelLower.includes('sonnet') ||
    modelLower.includes('haiku')
  ) {
    return 'anthropic';
  }
  return 'openai';
}

async function fixAdminConfig() {
  console.log('='.repeat(80));
  console.log('FIXING ADMIN CONFIGURATION');
  console.log('='.repeat(80));

  // 1. Fetch current config
  const { data: settings, error } = await supabase
    .from('system_settings_config')
    .select('key, value')
    .like('key', 'agent_generation_phase%')
    .order('key');

  if (error) {
    console.error('Error fetching from database:', error);
    return;
  }

  if (!settings || settings.length === 0) {
    console.log('⚠️  No admin configuration found in database!');
    return;
  }

  // 2. Parse current config
  const config: any = {
    requirements: {},
    semantic: {},
    formalization: {}
  };

  settings.forEach(({ key, value }) => {
    let parsedValue = value;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      parsedValue = isNaN(Number(value)) ? value : Number(value);
    }

    if (key === 'agent_generation_phase_requirements_provider') config.requirements.provider = parsedValue;
    if (key === 'agent_generation_phase_requirements_model') config.requirements.model = parsedValue;
    if (key === 'agent_generation_phase_semantic_provider') config.semantic.provider = parsedValue;
    if (key === 'agent_generation_phase_semantic_model') config.semantic.model = parsedValue;
    if (key === 'agent_generation_phase_formalization_provider') config.formalization.provider = parsedValue;
    if (key === 'agent_generation_phase_formalization_model') config.formalization.model = parsedValue;
  });

  console.log('\nCurrent Configuration:');
  console.log('-'.repeat(80));
  console.log(`Requirements:   ${config.requirements.provider}/${config.requirements.model}`);
  console.log(`Semantic:       ${config.semantic.provider}/${config.semantic.model}`);
  console.log(`Formalization:  ${config.formalization.provider}/${config.formalization.model}`);

  // 3. Fix mismatches
  const updates: Array<{ key: string; value: string; reason: string }> = [];

  // Check requirements
  const reqCorrectProvider = inferProvider(config.requirements.model);
  if (config.requirements.provider !== reqCorrectProvider) {
    updates.push({
      key: 'agent_generation_phase_requirements_provider',
      value: JSON.stringify(reqCorrectProvider),
      reason: `Model '${config.requirements.model}' requires provider '${reqCorrectProvider}', not '${config.requirements.provider}'`
    });
  }

  // Check semantic
  const semCorrectProvider = inferProvider(config.semantic.model);
  if (config.semantic.provider !== semCorrectProvider) {
    updates.push({
      key: 'agent_generation_phase_semantic_provider',
      value: JSON.stringify(semCorrectProvider),
      reason: `Model '${config.semantic.model}' requires provider '${semCorrectProvider}', not '${config.semantic.provider}'`
    });
  }

  // Check formalization
  const formCorrectProvider = inferProvider(config.formalization.model);
  if (config.formalization.provider !== formCorrectProvider) {
    updates.push({
      key: 'agent_generation_phase_formalization_provider',
      value: JSON.stringify(formCorrectProvider),
      reason: `Model '${config.formalization.model}' requires provider '${formCorrectProvider}', not '${config.formalization.provider}'`
    });
  }

  // 4. Apply updates
  if (updates.length === 0) {
    console.log('\n✅ No fixes needed - configuration is correct!');
    console.log('='.repeat(80));
    return;
  }

  console.log('\n⚠️  Found issues to fix:');
  console.log('-'.repeat(80));
  updates.forEach((update, i) => {
    console.log(`${i + 1}. ${update.reason}`);
    console.log(`   Updating ${update.key} to ${update.value}`);
  });

  console.log('\n📝 Applying fixes...');
  console.log('-'.repeat(80));

  for (const update of updates) {
    const { error: updateError } = await supabase
      .from('system_settings_config')
      .update({ value: update.value })
      .eq('key', update.key);

    if (updateError) {
      console.error(`❌ Failed to update ${update.key}:`, updateError);
    } else {
      console.log(`✅ Updated ${update.key}`);
    }
  }

  console.log('\n✅ Configuration fixed!');
  console.log('='.repeat(80));
  console.log('\nNew Configuration:');
  console.log('-'.repeat(80));
  console.log(`Requirements:   ${reqCorrectProvider}/${config.requirements.model}`);
  console.log(`Semantic:       ${semCorrectProvider}/${config.semantic.model}`);
  console.log(`Formalization:  ${formCorrectProvider}/${config.formalization.model}`);
  console.log('='.repeat(80));
}

fixAdminConfig()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
