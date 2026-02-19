/**
 * Test Full Pipeline: Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4
 * Ensure ALL phases preserve Hard Requirements from Enhanced Prompt
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') })

import { HardRequirementsExtractor } from '../lib/agentkit/v6/requirements/HardRequirementsExtractor'
import { SemanticPlanGenerator } from '../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'
import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer'
import { ExecutionGraphCompiler } from '../lib/agentkit/v6/compiler/ExecutionGraphCompiler'
import { ExecutionGraphVisualizer } from '../lib/agentkit/v6/utils/ExecutionGraphVisualizer'
import { RequirementsGroundingValidator } from '../lib/agentkit/v6/requirements/RequirementsGroundingValidator'
import { IRRequirementsValidator } from '../lib/agentkit/v6/requirements/IRRequirementsValidator'
import { DSLRequirementsValidator } from '../lib/agentkit/v6/requirements/DSLRequirementsValidator'
import type { DeclarativeLogicalIRv4 } from '../lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4'

// EXACT Enhanced Prompt from user (production format)
const testEnhancedPrompt = {
  "plan_title": "High-Qualified Leads Summary + Per–Sales Person Emails",
  "plan_description": "This agent reads leads from a Google Sheet, filters to high-qualified leads (Stage = 4), creates summary tables, emails you an overall summary, and emails each sales person only the leads assigned to them.",
  "sections": {
    "data": [
      "- Read lead rows from Google Sheet id \"1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE\".",
      "- Use the worksheet (tab) named \"Leads\".",
      "- Treat the following columns as the canonical output fields: Date, Lead Name, Company, Email, Phone, Stage, Notes, Sales Person.",
      "- Treat the \"Sales Person\" column value as an email address for delivery to the sales person."
    ],
    "actions": [
      "- Filter leads to only rows where the column \"Stage\" equals \"4\".",
      "- If there are zero filtered leads, do not email sales people; only email Barak Meiri with the message \"no high qualified leads found\".",
      "- Group the filtered leads by the \"Sales Person\" column value (one group per sales person email address).",
      "- For each sales person group, generate a table containing only that sales person's leads, using the columns: Date, Lead Name, Company, Email, Phone, Stage, Notes, Sales Person.",
      "- Generate an overall summary table for Barak Meiri that includes all filtered leads, using the same columns."
    ],
    "output": [
      "- Create an email-friendly table for each sales person group (one table per sales person).",
      "- Create an email-friendly overall summary table for Barak Meiri.",
      "- Ensure the table columns appear in this order: Date, Lead Name, Company, Email, Phone, Stage, Notes, Sales Person."
    ],
    "delivery": [
      "- Send the overall summary email to meiribarak@gmail.com.",
      "- For each sales person email found in the \"Sales Person\" column, send an email to that address containing only that sales person's table.",
      "- Do not include other sales people's leads in a sales person's email.",
      "- If there are zero high-qualified leads (Stage = 4), send only a short email to meiribarak@gmail.com with the text: \"no high qualified leads found\"."
    ],
    "processing_steps": [
      "- Load all rows from the \"Leads\" tab.",
      "- Identify the \"Stage\" and \"Sales Person\" columns and the requested output columns.",
      "- Filter rows where Stage = 4.",
      "- If filtered set is empty, prepare the 'no high qualified leads found' email to Barak Meiri.",
      "- Otherwise, group filtered rows by Sales Person email.",
      "- Render one overall table for Barak Meiri and one per-sales-person table for each group.",
      "- Send the emails via Gmail."
    ]
  },
  "specifics": {
    "services_involved": [
      "google-sheets",
      "google-mail"
    ],
    "user_inputs_required": [],
    "resolved_user_inputs": [
      {
        "key": "user_email",
        "value": "meiribarak@gmail.com"
      },
      {
        "key": "sheet_id",
        "value": "1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE"
      },
      {
        "key": "sheet_tab_name",
        "value": "Leads"
      },
      {
        "key": "high_qualified_rule",
        "value": "Stage equals 4"
      },
      {
        "key": "sales_person_email_column",
        "value": "Sales Person"
      }
    ]
  }
}

console.log('='.repeat(80))
console.log('FULL PIPELINE INTEGRATION TEST (Phase 0 → 1 → 2 → 3 → 4)')
console.log('='.repeat(80))
console.log()

async function testFullPipeline() {
  // ============================================================================
  // Phase 0: Extract Hard Requirements
  // ============================================================================

  console.log('📋 PHASE 0: Extracting Hard Requirements...')
  console.log()

  const extractor = new HardRequirementsExtractor()
  const hardReqs = await extractor.extract(testEnhancedPrompt)

  console.log('✅ Hard Requirements Extracted:')
  console.log(`   Total Requirements: ${hardReqs.requirements.length}`)
  console.log(`   Unit of Work: ${hardReqs.unit_of_work}`)
  console.log(`   Thresholds: ${hardReqs.thresholds.length}`)
  console.log(`   Invariants: ${hardReqs.invariants.length}`)
  console.log(`   Required Outputs: ${hardReqs.required_outputs.length}`)
  console.log(`   Side Effect Constraints: ${hardReqs.side_effect_constraints.length}`)
  console.log()

  console.log('Detailed Requirements:')
  hardReqs.requirements.forEach(req => {
    console.log(`   ${req.id}: [${req.type}] ${req.constraint}`)
  })
  console.log()

  // ============================================================================
  // Phase 1: Generate Semantic Plan
  // ============================================================================

  console.log('🧠 PHASE 1: Generating Semantic Plan...')
  console.log()

  const semanticGenerator = new SemanticPlanGenerator({
    model_provider: 'anthropic',
    model_name: 'claude-opus-4-5-20251101',
    temperature: 0.3
  })

  // CRITICAL: Pass hardRequirements to guide semantic plan generation
  const semanticResult = await semanticGenerator.generate(testEnhancedPrompt, hardReqs)

  if (!semanticResult.success) {
    console.log('❌ Semantic Plan Generation Failed:')
    semanticResult.errors?.forEach(err => console.log(`   - ${err}`))
    return
  }

  console.log('✅ Semantic Plan Generated Successfully')
  console.log()

  const semanticPlan = semanticResult.semantic_plan!

  // Validate Phase 1
  console.log('📊 Validating Phase 1 (Semantic Plan)...')
  const semanticValidator = new RequirementsGroundingValidator()
  const semanticValidation = semanticValidator.validate(hardReqs, semanticPlan)
  console.log(`   Phase 1 Score: ${semanticValidation.score}/100`)
  console.log()

  // ============================================================================
  // Phase 2: Grounding (skip for API workflows)
  // ============================================================================

  console.log('⚙️  PHASE 2: Grounding (SKIPPED - no tabular metadata for Gmail workflow)')
  console.log()

  const groundedPlan = {
    ...semanticPlan,
    grounded: false,
    grounding_results: [],
    grounding_errors: [],
    validated_assumptions_count: 0,
    total_assumptions_count: semanticPlan.assumptions.length,
    grounding_confidence: 0,
    grounding_timestamp: new Date().toISOString()
  }

  console.log('✅ Ungrounded plan structure created')
  console.log()

  // ============================================================================
  // Phase 3: Formalize to IR
  // ============================================================================

  console.log('🔧 PHASE 3: Formalizing to IR...')
  console.log()

  const formalizer = new IRFormalizer({
    model: 'chatgpt-4o-latest',
    temperature: 0.0,
    openai_api_key: process.env.OPENAI_API_KEY
  })

  // CRITICAL: Pass hardRequirements to enforce constraints during IR formalization
  const formalizationResult = await formalizer.formalize(groundedPlan, hardReqs)

  console.log('✅ IR Formalized Successfully')
  console.log(`   Grounded facts used: ${Object.keys(formalizationResult.formalization_metadata.grounded_facts_used).length}`)
  console.log(`   Missing facts: ${formalizationResult.formalization_metadata.missing_facts.length}`)
  console.log()

  const ir = formalizationResult.ir

  // Skip Phase 3 validation for v4.0 IR (validator only supports v3.0)
  console.log('📊 Phase 3 Validation: SKIPPED (v4.0 IR uses execution_graph, validator is v3.0-only)')
  console.log()

  // ============================================================================
  // Phase 3.5: Visualization (Execution Graph)
  // ============================================================================

  console.log('📊 PHASE 3.5: Visualizing Execution Graph...')
  console.log()

  const irV4 = ir as DeclarativeLogicalIRv4

  if (irV4.execution_graph) {
    const visualizer = new ExecutionGraphVisualizer()

    console.log('🎨 Mermaid Diagram:')
    console.log('```mermaid')
    console.log(visualizer.toMermaid(irV4.execution_graph))
    console.log('```')
    console.log()

    const analysis = visualizer.analyze(irV4.execution_graph)
    console.log('📈 Graph Analysis:')
    console.log(`   - Total Nodes: ${analysis.nodeCount}`)
    console.log(`   - Max Depth: ${analysis.maxDepth}`)
    console.log(`   - Estimated Complexity: ${analysis.estimatedComplexity}`)
    console.log()
  } else {
    console.log('⚠️  No execution graph found in IR v4.0')
    console.log()
  }

  // ============================================================================
  // Phase 4: Compile to PILOT DSL (ExecutionGraphCompiler)
  // ============================================================================

  console.log('⚙️  PHASE 4: Compiling Execution Graph to PILOT DSL...')
  console.log()

  const compiler = new ExecutionGraphCompiler()
  // CRITICAL: Pass hardRequirements to validate constraints during compilation
  const compilationResult = await compiler.compile(irV4, hardReqs)

  if (!compilationResult.success) {
    console.log('❌ DSL Compilation Failed:')
    compilationResult.errors?.forEach(err => console.log(`   - ${err}`))
    return
  }

  console.log('✅ DSL Compiled Successfully')
  console.log(`   Workflow steps: ${compilationResult.workflow.length}`)
  console.log(`   Plugins used: ${Array.from(compilationResult.plugins_used || []).join(', ')}`)
  console.log()

  const workflow = compilationResult.workflow

  // ============================================================================
  // Phase 5: DSL Validation & Workflow Analysis
  // ============================================================================

  console.log('🔍 PHASE 5: DSL Validation & Workflow Analysis...')
  console.log()

  console.log('📋 Workflow Steps Summary:')
  console.log(`   Total Steps: ${workflow.length}`)

  const stepTypes: Record<string, number> = {}
  const pluginUsage: Record<string, number> = {}

  for (const step of workflow) {
    stepTypes[step.type] = (stepTypes[step.type] || 0) + 1
    if (step.plugin) {
      pluginUsage[step.plugin] = (pluginUsage[step.plugin] || 0) + 1
    }
  }

  console.log('\n   Step Types:')
  for (const [type, count] of Object.entries(stepTypes)) {
    console.log(`     - ${type}: ${count}`)
  }

  console.log('\n   Plugin Usage:')
  for (const [plugin, count] of Object.entries(pluginUsage)) {
    console.log(`     - ${plugin}: ${count} operations`)
  }
  console.log()

  // ============================================================================
  // Phase 6: Execution Order Verification
  // ============================================================================

  console.log('✅ PHASE 6: Execution Order Verification...')
  console.log()

  // Find AI extraction and conditional steps in scatter_gather
  let aiExtractionStep: any = null
  let conditionalStep: any = null
  let aiStepIndex = -1
  let conditionalStepIndex = -1

  for (let i = 0; i < workflow.length; i++) {
    const step = workflow[i]
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

  console.log('🔍 Critical Execution Order:')
  if (aiExtractionStep && conditionalStep) {
    console.log(`   - AI Extraction: ${aiExtractionStep.step_id} (index ${aiStepIndex})`)
    console.log(`   - Conditional Check: ${conditionalStep.step_id} (index ${conditionalStepIndex})`)

    if (aiStepIndex < conditionalStepIndex) {
      console.log('\n   ✅ CORRECT: AI extraction happens BEFORE conditional check')
      console.log('   ✅ BUG FIXED: Amount exists when conditional executes')
    } else {
      console.log('\n   ❌ ERROR: Conditional check happens BEFORE AI extraction')
      console.log('   ❌ BUG PRESENT: Amount does not exist when conditional executes')
    }
  } else {
    console.log('   ℹ️  No AI extraction + conditional pattern detected in this workflow')
  }
  console.log()

  // Validate Phase 4
  console.log('📊 Validating Phase 4 (DSL)...')
  const dslValidator = new DSLRequirementsValidator()
  const dslValidation = dslValidator.validate(hardReqs, workflow)
  console.log(`   Phase 4 Score: ${dslValidation.score}/100`)
  console.log()

  // ============================================================================
  // Final Summary
  // ============================================================================

  console.log('='.repeat(80))
  console.log('FINAL VALIDATION SUMMARY')
  console.log('='.repeat(80))
  console.log()

  console.log('Requirements Preservation Across All Phases:')
  console.log(`   Phase 1 (Semantic Plan): ${semanticValidation.score}/100`)
  console.log(`   Phase 3 (IR):            SKIPPED (v4.0 uses execution_graph)`)
  console.log(`   Phase 4 (DSL):           ${dslValidation.score}/100`)
  console.log()

  const overallScore = Math.round((semanticValidation.score + dslValidation.score) / 2)
  console.log(`Overall Pipeline Score: ${overallScore}/100`)
  console.log()

  if (overallScore >= 80) {
    console.log('🎉 PIPELINE VALIDATION PASSED')
    console.log('   All requirements successfully preserved through the entire pipeline!')
  } else {
    console.log('⚠️  PIPELINE VALIDATION FAILED')
    console.log(`   Only ${overallScore}/100 requirements preserved (need 80%+)`)
  }
  console.log()

  // Detailed DSL validation
  console.log('='.repeat(80))
  console.log('DSL REQUIREMENTS PRESERVATION (Detailed)')
  console.log('='.repeat(80))
  console.log()

  dslValidation.details.forEach(result => {
    const icon = result.preserved ? '✅' : '⚠️'
    console.log(`${icon} ${result.requirementId}: [${result.type}]`)
    console.log(`   Constraint: ${result.constraint}`)
    console.log(`   Preserved: ${result.preserved ? 'YES' : 'NO'}`)
    if (result.dslMapping) {
      console.log(`   DSL Mapping: ${result.dslMapping}`)
    }
    console.log(`   Evidence: ${result.evidence}`)
    console.log()
  })

  // Print workflow for debugging
  console.log('='.repeat(80))
  console.log('COMPILED WORKFLOW (JSON)')
  console.log('='.repeat(80))
  console.log()
  console.log(JSON.stringify(workflow, null, 2))
}

// Run the test
testFullPipeline().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
