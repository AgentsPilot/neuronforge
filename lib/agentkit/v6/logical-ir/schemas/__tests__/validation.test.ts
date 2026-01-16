/**
 * Unit Tests for Extended IR Schema Validation
 *
 * Tests cover:
 * 1. Zod schema validation
 * 2. Custom validation rules
 * 3. IR normalization
 * 4. Error messaging
 */

import { describe, it, expect } from '@jest/globals'
import {
  validateIR,
  normalizeIR,
  ExtendedLogicalIRSchema,
  DataSourceSchema,
  FilterSchema,
  AIOperationSchema,
  ConditionalSchema,
  LoopSchema,
  DeliverySchema,
} from '../extended-ir-validation'
import type { ExtendedLogicalIR, AIOperation, Conditional, Loop } from '../extended-ir-types'

// Helper to create minimal IR with all required fields
const createMinimalIR = (overrides?: Partial<ExtendedLogicalIR>): ExtendedLogicalIR => ({
  ir_version: '2.0',
  goal: 'Send stage 4 leads to sales people',
  data_sources: [{
    id: 'leads_data',
    type: 'tabular',
    source: 'googlesheets',
    location: 'MyLeads',
    tab: 'Leads',
    endpoint: '',
    trigger: '',
    role: 'lead data',
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
      recipient: 'test@example.com',
      recipient_source: '',
      cc: [],
      bcc: [],
      subject: 'Test',
      body: 'Test body',
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
    },
  }],
  edge_cases: [],
  clarifications_required: [],
  ...overrides
})

describe('ExtendedLogicalIRSchema - Zod Validation', () => {
  const validMinimalIR = createMinimalIR()

  it('should validate minimal valid IR', () => {
    const result = ExtendedLogicalIRSchema.safeParse(validMinimalIR)
    expect(result.success).toBe(true)
  })

  it('should reject IR missing required fields', () => {
    const invalidIR = {
      ir_version: '2.0',
      goal: 'Test',
      // Missing data_sources
      delivery: [],
      clarifications_required: [],
    }
    const result = ExtendedLogicalIRSchema.safeParse(invalidIR)
    expect(result.success).toBe(false)
  })

  it('should reject IR with goal too short', () => {
    const invalidIR = {
      ...validMinimalIR,
      goal: 'Hi', // Only 2 characters
    }
    const result = ExtendedLogicalIRSchema.safeParse(invalidIR)
    expect(result.success).toBe(false)
  })

  it('should reject IR with empty data_sources', () => {
    const invalidIR = createMinimalIR({
      data_sources: [],
    })
    const result = ExtendedLogicalIRSchema.safeParse(invalidIR)
    expect(result.success).toBe(false)
  })

  it('should reject IR with empty delivery', () => {
    const invalidIR = createMinimalIR({
      delivery: [],
    })
    const result = ExtendedLogicalIRSchema.safeParse(invalidIR)
    expect(result.success).toBe(false)
  })

  it('should validate IR with all optional fields', () => {
    const fullIR = createMinimalIR({
      normalization: {
        required_headers: ['Name', 'Email'],
        case_sensitive: false,
        missing_header_action: 'error',
      },
      filters: [{
        id: '',
        field: 'stage',
        operator: 'equals',
        value: 4,
        description: ''
      }],
      transforms: [{
        id: '',
        operation: 'sort',
        config: {
          source: '',
          field: '',
          group_by: '',
          sort_by: 'created_at',
          order: 'desc',
          aggregation: 'sum',
          join_key: '',
          mapping: ''
        },
      }],
      ai_operations: [{
        id: '',
        type: 'classify',
        instruction: 'Classify lead quality as hot/warm/cold',
        input_source: '{{lead.description}}',
        output_schema: {
          type: 'string',
          fields: [],
          enum: ['hot', 'warm', 'cold'],
        },
        constraints: {
          max_tokens: 0,
          temperature: 0,
          model_preference: 'fast'
        }
      }],
      conditionals: [{
        id: '',
        when: {
          type: 'simple',
          field: 'stage',
          operator: 'equals',
          value: 4,
        },
        then: [],
        else: []
      }],
      loops: [{
        id: '',
        for_each: '{{filtered_leads}}',
        item_variable: 'lead',
        do: [],
        max_iterations: 0,
        max_concurrency: 0
      }],
      partitions: [{
        id: '',
        field: 'Sales Person',
        split_by: 'value',
        handle_empty: {
          partition_name: '',
          description: ''
        }
      }],
      rendering: {
        type: 'html_table',
        template: '',
        engine: 'handlebars',
        columns_in_order: ['Name', 'Email', 'Stage'],
        empty_message: ''
      },
      edge_cases: [{
        condition: 'no_rows_after_filter',
        action: 'send_empty_result_message',
        message: 'No stage 4 leads found',
        recipient: ''
      }],
    })

    const result = ExtendedLogicalIRSchema.safeParse(fullIR)
    expect(result.success).toBe(true)
  })
})

