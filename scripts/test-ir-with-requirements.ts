/**
 * Test Phase 0 + Phase 1 + Phase 2 + Phase 3 Integration
 * Ensure IR preserves Hard Requirements from Enhanced Prompt
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') })

import { HardRequirementsExtractor } from '../lib/agentkit/v6/requirements/HardRequirementsExtractor'
import { SemanticPlanGenerator } from '../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'
import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer'
import { IRRequirementsValidator } from '../lib/agentkit/v6/requirements/IRRequirementsValidator'

// EXACT Enhanced Prompt from user (what we will actually receive in production)
const testEnhancedPrompt = {
  "plan_title": "Expense & Invoice Email Scanner (Drive + Sheet Threshold)",
  "plan_description": "Scans Gmail for PDF attachments matching your query in the last 24 hours, extracts invoice/expense fields, stores each PDF in Google Drive (per-vendor folder under a base folder), emails a single digest summary, and appends rows to a Google Sheet only when the amount is greater than 50 in the document's currency.",
  "sections": {
    "data": [
      "- Search Gmail using this exact Gmail search query: \"subject include: Invoice or Expenses or Bill and has:attachment filename:pdf\".",
      "- Limit the scan to emails from the last 24 hours.",
      "- Consider only emails that contain PDF attachments.",
      "- For each matching email, collect the email metadata needed for traceability: sender, subject, received date, message id.",
      "- For each PDF attachment, capture the attachment filename and the attachment content for extraction."
    ],
    "output": [
      "- Produce a single digest email that contains a table.",
      "- The digest email table must include these columns: Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link.",
      "- If no matching items are found in the last 24 hours, send a digest email stating that no invoices/expenses were found."
    ],
    "actions": [
      "- For each PDF attachment found, extract these fields: Type (expense or invoice), Vendor / merchant, Date, Amount, Invoice/receipt #, Category.",
      "- Normalize the extracted Amount into a numeric value for comparison.",
      "- If the agent cannot confidently find an Amount, still include the item in the digest email and still store the attachment in Google Drive, and do not append anything to Google Sheets.",
      "- Use this Google Drive base folder as the parent location for storage: \"https://drive.google.com/drive/folders/1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-?usp=drive_link\".",
      "- Create (or reuse) a Google Drive subfolder named exactly as the extracted Vendor / merchant under the base folder.",
      "- Store the original PDF attachment in the vendor's Google Drive subfolder.",
      "- Generate a shareable Google Drive link for the stored attachment and include it in outputs.",
      "- Build a digest table row for each extracted item with: Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link.",
      "- If the extracted Amount is greater than 50 in the document's currency, append a row to Google Sheet id \"1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE\" using the same columns as the digest table: Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link.",
      "- If the extracted Amount is not greater than 50 in the document's currency, do not append a row to Google Sheets."
    ],
    "delivery": [
      "- Send the digest email to meiribarak@gmail.com."
    ],
    "processing_steps": [
      "- Run the Gmail search query over the last 24 hours.",
      "- Filter results to emails with PDF attachments.",
      "- For each PDF attachment, extract fields and determine the vendor folder name.",
      "- Store the PDF in Google Drive under the base folder and capture the Drive link.",
      "- Build the digest table and apply the > 50 (document currency) rule for Google Sheets insertion.",
      "- Send the digest email."
    ]
  },
  "specifics": {
    "services_involved": [
      "google-mail",
      "google-drive",
      "google-sheets",
      "chatgpt-research"
    ],
    "resolved_user_inputs": [
      {
        "key": "user_email",
        "value": "meiribarak@gmail.com"
      },
      {
        "key": "gmail_search_query",
        "value": "subject include: Invoice or Expenses or Bill and has:attachment filename:pdf"
      },
      {
        "key": "scan_time_window",
        "value": "last 24 hours"
      },
      {
        "key": "drive_base_folder_url",
        "value": "https://drive.google.com/drive/folders/1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-?usp=drive_link"
      },
      {
        "key": "sheet_id",
        "value": "1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE"
      },
      {
        "key": "candidate_sheet_tab_names",
        "value": "Invoices, Expenses"
      },
      {
        "key": "attachment_type_filter",
        "value": "PDF attachments"
      },
      {
        "key": "summary_delivery_style",
        "value": "single digest email"
      },
      {
        "key": "summary_columns",
        "value": "Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link"
      },
      {
        "key": "drive_storage_rule",
        "value": "attachments only; create a folder per vendor and store the attachment in it"
      },
      {
        "key": "sheet_write_rule",
        "value": "append only if amount is greater than 50 in the document currency"
      },
      {
        "key": "missing_amount_handling",
        "value": "email + store; skip Sheet"
      }
    ],
    "user_inputs_required": [
      "Which Google Sheet tab name to append rows into (choose one: Invoices or Expenses)"
    ]
  }
}

console.log('='.repeat(80))
console.log('PHASE 0 + PHASE 1 + PHASE 2 + PHASE 3 INTEGRATION TEST')
console.log('='.repeat(80))
console.log()

// ============================================================================
// Phase 0: Extract Hard Requirements
// ============================================================================

console.log('📋 PHASE 0: Extracting Hard Requirements...')
console.log()

const extractor = new HardRequirementsExtractor()
const hardReqs = extractor.extract(testEnhancedPrompt)

console.log('✅ Hard Requirements Extracted:')
console.log(`   Total Requirements: ${hardReqs.requirements.length}`)
console.log(`   Unit of Work: ${hardReqs.unit_of_work}`)
console.log(`   Thresholds: ${hardReqs.thresholds.length}`)
console.log(`   Invariants: ${hardReqs.invariants.length}`)
console.log(`   Required Outputs: ${hardReqs.required_outputs.length}`)
console.log(`   Side Effect Constraints: ${hardReqs.side_effect_constraints.length}`)
console.log()

console.log('Detailed Requirements:')
hardReqs.requirements.forEach(req => {
  console.log(`   ${req.id}: [${req.type}] ${req.constraint}`)
})
console.log()

// ============================================================================
// Phase 1: Generate Semantic Plan
// ============================================================================

console.log('🧠 PHASE 1: Generating Semantic Plan...')
console.log()

const semanticGenerator = new SemanticPlanGenerator({
  model_provider: 'anthropic',
  model_name: 'claude-opus-4-5-20251101',
  temperature: 0.3
})

async function testPipeline() {
  const semanticResult = await semanticGenerator.generate(testEnhancedPrompt)

  if (!semanticResult.success) {
    console.log('❌ Semantic Plan Generation Failed:')
    semanticResult.errors?.forEach(err => console.log(`   - ${err}`))
    return
  }

  console.log('✅ Semantic Plan Generated Successfully')
  console.log()

  const semanticPlan = semanticResult.semantic_plan!

  // ============================================================================
  // Phase 2: Grounding (skipped for API-only workflows)
  // ============================================================================

  console.log('⚙️  PHASE 2: Grounding (SKIPPED - no tabular metadata for Gmail workflow)')
  console.log()

  // Create an ungrounded plan structure (following production API pattern)
  const groundedPlan = {
    ...semanticPlan,
    grounded: false,
    grounding_results: [],
    grounding_errors: [],
    validated_assumptions_count: 0,
    total_assumptions_count: semanticPlan.assumptions.length,
    grounding_confidence: 0,
    grounding_timestamp: new Date().toISOString()
  }

  console.log('✅ Ungrounded plan structure created')
  console.log()

  // ============================================================================
  // Phase 3: Formalize to IR
  // ============================================================================

  console.log('🔧 PHASE 3: Formalizing to IR...')
  console.log()

  const formalizer = new IRFormalizer({
    model: 'gpt-5.2',
    temperature: 0.0,
    openai_api_key: process.env.OPENAI_API_KEY
  })

  const formalizationResult = await formalizer.formalize(groundedPlan)

  console.log('✅ IR Formalized Successfully')
  console.log(`   Grounded facts used: ${Object.keys(formalizationResult.formalization_metadata.grounded_facts_used).length}`)
  console.log(`   Missing facts: ${formalizationResult.formalization_metadata.missing_facts.length}`)
  console.log(`   Formalization confidence: ${(formalizationResult.formalization_metadata.formalization_confidence * 100).toFixed(1)}%`)
  console.log()

  const ir = formalizationResult.ir

  // ============================================================================
  // Validation: Use IRRequirementsValidator
  // ============================================================================

  console.log('='.repeat(80))
  console.log('VALIDATION: IR Requirements Preservation Check (using IRRequirementsValidator)')
  console.log('='.repeat(80))
  console.log()

  const validator = new IRRequirementsValidator()
  const validation = validator.validate(hardReqs, ir)

  // Print validation results
  console.log('Requirement-by-Requirement Analysis:')
  console.log()

  validation.details.forEach(result => {
    const icon = result.preserved ? '✅' : '⚠️'
    console.log(`${icon} ${result.requirementId}: [${result.type}]`)
    console.log(`   Constraint: ${result.constraint}`)
    console.log(`   Preserved: ${result.preserved ? 'YES' : 'NO'}`)
    if (result.irMapping) {
      console.log(`   IR Mapping: ${result.irMapping}`)
    }
    console.log(`   Evidence: ${result.evidence}`)
    console.log()
  })

  // Summary statistics
  const totalReqs = validation.details.length
  const preservedReqs = validation.preserved_requirements.length
  const preservationRate = validation.score

  console.log('='.repeat(80))
  console.log('SUMMARY')
  console.log('='.repeat(80))
  console.log()
  console.log(`Total Requirements: ${totalReqs}`)
  console.log(`Preserved: ${preservedReqs}`)
  console.log(`Lost: ${totalReqs - preservedReqs}`)
  console.log(`Preservation Rate: ${preservationRate}%`)
  console.log()

  if (validation.valid) {
    console.log(`🎉 VALIDATION PASSED - ${preservationRate}% REQUIREMENTS PRESERVED`)
    console.log(`   IR Validation Score: ${validation.score}/100`)
  } else {
    console.log(`⚠️  VALIDATION FAILED - Only ${preservationRate}% preserved (need 80%+)`)
    console.log()
    console.log('Lost Requirements:')
    validation.missing_requirements.forEach(reqId => {
      const detail = validation.details.find(d => d.requirementId === reqId)
      if (detail) {
        console.log(`   - ${detail.requirementId}: ${detail.constraint}`)
        console.log(`     Evidence: ${detail.evidence}`)
      }
    })
  }
  console.log()

  // Print IR for debugging
  console.log('='.repeat(80))
  console.log('IR OUTPUT (for debugging)')
  console.log('='.repeat(80))
  console.log()
  console.log(JSON.stringify(ir, null, 2))
}

// Run the test
testPipeline().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
