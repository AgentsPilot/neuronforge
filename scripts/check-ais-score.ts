import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkAISScore() {
  const agentId = '3411f077-ba54-4ec2-9198-df1245195d34'

  // Check AIS metrics
  const { data: metrics, error } = await supabase
    .from('agent_intensity_metrics')
    .select('*')
    .eq('agent_id', agentId)
    .single()

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('📊 Agent Intensity Score (AIS):')
  console.log(`   Combined Score: ${metrics.combined_score}`)
  console.log(`   Creation Score: ${metrics.creation_score}`)
  console.log(`   Execution Score: ${metrics.execution_score}`)
  console.log(`   Success Rate: ${metrics.success_rate}%`)
  console.log(`   Total Executions: ${metrics.total_executions}`)

  // Check routing thresholds
  const { data: settings } = await supabase
    .from('system_settings_config')
    .select('key, value')
    .in('key', ['routing_low_threshold', 'routing_medium_threshold', 'routing_min_success_rate'])

  console.log('\n🎯 Routing Thresholds:')
  settings?.forEach(s => {
    console.log(`   ${s.key}: ${s.value}`)
  })

  // Determine which model should be used
  const lowThreshold = settings?.find(s => s.key === 'routing_low_threshold')?.value || 3.9
  const mediumThreshold = settings?.find(s => s.key === 'routing_medium_threshold')?.value || 6.9

  console.log('\n🤖 Model Selection Logic:')
  if (metrics.combined_score <= lowThreshold) {
    console.log(`   Score ${metrics.combined_score} <= ${lowThreshold} → GPT-4o-mini (LOW)`)
  } else if (metrics.combined_score <= mediumThreshold) {
    console.log(`   Score ${metrics.combined_score} <= ${mediumThreshold} → Claude Haiku (MEDIUM) ✅`)
  } else {
    console.log(`   Score ${metrics.combined_score} > ${mediumThreshold} → GPT-4o (HIGH) ⚠️`)
  }
}

checkAISScore()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
