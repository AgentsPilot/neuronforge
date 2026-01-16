/**
 * DeclarativeCompiler Regression Tests
 *
 * Tests for bugs fixed in comprehensive Phase 2 bug fix:
 * - Bug 1: Invalid filter operator `not_in_array`
 * - Bug 2: Null handling for empty lookup sheets
 * - Bug 3: Missing error handling in PluginResolver calls
 */

import { DeclarativeCompiler } from '../lib/agentkit/v6/compiler/DeclarativeCompiler'
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2'
import type { DeclarativeLogicalIR } from '../lib/agentkit/v6/logical-ir/schemas/declarative-ir-types'

describe('DeclarativeCompiler Regression Tests', () => {
  let compiler: DeclarativeCompiler
  let pluginManager: PluginManagerV2

  beforeAll(async () => {
    pluginManager = await PluginManagerV2.getInstance()
    compiler = new DeclarativeCompiler(pluginManager)
  })

  describe('Bug Fix 1: Deduplication with Pre-Computed Boolean Pattern', () => {
    it('should use pre-computed boolean pattern instead of not_in_array operator', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Log Gmail complaints to Google Sheets, avoiding duplicates',
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
              query: 'in:inbox newer_than:7d',
              max_results: null,
              include_attachments: null,
              folder: null,
              spreadsheet_id: null,
              range: null
            }
          },
          {
            type: 'tabular',
            source: 'google_sheets',
            location: '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc',
            role: 'reference',
            tab: 'UrgentEmails',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              query: null,
              max_results: null,
              include_attachments: null,
              folder: null,
              spreadsheet_id: '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc',
              range: 'UrgentEmails',
              identifier_field: 'gmail_message_link_or_id'
            }
          }
        ],
        normalization: null,
        filters: {
          combineWith: 'OR',
          conditions: [],
          groups: [
            {
              combineWith: 'OR',
              conditions: [
                { field: 'subject', operator: 'contains', value: 'complaint', description: 'Complaint keyword' },
                { field: 'subject', operator: 'contains', value: 'refund', description: 'Refund keyword' }
              ]
            }
          ]
        },
        ai_operations: null,
        partitions: null,
        grouping: null,
        rendering: {
          type: 'json',
          template: null,
          engine: null,
          columns_in_order: ['sender_email', 'subject', 'date', 'full_email_text', 'gmail_message_link_or_id'],
          empty_message: null,
          summary_stats: null
        },
        delivery_rules: {
          send_when_no_results: false,
          per_item_delivery: null,
          per_group_delivery: null,
          summary_delivery: {
            recipient: 'google_sheets_destination',
            cc: null,
            subject: 'Append complaint emails',
            include_missing_section: false,
            plugin_key: 'google-sheets',
            operation_type: 'append_rows'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      // Assert compilation succeeds
      expect(result.success).toBe(true)
      expect(result.workflow).toBeDefined()
      expect(result.workflow.length).toBeGreaterThan(0)

      // Find deduplication steps
      const precomputeStep = result.workflow.find(s =>
        s.type === 'transform' &&
        s.operation === 'map' &&
        s.config?.expression?.includes('.includes')
      )
      const filterStep = result.workflow.find(s =>
        s.type === 'transform' &&
        s.operation === 'filter' &&
        s.config?.condition?.includes('item[1] == true')
      )
      const extractStep = result.workflow.find(s =>
        s.type === 'transform' &&
        s.operation === 'map' &&
        s.config?.expression === 'item[0]'
      )

      // Assert pre-computed boolean pattern exists
      expect(precomputeStep).toBeDefined()
      expect(filterStep).toBeDefined()
      expect(extractStep).toBeDefined()

      // Assert NO use of invalid not_in_array operator
      const invalidFilterStep = result.workflow.find(s =>
        s.config?.condition?.operator === 'not_in_array'
      )
      expect(invalidFilterStep).toBeUndefined()

      // Assert null safety with || []
      expect(precomputeStep?.config?.expression).toContain('|| []')

      console.log('✅ Bug Fix 1 verified: Uses pre-computed boolean pattern with null safety')
    })

    it('should handle empty lookup sheet gracefully (null safety)', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Test deduplication with empty lookup sheet',
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
            config: { query: 'in:inbox' }
          },
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'test-sheet-id',
            role: 'reference',
            tab: 'EmptySheet',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'test-sheet-id',
              range: 'EmptySheet',
              identifier_field: 'id'
            }
          }
        ],
        normalization: null,
        filters: null,
        ai_operations: null,
        partitions: null,
        grouping: null,
        rendering: { type: 'json', columns_in_order: ['id', 'subject'] },
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

      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      // Verify null safety in deduplication expression
      const precomputeStep = result.workflow.find(s =>
        s.config?.expression?.includes('.includes')
      )
      expect(precomputeStep?.config?.expression).toContain('|| []')

      console.log('✅ Bug Fix 2 verified: Null safety handles empty lookup sheets')
    })
  })

  describe('Bug Fix 3: Plugin Resolution Error Handling', () => {
    it('should provide clear error when plugin not found', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Test invalid plugin error handling',
        data_sources: [
          {
            type: 'api',
            source: 'invalid_plugin',
            location: 'nowhere',
            role: 'primary',
            tab: null,
            endpoint: null,
            trigger: null,
            plugin_key: 'non-existent-plugin',  // Invalid plugin
            operation_type: 'search',
            config: {}
          }
        ],
        normalization: null,
        filters: null,
        ai_operations: null,
        partitions: null,
        grouping: null,
        rendering: { type: 'json', columns_in_order: ['id'] },
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

      const result = await compiler.compile(ir)

      // Should fail with clear error message
      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors![0]).toContain('Failed to resolve')
      expect(result.errors![0]).toContain('non-existent-plugin')

      console.log('✅ Bug Fix 3 verified: Clear error messages for plugin resolution failures')
    })

    it('should provide clear error when operation not found', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Test invalid operation error handling',
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
            operation_type: 'invalid_operation',  // Invalid operation
            config: {}
          }
        ],
        normalization: null,
        filters: null,
        ai_operations: null,
        partitions: null,
        grouping: null,
        rendering: { type: 'json', columns_in_order: ['id'] },
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

      const result = await compiler.compile(ir)

      // Should fail with clear error message
      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors![0]).toContain('Failed to resolve')
      expect(result.errors![0]).toContain('google-mail')
      expect(result.errors![0]).toContain('invalid_operation')

      console.log('✅ Bug Fix 3 verified: Clear error messages for invalid operations')
    })
  })

  describe('Determinism Verification', () => {
    it('should produce identical output for same IR (10 runs)', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Determinism test workflow',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'test-sheet',
            role: 'primary',
            tab: 'Data',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'test-sheet',
              range: 'Data'
            }
          }
        ],
        normalization: null,
        filters: {
          combineWith: 'AND',
          conditions: [
            { field: 'status', operator: 'equals', value: 'active' }
          ]
        },
        ai_operations: null,
        partitions: null,
        grouping: null,
        rendering: { type: 'json', columns_in_order: ['id', 'name'] },
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

      // Run compilation 10 times
      const results = await Promise.all(
        Array(10).fill(null).map(() => compiler.compile(ir))
      )

      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true)
      })

      // All outputs should be identical (byte-for-byte)
      const firstWorkflow = JSON.stringify(results[0].workflow)
      results.forEach((result, i) => {
        const currentWorkflow = JSON.stringify(result.workflow)
        expect(currentWorkflow).toBe(firstWorkflow)
      })

      console.log('✅ Determinism verified: 10 runs produced identical output')
    })
  })

  describe('Performance Benchmarks', () => {
    it('should compile simple workflow in < 100ms', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Performance test - simple workflow',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'test-sheet',
            role: 'primary',
            tab: 'Data',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: { spreadsheet_id: 'test-sheet', range: 'Data' }
          }
        ],
        normalization: null,
        filters: null,
        ai_operations: null,
        partitions: null,
        grouping: null,
        rendering: { type: 'json', columns_in_order: ['id'] },
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

      expect(result.success).toBe(true)
      expect(duration).toBeLessThan(100)

      console.log(`✅ Performance: Simple workflow compiled in ${duration}ms (target: <100ms)`)
    })

    it('should compile complex workflow with deduplication in < 200ms', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Performance test - complex workflow with dedup',
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
            config: { query: 'in:inbox newer_than:7d' }
          },
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'lookup-sheet',
            role: 'reference',
            tab: 'Processed',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'lookup-sheet',
              range: 'Processed',
              identifier_field: 'message_id'
            }
          }
        ],
        normalization: null,
        filters: {
          combineWith: 'OR',
          conditions: [],
          groups: [
            {
              combineWith: 'OR',
              conditions: [
                { field: 'subject', operator: 'contains', value: 'urgent' },
                { field: 'subject', operator: 'contains', value: 'important' }
              ]
            }
          ]
        },
        ai_operations: null,
        partitions: null,
        grouping: null,
        rendering: { type: 'json', columns_in_order: ['id', 'subject', 'date'] },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'google_sheets_destination',
            plugin_key: 'google-sheets',
            operation_type: 'append_rows'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const startTime = Date.now()
      const result = await compiler.compile(ir)
      const duration = Date.now() - startTime

      expect(result.success).toBe(true)
      expect(duration).toBeLessThan(200)

      console.log(`✅ Performance: Complex workflow compiled in ${duration}ms (target: <200ms)`)
    })
  })
})
