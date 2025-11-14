/**
 * Migration Script: Convert workflow_steps to pilot_steps
 *
 * Purpose:
 * - Convert existing agents' workflow_steps to Pilot format
 * - Validate the conversion
 * - Preview changes before applying
 * - Rollback capability
 *
 * Usage:
 *   npx ts-node scripts/migrate-workflow-steps-to-pilot.ts --preview
 *   npx ts-node scripts/migrate-workflow-steps-to-pilot.ts --apply
 *   npx ts-node scripts/migrate-workflow-steps-to-pilot.ts --agent-id=<id>
 */

import { createClient } from '@supabase/supabase-js'

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper function to convert legacy format to Pilot format
function convertToPilotSteps(workflowSteps: any[]): any[] {
  if (!workflowSteps || workflowSteps.length === 0) {
    return []
  }

  return workflowSteps.map((step, idx) => {
    // Handle dependencies from new AI format (already an array) or legacy format
    let dependencies = []
    if (Array.isArray(step.dependencies)) {
      dependencies = step.dependencies
    } else if (step.dependencies) {
      dependencies = [step.dependencies]
    } else if (idx > 0) {
      dependencies = [`step${idx}`]
    }

    const base = {
      id: step.id || `step${idx + 1}`,
      name: step.operation || step.name || `Step ${idx + 1}`,
      dependencies,
    }

    // Handle executeIf (conditional execution)
    const executeIf = step.executeIf ? { executeIf: step.executeIf } : {}

    // Convert conditional step type
    if (step.type === 'conditional') {
      return {
        ...base,
        type: 'conditional',
        condition: step.condition,
        params: step.params || {},
      }
    }

    // Convert legacy plugin_action to Pilot action
    if (step.type === 'plugin_action' && step.plugin && step.plugin_action) {
      return {
        ...base,
        ...executeIf,
        type: 'action',
        plugin: step.plugin,
        action: step.plugin_action,
        params: step.params || {},
      }
    }

    // Convert ai_processing to Pilot ai_processing
    if (step.type === 'ai_processing' || step.plugin === 'ai_processing') {
      return {
        ...base,
        ...executeIf,
        type: 'ai_processing',
        prompt: step.operation || step.prompt || step.name,
        params: {},
      }
    }

    // Handle transform steps
    if (step.type === 'transform') {
      return {
        ...base,
        type: 'transform',
        operation: step.operation,
        input: step.input,
        outputVariable: step.outputVariable,
        params: step.params || {
          operation: step.operation,
          input: step.input,
          outputVariable: step.outputVariable,
        },
      }
    }

    // Handle human_approval steps
    if (step.type === 'human_approval') {
      // Provide defaults for missing required fields
      const approvers = step.approvers || step.params?.approvers || []
      const approvalType = step.approvalType || step.params?.approvalType || 'any'
      const title = step.title || step.params?.title || step.name || 'Approval Required'
      const message = step.message || step.params?.message || 'Please review and approve'

      return {
        ...base,
        type: 'human_approval',
        approvers: approvers,
        approvalType: approvalType,
        title: title,
        message: message,
        timeout: step.timeout || step.params?.timeout || 3600000, // 1 hour default
        onTimeout: step.onTimeout || step.params?.onTimeout || 'reject',
        params: step.params || {
          approvers: approvers,
          approvalType: approvalType,
          title: title,
          message: message,
          timeout: step.timeout || 3600000,
          onTimeout: step.onTimeout || 'reject',
        },
      }
    }

    // Fallback: generic action
    return {
      ...base,
      type: step.type || 'action',
      plugin: step.plugin || 'unknown',
      action: step.plugin_action || step.action || 'process',
      params: step.params || {},
    }
  })
}

