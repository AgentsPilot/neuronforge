/**
 * DSL Wrapper - Wraps compiled workflow steps in full PILOT DSL structure
 *
 * The DeclarativeCompiler generates WorkflowStep[] (execution steps),
 * but WorkflowPilot expects a full PilotGeneratedAgent structure.
 *
 * This utility bridges that gap by inferring metadata from the IR.
 */

import type { DeclarativeLogicalIR } from '../../logical-ir/schemas/declarative-ir-types'
import type { PILOTWorkflow, WorkflowStep, RequiredInput, SuggestedOutput } from '@/lib/pilot/types/pilot-dsl-types'

// Re-export the PILOT types for convenience
export type PilotGeneratedAgent = PILOTWorkflow

export interface DSLWrapperMetadata {
  plugins_used: string[]
  compilation_time_ms: number
  compiler_version?: string
}

// ============================================================================
// Main Wrapper Function
// ============================================================================

/**
 * Wrap compiled workflow steps in full PILOT DSL structure
 */
export function wrapInPilotDSL(
  steps: WorkflowStep[],
  ir: DeclarativeLogicalIR,
  metadata: DSLWrapperMetadata
): PilotGeneratedAgent {
  console.log('[DSLWrapper] Wrapping', steps.length, 'steps in PILOT DSL structure')

  // Infer agent name from goal
  const agentName = generateAgentName(ir.goal)
  console.log('[DSLWrapper] Generated agent name:', agentName)

  // Infer workflow type
  const workflowType = inferWorkflowType(ir)
  console.log('[DSLWrapper] Inferred workflow type:', workflowType)

  // Generate required inputs from data sources
  const requiredInputs = generateRequiredInputs(ir)
  console.log('[DSLWrapper] Generated', requiredInputs.length, 'required inputs')

  // Generate suggested outputs from delivery rules
  const suggestedOutputs = generateSuggestedOutputs(ir)
  console.log('[DSLWrapper] Generated', suggestedOutputs.length, 'suggested outputs')

  const dsl: PilotGeneratedAgent = {
    agent_name: agentName,
    description: ir.goal,
    workflow_type: workflowType,
    suggested_plugins: metadata.plugins_used,
    required_inputs: requiredInputs,
    workflow_steps: steps,
    suggested_outputs: suggestedOutputs,
    reasoning: `Compiled from declarative IR v${ir.ir_version} in ${metadata.compilation_time_ms}ms using DeclarativeCompiler`
  }

  console.log('[DSLWrapper] ✓ DSL structure created')
  return dsl
}

// ============================================================================
// Agent Name Generation
// ============================================================================

/**
 * Generate agent name from goal
 * Example: "Find urgent emails and append to Google Sheet" → "find-urgent-emails-and-append-to-google-sheet"
 */
function generateAgentName(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with dashes
    .replace(/^-|-$/g, '')        // Remove leading/trailing dashes
    .substring(0, 50)              // Limit length
}

// ============================================================================
// Workflow Type Inference
// ============================================================================

/**
 * Infer workflow type from IR structure
 */
function inferWorkflowType(ir: DeclarativeLogicalIR): 'pure_ai' | 'data_retrieval_ai' | 'ai_external_actions' {
  const hasDataSource = ir.data_sources && ir.data_sources.length > 0
  const hasAI = ir.ai_operations && ir.ai_operations.length > 0

  // Pure AI: Only AI operations, no data sources
  if (hasAI && !hasDataSource) {
    return 'pure_ai'
  }

  // Data Retrieval + AI: Has both data sources and AI operations
  if (hasDataSource && hasAI) {
    return 'data_retrieval_ai'
  }

  // AI + External Actions: Has data sources but no AI (default)
  return 'ai_external_actions'
}

// ============================================================================
// Required Inputs Generation
// ============================================================================

/**
 * Generate required inputs from IR runtime_inputs and data source configurations
 */
function generateRequiredInputs(ir: DeclarativeLogicalIR): RequiredInput[] {
  const inputs: RequiredInput[] = []

  // First: Add runtime_inputs from IR (these are user-provided at execution time)
  if (ir.runtime_inputs && ir.runtime_inputs.length > 0) {
    console.log('[DSLWrapper] Processing', ir.runtime_inputs.length, 'runtime inputs')
    ir.runtime_inputs.forEach(input => {
      inputs.push({
        name: input.name,
        type: input.type,
        label: input.label,
        required: input.required,
        description: input.description,
        placeholder: input.placeholder,
        reasoning: `Runtime input: ${input.description}`
      })
    })
  }

  // Then: Add data source configuration inputs
  ir.data_sources.forEach((ds, idx) => {
    if (ds.type === 'tabular') {
      // Google Sheets, Airtable, Notion, Excel, etc.
      const sourceName = ds.source.replace(/_/g, ' ')
      const baseInputName = ds.source.replace(/-/g, '_')

      // Add spreadsheet/table ID input
      inputs.push({
        name: `${baseInputName}_id`,
        type: 'text',
        label: `${sourceName} ID`,
        required: true,
        description: `The ID or URL of the ${sourceName} to access`,
        placeholder: `Enter ${sourceName} ID or URL`,
        reasoning: `Required to access ${ds.location || 'data'} in ${sourceName}`
      })

      // Add sheet/tab name if specified
      if (ds.tab) {
        inputs.push({
          name: `${baseInputName}_sheet_name`,
          type: 'text',
          label: `${sourceName} Sheet/Tab Name`,
          required: false,
          description: `The name of the sheet/tab to use (default: ${ds.tab})`,
          placeholder: ds.tab,
          reasoning: `Specifies which tab to read from in ${sourceName}`
        })
      }

      // Add range if it's a read operation
      if (ds.operation_type === 'read' || ds.operation_type === 'read_range') {
        inputs.push({
          name: `${baseInputName}_range`,
          type: 'text',
          label: `${sourceName} Range`,
          required: false,
          description: `The cell range to read (e.g., A1:Z100)`,
          placeholder: 'A:Z',
          reasoning: `Specifies which cells to read from ${sourceName}`
        })
      }
    } else if (ds.type === 'api') {
      // Gmail, Slack, Outlook, etc. - usually don't need user inputs
      // The plugin credentials are handled separately

      // Only add inputs if there are config parameters that should be user-provided
      if (ds.config) {
        const sourceName = ds.source.replace(/_/g, ' ')
        const baseInputName = ds.source.replace(/-/g, '_')

        // Check for search query parameter
        if ('query' in ds.config || 'search_query' in ds.config) {
          inputs.push({
            name: `${baseInputName}_query`,
            type: 'text',
            label: `${sourceName} Search Query`,
            required: false,
            description: `Search query to filter results from ${sourceName}`,
            placeholder: 'e.g., is:unread label:urgent',
            reasoning: `Used to filter data from ${sourceName} API`
          })
        }

        // Check for limit parameter
        if ('max_results' in ds.config || 'limit' in ds.config) {
          inputs.push({
            name: `${baseInputName}_max_results`,
            type: 'number',
            label: `Max Results from ${sourceName}`,
            required: false,
            description: `Maximum number of results to fetch (default: 100)`,
            placeholder: '100',
            reasoning: `Limits the number of results from ${sourceName} to improve performance`
          })
        }
      }
    }
  })

  return inputs
}

