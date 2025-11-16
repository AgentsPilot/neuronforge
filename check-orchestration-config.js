// Check orchestration configuration
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkConfig() {
  console.log('🔍 Checking orchestration configuration...\n');

  const { data, error } = await supabase
    .from('system_settings_config')
    .select('key, value, category, description')
    .eq('category', 'orchestration')
    .order('key');

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('❌ No orchestration settings found in database');
    return;
  }

  console.log('Orchestration Settings:\n');
  data.forEach(setting => {
    const status = setting.value === true ? '✅ ENABLED' : '❌ DISABLED';
    console.log(`  ${setting.key}: ${status}`);
    console.log(`    Description: ${setting.description}`);
    console.log('');
  });
}

checkConfig()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
