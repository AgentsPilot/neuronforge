import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { SemanticPlanGenerator } from '../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'
import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer'
import { DeclarativeCompiler } from '../lib/agentkit/v6/compiler/DeclarativeCompiler'

const testEnhancedPrompt = {
  "plan_title": "Expense & Invoice Email Scanner (Drive + Sheet Threshold)",
  "plan_description": "Scans Gmail for PDF attachments matching your query in the last 24 hours, extracts invoice/expense fields, stores each PDF in Google Drive (per-vendor folder under a base folder), emails a single digest summary, and appends rows to a Google Sheet only when the amount is greater than 50 in the document's currency.",
  "sections": {
    "data": ["- Search Gmail using this exact Gmail search query: \"subject include: Invoice or Expenses or Bill and has:attachment filename:pdf\".", "- Limit the scan to emails from the last 24 hours.", "- Consider only emails that contain PDF attachments.", "- For each matching email, collect the email metadata needed for traceability: sender, subject, received date, message id.", "- For each PDF attachment, capture the attachment filename and the attachment content for extraction."],
    "output": ["- Produce a single digest email that contains a table.", "- The digest email table must include these columns: Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link.", "- If no matching items are found in the last 24 hours, send a digest email stating that no invoices/expenses were found."],
    "actions": ["- For each PDF attachment found, extract these fields: Type (expense or invoice), Vendor / merchant, Date, Amount, Invoice/receipt #, Category.", "- Normalize the extracted Amount into a numeric value for comparison.", "- If the agent cannot confidently find an Amount, still include the item in the digest email and still store the attachment in Google Drive, and do not append anything to Google Sheets.", "- Use this Google Drive base folder as the parent location for storage: \"https://drive.google.com/drive/folders/1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-?usp=drive_link\".", "- Create (or reuse) a Google Drive subfolder named exactly as the extracted Vendor / merchant under the base folder.", "- Store the original PDF attachment in the vendor's Google Drive subfolder.", "- Generate a shareable Google Drive link for the stored attachment and include it in outputs.", "- Build a digest table row for each extracted item with: Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link.", "- If the extracted Amount is greater than 50 in the document's currency, append a row to Google Sheet id \"1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE\" using the same columns as the digest table: Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link.", "- If the extracted Amount is not greater than 50 in the document's currency, do not append a row to Google Sheets."],
    "delivery": ["- Send the digest email to meiribarak@gmail.com."],
    "processing_steps": ["- Run the Gmail search query over the last 24 hours.", "- Filter results to emails with PDF attachments.", "- For each PDF attachment, extract fields and determine the vendor folder name.", "- Store the PDF in Google Drive under the base folder and capture the Drive link.", "- Build the digest table and apply the > 50 (document currency) rule for Google Sheets insertion.", "- Send the digest email."]
  },
  "specifics": {"services_involved": ["google-mail", "google-drive", "google-sheets", "chatgpt-research"], "resolved_user_inputs": [{"key": "user_email", "value": "meiribarak@gmail.com"}, {"key": "gmail_search_query", "value": "subject include: Invoice or Expenses or Bill and has:attachment filename:pdf"}, {"key": "scan_time_window", "value": "last 24 hours"}, {"key": "drive_base_folder_url", "value": "https://drive.google.com/drive/folders/1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-?usp=drive_link"}, {"key": "sheet_id", "value": "1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE"}, {"key": "candidate_sheet_tab_names", "value": "Invoices, Expenses"}, {"key": "attachment_type_filter", "value": "PDF attachments"}, {"key": "summary_delivery_style", "value": "single digest email"}, {"key": "summary_columns", "value": "Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link"}, {"key": "drive_storage_rule", "value": "attachments only; create a folder per vendor and store the attachment in it"}, {"key": "sheet_write_rule", "value": "append only if amount is greater than 50 in the document currency"}, {"key": "missing_amount_handling", "value": "email + store; skip Sheet"}], "user_inputs_required": ["Which Google Sheet tab name to append rows into (choose one: Invoices or Expenses)"]}
}