describe('DataSourceSchema', () => {
  it('should validate tabular data source', () => {
    const dataSource = {
      id: 'leads',
      type: 'tabular',
      source: 'googlesheets',
      location: 'MySheet',
      tab: 'Leads',
      endpoint: '',
      trigger: '',
      role: 'lead data',
    }
    const result = DataSourceSchema.safeParse(dataSource)
    expect(result.success).toBe(true)
  })

  it('should validate API data source', () => {
    const dataSource = {
      id: 'api_data',
      type: 'api',
      source: 'rest_api',
      location: 'https://api.example.com',
      endpoint: '/leads',
      tab: '',
      trigger: '',
      role: 'api data source',
    }
    const result = DataSourceSchema.safeParse(dataSource)
    expect(result.success).toBe(true)
  })

  it('should validate webhook data source', () => {
    const dataSource = {
      id: 'webhook_data',
      type: 'webhook',
      source: 'webhook',
      location: '/webhooks/new-lead',
      trigger: 'new_lead_created',
      tab: '',
      endpoint: '',
      role: 'webhook event handler',
    }
    const result = DataSourceSchema.safeParse(dataSource)
    expect(result.success).toBe(true)
  })

  it('should reject invalid data source type', () => {
    const dataSource = {
      id: 'test',
      type: 'invalid_type',
      source: 'test_source',
      location: 'test',
      tab: '',
      endpoint: '',
      trigger: '',
      role: 'test data',
    }
    const result = DataSourceSchema.safeParse(dataSource)
    expect(result.success).toBe(false)
  })
})

describe('FilterSchema', () => {
  it('should validate equals filter', () => {
    const filter = {
      id: '',
      field: 'stage',
      operator: 'equals',
      value: 4,
      description: ''
    }
    const result = FilterSchema.safeParse(filter)
    expect(result.success).toBe(true)
  })

  it('should validate contains filter', () => {
    const filter = {
      id: '',
      field: 'name',
      operator: 'contains',
      value: 'Corp',
      description: ''
    }
    const result = FilterSchema.safeParse(filter)
    expect(result.success).toBe(true)
  })

  it('should validate is_empty filter (no value needed)', () => {
    const filter = {
      id: '',
      field: 'sales_person',
      operator: 'is_empty',
      value: null,
      description: ''
    }
    const result = FilterSchema.safeParse(filter)
    expect(result.success).toBe(true)
  })

  it('should reject invalid operator', () => {
    const filter = {
      id: '',
      field: 'stage',
      operator: 'invalid_op',
      value: 4,
      description: ''
    }
    const result = FilterSchema.safeParse(filter)
    expect(result.success).toBe(false)
  })
})

