/**
 * Initialize Orchestrator Configuration in Database
 *
 * Inserts default orchestrator settings into system_settings table
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function initializeOrchestratorConfig() {
  console.log('🚀 Initializing Orchestrator Configuration...\n');

  // Check if settings already exist
  const { data: existing, error: checkError } = await supabase
    .from('system_settings_config')
    .select('key')
    .in('key', [
      'orchestrator_primary_model',
      'orchestrator_fallback_model',
      'orchestrator_enable_fallback'
    ]);

  if (checkError) {
    console.error('❌ Error checking existing settings:', checkError);
    process.exit(1);
  }

  if (existing && existing.length > 0) {
    console.log('⚠️  Orchestrator settings already exist:');
    existing.forEach(s => console.log(`   - ${s.key}`));
    console.log('\n📊 Current values:');

    const { data: current } = await supabase
      .from('system_settings_config')
      .select('*')
      .in('key', [
        'orchestrator_primary_model',
        'orchestrator_fallback_model',
        'orchestrator_enable_fallback'
      ]);

    current?.forEach(s => {
      console.log(`   ${s.key}: ${JSON.stringify(s.value)}`);
    });

    console.log('\n✅ No initialization needed.');
    return;
  }

  // Insert default orchestrator settings
  const settings = [
    {
      key: 'orchestrator_primary_model',
      value: 'gpt-4o-mini', // JSONB value
      category: 'orchestrator',
      description: 'Primary AI model for workflow generation'
    },
    {
      key: 'orchestrator_fallback_model',
      value: 'claude-sonnet-4', // JSONB value
      category: 'orchestrator',
      description: 'Fallback AI model when primary fails validation'
    },
    {
      key: 'orchestrator_enable_fallback',
      value: true, // JSONB boolean
      category: 'orchestrator',
      description: 'Enable automatic fallback to secondary model'
    }
  ];

  console.log('📝 Inserting orchestrator settings...');

  const { data, error } = await supabase
    .from('system_settings_config')
    .insert(settings)
    .select();

  if (error) {
    console.error('❌ Error inserting settings:', error);
    process.exit(1);
  }

  console.log('\n✅ Successfully initialized orchestrator configuration:');
  data?.forEach(s => {
    console.log(`   ✓ ${s.key}: ${s.value}`);
  });

  console.log('\n💰 Cost Impact:');
  console.log('   Before: ~$0.03 per agent (Claude Sonnet 4 only)');
  console.log('   After:  ~$0.001 per agent (GPT-4o Mini primary)');
  console.log('   Savings: 97% per agent');
  console.log('   Annual Savings (10K agents/month): ~$3,300/year');

  console.log('\n🎛️  Admin UI: Navigate to /admin/system-config to manage these settings');
}

initializeOrchestratorConfig()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