async function testPhase4Compilation() {
  console.log('='.repeat(80))
  console.log('PHASE 4 COMPILATION TEST - CHECKING DEPENDENCY HANDLING')
  console.log('='.repeat(80))
  console.log()

  // Phase 1-3: Generate IR with correct dependencies
  console.log('Phase 1-3: Generating IR with {{step_result.*}} references...')

  const semanticGenerator = new SemanticPlanGenerator({
    model_provider: 'anthropic',
    model_name: 'claude-opus-4-5-20251101',
    temperature: 0.3
  })
  const semanticResult = await semanticGenerator.generate(testEnhancedPrompt)

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

  const formalizer = new IRFormalizer({
    model: 'gpt-5.2',
    temperature: 0.0,
    openai_api_key: process.env.OPENAI_API_KEY
  })
  const irResult = await formalizer.formalize(groundedPlan)

  console.log('✅ IR Generated with dependencies:')
  irResult.ir.delivery_rules?.multiple_destinations?.forEach((dest, idx) => {
    const configStr = JSON.stringify(dest.config || {})
    const hasRefs = configStr.includes('{{step_result.')
    console.log(`  ${idx + 1}. ${dest.operation_type}: ${hasRefs ? '✅ Has {{step_result.*}}' : '❌ No refs'}`)
  })
  console.log()

  // Phase 4: Compile
  console.log('Phase 4: Compiling IR to DSL...')
  const compiler = new DeclarativeCompiler()
  const workflow = compiler.compile(irResult.ir, {
    user_id: 'test-user',
    agent_id: 'test-agent',
    pilot_id: 'test-pilot'
  })

  console.log('✅ Workflow Compiled')
  console.log()

  // Find the delivery step(s)
  console.log('='.repeat(80))
  console.log('ANALYZING COMPILED DELIVERY STEPS')
  console.log('='.repeat(80))
  console.log()

  const deliverySteps = workflow.steps.filter(step =>
    step.type === 'parallel' ||
    (step.action && (step.action.includes('create_folder') || step.action.includes('upload') || step.action.includes('share')))
  )

  deliverySteps.forEach((step, idx) => {
    console.log(`--- Step ${step.id} ---`)
    console.log(`Type: ${step.type}`)
    console.log(`Action: ${step.action || 'N/A'}`)

    if (step.type === 'parallel' && step.steps) {
      console.log(`Parallel block with ${step.steps.length} steps:`)
      step.steps.forEach((substep: any, i: number) => {
        console.log(`  ${i + 1}. ${substep.action || substep.operation}`)
        const paramsStr = JSON.stringify(substep.params || {})
        const hasRefs = paramsStr.includes('{{step_result.') || /\{\{step\d+\./.test(paramsStr)
        console.log(`     Params: ${Object.keys(substep.params || {}).length} keys, Has refs: ${hasRefs ? '✅' : '❌'}`)
        if (hasRefs) {
          const refs = paramsStr.match(/\{\{step[^}]+\}\}/g) || []
          console.log(`     References: ${refs.join(', ')}`)
        }
      })
    } else if (step.params) {
      const paramsStr = JSON.stringify(step.params || {})
      const hasRefs = paramsStr.includes('{{step_result.') || /\{\{step\d+\./.test(paramsStr)
      console.log(`Params: ${Object.keys(step.params).length} keys, Has refs: ${hasRefs ? '✅' : '❌'}`)
      if (hasRefs) {
        const refs = paramsStr.match(/\{\{step[^}]+\}\}/g) || []
        console.log(`References: ${refs.join(', ')}`)
      } else {
        console.log(`⚠️  No dependency markers in params`)
        console.log(`Params content: ${JSON.stringify(step.params, null, 2)}`)
      }
    }
    console.log()
  })

  // Save full workflow
  console.log('='.repeat(80))
  console.log('FULL WORKFLOW JSON')
  console.log('='.repeat(80))
  console.log()
  console.log(JSON.stringify(workflow.steps, null, 2))
}

testPhase4Compilation().catch(console.error)
