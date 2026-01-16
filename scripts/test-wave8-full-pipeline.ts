/**
 * Wave 8 Full Pipeline Test Script
 *
 * Tests the complete V6 pipeline with a Gmail → Sheets complaint logger workflow
 * Captures errors at each phase for verification
 */

import { SemanticPlanGenerator, EnhancedPrompt } from '../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'
import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer'
import { DeclarativeCompiler } from '../lib/agentkit/v6/compiler/DeclarativeCompiler'
import { validateDeclarativeIR } from '../lib/agentkit/v6/logical-ir/validation/DeclarativeIRValidator'
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2'
import type { GroundedSemanticPlan, SemanticPlan } from '../lib/agentkit/v6/semantic-plan/schemas/semantic-plan-types'

// Test configuration
const TEST_USER_EMAIL = 'offir.omer@gmail.com'
const TEST_USER_ID = 'test-user-wave8'

// Enhanced prompt for testing
const ENHANCED_PROMPT: EnhancedPrompt = {
  sections: {
    data: [
      "- Scan Gmail Inbox messages from the last 7 days.",
      "- Treat an email as a complaint if the email content contains any of these keywords (case-insensitive match): \"complaint\", \"refund\", \"angry\", \"not working\".",
      "- Use the Google Sheet with spreadsheet id \"1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc\" as the destination.",
      "- Use the worksheet/tab name \"UrgentEmails\" inside that spreadsheet as the destination tab.",
      "- Read existing rows from the destination tab to identify already-logged complaint emails by Gmail message link/id."
    ],
    actions: [
      "- For each Gmail message in scope, check whether the message content contains any of: \"complaint\", \"refund\", \"angry\", \"not working\".",
      "- If the message matches the complaint rule, extract these fields: sender email, subject, date, and the full email text.",
      "- If the message matches the complaint rule, also capture the Gmail message link/id to use as a unique identifier.",
      "- If the Gmail message link/id already exists in the destination tab, do not add a new row for that message.",
      "- If the Gmail message link/id does not exist in the destination tab, append exactly one new row for that message.",
      "- Treat each matching message independently (if a thread has multiple matching messages, log every matching message as its own row)."
    ],
    output: [
      "- Append one row per complaint email to the destination Google Sheet tab.",
      "- Each appended row must include (in this order): sender email, subject, date, full email text, Gmail message link/id."
    ],
    delivery: [
      "- Deliver results by writing/appending rows into the Google Sheet tab \"UrgentEmails\" (no email/slack notification)."
    ],
    processing_steps: [
      "- Fetch Gmail messages from Inbox for the last 7 days.",
      "- Load existing rows from the \"UrgentEmails\" tab and build a set of existing Gmail message link/id values.",
      "- Filter messages by keyword match against the email content (case-insensitive).",
      "- For each matching message, extract required fields and append a new row only if its Gmail message link/id is not already present."
    ]
  },
  user_context: {
    original_request: "Customer Complaint Email Logger (Gmail → Google Sheets): Scans your Gmail Inbox for the last 7 days, finds emails that contain complaint keywords, and appends only those complaint emails into the 'UrgentEmails' tab of your Google Sheet while skipping duplicates based on Gmail message link/id."
  }
}

// Additional specifics for context
const SPECIFICS = {
  services_involved: [
    "google-mail",
    "google-sheets"
  ],
  user_inputs_required: [],
  resolved_user_inputs: [
    { key: "user_email", value: TEST_USER_EMAIL },
    { key: "spreadsheet_id", value: "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc" },
    { key: "sheet_tab_name", value: "UrgentEmails" },
    { key: "gmail_scope", value: "Inbox" },
    { key: "data_time_window", value: "last 7 days" },
    { key: "complaint_keywords", value: "complaint, refund, angry, not working" },
    { key: "sheet_dedup_rule", value: "skip if Gmail message link/id already exists in the sheet" },
    { key: "thread_handling", value: "log every message that matches the complaint rule" },
    { key: "sheet_columns", value: "sender email, subject, date, full email text, Gmail message link/id" }
  ]
}

interface PhaseResult {
  phase: string
  success: boolean
  duration: number
  output?: any
  error?: string
  errorStack?: string
}

