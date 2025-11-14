const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data, error } = await supabase
    .from('system_config')
    .select('*')
    .eq('key', 'pilot_enabled')
    .single();

  console.log('\n🔧 Pilot System Configuration:');
  if (error) {
    console.log('   Status: ❌ NOT CONFIGURED');
    console.log('   Error:', error.message);
    console.log('\n💡 To enable Pilot, run:');
    console.log('   INSERT INTO system_config (key, value, description)');
    console.log("   VALUES ('pilot_enabled', 'true', 'Enable Pilot workflow execution engine');");
  } else {
    console.log('   Key:', data.key);
    console.log('   Value:', data.value);
    console.log('   Status:', data.value === 'true' ? '✅ ENABLED' : '❌ DISABLED');
    console.log('   Description:', data.description);
  }
}

check().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
