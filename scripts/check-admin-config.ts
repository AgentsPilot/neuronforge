/**
 * Check Admin Configuration in Database
 *
 * Verifies that the admin configuration is correctly stored in the database
 * and that each phase has the correct provider/model/temperature.
 */

import { createClient } from '@supabase/supabase-js';
import { getAgentGenerationConfig } from '../lib/agentkit/v6/config/AgentGenerationConfigService';
import * as dotenv from 'dotenv';
import { join } from 'path';

// Load environment variables
dotenv.config({ path: join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing environment variables');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'set' : 'missing');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? 'set' : 'missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAdminConfig() {
  console.log('='.repeat(80));
  console.log('CHECKING ADMIN CONFIGURATION');
  console.log('='.repeat(80));

  // 1. Check raw database values
  console.log('\n1. RAW DATABASE VALUES:');
  console.log('-'.repeat(80));

  const { data: settings, error } = await supabase
    .from('system_settings_config')
    .select('key, value')
    .like('key', 'agent_generation%')
    .order('key');

  if (error) {
    console.error('Error fetching from database:', error);
    return;
  }

  if (!settings || settings.length === 0) {
    console.log('⚠️  No admin configuration found in database!');
    return;
  }

  settings.forEach(({ key, value }) => {
    console.log(`${key}: ${value}`);
  });

  // 2. Check parsed configuration from service
  console.log('\n2. PARSED CONFIGURATION (from AgentGenerationConfigService):');
  console.log('-'.repeat(80));

  const config = await getAgentGenerationConfig();

  console.log('\nPhase 0: Requirements Extraction');
  console.log(`  Provider:    ${config.requirements.provider}`);
  console.log(`  Model:       ${config.requirements.model}`);
  console.log(`  Temperature: ${config.requirements.temperature}`);

  console.log('\nPhase 1: Semantic Planning');
  console.log(`  Provider:    ${config.semantic.provider}`);
  console.log(`  Model:       ${config.semantic.model}`);
  console.log(`  Temperature: ${config.semantic.temperature}`);

  console.log('\nPhase 3: IR Formalization');
  console.log(`  Provider:    ${config.formalization.provider}`);
  console.log(`  Model:       ${config.formalization.model}`);
  console.log(`  Temperature: ${config.formalization.temperature}`);

  // 3. Validate provider/model combinations
  console.log('\n3. VALIDATION:');
  console.log('-'.repeat(80));

  const validateProviderModel = (phase: string, provider: string, model: string): boolean => {
    const modelLower = model.toLowerCase();

    const isAnthropicModel = modelLower.includes('claude') ||
                             modelLower.includes('opus') ||
                             modelLower.includes('sonnet') ||
                             modelLower.includes('haiku');

    const isOpenAIModel = modelLower.includes('gpt') ||
                          modelLower.includes('o1') ||
                          modelLower.startsWith('text-');

    if (provider === 'anthropic' && !isAnthropicModel) {
      console.log(`❌ ${phase}: Provider is 'anthropic' but model '${model}' looks like OpenAI`);
      return false;
    }

    if (provider === 'openai' && !isOpenAIModel) {
      console.log(`❌ ${phase}: Provider is 'openai' but model '${model}' looks like Anthropic`);
      return false;
    }

    console.log(`✅ ${phase}: ${provider}/${model} is valid`);
    return true;
  };

  const reqValid = validateProviderModel('Requirements', config.requirements.provider, config.requirements.model);
  const semValid = validateProviderModel('Semantic', config.semantic.provider, config.semantic.model);
  const formValid = validateProviderModel('Formalization', config.formalization.provider, config.formalization.model);

  console.log('\n' + '='.repeat(80));
  if (reqValid && semValid && formValid) {
    console.log('✅ ALL CONFIGURATIONS ARE VALID');
  } else {
    console.log('❌ SOME CONFIGURATIONS ARE INVALID');
    console.log('\nPlease fix the configuration in the admin UI at:');
    console.log('http://localhost:3000/admin/agent-generation-config');
  }
  console.log('='.repeat(80));
}

checkAdminConfig()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
