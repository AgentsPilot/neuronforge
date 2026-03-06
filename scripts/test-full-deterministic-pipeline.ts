/**
 * Complete End-to-End Test: Full Deterministic Pipeline
 *
 * Complete Flow (including LLM Intent generation):
 * 1. Enhanced Prompt + Vocabularies → (ready from Phase 0)
 * 2. Intent Contract Generator (LLM) → IntentContract (Generic V1)
 * 3. CapabilityBinderV2 (Deterministic) → BoundIntentContract
 * 4. IntentToIRConverter (Deterministic) → ExecutionGraph (IR v4)
 * 5. ExecutionGraphCompiler (Deterministic) → PILOT DSL Steps
 * 6. Validate complete flow
 */

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer'
import { CapabilityBinderV2 } from '../lib/agentkit/v6/capability-binding/CapabilityBinderV2'
import { IntentToIRConverter } from '../lib/agentkit/v6/compiler/IntentToIRConverter'
import { ExecutionGraphCompiler } from '../lib/agentkit/v6/compiler/ExecutionGraphCompiler'
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2'
import type { IntentContract } from '../lib/agentkit/v6/semantic-plan/types/intent-schema-types'

// Load environment variables from .env.local
dotenv.config({ path: path.join(process.cwd(), '.env.local') })

