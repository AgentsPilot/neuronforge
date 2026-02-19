/**
 * Test script for HardRequirementsExtractor
 * Focus on Phase 0/1 - verifying requirements extraction is working correctly
 */

import { HardRequirementsExtractor } from '../lib/agentkit/v6/requirements/HardRequirementsExtractor'

// Test Enhanced Prompt from user - Invoice/Expense workflow
const testEnhancedPrompt = {
  plan_title: 'Expense & Invoice Email Scanner (Drive + Sheet Threshold)',
  plan_description: "Scans Gmail for PDF attachments matching your query in the last 24 hours, extracts invoice/expense fields, stores each PDF in Google Drive (per-vendor folder under a base folder), emails a single digest summary, and appends rows to a Google Sheet only when the amount is greater than 50 in the document's currency.",
  sections: {
    data: [
      '- Search Gmail using this exact Gmail search query: "subject include: Invoice or Expenses or Bill and has:attachment filename:pdf".',
      '- Limit the scan to emails from the last 24 hours.',
      '- Consider only emails that contain PDF attachments.',
      '- For each matching email, collect the email metadata needed for traceability: sender, subject, received date, message id.',
      '- For each PDF attachment, capture the attachment filename and the attachment content for extraction.'
    ],
    output: [
      '- Produce a single digest email that contains a table.',
      '- The digest email table must include these columns: Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link.',
      '- If no matching items are found in the last 24 hours, send a digest email stating that no invoices/expenses were found.'
    ],
    actions: [
      '- For each PDF attachment found, extract these fields: Type (expense or invoice), Vendor / merchant, Date, Amount, Invoice/receipt #, Category.',
      '- Normalize the extracted Amount into a numeric value for comparison.',
      '- If the agent cannot confidently find an Amount, still include the item in the digest email and still store the attachment in Google Drive, and do not append anything to Google Sheets.',
      '- Use this Google Drive base folder as the parent location for storage: "https://drive.google.com/drive/folders/1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-?usp=drive_link".',
      '- Create (or reuse) a Google Drive subfolder named exactly as the extracted Vendor / merchant under the base folder.',
      '- Store the original PDF attachment in the vendor\'s Google Drive subfolder.',
      '- Generate a shareable Google Drive link for the stored attachment and include it in outputs.',
      '- Build a digest table row for each extracted item with: Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link.',
      '- If the extracted Amount is greater than 50 in the document\'s currency, append a row to Google Sheet id "1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE" using the same columns as the digest table: Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link.',
      '- If the extracted Amount is not greater than 50 in the document\'s currency, do not append a row to Google Sheets.'
    ],
    delivery: [
      '- Send the digest email to meiribarak@gmail.com.'
    ],
    processing_steps: [
      '- Run the Gmail search query over the last 24 hours.',
      '- Filter results to emails with PDF attachments.',
      '- For each PDF attachment, extract fields and determine the vendor folder name.',
      '- Store the PDF in Google Drive under the base folder and capture the Drive link.',
      '- Build the digest table and apply the > 50 (document currency) rule for Google Sheets insertion.',
      '- Send the digest email.'
    ]
  },
  specifics: {
    services_involved: [
      'google-mail',
      'google-drive',
      'google-sheets',
      'chatgpt-research'
    ],
    resolved_user_inputs: [
      {
        key: 'user_email',
        value: 'meiribarak@gmail.com'
      },
      {
        key: 'gmail_search_query',
        value: 'subject include: Invoice or Expenses or Bill and has:attachment filename:pdf'
      },
      {
        key: 'scan_time_window',
        value: 'last 24 hours'
      },
      {
        key: 'drive_base_folder_url',
        value: 'https://drive.google.com/drive/folders/1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-?usp=drive_link'
      },
      {
        key: 'sheet_id',
        value: '1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE'
      },
      {
        key: 'candidate_sheet_tab_names',
        value: 'Invoices, Expenses'
      },
      {
        key: 'attachment_type_filter',
        value: 'PDF attachments'
      },
      {
        key: 'summary_delivery_style',
        value: 'single digest email'
      },
      {
        key: 'summary_columns',
        value: 'Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link'
      },
      {
        key: 'drive_storage_rule',
        value: 'attachments only; create a folder per vendor and store the attachment in it'
      },
      {
        key: 'sheet_write_rule',
        value: 'append only if amount is greater than 50 in the document currency'
      },
      {
        key: 'missing_amount_handling',
        value: 'email + store; skip Sheet'
      }
    ],
    user_inputs_required: [
      'Which Google Sheet tab name to append rows into (choose one: Invoices or Expenses)'
    ]
  }
}