describe('AIOperationSchema', () => {
  it('should validate classify operation', () => {
    const aiOp: AIOperation = {
      id: '',
      type: 'classify',
      instruction: 'Classify lead quality',
      input_source: '{{lead.description}}',
      output_schema: {
        type: 'string',
        fields: [],
        enum: ['hot', 'warm', 'cold'],
      },
      constraints: {
        max_tokens: 0,
        temperature: 0,
        model_preference: 'fast'
      }
    }
    const result = AIOperationSchema.safeParse(aiOp)
    expect(result.success).toBe(true)
  })

  it('should validate extract operation with object schema', () => {
    const aiOp: AIOperation = {
      id: '',
      type: 'extract',
      instruction: 'Extract contact info from email',
      input_source: '{{email.body}}',
      output_schema: {
        type: 'object',
        fields: [
          { name: 'name', type: 'string', required: true, description: '' },
          { name: 'email', type: 'string', required: true, description: '' },
          { name: 'phone', type: 'string', required: false, description: '' },
        ],
        enum: []
      },
      constraints: {
        max_tokens: 0,
        temperature: 0,
        model_preference: 'fast'
      }
    }
    const result = AIOperationSchema.safeParse(aiOp)
    expect(result.success).toBe(true)
  })

  it('should validate summarize operation', () => {
    const aiOp: AIOperation = {
      id: '',
      type: 'summarize',
      instruction: 'Summarize customer feedback in 2 sentences',
      input_source: '{{feedback.text}}',
      output_schema: {
        type: 'string',
        fields: [],
        enum: []
      },
      constraints: {
        max_tokens: 100,
        temperature: 0.3,
        model_preference: 'fast',
      },
    }
    const result = AIOperationSchema.safeParse(aiOp)
    expect(result.success).toBe(true)
  })

  it('should reject AI operation without output_schema', () => {
    const aiOp = {
      id: '',
      type: 'classify',
      instruction: 'Classify lead quality',
      input_source: '{{lead}}',
      // Missing output_schema
    }
    const result = AIOperationSchema.safeParse(aiOp)
    expect(result.success).toBe(false)
  })

  it('should reject invalid AI operation type', () => {
    const aiOp = {
      id: '',
      type: 'invalid_type',
      instruction: 'Do something',
      input_source: '{{data}}',
      output_schema: { type: 'string', fields: [], enum: [] },
      constraints: {
        max_tokens: 0,
        temperature: 0,
        model_preference: 'fast'
      }
    }
    const result = AIOperationSchema.safeParse(aiOp)
    expect(result.success).toBe(false)
  })
})

describe('ConditionalSchema', () => {
  it('should validate simple conditional', () => {
    const conditional: Conditional = {
      id: '',
      when: {
        type: 'simple',
        field: 'stage',
        operator: 'equals',
        value: 4,
      },
      then: [],
      else: []
    }
    const result = ConditionalSchema.safeParse(conditional)
    expect(result.success).toBe(true)
  })

  it('should validate conditional with else branch', () => {
    const conditional: Conditional = {
      id: '',
      when: {
        type: 'simple',
        field: 'priority',
        operator: 'equals',
        value: 'high',
      },
      then: ['Send urgent email to urgent@example.com'],
      else: ['Send normal email to normal@example.com'],
    }
    const result = ConditionalSchema.safeParse(conditional)
    expect(result.success).toBe(true)
  })

  it('should reject conditional without when clause', () => {
    const conditional = {
      id: '',
      then: [],
      else: []
    }
    const result = ConditionalSchema.safeParse(conditional)
    expect(result.success).toBe(false)
  })

  it('should reject conditional without then clause', () => {
    const conditional = {
      id: '',
      when: {
        type: 'simple',
        field: 'test',
        operator: 'equals',
        value: 1,
      },
      else: []
    }
    const result = ConditionalSchema.safeParse(conditional)
    expect(result.success).toBe(false)
  })
})