// Validate Pilot steps format
function validatePilotSteps(pilotSteps: any[]): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!Array.isArray(pilotSteps)) {
    errors.push('pilot_steps must be an array')
    return { valid: false, errors }
  }

  pilotSteps.forEach((step, idx) => {
    // Required fields
    if (!step.id) {
      errors.push(`Step ${idx}: missing required field 'id'`)
    }
    if (!step.name) {
      errors.push(`Step ${idx}: missing required field 'name'`)
    }
    if (!step.type) {
      errors.push(`Step ${idx}: missing required field 'type'`)
    }

    // Type-specific validation
    if (step.type === 'action') {
      if (!step.plugin) {
        errors.push(`Step ${idx} (${step.id}): action step missing 'plugin'`)
      }
      if (!step.action) {
        errors.push(`Step ${idx} (${step.id}): action step missing 'action'`)
      }
    }

    if (step.type === 'ai_processing') {
      if (!step.prompt) {
        errors.push(`Step ${idx} (${step.id}): ai_processing step missing 'prompt'`)
      }
    }

    if (step.type === 'human_approval') {
      if (!step.approvers || step.approvers.length === 0) {
        errors.push(`Step ${idx} (${step.id}): human_approval step missing 'approvers'`)
      }
      if (!step.approvalType) {
        errors.push(`Step ${idx} (${step.id}): human_approval step missing 'approvalType'`)
      }
    }

    if (step.type === 'conditional') {
      if (!step.condition) {
        errors.push(`Step ${idx} (${step.id}): conditional step missing 'condition'`)
      } else {
        if (!step.condition.field) {
          errors.push(`Step ${idx} (${step.id}): conditional condition missing 'field'`)
        }
        if (!step.condition.operator) {
          errors.push(`Step ${idx} (${step.id}): conditional condition missing 'operator'`)
        }
      }
    }

    // Dependencies validation
    if (step.dependencies && !Array.isArray(step.dependencies)) {
      errors.push(`Step ${idx} (${step.id}): dependencies must be an array`)
    }

    // ExecuteIf validation
    if (step.executeIf) {
      if (!step.executeIf.field) {
        errors.push(`Step ${idx} (${step.id}): executeIf missing 'field'`)
      }
      if (!step.executeIf.operator) {
        errors.push(`Step ${idx} (${step.id}): executeIf missing 'operator'`)
      }
    }
  })

  return {
    valid: errors.length === 0,
    errors,
  }
}