async function runPhase<T>(
  phaseName: string,
  fn: () => Promise<T>
): Promise<PhaseResult & { output?: T }> {
  const start = Date.now()
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🚀 Starting ${phaseName}`)
  console.log(`${'='.repeat(60)}`)

  try {
    const output = await fn()
    const duration = Date.now() - start
    console.log(`✅ ${phaseName} completed in ${duration}ms`)
    return { phase: phaseName, success: true, duration, output }
  } catch (error: any) {
    const duration = Date.now() - start
    console.error(`❌ ${phaseName} FAILED after ${duration}ms`)
    console.error(`   Error: ${error.message}`)
    if (error.stack) {
      console.error(`   Stack: ${error.stack.split('\n').slice(0, 5).join('\n')}`)
    }
    return {
      phase: phaseName,
      success: false,
      duration,
      error: error.message,
      errorStack: error.stack
    }
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║           Wave 8 Full Pipeline Test                        ║')
  console.log('║           Gmail → Sheets Complaint Logger                  ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log(`\nTest User: ${TEST_USER_EMAIL}`)
  console.log(`Timestamp: ${new Date().toISOString()}`)

  const results: PhaseResult[] = []

  // Initialize plugin manager
  console.log('\n📦 Initializing Plugin Manager...')
  let pluginManager: PluginManagerV2
  try {
    pluginManager = await PluginManagerV2.getInstance()
    const availablePlugins = pluginManager.getAvailablePlugins()
    const pluginKeys = Object.keys(availablePlugins)
    console.log(`   Available plugins: ${pluginKeys.join(', ')}`)
  } catch (error: any) {
    console.error('❌ Plugin Manager initialization failed:', error.message)
    console.log('\n⛔ Cannot proceed without Plugin Manager')
    return
  }

  // ========================================================================
  // PHASE 1: Semantic Plan Generation
  // ========================================================================
  const phase1 = await runPhase('Phase 1: Semantic Plan Generation', async () => {
    const generator = new SemanticPlanGenerator({
      model_provider: 'openai',
      model_name: 'gpt-4o'
    })

    const result = await generator.generate(ENHANCED_PROMPT)

    if (!result.success) {
      throw new Error(`Semantic plan generation failed: ${result.errors?.join(', ')}`)
    }

    console.log(`   Goal: ${result.semantic_plan?.goal}`)
    console.log(`   Data sources: ${result.semantic_plan?.data_sources?.length || 0}`)
    console.log(`   Tokens used: ${result.metadata?.tokens_used || 0}`)

    return result
  })
  results.push(phase1)

  if (!phase1.success || !phase1.output?.semantic_plan) {
    console.log('\n⛔ Cannot proceed without semantic plan')
    printSummary(results)
    return
  }

  // ========================================================================
  // PHASE 2: Grounding (Create grounded plan with mock metadata)
  // ========================================================================
  const phase2 = await runPhase('Phase 2: Grounding', async () => {
    // For this test, we'll create a grounded plan directly since we don't have
    // a GroundingEngine class exported. We'll simulate grounding by wrapping
    // the semantic plan with grounding metadata.
    const semanticPlan = phase1.output!.semantic_plan!

    // Create a grounded semantic plan
    const groundedPlan: GroundedSemanticPlan = {
      ...semanticPlan,
      grounded: true,
      confidence: 0.9,
      grounding_results: [
        {
          assumption: 'Gmail messages have sender, subject, date, body fields',
          validated: true,
          confidence: 0.95,
          matched_field: 'from,subject,date,body'
        },
        {
          assumption: 'Google Sheets supports append_rows operation',
          validated: true,
          confidence: 0.95,
          matched_field: 'spreadsheet_id,range,values'
        }
      ]
    }

    console.log(`   Confidence: ${groundedPlan.confidence}`)
    console.log(`   Grounding results: ${groundedPlan.grounding_results?.length || 0}`)
    console.log(`   Validated assumptions: ${groundedPlan.grounding_results?.filter((r: any) => r.validated).length || 0}`)

    return groundedPlan
  })
  results.push(phase2)

  if (!phase2.success || !phase2.output) {
    console.log('\n⛔ Cannot proceed without grounded plan')
    printSummary(results)
    return
  }

  // ========================================================================
  // PHASE 3: IR Formalization
  // ========================================================================
  const phase3 = await runPhase('Phase 3: IR Formalization', async () => {
    const formalizer = new IRFormalizer({
      model: 'gpt-4o',
      pluginManager: pluginManager,
      servicesInvolved: SPECIFICS.services_involved
    })

    const formalizationResult = await formalizer.formalize(phase2.output!)

    console.log(`   IR Version: ${formalizationResult.ir.ir_version}`)
    console.log(`   Goal: ${formalizationResult.ir.goal}`)
    console.log(`   Data sources: ${formalizationResult.ir.data_sources?.length || 0}`)
    console.log(`   AI operations: ${formalizationResult.ir.ai_operations?.length || 0}`)
    console.log(`   Filters: ${formalizationResult.ir.filters?.conditions?.length || 0}`)

    return formalizationResult
  })
  results.push(phase3)

  if (!phase3.success || !phase3.output?.ir) {
    console.log('\n⛔ Cannot proceed without formalized IR')
    printSummary(results)
    return
  }

  // ========================================================================
  // PHASE 3.5: IR Validation
  // ========================================================================
  const phase3_5 = await runPhase('Phase 3.5: IR Validation', async () => {
    const validationResult = validateDeclarativeIR(phase3.output!.ir)

    console.log(`   Valid: ${validationResult.valid}`)
    if (validationResult.errors.length > 0) {
      console.log(`   Errors: ${validationResult.errors.length}`)
      validationResult.errors.forEach((e: any, i: number) => {
        console.log(`     ${i + 1}. [${e.error_code}] ${e.message}`)
      })
    }

    if (!validationResult.valid) {
      throw new Error(`IR validation failed: ${validationResult.errors.map((e: any) => e.message).join('; ')}`)
    }

    return validationResult
  })
  results.push(phase3_5)

  if (!phase3_5.success) {
    console.log('\n⛔ Cannot proceed with invalid IR')
    printSummary(results)
    return
  }

  // ========================================================================
  // PHASE 4: Compilation
  // ========================================================================
  const phase4 = await runPhase('Phase 4: Compilation', async () => {
    const compiler = new DeclarativeCompiler(pluginManager)

    const compilationResult = await compiler.compile(phase3.output!.ir)

    console.log(`   Success: ${compilationResult.success}`)
    console.log(`   Steps generated: ${compilationResult.workflow?.length || 0}`)
    if (compilationResult.workflow) {
      compilationResult.workflow.forEach((step: any, i: number) => {
        console.log(`     ${i + 1}. [${step.type}] ${step.id || step.step_id}: ${step.description || step.plugin + '.' + step.operation}`)
      })
    }

    if (!compilationResult.success) {
      throw new Error(`Compilation failed: ${compilationResult.errors?.join(', ')}`)
    }

    return compilationResult
  })
  results.push(phase4)

  // ========================================================================
  // Summary
  // ========================================================================
  printSummary(results)

  // Write detailed results to file
  const outputPath = `/Users/yaelomer/Documents/neuronforge/wave8-test-results-${Date.now()}.json`
  const fs = await import('fs')
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    user: TEST_USER_EMAIL,
    prompt: ENHANCED_PROMPT,
    specifics: SPECIFICS,
    results: results.map(r => ({
      phase: r.phase,
      success: r.success,
      duration: r.duration,
      error: r.error,
      // Don't include full output in summary file (too large)
    })),
    phase1_output: phase1.output,
    phase2_output: phase2.output,
    phase3_output: phase3.output,
    phase4_output: phase4.output
  }, null, 2))
  console.log(`\n📄 Detailed results written to: ${outputPath}`)
}

function printSummary(results: PhaseResult[]) {
  console.log('\n')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    TEST SUMMARY                            ║')
  console.log('╚════════════════════════════════════════════════════════════╝')

  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)
  const passed = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  console.log(`\nTotal phases: ${results.length}`)
  console.log(`Passed: ${passed} ✅`)
  console.log(`Failed: ${failed} ❌`)
  console.log(`Total duration: ${totalDuration}ms`)

  console.log('\n┌─────────────────────────────────────────┬─────────┬──────────┐')
  console.log('│ Phase                                   │ Status  │ Duration │')
  console.log('├─────────────────────────────────────────┼─────────┼──────────┤')

  results.forEach(r => {
    const status = r.success ? '✅ Pass' : '❌ Fail'
    const phase = r.phase.padEnd(39)
    const duration = `${r.duration}ms`.padStart(8)
    console.log(`│ ${phase} │ ${status} │ ${duration} │`)
  })

  console.log('└─────────────────────────────────────────┴─────────┴──────────┘')

  // Print errors if any
  const errors = results.filter(r => !r.success)
  if (errors.length > 0) {
    console.log('\n🚨 ERRORS:')
    errors.forEach(e => {
      console.log(`\n[${e.phase}]`)
      console.log(`  ${e.error}`)
    })
  }

  // Final verdict
  console.log('\n' + '═'.repeat(60))
  if (failed === 0) {
    console.log('🎉 ALL PHASES PASSED - Wave 8 pipeline is fully functional!')
  } else {
    console.log(`⚠️  ${failed} PHASE(S) FAILED - Review errors above`)
  }
  console.log('═'.repeat(60))
}

// Run the test
main().catch(console.error)
