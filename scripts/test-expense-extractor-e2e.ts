/**
 * Full End-to-End Pipeline Test for Gmail Expense Attachment Extractor
 * Tests IR v4.0 with PDF extraction and table generation workflow
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { SemanticPlanGenerator } from '../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'
import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer'
import { ExecutionGraphCompiler } from '../lib/agentkit/v6/compiler/ExecutionGraphCompiler'
import type { DeclarativeLogicalIRv4 } from '../lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4'
import { ExecutionGraphVisualizer } from '../lib/agentkit/v6/utils/ExecutionGraphVisualizer'

const testEnhancedPrompt = {
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

async function runExpenseExtractorTest() {
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  GMAIL EXPENSE EXTRACTOR - Full Pipeline Test')
  console.log('═══════════════════════════════════════════════════════════════════\n')

  const pipelineStart = Date.now()

  // Phase 0
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 0: Enhanced Prompt                                        │')
  console.log('└─────────────────────────────────────────────────────────────────┘')
  console.log('Plan:', testEnhancedPrompt.plan_title)
  console.log('\nKey Features:')
  console.log('  - Gmail search: Last 7 days, subject contains "expenses" OR "receipt"')
  console.log('  - Extract PDF attachments')
  console.log('  - AI extraction of expense line items')
  console.log('  - Mark uncertain fields as "need review"')
  console.log('  - Combined table in email body')
  console.log('\n✅ Enhanced Prompt loaded\n')

  // Phase 1
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 1: Semantic Plan Generation                               │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  const semanticStart = Date.now()
  const semanticGenerator = new SemanticPlanGenerator({
    model_provider: 'anthropic',
    model_name: 'claude-opus-4-5-20251101',
    temperature: 0
  })

  console.log('Generating semantic plan...')
  const semanticResult = await semanticGenerator.generate(testEnhancedPrompt)
  const semanticDuration = Date.now() - semanticStart
  console.log(`✅ Complete in ${(semanticDuration / 1000).toFixed(1)}s\n`)

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

  // Phase 2
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 2: IR Formalization                                       │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  const formalizationStart = Date.now()
  const formalizer = new IRFormalizer({
    model: 'chatgpt-4o-latest',
    temperature: 0.0,
    openai_api_key: process.env.OPENAI_API_KEY
  })

  console.log('Formalizing to IR v4.0...')
  const irResult = await formalizer.formalize(groundedPlan)
  const formalizationDuration = Date.now() - formalizationStart
  console.log(`✅ Complete in ${(formalizationDuration / 1000).toFixed(1)}s`)

  const ir = irResult.ir as DeclarativeLogicalIRv4
  console.log('\nIR Summary:')
  console.log('  - Version:', ir.ir_version)
  console.log('  - Nodes:', Object.keys(ir.execution_graph?.nodes || {}).length)
  console.log('  - Variables:', ir.execution_graph?.variables?.length || 0)
  console.log()

  // Phase 3
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 3: Visualization                                          │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  if (ir.execution_graph) {
    const visualizer = new ExecutionGraphVisualizer()
    console.log('\n📈 Mermaid Diagram:')
    console.log('```mermaid')
    console.log(visualizer.toMermaid(ir.execution_graph))
    console.log('```\n')
  }

  // Phase 4
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 4: Compilation                                            │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  const compilationStart = Date.now()
  const compiler = new ExecutionGraphCompiler()

  console.log('Compiling...')
  const compiled = await compiler.compile(ir)
  const compilationDuration = Date.now() - compilationStart

  console.log(`✅ Complete in ${compilationDuration}ms`)
  console.log('\nResult:')
  console.log('  - Success:', compiled.success)
  console.log('  - Steps:', compiled.workflow.length)
  console.log('  - Plugins:', Array.from(compiled.plugins_used || []).join(', '))

  console.log('\n🎯 PILOT DSL Workflow:')
  console.log(JSON.stringify(compiled.workflow, null, 2))
  console.log()

  // Phase 5
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 5: Pattern Verification                                   │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  let hasFetchGmail = false
  let hasAIExtraction = false
  let hasLoop = false
  let hasEmailDelivery = false

  for (const step of compiled.workflow) {
    if (step.plugin === 'google-mail' && step.operation === 'search_messages') {
      hasFetchGmail = true
    }
    if (step.type === 'ai_processing') {
      hasAIExtraction = true
    }
    if (step.type === 'scatter_gather') {
      hasLoop = true
    }
    if (step.plugin === 'google-mail' && step.operation === 'send_message') {
      hasEmailDelivery = true
    }
    if (step.type === 'scatter_gather' && step.scatter?.steps) {
      for (const nested of step.scatter.steps) {
        if (nested.type === 'ai_processing') hasAIExtraction = true
      }
    }
  }

  console.log('\n🔍 Workflow Pattern Check:')
  console.log('  ', hasFetchGmail ? '✅' : '❌', 'Fetch Gmail messages')
  console.log('  ', hasLoop ? '✅' : '❌', 'Loop over emails/attachments')
  console.log('  ', hasAIExtraction ? '✅' : '❌', 'AI extraction from PDFs')
  console.log('  ', hasEmailDelivery ? '✅' : '❌', 'Email delivery with table')

  // Summary
  const totalDuration = Date.now() - pipelineStart

  console.log('\n┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ SUMMARY                                                          │')
  console.log('└─────────────────────────────────────────────────────────────────┘')
  console.log(`\n⏱️  Duration: ${(totalDuration / 1000).toFixed(1)}s`)
  console.log(`  - Semantic: ${(semanticDuration / 1000).toFixed(1)}s`)
  console.log(`  - Formalization: ${(formalizationDuration / 1000).toFixed(1)}s`)
  console.log(`  - Compilation: ${compilationDuration}ms`)

  const allChecks = hasFetchGmail && hasLoop && hasAIExtraction && hasEmailDelivery
  console.log('\n✅ STATUS:')
  if (compiled.success && allChecks) {
    console.log('  ✅ All phases complete')
    console.log('  ✅ Workflow pattern correct')
    console.log('  ✅ Ready for execution')
  } else {
    console.log('  ⚠️  Issues detected')
    if (!allChecks) console.log('  ⚠️  Some patterns missing')
  }

  console.log('\n═══════════════════════════════════════════════════════════════════\n')
}

runExpenseExtractorTest().catch(error => {
  console.error('\n❌ FAILED:')
  console.error(error)
  process.exit(1)
})
