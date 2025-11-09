// Check pilot_steps for Email Urgency Analyzer agent
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const AGENT_ID = '3411f077-ba54-4ec2-9198-df1245195d34'

async function checkPilotSteps() {
  const { data: agent, error } = await supabase
    .from('agents')
    .select('agent_name, pilot_steps')
    .eq('id', AGENT_ID)
    .single()

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log(`\n📋 Agent: ${agent.agent_name}`)
  console.log(`\n🔄 Pilot Steps (${agent.pilot_steps?.length || 0} steps):\n`)

  agent.pilot_steps?.forEach((step: any, index: number) => {
    console.log(`Step ${index + 1} (ID: ${step.id}):`)
    console.log(`  Name: ${step.name}`)
    console.log(`  Type: ${step.type}`)
    if (step.plugin) console.log(`  Plugin: ${step.plugin}`)
    if (step.action) console.log(`  Action: ${step.action}`)
    if (step.prompt) console.log(`  Prompt: ${step.prompt}`)
    console.log(`  Dependencies: ${JSON.stringify(step.dependencies || [])}`)
    console.log('')
  })
}

checkPilotSteps()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Script failed:', err)
    process.exit(1)
  })
