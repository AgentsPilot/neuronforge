/**
 * Gmail Expense Attachment Extractor Test
 * Run V6PipelineOrchestrator with expense extraction enhanced prompt
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { V6PipelineOrchestrator } from '../lib/agentkit/v6/pipeline/V6PipelineOrchestrator'

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

async function runExpenseExtractorWorkflow() {
  console.log('='.repeat(100))
  console.log('GMAIL EXPENSE ATTACHMENT EXTRACTOR - FULL E2E WORKFLOW')
  console.log('='.repeat(100))
  console.log()

  const orchestrator = new V6PipelineOrchestrator()

  const result = await orchestrator.run(expenseExtractorPrompt, {
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

  // Check for auto-fixed operations
  console.log('='.repeat(100))
  console.log('PLUGIN OPERATION AUTO-FIXES')
  console.log('='.repeat(100))
  console.log()
  console.log('(Check logs above for "[Gate 3] ⚠ Auto-fixed" messages)')
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
          console.log(`    ${JSON.stringify(value, null, 2).split('\\n').join('\\n    ')}`)
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
          console.log(`  │    ${JSON.stringify(nestedStep.condition, null, 2).split('\\n').join('\\n  │    ')}`)
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
      console.log(`  ${JSON.stringify(step.condition, null, 2).split('\\n').join('\\n  ')}`)
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

runExpenseExtractorWorkflow()
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
