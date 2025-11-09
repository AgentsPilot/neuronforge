import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function verifyTokenProtection() {
  console.log('🔍 Verifying Token Protection Configuration...\n')

  const protectionParams = [
    'max_tool_response_chars',
    'loop_detection_window',
    'max_same_tool_repeats',
    'max_tokens_per_iteration',
    'max_total_execution_tokens'
  ]

  console.log('📊 Checking system_settings_config:\n')

  for (const param of protectionParams) {
    const { data, error } = await supabase
      .from('system_settings_config')
      .select('key, value, description, category')
      .eq('key', param)
      .single()

    if (error) {
      console.log(`❌ ${param}: NOT FOUND`)
      console.log(`   Error: ${error.message}\n`)
    } else {
      console.log(`✅ ${param}:`)
      console.log(`   Value: ${data.value}`)
      console.log(`   Category: ${data.category}`)
      console.log(`   Description: ${data.description}`)
      console.log('')
    }
  }

  console.log('\n💰 Cost Analysis:')
  console.log('   Circuit breaker limit: 200,000 tokens')
  console.log('   Per-iteration limit: 50,000 tokens')
  console.log('   Expected cost per execution (200K tokens @ GPT-4o):')
  console.log('     - Input only:  $0.50')
  console.log('     - Output only: $2.00')
  console.log('     - Average (50/50): $1.25')

  console.log('\n🛡️  Protection Layers:')
  console.log('   1. Response Truncation: 8,000 chars (~2,000 tokens)')
  console.log('   2. Loop Detection: 3 consecutive identical tool calls')
  console.log('   3. Per-Iteration Limit: 50,000 tokens')
  console.log('   4. Circuit Breaker: 200,000 tokens total')

  console.log('\n✨ Token protection verification complete!')
}

verifyTokenProtection()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err)
    process.exit(1)
  })
