/**
 * Full E2E Test: Gmail Expense Attachment Extractor
 *
 * Gmail → PDF extraction → AI parsing → Email table output
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

const expenseExtractorPrompt = {
  "plan_title": "Gmail Expense Attachment Extractor (Email Table Output)",
  "plan_description": "This agent searches Gmail for expense-related emails, reads PDF receipt attachments, extracts expense details into a combined table, and emails you a short summary with the table embedded in the email body.",
  "sections": {
    "data": [
      "- Search Gmail for emails from the last 7 days where the subject contains the keyword 'expenses' OR the keyword 'receipt'.",
      "- From each matching email, collect all PDF attachments.",
      "- For each PDF attachment, capture basic context needed for traceability (email subject and attachment file name) for internal processing, even though the final table will only include the 4 requested columns."
    ],
    "actions": [
      "- For each PDF attachment, read the receipt content and extract expense line items when multiple items are present (create multiple rows).",
      "- For each extracted row, populate the following fields:",
      "- Set date&time to the receipt's date and time when present; if time is not present, set date&time to the receipt date and mark the row as 'need review'.",
      "- Set vendor to the merchant/vendor name on the receipt; if vendor is unclear, set vendor to 'need review'.",
      "- Set amount to the total amount for the extracted line item; if the amount is unclear, set amount to 'need review'.",
      "- Infer expense type from the receipt text as best it can (based on wording and context on the receipt); if the inferred type is low-confidence or missing, set expense type to 'need review'.",
      "- Normalize extracted values:",
      "- Normalize date&time into a consistent format across all rows.",
      "- Normalize amount into a consistent numeric format across all rows (preserving the value as shown on the receipt).",
      "- Combine all extracted rows from all matching emails into one combined table for all expenses."
    ],
    "output": [
      "- Generate a combined table (embedded in the email body) with exactly these columns in this order: date&time, vendor, amount, expense type.",
      "- Ensure any uncertain or missing field values are explicitly set to the literal text 'need review' in the relevant cell."
    ],
    "delivery": [
      "- Send an email to offir.omer@gmail.com that includes a short summary (for example: number of emails scanned, number of PDFs processed, number of expense rows extracted, number of rows marked 'need review').",
      "- In the same email, embed the combined expense table in the email body (not as a separate file attachment)."
    ],
    "processing_steps": [
      "- Find matching Gmail emails (subject contains 'expenses' OR 'receipt') from the last 7 days.",
      "- Download PDF attachments from those emails.",
      "- Extract receipt text from each PDF.",
      "- Convert extracted receipt text into structured rows (date&time, vendor, amount, expense type).",
      "- Mark uncertain fields as 'need review'.",
      "- Build one combined table for all extracted rows.",
      "- Compose an email containing a short summary and the embedded table.",
      "- Send the email to offir.omer@gmail.com."
    ]
  },
  "specifics": {
    "services_involved": [
      "google-mail",
      "chatgpt-research"
    ],
    "user_inputs_required": [],
    "resolved_user_inputs": [
      {
        "key": "user_email",
        "value": "offir.omer@gmail.com"
      },
      {
        "key": "gmail_lookback_window",
        "value": "last 7 days"
      },
      {
        "key": "gmail_subject_keywords",
        "value": "expenses, receipt"
      },
      {
        "key": "attachment_types",
        "value": "PDF"
      },
      {
        "key": "row_granularity",
        "value": "multiple rows (line items when present)"
      },
      {
        "key": "expense_type_method",
        "value": "infer from receipt text"
      },
      {
        "key": "uncertain_field_behavior",
        "value": "set to 'need review'"
      },
      {
        "key": "output_destination",
        "value": "email body table"
      },
      {
        "key": "table_scope",
        "value": "combined table for all expenses"
      },
      {
        "key": "notification_style",
        "value": "email me a short summary"
      }
    ]
  }
}

async function testExpenseExtractor() {
  console.log('='.repeat(100))
  console.log('FULL E2E TEST: Gmail Expense Attachment Extractor (Email Table Output)')
  console.log('='.repeat(100))
  console.log()

  // ============================================================================
  // Phase 0: Extract Hard Requirements
  // ============================================================================

  console.log('📋 PHASE 0: Hard Requirements Extraction')
  console.log('-'.repeat(100))

  const extractor = new HardRequirementsExtractor()
  const hardReqs = await extractor.extract(expenseExtractorPrompt)

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

  const semanticResult = await semanticGenerator.generate(expenseExtractorPrompt, hardReqs)

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
  console.log('ℹ️  SKIPPED - API workflow (no tabular metadata for Gmail/PDF)')
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
  console.log(`   → API workflow (Gmail/PDF) - no tabular metadata`)
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

testExpenseExtractor()
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
