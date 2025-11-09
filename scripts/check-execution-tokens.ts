import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkExecutionTokens() {
  const agentId = '3411f077-ba54-4ec2-9198-df1245195d34'

  console.log(`🔍 Checking recent executions for agent ${agentId}...\n`)

  // Get recent executions
  const { data: executions, error } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('❌ Error:', error.message)
    return
  }

  if (!executions || executions.length === 0) {
    console.log('⚠️  No executions found')
    return
  }

  console.log(`📊 Found ${executions.length} recent execution(s):\n`)

  executions.forEach((exec: any, idx) => {
    console.log(`${idx + 1}. Execution ${exec.id}`)
    console.log(`   Full data:`, JSON.stringify(exec, null, 2))
    console.log('')
  })

  // Check agent_intensity_metrics table
  const { data: metrics, error: metricsError } = await supabase
    .from('agent_intensity_metrics')
    .select('*')
    .eq('agent_id', agentId)
    .single()

  if (metricsError) {
    console.error('❌ Error fetching metrics:', metricsError.message)
    return
  }

  console.log('\n📊 Agent Intensity Metrics:')
  console.log(`   Total executions: ${metrics.total_executions}`)
  console.log(`   Total tokens used: ${metrics.total_tokens_used}`)
  console.log(`   Avg tokens per run: ${metrics.avg_tokens_per_run}`)
  console.log(`   Peak tokens: ${metrics.peak_tokens_single_run}`)
  console.log(`   Total credits: ${Math.ceil(metrics.total_tokens_used / 10)}`)
}

checkExecutionTokens()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