describe('LoopSchema', () => {
  it('should validate basic loop', () => {
    const loop: Loop = {
      id: '',
      for_each: '{{filtered_leads}}',
      item_variable: 'lead',
      do: [],
      max_iterations: 0,
      max_concurrency: 0
    }
    const result = LoopSchema.safeParse(loop)
    expect(result.success).toBe(true)
  })

  it('should validate loop with constraints', () => {
    const loop: Loop = {
      id: '',
      for_each: '{{customers}}',
      item_variable: 'customer',
      do: [],
      max_iterations: 100,
      max_concurrency: 5,
    }
    const result = LoopSchema.safeParse(loop)
    expect(result.success).toBe(true)
  })

  it('should reject loop without for_each', () => {
    const loop = {
      id: '',
      item_variable: 'item',
      do: [],
      max_iterations: 0,
      max_concurrency: 0
    }
    const result = LoopSchema.safeParse(loop)
    expect(result.success).toBe(false)
  })

  it('should reject loop without item_variable', () => {
    const loop = {
      id: '',
      for_each: '{{items}}',
      do: [],
      max_iterations: 0,
      max_concurrency: 0
    }
    const result = LoopSchema.safeParse(loop)
    expect(result.success).toBe(false)
  })
})

describe('DeliverySchema', () => {
  it('should validate email delivery', () => {
    const delivery = {
      id: '',
      method: 'email',
      config: {
        recipient: 'test@example.com',
        recipient_source: '',
        cc: ['cc@example.com'],
        bcc: [],
        subject: 'Test Subject',
        body: 'Test body',
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
      },
    }
    const result = DeliverySchema.safeParse(delivery)
    expect(result.success).toBe(true)
  })

  it('should validate slack delivery', () => {
    const delivery = {
      id: '',
      method: 'slack',
      config: {
        recipient: '',
        recipient_source: '',
        cc: [],
        bcc: [],
        subject: '',
        body: '',
        channel: '#general',
        message: 'New leads available',
        url: '',
        endpoint: '',
        method: 'POST',
        headers: '',
        payload: '',
        table: '',
        operation: 'insert',
        path: '',
        format: 'json'
      },
    }
    const result = DeliverySchema.safeParse(delivery)
    expect(result.success).toBe(true)
  })

  it('should validate webhook delivery', () => {
    const delivery = {
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
        url: 'https://example.com/webhook',
        endpoint: '',
        method: 'POST',
        headers: '',
        payload: '',
        table: '',
        operation: 'insert',
        path: '',
        format: 'json'
      },
    }
    const result = DeliverySchema.safeParse(delivery)
    expect(result.success).toBe(true)
  })

  it('should reject invalid delivery method', () => {
    const delivery = {
      id: '',
      method: 'invalid_method',
      config: {},
    }
    const result = DeliverySchema.safeParse(delivery)
    expect(result.success).toBe(false)
  })
})

