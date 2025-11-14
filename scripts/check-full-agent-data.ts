import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkAgent() {
  const agentId = '3411f077-ba54-4ec2-9198-df1245195d34'

  const { data: agent, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .single()

  if (error) {
    console.error('❌ Error:', error.message)
    return
  }

  console.log('📋 Full workflow_steps structure:\n')
  console.log(JSON.stringify(agent.workflow_steps, null, 2))
}

checkAgent()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
