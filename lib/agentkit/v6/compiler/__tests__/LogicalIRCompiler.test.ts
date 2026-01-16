/**
 * Unit Tests for LogicalIRCompiler
 *
 * Tests deterministic compilation of Logical IR → PILOT_DSL workflows.
 */

import { createCompiler } from '../LogicalIRCompiler'
import type { ExtendedLogicalIR } from '../../logical-ir/schemas/extended-ir-types'
import type { WorkflowStep } from '../../../../pilot/types/pilot-dsl-types'

// Helper to create minimal IR with all required fields
const createMinimalIR = (overrides?: Partial<ExtendedLogicalIR>): ExtendedLogicalIR => ({
  ir_version: '2.0',
  goal: 'Test workflow',
  data_sources: [{
    id: 'data',
    type: 'tabular',
    source: 'googlesheets',
    location: 'TestSheet',
    tab: 'Data',
    endpoint: '',
    trigger: '',
    role: 'test data'
  }],
  normalization: {
    required_headers: [],
    case_sensitive: false,
    missing_header_action: 'error'
  },
  filters: [],
  transforms: [],
  ai_operations: [],
  conditionals: [],
  loops: [],
  partitions: [],
  grouping: {
    input_partition: '',
    group_by: '',
    emit_per_group: false
  },
  rendering: {
    type: 'html_table',
    template: '',
    engine: 'handlebars',
    columns_in_order: [],
    empty_message: ''
  },
  delivery: [{
    id: '',
    method: 'email',
    config: {
      recipient: ['test@example.com'],
      recipient_source: '',
      cc: [],
      bcc: [],
      subject: 'Test',
      body: '',
      channel: '',
      message: '',
      url: '',
      endpoint: '',
      method: 'POST',
      headers: '',
      payload: '',
      table: '',
      operation: 'insert',
      path: '',
      format: 'json'
    }
  }],
  edge_cases: [],
  clarifications_required: [],
  ...overrides
})

// ============================================================================
// Test Suite
// ============================================================================

