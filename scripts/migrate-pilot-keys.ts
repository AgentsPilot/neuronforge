/**
 * Migrate Pilot Configuration Keys
 *
 * Renames old workflow_orchestrator_* keys to new pilot_* keys
 *
 * Usage: npx ts-node scripts/migrate-pilot-keys.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const KEY_MAPPINGS = [
  { old: 'workflow_orchestrator_enabled', new: 'pilot_enabled' },
  { old: 'workflow_orchestrator_max_steps', new: 'pilot_max_steps' },
  { old: 'workflow_orchestrator_max_execution_time_ms', new: 'pilot_max_execution_time_ms' },
  { old: 'workflow_orchestrator_max_parallel_steps', new: 'pilot_max_parallel_steps' },
  { old: 'workflow_orchestrator_retry_enabled', new: 'pilot_retry_enabled' },
  { old: 'workflow_orchestrator_default_retry_count', new: 'pilot_default_retry_count' },
  { old: 'workflow_orchestrator_circuit_breaker_threshold', new: 'pilot_circuit_breaker_threshold' },
  { old: 'workflow_orchestrator_checkpoint_enabled', new: 'pilot_checkpoint_enabled' },
  { old: 'workflow_orchestrator_retention_days', new: 'pilot_retention_days' },
]

async function migratePilotKeys() {
  console.log('🔧 Migrating Pilot Configuration Keys...\n')

  for (const mapping of KEY_MAPPINGS) {
    console.log(`📝 ${mapping.old} → ${mapping.new}`)

    // Check if old key exists
    const { data: oldData, error: oldError } = await supabase
      .from('system_settings_config')
      .select('*')
      .eq('key', mapping.old)
      .maybeSingle()

    if (oldError) {
      console.error(`   ❌ Error checking old key:`, oldError.message)
      continue
    }

    if (!oldData) {
      console.log(`   ⚠️  Old key not found - skipping`)
      continue
    }

    // Check if new key already exists
    const { data: newData } = await supabase
      .from('system_settings_config')
      .select('id')
      .eq('key', mapping.new)
      .maybeSingle()

    if (newData) {
      console.log(`   ℹ️  New key already exists - deleting old key`)

      // Delete old key
      const { error: deleteError } = await supabase
        .from('system_settings_config')
        .delete()
        .eq('key', mapping.old)

      if (deleteError) {
        console.error(`   ❌ Failed to delete old key:`, deleteError.message)
      } else {
        console.log(`   ✅ Deleted old key`)
      }
      continue
    }

    // Update old key to new key
    const { error: updateError } = await supabase
      .from('system_settings_config')
      .update({
        key: mapping.new,
        category: 'pilot',
        updated_at: new Date().toISOString()
      })
      .eq('key', mapping.old)

    if (updateError) {
      console.error(`   ❌ Failed to rename:`, updateError.message)
    } else {
      console.log(`   ✅ Renamed successfully (value: ${oldData.value})`)
    }
  }

  console.log('\n🎉 Migration complete!')
  console.log('\n📝 Verifying new keys...\n')

  // Verify all new keys exist
  for (const mapping of KEY_MAPPINGS) {
    const { data } = await supabase
      .from('system_settings_config')
      .select('key, value')
      .eq('key', mapping.new)
      .maybeSingle()

    if (data) {
      console.log(`✅ ${mapping.new}: ${data.value}`)
    } else {
      console.log(`⚠️  ${mapping.new}: NOT FOUND`)
    }
  }

  console.log('\n🚀 Pilot configuration is now up to date!')
}

migratePilotKeys()