describe('validateIR - Custom Validation Rules', () => {
  const validIR = createMinimalIR()

  it('should validate correct IR', () => {
    const result = validateIR(validIR)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should reject IR with execution tokens (plugin)', () => {
    const invalidIR = {
      ...validIR,
      data_sources: [
        {
          id: 'leads_data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'MyLeads',
          tab: 'Leads',
          endpoint: '',
          trigger: '',
          role: 'lead data',
          plugin: 'google-sheets', // Execution token!
        },
      ],
    }
    const result = validateIR(invalidIR)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('execution token'))).toBe(true)
  })

  it('should reject IR with execution tokens (step_id)', () => {
    const invalidIR = {
      ...validIR,
      delivery: [
        {
          ...validIR.delivery[0],
          step_id: 'step1', // Execution token!
        },
      ],
    }
    const result = validateIR(invalidIR)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('execution token'))).toBe(true)
  })

  it('should reject IR with execution tokens (workflow_steps)', () => {
    const invalidIR: any = {
      ...validIR,
      workflow_steps: [], // Execution token!
    }
    const result = validateIR(invalidIR)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('execution token'))).toBe(true)
  })

  it('should reject invalid variable syntax (missing braces)', () => {
    const invalidIR = createMinimalIR({
      ai_operations: [{
        id: '',
        type: 'summarize',
        instruction: 'Summarize lead info',
        input_source: 'lead.description', // Should be {{lead.description}}
        output_schema: { type: 'string', fields: [], enum: [] },
        constraints: {
          max_tokens: 0,
          temperature: 0,
          model_preference: 'fast'
        }
      }],
    })
    const result = validateIR(invalidIR)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('variable reference'))).toBe(true)
  })

  it('should accept valid variable syntax', () => {
    const validIRWithVars = createMinimalIR({
      ai_operations: [{
        id: '',
        type: 'summarize',
        instruction: 'Summarize lead info',
        input_source: '{{lead.description}}', // Correct syntax
        output_schema: { type: 'string', fields: [], enum: [] },
        constraints: {
          max_tokens: 0,
          temperature: 0,
          model_preference: 'fast'
        }
      }],
    })
    const result = validateIR(validIRWithVars)
    expect(result.valid).toBe(true)
  })

  it('should reject AI operation without output_schema', () => {
    const invalidIR: any = {
      ...validIR,
      ai_operations: [
        {
          id: '',
          type: 'classify',
          instruction: 'Classify lead',
          input_source: '{{lead}}',
          // Missing output_schema
        },
      ],
    }
    const result = validateIR(invalidIR)
    expect(result.valid).toBe(false)
  })

  it('should reject conditional without when clause', () => {
    const invalidIR: any = {
      ...validIR,
      conditionals: [
        {
          id: '',
          then: [],
          // Missing when
        },
      ],
    }
    const result = validateIR(invalidIR)
    expect(result.valid).toBe(false)
  })

  it('should reject loop without for_each or do', () => {
    const invalidIR: any = {
      ...validIR,
      loops: [
        {
          id: '',
          item_variable: 'item',
          // Missing for_each and do
        },
      ],
    }
    const result = validateIR(invalidIR)
    expect(result.valid).toBe(false)
  })

  it('should provide warnings for optional best practices', () => {
    const irWithoutEdgeCases = createMinimalIR({
      filters: [{
        id: '',
        field: 'stage',
        operator: 'equals',
        value: 4,
        description: ''
      }],
      // No edge_cases defined - should warn about no_rows_after_filter
    })
    const result = validateIR(irWithoutEdgeCases)
    expect(result.valid).toBe(true) // Still valid
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.length).toBeGreaterThan(0)
  })
})

