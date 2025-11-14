import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkAgent() {
  const agentId = '3411f077-ba54-4ec2-9198-df1245195d34'

  console.log(`🔍 Checking agent ${agentId}...\n`)

  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, agent_name, created_at, workflow_steps, pilot_steps, user_prompt')
    .eq('id', agentId)
    .single()

  if (error) {
    console.error('❌ Error:', error.message)
    return
  }

  console.log(`📋 Agent: ${agent.agent_name}`)
  console.log(`📅 Created: ${agent.created_at}`)
  const promptPreview = agent.user_prompt ? agent.user_prompt.substring(0, 100) : 'N/A'
  console.log(`📝 Prompt: ${promptPreview}...`)
  console.log(`\n📊 Workflow Steps: ${agent.workflow_steps?.length || 0} steps`)
  console.log(`🚀 Pilot Steps: ${agent.pilot_steps?.length || 0} steps`)

  if (agent.workflow_steps && agent.workflow_steps.length > 0) {
    console.log('\n🔧 Workflow Steps:')
    agent.workflow_steps.forEach((step: any, idx: number) => {
      console.log(`  ${idx + 1}. ${step.operation || step.action} (${step.type})`)
    })
  }

  if (agent.pilot_steps && agent.pilot_steps.length > 0) {
    console.log('\n🚀 Pilot Steps:')
    agent.pilot_steps.forEach((step: any, idx: number) => {
      console.log(`  ${idx + 1}. ${step.type}: ${step.name || step.description}`)
    })
  } else {
    console.log('\n⚠️  No pilot_steps found!')
    console.log('   This agent will use AgentKit/runAgentWithContext instead of Pilot')
  }

  // Check if it should have pilot_steps
  const shouldHavePilot = agent.workflow_steps && agent.workflow_steps.length > 3
  if (shouldHavePilot && !agent.pilot_steps) {
    console.log('\n🔴 ISSUE: Agent has 7+ workflow_steps but no pilot_steps!')
    console.log('   Expected: Pilot steps should have been generated')
    console.log('   Actual: Missing pilot_steps')
    console.log('\n   This likely means:')
    console.log('   - Agent was created before Pilot was enabled, OR')
    console.log('   - requiresPilotFeatures() returned false during creation')
  }
}

checkAgent()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
