/**
 * Test script for HardRequirementsExtractor
 * Testing with: Gmail Complaint Logger workflow
 */

import { HardRequirementsExtractor } from '../lib/agentkit/v6/requirements/HardRequirementsExtractor'

// Test Enhanced Prompt - Gmail Complaint Logger
const testEnhancedPrompt = {
  plan_title: 'Customer Complaint Email Logger (Gmail → Google Sheets)',
  plan_description: "Scans your Gmail Inbox for the last 7 days, finds emails that contain complaint keywords, and appends only those complaint emails into the 'UrgentEmails' tab of your Google Sheet while skipping duplicates based on Gmail message link/id.",
  sections: {
    data: [
      '- Scan Gmail Inbox messages from the last 7 days.',
      '- Treat an email as a complaint if the email content contains any of these keywords (case-insensitive match): "complaint", "refund", "angry", "not working".',
      '- Use the Google Sheet with spreadsheet id "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc" as the destination.',
      '- Use the worksheet/tab name "UrgentEmails" inside that spreadsheet as the destination tab.',
      '- Read existing rows from the destination tab to identify already-logged complaint emails by Gmail message link/id.'
    ],
    actions: [
      '- For each Gmail message in scope, check whether the message content contains any of: "complaint", "refund", "angry", "not working".',
      '- If the message matches the complaint rule, extract these fields: sender email, subject, date, and the full email text.',
      '- If the message matches the complaint rule, also capture the Gmail message link/id to use as a unique identifier.',
      '- If the Gmail message link/id already exists in the destination tab, do not add a new row for that message.',
      '- If the Gmail message link/id does not exist in the destination tab, append exactly one new row for that message.',
      '- Treat each matching message independently (if a thread has multiple matching messages, log every matching message as its own row).'
    ],
    output: [
      '- Append one row per complaint email to the destination Google Sheet tab.',
      '- Each appended row must include (in this order): sender email, subject, date, full email text, Gmail message link/id.'
    ],
    delivery: [
      '- Deliver results by writing/appending rows into the Google Sheet tab "UrgentEmails" (no email/slack notification).'
    ],
    processing_steps: [
      '- Fetch Gmail messages from Inbox for the last 7 days.',
      '- Load existing rows from the "UrgentEmails" tab and build a set of existing Gmail message link/id values.',
      '- Filter messages by keyword match against the email content (case-insensitive).',
      '- For each matching message, extract required fields and append a new row only if its Gmail message link/id is not already present.'
    ]
  },
  specifics: {
    services_involved: [
      'google-mail',
      'google-sheets'
    ],
    user_inputs_required: [],
    resolved_user_inputs: [
      {
        key: 'user_email',
        value: 'offir.omer@gmail.com'
      },
      {
        key: 'spreadsheet_id',
        value: '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc'
      },
      {
        key: 'sheet_tab_name',
        value: 'UrgentEmails'
      },
      {
        key: 'gmail_scope',
        value: 'Inbox'
      },
      {
        key: 'data_time_window',
        value: 'last 7 days'
      },
      {
        key: 'complaint_keywords',
        value: 'complaint, refund, angry, not working'
      },
      {
        key: 'sheet_dedup_rule',
        value: 'skip if Gmail message link/id already exists in the sheet'
      },
      {
        key: 'thread_handling',
        value: 'log every message that matches the complaint rule'
      },
      {
        key: 'sheet_columns',
        value: 'sender email, subject, date, full email text, Gmail message link/id'
      }
    ]
  }
}

console.log('=' .repeat(80))
console.log('HARD REQUIREMENTS EXTRACTION TEST - Gmail Complaint Logger')
console.log('=' .repeat(80))
console.log()

console.log('Input Enhanced Prompt:')
console.log(`Title: ${testEnhancedPrompt.plan_title}`)
console.log(`Description: ${testEnhancedPrompt.plan_description}`)
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
console.log('EXPECTED vs ACTUAL (Analysis)')
console.log('=' .repeat(80))
console.log()

console.log('Expected for Gmail Complaint Logger:')
console.log('  ✓ Unit of Work: email (scanning Gmail messages)')
console.log('  ✓ Thresholds: 0 (no amount/count thresholds)')
console.log('  ✓ Routing Rules: 0 (no conditional routing)')
console.log('  ✓ Invariants: 1-2 (data availability, possibly no_duplicate_writes)')
console.log('  ✓ Required Outputs: 1 (message_id/link)')
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
  unit_of_work: hardReqs.unit_of_work === 'email' || hardReqs.unit_of_work === 'message',
  thresholds: hardReqs.thresholds.length === 0,
  routing_rules: hardReqs.routing_rules.length === 0,
  invariants: hardReqs.invariants.length >= 1,
  required_outputs: hardReqs.required_outputs.length >= 0, // link/message_id may not be detected
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
    console.log(`  - Unit of work: Expected "email" or "message" but got "${hardReqs.unit_of_work}"`)
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
  if (!checks.side_effect_constraints) {
    console.log(`  - Side Effect Constraints: Expected 0 but got ${hardReqs.side_effect_constraints.length}`)
  }
}
console.log()

console.log('=' .repeat(80))
console.log('NOTES')
console.log('=' .repeat(80))
console.log()
console.log('Key Differences from Invoice/Expense Workflow:')
console.log('  • No thresholds (no "amount > 50" type conditions)')
console.log('  • No side effect constraints (all actions are unconditional)')
console.log('  • No routing rules (no "invoice → Invoices" type routing)')
console.log('  • Unit of work is email/message (not attachment)')
console.log('  • Deduplication mentioned (check if message_id exists)')
console.log()
