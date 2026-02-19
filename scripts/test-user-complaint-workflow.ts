/**
 * User-Requested Test: Customer Complaint Email Logger
 * Run V6PipelineOrchestrator with exact enhanced prompt
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { V6PipelineOrchestrator } from '../lib/agentkit/v6/pipeline/V6PipelineOrchestrator'

const complaintLoggerPrompt = {
  "plan_title": "Customer Complaint Email Logger (Gmail → Google Sheets)",
  "plan_description": "Scans your Gmail Inbox for the last 7 days, finds emails that contain complaint keywords, and appends only those complaint emails into the 'UrgentEmails' tab of your Google Sheet while skipping duplicates based on Gmail message link/id.",
  "sections": {
    "data": [
      "- Scan Gmail Inbox messages from the last 7 days.",
      "- Treat an email as a complaint if the email content contains any of these keywords (case-insensitive match): \"complaint\", \"refund\", \"angry\", \"not working\".",
      "- Use the Google Sheet with spreadsheet id \"1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc\" as the destination.",
      "- Use the worksheet/tab name \"UrgentEmails\" inside that spreadsheet as the destination tab.",
      "- Read existing rows from the destination tab to identify already-logged complaint emails by Gmail message link/id."
    ],
    "actions": [
      "- For each Gmail message in scope, check whether the message content contains any of: \"complaint\", \"refund\", \"angry\", \"not working\".",
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
      "- Deliver results by writing/appending rows into the Google Sheet tab \"UrgentEmails\" (no email/slack notification)."
    ],
    "processing_steps": [
      "- Fetch Gmail messages from Inbox for the last 7 days.",
      "- Load existing rows from the \"UrgentEmails\" tab and build a set of existing Gmail message link/id values.",
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

async function runComplaintLoggerWorkflow() {
  console.log('='.repeat(100))
  console.log('CUSTOMER COMPLAINT EMAIL LOGGER - FULL E2E WORKFLOW')
  console.log('='.repeat(100))
  console.log()

  const orchestrator = new V6PipelineOrchestrator()

  const result = await orchestrator.run(complaintLoggerPrompt, {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    temperature: 0.3,
    anthropic_api_key: process.env.ANTHROPIC_API_KEY
  })

  if (!result.success) {
    console.log('❌ WORKFLOW GENERATION FAILED')
    console.log()
    console.log(`Failed at: ${result.error?.phase}`)
    console.log(`Error: ${result.error?.message}`)
    process.exit(1)
  }

  console.log('✅ WORKFLOW GENERATED SUCCESSFULLY')
  console.log()

  // Display hard requirements
  console.log('='.repeat(100))
  console.log('HARD REQUIREMENTS EXTRACTED')
  console.log('='.repeat(100))
  console.log()
  console.log(`Total Requirements: ${result.hardRequirements?.requirements.length}`)
  console.log(`Unit of Work: ${result.hardRequirements?.unit_of_work}`)
  console.log()

  result.hardRequirements?.requirements.forEach((req, idx) => {
    console.log(`${idx + 1}. [${req.type}] ${req.constraint}`)
  })
  console.log()

  // Display validation gates results
  console.log('='.repeat(100))
  console.log('VALIDATION GATES STATUS')
  console.log('='.repeat(100))
  console.log()
  console.log(`✅ Gate 1 (Semantic Plan): ${result.validationResults?.semantic.result}`)
  console.log(`✅ Gate 2 (Grounding): ${result.validationResults?.grounding.result}`)
  console.log(`✅ Gate 3 (IR): ${result.validationResults?.ir.result}`)
  console.log(`✅ Gate 4 (Compilation): ${result.validationResults?.compilation.result}`)
  console.log(`✅ Gate 5 (Final): ${result.validationResults?.final.result}`)
  console.log()

  // Display requirement map tracking
  if (result.requirementMap) {
    const statuses = Object.values(result.requirementMap).reduce((acc: any, mapping: any) => {
      acc[mapping.status] = (acc[mapping.status] || 0) + 1
      return acc
    }, {})
    console.log('Requirement Status Tracking:')
    Object.entries(statuses).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`)
    })
    console.log()
  }

  // Display workflow steps
  console.log('='.repeat(100))
  console.log('COMPLETE WORKFLOW STEPS')
  console.log('='.repeat(100))
  console.log()

  const workflow = result.workflow?.steps || []
  console.log(`Total Steps: ${workflow.length}`)
  console.log()

  workflow.forEach((step: any, idx: number) => {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`STEP ${idx + 1}: ${step.step_id}`)
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log()
    console.log(`Type: ${step.type.toUpperCase()}`)
    console.log(`Description: ${step.description || 'N/A'}`)
    console.log()

    if (step.plugin) {
      console.log(`Plugin: ${step.plugin}`)
    }

    if (step.operation) {
      console.log(`Operation: ${step.operation}`)
    }

    if (step.config) {
      console.log(`Configuration:`)
      Object.entries(step.config).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          console.log(`  ${key}:`)
          console.log(`    ${JSON.stringify(value, null, 2).split('\n').join('\n    ')}`)
        } else {
          console.log(`  ${key}: ${value}`)
        }
      })
    }

    if (step.output_variable) {
      console.log(`Output Variable: ${step.output_variable}`)
    }

    if (step.type === 'scatter_gather' && step.scatter) {
      console.log()
      console.log(`Scatter/Gather Loop:`)
      console.log(`  Input Array: ${step.scatter.input}`)
      console.log(`  Item Variable: ${step.scatter.itemVariable}`)
      console.log(`  Nested Steps: ${step.scatter.steps.length}`)
      console.log()

      step.scatter.steps.forEach((nestedStep: any, nestedIdx: number) => {
        console.log(`  ┌─ Nested Step ${nestedIdx + 1}: ${nestedStep.step_id}`)
        console.log(`  │  Type: ${nestedStep.type}`)
        console.log(`  │  Description: ${nestedStep.description || 'N/A'}`)

        if (nestedStep.type === 'conditional' && nestedStep.condition) {
          console.log(`  │  Condition:`)
          console.log(`  │    ${JSON.stringify(nestedStep.condition, null, 2).split('\n').join('\n  │    ')}`)
          console.log(`  │  Then Steps: ${nestedStep.steps?.length || 0}`)

          if (nestedStep.steps) {
            nestedStep.steps.forEach((thenStep: any, thenIdx: number) => {
              console.log(`  │    ├─ Then Step ${thenIdx + 1}: ${thenStep.step_id}`)
              console.log(`  │    │  Type: ${thenStep.type}`)
              console.log(`  │    │  Description: ${thenStep.description || 'N/A'}`)
            })
          }
        }

        console.log(`  └─`)
      })
    }

    if (step.type === 'conditional' && step.condition) {
      console.log()
      console.log(`Condition:`)
      console.log(`  ${JSON.stringify(step.condition, null, 2).split('\n').join('\n  ')}`)
      console.log()
      if (step.steps) {
        console.log(`Then Steps: ${step.steps.length}`)
      }
    }

    console.log()
  })

  // Display full JSON
  console.log('='.repeat(100))
  console.log('FULL WORKFLOW JSON')
  console.log('='.repeat(100))
  console.log()
  console.log(JSON.stringify(result.workflow, null, 2))
  console.log()

  console.log('='.repeat(100))
  console.log('WORKFLOW READY FOR EXECUTION')
  console.log('='.repeat(100))
  console.log()

  return { success: true }
}

runComplaintLoggerWorkflow()
  .then(result => {
    if (result && result.success) {
      process.exit(0)
    } else {
      process.exit(1)
    }
  })
  .catch(err => {
    console.error('❌ Test failed:', err)
    process.exit(1)
  })