console.log('=' .repeat(80))
console.log('HARD REQUIREMENTS EXTRACTION TEST')
console.log('=' .repeat(80))
console.log()

console.log('Input Enhanced Prompt: Invoice/Expense workflow')
console.log(`Title: ${testEnhancedPrompt.plan_title}`)
console.log()

const extractor = new HardRequirementsExtractor()
const hardReqs = extractor.extract(testEnhancedPrompt)

console.log('=' .repeat(80))
console.log('EXTRACTION RESULTS')
console.log('=' .repeat(80))
console.log()

console.log('📊 Summary:')
console.log(`  Total Requirements: ${hardReqs.requirements.length}`)
console.log(`  Unit of Work: ${hardReqs.unit_of_work || 'NOT DETECTED'}`)
console.log(`  Thresholds: ${hardReqs.thresholds.length}`)
console.log(`  Routing Rules: ${hardReqs.routing_rules.length}`)
console.log(`  Invariants: ${hardReqs.invariants.length}`)
console.log(`  Empty Behavior: ${hardReqs.empty_behavior || 'NOT SPECIFIED'}`)
console.log(`  Required Outputs: ${hardReqs.required_outputs.length}`)
console.log(`  Side Effect Constraints: ${hardReqs.side_effect_constraints.length}`)
console.log()

console.log('=' .repeat(80))
console.log('DETAILED REQUIREMENTS')
console.log('=' .repeat(80))
console.log()

hardReqs.requirements.forEach(req => {
  console.log(`${req.id}: [${req.type}]`)
  console.log(`  Constraint: ${req.constraint}`)
  console.log(`  Source: ${req.source}`)
  console.log()
})

if (hardReqs.thresholds.length > 0) {
  console.log('=' .repeat(80))
  console.log('THRESHOLDS')
  console.log('=' .repeat(80))
  console.log()
  hardReqs.thresholds.forEach(t => {
    console.log(`  ${t.field} ${t.operator} ${t.value}`)
    console.log(`  Applies to: ${t.applies_to.join(', ') || 'NOT SPECIFIED'}`)
    console.log()
  })
}

if (hardReqs.routing_rules.length > 0) {
  console.log('=' .repeat(80))
  console.log('ROUTING RULES')
  console.log('=' .repeat(80))
  console.log()
  hardReqs.routing_rules.forEach(r => {
    console.log(`  ${r.condition} → ${r.destination}`)
    console.log()
  })
}

if (hardReqs.invariants.length > 0) {
  console.log('=' .repeat(80))
  console.log('INVARIANTS')
  console.log('=' .repeat(80))
  console.log()
  hardReqs.invariants.forEach(inv => {
    console.log(`  [${inv.type}]`)
    console.log(`  Description: ${inv.description}`)
    console.log(`  Check: ${inv.check}`)
    console.log()
  })
}

if (hardReqs.required_outputs.length > 0) {
  console.log('=' .repeat(80))
  console.log('REQUIRED OUTPUTS')
  console.log('=' .repeat(80))
  console.log()
  hardReqs.required_outputs.forEach(output => {
    console.log(`  - ${output}`)
  })
  console.log()
}

