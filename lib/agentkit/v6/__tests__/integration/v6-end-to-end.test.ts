/**
 * V6 End-to-End Integration Test
 *
 * Tests the complete flow:
 * Enhanced Prompt → IR Generation → Natural Language Translation → Compilation → PILOT_DSL
 *
 * This integration test validates that all V6 components work together correctly.
 */

// @deprecated - Using deprecated generator for legacy tests
import { createIRGenerator } from '../../generation/EnhancedPromptToIRGenerator_DEPRECATED'
import { createTranslator } from '../../translation/IRToNaturalLanguageTranslator'
import { createCompiler } from '../../compiler/LogicalIRCompiler'
import type { EnhancedPrompt } from '../../generation/EnhancedPromptToIRGenerator_DEPRECATED'
import type { ExtendedLogicalIR } from '../../logical-ir/schemas/extended-ir-types'

// ============================================================================
// Test Configuration
// ============================================================================

// Use OpenAI for testing (requires OPENAI_API_KEY in environment)
const TEST_MODEL_PROVIDER = 'openai'
const TEST_TIMEOUT = 60000 // 60 seconds for LLM calls

// ============================================================================
// Test Cases
// ============================================================================

describe('V6 End-to-End Integration', () => {
  // ----------------------------------------------------------------------------
  // Test Case 1: Simple Tabular Workflow
  // ----------------------------------------------------------------------------

  it('should handle simple tabular workflow end-to-end', async () => {
    console.log('[E2E Test] Starting simple tabular workflow test...')

    // STEP 1: Create enhanced prompt
    const enhancedPrompt: EnhancedPrompt = {
      sections: {
        data: ['Read from Google Sheet "MyLeads" tab "Leads"'],
        actions: ['Filter rows where stage = 4'],
        output: ['Format as HTML table'],
        delivery: ['Email to meiribarak@gmail.com with subject "Weekly Leads Report"']
      },
    }

    // STEP 2: Generate IR
    console.log('[E2E Test] Step 2: Generating IR...')
    const irGenerator = createIRGenerator(TEST_MODEL_PROVIDER)
    const irResult = await irGenerator.generate(enhancedPrompt)

    expect(irResult.success).toBe(true)
    expect(irResult.ir).toBeDefined()
    expect(irResult.errors).toBeUndefined()

    const ir = irResult.ir!

    // Validate IR structure
    expect(ir.ir_version).toBe('2.0')
    expect(ir.goal).toBeTruthy()
    expect(ir.data_sources).toHaveLength(1)
    expect(ir.data_sources[0].type).toBe('tabular')
    expect(ir.filters).toBeDefined()
    expect(ir.filters!.length).toBeGreaterThan(0)
    expect(ir.delivery).toHaveLength(1)
    expect(ir.delivery[0].method).toBe('email')

    console.log('[E2E Test] ✓ IR generated:', {
      goal: ir.goal,
      data_sources: ir.data_sources.length,
      filters: ir.filters?.length || 0,
      delivery: ir.delivery.length
    })

    // STEP 3: Translate IR to natural language
    console.log('[E2E Test] Step 3: Translating to natural language...')
    const translator = createTranslator()
    const plan = translator.translate(ir)

    expect(plan.goal).toBeTruthy()
    expect(plan.steps.length).toBeGreaterThan(0)

    console.log('[E2E Test] ✓ Natural language plan generated:', {
      goal: plan.goal,
      steps: plan.steps.length,
      edgeCases: plan.edgeCases?.length || 0
    })

    // STEP 4: Compile IR to PILOT_DSL workflow
    console.log('[E2E Test] Step 4: Compiling to PILOT_DSL...')
    const compiler = await createCompiler()
    const compilationResult = await compiler.compile(ir, {
      user_id: 'test-user-001',
      available_plugins: ['googlesheets', 'email']
    })

    expect(compilationResult.success).toBe(true)
    expect(compilationResult.workflow).toBeDefined()
    expect(compilationResult.errors).toBeUndefined()

    const workflow = compilationResult.workflow!
    expect(workflow.workflow_steps).toBeDefined()
    expect(workflow.workflow_steps.length).toBeGreaterThan(0)
    expect(workflow.metadata).toBeDefined()

    console.log('[E2E Test] ✓ Workflow compiled:', {
      steps: workflow.workflow_steps.length,
      rule_used: compilationResult.metadata?.rule_used,
      deterministic_percentage: compilationResult.metadata?.deterministic_step_percentage
    })

    // STEP 5: Validate workflow structure
    console.log('[E2E Test] Step 5: Validating workflow structure...')

    // Should have at least: read step, filter step, delivery step
    expect(workflow.workflow_steps.length).toBeGreaterThanOrEqual(3)

    // First step should be a read action
    const firstStep = workflow.workflow_steps[0]
    expect(firstStep.type).toBe('action')
    expect(firstStep.plugin).toBe('googlesheets')

    // Should have a delivery step at the end
    const lastStep = workflow.workflow_steps[workflow.workflow_steps.length - 1]
    expect(['email', 'action']).toContain(lastStep.type)

    console.log('[E2E Test] ✓ Workflow structure validated')
    console.log('[E2E Test] ✅ Simple tabular workflow test PASSED')
  }, TEST_TIMEOUT)

  // ----------------------------------------------------------------------------
  // Test Case 2: Workflow with AI Operations
  // ----------------------------------------------------------------------------

  it('should handle workflow with AI operations end-to-end', async () => {
    console.log('[E2E Test] Starting AI operations workflow test...')

    // STEP 1: Create enhanced prompt with AI task
    const enhancedPrompt: EnhancedPrompt = {
      sections: {
        data: ['Read from Google Sheet "CustomerFeedback" tab "Responses"'],
        actions: [
          'Analyze sentiment of each response',
          'Filter to negative sentiment only'
        ],
        output: ['Format as JSON with feedback text and sentiment'],
        delivery: ['Send to Slack channel #customer-feedback']
      }
    }

    // STEP 2: Generate IR
    console.log('[E2E Test] Generating IR with AI operations...')
    const irGenerator = createIRGenerator(TEST_MODEL_PROVIDER)
    const irResult = await irGenerator.generate(enhancedPrompt)

    expect(irResult.success).toBe(true)
    expect(irResult.ir).toBeDefined()

    const ir = irResult.ir!

    // Should have AI operations
    expect(ir.ai_operations).toBeDefined()
    expect(ir.ai_operations!.length).toBeGreaterThan(0)

    const sentimentOp = ir.ai_operations!.find(op => op.type === 'sentiment')
    expect(sentimentOp).toBeDefined()

    console.log('[E2E Test] ✓ IR with AI operations generated:', {
      ai_operations: ir.ai_operations!.length,
      operation_types: ir.ai_operations!.map(op => op.type)
    })

    // STEP 3: Translate to natural language
    const translator = createTranslator()
    const plan = translator.translate(ir)

    expect(plan.steps.some(s => s.type === 'ai')).toBe(true)

    console.log('[E2E Test] ✓ Plan includes AI operation step')

    // STEP 4: Compile to workflow
    const compiler = await createCompiler()
    const compilationResult = await compiler.compile(ir)

    expect(compilationResult.success).toBe(true)
    expect(compilationResult.workflow).toBeDefined()

    const workflow = compilationResult.workflow!

    // Should have ai_processing step
    const aiStep = workflow.workflow_steps.find(s => s.type === 'ai_processing')
    expect(aiStep).toBeDefined()

    console.log('[E2E Test] ✓ Workflow includes ai_processing step')
    console.log('[E2E Test] ✅ AI operations workflow test PASSED')
  }, TEST_TIMEOUT)

  // ----------------------------------------------------------------------------
  // Test Case 3: Grouped Delivery Workflow
  // ----------------------------------------------------------------------------

  it('should handle grouped delivery workflow end-to-end', async () => {
    console.log('[E2E Test] Starting grouped delivery workflow test...')

    const enhancedPrompt: EnhancedPrompt = {
      sections: {
        data: ['Read from Google Sheet "SalesData" tab "Opportunities"'],
        actions: [
          'Filter to opportunities where status = "open"',
          'Group by sales_rep'
        ],
        output: ['Format each group as HTML table'],
        delivery: ['Email each sales rep their opportunities']
      }
    }

    // Generate IR
    const irGenerator = createIRGenerator(TEST_MODEL_PROVIDER)
    const irResult = await irGenerator.generate(enhancedPrompt)

    expect(irResult.success).toBe(true)
    const ir = irResult.ir!

    // Should have grouping configuration
    expect(ir.grouping).toBeDefined()
    expect(ir.grouping!.emit_per_group).toBe(true)

    console.log('[E2E Test] ✓ IR with grouping generated:', {
      group_by: ir.grouping!.group_by,
      emit_per_group: ir.grouping!.emit_per_group
    })

    // Compile to workflow
    const compiler = await createCompiler()
    const compilationResult = await compiler.compile(ir)

    expect(compilationResult.success).toBe(true)
    const workflow = compilationResult.workflow!

    // Should use TabularGroupedDeliveryRule
    expect(compilationResult.metadata?.rule_used).toBe('TabularGroupedDeliveryRule')

    // Should have scatter-gather pattern
    const scatterStep = workflow.workflow_steps.find(s =>
      s.type === 'scatter' || (s as any).scatter !== undefined
    )
    expect(scatterStep).toBeDefined()

    console.log('[E2E Test] ✓ Workflow uses scatter-gather for grouped delivery')
    console.log('[E2E Test] ✅ Grouped delivery workflow test PASSED')
  }, TEST_TIMEOUT)

  // ----------------------------------------------------------------------------
  // Test Case 4: Workflow Update (Correction)
  // ----------------------------------------------------------------------------

  it('should handle workflow corrections end-to-end', async () => {
    console.log('[E2E Test] Starting workflow correction test...')

    // STEP 1: Generate initial workflow
    const initialPrompt: EnhancedPrompt = {
      sections: {
        data: ['Read from Google Sheet "Tasks" tab "Open"'],
        actions: ['Filter to high priority tasks'],
        delivery: ['Email to manager@example.com']
      }
    }

    const irGenerator = createIRGenerator(TEST_MODEL_PROVIDER)
    const initialResult = await irGenerator.generate(initialPrompt)

    expect(initialResult.success).toBe(true)
    const initialIR = initialResult.ir!

    console.log('[E2E Test] ✓ Initial IR generated')

    // STEP 2: Apply correction
    const { createCorrectionHandler } = require('../../translation/NaturalLanguageCorrectionHandler')
    const correctionHandler = createCorrectionHandler(TEST_MODEL_PROVIDER)

    const correctionResult = await correctionHandler.handleCorrection({
      userMessage: 'Change the filter to use priority column equals "urgent" instead',
      currentIR: initialIR
    })

    expect(correctionResult.success).toBe(true)
    expect(correctionResult.updatedIR).toBeDefined()
    expect(correctionResult.changes).toBeDefined()
    expect(correctionResult.changes!.length).toBeGreaterThan(0)

    const updatedIR = correctionResult.updatedIR!

    console.log('[E2E Test] ✓ Correction applied:', {
      changes: correctionResult.changes
    })

    // STEP 3: Verify correction was applied
    expect(updatedIR.filters).toBeDefined()
    const priorityFilter = updatedIR.filters!.find(f =>
      f.field.toLowerCase().includes('priority')
    )
    expect(priorityFilter).toBeDefined()

    // STEP 4: Re-translate updated IR
    const translator = createTranslator()
    const updatedPlan = translator.translate(updatedIR)

    expect(updatedPlan.steps.length).toBeGreaterThan(0)

    console.log('[E2E Test] ✓ Updated plan generated')

    // STEP 5: Compile updated IR
    const compiler = await createCompiler()
    const compilationResult = await compiler.compile(updatedIR)

    expect(compilationResult.success).toBe(true)

    console.log('[E2E Test] ✓ Updated workflow compiled successfully')
    console.log('[E2E Test] ✅ Workflow correction test PASSED')
  }, TEST_TIMEOUT)

  // ----------------------------------------------------------------------------
  // Test Case 5: Complex Multi-Step Workflow
  // ----------------------------------------------------------------------------

  it('should handle complex multi-step workflow end-to-end', async () => {
    console.log('[E2E Test] Starting complex multi-step workflow test...')

    const enhancedPrompt: EnhancedPrompt = {
      sections: {
        data: [
          'Read from Google Sheet "Employees" tab "Active"',
          'Read from Google Sheet "TimeOff" tab "Requests"'
        ],
        actions: [
          'Join employees with time off requests by employee_id',
          'Filter to pending requests',
          'Sort by request_date ascending',
          'Classify urgency of each request based on reason and dates'
        ],
        output: ['Format as detailed report with employee info and request details'],
        delivery: ['Email to hr@example.com with weekly summary']
      }
    }

    // Generate IR
    const irGenerator = createIRGenerator(TEST_MODEL_PROVIDER)
    const irResult = await irGenerator.generate(enhancedPrompt)

    expect(irResult.success).toBe(true)
    const ir = irResult.ir!

    // Should have multiple data sources
    expect(ir.data_sources.length).toBeGreaterThanOrEqual(2)

    // Should have transforms (join)
    expect(ir.transforms).toBeDefined()
    expect(ir.transforms!.length).toBeGreaterThan(0)

    // Should have AI operations (classify)
    expect(ir.ai_operations).toBeDefined()
    expect(ir.ai_operations!.length).toBeGreaterThan(0)

    console.log('[E2E Test] ✓ Complex IR generated:', {
      data_sources: ir.data_sources.length,
      transforms: ir.transforms?.length || 0,
      filters: ir.filters?.length || 0,
      ai_operations: ir.ai_operations?.length || 0
    })

    // Translate
    const translator = createTranslator()
    const plan = translator.translate(ir)

    expect(plan.steps.length).toBeGreaterThan(5) // Should be many steps

    console.log('[E2E Test] ✓ Complex plan generated with', plan.steps.length, 'steps')

    // Compile
    const compiler = await createCompiler()
    const compilationResult = await compiler.compile(ir)

    expect(compilationResult.success).toBe(true)
    const workflow = compilationResult.workflow!

    expect(workflow.workflow_steps.length).toBeGreaterThan(5)

    console.log('[E2E Test] ✓ Complex workflow compiled:', {
      total_steps: workflow.workflow_steps.length,
      rule_used: compilationResult.metadata?.rule_used,
      deterministic_percentage: compilationResult.metadata?.deterministic_step_percentage
    })

    console.log('[E2E Test] ✅ Complex multi-step workflow test PASSED')
  }, TEST_TIMEOUT)
})