// Main migration function
async function migrateAgent(agentId: string, preview: boolean = true) {
  console.log(`\n${'='.repeat(80)}`)
  console.log(`📦 Processing Agent: ${agentId}`)
  console.log(`${'='.repeat(80)}`)

  // Fetch agent
  const { data: agent, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .single()

  if (error || !agent) {
    console.error(`❌ Agent not found: ${agentId}`)
    return { success: false, agentId }
  }

  console.log(`\n📋 Agent Info:`)
  console.log(`   Name: ${agent.agent_name}`)
  console.log(`   User ID: ${agent.user_id}`)
  console.log(`   Created: ${agent.created_at}`)

  // Check if already has pilot_steps
  if (agent.pilot_steps && agent.pilot_steps.length > 0) {
    console.log(`\n⚠️  Agent already has pilot_steps (${agent.pilot_steps.length} steps)`)
    console.log(`   Skipping migration...`)
    return { success: true, agentId, skipped: true }
  }

  // Check if has workflow_steps
  if (!agent.workflow_steps || agent.workflow_steps.length === 0) {
    console.log(`\n⚠️  Agent has no workflow_steps to migrate`)
    return { success: true, agentId, skipped: true }
  }

  console.log(`\n📊 Workflow Steps: ${agent.workflow_steps.length} steps`)

  // Convert to Pilot format
  console.log(`\n🔄 Converting to Pilot format...`)
  const pilotSteps = convertToPilotSteps(agent.workflow_steps)

  // Validate conversion
  console.log(`\n✅ Validating Pilot steps...`)
  const validation = validatePilotSteps(pilotSteps)

  if (!validation.valid) {
    console.error(`\n❌ Validation failed:`)
    validation.errors.forEach(err => console.error(`   - ${err}`))
    return { success: false, agentId, errors: validation.errors }
  }

  console.log(`   ✅ Validation passed!`)

  // Show comparison
  console.log(`\n📄 Conversion Preview:`)
  console.log(`${'─'.repeat(80)}`)

  pilotSteps.forEach((pilotStep, idx) => {
    const originalStep = agent.workflow_steps[idx]

    console.log(`\nStep ${idx + 1}:`)
    console.log(`  Original:`)
    console.log(`    Type: ${originalStep.type || 'N/A'}`)
    console.log(`    Plugin: ${originalStep.plugin || 'N/A'}`)
    console.log(`    Action: ${originalStep.plugin_action || 'N/A'}`)
    console.log(`    Operation: ${originalStep.operation || 'N/A'}`)

    console.log(`  Pilot Format:`)
    console.log(`    ID: ${pilotStep.id}`)
    console.log(`    Name: ${pilotStep.name}`)
    console.log(`    Type: ${pilotStep.type}`)
    console.log(`    Plugin: ${pilotStep.plugin || 'N/A'}`)
    console.log(`    Action: ${pilotStep.action || 'N/A'}`)
    console.log(`    Dependencies: ${pilotStep.dependencies.join(', ') || 'none'}`)
  })

  console.log(`\n${'─'.repeat(80)}`)

  // Show full JSON for inspection
  console.log(`\n📝 Full Pilot Steps JSON:`)
  console.log(JSON.stringify(pilotSteps, null, 2))

  if (preview) {
    console.log(`\n👀 PREVIEW MODE - No changes made`)
    console.log(`   Run with --apply to save changes`)
    return { success: true, agentId, preview: true, pilotSteps }
  }

  // Apply changes
  console.log(`\n💾 Saving pilot_steps to database...`)
  const { error: updateError } = await supabase
    .from('agents')
    .update({ pilot_steps: pilotSteps })
    .eq('id', agentId)

  if (updateError) {
    console.error(`\n❌ Failed to update agent:`, updateError.message)
    return { success: false, agentId, error: updateError.message }
  }

  console.log(`\n✅ Migration complete!`)
  console.log(`   Agent ${agentId} now has ${pilotSteps.length} pilot_steps`)

  return { success: true, agentId, applied: true, pilotSteps }
}

// Main execution
async function main() {
  const args = process.argv.slice(2)
  const preview = !args.includes('--apply')
  const specificAgentId = args.find(arg => arg.startsWith('--agent-id='))?.split('=')[1]

  console.log(`\n╔════════════════════════════════════════════════════════════╗`)
  console.log(`║  WORKFLOW STEPS → PILOT STEPS MIGRATION                   ║`)
  console.log(`║  Convert legacy format to Pilot execution format          ║`)
  console.log(`╚════════════════════════════════════════════════════════════╝`)

  console.log(`\n⚙️  Configuration:`)
  console.log(`   Mode: ${preview ? 'PREVIEW (safe)' : 'APPLY (will modify database)'}`)
  console.log(`   Target: ${specificAgentId || 'All agents with workflow_steps'}`)

  if (preview) {
    console.log(`\n⚠️  Running in PREVIEW mode - no changes will be made`)
    console.log(`   Use --apply to actually update the database`)
  }

  let agentsToMigrate: any[] = []

  // Fetch agents
  if (specificAgentId) {
    const { data: agent, error } = await supabase
      .from('agents')
      .select('id, agent_name')
      .eq('id', specificAgentId)
      .single()

    if (error || !agent) {
      console.error(`\n❌ Agent not found: ${specificAgentId}`)
      process.exit(1)
    }

    agentsToMigrate = [agent]
  } else {
    // Find all agents with workflow_steps but no pilot_steps
    const { data: agents, error } = await supabase
      .from('agents')
      .select('id, agent_name, workflow_steps, pilot_steps')
      .not('workflow_steps', 'is', null)

    if (error) {
      console.error(`\n❌ Failed to fetch agents:`, error.message)
      process.exit(1)
    }

    // Filter to only agents that need migration
    agentsToMigrate = (agents || []).filter(agent =>
      agent.workflow_steps &&
      agent.workflow_steps.length > 0 &&
      (!agent.pilot_steps || agent.pilot_steps.length === 0)
    )
  }

  if (agentsToMigrate.length === 0) {
    console.log(`\n✅ No agents need migration!`)
    console.log(`   All agents either:`)
    console.log(`   - Already have pilot_steps`)
    console.log(`   - Don't have workflow_steps`)
    return
  }

  console.log(`\n📊 Found ${agentsToMigrate.length} agent(s) to migrate:`)
  agentsToMigrate.forEach((agent, idx) => {
    console.log(`   ${idx + 1}. ${agent.agent_name} (${agent.id})`)
  })

  // Migrate each agent
  const results = []
  for (const agent of agentsToMigrate) {
    const result = await migrateAgent(agent.id, preview)
    results.push(result)
  }

  // Summary
  console.log(`\n\n╔════════════════════════════════════════════════════════════╗`)
  console.log(`║  MIGRATION SUMMARY                                        ║`)
  console.log(`╚════════════════════════════════════════════════════════════╝`)

  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  const skipped = results.filter(r => r.skipped).length
  const applied = results.filter(r => r.applied).length

  console.log(`\n📊 Results:`)
  console.log(`   Total: ${results.length}`)
  console.log(`   Successful: ${successful}`)
  console.log(`   Failed: ${failed}`)
  console.log(`   Skipped: ${skipped}`)
  console.log(`   Applied: ${applied}`)

  if (preview && successful > 0) {
    console.log(`\n💡 Next Steps:`)
    console.log(`   1. Review the conversion above`)
    console.log(`   2. Run with --apply to save changes:`)
    console.log(`      npx ts-node scripts/migrate-workflow-steps-to-pilot.ts --apply`)
  }

  if (failed > 0) {
    console.log(`\n⚠️  Some migrations failed. See errors above.`)
    process.exit(1)
  }

  console.log(`\n✅ Migration complete!`)
}

main().catch(error => {
  console.error(`\n❌ Fatal error:`, error)
  process.exit(1)
})