describe('normalizeIR - LLM Quirk Fixes', () => {
  it('should ensure clarifications_required is an array', () => {
    const irWithoutClarifications: any = {
      ir_version: '2.0',
      goal: 'Test goal that is long enough',
      data_sources: [
        {
          id: 'test',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Test',
          tab: 'Sheet1',
          endpoint: '',
          trigger: '',
          role: 'test data',
        },
      ],
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
      delivery: [
        {
          id: '',
          method: 'email',
          config: {
            recipient: 'test@example.com',
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
          },
        },
      ],
      edge_cases: [],
      // Missing clarifications_required
    }
    const normalized = normalizeIR(irWithoutClarifications)
    expect(normalized.clarifications_required).toEqual([])
  })

  it('should ensure optional arrays are arrays if present', () => {
    const irWithNullArrays: any = createMinimalIR({
      filters: null as any, // LLM might set to null
      transforms: undefined as any, // Or undefined
    })
    const normalized = normalizeIR(irWithNullArrays)
    expect(normalized.filters).toBeUndefined() // Should remove null
    expect(normalized.transforms).toBeUndefined()
  })

  it('should trim whitespace from string fields', () => {
    const irWithWhitespace = createMinimalIR({
      goal: '  Send leads to sales  ', // Extra whitespace
      data_sources: [{
        id: '  leads_data  ',
        type: 'tabular',
        source: 'googlesheets',
        location: '  MyLeads  ',
        tab: '  Leads  ',
        endpoint: '',
        trigger: '',
        role: 'lead data',
      }],
      delivery: [{
        id: '',
        method: 'email',
        config: {
          recipient: '  test@example.com  ',
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
        },
      }],
    })
    const normalized = normalizeIR(irWithWhitespace)
    expect(normalized.goal).toBe('Send leads to sales')
    expect(normalized.data_sources[0].id).toBe('leads_data')
    expect(normalized.data_sources[0].location).toBe('MyLeads')
  })

  it('should fix variable syntax if slightly wrong', () => {
    const irWithBadVariables: any = createMinimalIR({
      ai_operations: [{
        id: '',
        type: 'summarize',
        instruction: 'Summarize',
        input_source: '{lead.description}', // Missing one brace on each side
        output_schema: { type: 'string', fields: [], enum: [] },
        constraints: {
          max_tokens: 0,
          temperature: 0,
          model_preference: 'fast'
        }
      }],
    })
    const normalized = normalizeIR(irWithBadVariables)
    expect(normalized.ai_operations![0].input_source).toBe('{{lead.description}}')
  })

  it('should set default values for common optional fields', () => {
    const minimalIR = createMinimalIR()
    const normalized = normalizeIR(minimalIR)

    // Should have defaults if needed (implementation dependent)
    expect(normalized).toBeDefined()
    expect(normalized.ir_version).toBe('2.0')
  })

  it('should convert delivery recipient string to expected format', () => {
    const irWithStringRecipient = createMinimalIR({
      delivery: [{
        id: '',
        method: 'email',
        config: {
          recipient: 'single@example.com', // String
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
        },
      }],
    })
    const normalized = normalizeIR(irWithStringRecipient)
    // Should remain string (both string and array are valid)
    expect(normalized.delivery[0].config.recipient).toBe('single@example.com')
  })

  it('should handle nested objects correctly', () => {
    const complexIR = createMinimalIR({
      goal: 'Complex workflow with nested structures',
      conditionals: [{
        id: '',
        when: {
          type: 'simple',
          field: 'stage',
          operator: 'equals',
          value: 4,
        },
        then: ['Classify lead using AI'],
        else: []
      }],
    })
    const normalized = normalizeIR(complexIR)
    expect(normalized.conditionals).toBeDefined()
    expect(normalized.conditionals![0].when.type).toBe('simple')
  })
})

describe('Error Message Quality', () => {
  it('should provide clear error messages for missing required fields', () => {
    const invalidIR = {
      ir_version: '2.0',
      // Missing goal
      data_sources: [],
      delivery: [],
    }
    const result = validateIR(invalidIR)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.toLowerCase().includes('goal'))).toBe(true)
  })

  it('should provide clear error messages for type mismatches', () => {
    const invalidIR = {
      ir_version: '2.0',
      goal: 123, // Should be string
      data_sources: [
        {
          id: 'test',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Test',
          tab: 'Sheet1',
          endpoint: '',
          trigger: '',
          role: 'test data',
        },
      ],
      delivery: [
        {
          id: '',
          method: 'email',
          config: {},
        },
      ],
      clarifications_required: [],
    }
    const result = validateIR(invalidIR)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.toLowerCase().includes('type'))).toBe(true)
  })

  it('should provide actionable error messages', () => {
    const invalidIR = createMinimalIR({
      data_sources: [{
        id: 'test',
        type: 'invalid_type' as any, // Invalid enum value
        source: 'test_source',
        location: 'Test',
        tab: '',
        endpoint: '',
        trigger: '',
        role: 'test data',
      }],
    })
    const result = validateIR(invalidIR)
    expect(result.valid).toBe(false)
    // Should mention valid options
    expect(
      result.errors.some(
        (e) =>
          e.includes('tabular') ||
          e.includes('api') ||
          e.includes('webhook') ||
          e.includes('database')
      )
    ).toBe(true)
  })
})
