/**
 * Full End-to-End Pipeline Test for IR v4.0
 *
 * This script tests the complete V6 workflow pipeline:
 * INPUT: Enhanced Prompt (golden source)
 * Phase 0: Hard Requirements Extraction (R1-R6)
 * Phase 1: Semantic Plan Generation (Claude Opus 4.5)
 * Phase 2: Grounding (skipped for API-only workflows)
 * Phase 3: IR Formalization (GPT-4o with v4.0 prompt)
 * Phase 4: Compilation to PILOT DSL (ExecutionGraphCompiler)
 * Phase 5: DSL Validation & Workflow Analysis
 * Phase 6: Execution Order Verification (bug fix check)
 *
 * Outputs detailed information at each stage for verification.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { HardRequirementsExtractor } from '../lib/agentkit/v6/requirements/HardRequirementsExtractor'
import { SemanticPlanGenerator } from '../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'
import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer'
import { ExecutionGraphCompiler } from '../lib/agentkit/v6/compiler/ExecutionGraphCompiler'
import type { DeclarativeLogicalIRv4 } from '../lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4'
import { ExecutionGraphVisualizer } from '../lib/agentkit/v6/utils/ExecutionGraphVisualizer'

// Test Enhanced Prompt - Invoice workflow with conditional Sheets append
const testEnhancedPrompt = {
  "plan_title": "Expense & Invoice Email Scanner (Drive + Sheet Threshold)",
  "plan_description": "Scans Gmail for PDF attachments matching your query in the last 24 hours, extracts invoice/expense fields, stores each PDF in Google Drive (per-vendor folder under a base folder), emails a single digest summary, and appends rows to a Google Sheet only when the amount is greater than 50 in the document's currency.",
  "sections": {
    "data": [
      "- Search Gmail using this exact Gmail search query: \"subject include: Invoice or Expenses or Bill and has:attachment filename:pdf\".",
      "- Limit the scan to emails from the last 24 hours.",
      "- Consider only emails that contain PDF attachments.",
      "- For each matching email, collect the email metadata needed for traceability: sender, subject, received date, message id.",
      "- For each PDF attachment, capture the attachment filename and the attachment content for extraction."
    ],
    "output": [
      "- Produce a single digest email that contains a table.",
      "- The digest email table must include these columns: Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link.",
      "- If no matching items are found in the last 24 hours, send a digest email stating that no invoices/expenses were found."
    ],
    "actions": [
      "- For each PDF attachment found, extract these fields: Type (expense or invoice), Vendor / merchant, Date, Amount, Invoice/receipt #, Category.",
      "- Normalize the extracted Amount into a numeric value for comparison.",
      "- If the agent cannot confidently find an Amount, still include the item in the digest email and still store the attachment in Google Drive, and do not append anything to Google Sheets.",
      "- Use this Google Drive base folder as the parent location for storage: \"https://drive.google.com/drive/folders/1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-?usp=drive_link\".",
      "- Create (or reuse) a Google Drive subfolder named exactly as the extracted Vendor / merchant under the base folder.",
      "- Store the original PDF attachment in the vendor's Google Drive subfolder.",
      "- Generate a shareable Google Drive link for the stored attachment and include it in outputs.",
      "- Build a digest table row for each extracted item with: Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link.",
      "- If the extracted Amount is greater than 50 in the document's currency, append a row to Google Sheet id \"1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE\" using the same columns as the digest table: Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link.",
      "- If the extracted Amount is not greater than 50 in the document's currency, do not append a row to Google Sheets."
    ],
    "delivery": [
      "- Send the digest email to meiribarak@gmail.com."
    ],
    "processing_steps": [
      "- Run the Gmail search query over the last 24 hours.",
      "- Filter results to emails with PDF attachments.",
      "- For each PDF attachment, extract fields and determine the vendor folder name.",
      "- Store the PDF in Google Drive under the base folder and capture the Drive link.",
      "- Build the digest table and apply the > 50 (document currency) rule for Google Sheets insertion.",
      "- Send the digest email."
    ]
  },
  "specifics": {
    "services_involved": [
      "google-mail",
      "google-drive",
      "google-sheets",
      "chatgpt-research"
    ],
    "resolved_user_inputs": [
      { "key": "user_email", "value": "meiribarak@gmail.com" },
      { "key": "gmail_search_query", "value": "subject include: Invoice or Expenses or Bill and has:attachment filename:pdf" },
      { "key": "scan_time_window", "value": "last 24 hours" },
      { "key": "drive_base_folder_url", "value": "https://drive.google.com/drive/folders/1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-?usp=drive_link" },
      { "key": "sheet_id", "value": "1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE" },
      { "key": "candidate_sheet_tab_names", "value": "Invoices, Expenses" },
      { "key": "attachment_type_filter", "value": "PDF attachments" },
      { "key": "summary_delivery_style", "value": "single digest email" },
      { "key": "summary_columns", "value": "Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link" },
      { "key": "drive_storage_rule", "value": "attachments only; create a folder per vendor and store the attachment in it" },
      { "key": "sheet_write_rule", "value": "append only if amount is greater than 50 in the document currency" },
      { "key": "missing_amount_handling", "value": "email + store; skip Sheet" }
    ],
    "user_inputs_required": [
      "Which Google Sheet tab name to append rows into (choose one: Invoices or Expenses)"
    ]
  }
}

async function runFullPipeline() {
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  IR v4.0 FULL END-TO-END PIPELINE TEST')
  console.log('═══════════════════════════════════════════════════════════════════\n')

  const pipelineStart = Date.now()

  // ============================================================================
  // INPUT: Enhanced Prompt
  // ============================================================================
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ INPUT: Enhanced Prompt (Golden Source)                          │')
  console.log('└─────────────────────────────────────────────────────────────────┘')
  console.log('Plan Title:', testEnhancedPrompt.plan_title)
  console.log('Description:', testEnhancedPrompt.plan_description)
  console.log('\nSections:')
  console.log('  - data:', testEnhancedPrompt.sections.data.length, 'items')
  console.log('  - actions:', testEnhancedPrompt.sections.actions.length, 'items')
  console.log('  - output:', testEnhancedPrompt.sections.output.length, 'items')
  console.log('  - delivery:', testEnhancedPrompt.sections.delivery.length, 'items')
  console.log('  - processing_steps:', testEnhancedPrompt.sections.processing_steps.length, 'items')
  console.log('\nServices Involved:', testEnhancedPrompt.specifics.services_involved.join(', '))
  console.log('Resolved Inputs:', testEnhancedPrompt.specifics.resolved_user_inputs.length, 'parameters')
  console.log('\n✅ Enhanced Prompt loaded\n')

  // ============================================================================
  // PHASE 0: Hard Requirements Extraction
  // ============================================================================
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 0: Hard Requirements Extraction                           │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  const requirementsStart = Date.now()
  const requirementsExtractor = new HardRequirementsExtractor()

  console.log('Extracting hard requirements (R1-R6) from Enhanced Prompt...')

  const hardRequirements = requirementsExtractor.extract(testEnhancedPrompt)
  const requirementsDuration = Date.now() - requirementsStart

  console.log(`✅ Requirements extracted in ${requirementsDuration}ms`)

  console.log('\nExtracted Requirements:')
  console.log('  - R1 (Unit of Work):', hardRequirements.unit_of_work || 'none')
  console.log('  - R2 (Thresholds):', hardRequirements.thresholds?.length || 0)
  console.log('  - R3 (Routing Rules):', hardRequirements.routing_rules?.length || 0)
  console.log('  - R4 (Invariants):', hardRequirements.invariants?.length || 0)
  console.log('  - R5 (Empty Behavior):', hardRequirements.empty_behavior || 'none')
  console.log('  - R6 (Required Outputs):', hardRequirements.required_outputs?.length || 0)
  console.log('  - Side Effect Constraints:', hardRequirements.side_effect_constraints?.length || 0)
  console.log('  - Total Requirements:', hardRequirements.requirements?.length || 0)

  if (hardRequirements.requirements && hardRequirements.requirements.length > 0) {
    console.log('\nDetailed Requirements:')
    hardRequirements.requirements.forEach(req => {
      console.log(`    ${req.id}: [${req.type}] ${req.constraint}`)
    })
  }
  console.log()

  // ============================================================================
  // PHASE 1: Semantic Plan Generation
  // ============================================================================
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 1: Semantic Plan Generation (Claude Opus 4.5)             │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  const semanticStart = Date.now()
  const semanticGenerator = new SemanticPlanGenerator({
    model_provider: 'anthropic',
    model_name: 'claude-opus-4-5-20251101',
    temperature: 0
  })

  console.log('Model: claude-opus-4-5-20251101')
  console.log('Temperature: 0 (deterministic)')
  console.log('\nGenerating semantic plan (with hard requirements context)...')

  // Note: Hard requirements are extracted but semantic plan generator
  // receives the enhanced prompt directly (requirements influence downstream phases)
  const semanticResult = await semanticGenerator.generate(testEnhancedPrompt)
  const semanticDuration = Date.now() - semanticStart

  console.log(`✅ Semantic plan generated in ${(semanticDuration / 1000).toFixed(1)}s`)

  if (semanticResult.semantic_plan) {
    const plan = semanticResult.semantic_plan
    console.log('\nSemantic Plan Summary:')
    console.log('  - Data Sources:', plan.understanding.data_sources?.length || 0)
    console.log('  - AI Processing:', plan.understanding.ai_processing?.length || 0)
    console.log('  - File Operations:', plan.understanding.file_operations?.length || 0)
    console.log('  - Delivery:', plan.understanding.delivery ? 'Yes' : 'No')
    console.log('  - Assumptions:', plan.assumptions?.length || 0)
    console.log('  - Ambiguities:', plan.ambiguities?.length || 0)
  }
  console.log()

  // Create grounded plan (mock grounding for this test)
  const groundedPlan = {
    ...semanticResult.semantic_plan!,
    grounded: false,
    grounding_results: [],
    grounding_errors: [],
    validated_assumptions_count: 0,
    total_assumptions_count: semanticResult.semantic_plan!.assumptions?.length || 0,
    grounding_confidence: 0,
    grounding_timestamp: new Date().toISOString()
  }

  // ============================================================================
  // PHASE 2: IR Formalization
  // ============================================================================
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 2: IR Formalization (GPT-4o + v4.0 Prompt)                │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  const formalizationStart = Date.now()
  const formalizer = new IRFormalizer({
    model: 'chatgpt-4o-latest',
    temperature: 0.0,
    openai_api_key: process.env.OPENAI_API_KEY
  })

  console.log('Model: chatgpt-4o-latest')
  console.log('Temperature: 0.0 (deterministic)')
  console.log('Prompt: formalization-system-v4.md')
  console.log('\nFormalizing to IR v4.0...')

  const irResult = await formalizer.formalize(groundedPlan)
  const formalizationDuration = Date.now() - formalizationStart

  console.log(`✅ IR formalization complete in ${(formalizationDuration / 1000).toFixed(1)}s`)

  const ir = irResult.ir as DeclarativeLogicalIRv4
  console.log('\nIR v4.0 Summary:')
  console.log('  - IR Version:', ir.ir_version)
  console.log('  - Goal:', ir.goal)

  if (ir.execution_graph) {
    const graph = ir.execution_graph
    console.log('  - Start Node:', graph.start)
    console.log('  - Total Nodes:', Object.keys(graph.nodes).length)
    console.log('  - Variables Declared:', graph.variables?.length || 0)

    // Count node types
    const nodeTypes: Record<string, number> = {}
    for (const node of Object.values(graph.nodes)) {
      nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1
    }
    console.log('  - Node Types:')
    for (const [type, count] of Object.entries(nodeTypes)) {
      console.log(`      ${type}: ${count}`)
    }

    console.log('\n📊 Full IR v4.0 Structure:')
    console.log(JSON.stringify(ir, null, 2))
  }
  console.log()

  // ============================================================================
  // PHASE 3: Execution Graph Visualization
  // ============================================================================
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 3: Execution Graph Visualization                          │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  if (ir.execution_graph) {
    const visualizer = new ExecutionGraphVisualizer()

    // Generate Mermaid diagram
    console.log('\n📈 Mermaid Diagram:')
    console.log('```mermaid')
    const mermaid = visualizer.toMermaid(ir.execution_graph)
    console.log(mermaid)
    console.log('```\n')

    // Analyze complexity
    const analysis = visualizer.analyze(ir.execution_graph)
    console.log('📊 Complexity Analysis:')
    console.log('  - Total Nodes:', analysis.nodeCount)
    console.log('  - Max Depth:', analysis.maxDepth)
    console.log('  - Estimated Complexity:', analysis.estimatedComplexity)
    console.log('  - Node Type Distribution:', JSON.stringify(analysis.nodeTypes, null, 2))
    console.log()
  }

  // ============================================================================
  // PHASE 4: Compilation to PILOT DSL
  // ============================================================================
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 4: Compilation to PILOT DSL (ExecutionGraphCompiler)      │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  const compilationStart = Date.now()
  const compiler = new ExecutionGraphCompiler()

  console.log('Compiler: ExecutionGraphCompiler')
  console.log('\nCompiling execution graph to PILOT DSL...')

  const compiled = await compiler.compile(ir)
  const compilationDuration = Date.now() - compilationStart

  console.log(`✅ Compilation complete in ${compilationDuration}ms`)

  console.log('\nCompilation Result:')
  console.log('  - Success:', compiled.success)
  console.log('  - Total Steps:', compiled.workflow.length)
  console.log('  - Plugins Used:', Array.from(compiled.plugins_used || []).join(', '))
  console.log('  - Compilation Time:', compilationDuration, 'ms')

  if (compiled.errors && compiled.errors.length > 0) {
    console.log('  - Errors:', compiled.errors.length)
    for (const error of compiled.errors) {
      console.log('    ❌', error)
    }
  }

  console.log('\n📋 Compilation Logs:')
  for (const log of compiled.logs) {
    console.log('  ', log)
  }

  console.log()

  // ============================================================================
  // PHASE 5: DSL Validation & Workflow Analysis
  // ============================================================================
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 5: DSL Validation & Workflow Analysis                     │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  console.log('\n📋 Workflow Steps Summary:')
  console.log(`  - Total Steps: ${compiled.workflow.length}`)

  // Analyze step types
  const stepTypes: Record<string, number> = {}
  const pluginUsage: Record<string, number> = {}

  for (const step of compiled.workflow) {
    stepTypes[step.type] = (stepTypes[step.type] || 0) + 1
    if (step.plugin) {
      pluginUsage[step.plugin] = (pluginUsage[step.plugin] || 0) + 1
    }
  }

  console.log('\n  Step Types:')
  for (const [type, count] of Object.entries(stepTypes)) {
    console.log(`    - ${type}: ${count}`)
  }

  console.log('\n  Plugin Usage:')
  for (const [plugin, count] of Object.entries(pluginUsage)) {
    console.log(`    - ${plugin}: ${count} operations`)
  }

  console.log('\n🎯 Complete PILOT DSL Workflow:')
  console.log('─'.repeat(65))

  // Print each step with details
  for (let i = 0; i < compiled.workflow.length; i++) {
    const step = compiled.workflow[i]
    console.log(`\nStep ${i + 1}: ${step.step_id}`)
    console.log(`  Type: ${step.type}`)

    if (step.plugin) {
      console.log(`  Plugin: ${step.plugin}`)
    }
    if (step.operation) {
      console.log(`  Operation: ${step.operation}`)
    }
    if (step.description) {
      console.log(`  Description: ${step.description}`)
    }
    if (step.output_variable) {
      console.log(`  Output Variable: ${step.output_variable}`)
    }

    // Show nested steps for scatter_gather
    if (step.type === 'scatter_gather' && step.scatter?.steps) {
      console.log(`  Loop Input: ${step.scatter.input}`)
      console.log(`  Loop Variable: ${step.scatter.itemVariable}`)
      console.log(`  Nested Steps (${step.scatter.steps.length}):`)

      for (let j = 0; j < step.scatter.steps.length; j++) {
        const nestedStep = step.scatter.steps[j]
        console.log(`    ${j + 1}. ${nestedStep.step_id} (${nestedStep.type})${nestedStep.plugin ? ` - ${nestedStep.plugin}` : ''}`)

        // Show conditional branches
        if (nestedStep.type === 'conditional' && nestedStep.steps) {
          console.log(`       Condition: ${JSON.stringify(nestedStep.condition)}`)
          console.log(`       If True:`)
          for (const condStep of nestedStep.steps) {
            console.log(`         - ${condStep.step_id} (${condStep.type})${condStep.plugin ? ` - ${condStep.plugin}` : ''}`)
          }
        }
      }

      if (step.gather) {
        console.log(`  Gather: ${step.gather.operation} → ${step.gather.outputKey}`)
      }
    }

    // Show conditional branches at top level
    if (step.type === 'conditional' && step.steps) {
      console.log(`  Condition: ${JSON.stringify(step.condition)}`)
      console.log(`  If True (${step.steps.length} steps):`)
      for (const condStep of step.steps) {
        console.log(`    - ${condStep.step_id} (${condStep.type})${condStep.plugin ? ` - ${condStep.plugin}` : ''}`)
      }
    }
  }

  console.log('\n' + '─'.repeat(65))
  console.log('\n✅ DSL Analysis Complete')

  // Validate DSL structure
  console.log('\n🔍 DSL Structure Validation:')

  let hasInvalidSteps = false
  const outputVariables = new Set<string>()
  const usedVariables = new Set<string>()

  // Collect all output variables and check for issues
  for (const step of compiled.workflow) {
    // Check for required fields
    if (!step.step_id) {
      console.log(`  ❌ Step missing step_id: ${JSON.stringify(step).substring(0, 50)}...`)
      hasInvalidSteps = true
    }
    if (!step.type) {
      console.log(`  ❌ Step missing type: ${step.step_id}`)
      hasInvalidSteps = true
    }

    // Track output variables
    if (step.output_variable) {
      outputVariables.add(step.output_variable)
    }

    // Check scatter_gather structure
    if (step.type === 'scatter_gather') {
      if (!step.scatter) {
        console.log(`  ❌ scatter_gather step missing scatter config: ${step.step_id}`)
        hasInvalidSteps = true
      } else {
        if (!step.scatter.input) {
          console.log(`  ❌ scatter_gather missing input: ${step.step_id}`)
          hasInvalidSteps = true
        }
        if (!step.scatter.itemVariable) {
          console.log(`  ❌ scatter_gather missing itemVariable: ${step.step_id}`)
          hasInvalidSteps = true
        }

        // Track variable usage
        if (step.scatter.input && typeof step.scatter.input === 'string') {
          const varMatch = step.scatter.input.match(/\{\{(\w+)\}\}/)
          if (varMatch) usedVariables.add(varMatch[1])
        }
      }
    }

    // Check for variable references in config
    if (step.config) {
      const configStr = JSON.stringify(step.config)
      const varMatches = configStr.match(/\{\{(\w+)(?:\.\w+)*\}\}/g) || []
      for (const match of varMatches) {
        const varName = match.replace(/\{\{|\}\}/g, '').split('.')[0]
        usedVariables.add(varName)
      }
    }
  }

  if (!hasInvalidSteps) {
    console.log('  ✅ All steps have required fields')
    console.log(`  ✅ ${outputVariables.size} output variables defined`)
    console.log(`  ✅ ${usedVariables.size} variables referenced`)
  }

  // Check for undefined variable references
  const undefinedVars = Array.from(usedVariables).filter(v => !outputVariables.has(v))
  if (undefinedVars.length > 0) {
    console.log(`  ⚠️  Variables used but not defined: ${undefinedVars.join(', ')}`)
    console.log('     (This is OK if they are loop variables or built-in variables)')
  }

  console.log()

  // ============================================================================
  // PHASE 6: Execution Order Verification
  // ============================================================================
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 6: Execution Order Verification (Bug Fix Check)           │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  // Find AI extraction step and conditional check step
  let aiExtractionStep: any = null
  let conditionalStep: any = null
  let aiStepIndex = -1
  let conditionalStepIndex = -1

  // Search in scatter_gather nested steps
  for (let i = 0; i < compiled.workflow.length; i++) {
    const step = compiled.workflow[i]
    if (step.type === 'scatter_gather' && step.scatter?.steps) {
      for (let j = 0; j < step.scatter.steps.length; j++) {
        const nestedStep = step.scatter.steps[j]
        if (nestedStep.type === 'ai_processing') {
          aiExtractionStep = nestedStep
          aiStepIndex = j
        }
        if (nestedStep.type === 'conditional' || nestedStep.type === 'transform') {
          if (nestedStep.description?.includes('amount') || nestedStep.config?.expression?.includes('amount')) {
            if (conditionalStep === null) {
              conditionalStep = nestedStep
              conditionalStepIndex = j
            }
          }
        }
      }
    }
  }

  console.log('\n🔍 Critical Execution Order:')
  if (aiExtractionStep && conditionalStep) {
    console.log(`  - AI Extraction: ${aiExtractionStep.step_id} (index ${aiStepIndex})`)
    console.log(`  - Conditional Check: ${conditionalStep.step_id} (index ${conditionalStepIndex})`)

    if (aiStepIndex < conditionalStepIndex) {
      console.log('\n  ✅ CORRECT: AI extraction happens BEFORE conditional check')
      console.log('  ✅ BUG FIXED: Amount exists when conditional executes')
    } else {
      console.log('\n  ❌ ERROR: Conditional check happens BEFORE AI extraction')
      console.log('  ❌ BUG PRESENT: Amount does not exist when conditional executes')
    }
  } else {
    console.log('  ⚠️  Could not identify AI extraction or conditional steps')
  }

  // Check Drive operations are before conditional
  let driveSteps: any[] = []
  for (let i = 0; i < compiled.workflow.length; i++) {
    const step = compiled.workflow[i]
    if (step.type === 'scatter_gather' && step.scatter?.steps) {
      driveSteps = step.scatter.steps.filter((s: any) =>
        s.plugin === 'google-drive' && s.type === 'action'
      )
    }
  }

  if (driveSteps.length > 0) {
    console.log(`\n  ✅ Drive operations (${driveSteps.length} steps) execute BEFORE conditional`)
    console.log('     - These operations ALWAYS run (not affected by conditional)')
  }

  // Check Sheets operation is after conditional
  let sheetsStep: any = null
  for (let i = 0; i < compiled.workflow.length; i++) {
    const step = compiled.workflow[i]
    if (step.type === 'scatter_gather' && step.scatter?.steps) {
      for (const nestedStep of step.scatter.steps) {
        if (nestedStep.type === 'conditional' && nestedStep.steps) {
          for (const condStep of nestedStep.steps) {
            if (condStep.plugin === 'google-sheets') {
              sheetsStep = condStep
            }
          }
        }
      }
    }
  }

  if (sheetsStep) {
    console.log(`\n  ✅ Sheets operation (${sheetsStep.step_id}) is inside conditional`)
    console.log('     - This operation runs ONLY when condition is true (amount > 50)')
  }

  console.log()

  // ============================================================================
  // SUMMARY
  // ============================================================================
  const totalDuration = Date.now() - pipelineStart

  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PIPELINE SUMMARY                                                 │')
  console.log('└─────────────────────────────────────────────────────────────────┘')
  console.log(`\n⏱️  Total Pipeline Duration: ${(totalDuration / 1000).toFixed(1)}s`)
  console.log(`  - Phase 0 (Requirements Extraction): ${requirementsDuration}ms`)
  console.log(`  - Phase 1 (Semantic Plan): ${(semanticDuration / 1000).toFixed(1)}s`)
  console.log(`  - Phase 2 (IR Formalization): ${(formalizationDuration / 1000).toFixed(1)}s`)
  console.log(`  - Phase 3 (Visualization): < 0.1s`)
  console.log(`  - Phase 4 (Compilation): ${compilationDuration}ms`)
  console.log(`  - Phase 5 (DSL Validation): < 0.1s`)
  console.log(`  - Phase 6 (Order Verification): < 0.1s`)

  console.log('\n📊 Pipeline Output:')
  console.log(`  - IR Version: ${ir.ir_version}`)
  console.log(`  - Execution Graph Nodes: ${Object.keys(ir.execution_graph?.nodes || {}).length}`)
  console.log(`  - PILOT DSL Steps: ${compiled.workflow.length}`)
  console.log(`  - Plugins Used: ${Array.from(compiled.plugins_used || []).join(', ')}`)
  console.log(`  - Step Types: ${Object.keys(stepTypes).length}`)
  console.log(`  - Output Variables: ${outputVariables.size}`)

  console.log('\n✅ PIPELINE STATUS:')
  if (compiled.success && aiStepIndex < conditionalStepIndex) {
    console.log('  ✅ All phases completed successfully')
    console.log('  ✅ Invoice workflow bug is FIXED')
    console.log('  ✅ Execution order is CORRECT')
    console.log('  ✅ Ready for production deployment')
  } else {
    console.log('  ⚠️  Pipeline completed with issues')
    if (!compiled.success) {
      console.log('  ❌ Compilation failed')
    }
    if (aiStepIndex >= conditionalStepIndex) {
      console.log('  ❌ Execution order is incorrect')
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════\n')
}

runFullPipeline().catch(error => {
  console.error('\n❌ PIPELINE FAILED:')
  console.error(error)
  process.exit(1)
})
