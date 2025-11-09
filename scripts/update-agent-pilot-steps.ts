// Script to update agent with pilot_steps
// Run with: npx tsx scripts/update-agent-pilot-steps.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const AGENT_ID = '3411f077-ba54-4ec2-9198-df1245195d34'

// Convert workflow_steps (Smart Agent Builder format) to pilot_steps (Pilot format)
// Following the same logic as WorkflowParser.normalizeSteps()
function convertToPilotSteps(workflowSteps: any[]): any[] {
  return workflowSteps.map((step, index) => {
    const generatedId = `step${index + 1}`

    if (step.type === 'plugin_action') {
      // Check if plugin and plugin_action are missing
      // If so, treat as ai_processing instead
      if (!step.plugin || !step.plugin_action) {
        console.warn(`⚠️  Step ${index + 1} is plugin_action but missing plugin/action, converting to ai_processing`)
        return {
          id: generatedId,
          type: 'ai_processing' as const,
          name: step.operation || `AI Processing ${index + 1}`,
          prompt: step.operation || undefined,
          params: step.params || {},
          dependencies: [],
        }
      }

      // Convert legacy plugin_action to orchestrator action step
      return {
        id: generatedId,
        type: 'action' as const,
        name: step.operation || `Step ${index + 1}`,
        plugin: step.plugin,
        action: step.plugin_action,
        params: step.params || {},
        dependencies: [],
      }
    }

    if (step.type === 'ai_processing') {
      // Convert legacy ai_processing to orchestrator ai_processing step
      return {
        id: generatedId,
        type: 'ai_processing' as const,
        name: step.operation || `AI Processing ${index + 1}`,
        prompt: step.operation || undefined,
        params: step.params || {},
        dependencies: [],
      }
    }

    // If it's already in the correct format but just missing ID, add it
    return {
      ...step,
      id: generatedId,
    }
  })
}

async function updateAgent() {
  console.log(`🔧 Updating agent ${AGENT_ID} with pilot_steps...\n`)

  // First, fetch current agent to see what we have
  const { data: currentAgent, error: fetchError } = await supabase
    .from('agents')
    .select('id, agent_name, workflow_steps, pilot_steps')
    .eq('id', AGENT_ID)
    .single()

  if (fetchError) {
    console.error('❌ Error fetching agent:', fetchError.message)
    return
  }

  console.log('📋 Current agent state:')
  console.log(`   Name: ${currentAgent.agent_name}`)
  console.log(`   Workflow steps: ${currentAgent.workflow_steps?.length || 0}`)
  console.log(`   Pilot steps: ${currentAgent.pilot_steps?.length || 0}`)

  if (!currentAgent.workflow_steps || currentAgent.workflow_steps.length === 0) {
    console.error('❌ No workflow_steps found to convert!')
    return
  }

  // Convert workflow_steps to pilot_steps using the same logic as WorkflowParser
  console.log('\n🔄 Converting workflow_steps to pilot_steps...')
  const convertedPilotSteps = convertToPilotSteps(currentAgent.workflow_steps)

  console.log(`   Converted ${convertedPilotSteps.length} steps`)
  console.log('\n📋 Converted pilot_steps:')
  convertedPilotSteps.forEach((step, idx) => {
    console.log(`   ${idx + 1}. ${step.name} (${step.type})`)
    if (step.plugin) {
      console.log(`      Plugin: ${step.plugin} - ${step.action}`)
    }
  })

  // Update with pilot_steps
  const { data: updatedAgent, error: updateError } = await supabase
    .from('agents')
    .update({
      pilot_steps: convertedPilotSteps,
      updated_at: new Date().toISOString()
    })
    .eq('id', AGENT_ID)
    .select('id, agent_name, pilot_steps')
    .single()

  if (updateError) {
    console.error('❌ Error updating agent:', updateError.message)
    return
  }

  console.log('\n✅ Agent updated successfully!')
  console.log(`   Pilot steps added: ${updatedAgent.pilot_steps?.length || 0}`)
  console.log('\n📊 Pilot steps structure:')
  updatedAgent.pilot_steps?.forEach((step: any, idx: number) => {
    console.log(`   ${idx + 1}. ${step.name} (${step.type})`)
    if (step.plugin) {
      console.log(`      Plugin: ${step.plugin} - ${step.plugin_action}`)
    }
    if (step.dependencies?.length > 0) {
      console.log(`      Dependencies: ${step.dependencies.join(', ')}`)
    }
  })

  console.log('\n🚀 Agent is now ready to use Pilot execution!')
}

updateAgent()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Script failed:', err)
    process.exit(1)
  })
