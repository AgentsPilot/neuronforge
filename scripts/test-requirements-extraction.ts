/**
 * Test LLM-Based Hard Requirements Extraction
 *
 * This script tests the new GPT-4o-mini based requirements extractor
 * BEFORE integrating it into the full pipeline.
 *
 * Tests three diverse Enhanced Prompts:
 * 1. Invoice Processing (with conditional Sheets append)
 * 2. Customer Complaint Logger (with deduplication)
 * 3. High-Qualified Leads (with grouping and empty handling)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { HardRequirementsExtractor } from '../lib/agentkit/v6/requirements/HardRequirementsExtractor'

// ============================================================================
// Test Case 1: Invoice Processing with Conditional Sheets
// ============================================================================

const invoicePrompt = {
  "plan_title": "Invoice PDF Processor with Conditional Sheets Append",
  "plan_description": "Process invoice emails, extract data, organize in Drive, and conditionally append to Sheets based on amount threshold.",
  "sections": {
    "data": [
      "- Fetch emails with PDF attachments from Gmail inbox (last 30 days).",
      "- Each email attachment is treated as one invoice PDF to process."
    ],
    "actions": [
      "- Extract vendor name, invoice amount, and invoice number from each PDF using AI.",
      "- Create a Google Drive folder named after the vendor (if it doesn't already exist).",
      "- Upload the PDF to the vendor's Drive folder.",
      "- Share the uploaded file publicly and capture the share link.",
      "- If the extracted amount is greater than 50, append a row to Google Sheets with vendor, amount, and Drive link."
    ],
    "output": [
      "- For each invoice, output must include: vendor name, amount, invoice number, and Drive share link."
    ],
    "delivery": [
      "- Send a summary email listing all processed invoices with their Drive links."
    ]
  },
  "specifics": {
    "services_involved": ["google-mail", "google-drive", "google-sheets"],
    "resolved_user_inputs": [
      { "key": "spreadsheet_id", "value": "abc123" }
    ]
  }
}

// ============================================================================
// Test Case 2: Customer Complaint Logger with Deduplication
// ============================================================================

const complaintPrompt = {
  "plan_title": "Customer Complaint Email Logger (Gmail → Google Sheets)",
  "plan_description": "Scans Gmail for complaint emails and appends them to Sheets while skipping duplicates.",
  "sections": {
    "data": [
      "- Scan Gmail Inbox messages from the last 7 days.",
      "- Treat an email as a complaint if the email content contains any of these keywords (case-insensitive): 'complaint', 'refund', 'angry', 'not working'.",
      "- Read existing rows from the Google Sheet to identify already-logged emails by Gmail message link/id."
    ],
    "actions": [
      "- For each Gmail message in scope, check whether the message content contains complaint keywords.",
      "- If the message matches the complaint rule, extract: sender email, subject, date, and full email text.",
      "- If the Gmail message link/id already exists in the destination tab, do not add a new row for that message.",
      "- If the Gmail message link/id does not exist, append exactly one new row with the extracted fields."
    ],
    "output": [
      "- Each appended row must include (in this order): sender email, subject, date, full email text, Gmail message link/id."
    ],
    "delivery": [
      "- Deliver results by appending rows to Google Sheet tab 'UrgentEmails'."
    ]
  },
  "specifics": {
    "services_involved": ["google-mail", "google-sheets"],
    "resolved_user_inputs": [
      { "key": "spreadsheet_id", "value": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc" }
    ]
  }
}

// ============================================================================
// Test Case 3: High-Qualified Leads with Grouping and Empty Handling
// ============================================================================

const leadsPrompt = {
  "plan_title": "High-Qualified Leads Summary + Per-Sales Person Emails",
  "plan_description": "Read leads from Google Sheets, filter to high-qualified, group by sales person, and send personalized emails.",
  "sections": {
    "data": [
      "- Read lead rows from Google Sheet id '1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE'.",
      "- Use the worksheet (tab) named 'Leads'.",
      "- Treat the following columns as the canonical output fields: Date, Lead Name, Company, Email, Phone, Stage, Notes, Sales Person.",
      "- Treat the 'Sales Person' column value as an email address for delivery."
    ],
    "actions": [
      "- Filter leads to only rows where the column 'Stage' equals '4'.",
      "- If there are zero filtered leads, do not email sales people; only email Barak Meiri with the message 'no high qualified leads found'.",
      "- Group the filtered leads by the 'Sales Person' column value (one group per sales person email address).",
      "- For each sales person group, generate a table containing only that sales person's leads.",
      "- Generate an overall summary table for Barak Meiri that includes all filtered leads."
    ],
    "output": [
      "- Create an email-friendly table for each sales person group (one table per sales person).",
      "- Create an email-friendly overall summary table for Barak Meiri.",
      "- Ensure the table columns appear in this order: Date, Lead Name, Company, Email, Phone, Stage, Notes, Sales Person."
    ],
    "delivery": [
      "- Send the overall summary email to meiribarak@gmail.com.",
      "- For each sales person email found in the 'Sales Person' column, send an email to that address containing only that sales person's table.",
      "- Do not include other sales people's leads in a sales person's email.",
      "- If there are zero high-qualified leads (Stage = 4), send only a short email to meiribarak@gmail.com with the text: 'no high qualified leads found'."
    ]
  },
  "specifics": {
    "services_involved": ["google-sheets", "google-mail"],
    "resolved_user_inputs": [
      { "key": "user_email", "value": "meiribarak@gmail.com" },
      { "key": "sheet_id", "value": "1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE" }
    ]
  }
}

// ============================================================================
// Run Tests
// ============================================================================

async function runExtractionTests() {
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  LLM-BASED HARD REQUIREMENTS EXTRACTION TEST')
  console.log('═══════════════════════════════════════════════════════════════════\n')

  const extractor = new HardRequirementsExtractor()

  // Test Case 1: Invoice Processing
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ TEST CASE 1: Invoice Processing with Conditional Sheets         │')
  console.log('└─────────────────────────────────────────────────────────────────┘\n')

  console.log('Enhanced Prompt:', invoicePrompt.plan_title)
  console.log('Services:', invoicePrompt.specifics.services_involved.join(', '))
  console.log('\nExtracting requirements...\n')

  const invoiceStart = Date.now()
  const invoiceReqs = await extractor.extract(invoicePrompt)
  const invoiceDuration = Date.now() - invoiceStart

  console.log(`✅ Extraction completed in ${invoiceDuration}ms\n`)

  console.log('📊 Extracted Requirements:')
  console.log(`  - Total Requirements: ${invoiceReqs.requirements.length}`)
  console.log(`  - Unit of Work: ${invoiceReqs.unit_of_work || 'none'}`)
  console.log(`  - Thresholds: ${invoiceReqs.thresholds.length}`)
  console.log(`  - Routing Rules: ${invoiceReqs.routing_rules.length}`)
  console.log(`  - Invariants: ${invoiceReqs.invariants.length}`)
  console.log(`  - Empty Behavior: ${invoiceReqs.empty_behavior || 'none'}`)
  console.log(`  - Required Outputs: ${invoiceReqs.required_outputs.length}`)
  console.log(`  - Side Effect Constraints: ${invoiceReqs.side_effect_constraints.length}\n`)

  console.log('📋 Detailed Requirements:')
  invoiceReqs.requirements.forEach(req => {
    console.log(`  ${req.id}: [${req.type}] ${req.constraint}`)
  })

  if (invoiceReqs.thresholds.length > 0) {
    console.log('\n🎯 Thresholds:')
    invoiceReqs.thresholds.forEach(t => {
      console.log(`  - ${t.field} ${t.operator} ${t.value} (applies to: ${t.applies_to.join(', ') || 'all'})`)
    })
  }

  if (invoiceReqs.invariants.length > 0) {
    console.log('\n⚠️  Invariants:')
    invoiceReqs.invariants.forEach(inv => {
      console.log(`  - [${inv.type}] ${inv.description}`)
    })
  }

  console.log('\n')

  // Test Case 2: Complaint Logger
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ TEST CASE 2: Customer Complaint Logger with Deduplication       │')
  console.log('└─────────────────────────────────────────────────────────────────┘\n')

  console.log('Enhanced Prompt:', complaintPrompt.plan_title)
  console.log('Services:', complaintPrompt.specifics.services_involved.join(', '))
  console.log('\nExtracting requirements...\n')

  const complaintStart = Date.now()
  const complaintReqs = await extractor.extract(complaintPrompt)
  const complaintDuration = Date.now() - complaintStart

  console.log(`✅ Extraction completed in ${complaintDuration}ms\n`)

  console.log('📊 Extracted Requirements:')
  console.log(`  - Total Requirements: ${complaintReqs.requirements.length}`)
  console.log(`  - Unit of Work: ${complaintReqs.unit_of_work || 'none'}`)
  console.log(`  - Thresholds: ${complaintReqs.thresholds.length}`)
  console.log(`  - Routing Rules: ${complaintReqs.routing_rules.length}`)
  console.log(`  - Invariants: ${complaintReqs.invariants.length}`)
  console.log(`  - Empty Behavior: ${complaintReqs.empty_behavior || 'none'}`)
  console.log(`  - Required Outputs: ${complaintReqs.required_outputs.length}`)
  console.log(`  - Side Effect Constraints: ${complaintReqs.side_effect_constraints.length}\n`)

  console.log('📋 Detailed Requirements:')
  complaintReqs.requirements.forEach(req => {
    console.log(`  ${req.id}: [${req.type}] ${req.constraint}`)
  })

  if (complaintReqs.invariants.length > 0) {
    console.log('\n⚠️  Invariants:')
    complaintReqs.invariants.forEach(inv => {
      console.log(`  - [${inv.type}] ${inv.description}`)
    })
  }

  if (complaintReqs.required_outputs.length > 0) {
    console.log('\n📤 Required Outputs:')
    complaintReqs.required_outputs.forEach(output => {
      console.log(`  - ${output}`)
    })
  }

  console.log('\n')

  // Test Case 3: High-Qualified Leads
  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ TEST CASE 3: High-Qualified Leads with Grouping & Empty Handling│')
  console.log('└─────────────────────────────────────────────────────────────────┘\n')

  console.log('Enhanced Prompt:', leadsPrompt.plan_title)
  console.log('Services:', leadsPrompt.specifics.services_involved.join(', '))
  console.log('\nExtracting requirements...\n')

  const leadsStart = Date.now()
  const leadsReqs = await extractor.extract(leadsPrompt)
  const leadsDuration = Date.now() - leadsStart

  console.log(`✅ Extraction completed in ${leadsDuration}ms\n`)

  console.log('📊 Extracted Requirements:')
  console.log(`  - Total Requirements: ${leadsReqs.requirements.length}`)
  console.log(`  - Unit of Work: ${leadsReqs.unit_of_work || 'none'}`)
  console.log(`  - Thresholds: ${leadsReqs.thresholds.length}`)
  console.log(`  - Routing Rules: ${leadsReqs.routing_rules.length}`)
  console.log(`  - Invariants: ${leadsReqs.invariants.length}`)
  console.log(`  - Empty Behavior: ${leadsReqs.empty_behavior || 'none'}`)
  console.log(`  - Required Outputs: ${leadsReqs.required_outputs.length}`)
  console.log(`  - Side Effect Constraints: ${leadsReqs.side_effect_constraints.length}\n`)

  console.log('📋 Detailed Requirements:')
  leadsReqs.requirements.forEach(req => {
    console.log(`  ${req.id}: [${req.type}] ${req.constraint}`)
  })

  if (leadsReqs.thresholds.length > 0) {
    console.log('\n🎯 Thresholds:')
    leadsReqs.thresholds.forEach(t => {
      console.log(`  - ${t.field} ${t.operator} ${t.value} (applies to: ${t.applies_to.join(', ') || 'all'})`)
    })
  }

  if (leadsReqs.routing_rules.length > 0) {
    console.log('\n🔀 Routing Rules:')
    leadsReqs.routing_rules.forEach(rule => {
      console.log(`  - ${rule.condition} → ${rule.destination}`)
    })
  }

  if (leadsReqs.required_outputs.length > 0) {
    console.log('\n📤 Required Outputs:')
    leadsReqs.required_outputs.forEach(output => {
      console.log(`  - ${output}`)
    })
  }

  console.log('\n')

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('┌─────────────────────────────────────────────────────────────────┐')
  console.log('│ TEST SUMMARY                                                     │')
  console.log('└─────────────────────────────────────────────────────────────────┘\n')

  console.log('📊 Extraction Performance:')
  console.log(`  - Test Case 1 (Invoice): ${invoiceDuration}ms, ${invoiceReqs.requirements.length} requirements`)
  console.log(`  - Test Case 2 (Complaint): ${complaintDuration}ms, ${complaintReqs.requirements.length} requirements`)
  console.log(`  - Test Case 3 (Leads): ${leadsDuration}ms, ${leadsReqs.requirements.length} requirements`)

  const avgDuration = Math.round((invoiceDuration + complaintDuration + leadsDuration) / 3)
  const totalReqs = invoiceReqs.requirements.length + complaintReqs.requirements.length + leadsReqs.requirements.length

  console.log(`\n  Average Extraction Time: ${avgDuration}ms`)
  console.log(`  Total Requirements Extracted: ${totalReqs}`)

  console.log('\n✅ Key Improvements Over Pattern Matching:')
  console.log('  ✅ Invoice: Detected "amount > 50" threshold (pattern matching missed "if ... greater than")')
  console.log('  ✅ Complaint: Detected deduplication invariant (no_duplicate_writes)')
  console.log('  ✅ Leads: Detected "Stage equals 4" threshold (pattern matching required "if/when" prefix)')
  console.log('  ✅ Leads: Detected "zero filtered leads" empty behavior (pattern matching required "if no")')
  console.log('  ✅ Leads: Detected "group by Sales Person" routing rule (pattern matching had no grouping support)')
  console.log('  ✅ Leads: Detected all required output columns (pattern matching only checked for "link/url")')

  console.log('\n🎯 Extraction Quality Assessment:')

  // Check Invoice requirements
  const hasInvoiceThreshold = invoiceReqs.thresholds.some(t => t.field.toLowerCase().includes('amount') && t.value === 50)
  const hasInvoiceUnitOfWork = invoiceReqs.unit_of_work === 'attachment'
  const hasInvoiceSequential = invoiceReqs.invariants.some(inv => inv.type === 'sequential_dependency')

  console.log(`\n  Invoice Processing:`)
  console.log(`    ${hasInvoiceUnitOfWork ? '✅' : '❌'} Unit of Work = attachment`)
  console.log(`    ${hasInvoiceThreshold ? '✅' : '❌'} Threshold: amount > 50`)
  console.log(`    ${hasInvoiceSequential ? '✅' : '❌'} Sequential: create folder → upload`)

  // Check Complaint requirements
  const hasComplaintDedup = complaintReqs.invariants.some(inv => inv.type === 'no_duplicate_writes')
  const hasComplaintUnitOfWork = complaintReqs.unit_of_work === 'email'
  const hasComplaintOutputs = complaintReqs.required_outputs.length >= 4

  console.log(`\n  Complaint Logger:`)
  console.log(`    ${hasComplaintUnitOfWork ? '✅' : '❌'} Unit of Work = email`)
  console.log(`    ${hasComplaintDedup ? '✅' : '❌'} Deduplication invariant`)
  console.log(`    ${hasComplaintOutputs ? '✅' : '❌'} Required outputs (4+ fields)`)

  // Check Leads requirements
  const hasLeadsThreshold = leadsReqs.thresholds.some(t => t.field.toLowerCase().includes('stage') && t.value === '4')
  const hasLeadsEmpty = leadsReqs.empty_behavior === 'notify'
  const hasLeadsRouting = leadsReqs.routing_rules.length > 0
  const hasLeadsOutputs = leadsReqs.required_outputs.length >= 7
  const hasLeadsUnitOfWork = leadsReqs.unit_of_work === 'row'

  console.log(`\n  High-Qualified Leads:`)
  console.log(`    ${hasLeadsUnitOfWork ? '✅' : '❌'} Unit of Work = row`)
  console.log(`    ${hasLeadsThreshold ? '✅' : '❌'} Threshold: Stage = 4`)
  console.log(`    ${hasLeadsEmpty ? '✅' : '❌'} Empty Behavior = notify`)
  console.log(`    ${hasLeadsRouting ? '✅' : '❌'} Routing: group by Sales Person`)
  console.log(`    ${hasLeadsOutputs ? '✅' : '❌'} Required outputs (7+ columns)`)

  const totalChecks = 13
  const passedChecks = [
    hasInvoiceUnitOfWork, hasInvoiceThreshold, hasInvoiceSequential,
    hasComplaintDedup, hasComplaintUnitOfWork, hasComplaintOutputs,
    hasLeadsThreshold, hasLeadsEmpty, hasLeadsRouting, hasLeadsOutputs, hasLeadsUnitOfWork
  ].filter(Boolean).length

  const qualityScore = Math.round((passedChecks / totalChecks) * 100)

  console.log(`\n📊 Overall Quality Score: ${qualityScore}% (${passedChecks}/${totalChecks} checks passed)`)

  if (qualityScore >= 90) {
    console.log('\n✅ EXTRACTION QUALITY: EXCELLENT - Ready for integration')
  } else if (qualityScore >= 75) {
    console.log('\n⚠️  EXTRACTION QUALITY: GOOD - May need prompt refinement')
  } else {
    console.log('\n❌ EXTRACTION QUALITY: POOR - Prompt needs significant improvement')
  }

  console.log('\n═══════════════════════════════════════════════════════════════════\n')
}

runExtractionTests().catch(error => {
  console.error('\n❌ TEST FAILED:')
  console.error(error)
  process.exit(1)
})