describe('LogicalIRCompiler', () => {
  // ----------------------------------------------------------------------------
  // Basic Functionality Tests
  // ----------------------------------------------------------------------------

  describe('Basic Functionality', () => {
    it('should compile simple IR successfully', async () => {
      const ir = createMinimalIR({
        goal: 'Send weekly report from spreadsheet',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'MySheet',
          tab: 'Data',
          endpoint: '',
          trigger: '',
          role: 'spreadsheet data'
        }],
        delivery: [{
          id: '',
          method: 'email',
          config: {
            recipient: ['test@example.com'],
            recipient_source: '',
            cc: [],
            bcc: [],
            subject: 'Weekly Report',
            body: '',
            channel: '',
            message: '',
            url: '',
            endpoint: '',
            method: 'POST',
            headers: '',
            payload: '',
            table: '',
            operation: 'insert',
            path: '',
            format: 'json'
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)
      expect(result.workflow).toBeDefined()
      expect(result.workflow!.workflow_steps).toBeDefined()
      expect(result.workflow!.workflow_steps.length).toBeGreaterThan(0)
      expect(result.errors).toBeUndefined()
    })

    it('should include metadata in compilation result', async () => {
      const ir = createMinimalIR()

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)
      expect(result.metadata).toBeDefined()
      expect(result.metadata!.rule_used).toBeTruthy()
      expect(result.metadata!.step_count).toBeGreaterThan(0)
      expect(result.metadata!.compilation_time_ms).toBeGreaterThan(0)
      expect(result.metadata!.deterministic_step_percentage).toBeGreaterThanOrEqual(0)
    })

    it('should compile within performance target (<100ms)', async () => {
      const ir = createMinimalIR()

      const compiler = await createCompiler()
      const startTime = Date.now()
      const result = await compiler.compile(ir)
      const duration = Date.now() - startTime

      expect(result.success).toBe(true)
      expect(duration).toBeLessThan(100)
    })
  })

  // ----------------------------------------------------------------------------
  // Rule Matching Tests
  // ----------------------------------------------------------------------------

  describe('Rule Matching', () => {
    it('should match TabularGroupedDeliveryRule for grouped workflows', async () => {
      const ir = createMinimalIR({
        goal: 'Email each sales rep their opportunities',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Opportunities',
          tab: 'Open',
          endpoint: '',
          trigger: '',
          role: 'opportunity data'
        }],
        grouping: {
          input_partition: 'data',
          group_by: 'sales_rep',
          emit_per_group: true
        },
        delivery: [{
          id: '',
          method: 'email',
          config: {
            recipient: '',
            recipient_source: 'email',
            cc: [],
            bcc: [],
            subject: 'Your Opportunities',
            body: '',
            channel: '',
            message: '',
            url: '',
            endpoint: '',
            method: 'POST',
            headers: '',
            payload: '',
            table: '',
            operation: 'insert',
            path: '',
            format: 'json'
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)
      expect(result.metadata!.rule_used).toBe('TabularGroupedDeliveryRule')
    })

    it('should match SimpleWorkflowRule for basic workflows', async () => {
      const ir = createMinimalIR({
        goal: 'Simple email from spreadsheet'
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)
      expect(result.metadata!.rule_used).toBe('SimpleWorkflowRule')
    })

    it('should fail if no rule supports the IR', async () => {
      const ir = createMinimalIR({
        data_sources: [] // No data sources - unsupported
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })
  })

  // ----------------------------------------------------------------------------
  // Data Source Compilation Tests
  // ----------------------------------------------------------------------------

  describe('Data Source Compilation', () => {
    it('should compile tabular data source to action step', async () => {
      const ir = createMinimalIR({
        goal: 'Read spreadsheet',
        data_sources: [{
          id: 'employees',
          type: 'tabular',
          source: 'googlesheets',
          location: 'EmployeeData',
          tab: 'Active',
          endpoint: '',
          trigger: '',
          role: 'employee data'
        }],
        delivery: [{
          id: '',
          method: 'email',
          config: {
            recipient: ['hr@example.com'],
            recipient_source: '',
            cc: [],
            bcc: [],
            subject: '',
            body: '',
            channel: '',
            message: '',
            url: '',
            endpoint: '',
            method: 'POST',
            headers: '',
            payload: '',
            table: '',
            operation: 'insert',
            path: '',
            format: 'json'
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      const readStep = result.workflow!.workflow_steps[0]
      expect(readStep.type).toBe('action')
      expect(readStep.plugin).toBe('googlesheets')
      expect(readStep.operation).toBe('read')
      expect(readStep.config.location).toBe('EmployeeData')
      expect(readStep.config.tab).toBe('Active')
    })

    it('should compile API data source', async () => {
      const ir = createMinimalIR({
        goal: 'Fetch from API',
        data_sources: [{
          id: 'api_data',
          type: 'api',
          source: 'rest_api',
          location: 'https://api.example.com/users',
          endpoint: '/users',
          tab: '',
          trigger: '',
          role: 'api data source'
        }],
        delivery: [{
          id: '',
          method: 'email',
          config: {
            recipient: ['admin@example.com'],
            recipient_source: '',
            cc: [],
            bcc: [],
            subject: '',
            body: '',
            channel: '',
            message: '',
            url: '',
            endpoint: '',
            method: 'POST',
            headers: '',
            payload: '',
            table: '',
            operation: 'insert',
            path: '',
            format: 'json'
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      const readStep = result.workflow!.workflow_steps[0]
      expect(readStep.type).toBe('action')
      expect(readStep.plugin).toBe('rest_api')
    })

    it('should compile multiple data sources', async () => {
      const ir = createMinimalIR({
        goal: 'Join two datasets',
        data_sources: [
          {
            id: 'employees',
            type: 'tabular',
            source: 'googlesheets',
            location: 'Employees',
            tab: 'All',
            endpoint: '',
            trigger: '',
            role: 'employee data'
          },
          {
            id: 'departments',
            type: 'tabular',
            source: 'googlesheets',
            location: 'Departments',
            tab: 'All',
            endpoint: '',
            trigger: '',
            role: 'department data'
          }
        ],
        transforms: [{
          id: '',
          operation: 'join',
          config: {
            source: '',
            field: '',
            group_by: '',
            sort_by: '',
            order: 'asc',
            aggregation: 'sum',
            join_key: 'department_id',
            mapping: ''
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      // Should have two read steps
      const readSteps = result.workflow!.workflow_steps.filter(s => s.operation === 'read')
      expect(readSteps.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ----------------------------------------------------------------------------
  // Filter Compilation Tests
  // ----------------------------------------------------------------------------

  describe('Filter Compilation', () => {
    it('should compile equality filter', async () => {
      const ir = createMinimalIR({
        goal: 'Filter data',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Leads',
          tab: 'All',
          endpoint: '',
          trigger: '',
          role: 'lead data'
        }],
        filters: [{
          id: '',
          field: 'stage',
          operator: 'equals',
          value: 4,
          description: ''
        }],
        delivery: [{
          id: '',
          method: 'email',
          config: {
            recipient: ['sales@example.com'],
            recipient_source: '',
            cc: [],
            bcc: [],
            subject: '',
            body: '',
            channel: '',
            message: '',
            url: '',
            endpoint: '',
            method: 'POST',
            headers: '',
            payload: '',
            table: '',
            operation: 'insert',
            path: '',
            format: 'json'
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      // Should have a transform step for filtering
      const transformStep = result.workflow!.workflow_steps.find(s => s.type === 'transform')
      expect(transformStep).toBeDefined()
    })

    it('should compile multiple filters', async () => {
      const ir = createMinimalIR({
        goal: 'Apply multiple filters',
        filters: [
          {
            id: '',
            field: 'status',
            operator: 'equals',
            value: 'active',
            description: ''
          },
          {
            id: '',
            field: 'revenue',
            operator: 'greater_than',
            value: 1000,
            description: ''
          }
        ]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      // Should have transform steps for each filter
      const transformSteps = result.workflow!.workflow_steps.filter(s => s.type === 'transform')
      expect(transformSteps.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ----------------------------------------------------------------------------
  // Transform Compilation Tests
  // ----------------------------------------------------------------------------

  describe('Transform Compilation', () => {
    it('should compile sort transform', async () => {
      const ir = createMinimalIR({
        goal: 'Sort data',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Orders',
          tab: 'All',
          endpoint: '',
          trigger: '',
          role: 'order data'
        }],
        transforms: [{
          id: '',
          operation: 'sort',
          config: {
            source: '',
            field: 'date',
            group_by: '',
            sort_by: '',
            order: 'desc',
            aggregation: 'sum',
            join_key: '',
            mapping: ''
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      const sortStep = result.workflow!.workflow_steps.find(s =>
        s.type === 'transform' && s.config?.sort_by
      )
      expect(sortStep).toBeDefined()
    })

    it('should compile aggregate transform', async () => {
      const ir = createMinimalIR({
        goal: 'Calculate totals',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Sales',
          tab: 'Data',
          endpoint: '',
          trigger: '',
          role: 'sales data'
        }],
        transforms: [{
          id: '',
          operation: 'aggregate',
          config: {
            source: '',
            field: '',
            group_by: 'region',
            sort_by: '',
            order: 'asc',
            aggregation: 'sum',
            join_key: '',
            mapping: ''
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      const aggStep = result.workflow!.workflow_steps.find(s =>
        s.type === 'transform' && s.config?.aggregate
      )
      expect(aggStep).toBeDefined()
    })
  })

  // ----------------------------------------------------------------------------
  // AI Operation Compilation Tests
  // ----------------------------------------------------------------------------

  describe('AI Operation Compilation', () => {
    it('should compile sentiment analysis operation', async () => {
      const ir = createMinimalIR({
        goal: 'Analyze sentiment',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Feedback',
          tab: 'Responses',
          endpoint: '',
          trigger: '',
          role: 'feedback data'
        }],
        ai_operations: [{
          id: '',
          type: 'sentiment',
          instruction: 'Analyze sentiment of comment',
          input_source: '{{data.comment}}',
          output_schema: {
            type: 'string',
            fields: [],
            enum: ['positive', 'neutral', 'negative']
          },
          constraints: {
            max_tokens: 0,
            temperature: 0,
            model_preference: 'fast'
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      const aiStep = result.workflow!.workflow_steps.find(s => s.type === 'ai_processing')
      expect(aiStep).toBeDefined()
      expect(aiStep!.config.model).toBeTruthy()
      expect(aiStep!.config.prompt).toBeTruthy()
    })

    it('should compile classification operation', async () => {
      const ir = createMinimalIR({
        goal: 'Classify tickets',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Tickets',
          tab: 'All',
          endpoint: '',
          trigger: '',
          role: 'ticket data'
        }],
        ai_operations: [{
          id: '',
          type: 'classify',
          instruction: 'Classify ticket into category',
          input_source: '{{data.description}}',
          output_schema: {
            type: 'string',
            fields: [],
            enum: ['bug', 'feature', 'question', 'other']
          },
          constraints: {
            max_tokens: 0,
            temperature: 0,
            model_preference: 'fast'
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      const aiStep = result.workflow!.workflow_steps.find(s => s.type === 'ai_processing')
      expect(aiStep).toBeDefined()
    })
  })

  // ----------------------------------------------------------------------------
  // Grouping Compilation Tests
  // ----------------------------------------------------------------------------

  describe('Grouping Compilation', () => {
    it('should compile per-group delivery with scatter-gather', async () => {
      const ir = createMinimalIR({
        goal: 'Email per group',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Tasks',
          tab: 'All',
          endpoint: '',
          trigger: '',
          role: 'task data'
        }],
        grouping: {
          input_partition: 'data',
          group_by: 'assignee',
          emit_per_group: true
        },
        delivery: [{
          id: '',
          method: 'email',
          config: {
            recipient: '',
            recipient_source: 'email',
            cc: [],
            bcc: [],
            subject: 'Your Tasks',
            body: '',
            channel: '',
            message: '',
            url: '',
            endpoint: '',
            method: 'POST',
            headers: '',
            payload: '',
            table: '',
            operation: 'insert',
            path: '',
            format: 'json'
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      // Should have scatter step for per-group processing
      const scatterStep = result.workflow!.workflow_steps.find(s =>
        s.type === 'scatter' || (s as any).scatter !== undefined
      )
      expect(scatterStep).toBeDefined()
    })
  })

  // ----------------------------------------------------------------------------
  // Delivery Compilation Tests
  // ----------------------------------------------------------------------------

  describe('Delivery Compilation', () => {
    it('should compile email delivery', async () => {
      const ir = createMinimalIR({
        goal: 'Send email',
        delivery: [{
          id: '',
          method: 'email',
          config: {
            recipient: ['test@example.com'],
            recipient_source: '',
            cc: [],
            bcc: [],
            subject: 'Test Report',
            body: '',
            channel: '',
            message: '',
            url: '',
            endpoint: '',
            method: 'POST',
            headers: '',
            payload: '',
            table: '',
            operation: 'insert',
            path: '',
            format: 'json'
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      const emailStep = result.workflow!.workflow_steps.find(s =>
        s.type === 'action' && s.plugin === 'email'
      )
      expect(emailStep).toBeDefined()
      expect(emailStep!.config.to).toEqual(['test@example.com'])
      expect(emailStep!.config.subject).toBe('Test Report')
    })

    it('should compile Slack delivery', async () => {
      const ir = createMinimalIR({
        goal: 'Send to Slack',
        delivery: [{
          id: '',
          method: 'slack',
          config: {
            recipient: '',
            recipient_source: '',
            cc: [],
            bcc: [],
            subject: '',
            body: '',
            channel: '#engineering',
            message: '',
            url: '',
            endpoint: '',
            method: 'POST',
            headers: '',
            payload: '',
            table: '',
            operation: 'insert',
            path: '',
            format: 'json'
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      const slackStep = result.workflow!.workflow_steps.find(s =>
        s.type === 'action' && s.plugin === 'slack'
      )
      expect(slackStep).toBeDefined()
    })
  })

  // ----------------------------------------------------------------------------
  // Pre-Compilation Validation Tests
  // ----------------------------------------------------------------------------

  describe('Pre-Compilation Validation', () => {
    it('should validate IR before compilation', async () => {
      const validIR = createMinimalIR()

      const compiler = await createCompiler()
      const validation = await compiler.validateBeforeCompilation(validIR)

      expect(validation.valid).toBe(true)
      expect(validation.errors).toEqual([])
    })

    it('should detect invalid IR before compilation', async () => {
      const invalidIR = {
        ir_version: '2.0',
        goal: 'Invalid workflow',
        data_sources: [], // Missing required data sources
        delivery: [] // Missing required delivery
      } as any

      const compiler = await createCompiler()
      const validation = await compiler.validateBeforeCompilation(invalidIR)

      expect(validation.valid).toBe(false)
      expect(validation.errors.length).toBeGreaterThan(0)
    })
  })

  // ----------------------------------------------------------------------------
  // Deterministic Compilation Tests
  // ----------------------------------------------------------------------------

  describe('Deterministic Compilation', () => {
    it('should produce identical results for same IR', async () => {
      const ir = createMinimalIR({
        goal: 'Determinism test',
        filters: [{
          id: '',
          field: 'status',
          operator: 'equals',
          value: 'active',
          description: ''
        }]
      })

      const compiler = await createCompiler()

      // Compile twice
      const result1 = await compiler.compile(ir)
      const result2 = await compiler.compile(ir)

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)

      // Should use same rule
      expect(result1.metadata!.rule_used).toBe(result2.metadata!.rule_used)

      // Should have same number of steps
      expect(result1.workflow!.workflow_steps.length).toBe(
        result2.workflow!.workflow_steps.length
      )

      // Step types should match
      result1.workflow!.workflow_steps.forEach((step1, index) => {
        const step2 = result2.workflow!.workflow_steps[index]
        expect(step1.type).toBe(step2.type)
      })
    })

    it('should have high deterministic step percentage', async () => {
      const ir = createMinimalIR({
        goal: 'High determinism',
        filters: [{
          id: '',
          field: 'status',
          operator: 'equals',
          value: 'active',
          description: ''
        }],
        transforms: [{
          id: '',
          operation: 'sort',
          config: {
            source: '',
            field: 'date',
            group_by: '',
            sort_by: '',
            order: 'desc',
            aggregation: 'sum',
            join_key: '',
            mapping: ''
          }
        }]
      })

      const compiler = await createCompiler()
      const result = await compiler.compile(ir)

      expect(result.success).toBe(true)

      // Should be highly deterministic (>70%)
      expect(result.metadata!.deterministic_step_percentage).toBeGreaterThan(70)
    })
  })
})
