/**
 * Unit Tests for IRToNaturalLanguageTranslator
 *
 * Tests template-based translation of Logical IR → Natural Language Plan.
 * This is deterministic (no LLM) and should be fast (<50ms).
 */

import { createTranslator } from '../IRToNaturalLanguageTranslator'
import type { ExtendedLogicalIR } from '../../logical-ir/schemas/extended-ir-types'

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
  }],
  edge_cases: [],
  clarifications_required: [],
  ...overrides
})

// ============================================================================
// Test Suite
// ============================================================================

describe('IRToNaturalLanguageTranslator', () => {
  const translator = createTranslator()

  // ----------------------------------------------------------------------------
  // Basic Functionality Tests
  // ----------------------------------------------------------------------------

  describe('Basic Functionality', () => {
    it('should translate simple IR to natural language plan', () => {
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

      const plan = translator.translate(ir)

      expect(plan.goal).toBe('Send weekly report from spreadsheet')
      expect(plan.steps).toBeDefined()
      expect(plan.steps.length).toBeGreaterThan(0)
    })

    it('should translate within performance target (<50ms)', () => {
      const ir = createMinimalIR()

      const startTime = Date.now()
      const plan = translator.translate(ir)
      const duration = Date.now() - startTime

      expect(plan.steps.length).toBeGreaterThan(0)
      expect(duration).toBeLessThan(50)
    })

    it('should be deterministic (same IR → same plan)', () => {
      const ir = createMinimalIR()

      const plan1 = translator.translate(ir)
      const plan2 = translator.translate(ir)

      expect(plan1.goal).toBe(plan2.goal)
      expect(plan1.steps.length).toBe(plan2.steps.length)

      plan1.steps.forEach((step, index) => {
        expect(step.title).toBe(plan2.steps[index].title)
        expect(step.type).toBe(plan2.steps[index].type)
      })
    })
  })

  // ----------------------------------------------------------------------------
  // Data Source Translation Tests
  // ----------------------------------------------------------------------------

  describe('Data Source Translation', () => {
    it('should translate tabular data source', () => {
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

      const plan = translator.translate(ir)

      const dataStep = plan.steps.find(s => s.type === 'data')
      expect(dataStep).toBeDefined()
      expect(dataStep!.icon).toBe('📊')
      expect(dataStep!.title).toContain('spreadsheet')
      expect(dataStep!.details.some(d => d.includes('EmployeeData'))).toBe(true)
      expect(dataStep!.details.some(d => d.includes('Active'))).toBe(true)
    })

    it('should translate API data source', () => {
      const ir = createMinimalIR({
        goal: 'Fetch from API',
        data_sources: [{
          id: 'api_data',
          type: 'api',
          source: 'rest_api',
          location: 'https://api.example.com/users',
          endpoint: '/api',
          tab: '',
          trigger: '',
          role: 'api data source'
        }]
      })

      const plan = translator.translate(ir)

      const dataStep = plan.steps.find(s => s.type === 'data')
      expect(dataStep).toBeDefined()
      expect(dataStep!.icon).toBe('🌐')
      expect(dataStep!.title).toContain('API')
      expect(dataStep!.details.some(d => d.includes('api.example.com'))).toBe(true)
    })

    it('should translate webhook data source', () => {
      const ir = createMinimalIR({
        goal: 'Handle webhook',
        data_sources: [{
          id: 'webhook_data',
          type: 'webhook',
          source: 'webhook',
          location: '/webhooks/stripe',
          trigger: 'payment_event',
          tab: '',
          endpoint: '',
          role: 'webhook event handler'
        }]
      })

      const plan = translator.translate(ir)

      const dataStep = plan.steps.find(s => s.type === 'data')
      expect(dataStep).toBeDefined()
      expect(dataStep!.icon).toBe('🔗')
      expect(dataStep!.title).toContain('webhook')
    })

    it('should translate multiple data sources', () => {
      const ir = createMinimalIR({
        goal: 'Join datasets',
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
        ]
      })

      const plan = translator.translate(ir)

      const dataSteps = plan.steps.filter(s => s.type === 'data')
      expect(dataSteps.length).toBe(2)
    })
  })

  // ----------------------------------------------------------------------------
  // Filter Translation Tests
  // ----------------------------------------------------------------------------

  describe('Filter Translation', () => {
    it('should translate equality filter', () => {
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
          description: 'Filter to qualified leads'
        }]
      })

      const plan = translator.translate(ir)

      const filterStep = plan.steps.find(s => s.type === 'filter')
      expect(filterStep).toBeDefined()
      expect(filterStep!.icon).toBe('🔍')
      expect(filterStep!.title).toContain('Filter')
      expect(filterStep!.details.some(d => d.includes('stage'))).toBe(true)
      expect(filterStep!.details.some(d => d.includes('equals'))).toBe(true)
      expect(filterStep!.details.some(d => d.includes('4'))).toBe(true)
    })

    it('should translate comparison filters', () => {
      const ir = createMinimalIR({
        goal: 'Filter by revenue',
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
        filters: [{
          id: '',
          field: 'revenue',
          operator: 'greater_than',
          value: 1000,
          description: ''
        }]
      })

      const plan = translator.translate(ir)

      const filterStep = plan.steps.find(s => s.type === 'filter')
      expect(filterStep).toBeDefined()
      expect(filterStep!.details.some(d => d.includes('greater than'))).toBe(true)
      expect(filterStep!.details.some(d => d.includes('1000'))).toBe(true)
    })

    it('should translate multiple filters', () => {
      const ir = createMinimalIR({
        goal: 'Apply filters',
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
            value: 500,
            description: ''
          }
        ]
      })

      const plan = translator.translate(ir)

      const filterSteps = plan.steps.filter(s => s.type === 'filter')
      expect(filterSteps.length).toBe(2)
    })
  })

  // ----------------------------------------------------------------------------
  // Transform Translation Tests
  // ----------------------------------------------------------------------------

  describe('Transform Translation', () => {
    it('should translate sort transform', () => {
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

      const plan = translator.translate(ir)

      const transformStep = plan.steps.find(s => s.type === 'transform')
      expect(transformStep).toBeDefined()
      expect(transformStep!.icon).toBe('🔄')
      expect(transformStep!.title).toContain('Sort')
      expect(transformStep!.details.some(d => d.includes('date'))).toBe(true)
      expect(transformStep!.details.some(d => d.includes('descending'))).toBe(true)
    })

    it('should translate aggregate transform', () => {
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

      const plan = translator.translate(ir)

      const transformStep = plan.steps.find(s => s.type === 'transform')
      expect(transformStep).toBeDefined()
      expect(transformStep!.title).toContain('Aggregate')
      expect(transformStep!.details.some(d => d.includes('region'))).toBe(true)
      expect(transformStep!.details.some(d => d.includes('sum'))).toBe(true)
    })

    it('should translate join transform', () => {
      const ir = createMinimalIR({
        goal: 'Join datasets',
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

      const plan = translator.translate(ir)

      const transformStep = plan.steps.find(s => s.type === 'transform')
      expect(transformStep).toBeDefined()
      expect(transformStep!.title).toContain('Join')
      expect(transformStep!.details.some(d => d.includes('department_id'))).toBe(true)
    })
  })

  // ----------------------------------------------------------------------------
  // AI Operation Translation Tests
  // ----------------------------------------------------------------------------

  describe('AI Operation Translation', () => {
    it('should translate sentiment analysis operation', () => {
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
          instruction: 'Analyze sentiment of comment field',
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

      const plan = translator.translate(ir)

      const aiStep = plan.steps.find(s => s.type === 'ai')
      expect(aiStep).toBeDefined()
      expect(aiStep!.icon).toBe('🤖')
      expect(aiStep!.title).toContain('Sentiment Analysis')
      expect(aiStep!.details.some(d => d.includes('comment'))).toBe(true)
    })

    it('should translate classification operation', () => {
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

      const plan = translator.translate(ir)

      const aiStep = plan.steps.find(s => s.type === 'ai')
      expect(aiStep).toBeDefined()
      expect(aiStep!.title).toContain('Classify')
      expect(aiStep!.details.some(d =>
        d.includes('bug') || d.includes('feature')
      )).toBe(true)
    })

    it('should translate summarization operation', () => {
      const ir = createMinimalIR({
        goal: 'Summarize articles',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Articles',
          tab: 'Data',
          endpoint: '',
          trigger: '',
          role: 'article data'
        }],
        ai_operations: [{
          id: '',
          type: 'summarize',
          instruction: 'Summarize each article in 2 sentences',
          input_source: '{{data.content}}',
          output_schema: {
            type: 'string',
            fields: [],
            enum: []
          },
          constraints: {
            max_tokens: 100,
            temperature: 0,
            model_preference: 'fast'
          }
        }]
      })

      const plan = translator.translate(ir)

      const aiStep = plan.steps.find(s => s.type === 'ai')
      expect(aiStep).toBeDefined()
      expect(aiStep!.title).toContain('Summarize')
    })

    it('should translate extraction operation', () => {
      const ir = createMinimalIR({
        goal: 'Extract data',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Contracts',
          tab: 'All',
          endpoint: '',
          trigger: '',
          role: 'contract data'
        }],
        ai_operations: [{
          id: '',
          type: 'extract',
          instruction: 'Extract contract end date',
          input_source: '{{data.document}}',
          output_schema: {
            type: 'object',
            fields: [{
              name: 'end_date',
              type: 'string',
              required: true,
              description: ''
            }],
            enum: []
          },
          constraints: {
            max_tokens: 0,
            temperature: 0,
            model_preference: 'fast'
          }
        }]
      })

      const plan = translator.translate(ir)

      const aiStep = plan.steps.find(s => s.type === 'ai')
      expect(aiStep).toBeDefined()
      expect(aiStep!.title).toContain('Extract')
    })
  })

  // ----------------------------------------------------------------------------
  // Grouping Translation Tests
  // ----------------------------------------------------------------------------

  describe('Grouping Translation', () => {
    it('should translate per-group delivery', () => {
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

      const plan = translator.translate(ir)

      const partitionStep = plan.steps.find(s => s.type === 'partition')
      expect(partitionStep).toBeDefined()
      expect(partitionStep!.icon).toBe('📦')
      expect(partitionStep!.title).toContain('Group')
      expect(partitionStep!.details.some(d => d.includes('assignee'))).toBe(true)
    })
  })

  // ----------------------------------------------------------------------------
  // Delivery Translation Tests
  // ----------------------------------------------------------------------------

  describe('Delivery Translation', () => {
    it('should translate email delivery', () => {
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

      const plan = translator.translate(ir)

      const deliveryStep = plan.steps.find(s => s.type === 'delivery')
      expect(deliveryStep).toBeDefined()
      expect(deliveryStep!.icon).toBe('📧')
      expect(deliveryStep!.title).toContain('Email')
      expect(deliveryStep!.details.some(d => d.includes('test@example.com'))).toBe(true)
      expect(deliveryStep!.details.some(d => d.includes('Test Report'))).toBe(true)
    })

    it('should translate Slack delivery', () => {
      const ir = createMinimalIR({
        goal: 'Send to Slack',
        delivery: [{
          id: '',
          method: 'slack',
          config: {
            recipient: ['#engineering'],
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

      const plan = translator.translate(ir)

      const deliveryStep = plan.steps.find(s => s.type === 'delivery')
      expect(deliveryStep).toBeDefined()
      expect(deliveryStep!.icon).toBe('💬')
      expect(deliveryStep!.title).toContain('Slack')
      expect(deliveryStep!.details.some(d => d.includes('#engineering'))).toBe(true)
    })

    it('should translate webhook delivery', () => {
      const ir = createMinimalIR({
        goal: 'POST to webhook',
        delivery: [{
          id: '',
          method: 'webhook',
          config: {
            recipient: '',
            recipient_source: '',
            cc: [],
            bcc: [],
            subject: '',
            body: '',
            channel: '',
            message: '',
            url: 'https://api.example.com/webhook',
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

      const plan = translator.translate(ir)

      const deliveryStep = plan.steps.find(s => s.type === 'delivery')
      expect(deliveryStep).toBeDefined()
      expect(deliveryStep!.icon).toBe('🔗')
      expect(deliveryStep!.title).toContain('Webhook')
      expect(deliveryStep!.details.some(d => d.includes('api.example.com'))).toBe(true)
    })
  })

  // ----------------------------------------------------------------------------
  // Edge Case Translation Tests
  // ----------------------------------------------------------------------------

  describe('Edge Case Translation', () => {
    it('should translate edge cases', () => {
      const ir = createMinimalIR({
        goal: 'Process with edge cases',
        edge_cases: [{
          condition: 'no_rows_after_filter',
          action: 'send_empty_result_message',
          message: 'No data found',
          recipient: 'admin@example.com'
        }]
      })

      const plan = translator.translate(ir)

      expect(plan.edgeCases).toBeDefined()
      expect(plan.edgeCases!.length).toBeGreaterThan(0)
      expect(plan.edgeCases![0]).toContain('empty')
    })
  })

  // ----------------------------------------------------------------------------
  // Estimation Tests
  // ----------------------------------------------------------------------------

  describe('Estimation', () => {
    it('should include estimation for email delivery', () => {
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

      const plan = translator.translate(ir)

      expect(plan.estimation).toBeDefined()
      expect(plan.estimation.emails).toBeDefined()
      expect(plan.estimation.time).toBeDefined()
    })

    it('should include estimation for Slack delivery', () => {
      const ir = createMinimalIR({
        goal: 'Send to Slack',
        delivery: [{
          id: '',
          method: 'slack',
          config: {
            recipient: ['#engineering'],
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

      const plan = translator.translate(ir)

      expect(plan.estimation).toBeDefined()
      expect(plan.estimation.slackMessages).toBeDefined()
    })
  })

  // ----------------------------------------------------------------------------
  // Clarification Tests
  // ----------------------------------------------------------------------------

  describe('Clarifications', () => {
    it('should include clarifications in plan', () => {
      const ir = createMinimalIR({
        goal: 'Process data',
        clarifications_required: [
          'Which column should be used for filtering?',
          'What format should the output be in?'
        ]
      })

      const plan = translator.translate(ir)

      expect(plan.clarifications).toBeDefined()
      expect(plan.clarifications!.length).toBe(2)
      expect(plan.clarifications![0]).toContain('column')
    })
  })
})