// ============================================================================
// Performance Benchmarks
// ============================================================================

describe('V6 Performance Benchmarks', () => {
  it('should generate IR within performance target (<30s)', async () => {
    const enhancedPrompt: EnhancedPrompt = {
      sections: {
        data: ['Read from Google Sheet "Test" tab "Data"'],
        delivery: ['Email to test@example.com']
      }
    }

    const startTime = Date.now()
    const irGenerator = createIRGenerator(TEST_MODEL_PROVIDER)
    const result = await irGenerator.generate(enhancedPrompt)
    const duration = Date.now() - startTime

    expect(result.success).toBe(true)
    expect(duration).toBeLessThan(30000) // 30 seconds

    console.log('[Benchmark] IR generation took', duration, 'ms')
  }, 35000)

  it('should compile IR within performance target (<100ms)', async () => {
    // Use a pre-generated valid IR
    const ir: ExtendedLogicalIR = {
      ir_version: '2.0',
      goal: 'Send weekly report from spreadsheet',
      data_sources: [{
        id: 'data',
        type: 'tabular',
        source: 'googlesheets',
        location: 'TestSheet',
        tab: 'Data',
        endpoint: '',
        trigger: '',
        role: 'spreadsheet data'
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
        }],
      edge_cases: [],
      clarifications_required: []
    }

    const startTime = Date.now()
    const compiler = await createCompiler()
    const result = await compiler.compile(ir)
    const duration = Date.now() - startTime

    expect(result.success).toBe(true)
    expect(duration).toBeLessThan(100) // 100ms

    console.log('[Benchmark] Compilation took', duration, 'ms')
  })

  it('should translate IR to natural language within target (<50ms)', () => {
    const ir: ExtendedLogicalIR = {
      ir_version: '2.0',
      goal: 'Send weekly report from spreadsheet',
      data_sources: [{
        id: 'data',
        type: 'tabular',
        source: 'googlesheets',
        location: 'TestSheet',
        tab: 'Data',
        endpoint: '',
        trigger: '',
        role: 'spreadsheet data'
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
        }],
      edge_cases: [],
      clarifications_required: []
    }

    const startTime = Date.now()
    const translator = createTranslator()
    const plan = translator.translate(ir)
    const duration = Date.now() - startTime

    expect(plan.steps.length).toBeGreaterThan(0)
    expect(duration).toBeLessThan(50) // 50ms

    console.log('[Benchmark] Translation took', duration, 'ms')
  })
})
