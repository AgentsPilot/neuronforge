import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkAgentModel() {
  const agentId = '3411f077-ba54-4ec2-9198-df1245195d34'

  // Check agent settings
  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, agent_name')
    .eq('id', agentId)
    .single()

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('🤖 Agent Configuration:')
  console.log(`   Name: ${agent.agent_name}`)
  console.log(`   Note: Model/provider stored in execution, not agent table`)

  // Check routing settings
  const { data: settings } = await supabase
    .from('system_settings_config')
    .select('key, value')
    .in('key', ['intelligent_routing_enabled', 'anthropic_provider_enabled'])

  console.log('\n📊 System Settings:')
  settings?.forEach(s => {
    console.log(`   ${s.key}: ${s.value}`)
  })

  // Check recent execution with AIS score
  const { data: execution } = await supabase
    .from('agent_executions')
    .select('ais_score, model, provider, success')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (execution) {
    console.log('\n📈 Recent Execution:')
    console.log(`   AIS Score: ${execution.ais_score || 'not calculated'}`)
    console.log(`   Model Used: ${execution.model}`)
    console.log(`   Provider: ${execution.provider}`)
    console.log(`   Success: ${execution.success}`)
  }
}

checkAgentModel()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
