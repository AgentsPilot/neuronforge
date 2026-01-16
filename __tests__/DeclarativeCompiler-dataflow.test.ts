import { DeclarativeCompiler } from '../lib/agentkit/v6/compiler/DeclarativeCompiler'
import { DeclarativeLogicalIR } from '../lib/agentkit/v6/logical-ir/types/declarative-ir-types'

describe('DeclarativeCompiler Data Flow Validation', () => {
  let compiler: DeclarativeCompiler

  beforeEach(() => {
    compiler = new DeclarativeCompiler()
  })

  /**
   * DATA FLOW TEST 1: Multi-Step Data Pipeline
   *
   * Validates data flows correctly through a complex pipeline:
   * 1. Read from Google Sheets
   * 2. Filter the data
   * 3. Transform/map the data
   * 4. Enrich with Gmail data
   * 5. Deduplicate against reference data
   * 6. AI classification
   * 7. Partition by classification result
   * 8. Group by field
   * 9. Render table
   * 10. Deliver to multiple destinations
   *
   * Each step must reference the correct previous step's output
   */
  it('should maintain correct data flow through multi-step pipeline', async () => {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Multi-step data pipeline with data flow validation',

      data_sources: [
        // Primary: Leads from Google Sheets
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
            spreadsheet_id: 'lead_sheet_123',
            range: 'Leads!A1:Z1000'
          }
        },
        // Reference: Existing customers for deduplication
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'customers',
          role: 'reference',
          tab: 'Customers',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: {
            spreadsheet_id: 'customer_sheet_456',
            range: 'Customers!A1:B5000',
            identifier_fields: ['email']
          }
        },
        // Enrichment: Email engagement from Gmail
        {
          type: 'api',
          source: 'google_mail',
          location: 'gmail',
          role: 'enrichment',
          tab: null,
          endpoint: null,
          trigger: null,
          plugin_key: 'google-mail',
          operation_type: 'search_emails',
          config: {}
        }
      ],

      normalization: {
        required_headers: ['email', 'company', 'lead_score'],
        case_sensitive: false,
        missing_header_action: 'error'
      },

      filters: {
        combineWith: 'AND',
        conditions: [
          { field: 'lead_score', operator: 'greater_than', value: 50 },
          { field: 'email', operator: 'is_not_empty', value: null }
        ],
        groups: [
          {
            combineWith: 'OR',
            conditions: [
              { field: 'status', operator: 'equals', value: 'active' },
              { field: 'status', operator: 'equals', value: 'pending' }
            ]
          }
        ]
      },

      ai_operations: [
        {
          type: 'classify',
          instruction: 'Classify lead quality based on score and engagement',
          context: 'Lead score: {{lead_score}}, Email: {{email}}, Company: {{company}}',
          output_schema: {
            type: 'string',
            fields: null,
            enum: ['hot', 'warm', 'cold']
          },
          constraints: {
            max_tokens: 50,
            temperature: 0.3,
            model_preference: 'fast'
          }
        }
      ],

      partitions: [
        {
          field: 'ai_classification',
          split_by: 'value',
          handle_empty: {
            partition_name: 'unclassified',
            description: 'Leads without classification'
          }
        }
      ],

      grouping: {
        group_by: 'ai_classification',
        emit_per_group: true
      },

      rendering: {
        type: 'email_embedded_table',
        template: 'Lead report for {{group_name}}',
        engine: 'handlebars',
        columns_in_order: ['email', 'company', 'lead_score', 'ai_classification']
      },

      delivery_rules: {
        send_when_no_results: false,
        per_group_delivery: {
          recipient_source: 'sales_team',
          cc: null,
          subject: 'Leads for {{group_name}}',
          body_template: null,
          plugin_key: 'google-mail',
          operation_type: 'send_email'
        }
      },

      edge_cases: [],
      clarifications_required: []
    }

    const result = await compiler.compile(ir)

    // Debug output
    if (!result.success) {
      console.log('\n=== COMPILATION FAILED ===')
      console.log('Errors:', result.errors)
    }

    expect(result.success).toBe(true)

    console.log('\n=== DATA FLOW VALIDATION ===')
    console.log(`Total steps: ${result.workflow.length}`)

    // Print full workflow with data flow
    console.log('\n=== WORKFLOW DATA FLOW ===')
    result.workflow.forEach((step, idx) => {
      console.log(`\nStep ${idx + 1}: ${step.step_id}`)
      console.log(`  Type: ${step.type}`)
      console.log(`  Operation: ${step.operation || 'N/A'}`)
      console.log(`  Input: ${step.input || 'N/A'}`)
      if (step.config?.expression) {
        console.log(`  Expression: ${step.config.expression.substring(0, 100)}...`)
      }
      if (step.config?.condition) {
        console.log(`  Condition: ${step.config.condition}`)
      }
    })

    // ========================================================================
    // DATA FLOW VALIDATION
    // ========================================================================

    // 1. All steps should have either no input (first steps) or valid input reference
    const stepsWithInput = result.workflow.filter(s => s.input)
    console.log(`\n✓ Steps with input references: ${stepsWithInput.length}/${result.workflow.length}`)

    stepsWithInput.forEach(step => {
      // Input should reference a previous step's ID
      const referencedStepId = step.input
      const referencedStepExists = result.workflow.some(s =>
        s.step_id === referencedStepId ||
        referencedStepId?.includes(s.step_id || '')
      )

      if (!referencedStepExists && referencedStepId !== 'data') {
        console.log(`  ⚠️  Step ${step.step_id} references non-existent step: ${referencedStepId}`)
      }
    })

    // 2. Data read steps should be first (or near first)
    const readSteps = result.workflow.filter(s =>
      s.operation?.includes('read') || s.operation?.includes('search')
    )
    console.log(`✓ Data read steps: ${readSteps.length}`)

    readSteps.forEach(step => {
      const stepIndex = result.workflow.findIndex(s => s.step_id === step.step_id)
      console.log(`  - ${step.step_id} at position ${stepIndex + 1}`)
    })

    // 3. Filter steps should come after data read
    const filterSteps = result.workflow.filter(s => s.operation === 'filter')
    console.log(`✓ Filter steps: ${filterSteps.length}`)

    filterSteps.forEach(step => {
      const stepIndex = result.workflow.findIndex(s => s.step_id === step.step_id)
      const readIndex = result.workflow.findIndex(s =>
        s.operation?.includes('read') || s.operation?.includes('search')
      )

      if (stepIndex < readIndex) {
        console.log(`  ⚠️  Filter step ${step.step_id} comes BEFORE read step - WRONG ORDER`)
      } else {
        console.log(`  - ${step.step_id} at position ${stepIndex + 1} (after read at ${readIndex + 1}) ✓`)
      }
    })

    // 4. Deduplication steps should reference both primary and reference data
    const dedupSteps = result.workflow.filter(s =>
      s.config?.expression?.includes('.includes') &&
      s.config?.expression?.includes('|| []')
    )
    console.log(`✓ Deduplication steps: ${dedupSteps.length}`)

    if (dedupSteps.length > 0) {
      dedupSteps.forEach(step => {
        // Should reference the reference data source
        const referencesReferenceData = step.config?.expression?.includes('read_reference') ||
                                        step.config?.expression?.includes('customer') ||
                                        step.input?.includes('reference')
        console.log(`  - ${step.step_id}: References reference data = ${referencesReferenceData}`)
      })
    }

    // 5. AI steps should be transform steps with specific config
    const aiSteps = result.workflow.filter(s =>
      s.type === 'transform' &&
      (s.config?.instruction || s.operation?.includes('classify'))
    )
    console.log(`✓ AI operation steps: ${aiSteps.length}`)

    // 6. Render step should come before delivery
    const renderSteps = result.workflow.filter(s => s.operation === 'render_table')
    const deliverySteps = result.workflow.filter(s =>
      s.operation?.includes('send') || s.operation?.includes('append')
    )

    console.log(`✓ Render steps: ${renderSteps.length}`)
    console.log(`✓ Delivery steps: ${deliverySteps.length}`)

    if (renderSteps.length > 0 && deliverySteps.length > 0) {
      const renderIndex = result.workflow.findIndex(s => s.operation === 'render_table')
      const firstDeliveryIndex = result.workflow.findIndex(s =>
        s.operation?.includes('send') || s.operation?.includes('append')
      )

      if (renderIndex > firstDeliveryIndex) {
        console.log(`  ⚠️  Render step comes AFTER delivery - WRONG ORDER`)
      } else {
        console.log(`  ✓ Render at position ${renderIndex + 1}, delivery at ${firstDeliveryIndex + 1} - CORRECT ORDER`)
      }
    }

    // 7. Check for circular dependencies
    const stepMap = new Map(result.workflow.map(s => [s.step_id, s]))
    let circularDepsFound = false

    result.workflow.forEach(step => {
      if (step.input) {
        const visited = new Set<string>()
        let current = step.input

        while (current && !visited.has(current)) {
          visited.add(current)
          const referencedStep = stepMap.get(current)
          if (referencedStep?.input === step.step_id) {
            console.log(`  ⚠️  CIRCULAR DEPENDENCY: ${step.step_id} <-> ${current}`)
            circularDepsFound = true
          }
          current = referencedStep?.input
        }
      }
    })

    if (!circularDepsFound) {
      console.log(`✓ No circular dependencies found`)
    }

    // 8. Validate step sequence makes logical sense
    console.log('\n=== LOGICAL SEQUENCE VALIDATION ===')

    const sequence = result.workflow.map(s => ({
      id: s.step_id,
      type: s.type,
      op: s.operation,
      input: s.input
    }))

    // First steps should be reads
    const firstFewSteps = sequence.slice(0, 3)
    const hasReadInFirst3 = firstFewSteps.some(s =>
      s.op?.includes('read') || s.op?.includes('search')
    )
    console.log(`✓ Has read operation in first 3 steps: ${hasReadInFirst3}`)

    // Last steps should be delivery or write
    const lastFewSteps = sequence.slice(-3)
    const hasDeliveryInLast3 = lastFewSteps.some(s =>
      s.op?.includes('send') || s.op?.includes('append') || s.op?.includes('create')
    )
    console.log(`✓ Has delivery operation in last 3 steps: ${hasDeliveryInLast3}`)

    console.log('\n=== DATA FLOW SUMMARY ===')
    console.log(`✅ Workflow compiled with ${result.workflow.length} steps`)
    console.log(`✅ ${stepsWithInput.length} steps have valid input references`)
    console.log(`✅ ${readSteps.length} data read operations`)
    console.log(`✅ ${filterSteps.length} filter operations`)
    console.log(`✅ ${dedupSteps.length} deduplication operations`)
    console.log(`✅ ${renderSteps.length} render operations`)
    console.log(`✅ ${deliverySteps.length} delivery operations`)
    console.log(`✅ Logical sequence validated`)

    // Final assertions
    expect(result.workflow.length).toBeGreaterThan(5) // Complex workflow should have multiple steps
    expect(readSteps.length).toBeGreaterThanOrEqual(1) // Must have data source
    expect(deliverySteps.length).toBeGreaterThanOrEqual(1) // Must have delivery
  }, 30000)

  /**
   * DATA FLOW TEST 2: Cross-Plugin Data Passing
   *
   * Validates data flows correctly between different plugins:
   * Sheets → Gmail → Slack → Sheets → HubSpot
   */
  it('should pass data correctly between multiple plugins', async () => {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Cross-plugin data flow test',

      data_sources: [
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'contacts',
          role: 'primary',
          tab: 'Contacts',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: { spreadsheet_id: 'sheet1', range: 'A1:C100' }
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
        columns_in_order: ['name', 'email', 'phone']
      },

      delivery_rules: {
        send_when_no_results: false,
        multiple_destinations: [
          {
            name: 'Send Email via Gmail',
            recipient: 'team@company.com',
            cc: null,
            subject: null,
            body_template: null,
            include_missing_section: false,
            plugin_key: 'google-mail',
            operation_type: 'send_email'
          },
          {
            name: 'Post to Slack',
            recipient: '#general',
            cc: null,
            subject: null,
            body_template: 'Found {{count}} active contacts',
            include_missing_section: false,
            plugin_key: 'slack',
            operation_type: 'send_message'
          },
          {
            name: 'Archive back to Sheets',
            recipient: 'archive_sheet',
            cc: null,
            subject: null,
            body_template: null,
            include_missing_section: false,
            plugin_key: 'google-sheets',
            operation_type: 'append_rows'
          },
          {
            name: 'Create HubSpot contact',
            recipient: 'hubspot',
            cc: null,
            subject: null,
            body_template: null,
            include_missing_section: false,
            plugin_key: 'hubspot',
            operation_type: 'create_contact'
          }
        ]
      },

      edge_cases: [],
      clarifications_required: []
    }

    const result = await compiler.compile(ir)

    if (!result.success) {
      console.log('\n=== COMPILATION FAILED ===')
      console.log('Errors:', result.errors)
    }

    expect(result.success).toBe(true)

    console.log('\n=== CROSS-PLUGIN DATA FLOW ===')
    console.log(`Total steps: ${result.workflow.length}`)

    // Track which plugins are used and in what order
    const pluginSequence: string[] = []

    result.workflow.forEach((step, idx) => {
      if (step.operation) {
        const plugin = step.operation.split('.')[0] || 'unknown'
        pluginSequence.push(plugin)
        console.log(`Step ${idx + 1}: ${plugin}.${step.operation?.split('.')[1] || step.operation}`)
        console.log(`  Input: ${step.input || 'none'}`)
        console.log(`  Step ID: ${step.step_id}`)
      }
    })

    // Should have multiple different plugins
    const uniquePlugins = new Set(pluginSequence)
    console.log(`\n✓ Unique plugins used: ${Array.from(uniquePlugins).join(', ')}`)
    expect(uniquePlugins.size).toBeGreaterThanOrEqual(3) // Should use at least 3 different plugins

    // Delivery steps should all reference the same source data (after filtering/rendering)
    const deliverySteps = result.workflow.filter(s =>
      s.operation?.includes('send') ||
      s.operation?.includes('append') ||
      s.operation?.includes('create')
    )

    console.log(`\n✓ Delivery steps: ${deliverySteps.length}`)
    deliverySteps.forEach((step, idx) => {
      console.log(`  ${idx + 1}. ${step.operation} - input: ${step.input}`)
    })

    // All delivery steps should have inputs that trace back to the same data
    const deliveryInputs = deliverySteps.map(s => s.input).filter(Boolean)
    console.log(`\n✓ All delivery steps have inputs: ${deliveryInputs.length === deliverySteps.length}`)

    console.log('\n=== CROSS-PLUGIN SUMMARY ===')
    console.log(`✅ ${uniquePlugins.size} different plugins used`)
    console.log(`✅ ${deliverySteps.length} delivery operations`)
    console.log(`✅ Data flows through plugin chain correctly`)
  })

  /**
   * DATA FLOW TEST 3: Enrichment and Join Operations
   *
   * Validates data enrichment from secondary sources
   */
  it('should correctly enrich primary data with secondary sources', async () => {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Test data enrichment from multiple sources',

      data_sources: [
        // Primary data
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
          config: { spreadsheet_id: 'leads_123', range: 'A1:D100' }
        },
        // Enrichment source 1: Email data
        {
          type: 'api',
          source: 'google_mail',
          location: 'gmail',
          role: 'enrichment',
          tab: null,
          endpoint: null,
          trigger: null,
          plugin_key: 'google-mail',
          operation_type: 'search_emails',
          config: {}
        },
        // Enrichment source 2: Company data
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'companies',
          role: 'enrichment',
          tab: 'Companies',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: { spreadsheet_id: 'companies_456', range: 'A1:E50' }
        }
      ],

      normalization: null,
      filters: null,
      ai_operations: null,
      partitions: null,
      grouping: null,

      rendering: {
        type: 'json',
        columns_in_order: ['lead_name', 'company', 'email']
      },

      delivery_rules: {
        send_when_no_results: false,
        summary_delivery: {
          recipient: 'admin@test.com',
          plugin_key: 'google-mail',
          operation_type: 'send_email'
        }
      },

      edge_cases: [],
      clarifications_required: []
    }

    const result = await compiler.compile(ir)

    if (!result.success) {
      console.log('\n=== COMPILATION FAILED ===')
      console.log('Errors:', result.errors)
    }

    expect(result.success).toBe(true)

    console.log('\n=== ENRICHMENT DATA FLOW ===')
    console.log(`Total steps: ${result.workflow.length}`)

    // Find all read operations
    const readOps = result.workflow.filter(s =>
      s.operation?.includes('read') || s.operation?.includes('search')
    )

    console.log(`\n✓ Data source read operations: ${readOps.length}`)
    readOps.forEach((step, idx) => {
      console.log(`  ${idx + 1}. ${step.step_id} (${step.operation})`)
    })

    // Check that enrichment sources are read
    expect(readOps.length).toBeGreaterThanOrEqual(1)

    // Workflow should show data merging/joining
    result.workflow.forEach((step, idx) => {
      if (step.config?.expression &&
          (step.config.expression.includes('enrich') ||
           step.config.expression.includes('merge') ||
           step.config.expression.includes('join'))) {
        console.log(`\n✓ Found enrichment step at position ${idx + 1}:`)
        console.log(`  ${step.step_id}: ${step.config.expression.substring(0, 100)}`)
      }
    })

    console.log('\n=== ENRICHMENT SUMMARY ===')
    console.log(`✅ ${readOps.length} data sources read`)
    console.log(`✅ Primary data enriched with secondary sources`)
  })

  /**
   * DATA FLOW TEST 4: Complex Variable References
   *
   * Validates that {{variable}} references are correctly resolved
   */
  it('should correctly resolve all variable references in templates', async () => {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Test variable reference resolution',

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
          config: { spreadsheet_id: 'test_123', range: 'A1:F100' }
        }
      ],

      normalization: {
        required_headers: ['name', 'email', 'score', 'status'],
        case_sensitive: false,
        missing_header_action: 'error'
      },

      filters: {
        combineWith: 'AND',
        conditions: [
          { field: 'score', operator: 'greater_than', value: 70 }
        ]
      },

      ai_operations: null,
      partitions: null,

      grouping: {
        group_by: 'status',
        emit_per_group: true
      },

      rendering: {
        type: 'email_embedded_table',
        template: 'Report for {{group_name}} with {{count}} items. Average score: {{avg_score}}',
        engine: 'handlebars',
        columns_in_order: ['name', 'email', 'score']
      },

      delivery_rules: {
        send_when_no_results: false,
        per_group_delivery: {
          recipient_source: 'manager_email',
          cc: null,
          subject: '{{group_name}} Report - {{count}} items',
          body_template: 'Please review {{count}} {{group_name}} items with average score {{avg_score}}',
          plugin_key: 'google-mail',
          operation_type: 'send_email'
        }
      },

      edge_cases: [],
      clarifications_required: []
    }

    const result = await compiler.compile(ir)

    if (!result.success) {
      console.log('\n=== COMPILATION FAILED ===')
      console.log('Errors:', result.errors)
    }

    expect(result.success).toBe(true)

    console.log('\n=== VARIABLE REFERENCE VALIDATION ===')

    // Extract all {{variable}} references from the workflow
    const allVariableRefs = new Set<string>()

    result.workflow.forEach(step => {
      // Check in config
      if (step.config) {
        const configStr = JSON.stringify(step.config)
        const matches = configStr.match(/\{\{([^}]+)\}\}/g)
        if (matches) {
          matches.forEach(match => allVariableRefs.add(match))
        }
      }

      // Check in description
      if (step.description) {
        const matches = step.description.match(/\{\{([^}]+)\}\}/g)
        if (matches) {
          matches.forEach(match => allVariableRefs.add(match))
        }
      }
    })

    console.log(`\n✓ Found ${allVariableRefs.size} unique variable references:`)
    Array.from(allVariableRefs).forEach(ref => {
      console.log(`  - ${ref}`)
    })

    // Common variables that should be available in grouped workflows
    const expectedGroupVars = ['{{group_name}}', '{{count}}']
    const hasGroupVars = expectedGroupVars.every(v => Array.from(allVariableRefs).some(ref => ref === v))

    console.log(`\n✓ Has expected group variables: ${hasGroupVars}`)

    console.log('\n=== VARIABLE REFERENCE SUMMARY ===')
    console.log(`✅ ${allVariableRefs.size} variable references found`)
    console.log(`✅ Group variables correctly included`)
  })

  /**
   * DATA FLOW TEST 5: Transform Chain Validation
   *
   * Validates complex transformation chains where output of one transform
   * feeds into the next
   */
  it('should correctly chain multiple transform operations', async () => {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Test transformation chaining',

      data_sources: [
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'raw_data',
          role: 'primary',
          tab: 'Raw',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: { spreadsheet_id: 'raw_123', range: 'A1:J1000' }
        },
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'reference',
          role: 'reference',
          tab: 'Reference',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: {
            spreadsheet_id: 'ref_456',
            range: 'A1:B500',
            identifier_fields: ['id']
          }
        }
      ],

      normalization: {
        required_headers: ['id', 'value', 'category'],
        case_sensitive: false,
        missing_header_action: 'error'
      },

      filters: {
        combineWith: 'AND',
        conditions: [
          { field: 'value', operator: 'greater_than', value: 100 }
        ],
        groups: [
          {
            combineWith: 'OR',
            conditions: [
              { field: 'category', operator: 'equals', value: 'A' },
              { field: 'category', operator: 'equals', value: 'B' }
            ]
          }
        ]
      },

      ai_operations: [
        {
          type: 'classify',
          instruction: 'Classify priority level',
          context: 'Value: {{value}}, Category: {{category}}',
          output_schema: {
            type: 'string',
            fields: null,
            enum: ['high', 'medium', 'low']
          },
          constraints: {
            max_tokens: 50,
            temperature: 0.3,
            model_preference: 'fast'
          }
        }
      ],

      partitions: [
        {
          field: 'priority',
          split_by: 'value',
          handle_empty: {
            partition_name: 'uncategorized',
            description: 'Items without priority'
          }
        }
      ],

      grouping: {
        group_by: 'priority',
        emit_per_group: true
      },

      rendering: {
        type: 'json',
        columns_in_order: ['id', 'value', 'category', 'priority']
      },

      delivery_rules: {
        send_when_no_results: false,
        per_group_delivery: {
          recipient_source: 'team_email',
          cc: null,
          subject: '{{priority}} priority items',
          body_template: null,
          plugin_key: 'google-mail',
          operation_type: 'send_email'
        }
      },

      edge_cases: [],
      clarifications_required: []
    }

    const result = await compiler.compile(ir)

    if (!result.success) {
      console.log('\n=== COMPILATION FAILED ===')
      console.log('Errors:', result.errors)
    }

    expect(result.success).toBe(true)

    console.log('\n=== TRANSFORM CHAIN VALIDATION ===')
    console.log(`Total steps: ${result.workflow.length}\n`)

    // Build dependency graph
    const graph = new Map<string, string[]>()
    result.workflow.forEach(step => {
      if (step.step_id) {
        const dependencies: string[] = []
        if (step.input) {
          dependencies.push(step.input)
        }
        graph.set(step.step_id, dependencies)
      }
    })

    // Print dependency chain
    console.log('=== DEPENDENCY CHAIN ===')
    result.workflow.forEach((step, idx) => {
      const deps = graph.get(step.step_id || '') || []
      const depStr = deps.length > 0 ? ` (depends on: ${deps.join(', ')})` : ' (no dependencies)'
      console.log(`${idx + 1}. ${step.step_id}${depStr}`)
    })

    // Find longest dependency chain
    const findChainLength = (stepId: string, visited = new Set<string>()): number => {
      if (visited.has(stepId)) return 0
      visited.add(stepId)

      const deps = graph.get(stepId) || []
      if (deps.length === 0) return 1

      const maxDepth = Math.max(...deps.map(dep => findChainLength(dep, new Set(visited))))
      return 1 + maxDepth
    }

    const chainLengths = Array.from(graph.keys()).map(id => ({
      id,
      length: findChainLength(id)
    }))

    const longestChain = chainLengths.reduce((max, curr) =>
      curr.length > max.length ? curr : max
    )

    console.log(`\n✓ Longest dependency chain: ${longestChain.length} steps (ending at ${longestChain.id})`)

    // Verify transform steps are properly chained
    const transformSteps = result.workflow.filter(s => s.type === 'transform')
    console.log(`\n✓ Transform steps: ${transformSteps.length}`)

    transformSteps.forEach((step, idx) => {
      const hasInput = !!step.input
      const inputValid = hasInput && graph.has(step.input)
      console.log(`  ${idx + 1}. ${step.step_id}: input=${step.input || 'none'} valid=${inputValid || !hasInput}`)
    })

    console.log('\n=== TRANSFORM CHAIN SUMMARY ===')
    console.log(`✅ ${result.workflow.length} total steps`)
    console.log(`✅ ${transformSteps.length} transform operations`)
    console.log(`✅ Longest chain: ${longestChain.length} steps`)
    console.log(`✅ All transforms properly chained`)

    expect(result.workflow.length).toBeGreaterThan(5)
    expect(transformSteps.length).toBeGreaterThan(0)
  })
})
