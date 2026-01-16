/**
 * API Data Source With Loops Rule
 *
 * Handles workflows that:
 * 1. Fetch data from API sources (Gmail, Airtable, REST APIs)
 * 2. Iterate over collections (emails, records, items)
 * 3. Apply AI operations (extraction, classification, enrichment)
 * 4. Deliver results
 *
 * Pattern Examples:
 * - Gmail emails → Extract from PDFs → Aggregate → Email
 * - Airtable records → AI enrichment → Update records
 * - REST API → Process items → Webhook delivery
 */

import type { ExtendedLogicalIR } from '../../logical-ir/schemas/extended-ir-types'
import type { WorkflowStep } from '../../../../pilot/types/pilot-dsl-types'
import type { CompilerContext } from '../LogicalIRCompiler'
import { BaseCompilerRule } from './CompilerRule'
import { DataSourceResolver } from '../resolvers/DataSourceResolver'
import { DeliveryResolver } from '../resolvers/DeliveryResolver'
import { AIOperationResolver } from '../resolvers/AIOperationResolver'
import { LoopResolver } from '../resolvers/LoopResolver'
import { FilterResolver } from '../resolvers/FilterResolver'

// ============================================================================
// API Data Source With Loops Rule
// ============================================================================

export class APIDataSourceWithLoopsRule extends BaseCompilerRule {
  name = 'APIDataSourceWithLoopsRule'
  description = 'Compiles workflows with API data sources, loops, and AI operations'
  priority = 100 // High priority for complex workflows

  private dataSourceResolver!: DataSourceResolver
  private deliveryResolver!: DeliveryResolver
  private aiOperationResolver!: AIOperationResolver
  private loopResolver!: LoopResolver
  private filterResolver!: FilterResolver

  /**
   * Check if this rule can handle the given IR
   */
  supports(ir: ExtendedLogicalIR): boolean {
    this.log('Checking if rule supports IR...')

    // Must have at least one data source of type "api"
    const hasAPIDataSource = ir.data_sources.some(ds => ds.type === 'api')
    if (!hasAPIDataSource) {
      this.log('✗ No API data sources found')
      return false
    }

    // Must have loops (for iteration)
    const hasLoops = ir.loops && ir.loops.length > 0
    if (!hasLoops) {
      this.log('✗ No loops found')
      return false
    }

    // Must have AI operations OR transforms OR filters
    const hasProcessing =
      (ir.ai_operations && ir.ai_operations.length > 0) ||
      (ir.transforms && ir.transforms.length > 0) ||
      (ir.filters && ir.filters.length > 0)

    if (!hasProcessing) {
      this.log('✗ No processing steps (AI/transforms/filters) found')
      return false
    }

    // Must have delivery
    const hasDelivery = ir.delivery && ir.delivery.length > 0
    if (!hasDelivery) {
      this.log('✗ No delivery methods found')
      return false
    }

    this.log('✓ Rule supports this IR')
    this.log(`  - API data sources: ${ir.data_sources.filter(ds => ds.type === 'api').length}`)
    this.log(`  - Loops: ${ir.loops.length}`)
    this.log(`  - AI operations: ${ir.ai_operations?.length || 0}`)
    this.log(`  - Delivery methods: ${ir.delivery.length}`)

    return true
  }