if (hardReqs.side_effect_constraints.length > 0) {
  console.log('=' .repeat(80))
  console.log('SIDE EFFECT CONSTRAINTS')
  console.log('=' .repeat(80))
  console.log()
  hardReqs.side_effect_constraints.forEach(c => {
    console.log(`  Action: ${c.action}`)
    console.log(`  Allowed when: ${c.allowed_when}`)
    console.log(`  Forbidden when: ${c.forbidden_when}`)
    console.log()
  })
}

console.log('=' .repeat(80))
console.log('EXPECTED vs ACTUAL')
console.log('=' .repeat(80))
console.log()

const expected = {
  unit_of_work: 'attachment',
  thresholds: 1, // amount > 50
  routing_rules: 0,
  invariants: 2, // sequential_dependency (create_folder → upload_file) + data_availability (delivery after processing)
  required_outputs: 1, // drive_link
  empty_behavior: null, // specified: "send email stating no items found"
  side_effect_constraints: 1 // append to sheets ONLY if amount > 50
}

console.log('Expected:')
console.log(`  Unit of Work: ${expected.unit_of_work}`)
console.log(`  Thresholds: ${expected.thresholds} (amount > 50)`)
console.log(`  Invariants: ${expected.invariants} (create_folder → upload_file + data_availability)`)
console.log(`  Required Outputs: ${expected.required_outputs} (drive_link)`)
console.log(`  Side Effect Constraints: ${expected.side_effect_constraints} (append to sheets IFF amount > 50)`)
console.log()

console.log('Actual:')
console.log(`  Unit of Work: ${hardReqs.unit_of_work}`)
console.log(`  Thresholds: ${hardReqs.thresholds.length}`)
console.log(`  Invariants: ${hardReqs.invariants.length}`)
console.log(`  Required Outputs: ${hardReqs.required_outputs.length}`)
console.log(`  Side Effect Constraints: ${hardReqs.side_effect_constraints.length}`)
console.log()

// Check correctness
const checks = {
  unit_of_work: hardReqs.unit_of_work === expected.unit_of_work,
  thresholds: hardReqs.thresholds.length === expected.thresholds,
  invariants: hardReqs.invariants.length === expected.invariants,
  required_outputs: hardReqs.required_outputs.length === expected.required_outputs,
  side_effect_constraints: hardReqs.side_effect_constraints.length === expected.side_effect_constraints
}

console.log('=' .repeat(80))
console.log('VALIDATION')
console.log('=' .repeat(80))
console.log()

Object.entries(checks).forEach(([key, passed]) => {
  const icon = passed ? '✅' : '❌'
  console.log(`${icon} ${key}: ${passed ? 'PASS' : 'FAIL'}`)
})
console.log()

const allPassed = Object.values(checks).every(v => v)
if (allPassed) {
  console.log('🎉 ALL CHECKS PASSED')
} else {
  console.log('⚠️  SOME CHECKS FAILED - Need to fix HardRequirementsExtractor')
  console.log()
  console.log('Issues to fix:')
  if (!checks.unit_of_work) {
    console.log(`  - Unit of work: Expected "${expected.unit_of_work}" but got "${hardReqs.unit_of_work}"`)
  }
  if (!checks.thresholds) {
    console.log(`  - Thresholds: Expected ${expected.thresholds} but got ${hardReqs.thresholds.length}`)
    console.log(`    Missing: "amount > 50" constraint`)
  }
  if (!checks.invariants) {
    console.log(`  - Invariants: Expected ${expected.invariants} but got ${hardReqs.invariants.length}`)
  }
  if (!checks.required_outputs) {
    console.log(`  - Required Outputs: Expected ${expected.required_outputs} but got ${hardReqs.required_outputs.length}`)
    console.log(`    Missing: "drive_link" field`)
  }
  if (!checks.side_effect_constraints) {
    console.log(`  - Side Effect Constraints: Expected ${expected.side_effect_constraints} but got ${hardReqs.side_effect_constraints.length}`)
    console.log(`    Missing: "append to sheets ONLY if amount > 50"`)
  }
}
console.log()
