/**
 * Full E2E Test: Customer Complaint Email Logger
 *
 * Gmail → Google Sheets workflow with deduplication
 * Tests the complete pipeline from Phase 0 through Phase 4
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { HardRequirementsExtractor } from '../lib/agentkit/v6/requirements/HardRequirementsExtractor'
import { SemanticPlanGenerator } from '../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'
import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer'
import { ExecutionGraphCompiler } from '../lib/agentkit/v6/compiler/ExecutionGraphCompiler'
import { ExecutionGraphVisualizer } from '../lib/agentkit/v6/utils/ExecutionGraphVisualizer'
import type { DeclarativeLogicalIRv4 } from '../lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4'

const complaintLoggerPrompt = {
  "plan_title": "Customer Complaint Email Logger (Gmail → Google Sheets)",
  "plan_description": "Scans your Gmail Inbox for the last 7 days, finds emails that contain complaint keywords, and appends only those complaint emails into the 'UrgentEmails' tab of your Google Sheet while skipping duplicates based on Gmail message link/id.",
  "sections": {
    "data": [
      "- Scan Gmail Inbox messages from the last 7 days.",
      "- Treat an email as a complaint if the email content contains any of these keywords (case-insensitive match): 'complaint', 'refund', 'angry', 'not working'.",
      "- Use the Google Sheet with spreadsheet id '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc' as the destination.",
      "- Use the worksheet/tab name 'UrgentEmails' inside that spreadsheet as the destination tab.",
      "- Read existing rows from the destination tab to identify already-logged complaint emails by Gmail message link/id."
    ],
    "actions": [
      "- For each Gmail message in scope, check whether the message content contains any of: 'complaint', 'refund', 'angry', 'not working'.",
      "- If the message matches the complaint rule, extract these fields: sender email, subject, date, and the full email text.",
      "- If the message matches the complaint rule, also capture the Gmail message link/id to use as a unique identifier.",
      "- If the Gmail message link/id already exists in the destination tab, do not add a new row for that message.",
      "- If the Gmail message link/id does not exist in the destination tab, append exactly one new row for that message.",
      "- Treat each matching message independently (if a thread has multiple matching messages, log every matching message as its own row)."
    ],
    "output": [
      "- Append one row per complaint email to the destination Google Sheet tab.",
      "- Each appended row must include (in this order): sender email, subject, date, full email text, Gmail message link/id."
    ],
    "delivery": [
      "- Deliver results by writing/appending rows into the Google Sheet tab 'UrgentEmails' (no email/slack notification)."
    ],
    "processing_steps": [
      "- Fetch Gmail messages from Inbox for the last 7 days.",
      "- Load existing rows from the 'UrgentEmails' tab and build a set of existing Gmail message link/id values.",
      "- Filter messages by keyword match against the email content (case-insensitive).",
      "- For each matching message, extract required fields and append a new row only if its Gmail message link/id is not already present."
    ]
  },
  "specifics": {
    "services_involved": [
      "google-mail",
      "google-sheets"
    ],
    "user_inputs_required": [],
    "resolved_user_inputs": [
      {
        "key": "user_email",
        "value": "offir.omer@gmail.com"
      },
      {
        "key": "spreadsheet_id",
        "value": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"
      },
      {
        "key": "sheet_tab_name",
        "value": "UrgentEmails"
      },
      {
        "key": "gmail_scope",
        "value": "Inbox"
      },
      {
        "key": "data_time_window",
        "value": "last 7 days"
      },
      {
        "key": "complaint_keywords",
        "value": "complaint, refund, angry, not working"
      },
      {
        "key": "sheet_dedup_rule",
        "value": "skip if Gmail message link/id already exists in the sheet"
      },
      {
        "key": "thread_handling",
        "value": "log every message that matches the complaint rule"
      },
      {
        "key": "sheet_columns",
        "value": "sender email, subject, date, full email text, Gmail message link/id"
      }
    ]
  }
}

async function testComplaintLogger() {
  console.log('='.repeat(100))
  console.log('FULL E2E TEST: Customer Complaint Email Logger (Gmail → Google Sheets)')
  console.log('='.repeat(100))
  console.log()

  // ============================================================================
  // Phase 0: Extract Hard Requirements
  // ============================================================================

  console.log('📋 PHASE 0: Hard Requirements Extraction')
  console.log('-'.repeat(100))

  const extractor = new HardRequirementsExtractor()
  const hardReqs = await extractor.extract(complaintLoggerPrompt)

  console.log(`✅ Extracted ${hardReqs.requirements.length} Hard Requirements:`)
  console.log()
  console.log(`   Unit of Work: ${hardReqs.unit_of_work}`)
  console.log(`   Thresholds: ${hardReqs.thresholds.length}`)
  console.log(`   Routing Rules: ${hardReqs.routing_rules.length}`)
  console.log(`   Invariants: ${hardReqs.invariants.length}`)
  console.log(`   Required Outputs: ${hardReqs.required_outputs.length}`)
  console.log(`   Side Effect Constraints: ${hardReqs.side_effect_constraints.length}`)
  console.log()

  console.log('Detailed Requirements:')
  hardReqs.requirements.forEach((req, idx) => {
    console.log(`   ${idx + 1}. ${req.id}: [${req.type}] ${req.constraint}`)
    console.log(`      Source: ${req.source}`)
  })
  console.log()

  // ============================================================================
  // Phase 1: Generate Semantic Plan
  // ============================================================================

  console.log('🧠 PHASE 1: Semantic Plan Generation')
  console.log('-'.repeat(100))

  const semanticGenerator = new SemanticPlanGenerator({
    model_provider: 'anthropic',
    model_name: 'claude-opus-4-5-20251101',
    temperature: 0.3
  })

  const semanticResult = await semanticGenerator.generate(complaintLoggerPrompt, hardReqs)

  if (!semanticResult.success) {
    console.log('❌ Semantic Plan Generation Failed')
    semanticResult.errors?.forEach(err => console.log(`   - ${err}`))
    return
  }

  console.log('✅ Semantic Plan Generated Successfully')
  console.log()

  // ============================================================================
  // Phase 2: Skip Grounding (API workflow)
  // ============================================================================

  console.log('⚙️  PHASE 2: Grounding')
  console.log('-'.repeat(100))
  console.log('ℹ️  SKIPPED - API workflow (no tabular metadata for Gmail)')
  console.log()

  const groundedPlan = {
    ...semanticResult.semantic_plan!,
    grounded: false,
    grounding_results: [],
    grounding_errors: [],
    validated_assumptions_count: 0,
    total_assumptions_count: semanticResult.semantic_plan!.assumptions.length,
    grounding_confidence: 0,
    grounding_timestamp: new Date().toISOString()
  }

  // ============================================================================
  // Phase 3: Formalize to IR
  // ============================================================================

  console.log('🔧 PHASE 3: IR Formalization')
  console.log('-'.repeat(100))

  const formalizer = new IRFormalizer({
    model: 'chatgpt-4o-latest',
    temperature: 0.0,
    openai_api_key: process.env.OPENAI_API_KEY
  })

  const formalizationResult = await formalizer.formalize(groundedPlan, hardReqs)

  console.log('✅ IR Formalized Successfully')
  console.log(`   Grounded facts used: ${Object.keys(formalizationResult.formalization_metadata.grounded_facts_used).length}`)
  console.log(`   Missing facts: ${formalizationResult.formalization_metadata.missing_facts.length}`)
  console.log()

  const ir = formalizationResult.ir as DeclarativeLogicalIRv4

  // ============================================================================
  // Phase 3.5: Visualize Execution Graph
  // ============================================================================

  console.log('📊 PHASE 3.5: Execution Graph Visualization')
  console.log('-'.repeat(100))

  if (ir.execution_graph) {
    const visualizer = new ExecutionGraphVisualizer()

    console.log('🎨 Mermaid Diagram:')
    console.log()
    console.log('```mermaid')
    console.log(visualizer.toMermaid(ir.execution_graph))
    console.log('```')
    console.log()

    const analysis = visualizer.analyze(ir.execution_graph)
    console.log('📈 Graph Analysis:')
    console.log(`   - Total Nodes: ${analysis.nodeCount}`)
    console.log(`   - Max Depth: ${analysis.maxDepth}`)
    console.log(`   - Estimated Complexity: ${analysis.estimatedComplexity}`)
    console.log()
  }

  // ============================================================================
  // Phase 4: Compile to PILOT DSL
  // ============================================================================

  console.log('⚙️  PHASE 4: DSL Compilation')
  console.log('-'.repeat(100))

  const compiler = new ExecutionGraphCompiler()
  const compilationResult = await compiler.compile(ir, hardReqs)

  if (!compilationResult.success) {
    console.log('❌ DSL Compilation Failed')
    compilationResult.errors?.forEach(err => console.log(`   - ${err}`))
    return
  }

  console.log('✅ DSL Compiled Successfully')
  console.log(`   Total Workflow Steps: ${compilationResult.workflow.length}`)
  console.log(`   Plugins Used: ${Array.from(compilationResult.plugins_used || []).join(', ')}`)
  console.log()

  // ============================================================================
  // Phase 5: Display Full Workflow Steps
  // ============================================================================

  console.log('📝 PHASE 5: Complete Workflow Steps')
  console.log('='.repeat(100))
  console.log()

  const workflow = compilationResult.workflow

  console.log('Step-by-Step Execution Plan:')
  console.log()

  workflow.forEach((step, idx) => {
    console.log(`${idx + 1}. ${step.step_id}: ${step.type.toUpperCase()}`)
    console.log(`   Description: ${step.description}`)

    if (step.plugin) {
      console.log(`   Plugin: ${step.plugin}`)
    }

    if (step.operation) {
      console.log(`   Operation: ${step.operation}`)
    }

    if (step.config) {
      console.log(`   Config:`)
      Object.entries(step.config).forEach(([key, value]) => {
        if (typeof value === 'object') {
          console.log(`      ${key}: ${JSON.stringify(value)}`)
        } else {
          console.log(`      ${key}: ${value}`)
        }
      })
    }

    if (step.output_variable) {
      console.log(`   Output Variable: ${step.output_variable}`)
    }

    if (step.type === 'scatter_gather' && step.scatter) {
      console.log(`   Scatter Input: ${step.scatter.input}`)
      console.log(`   Item Variable: ${step.scatter.itemVariable}`)
      console.log(`   Nested Steps: ${step.scatter.steps.length}`)
    }

    if (step.type === 'conditional' && step.condition) {
      console.log(`   Condition: ${step.condition.field} ${step.condition.operator} ${step.condition.value}`)
      if (step.steps) {
        console.log(`   Then Steps: ${step.steps.length}`)
      }
      if ((step as any).else_steps) {
        console.log(`   Else Steps: ${(step as any).else_steps.length}`)
      }
    }

    console.log()
  })

  // ============================================================================
  // Final Summary
  // ============================================================================

  console.log('='.repeat(100))
  console.log('PIPELINE EXECUTION SUMMARY')
  console.log('='.repeat(100))
  console.log()

  console.log('✅ Phase 0: Hard Requirements Extraction - COMPLETE')
  console.log(`   → ${hardReqs.requirements.length} requirements extracted`)
  console.log()

  console.log('✅ Phase 1: Semantic Plan Generation - COMPLETE')
  console.log(`   → Understanding captured with hardRequirements constraints`)
  console.log()

  console.log('⚠️  Phase 2: Grounding - SKIPPED')
  console.log(`   → API workflow (Gmail/Sheets) - no tabular metadata`)
  console.log()

  console.log('✅ Phase 3: IR Formalization - COMPLETE')
  console.log(`   → Execution graph with ${ir.execution_graph?.nodes.length || 0} nodes`)
  console.log()

  console.log('✅ Phase 4: DSL Compilation - COMPLETE')
  console.log(`   → ${workflow.length} workflow steps ready for execution`)
  console.log()

  console.log('🎉 FULL WORKFLOW COMPILED SUCCESSFULLY!')
  console.log()
  console.log('The workflow is ready to be executed by the PILOT runtime.')
  console.log()

  // Print full DSL JSON
  console.log('='.repeat(100))
  console.log('FULL WORKFLOW DSL (JSON)')
  console.log('='.repeat(100))
  console.log()
  console.log(JSON.stringify(workflow, null, 2))
  console.log()

  return {
    success: true,
    hardRequirements: hardReqs,
    workflowSteps: workflow.length,
    executionGraphNodes: ir.execution_graph?.nodes.length || 0
  }
}

testComplaintLogger()
  .then(result => {
    if (result && result.success) {
      process.exit(0)
    } else {
      process.exit(1)
    }
  })
  .catch(err => {
    console.error('Test failed:', err)
    process.exit(1)
  })
