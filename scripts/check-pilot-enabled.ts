import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkPilot() {
  console.log('🔍 Checking pilot_enabled setting...\n')

  const { data, error } = await supabase
    .from('system_settings_config')
    .select('*')
    .eq('key', 'pilot_enabled')
    .single()

  if (error) {
    console.error('❌ Error:', error.message)
    console.log('\n💡 Pilot is NOT configured. To enable:')
    console.log(`INSERT INTO system_settings_config (key, value, category, description)`)
    console.log(`VALUES ('pilot_enabled', 'true', 'pilot', 'Enable Pilot workflow execution engine');`)
    return
  }

  console.log('✅ Found pilot_enabled setting:')
  console.log(JSON.stringify(data, null, 2))
  console.log(`\n📊 Pilot Status: ${data.value === true || data.value === 'true' ? '🟢 ENABLED' : '🔴 DISABLED'}`)
}

checkPilot()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
