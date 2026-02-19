/**
 * Full E2E Test: Expense & Invoice Intake Agent
 *
 * Gmail → Drive + Sheets + Email Summary
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

const invoiceIntakePrompt = {
  "plan_title": "Expense & Invoice Intake Agent (Gmail → Drive + Sheets + Email Summary)",
  "plan_description": "Scans Gmail using a fixed search query to find invoice/receipt emails with attachments, extracts basic fields, stores attachments in Google Drive organized by vendor, appends rows to a Google Sheet (Invoices vs Expenses tabs), and emails a summary to you. Items with missing amounts are included in the summary only.",
  "sections": {
    "data": [
      "- Search Gmail using the query: 'subject:(invoice OR receipt OR bill) has:attachment'.",
      "- For each matched email, use the email metadata (subject, sender, date) and attachment files as the source content.",
      "- Extract the following basic fields for each detected item: date, vendor, amount, currency.",
      "- Capture the Google Drive link of each stored attachment file.",
      "- Use the Google Drive folder ID '1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-' as the main storage folder.",
      "- Use the extracted vendor name to determine the vendor subfolder name under the main Drive folder.",
      "- Use Google Sheet ID '1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE' as the destination spreadsheet.",
      "- Use the tab name 'Invoices' for items classified as invoices.",
      "- Use the tab name 'Expenses' for items classified as expenses."
    ],
    "actions": [
      "- For each matched email, classify the item as either an invoice or an expense based on the email subject/body and attachment filename/content cues (for example: the presence of the word 'invoice' vs 'receipt').",
      "- For each classified item, extract: date, vendor, amount, currency.",
      "- If the email has one or more attachments, store each attachment in Google Drive under: main folder (ID: 1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-) / vendor subfolder.",
      "- If the email has multiple attachments, treat each attachment as a separate stored file and create a separate summary line item per attachment.",
      "- Build a summary line item for each stored file that includes: date, vendor, amount, currency, and the Google Drive link to the stored file.",
      "- If an amount is found (regardless of currency), append a new row to the Google Sheet (ID: 1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE) in the 'Invoices' tab when classified as invoice.",
      "- If an amount is found (regardless of currency), append a new row to the Google Sheet (ID: 1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE) in the 'Expenses' tab when classified as expense.",
      "- When appending a row, write the columns in this order: Date, Vendor, Amount, Currency, Drive Link.",
      "- If the agent cannot confidently extract the amount (or key fields), include the item in the email summary only and do not append it to Google Sheets."
    ],
    "output": [
      "- Produce an email-friendly summary that lists each detected invoice/expense as a separate line item.",
      "- For each line item, include: date, vendor, amount, currency, and a Google Drive link.",
      "- Produce a structured Google Sheets row payload with: Date, Vendor, Amount, Currency, Drive Link.",
      "- Produce a separate section in the email summary titled 'Needs review (not added to Google Sheets)' for items where the amount (or key fields) could not be extracted."
    ],
    "delivery": [
      "- Send the summary email to meiribarak@gmail.com.",
      "- In the email, include two sections: 'Invoices' and 'Expenses' (based on the classification).",
      "- In the email, include a third section: 'Needs review (not added to Google Sheets)'."
    ],
    "processing_steps": [
      "- Run the Gmail search query to collect candidate emails.",
      "- For each candidate email, classify it as invoice vs expense.",
      "- Extract basic fields from the email and attachments.",
      "- Store attachments in Google Drive under the vendor subfolder.",
      "- Append a row to the correct Google Sheet tab (Invoices or Expenses) when an amount is found.",
      "- Build the final email summary with three sections (Invoices, Expenses, Needs review).",
      "- Send the summary email to the user."
    ]
  },
  "specifics": {
    "services_involved": [
      "google-mail",
      "google-drive",
      "google-sheets",
      "chatgpt-research"
    ],
    "user_inputs_required": [],
    "resolved_user_inputs": [
      {
        "key": "user_email",
        "value": "offir.omer@gmail.com"
      },
      {
        "key": "gmail_search_query",
        "value": "subject:(invoice OR receipt OR bill) has:attachment"
      },
      {
        "key": "drive_main_folder_url",
        "value": "https://drive.google.com/drive/folders/1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-?usp=drive_link"
      },
      {
        "key": "drive_main_folder_id",
        "value": "1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-"
      },
      {
        "key": "google_sheet_id",
        "value": "1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE"
      },
      {
        "key": "google_sheet_tab_invoices",
        "value": "Invoices"
      },
      {
        "key": "google_sheet_tab_expenses",
        "value": "Expenses"
      },
      {
        "key": "extraction_field_set",
        "value": "basic"
      },
      {
        "key": "currency_rule_for_sheet_append",
        "value": "always_add_if_amount_present"
      },
      {
        "key": "missing_amount_behavior",
        "value": "summary_only"
      }
    ]
  }
}

async function testInvoiceIntake() {
  console.log('='.repeat(100))
  console.log('FULL E2E TEST: Expense & Invoice Intake Agent (Gmail → Drive + Sheets + Email)')
  console.log('='.repeat(100))
  console.log()

  // ============================================================================
  // Phase 0: Extract Hard Requirements
  // ============================================================================

  console.log('📋 PHASE 0: Hard Requirements Extraction')
  console.log('-'.repeat(100))

  const extractor = new HardRequirementsExtractor()
  const hardReqs = await extractor.extract(invoiceIntakePrompt)

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

  const semanticResult = await semanticGenerator.generate(invoiceIntakePrompt, hardReqs)

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
  console.log('ℹ️  SKIPPED - API workflow (no tabular metadata)')
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
      console.log(`   Condition: ${JSON.stringify(step.condition)}`)
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
  console.log(`   → API workflow - no tabular metadata`)
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

testInvoiceIntake()
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
