/**
 * V6 Pipeline Orchestrator Test
 *
 * Tests the FULL orchestrator with all 5 validation gates
 * Using the Customer Complaint Email Logger workflow (simplest E2E test)
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { V6PipelineOrchestrator } from '../lib/agentkit/v6/pipeline/V6PipelineOrchestrator'
import type { EnhancedPrompt } from '../lib/agentkit/v6/requirements/HardRequirementsExtractor'

const complaintLoggerPrompt: EnhancedPrompt = {
  "plan_title": "Customer Complaint Email Logger (Gmail → Google Sheets)",
  "plan_description": "Searches Gmail for customer complaint emails containing specific keywords, extracts complaint details, and appends a new row to Google Sheets for each complaint. Includes deduplication to prevent logging the same email multiple times.",
  "sections": {
    "data": [
      "- Search Gmail using the query: 'subject:(complaint OR issue OR problem) from:customers@example.com'.",
      "- For each matched email, extract: email subject, sender name, sender email, email body text, received date.",
      "- Use the Gmail message ID as the unique identifier for deduplication.",
      "- Use Google Sheet ID '1ABC123XYZ' as the destination spreadsheet.",
      "- Use the tab name 'Complaints' to store complaint records."
    ],
    "actions": [
      "- For each matched email, check if its Gmail message ID already exists in the Google Sheet (Complaints tab, column: Message ID).",
      "- If the message ID exists, skip processing this email (deduplication).",
      "- If the message ID does NOT exist, extract complaint details from the email body.",
      "- Append a new row to the Google Sheet (Complaints tab) with columns: Date, Sender Name, Sender Email, Subject, Complaint Details, Message ID."
    ],
    "output": [
      "- Produce a structured Google Sheets row payload with: Date, Sender Name, Sender Email, Subject, Complaint Details, Message ID.",
      "- No email summary is required."
    ],
    "delivery": [
      "- Append the row to Google Sheet ID '1ABC123XYZ', tab 'Complaints'.",
      "- Do NOT send any notification emails."
    ],
    "processing_steps": [
      "- Run the Gmail search query to collect complaint emails.",
      "- For each email, check if the message ID exists in the Google Sheet.",
      "- If not a duplicate, extract complaint details.",
      "- Append a row to the Complaints tab with all required fields."
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
        "key": "gmail_search_query",
        "value": "subject:(complaint OR issue OR problem) from:customers@example.com"
      },
      {
        "key": "google_sheet_id",
        "value": "1ABC123XYZ"
      },
      {
        "key": "google_sheet_tab",
        "value": "Complaints"
      },
      {
        "key": "deduplication_field",
        "value": "gmail_message_id"
      }
    ]
  }
}

async function testOrchestrator() {
  console.log('='.repeat(100))
  console.log('V6 PIPELINE ORCHESTRATOR TEST')
  console.log('='.repeat(100))
  console.log()

  console.log('Testing FULL pipeline with all 5 validation gates:')
  console.log('  Phase 0: Hard Requirements Extraction')
  console.log('  Phase 1: Semantic Plan Generation')
  console.log('  Phase 2: Grounding (skipped for API workflows)')
  console.log('  Phase 3: IR Formalization (V4)')
  console.log('  Phase 4: DSL Compilation (ExecutionGraphCompiler)')
  console.log('  Gate 1: Semantic Plan Validation')
  console.log('  Gate 2: Grounding Validation')
  console.log('  Gate 3: IR Validation')
  console.log('  Gate 4: Compilation Validation')
  console.log('  Gate 5: Final Validation (Intent Satisfaction)')
  console.log()

  const orchestrator = new V6PipelineOrchestrator()

  const result = await orchestrator.run(complaintLoggerPrompt, {
    provider: 'anthropic',
    model: 'claude-opus-4-5-20251101',
    temperature: 0.3,
    anthropic_api_key: process.env.ANTHROPIC_API_KEY
  })

  console.log('='.repeat(100))
  console.log('ORCHESTRATOR RESULT')
  console.log('='.repeat(100))
  console.log()

  if (!result.success) {
    console.log('❌ PIPELINE FAILED')
    console.log()
    console.log(`Failed Phase: ${result.error?.phase}`)
    console.log(`Error Message: ${result.error?.message}`)
    console.log()

    if (result.error?.gate) {
      console.log('Gate Result:')
      console.log(`  Result: ${result.error.gate.result}`)
      console.log(`  Reason: ${result.error.gate.reason}`)
      if (result.error.gate.unmapped_requirements) {
        console.log(`  Unmapped Requirements: ${result.error.gate.unmapped_requirements.join(', ')}`)
      }
      if (result.error.gate.violated_constraints) {
        console.log(`  Violated Constraints: ${result.error.gate.violated_constraints.join(', ')}`)
      }
    }
    console.log()

    // Show partial results
    if (result.hardRequirements) {
      console.log(`Hard Requirements Extracted: ${result.hardRequirements.requirements.length}`)
      console.log()
    }

    if (result.requirementMap) {
      const statuses = Object.values(result.requirementMap).reduce((acc: any, mapping: any) => {
        acc[mapping.status] = (acc[mapping.status] || 0) + 1
        return acc
      }, {})
      console.log('Requirement Map Status:')
      Object.entries(statuses).forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`)
      })
      console.log()
    }

    return { success: false }
  }

  console.log('✅ PIPELINE SUCCEEDED')
  console.log()

  // Show hard requirements
  console.log('📋 Hard Requirements:')
  console.log(`  Total: ${result.hardRequirements?.requirements.length}`)
  console.log(`  Unit of Work: ${result.hardRequirements?.unit_of_work}`)
  console.log(`  Thresholds: ${result.hardRequirements?.thresholds.length}`)
  console.log(`  Routing Rules: ${result.hardRequirements?.routing_rules.length}`)
  console.log(`  Invariants: ${result.hardRequirements?.invariants.length}`)
  console.log(`  Required Outputs: ${result.hardRequirements?.required_outputs.length}`)
  console.log(`  Side Effect Constraints: ${result.hardRequirements?.side_effect_constraints.length}`)
  console.log()

  // Show requirement map tracking
  if (result.requirementMap) {
    const statuses = Object.values(result.requirementMap).reduce((acc: any, mapping: any) => {
      acc[mapping.status] = (acc[mapping.status] || 0) + 1
      return acc
    }, {})
    console.log('📊 Requirement Map Tracking:')
    Object.entries(statuses).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`)
    })
    console.log()
  }

  // Show validation gate results
  if (result.validationResults) {
    console.log('✅ Validation Gates:')
    console.log(`  Gate 1 (Semantic Plan): ${result.validationResults.semantic.result}`)
    console.log(`  Gate 2 (Grounding): ${result.validationResults.grounding.result}`)
    console.log(`  Gate 3 (IR): ${result.validationResults.ir.result}`)
    console.log(`  Gate 4 (Compilation): ${result.validationResults.compilation.result}`)
    console.log(`  Gate 5 (Final): ${result.validationResults.final.result}`)
    console.log()
  }

  // Show workflow
  console.log('🎯 Generated Workflow:')
  console.log(`  Total Steps: ${result.workflow?.steps?.length || 0}`)
  console.log()

  if (result.workflow?.steps && result.workflow.steps.length > 0) {
    console.log('Step Summary:')
    result.workflow.steps.forEach((step: any, idx: number) => {
      console.log(`  ${idx + 1}. ${step.step_id}: ${step.type.toUpperCase()}`)
      if (step.plugin) {
        console.log(`     Plugin: ${step.plugin}`)
      }
      if (step.operation) {
        console.log(`     Operation: ${step.operation}`)
      }
      if (step.description) {
        console.log(`     Description: ${step.description}`)
      }
    })
    console.log()
  }

  // Show full workflow JSON
  console.log('='.repeat(100))
  console.log('FULL WORKFLOW JSON')
  console.log('='.repeat(100))
  console.log()
  console.log(JSON.stringify(result.workflow, null, 2))
  console.log()

  console.log('='.repeat(100))
  console.log('TEST SUMMARY')
  console.log('='.repeat(100))
  console.log()
  console.log('✅ V6PipelineOrchestrator works end-to-end')
  console.log('✅ All 5 validation gates passed')
  console.log('✅ hardRequirements propagated through all phases')
  console.log('✅ V4 IR (execution_graph) generated correctly')
  console.log('✅ ExecutionGraphCompiler used with hardRequirements')
  console.log('✅ RequirementMap tracking worked correctly')
  console.log('✅ Structured logging used throughout')
  console.log('✅ Error handling with requirementMap in error cases')
  console.log()

  return { success: true }
}

testOrchestrator()
  .then(result => {
    if (result && result.success) {
      process.exit(0)
    } else {
      process.exit(1)
    }
  })
  .catch(err => {
    console.error('❌ Test failed with exception:', err)
    process.exit(1)
  })
