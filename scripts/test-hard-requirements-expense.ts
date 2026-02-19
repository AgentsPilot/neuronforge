/**
 * Test script for HardRequirementsExtractor
 * Testing with: Gmail Expense Attachment Extractor workflow
 */

import { HardRequirementsExtractor } from '../lib/agentkit/v6/requirements/HardRequirementsExtractor'

// Test Enhanced Prompt - Gmail Expense Attachment Extractor
const testEnhancedPrompt = {
  plan_title: 'Gmail Expense Attachment Extractor (Email Table Output)',
  plan_description: "This agent searches Gmail for expense-related emails, reads PDF receipt attachments, extracts expense details into a combined table, and emails you a short summary with the table embedded in the email body.",
  sections: {
    data: [
      "- Search Gmail for emails from the last 7 days where the subject contains the keyword 'expenses' OR the keyword 'receipt'.",
      "- From each matching email, collect all PDF attachments.",
      "- For each PDF attachment, capture basic context needed for traceability (email subject and attachment file name) for internal processing, even though the final table will only include the 4 requested columns."
    ],
    actions: [
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
    output: [
      "- Generate a combined table (embedded in the email body) with exactly these columns in this order: date&time, vendor, amount, expense type.",
      "- Ensure any uncertain or missing field values are explicitly set to the literal text 'need review' in the relevant cell."
    ],
    delivery: [
      "- Send an email to offir.omer@gmail.com that includes a short summary (for example: number of emails scanned, number of PDFs processed, number of expense rows extracted, number of rows marked 'need review').",
      "- In the same email, embed the combined expense table in the email body (not as a separate file attachment)."
    ],
    processing_steps: [
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
  specifics: {
    services_involved: [
      'google-mail',
      'chatgpt-research'
    ],
    user_inputs_required: [],
    resolved_user_inputs: [
      {
        key: 'user_email',
        value: 'offir.omer@gmail.com'
      },
      {
        key: 'gmail_lookback_window',
        value: 'last 7 days'
      },
      {
        key: 'gmail_subject_keywords',
        value: 'expenses, receipt'
      },
      {
        key: 'attachment_types',
        value: 'PDF'
      },
      {
        key: 'row_granularity',
        value: 'multiple rows (line items when present)'
      },
      {
        key: 'expense_type_method',
        value: 'infer from receipt text'
      },
      {
        key: 'uncertain_field_behavior',
        value: "set to 'need review'"
      },
      {
        key: 'output_destination',
        value: 'email body table'
      },
      {
        key: 'table_scope',
        value: 'combined table for all expenses'
      },
      {
        key: 'notification_style',
        value: 'email me a short summary'
      }
    ]
  }
}

console.log('=' .repeat(80))
console.log('HARD REQUIREMENTS EXTRACTION TEST - Gmail Expense Attachment Extractor')
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

console.log('Expected for Gmail Expense Attachment Extractor:')
console.log('  ✓ Unit of Work: attachment (processing PDF attachments)')
console.log('  ✓ Thresholds: 0 (no numeric thresholds)')
console.log('  ✓ Routing Rules: 0 (no conditional routing)')
console.log('  ✓ Invariants: 1 (data availability)')
console.log('  ✓ Required Outputs: 0 (no specific link/url requirements)')
console.log('  ✓ Side Effect Constraints: 0 (no conditional actions)')
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
  routing_rules: hardReqs.routing_rules.length === 0,
  invariants: hardReqs.invariants.length >= 1,
  required_outputs: hardReqs.required_outputs.length === 0,
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
  }
  if (!checks.invariants) {
    console.log(`  - Invariants: Expected at least 1 but got ${hardReqs.invariants.length}`)
  }
  if (!checks.required_outputs) {
    console.log(`  - Required Outputs: Expected 0 but got ${hardReqs.required_outputs.length}`)
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
console.log('  • Unit of work: attachment (PDF receipts)')
console.log('  • Multiple rows per attachment (line items)')
console.log('  • Uncertain values marked as "need review"')
console.log('  • Combined table for all expenses')
console.log('  • No thresholds or conditional logic')
console.log()
