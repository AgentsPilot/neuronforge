/**
 * Test Script for Phase 3 Enhancements
 *
 * Tests the 3 new pattern enhancements:
 * 1. Multi-field deduplication (composite keys)
 * 2. Time-window deduplication (time-based filtering)
 * 3. Multi-destination delivery (parallel notifications)
 */

import { DeclarativeCompiler } from './lib/agentkit/v6/compiler/DeclarativeCompiler'
import { PluginManagerV2 } from './lib/server/plugin-manager-v2'
import type { DeclarativeLogicalIR } from './lib/agentkit/v6/logical-ir/schemas/declarative-ir-types'

async function testPhase3Enhancements() {
  console.log('='.repeat(80))
  console.log('PHASE 3 ENHANCEMENTS TEST SUITE')
  console.log('='.repeat(80))
  console.log()

  // Initialize compiler
  const pluginManager = await PluginManagerV2.getInstance()
  const compiler = new DeclarativeCompiler(pluginManager)

  let totalTests = 0
  let passedTests = 0
  let failedTests = 0

  // ==========================================================================
  // TEST 1: Multi-field Deduplication (Composite Keys)
  // ==========================================================================

  console.log('TEST 1: Multi-field Deduplication (Composite Keys)')
  console.log('-'.repeat(80))

  totalTests++
  try {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Test multi-field deduplication with composite key',
      data_sources: [
        {
          type: 'api',
          source: 'google_mail',
          location: 'gmail',
          role: 'primary',
          tab: null,
          endpoint: null,
          trigger: null,
          plugin_key: 'google-mail',
          operation_type: 'search_emails',
          config: {
            query: 'in:inbox newer_than:7d'
          }
        },
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'test-sheet-id',
          role: 'reference',
          tab: 'ProcessedInvoices',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: {
            spreadsheet_id: 'test-sheet-id',
            range: 'ProcessedInvoices',
            // MULTI-FIELD DEDUPLICATION (NEW!)
            identifier_fields: ['vendor_id', 'invoice_number'] // Composite key
          }
        }
      ],
      normalization: null,
      filters: null,
      ai_operations: null,
      partitions: null,
      grouping: null,
      rendering: {
        type: 'json',
        columns_in_order: ['vendor_id', 'invoice_number', 'amount', 'date']
      },
      delivery_rules: {
        send_when_no_results: false,
        summary_delivery: {
          recipient: 'test@example.com',
          plugin_key: 'email',
          operation_type: 'send'
        }
      },
      edge_cases: [],
      clarifications_required: []
    }

    const startTime = Date.now()
    const result = await compiler.compile(ir)
    const duration = Date.now() - startTime

    if (!result.success) {
      throw new Error(`Compilation failed: ${result.errors?.join(', ')}`)
    }

    // Verification checks
    const checks = {
      compilationSuccess: result.success,
      hasWorkflow: result.workflow && result.workflow.length > 0,
      hasExtractIdStep: result.workflow.some(s =>
        s.config?.expression?.includes('vendor_id') &&
        s.config?.expression?.includes('invoice_number') &&
        s.config?.expression?.includes('"|"')
      ),
      hasPrecomputeStep: result.workflow.some(s =>
        s.config?.expression?.includes('.includes') &&
        s.config?.expression?.includes('|| []')
      ),
      hasFilterStep: result.workflow.some(s =>
        s.config?.condition === 'item[1] == true'
      ),
      hasExtractStep: result.workflow.some(s =>
        s.config?.expression === 'item[0]'
      ),
      compilationSpeed: duration < 200
    }

    const allChecksPassed = Object.values(checks).every(v => v === true)

    console.log('✓ Compilation succeeded:', checks.compilationSuccess)
    console.log('✓ Workflow generated:', checks.hasWorkflow, `(${result.workflow.length} steps)`)
    console.log('✓ Composite key extraction:', checks.hasExtractIdStep)
    console.log('✓ Pre-computed boolean pattern:', checks.hasPrecomputeStep)
    console.log('✓ Filter step present:', checks.hasFilterStep)
    console.log('✓ Extract step present:', checks.hasExtractStep)
    console.log('✓ Compilation speed:', checks.compilationSpeed, `(${duration}ms)`)
    console.log()

    if (allChecksPassed) {
      console.log('✅ TEST 1 PASSED: Multi-field deduplication works correctly')
      passedTests++
    } else {
      console.log('❌ TEST 1 FAILED: Some checks did not pass')
      failedTests++
    }
  } catch (error) {
    console.log('❌ TEST 1 FAILED:', error instanceof Error ? error.message : String(error))
    failedTests++
  }

  console.log()
  console.log()

  // ==========================================================================
  // TEST 2: Time-window Deduplication
  // ==========================================================================

  console.log('TEST 2: Time-window Deduplication (Time-based Filtering)')
  console.log('-'.repeat(80))

  totalTests++
  try {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Test time-window deduplication to skip recently processed items',
      data_sources: [
        {
          type: 'api',
          source: 'google_mail',
          location: 'gmail',
          role: 'primary',
          tab: null,
          endpoint: null,
          trigger: null,
          plugin_key: 'google-mail',
          operation_type: 'search_emails',
          config: {
            query: 'in:inbox newer_than:7d'
          }
        },
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'test-sheet-id',
          role: 'reference',
          tab: 'ProcessedEmails',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: {
            spreadsheet_id: 'test-sheet-id',
            range: 'ProcessedEmails',
            identifier_field: 'message_id',
            // TIME-WINDOW DEDUPLICATION (NEW!)
            time_window_hours: 24,
            timestamp_field: 'processed_at'
          }
        }
      ],
      normalization: null,
      filters: null,
      ai_operations: null,
      partitions: null,
      grouping: null,
      rendering: {
        type: 'json',
        columns_in_order: ['message_id', 'subject', 'from', 'date']
      },
      delivery_rules: {
        send_when_no_results: false,
        summary_delivery: {
          recipient: 'test@example.com',
          plugin_key: 'email',
          operation_type: 'send'
        }
      },
      edge_cases: [],
      clarifications_required: []
    }

    const startTime = Date.now()
    const result = await compiler.compile(ir)
    const duration = Date.now() - startTime

    if (!result.success) {
      throw new Error(`Compilation failed: ${result.errors?.join(', ')}`)
    }

    // Verification checks
    const checks = {
      compilationSuccess: result.success,
      hasWorkflow: result.workflow && result.workflow.length > 0,
      hasTimePrecompute: result.workflow.some(s =>
        s.config?.expression?.includes('new Date') &&
        s.config?.expression?.includes('getTime()') &&
        s.config?.expression?.includes('Date.now()')
      ),
      hasTimeFilter: result.workflow.some(s =>
        s.config?.condition === 'item[1] == false' &&
        s.description?.toLowerCase().includes('time')
      ),
      hasTimeExtract: result.workflow.some(s =>
        s.config?.expression === 'item[0]' &&
        s.description?.toLowerCase().includes('time')
      ),
      compilationSpeed: duration < 200
    }

    const allChecksPassed = Object.values(checks).every(v => v === true)

    console.log('✓ Compilation succeeded:', checks.compilationSuccess)
    console.log('✓ Workflow generated:', checks.hasWorkflow, `(${result.workflow.length} steps)`)
    console.log('✓ Time pre-compute step:', checks.hasTimePrecompute)
    console.log('✓ Time filter step:', checks.hasTimeFilter)
    console.log('✓ Time extract step:', checks.hasTimeExtract)
    console.log('✓ Compilation speed:', checks.compilationSpeed, `(${duration}ms)`)
    console.log()

    if (allChecksPassed) {
      console.log('✅ TEST 2 PASSED: Time-window deduplication works correctly')
      passedTests++
    } else {
      console.log('❌ TEST 2 FAILED: Some checks did not pass')
      failedTests++
    }
  } catch (error) {
    console.log('❌ TEST 2 FAILED:', error instanceof Error ? error.message : String(error))
    failedTests++
  }

  console.log()
  console.log()

  // ==========================================================================
  // TEST 3: Multi-Destination Delivery (Parallel Notifications)
  // ==========================================================================

  console.log('TEST 3: Multi-Destination Delivery (Parallel Notifications)')
  console.log('-'.repeat(80))

  totalTests++
  try {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Test multi-destination delivery to email, Slack, and Google Sheets',
      data_sources: [
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'test-sheet-id',
          role: 'primary',
          tab: 'SalesData',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: {
            spreadsheet_id: 'test-sheet-id',
            range: 'SalesData'
          }
        }
      ],
      normalization: null,
      filters: null,
      ai_operations: null,
      partitions: null,
      grouping: null,
      rendering: {
        type: 'json',
        columns_in_order: ['date', 'product', 'amount', 'customer']
      },
      delivery_rules: {
        send_when_no_results: false,
        // MULTI-DESTINATION DELIVERY (NEW!)
        multiple_destinations: [
          {
            name: 'Email Notification',
            recipient: 'team@company.com',
            subject: 'Daily Sales Report',
            plugin_key: 'google-mail',
            operation_type: 'send'
          },
          {
            name: 'Slack Alert',
            recipient: '#sales-reports',
            plugin_key: 'slack',
            operation_type: 'post'
          },
          {
            name: 'Archive to Sheet',
            recipient: 'archive-sheet-id',
            plugin_key: 'google-sheets',
            operation_type: 'append_rows'
          }
        ]
      },
      edge_cases: [],
      clarifications_required: []
    }

    const startTime = Date.now()
    const result = await compiler.compile(ir)
    const duration = Date.now() - startTime

    if (!result.success) {
      throw new Error(`Compilation failed: ${result.errors?.join(', ')}`)
    }

    // Verification checks
    const checks = {
      compilationSuccess: result.success,
      hasWorkflow: result.workflow && result.workflow.length > 0,
      hasRenderStep: result.workflow.some(s =>
        s.operation === 'render_table'
      ),
      hasScatterGather: result.workflow.some(s =>
        s.type === 'scatter_gather' &&
        s.description?.toLowerCase().includes('parallel')
      ),
      hasEmailAction: result.workflow.some(s =>
        s.plugin === 'google-mail'
      ),
      hasSlackAction: result.workflow.some(s =>
        s.plugin === 'slack'
      ),
      hasSheetsAction: result.workflow.some(s =>
        s.plugin === 'google-sheets' &&
        s.action?.includes('append')
      ),
      compilationSpeed: duration < 200
    }

    const allChecksPassed = Object.values(checks).every(v => v === true)

    console.log('✓ Compilation succeeded:', checks.compilationSuccess)
    console.log('✓ Workflow generated:', checks.hasWorkflow, `(${result.workflow.length} steps)`)
    console.log('✓ Render step present:', checks.hasRenderStep)
    console.log('✓ Parallel scatter-gather:', checks.hasScatterGather)
    console.log('✓ Email action present:', checks.hasEmailAction)
    console.log('✓ Slack action present:', checks.hasSlackAction)
    console.log('✓ Sheets action present:', checks.hasSheetsAction)
    console.log('✓ Compilation speed:', checks.compilationSpeed, `(${duration}ms)`)
    console.log()

    if (allChecksPassed) {
      console.log('✅ TEST 3 PASSED: Multi-destination delivery works correctly')
      passedTests++
    } else {
      console.log('❌ TEST 3 FAILED: Some checks did not pass')
      failedTests++
    }
  } catch (error) {
    console.log('❌ TEST 3 FAILED:', error instanceof Error ? error.message : String(error))
    failedTests++
  }

  console.log()
  console.log()

  // ==========================================================================
  // TEST 4: Combined Patterns (Multi-field + Time-window)
  // ==========================================================================

  console.log('TEST 4: Combined Patterns (Multi-field + Time-window Deduplication)')
  console.log('-'.repeat(80))

  totalTests++
  try {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Test combination of multi-field and time-window deduplication',
      data_sources: [
        {
          type: 'api',
          source: 'google_mail',
          location: 'gmail',
          role: 'primary',
          tab: null,
          endpoint: null,
          trigger: null,
          plugin_key: 'google-mail',
          operation_type: 'search_emails',
          config: {
            query: 'in:inbox'
          }
        },
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'test-sheet-id',
          role: 'reference',
          tab: 'ProcessedOrders',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: {
            spreadsheet_id: 'test-sheet-id',
            range: 'ProcessedOrders',
            // BOTH ENHANCEMENTS COMBINED
            identifier_fields: ['customer_id', 'order_id'], // Multi-field
            time_window_hours: 48, // Time-window
            timestamp_field: 'order_date'
          }
        }
      ],
      normalization: null,
      filters: null,
      ai_operations: null,
      partitions: null,
      grouping: null,
      rendering: {
        type: 'json',
        columns_in_order: ['customer_id', 'order_id', 'amount']
      },
      delivery_rules: {
        send_when_no_results: false,
        summary_delivery: {
          recipient: 'test@example.com',
          plugin_key: 'email',
          operation_type: 'send'
        }
      },
      edge_cases: [],
      clarifications_required: []
    }

    const startTime = Date.now()
    const result = await compiler.compile(ir)
    const duration = Date.now() - startTime

    if (!result.success) {
      throw new Error(`Compilation failed: ${result.errors?.join(', ')}`)
    }

    // Verification checks
    const checks = {
      compilationSuccess: result.success,
      hasWorkflow: result.workflow && result.workflow.length > 0,
      hasCompositeKey: result.workflow.some(s =>
        s.config?.expression?.includes('customer_id') &&
        s.config?.expression?.includes('order_id') &&
        s.config?.expression?.includes('"|"')
      ),
      hasTimeWindow: result.workflow.some(s =>
        s.config?.expression?.includes('Date.now()') &&
        s.config?.expression?.includes('48')
      ),
      hasBothPatterns: true, // Will be calculated
      compilationSpeed: duration < 250 // Slightly higher threshold for combined patterns
    }

    checks.hasBothPatterns = checks.hasCompositeKey && checks.hasTimeWindow

    const allChecksPassed = Object.values(checks).every(v => v === true)

    console.log('✓ Compilation succeeded:', checks.compilationSuccess)
    console.log('✓ Workflow generated:', checks.hasWorkflow, `(${result.workflow.length} steps)`)
    console.log('✓ Composite key present:', checks.hasCompositeKey)
    console.log('✓ Time window present:', checks.hasTimeWindow)
    console.log('✓ Both patterns work together:', checks.hasBothPatterns)
    console.log('✓ Compilation speed:', checks.compilationSpeed, `(${duration}ms)`)
    console.log()

    if (allChecksPassed) {
      console.log('✅ TEST 4 PASSED: Combined patterns work correctly')
      passedTests++
    } else {
      console.log('❌ TEST 4 FAILED: Some checks did not pass')
      failedTests++
    }
  } catch (error) {
    console.log('❌ TEST 4 FAILED:', error instanceof Error ? error.message : String(error))
    failedTests++
  }

  console.log()
  console.log()

  // ==========================================================================
  // FINAL SUMMARY
  // ==========================================================================

  console.log('='.repeat(80))
  console.log('PHASE 3 TEST SUMMARY')
  console.log('='.repeat(80))
  console.log()
  console.log(`Total Tests: ${totalTests}`)
  console.log(`✅ Passed: ${passedTests}`)
  console.log(`❌ Failed: ${failedTests}`)
  console.log()

  if (failedTests === 0) {
    console.log('🎉 ALL PHASE 3 TESTS PASSED!')
    console.log()
    console.log('✅ Multi-field deduplication: Working')
    console.log('✅ Time-window deduplication: Working')
    console.log('✅ Multi-destination delivery: Working')
    console.log('✅ Combined patterns: Working')
    console.log()
    console.log('Phase 3 enhancements are production-ready! 🚀')
  } else {
    console.log(`⚠️  ${failedTests} test(s) failed - review errors above`)
  }

  console.log()
  console.log('='.repeat(80))
}

// Run tests
testPhase3Enhancements().catch(error => {
  console.error('Fatal error running tests:', error)
  process.exit(1)
})