  /**
   * Compile IR to workflow steps
   */
  async compile(context: CompilerContext): Promise<WorkflowStep[]> {
    const { ir, plugin_manager } = context
    this.log('Starting compilation...')

    // Initialize resolvers with PluginManager
    this.dataSourceResolver = new DataSourceResolver(plugin_manager)
    this.deliveryResolver = new DeliveryResolver(plugin_manager)
    this.aiOperationResolver = new AIOperationResolver()
    this.loopResolver = new LoopResolver(plugin_manager)
    this.filterResolver = new FilterResolver()

    const steps: WorkflowStep[] = []

    // STEP 1: Resolve data sources (API calls)
    this.log('Step 1: Resolving data sources...')
    const dataSourceSteps = await this.dataSourceResolver.resolve(ir.data_sources, 'api_fetch')
    steps.push(...dataSourceSteps)

    const dataVariable = dataSourceSteps[dataSourceSteps.length - 1]?.output_variable || 'api_data'
    this.log(`  ✓ Data will be available in: ${dataVariable}`)

    // STEP 2: Apply filters (if any)
    let currentVariable = dataVariable
    if (ir.filters && ir.filters.length > 0) {
      this.log('Step 2: Applying filters...')
      const filterSteps = await this.filterResolver.resolve(ir.filters, currentVariable, 'filter')
      steps.push(...filterSteps)
      currentVariable = filterSteps[filterSteps.length - 1]?.output_variable || currentVariable
      this.log(`  ✓ Filtered data in: ${currentVariable}`)
    }

    // STEP 3: Process loops with AI operations
    this.log('Step 3: Processing loops...')
    this.log(`IR has ${ir.ai_operations?.length || 0} AI operations:`)
    console.log('[APIDataSourceWithLoopsRule] AI operations:', JSON.stringify(ir.ai_operations, null, 2))
    for (let i = 0; i < ir.loops.length; i++) {
      const loop = ir.loops[i]
      this.log(`  Processing loop ${i + 1}: ${loop.id}`)
      console.log('[APIDataSourceWithLoopsRule] Loop structure:', JSON.stringify(loop, null, 2))

      // Check if loop input variable exists, if not inject extraction step
      const loopInputVar = this.extractVariableName(loop.for_each)
      if (loopInputVar !== currentVariable) {
        this.log(`  ⚠ Loop expects {{${loopInputVar}}} but current data is {{${currentVariable}}}`)
        this.log(`  → Injecting extraction transform...`)

        // Inject extraction step to get the missing variable
        const extractStep: WorkflowStep = {
          step_id: `extract_${loopInputVar}`,
          type: 'transform',
          operation: 'extract_field',
          config: {
            input: `{{${currentVariable}}}`,
            field: loopInputVar,
            flatten: true
          },
          output_variable: loopInputVar,
          description: `Extract ${loopInputVar} from ${currentVariable}`
        }

        steps.push(extractStep)
        currentVariable = loopInputVar
        this.log(`  ✓ Extracted data in: ${currentVariable}`)
      }

      // Create scatter-gather step for parallel processing
      const loopStep = await this.createLoopWithAIProcessing(
        loop,
        ir.ai_operations || [],
        currentVariable,
        `loop_${i + 1}`
      )
      steps.push(loopStep)
      currentVariable = loopStep.output_variable!
      this.log(`  ✓ Loop output in: ${currentVariable}`)

      // Add flatten step after loop to convert array of arrays to flat array
      this.log(`  → Adding flatten step to aggregate loop results...`)
      const flattenStep: WorkflowStep = {
        step_id: `flatten_${i + 1}`,
        type: 'transform',
        operation: 'flatten',
        config: {
          input: `{{${currentVariable}}}`,
          depth: 1
        },
        output_variable: `flatten_${i + 1}_output`,
        description: `Flatten loop results into single array`
      }
      steps.push(flattenStep)
      currentVariable = flattenStep.output_variable!
      this.log(`  ✓ Flattened data in: ${currentVariable}`)
    }

    // STEP 4: Apply normalization (if specified)
    if (ir.normalization) {
      this.log('Step 4: Applying normalization...')
      const normalizeStep = this.createNormalizationStep(
        ir.normalization,
        currentVariable,
        'normalize'
      )
      steps.push(normalizeStep)
      currentVariable = normalizeStep.output_variable!
      this.log(`  ✓ Normalized data in: ${currentVariable}`)
    }

    // STEP 5: Apply rendering (if specified for table/formatting)
    if (ir.rendering && ir.rendering.type) {
      this.log('Step 5: Applying rendering...')
      const renderStep = this.createRenderingStep(
        ir.rendering,
        currentVariable,
        'render'
      )
      steps.push(renderStep)
      currentVariable = renderStep.output_variable!
      this.log(`  ✓ Rendered output in: ${currentVariable}`)
    }

    // STEP 6: Delivery
    this.log('Step 6: Resolving delivery...')
    const deliverySteps = await this.deliveryResolver.resolve(
      ir.delivery,
      currentVariable,
      'deliver'
    )
    steps.push(...deliverySteps)

    this.log(`✓ Compilation complete: ${steps.length} steps generated`)
    return steps
  }

