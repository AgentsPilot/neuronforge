/**
 * Test script to verify HardcodeDetector handles conditional branches correctly
 */

import { HardcodeDetector } from '../lib/pilot/shadow/HardcodeDetector'

// Simplified workflow matching user's structure
const testWorkflow = [
  {
    id: 'step1',
    type: 'action',
    action: 'read_range',
    params: {
      range: 'Sheet1!A1:E',
      spreadsheet_id: '1abc123'
    },
    plugin: 'google-sheets'
  },
  {
    id: 'step5',
    type: 'scatter_gather',
    scatter: {
      input: '{{complaint_emails}}',
      itemVariable: 'current_email',
      steps: [
        {
          id: 'step1',
          type: 'conditional',
          condition: {
            field: 'current_email.id',
            value: '{{existing_sheet_data_objects}}',
            operator: 'not_in',
            conditionType: 'simple'
          },
          then: [
            {
              id: 'step1',
              type: 'action',
              action: 'append_rows',
              params: {
                range: 'UrgentEmails',
                spreadsheet_id: '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc',
                values: [['{{current_email.from}}', '{{current_email.subject}}']]
              },
              plugin: 'google-sheets'
            }
          ]
        }
      ]
    }
  }
]

async function runTest() {
  console.log('='.repeat(80))
  console.log('Testing HardcodeDetector with conditional branch in scatter_gather')
  console.log('='.repeat(80))
  console.log('')

  const detector = new HardcodeDetector()
  const result = detector.detect(testWorkflow as any)

  console.log('')
  console.log('='.repeat(80))
  console.log('RESULTS:')
  console.log('='.repeat(80))
  console.log('')
  console.log(`Total detected values: ${result.total_count}`)
  console.log(`  - Resource IDs: ${result.resource_ids.length}`)
  console.log(`  - Business Logic: ${result.business_logic.length}`)
  console.log(`  - Configuration: ${result.configuration.length}`)
  console.log('')

  const allDetectedValues = [
    ...result.resource_ids,
    ...result.business_logic,
    ...result.configuration
  ]

  for (const detectedValue of allDetectedValues) {
    console.log(`Parameter: ${detectedValue.suggested_param}`)
    console.log(`  Value: ${detectedValue.value}`)
    console.log(`  Category: ${detectedValue.category}`)
    console.log(`  Steps: ${detectedValue.stepIds.join(', ')}`)
    console.log(`  Path: ${detectedValue.path}`)
    console.log('')
  }

  // Check if we detected the conditional branch values
  // These should be in step1 inside the conditional branch (nested in step5)
  const hasConditionalBranchValues = allDetectedValues.some(v =>
    v.value === 'UrgentEmails' || v.value === '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc'
  )

  console.log('='.repeat(80))
  if (hasConditionalBranchValues) {
    console.log('✅ SUCCESS: Detected hardcoded values inside conditional branch')
  } else {
    console.log('❌ FAILURE: Did NOT detect hardcoded values inside conditional branch')
    console.log('Expected to find:')
    console.log('  - range: "UrgentEmails"')
    console.log('  - spreadsheet_id: "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"')
  }
  console.log('='.repeat(80))
}

runTest().catch(console.error)