// ============================================================================
// Suggested Outputs Generation
// ============================================================================

/**
 * Generate suggested outputs from rendering and delivery rules
 */
function generateSuggestedOutputs(ir: DeclarativeLogicalIR): SuggestedOutput[] {
  const outputs: SuggestedOutput[] = []

  // Output 1: Rendered results (if rendering is specified)
  if (ir.rendering) {
    outputs.push({
      name: 'rendered_results',
      type: 'SummaryBlock',
      category: 'human-facing',
      description: `Rendered ${ir.rendering.type} with processed data`,
      format: ir.rendering.type.includes('table') ? 'table' :
              ir.rendering.type.includes('html') ? 'html' :
              ir.rendering.type.includes('json') ? 'json' : 'text',
      reasoning: `Rendering specified in IR with type: ${ir.rendering.type}`
    })
  }

  // Output 2: Summary delivery (if specified)
  const { delivery_rules } = ir
  if (delivery_rules.summary_delivery) {
    const deliveryPlugin = delivery_rules.summary_delivery.plugin_key || 'email'

    outputs.push({
      name: 'summary_delivery',
      type: deliveryPlugin.includes('mail') ? 'EmailDraft' : 'PluginAction',
      category: 'human-facing',
      description: `Summary sent to ${delivery_rules.summary_delivery.recipient || 'recipient'}`,
      format: 'html',
      plugin: deliveryPlugin,
      reasoning: `Summary delivery specified in delivery_rules to ${delivery_rules.summary_delivery.recipient}`
    })
  }

  // Output 3: Per-item delivery (if specified)
  if (delivery_rules.per_item_delivery) {
    const deliveryPlugin = delivery_rules.per_item_delivery.plugin_key || 'email'

    outputs.push({
      name: 'per_item_deliveries',
      type: 'PluginAction',
      category: 'machine-facing',
      description: `Individual deliveries sent per item`,
      plugin: deliveryPlugin,
      reasoning: `Per-item delivery specified in delivery_rules using ${deliveryPlugin}`
    })
  }

  // Output 4: Per-group delivery (if specified)
  if (delivery_rules.per_group_delivery) {
    const deliveryPlugin = delivery_rules.per_group_delivery.plugin_key || 'email'

    outputs.push({
      name: 'per_group_deliveries',
      type: 'PluginAction',
      category: 'machine-facing',
      description: `Deliveries sent per group`,
      plugin: deliveryPlugin,
      reasoning: `Per-group delivery specified in delivery_rules using ${deliveryPlugin}`
    })
  }

  // Output 5: Multi-destination delivery (if specified)
  if (delivery_rules.multiple_destinations && delivery_rules.multiple_destinations.length > 0) {
    outputs.push({
      name: 'multi_destination_deliveries',
      type: 'PluginAction',
      category: 'machine-facing',
      description: `Parallel deliveries to ${delivery_rules.multiple_destinations.length} destinations`,
      reasoning: `Multi-destination delivery to: ${delivery_rules.multiple_destinations.map(d => d.name || d.plugin_key).join(', ')}`
    })
  }

  // Output 6: AI processing results (if AI operations are specified)
  if (ir.ai_operations && ir.ai_operations.length > 0) {
    ir.ai_operations.forEach((aiOp, idx) => {
      outputs.push({
        name: `ai_${aiOp.type}_result`,
        type: 'SummaryBlock',
        category: 'machine-facing',
        description: `AI ${aiOp.type} operation result`,
        format: aiOp.output_schema?.type === 'object' ? 'json' : 'text',
        reasoning: `AI operation: ${aiOp.instruction}`
      })
    })
  }

  // If no outputs were generated, create a default one
  if (outputs.length === 0) {
    outputs.push({
      name: 'workflow_result',
      type: 'SummaryBlock',
      category: 'human-facing',
      description: 'Workflow execution result',
      format: 'text',
      reasoning: 'Default output for workflow completion'
    })
  }

  return outputs
}
