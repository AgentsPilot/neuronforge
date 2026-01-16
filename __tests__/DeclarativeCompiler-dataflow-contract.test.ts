import { DeclarativeCompiler } from '../lib/agentkit/v6/compiler/DeclarativeCompiler'
import { DeclarativeLogicalIR } from '../lib/agentkit/v6/logical-ir/types/declarative-ir-types'

/**
 * DATA FLOW CONTRACT VALIDATION
 *
 * This test suite validates the ACTUAL data flow contract used by the compiler.
 * It's critical for runtime execution to work correctly.
 *
 * The problem: Steps reference each other's data inconsistently:
 * - Sometimes: {{step_id}}
 * - Sometimes: {{step_id.property}}
 * - Sometimes: {{step_id.data.values}}
 *
 * This test discovers and documents the actual patterns used.
 */
describe('DeclarativeCompiler Data Flow Contract', () => {
  let compiler: DeclarativeCompiler

  beforeEach(() => {
    compiler = new DeclarativeCompiler()
  })

  it('should document actual input reference patterns used by compiler', async () => {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Document data flow contract',

      data_sources: [
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'data',
          role: 'primary',
          tab: 'Main',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: { spreadsheet_id: 'test', range: 'A1:C100' }
        },
        {
          type: 'tabular',
          source: 'google_sheets',
          location: 'reference',
          role: 'reference',
          tab: 'Ref',
          endpoint: null,
          trigger: null,
          plugin_key: 'google-sheets',
          operation_type: 'read_range',
          config: {
            spreadsheet_id: 'ref',
            range: 'A1:B50',
            identifier_fields: ['id']
          }
        }
      ],

      normalization: {
        required_headers: ['id', 'name', 'value'],
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
              { field: 'name', operator: 'contains', value: 'test' },
              { field: 'name', operator: 'contains', value: 'prod' }
            ]
          }
        ]
      },

      ai_operations: null,
      partitions: null,
      grouping: null,

      rendering: {
        type: 'json',
        columns_in_order: ['id', 'name', 'value']
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

    expect(result.success).toBe(true)

    console.log('\n=== DATA FLOW CONTRACT ANALYSIS ===\n')

    // Analyze each step's input pattern
    const patterns = {
      noInput: [] as string[],
      directReference: [] as string[],
      nestedProperty: [] as string[],
      deeplyNested: [] as string[]
    }

    result.workflow.forEach((step, idx) => {
      console.log(`Step ${idx + 1}: ${step.step_id}`)
      console.log(`  Type: ${step.type}`)
      console.log(`  Operation: ${step.operation || 'N/A'}`)
      console.log(`  Input: ${step.input || 'none'}`)

      // Categorize input pattern
      if (!step.input || step.input === 'N/A') {
        patterns.noInput.push(step.step_id || 'unknown')
      } else if (step.input.match(/^\{\{[^.}]+\}\}$/)) {
        // Pattern: {{step_id}}
        patterns.directReference.push(step.step_id || 'unknown')
        console.log(`  → Pattern: Direct reference`)
      } else if (step.input.match(/^\{\{[^.}]+\.[^.}]+\}\}$/)) {
        // Pattern: {{step_id.property}}
        patterns.nestedProperty.push(step.step_id || 'unknown')
        console.log(`  → Pattern: Nested property`)
      } else if (step.input.match(/^\{\{[^}]+\.[^}]+\.[^}]+\}\}$/)) {
        // Pattern: {{step_id.property.subproperty}}
        patterns.deeplyNested.push(step.step_id || 'unknown')
        console.log(`  → Pattern: Deeply nested`)
      }

      // Check if step has config expressions
      if (step.config?.expression) {
        console.log(`  Expression: ${step.config.expression.substring(0, 80)}...`)

        // Extract variable references from expression
        const varRefs = step.config.expression.match(/\{\{[^}]+\}\}/g)
        if (varRefs) {
          console.log(`  → References in expression: ${varRefs.join(', ')}`)
        }
      }

      if (step.config?.condition) {
        console.log(`  Condition: ${step.config.condition}`)
      }

      console.log('')
    })

    console.log('\n=== PATTERN SUMMARY ===')
    console.log(`No input: ${patterns.noInput.length} steps`)
    console.log(`  Steps: ${patterns.noInput.join(', ')}`)
    console.log(`\nDirect reference ({{step_id}}): ${patterns.directReference.length} steps`)
    console.log(`  Steps: ${patterns.directReference.join(', ')}`)
    console.log(`\nNested property ({{step_id.property}}): ${patterns.nestedProperty.length} steps`)
    console.log(`  Steps: ${patterns.nestedProperty.join(', ')}`)
    console.log(`\nDeeply nested ({{step_id.prop.subprop}}): ${patterns.deeplyNested.length} steps`)
    console.log(`  Steps: ${patterns.deeplyNested.join(', ')}`)

    console.log('\n=== DATA FLOW RULES DISCOVERED ===')

    // Discover rules by analyzing the patterns
    const rules: string[] = []

    // Rule 1: First steps have no input
    const firstStepsNoInput = result.workflow.slice(0, 2).every(s => !s.input || s.input === 'N/A')
    if (firstStepsNoInput) {
      rules.push('✓ Rule 1: First steps (data sources) have no input')
    }

    // Rule 2: Normalization references read step with .data.values
    const normStep = result.workflow.find(s => s.operation === 'map_headers')
    if (normStep?.input?.includes('.data.values')) {
      rules.push('✓ Rule 2: Normalization step references read step with .data.values')
    }

    // Rule 3: Transform steps reference previous step directly or with property
    const transformSteps = result.workflow.filter(s => s.type === 'transform')
    const transformsHaveInput = transformSteps.every(s => s.input)
    if (transformsHaveInput) {
      rules.push('✓ Rule 3: All transform steps have input references')
    }

    // Rule 4: Filter steps may reference .filtered property
    const filterSteps = result.workflow.filter(s => s.operation === 'filter')
    const subsequentFilterRefsFiltered = result.workflow.some(s =>
      s.input?.includes('.filtered')
    )
    if (subsequentFilterRefsFiltered) {
      rules.push('✓ Rule 4: Subsequent steps reference filter output with .filtered property')
    }

    // Rule 5: Dedup steps reference multiple sources
    const dedupSteps = result.workflow.filter(s =>
      s.config?.expression?.includes('.includes')
    )
    if (dedupSteps.length > 0) {
      const dedupRefsMultiple = dedupSteps.some(s =>
        s.config?.expression?.includes('read_reference') ||
        s.config?.expression?.includes('read_')
      )
      if (dedupRefsMultiple) {
        rules.push('✓ Rule 5: Deduplication expressions reference multiple data sources')
      }
    }

    console.log('')
    rules.forEach(rule => console.log(rule))

    console.log('\n=== CRITICAL FINDINGS ===')
    console.log('1. Input reference format is INCONSISTENT:')
    console.log('   - Direct: {{step_id}}')
    console.log('   - Nested: {{step_id.property}}')
    console.log('   - Deep: {{step_id.data.values}}')
    console.log('')
    console.log('2. Different step types use different patterns:')
    console.log('   - Read steps: no input')
    console.log('   - Normalize: {{read_step.data.values}}')
    console.log('   - Transform: {{prev_step}} or {{prev_step.property}}')
    console.log('   - Filter: {{prev_step.filtered}}')
    console.log('')
    console.log('3. Expressions may reference multiple steps:')
    console.log('   - Can reference {{step1.data}} and {{step2.data}} in same expression')
    console.log('')
    console.log('4. EXECUTOR MUST handle all these patterns correctly!')

    // Validate that the workflow can theoretically execute
    console.log('\n=== EXECUTION VALIDATION ===')

    let executionIssues = 0

    result.workflow.forEach((step, idx) => {
      // Check if input references a step that exists
      if (step.input && step.input !== 'N/A') {
        const referencedStepId = step.input.replace(/\{\{([^.}]+).*\}\}/, '$1')
        const referencedStepExists = result.workflow.slice(0, idx).some(s =>
          s.step_id === referencedStepId
        )

        if (!referencedStepExists && referencedStepId !== 'data') {
          console.log(`⚠️  Step ${step.step_id} references non-existent step: ${referencedStepId}`)
          executionIssues++
        }
      }

      // Check if expression references valid steps
      if (step.config?.expression) {
        const exprRefs = step.config.expression.match(/\{\{([^.}]+)/g)
        if (exprRefs) {
          exprRefs.forEach(ref => {
            const stepId = ref.replace('{{', '')
            const exists = result.workflow.slice(0, idx).some(s =>
              s.step_id === stepId || stepId === 'item'
            )
            if (!exists && stepId !== 'item' && stepId !== 'group') {
              console.log(`⚠️  Step ${step.step_id} expression references non-existent: ${stepId}`)
              executionIssues++
            }
          })
        }
      }
    })

    if (executionIssues === 0) {
      console.log('✅ All step references are valid - workflow should execute correctly')
    } else {
      console.log(`❌ Found ${executionIssues} potential execution issues`)
    }

    console.log('\n=== RECOMMENDATIONS ===')
    console.log('1. Define clear data flow contract:')
    console.log('   - Document which step types use which reference patterns')
    console.log('   - Enforce consistency in compiler')
    console.log('   - Validate references during compilation')
    console.log('')
    console.log('2. Add runtime validation:')
    console.log('   - Check that referenced steps exist before execution')
    console.log('   - Validate property paths exist')
    console.log('   - Provide clear error messages when data not found')
    console.log('')
    console.log('3. Test with actual execution:')
    console.log('   - Run compiled workflows through executor')
    console.log('   - Verify data flows correctly between steps')
    console.log('   - Catch any reference resolution errors')
  })

  it('should validate step execution order matches dependencies', async () => {
    const ir: DeclarativeLogicalIR = {
      ir_version: '3.0',
      goal: 'Validate execution order',

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
          config: { spreadsheet_id: 'test', range: 'A1:C100' }
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
        columns_in_order: ['name']
      },

      delivery_rules: {
        send_when_no_results: false,
        summary_delivery: {
          recipient: 'test@test.com',
          plugin_key: 'google-mail',
          operation_type: 'send_email'
        }
      },

      edge_cases: [],
      clarifications_required: []
    }

    const result = await compiler.compile(ir)
    expect(result.success).toBe(true)

    console.log('\n=== EXECUTION ORDER VALIDATION ===\n')

    // Build dependency graph
    const dependencies = new Map<string, Set<string>>()

    result.workflow.forEach(step => {
      const deps = new Set<string>()

      // Add input dependency
      if (step.input && step.input !== 'N/A') {
        const match = step.input.match(/\{\{([^.}]+)/)
        if (match) {
          deps.add(match[1])
        }
      }

      // Add expression dependencies
      if (step.config?.expression) {
        const matches = step.config.expression.matchAll(/\{\{([^.}]+)/g)
        for (const match of matches) {
          if (match[1] !== 'item' && match[1] !== 'group') {
            deps.add(match[1])
          }
        }
      }

      dependencies.set(step.step_id || '', deps)
    })

    // Validate execution order
    console.log('Dependency Graph:')
    let orderValid = true

    result.workflow.forEach((step, idx) => {
      const deps = dependencies.get(step.step_id || '')
      console.log(`\nStep ${idx + 1}: ${step.step_id}`)

      if (deps && deps.size > 0) {
        console.log(`  Depends on: ${Array.from(deps).join(', ')}`)

        // Check all dependencies come before this step
        deps.forEach(dep => {
          const depIndex = result.workflow.findIndex(s => s.step_id === dep)
          if (depIndex >= idx) {
            console.log(`  ❌ ERROR: Dependency ${dep} at position ${depIndex + 1} comes AFTER current step!`)
            orderValid = false
          } else if (depIndex >= 0) {
            console.log(`  ✓ ${dep} at position ${depIndex + 1} comes before (OK)`)
          }
        })
      } else {
        console.log(`  No dependencies (can execute first)`)
      }
    })

    console.log(`\n${ orderValid ? '✅' : '❌'} Execution order is ${orderValid ? 'VALID' : 'INVALID'}`)

    expect(orderValid).toBe(true)
  })
})