async function main() {
  console.log('🚀 Testing COMPLETE Deterministic Pipeline (Full End-to-End)')
  console.log('=' .repeat(80))

  // =======================
  // PHASE 0: Setup
  // =======================
  console.log('\n📦 Phase 0: Setup')
  console.log('-'.repeat(80))

  const userId = '08456106-aa50-4810-b12c-7ca84102da31'

  // Initialize PluginManagerV2 with proper singleton instance
  const pluginManager = await PluginManagerV2.getInstance()
  console.log(`✅ PluginManager initialized`)

  // Enhanced prompt from user's actual workflow
  const enhancedPrompt = {
    "plan_title": "Invoice & Receipt Extraction Agent (Gmail → Drive + Sheets + Summary Email)",
    "plan_description": "Extracts invoices/receipts from unread Gmail emails, stores the files in Google Drive, logs transactions over $50 to a Google Sheet tab, and emails you a summary of all extracted transactions.",
    "sections": {
      "data": [
        "- Scan Gmail for unread emails only.",
        "- From each unread email, consider PDF attachments and image attachments (e.g., .pdf, .jpg, .png) as candidate invoices/receipts.",
        "- Treat each attachment as a separate candidate transaction (do not combine multiple attachments into one transaction).",
        "- Capture source email metadata for each attachment: sender and subject.",
        "- Store each attachment file in a newly created Google Drive folder (folder name to be confirmed).",
        "- Extract standard transaction fields from each attachment: date, vendor, amount, currency, and invoice/receipt number."
      ],
      "actions": [
        "- For each candidate attachment, extract the standard fields (date, vendor, amount, currency, invoice/receipt number) as structured data.",
        "- If the agent cannot confidently find an amount for an attachment, skip creating a transaction record for it and add a note about it in the summary email (include sender + subject and the Drive file link).",
        "- If the extracted amount is greater than $50, append a new row to the specified Google Sheet tab (\"Expenses\").",
        "- If the extracted amount is $50 or less, do not write it to Google Sheets, but still include it in the summary email's \"all transactions\" table."
      ],
      "output": [
        "- Produce an email-friendly summary that includes a table of all extracted transactions (including transactions with amount <= $50).",
        "- Include a separate section listing only transactions with amount > $50.",
        "- Include a Google Drive link for each stored file.",
        "- Include source email info for each transaction (sender and subject).",
        "- Include totals summary (at minimum: number of transactions extracted, sum of amounts for all extracted transactions, and sum of amounts for the > $50 subset).",
        "- Include a separate note section listing any attachments that were skipped because the amount was missing/unclear."
      ],
      "delivery": [
        "- Send the summary email to offir.omer@gmail.com."
      ],
      "processing_steps": [
        "- Find unread emails in Gmail.",
        "- For each unread email, collect PDF and image attachments.",
        "- Create (or ensure) the target Google Drive folder exists, then upload/store each attachment there.",
        "- Extract standard fields from each stored attachment.",
        "- Split extracted transactions into two groups: amount > $50 and amount <= $50.",
        "- Append only the amount > $50 group to the specified Google Sheet tab.",
        "- Generate the summary email content with the required tables/sections and send it."
      ]
    },
    "specifics": {
      "services_involved": [
        "google-mail",
        "google-drive",
        "google-sheets",
        "chatgpt-research"
      ],
      "user_inputs_required": [
        "Confirm the new Google Drive folder name for stored invoices/receipts",
        "Confirm whether to use the Google Sheet by ID or by name (and provide the chosen identifier in the preferred format)"
      ],
      "resolved_user_inputs": [
        {
          "key": "user_email",
          "value": "offir.omer@gmail.com"
        },
        {
          "key": "email_scope",
          "value": "unread_only"
        },
        {
          "key": "attachment_types",
          "value": "pdf_attachments, image_attachments"
        },
        {
          "key": "drive_folder_strategy",
          "value": "new_folder"
        },
        {
          "key": "sheet_destination_strategy",
          "value": "existing_sheet"
        },
        {
          "key": "extraction_fields_profile",
          "value": "standard (date, vendor, amount, currency, invoice/receipt #)"
        },
        {
          "key": "multi_attachment_handling",
          "value": "separate_transactions"
        },
        {
          "key": "summary_email_includes",
          "value": "all_transactions_table, over_50_section, drive_links, source_email_links, totals_summary"
        },
        {
          "key": "missing_amount_handling",
          "value": "skip_and_note"
        },
        {
          "key": "amount_threshold_usd",
          "value": "50"
        },
        {
          "key": "sheet_tab_name",
          "value": "Expenses"
        },
        {
          "key": "google_sheet_id_candidate",
          "value": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"
        }
      ]
    }
  }

  console.log(`\n📝 Enhanced Prompt:`)
  console.log(`   Title: ${enhancedPrompt.plan_title}`)
  console.log(`   Description: ${enhancedPrompt.plan_description}`)
  console.log(`   Services: ${enhancedPrompt.specifics.services_involved.join(', ')}`)

  // =======================
  // PHASE 1: Intent Contract Generation (LLM)
  // =======================
  console.log('\n🤖 Phase 1: Intent Contract Generation (IRFormalizer + LLM)')
  console.log('-'.repeat(80))

  const formalizer = new IRFormalizer()

  console.log('Generating ExecutionGraph IR from enhanced prompt...')
  console.log('(This uses LLM via IRFormalizer)')

  // IRFormalizer.formalize() takes EnhancedPrompt and returns IR v4
  const formalizationResult = await formalizer.formalize(enhancedPrompt)

  const ir = formalizationResult.ir

  console.log(`✅ IR v4 generated from LLM`)
  console.log(`   IR Version: ${ir.ir_version}`)
  console.log(`   Goal: ${ir.goal}`)

  if (ir.execution_graph) {
    console.log(`   Total Nodes: ${Object.keys(ir.execution_graph.nodes).length}`)
  }

  // Save Intent Contract
  const outputDir = path.join(process.cwd(), 'output')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const intentPath = path.join(outputDir, 'test-intent-contract.json')
  fs.writeFileSync(intentPath, JSON.stringify(intentContract, null, 2))
  console.log(`   Saved: ${intentPath}`)

  // =======================
  // PHASE 2: Capability Binding (Deterministic)
  // =======================
  console.log('\n🔗 Phase 2: Capability Binding (CapabilityBinderV2 - DETERMINISTIC)')
  console.log('-'.repeat(80))

  const binder = new CapabilityBinderV2(pluginManager)

  console.log('Running deterministic capability binding...')
  const boundIntent = await binder.bind(intentContract, userId)

  console.log(`✅ Binding complete`)
  console.log(`   Bound steps: ${boundIntent.steps.length}`)

  // Count successfully bound steps
  let successfulBindings = 0
  let failedBindings = 0

  for (const step of boundIntent.steps) {
    if ('plugin_key' in step && step.plugin_key) {
      successfulBindings++
      console.log(`   ✅ ${step.id}: ${step.plugin_key}.${(step as any).action}`)
    } else {
      failedBindings++
      console.log(`   ⚠️  ${step.id}: No binding (${step.kind})`)
    }
  }

  console.log(`\n   Summary: ${successfulBindings} bound, ${failedBindings} unbound`)

  // Save Bound Intent Contract
  const boundIntentPath = path.join(outputDir, 'test-bound-intent-contract.json')
  fs.writeFileSync(boundIntentPath, JSON.stringify(boundIntent, null, 2))
  console.log(`   Saved: ${boundIntentPath}`)

  // =======================
  // PHASE 3: Intent → IR Conversion (Deterministic)
  // =======================
  console.log('\n🔄 Phase 3: Intent → IR Conversion (IntentToIRConverter - DETERMINISTIC)')
  console.log('-'.repeat(80))

  const converter = new IntentToIRConverter()

  console.log('Converting BoundIntentContract → ExecutionGraph (IR v4)...')
  const conversionResult = converter.convert(boundIntent)

  if (!conversionResult.success || !conversionResult.ir) {
    console.error('❌ Conversion failed!')
    console.error('Errors:', conversionResult.errors)
    process.exit(1)
  }

  const ir = conversionResult.ir

  console.log(`✅ Conversion complete`)
  console.log(`   IR Version: ${ir.version}`)
  console.log(`   Start Node: ${ir.execution_graph.start_node}`)
  console.log(`   Total Nodes: ${Object.keys(ir.execution_graph.nodes).length}`)

  if (conversionResult.warnings.length > 0) {
    console.log(`\n   ⚠️  Warnings:`)
    conversionResult.warnings.forEach(w => console.log(`      - ${w}`))
  }

  // Node type breakdown
  const nodeTypes: Record<string, number> = {}
  for (const node of Object.values(ir.execution_graph.nodes)) {
    nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1
  }

  console.log(`\n   Node Type Breakdown:`)
  for (const [type, count] of Object.entries(nodeTypes)) {
    console.log(`      - ${type}: ${count}`)
  }

  // Save ExecutionGraph (IR v4)
  const irPath = path.join(outputDir, 'test-execution-graph-ir-v4.json')
  fs.writeFileSync(irPath, JSON.stringify(ir, null, 2))
  console.log(`   Saved: ${irPath}`)

  // =======================
  // PHASE 4: IR Compilation (Deterministic)
  // =======================
  console.log('\n⚙️  Phase 4: IR Compilation (ExecutionGraphCompiler - DETERMINISTIC)')
  console.log('-'.repeat(80))

  const compiler = new ExecutionGraphCompiler(pluginManager)

  console.log('Compiling ExecutionGraph → PILOT DSL Steps...')

  // For this test, use empty hard requirements
  const hardReqs = {
    global_rules: {},
    thresholds: {},
    invariants: {}
  }

  const compilationResult = await compiler.compile(ir, hardReqs)

  if (!compilationResult.success || !compilationResult.workflow) {
    console.error('❌ Compilation failed!')
    console.error('Errors:', compilationResult.errors)
    process.exit(1)
  }

  const pilotSteps = compilationResult.workflow

  console.log(`✅ Compilation complete`)
  console.log(`   PILOT Steps: ${pilotSteps.length}`)

  if (compilationResult.warnings && compilationResult.warnings.length > 0) {
    console.log(`\n   ⚠️  Warnings:`)
    compilationResult.warnings.forEach(w => console.log(`      - ${w}`))
  }

  // Step type breakdown
  const stepTypes: Record<string, number> = {}
  for (const step of pilotSteps) {
    stepTypes[step.type] = (stepTypes[step.type] || 0) + 1
  }

  console.log(`\n   PILOT Step Type Breakdown:`)
  for (const [type, count] of Object.entries(stepTypes)) {
    console.log(`      - ${type}: ${count}`)
  }

  // Save PILOT DSL Steps
  const pilotPath = path.join(outputDir, 'test-pilot-dsl-steps.json')
  fs.writeFileSync(pilotPath, JSON.stringify(pilotSteps, null, 2))
  console.log(`   Saved: ${pilotPath}`)

  // =======================
  // PHASE 5: Final Validation Summary
  // =======================
  console.log('\n✅ Phase 5: Final Validation Summary')
  console.log('=' .repeat(80))

  console.log('\n🎉 COMPLETE DETERMINISTIC PIPELINE TEST SUCCESSFUL!\n')

  console.log('Complete Pipeline Flow Validated:')
  console.log('  1. ✅ User Prompt (input)')
  console.log(`  2. ✅ IRFormalizer (LLM) → IntentContract (${intentContract.steps.length} steps)`)
  console.log(`  3. ✅ CapabilityBinderV2 (Deterministic) → BoundIntentContract (${successfulBindings} bindings)`)
  console.log(`  4. ✅ IntentToIRConverter (Deterministic) → ExecutionGraph (${Object.keys(ir.execution_graph.nodes).length} nodes)`)
  console.log(`  5. ✅ ExecutionGraphCompiler (Deterministic) → PILOT DSL (${pilotSteps.length} steps)`)

  console.log('\n📊 Pipeline Stats:')
  console.log(`   User Prompt:         "${userPrompt}"`)
  console.log(`   Intent Steps:        ${intentContract.steps.length}`)
  console.log(`   Successful Bindings: ${successfulBindings}`)
  console.log(`   Failed Bindings:     ${failedBindings}`)
  console.log(`   IR Nodes:            ${Object.keys(ir.execution_graph.nodes).length}`)
  console.log(`   PILOT Steps:         ${pilotSteps.length}`)
  console.log(`   Conversion Warnings: ${conversionResult.warnings.length}`)
  console.log(`   Compilation Warnings: ${compilationResult.warnings?.length || 0}`)

  console.log('\n📁 Output Files:')
  console.log(`   - ${intentPath}`)
  console.log(`   - ${boundIntentPath}`)
  console.log(`   - ${irPath}`)
  console.log(`   - ${pilotPath}`)

  console.log('\n🔍 Deterministic Phases (No LLM):')
  console.log('   - Phase 2: CapabilityBinderV2 ✅')
  console.log('   - Phase 3: IntentToIRConverter ✅')
  console.log('   - Phase 4: ExecutionGraphCompiler ✅')

  console.log('\n' + '=' .repeat(80))
  console.log('✅ FULL DETERMINISTIC PIPELINE COMPLETE')
  console.log('=' .repeat(80))
  console.log('\n📝 Next Steps:')
  console.log('   1. Review output files for correctness')
  console.log('   2. Validate PILOT DSL can be executed')
  console.log('   3. Test with more complex workflows')
  console.log('   4. Integrate into V6PipelineOrchestrator')
  console.log('   5. Replace production LLM-based IR generation\n')
}

main().catch((err) => {
  console.error('\n❌ Pipeline test failed:', err)
  console.error('\nStack trace:', err.stack)
  process.exit(1)
})