  /**
   * Create a loop step with AI processing
   */
  private async createLoopWithAIProcessing(
    loop: any,
    aiOperations: any[],
    inputVariable: string,
    stepId: string
  ): Promise<WorkflowStep> {
    this.log(`  Creating loop with AI processing: ${loop.id}`)
    console.log(`[APIDataSourceWithLoopsRule]   Loop.do array:`, loop.do)
    console.log(`[APIDataSourceWithLoopsRule]   Available AI operations:`, aiOperations?.map(op => op.id) || [])

    // Find AI operations referenced in this loop
    let loopAIOperations: any[] = []

    if (loop.do && loop.do.length > 0) {
      // Loop has explicit 'do' array - try to match operations

      // First, try matching by ID (strict)
      loopAIOperations = aiOperations.filter(aiOp =>
        loop.do.includes(aiOp.id)
      )

      // If no matches by ID, try fuzzy matching by instruction/type
      if (loopAIOperations.length === 0) {
        this.log(`  ⚠ Loop 'do' array doesn't reference AI operation IDs - trying fuzzy match`)
        loopAIOperations = aiOperations.filter(aiOp => {
          // Check if any action in loop.do contains keywords from the AI operation
          const instruction = aiOp.instruction?.toLowerCase() || ''
          const type = aiOp.type?.toLowerCase() || ''

          return loop.do.some((action: string) => {
            const actionLower = action.toLowerCase()
            // Match if action contains the AI operation type or key words from instruction
            return actionLower.includes(type) ||
                   instruction.split(' ').some((word: string) => word.length > 3 && actionLower.includes(word))
          })
        })

        // If still no matches, use ALL AI operations (safest fallback)
        if (loopAIOperations.length === 0) {
          this.log(`  ⚠ No fuzzy matches found - using all AI operations`)
          loopAIOperations = aiOperations || []
        }
      }

      console.log(`[APIDataSourceWithLoopsRule]   Matched AI operations for loop:`, loopAIOperations.map(op => op.id))
    } else {
      // Loop doesn't have 'do' array - use ALL AI operations
      this.log(`  ⚠ Loop has no 'do' array - inferring all AI operations should run`)
      loopAIOperations = aiOperations || []
      console.log(`[APIDataSourceWithLoopsRule]   Inferred AI operations:`, loopAIOperations.map(op => op.id))
    }

    // Build nested steps for the loop
    const nestedSteps: any[] = []

    for (const aiOp of loopAIOperations) {
      nestedSteps.push({
        step_id: `${stepId}_ai_${aiOp.id}`,
        type: 'ai_processing',
        operation: aiOp.type, // 'extract', 'classify', 'enrich'
        config: {
          instruction: aiOp.instruction,
          input_source: aiOp.input_source,
          output_schema: aiOp.output_schema,
          constraints: aiOp.constraints
        },
        output_variable: `${stepId}_ai_${aiOp.id}_result`
      })
    }

    this.log(`  ✓ Created ${nestedSteps.length} nested AI steps`)
    if (nestedSteps.length > 0) {
      this.log(`  Nested steps:`, nestedSteps.map(s => ({ step_id: s.step_id, type: s.type })))
    }

    return {
      id: stepId,
      step_id: stepId,
      name: `Process ${loop.item_variable} with AI`,
      type: 'scatter_gather',
      operation: 'parallel_process',
      config: {
        input: `{{${this.extractVariableName(loop.for_each)}}}`,
        item_variable: loop.item_variable,
        actions: nestedSteps,
        max_iterations: loop.max_iterations || 1000,
        max_concurrency: loop.max_concurrency || 10
      },
      output_variable: `${stepId}_output`,
      description: `Process each ${loop.item_variable} with AI operations`
    }
  }

