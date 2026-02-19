/**
 * Test script for HardRequirementsExtractor
 * Testing with: Expense & Invoice Intake Agent workflow
 */

import { HardRequirementsExtractor } from '../lib/agentkit/v6/requirements/HardRequirementsExtractor'

// Test Enhanced Prompt - Expense & Invoice Intake
const testEnhancedPrompt = {
  plan_title: 'Expense & Invoice Intake Agent (Gmail → Drive + Sheets + Email Summary)',
  plan_description: "Scans Gmail using a fixed search query to find invoice/receipt emails with attachments, extracts basic fields, stores attachments in Google Drive organized by vendor, appends rows to a Google Sheet (Invoices vs Expenses tabs), and emails a summary to you. Items with missing amounts are included in the summary only.",
  sections: {
    data: [
      '- Search Gmail using the query: "subject:(invoice OR receipt OR bill) has:attachment".',
      '- For each matched email, use the email metadata (subject, sender, date) and attachment files as the source content.',
      '- Extract the following basic fields for each detected item: date, vendor, amount, currency.',
      '- Capture the Google Drive link of each stored attachment file.',
      '- Use the Google Drive folder ID "1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-" as the main storage folder.',
      '- Use the extracted vendor name to determine the vendor subfolder name under the main Drive folder.',
      '- Use Google Sheet ID "1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE" as the destination spreadsheet.',
      '- Use the tab name "Invoices" for items classified as invoices.',
      '- Use the tab name "Expenses" for items classified as expenses.'
    ],
    actions: [
      '- For each matched email, classify the item as either an invoice or an expense based on the email subject/body and attachment filename/content cues (for example: the presence of the word "invoice" vs "receipt").',
      '- For each classified item, extract: date, vendor, amount, currency.',
      '- If the email has one or more attachments, store each attachment in Google Drive under: main folder (ID: 1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-) / vendor subfolder.',
      '- If the email has multiple attachments, treat each attachment as a separate stored file and create a separate summary line item per attachment.',
      '- Build a summary line item for each stored file that includes: date, vendor, amount, currency, and the Google Drive link to the stored file.',
      '- If an amount is found (regardless of currency), append a new row to the Google Sheet (ID: 1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE) in the "Invoices" tab when classified as invoice.',
      '- If an amount is found (regardless of currency), append a new row to the Google Sheet (ID: 1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE) in the "Expenses" tab when classified as expense.',
      '- When appending a row, write the columns in this order: Date, Vendor, Amount, Currency, Drive Link.',
      '- If the agent cannot confidently extract the amount (or key fields), include the item in the email summary only and do not append it to Google Sheets.'
    ],
    output: [
      '- Produce an email-friendly summary that lists each detected invoice/expense as a separate line item.',
      '- For each line item, include: date, vendor, amount, currency, and a Google Drive link.',
      '- Produce a structured Google Sheets row payload with: Date, Vendor, Amount, Currency, Drive Link.',
      '- Produce a separate section in the email summary titled "Needs review (not added to Google Sheets)" for items where the amount (or key fields) could not be extracted.'
    ],
    delivery: [
      '- Send the summary email to meiribarak@gmail.com.',
      '- In the email, include two sections: "Invoices" and "Expenses" (based on the classification).',
      '- In the email, include a third section: "Needs review (not added to Google Sheets)".'
    ],
    processing_steps: [
      '- Run the Gmail search query to collect candidate emails.',
      '- For each candidate email, classify it as invoice vs expense.',
      '- Extract basic fields from the email and attachments.',
      '- Store attachments in Google Drive under the vendor subfolder.',
      '- Append a row to the correct Google Sheet tab (Invoices or Expenses) when an amount is found.',
      '- Build the final email summary with three sections (Invoices, Expenses, Needs review).',
      '- Send the summary email to the user.'
    ]
  },
  specifics: {
    services_involved: [
      'google-mail',
      'google-drive',
      'google-sheets',
      'chatgpt-research'
    ],
    user_inputs_required: [],
    resolved_user_inputs: [
      {
        key: 'user_email',
        value: 'offir.omer@gmail.com'
      },
      {
        key: 'gmail_search_query',
        value: 'subject:(invoice OR receipt OR bill) has:attachment'
      },
      {
        key: 'drive_main_folder_url',
        value: 'https://drive.google.com/drive/folders/1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-?usp=drive_link'
      },
      {
        key: 'drive_main_folder_id',
        value: '1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-'
      },
      {
        key: 'google_sheet_id',
        value: '1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE'
      },
      {
        key: 'google_sheet_tab_invoices',
        value: 'Invoices'
      },
      {
        key: 'google_sheet_tab_expenses',
        value: 'Expenses'
      },
      {
        key: 'extraction_field_set',
        value: 'basic'
      },
      {
        key: 'currency_rule_for_sheet_append',
        value: 'always_add_if_amount_present'
      },
      {
        key: 'missing_amount_behavior',
        value: 'summary_only'
      }
    ]
  }
}

