// Script to add token protection configuration parameters to system_config
// Run with: npx tsx scripts/add-token-protection-config.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TOKEN_PROTECTION_CONFIGS = [
  {
    key: 'max_tool_response_chars',
    value: 8000, // JSONB number, not string
    description: 'Maximum characters in tool response before truncation (prevents token explosion). Default: 8000 chars (~2000 tokens)',
    category: 'agentkit_protection'
  },
  {
    key: 'loop_detection_window',
    value: 3, // JSONB number
    description: 'Number of recent tool calls to check for loop detection. Default: 3',
    category: 'agentkit_protection'
  },
  {
    key: 'max_same_tool_repeats',
    value: 3, // JSONB number
    description: 'Maximum times same tool can be called consecutively before considered a loop. Default: 3',
    category: 'agentkit_protection'
  },
  {
    key: 'max_tokens_per_iteration',
    value: 50000, // JSONB number
    description: 'Maximum tokens allowed per AgentKit iteration. Execution stops if exceeded. Default: 50000',
    category: 'agentkit_protection'
  },
  {
    key: 'max_total_execution_tokens',
    value: 200000, // JSONB number
    description: 'Maximum total tokens for entire AgentKit execution. Circuit breaker threshold. Default: 200000',
    category: 'agentkit_protection'
  }
]

async function addTokenProtectionConfig() {
  console.log('🔧 Adding token protection configuration parameters...\n')

  for (const config of TOKEN_PROTECTION_CONFIGS) {
    // Check if exists
    const { data: existing, error: fetchError } = await supabase
      .from('system_settings_config')
      .select('key, value')
      .eq('key', config.key)
      .single()

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error(`❌ Error checking ${config.key}:`, fetchError.message)
      continue
    }

    if (existing) {
      console.log(`⏭️  ${config.key} already exists (value: ${existing.value})`)
      continue
    }

    // Insert new config
    const { error: insertError } = await supabase
      .from('system_settings_config')
      .insert({
        key: config.key,
        value: config.value, // JSONB value
        description: config.description,
        category: config.category
        // created_at and updated_at are set by database defaults
      })

    if (insertError) {
      console.error(`❌ Error inserting ${config.key}:`, insertError.message)
      continue
    }

    console.log(`✅ Added ${config.key} = ${config.value}`)
    console.log(`   Description: ${config.description}`)
    console.log('')
  }

  console.log('\n📊 Summary:')
  console.log('These parameters protect against token explosion by:')
  console.log('1. max_tool_response_chars: Truncating large API responses')
  console.log('2. loop_detection_window: Tracking recent tool calls')
  console.log('3. max_same_tool_repeats: Detecting infinite loops')
  console.log('4. max_tokens_per_iteration: Limiting per-iteration token usage')
  console.log('5. max_total_execution_tokens: Circuit breaker for total execution')
  console.log('\n🎯 These can be adjusted via Admin System Config UI')
}

addTokenProtectionConfig()
  .then(() => {
    console.log('\n✅ Token protection config setup complete!')
    process.exit(0)
  })
  .catch(err => {
    console.error('❌ Script failed:', err)
    process.exit(1)
  })