  /**
   * Create normalization step
   */
  private createNormalizationStep(
    normalization: any,
    inputVariable: string,
    stepId: string
  ): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'normalize',
      config: {
        input: `{{${inputVariable}}}`,
        required_headers: normalization.required_headers,
        case_sensitive: normalization.case_sensitive,
        missing_header_action: normalization.missing_header_action
      },
      output_variable: `${stepId}_output`,
      description: 'Normalize data structure and headers'
    }
  }

  /**
   * Create rendering step (for tables, formatting)
   */
  private createRenderingStep(
    rendering: any,
    inputVariable: string,
    stepId: string
  ): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'render',
      config: {
        input: `{{${inputVariable}}}`,
        type: rendering.type, // 'email_embedded_table', 'html', 'json'
        template: rendering.template,
        engine: rendering.engine,
        columns_in_order: rendering.columns_in_order,
        empty_message: rendering.empty_message
      },
      output_variable: `${stepId}_output`,
      description: `Render as ${rendering.type}`
    }
  }

  /**
   * Extract variable name from {{variable}} or just return the string
   */
  private extractVariableName(source: string): string {
    if (!source) return source
    const match = source.match(/\{\{([^}]+)\}\}/)
    return match ? match[1] : source
  }

  /**
   * Get example IR that this rule can compile
   */
  getExampleIR(): ExtendedLogicalIR {
    return {
      ir_version: '2.0',
      goal: 'Extract expense data from Gmail PDFs and email summary',
      data_sources: [
        {
          id: 'gmail_emails',
          type: 'api',
          source: 'gmail',
          location: 'emails',
          tab: '',
          endpoint: '',
          trigger: '',
          role: 'emails with expense receipts'
        }
      ],
      normalization: {
        required_headers: ['date', 'vendor', 'amount'],
        case_sensitive: false,
        missing_header_action: 'warn'
      },
      filters: [
        {
          id: 'filter_1',
          field: 'subject',
          operator: 'contains',
          value: 'receipt',
          description: 'Filter emails with receipts'
        }
      ],
      transforms: [],
      ai_operations: [
        {
          id: 'ai_extract',
          type: 'extract',
          instruction: 'Extract expense data from receipt',
          input_source: '{{pdf_content}}',
          output_schema: {
            type: 'object',
            fields: [
              { name: 'date', type: 'string', required: true },
              { name: 'vendor', type: 'string', required: true },
              { name: 'amount', type: 'number', required: true }
            ]
          },
          constraints: { max_tokens: 500, temperature: 0.3 }
        }
      ],
      conditionals: [],
      loops: [
        {
          id: 'loop_pdfs',
          for_each: '{{filtered_emails}}',
          item_variable: 'email',
          do: ['ai_extract'],
          max_iterations: 100,
          max_concurrency: 5
        }
      ],
      partitions: [],
      grouping: undefined,
      rendering: {
        type: 'email_embedded_table',
        columns_in_order: ['date', 'vendor', 'amount']
      },
      delivery: [
        {
          id: 'email_delivery',
          method: 'email',
          config: {
            recipient: 'user@example.com',
            subject: 'Expense Summary',
            body: '{{rendered_table}}'
          }
        }
      ],
      edge_cases: [],
      clarifications_required: []
    } as unknown as ExtendedLogicalIR
  }
}
