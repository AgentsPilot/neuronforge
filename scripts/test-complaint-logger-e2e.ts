/**
 * Full End-to-End Pipeline Test for Customer Complaint Email Logger
 * Tests IR v4.0 with a different workflow pattern
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

async function runComplaintLoggerTest() {
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  CUSTOMER COMPLAINT EMAIL LOGGER - Full Pipeline Test')
  console.log('═══════════════════════════════════════════════════════════════════\n')

  const pipelineStart = Date.now()

  // Phase 0: Enhanced Prompt
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 0: Enhanced Prompt (Input)                                │')
  console.log('└─────────────────────────────────────────────────────────────────┘')
  console.log('Plan Title:', testEnhancedPrompt.plan_title)
  console.log('Description:', testEnhancedPrompt.plan_description)
  console.log('\nKey Features:')
  console.log('  - Gmail scan: Last 7 days from Inbox')
  console.log('  - Keywords: complaint, refund, angry, not working')
  console.log('  - Destination: Google Sheets tab "UrgentEmails"')
  console.log('  - Deduplication: Skip if message ID already exists')
  console.log('\n✅ Enhanced Prompt loaded\n')

  // Phase 1: Semantic Plan
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 1: Semantic Plan Generation (Claude Opus 4.5)             │')
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

  console.log(`✅ Semantic plan generated in ${(semanticDuration / 1000).toFixed(1)}s\n`)

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

  // Phase 2: IR Formalization
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 2: IR Formalization (GPT-4o + v4.0 Prompt)                │')
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

  console.log(`✅ IR formalization complete in ${(formalizationDuration / 1000).toFixed(1)}s`)

  const ir = irResult.ir as DeclarativeLogicalIRv4
  console.log('\nIR v4.0 Summary:')
  console.log('  - IR Version:', ir.ir_version)
  console.log('  - Goal:', ir.goal)

  if (ir.execution_graph) {
    const graph = ir.execution_graph
    console.log('  - Start Node:', graph.start)
    console.log('  - Total Nodes:', Object.keys(graph.nodes).length)
    console.log('  - Variables:', graph.variables?.length || 0)

    const nodeTypes: Record<string, number> = {}
    for (const node of Object.values(graph.nodes)) {
      nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1
    }
    console.log('  - Node Types:', JSON.stringify(nodeTypes))
  }
  console.log()

  // Phase 3: Visualization
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 3: Execution Graph Visualization                          │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  if (ir.execution_graph) {
    const visualizer = new ExecutionGraphVisualizer()

    console.log('\n📈 Mermaid Diagram:')
    console.log('```mermaid')
    console.log(visualizer.toMermaid(ir.execution_graph))
    console.log('```\n')

    const analysis = visualizer.analyze(ir.execution_graph)
    console.log('📊 Complexity Analysis:')
    console.log('  - Total Nodes:', analysis.nodeCount)
    console.log('  - Max Depth:', analysis.maxDepth)
    console.log('  - Complexity:', analysis.estimatedComplexity)
    console.log()
  }

  // Phase 4: Compilation
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 4: Compilation to PILOT DSL                               │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  const compilationStart = Date.now()
  const compiler = new ExecutionGraphCompiler()

  console.log('Compiling execution graph...')
  const compiled = await compiler.compile(ir)
  const compilationDuration = Date.now() - compilationStart

  console.log(`✅ Compilation complete in ${compilationDuration}ms`)
  console.log('\nCompilation Result:')
  console.log('  - Success:', compiled.success)
  console.log('  - Total Steps:', compiled.workflow.length)
  console.log('  - Plugins Used:', Array.from(compiled.plugins_used || []).join(', '))

  console.log('\n🎯 Final PILOT DSL Workflow:')
  console.log(JSON.stringify(compiled.workflow, null, 2))
  console.log()

  // Phase 5: Verification
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PHASE 5: Workflow Pattern Verification                          │')
  console.log('└─────────────────────────────────────────────────────────────────┘')

  // Check for key operations
  let hasFetchGmail = false
  let hasFetchSheets = false
  let hasFilterStep = false
  let hasConditionalAppend = false
  let hasDeduplication = false

  for (const step of compiled.workflow) {
    if (step.plugin === 'google-mail' && step.operation === 'search_messages') {
      hasFetchGmail = true
    }
    if (step.plugin === 'google-sheets' && (step.operation === 'read_rows' || step.operation === 'get_rows')) {
      hasFetchSheets = true
    }
    if (step.type === 'conditional' || step.type === 'transform') {
      if (step.description?.toLowerCase().includes('complaint') ||
          step.description?.toLowerCase().includes('keyword') ||
          step.description?.toLowerCase().includes('filter')) {
        hasFilterStep = true
      }
      if (step.description?.toLowerCase().includes('duplicate') ||
          step.description?.toLowerCase().includes('exists')) {
        hasDeduplication = true
      }
    }
    if (step.type === 'scatter_gather' && step.scatter?.steps) {
      for (const nestedStep of step.scatter.steps) {
        if (nestedStep.type === 'conditional') {
          if (nestedStep.description?.toLowerCase().includes('append') ||
              nestedStep.description?.toLowerCase().includes('sheet')) {
            hasConditionalAppend = true
          }
        }
      }
    }
  }

  console.log('\n🔍 Workflow Pattern Check:')
  console.log('  ', hasFetchGmail ? '✅' : '❌', 'Fetch Gmail messages')
  console.log('  ', hasFetchSheets ? '✅' : '❌', 'Fetch existing Sheet rows (for dedup)')
  console.log('  ', hasFilterStep ? '✅' : '❌', 'Filter by complaint keywords')
  console.log('  ', hasDeduplication ? '✅' : '❌', 'Deduplication logic')
  console.log('  ', hasConditionalAppend ? '✅' : '❌', 'Conditional append to Sheets')

  // Summary
  const totalDuration = Date.now() - pipelineStart

  console.log('\n┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ PIPELINE SUMMARY                                                 │')
  console.log('└─────────────────────────────────────────────────────────────────┘')
  console.log(`\n⏱️  Total Duration: ${(totalDuration / 1000).toFixed(1)}s`)
  console.log(`  - Semantic: ${(semanticDuration / 1000).toFixed(1)}s`)
  console.log(`  - Formalization: ${(formalizationDuration / 1000).toFixed(1)}s`)
  console.log(`  - Compilation: ${compilationDuration}ms`)

  console.log('\n📊 Results:')
  console.log(`  - IR Version: ${ir.ir_version}`)
  console.log(`  - Nodes: ${Object.keys(ir.execution_graph?.nodes || {}).length}`)
  console.log(`  - Steps: ${compiled.workflow.length}`)

  const allChecks = hasFetchGmail && hasFetchSheets && hasFilterStep && hasConditionalAppend
  console.log('\n✅ PIPELINE STATUS:')
  if (compiled.success && allChecks) {
    console.log('  ✅ All phases completed successfully')
    console.log('  ✅ Workflow pattern is correct')
    console.log('  ✅ Ready for execution')
  } else {
    console.log('  ⚠️  Pipeline completed with potential issues')
    if (!compiled.success) console.log('  ❌ Compilation failed')
    if (!allChecks) console.log('  ⚠️  Some workflow patterns missing')
  }

  console.log('\n═══════════════════════════════════════════════════════════════════\n')
}

runComplaintLoggerTest().catch(error => {
  console.error('\n❌ TEST FAILED:')
  console.error(error)
  process.exit(1)
})
