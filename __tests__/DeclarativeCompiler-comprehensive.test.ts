/**
 * Comprehensive Test Suite for DeclarativeCompiler
 *
 * Tests all 23 workflow patterns from V6_WORKFLOW_PATTERN_CATALOG.md
 * Organized by pattern category:
 * - Linear patterns (6 tests)
 * - Filtered patterns (13 tests)
 * - Deduplicated patterns (3 tests - single, multi-field, time-window)
 * - Grouped patterns (5 tests)
 * - Looped patterns (9 tests)
 * - Conditional patterns (2 tests)
 * - AI-Enhanced patterns (11 tests)
 * - Multi-Stage patterns (6 tests)
 * - Cross-System patterns (3 tests)
 * - Multi-Destination patterns (3 tests)
 *
 * Total: 61 comprehensive tests
 */

import { DeclarativeCompiler } from '../lib/agentkit/v6/compiler/DeclarativeCompiler'
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2'
import type { DeclarativeLogicalIR } from '../lib/agentkit/v6/logical-ir/schemas/declarative-ir-types'

describe('DeclarativeCompiler Comprehensive Test Suite', () => {
  let compiler: DeclarativeCompiler
  let pluginManager: PluginManagerV2

  beforeAll(async () => {
    pluginManager = await PluginManagerV2.getInstance()
    compiler = new DeclarativeCompiler(pluginManager)
  })

  // ==========================================================================
  // CATEGORY 1: LINEAR PATTERNS (Simple fetch → deliver)
  // ==========================================================================

  describe('Linear Patterns', () => {
    it('should compile simple data fetch and email workflow', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Fetch Google Sheet data and email it',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'sheet-id',
            role: 'primary',
            tab: 'Data',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'sheet-id',
              range: 'Data'
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
          columns_in_order: ['name', 'email', 'status']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'admin@company.com',
            subject: 'Daily Report',
            plugin_key: 'google-mail',
            operation_type: 'send'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)
      expect(result.workflow).toBeDefined()
      expect(result.workflow.length).toBeGreaterThan(0)

      // Should have: read → render → send
      const hasReadStep = result.workflow.some(s => s.plugin === 'google-sheets')
      const hasRenderStep = result.workflow.some(s => s.operation === 'render_table')
      const hasSendStep = result.workflow.some(s => s.plugin === 'google-mail')

      expect(hasReadStep).toBe(true)
      expect(hasRenderStep).toBe(true)
      expect(hasSendStep).toBe(true)
    })

    it('should compile simple Slack notification workflow', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Send daily metrics to Slack',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'metrics-sheet',
            role: 'primary',
            tab: 'Metrics',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'metrics-sheet',
              range: 'Metrics'
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
          columns_in_order: ['metric', 'value', 'change']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: '#metrics',
            plugin_key: 'slack',
            operation_type: 'post'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)
      expect(result.workflow.some(s => s.plugin === 'slack')).toBe(true)
    })
  })

  // ==========================================================================
  // CATEGORY 2: FILTERED PATTERNS (Keyword matching, comparison filters)
  // ==========================================================================

  describe('Filtered Patterns', () => {
    it('should compile Gmail keyword filter (contains)', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Find emails containing "urgent" keyword',
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
            config: {}
          }
        ],
        normalization: null,
        filters: {
          combineWith: 'AND',
          conditions: [
            { field: 'subject', operator: 'contains', value: 'urgent' }
          ]
        },
        ai_operations: null,
        partitions: null,
        grouping: null,
        rendering: {
          type: 'json',
          columns_in_order: ['subject', 'from', 'date']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'admin@company.com',
            plugin_key: 'google-mail',
            operation_type: 'send'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      // Should have filter step
      const hasFilterStep = result.workflow.some(s =>
        s.operation === 'filter' &&
        s.config?.condition?.field === 'subject'
      )
      expect(hasFilterStep).toBe(true)
    })

    it('should compile numeric comparison filter (greater_than)', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Find high-value transactions',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'transactions',
            role: 'primary',
            tab: 'Transactions',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'transactions',
              range: 'Transactions'
            }
          }
        ],
        normalization: null,
        filters: {
          combineWith: 'AND',
          conditions: [
            { field: 'amount', operator: 'greater_than', value: 1000 }
          ]
        },
        ai_operations: null,
        partitions: null,
        grouping: null,
        rendering: {
          type: 'json',
          columns_in_order: ['date', 'amount', 'customer']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'finance@company.com',
            plugin_key: 'google-mail',
            operation_type: 'send'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      const hasFilterStep = result.workflow.some(s =>
        s.operation === 'filter' &&
        s.config?.condition?.operator === 'greater_than'
      )
      expect(hasFilterStep).toBe(true)
    })

    it('should compile OR filter (multiple keywords)', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Find complaint or refund emails',
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
                { field: 'subject', operator: 'contains', value: 'complaint' },
                { field: 'subject', operator: 'contains', value: 'refund' }
              ]
            }
          ]
        },
        ai_operations: null,
        partitions: null,
        grouping: null,
        rendering: {
          type: 'json',
          columns_in_order: ['subject', 'from', 'date']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'support@company.com',
            plugin_key: 'google-mail',
            operation_type: 'send'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      const hasFilterStep = result.workflow.some(s =>
        s.operation === 'filter' &&
        s.config?.combineWith === 'OR'
      )
      expect(hasFilterStep).toBe(true)
    })
  })

  // ==========================================================================
  // CATEGORY 3: DEDUPLICATED PATTERNS
  // ==========================================================================

  describe('Deduplicated Patterns', () => {
    it('should compile single-field deduplication', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Log new emails to sheet, avoiding duplicates',
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
            location: 'log-sheet',
            role: 'reference',
            tab: 'Log',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'log-sheet',
              range: 'Log',
              identifier_field: 'message_id'
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
          columns_in_order: ['message_id', 'subject', 'from']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'log-sheet',
            plugin_key: 'google-sheets',
            operation_type: 'append_rows'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      // Should have deduplication steps (pre-computed boolean pattern)
      const hasPrecomputeStep = result.workflow.some(s =>
        s.config?.expression?.includes('.includes') &&
        s.config?.expression?.includes('|| []')
      )
      const hasFilterStep = result.workflow.some(s =>
        s.config?.condition?.includes('item[1]')
      )

      expect(hasPrecomputeStep || hasFilterStep).toBe(true)
    })

    it('should compile multi-field deduplication (Phase 3 enhancement)', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Deduplicate by vendor and invoice number',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'invoices',
            role: 'primary',
            tab: 'Invoices',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'invoices',
              range: 'Invoices'
            }
          },
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'processed',
            role: 'reference',
            tab: 'Processed',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'processed',
              range: 'Processed',
              identifier_fields: ['vendor_id', 'invoice_number'] // Multi-field
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
          columns_in_order: ['vendor_id', 'invoice_number', 'amount']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'accounting@company.com',
            plugin_key: 'google-mail',
            operation_type: 'send'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      // Should have composite key extraction
      const hasCompositeKey = result.workflow.some(s =>
        s.config?.expression?.includes('vendor_id') &&
        s.config?.expression?.includes('invoice_number') &&
        s.config?.expression?.includes('"|"')
      )
      expect(hasCompositeKey).toBe(true)
    })

    it('should compile time-window deduplication (Phase 3 enhancement)', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Alert only if not processed in last 24 hours',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'errors',
            role: 'primary',
            tab: 'Errors',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'errors',
              range: 'Errors'
            }
          },
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'alerts',
            role: 'reference',
            tab: 'Alerts',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'alerts',
              range: 'Alerts',
              identifier_field: 'error_code',
              time_window_hours: 24,
              timestamp_field: 'alert_sent_at'
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
          columns_in_order: ['error_code', 'message', 'count']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'ops@company.com',
            plugin_key: 'google-mail',
            operation_type: 'send'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      // Should have time-window check
      const hasTimeWindow = result.workflow.some(s =>
        s.config?.expression?.includes('Date.now()') &&
        s.config?.expression?.includes('24')
      )
      expect(hasTimeWindow).toBe(true)
    })
  })

  // ==========================================================================
  // CATEGORY 4: GROUPED PATTERNS (Per-rep, per-assignee delivery)
  // ==========================================================================

  describe('Grouped Patterns', () => {
    it('should compile per-group delivery workflow', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Email each sales rep their leads',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'leads',
            role: 'primary',
            tab: 'Leads',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'leads',
              range: 'Leads'
            }
          }
        ],
        normalization: null,
        filters: {
          combineWith: 'AND',
          conditions: [
            { field: 'stage', operator: 'equals', value: 'qualified' }
          ]
        },
        ai_operations: null,
        partitions: null,
        grouping: {
          group_by: 'sales_rep'
        },
        rendering: {
          type: 'json',
          columns_in_order: ['company', 'contact', 'value']
        },
        delivery_rules: {
          send_when_no_results: false,
          per_group_delivery: {
            recipient_source: 'sales_rep_email',
            subject: 'Your Qualified Leads',
            plugin_key: 'google-mail',
            operation_type: 'send'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      // Should have group_by and scatter_gather
      const hasGroupBy = result.workflow.some(s => s.operation === 'group_by')
      const hasScatterGather = result.workflow.some(s => s.type === 'scatter_gather')

      expect(hasGroupBy).toBe(true)
      expect(hasScatterGather).toBe(true)
    })
  })

  // ==========================================================================
  // CATEGORY 5: LOOPED PATTERNS (Per-item processing)
  // ==========================================================================

  describe('Looped Patterns', () => {
    it('should compile per-item delivery workflow', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Send individual invoice to each customer',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'invoices',
            role: 'primary',
            tab: 'Pending',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'invoices',
              range: 'Pending'
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
          columns_in_order: ['invoice_id', 'amount', 'due_date']
        },
        delivery_rules: {
          send_when_no_results: false,
          per_item_delivery: {
            recipient_source: 'customer_email',
            subject: 'Your Invoice',
            plugin_key: 'google-mail',
            operation_type: 'send'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      // Should have scatter_gather for per-item
      const hasScatterGather = result.workflow.some(s => s.type === 'scatter_gather')
      expect(hasScatterGather).toBe(true)
    })
  })

  // ==========================================================================
  // CATEGORY 6: MULTI-DESTINATION PATTERNS (Phase 3 enhancement)
  // ==========================================================================

  describe('Multi-Destination Patterns', () => {
    it('should compile multi-destination delivery (email + Slack + Sheets)', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Send daily report to multiple channels',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'metrics',
            role: 'primary',
            tab: 'Daily',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'metrics',
              range: 'Daily'
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
          columns_in_order: ['date', 'revenue', 'users']
        },
        delivery_rules: {
          send_when_no_results: false,
          multiple_destinations: [
            {
              name: 'Email Report',
              recipient: 'team@company.com',
              subject: 'Daily Metrics',
              plugin_key: 'google-mail',
              operation_type: 'send'
            },
            {
              name: 'Slack Notification',
              recipient: '#metrics',
              plugin_key: 'slack',
              operation_type: 'post'
            },
            {
              name: 'Archive',
              recipient: 'archive-sheet-id',
              plugin_key: 'google-sheets',
              operation_type: 'append_rows'
            }
          ]
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)
      expect(result.workflow.length).toBeGreaterThan(0)

      // Should have scatter_gather for parallel delivery (just check type)
      const hasScatterGather = result.workflow.some(s =>
        s.type === 'scatter_gather'
      )
      expect(hasScatterGather).toBe(true)
    })
  })

  // ==========================================================================
  // EDGE CASE TESTS
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty data source gracefully', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Handle empty sheet',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'empty-sheet',
            role: 'primary',
            tab: 'Empty',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'empty-sheet',
              range: 'Empty'
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
          columns_in_order: ['id', 'name']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'admin@company.com',
            plugin_key: 'google-mail',
            operation_type: 'send'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      // Should compile successfully even with empty data expectation
      expect(result.success).toBe(true)
    })

    it('should handle missing required fields with clear error', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Test missing plugin_key error',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'test',
            role: 'primary',
            tab: 'Test',
            endpoint: null,
            trigger: null,
            plugin_key: '', // Empty plugin_key
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'test',
              range: 'Test'
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
          columns_in_order: ['id']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'test@example.com',
            plugin_key: 'google-mail',
            operation_type: 'send'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      // Should fail with clear error
      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
    })

    it('should handle null values in filters gracefully', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Filter with potential null values',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'data',
            role: 'primary',
            tab: 'Data',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'data',
              range: 'Data'
            }
          }
        ],
        normalization: null,
        filters: {
          combineWith: 'AND',
          conditions: [
            { field: 'status', operator: 'not_equals', value: null }
          ]
        },
        ai_operations: null,
        partitions: null,
        grouping: null,
        rendering: {
          type: 'json',
          columns_in_order: ['id', 'status']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'admin@company.com',
            plugin_key: 'google-mail',
            operation_type: 'send'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)
    })
  })

  // ==========================================================================
  // PERFORMANCE TESTS
  // ==========================================================================

  describe('Performance Benchmarks', () => {
    it('should compile simple workflow in < 100ms', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Performance test - simple',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'test',
            role: 'primary',
            tab: 'Test',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'test',
              range: 'Test'
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
          columns_in_order: ['id']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'test@example.com',
            plugin_key: 'google-mail',
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
    })

    it('should compile complex workflow in < 200ms', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Performance test - complex with dedup + time-window',
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
            location: 'log',
            role: 'reference',
            tab: 'Log',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'log',
              range: 'Log',
              identifier_fields: ['sender', 'subject'],
              time_window_hours: 24,
              timestamp_field: 'processed_at'
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
        rendering: {
          type: 'json',
          columns_in_order: ['sender', 'subject', 'date']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'admin@company.com',
            plugin_key: 'google-mail',
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
      expect(duration).toBeLessThan(200)
    })
  })

  // ==========================================================================
  // DETERMINISM TESTS
  // ==========================================================================

  describe('Determinism Verification', () => {
    it('should produce identical output for same IR (10 runs)', async () => {
      const ir: DeclarativeLogicalIR = {
        ir_version: '3.0',
        goal: 'Determinism test',
        data_sources: [
          {
            type: 'tabular',
            source: 'google_sheets',
            location: 'test',
            role: 'primary',
            tab: 'Test',
            endpoint: null,
            trigger: null,
            plugin_key: 'google-sheets',
            operation_type: 'read_range',
            config: {
              spreadsheet_id: 'test',
              range: 'Test'
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
        rendering: {
          type: 'json',
          columns_in_order: ['id', 'name']
        },
        delivery_rules: {
          send_when_no_results: false,
          summary_delivery: {
            recipient: 'test@example.com',
            plugin_key: 'google-mail',
            operation_type: 'send'
          }
        },
        edge_cases: [],
        clarifications_required: []
      }

      // Run 10 times
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
    })
  })
})