console.log('=' .repeat(80))
console.log('HARD REQUIREMENTS EXTRACTION TEST - Invoice/Expense Intake Agent')
console.log('=' .repeat(80))
console.log()

console.log('Input Enhanced Prompt:')
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
    console.log(`  Action: ${c.action.substring(0, 100)}${c.action.length > 100 ? '...' : ''}`)
    console.log(`  Allowed when: ${c.allowed_when}`)
    console.log(`  Forbidden when: ${c.forbidden_when}`)
    console.log()
  })
}

console.log('=' .repeat(80))
console.log('EXPECTED vs ACTUAL (Analysis)')
console.log('=' .repeat(80))
console.log()

console.log('Expected for Invoice/Expense Intake:')
console.log('  ✓ Unit of Work: attachment (email attachments)')
console.log('  ✓ Thresholds: 0 (no numeric thresholds)')
console.log('  ✓ Routing Rules: 0 (invoice→Invoices, expense→Expenses - NOT arrow notation)')
console.log('  ✓ Invariants: 1 (data availability only - no explicit "create folder" text)')
console.log('  ✓ Required Outputs: 1 (drive_link)')
console.log('  ✓ Side Effect Constraints: 0 (no conditional actions - "if amount found" is not a threshold)')
console.log()

console.log('Actual:')
console.log(`  Unit of Work: ${hardReqs.unit_of_work}`)
console.log(`  Thresholds: ${hardReqs.thresholds.length}`)
console.log(`  Routing Rules: ${hardReqs.routing_rules.length}`)
console.log(`  Invariants: ${hardReqs.invariants.length}`)
console.log(`  Required Outputs: ${hardReqs.required_outputs.length}`)
console.log(`  Side Effect Constraints: ${hardReqs.side_effect_constraints.length}`)
console.log()

// Analysis
const checks = {
  unit_of_work: hardReqs.unit_of_work === 'attachment',
  thresholds: hardReqs.thresholds.length === 0,
  routing_rules: hardReqs.routing_rules.length === 0, // "invoice" → "Invoices" uses different pattern
  invariants: hardReqs.invariants.length === 1, // Only data availability (no explicit "create folder")
  required_outputs: hardReqs.required_outputs.length >= 1,
  side_effect_constraints: hardReqs.side_effect_constraints.length === 0
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
  console.log('⚠️  SOME CHECKS FAILED')
  console.log()
  console.log('Issues found:')
  if (!checks.unit_of_work) {
    console.log(`  - Unit of work: Expected "attachment" but got "${hardReqs.unit_of_work}"`)
  }
  if (!checks.thresholds) {
    console.log(`  - Thresholds: Expected 0 but got ${hardReqs.thresholds.length}`)
  }
  if (!checks.routing_rules) {
    console.log(`  - Routing Rules: Expected 0 but got ${hardReqs.routing_rules.length}`)
    console.log(`    Note: Classification-based routing (invoice→Invoices) uses different pattern`)
  }
  if (!checks.invariants) {
    console.log(`  - Invariants: Expected at least 2 but got ${hardReqs.invariants.length}`)
  }
  if (!checks.required_outputs) {
    console.log(`  - Required Outputs: Expected at least 1 but got ${hardReqs.required_outputs.length}`)
  }
  if (!checks.side_effect_constraints) {
    console.log(`  - Side Effect Constraints: Expected 0 but got ${hardReqs.side_effect_constraints.length}`)
  }
}
console.log()

console.log('=' .repeat(80))
console.log('NOTES')
console.log('=' .repeat(80))
console.log()
console.log('Key Characteristics:')
console.log('  • Unit of work: attachment (Gmail attachments)')
console.log('  • Classification-based routing: invoice→Invoices tab, expense→Expenses tab')
console.log('  • Conditional append: Only if amount found (not a numeric threshold)')
console.log('  • Sequential dependencies: Create vendor folder → Upload file → Capture link')
console.log('  • Drive link required in output')
console.log()
console.log('Routing Pattern Analysis:')
console.log('  • Current pattern: /(invoice|expense|bill)\\s*→\\s*(\\w+)/')
console.log('  • This workflow uses: "classify as invoice" → append to "Invoices" tab')
console.log('  • No explicit arrow (→) notation in text')
console.log('  • Routing is implicit through classification, not explicit in actions')
console.log()
