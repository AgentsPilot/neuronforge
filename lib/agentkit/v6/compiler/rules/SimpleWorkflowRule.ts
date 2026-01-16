/**
 * Simple Workflow Rule
 *
 * Handles basic linear workflows without partitioning or complex control flow:
 * 1. Read data source
 * 2. Apply filters/transforms
 * 3. Optionally: AI operations
 * 4. Deliver results (single delivery, not per-group)
 *
 * Example use cases:
 * - "Read sheet and email the data to me"
 * - "Fetch API data, summarize it, and post to Slack"
 * - "Query database and save results to file"
 *
 * This is the fallback rule for simple workflows (~30% of use cases).
 */

import type { ExtendedLogicalIR } from '../../logical-ir/schemas/extended-ir-types'
import type { CompilerContext } from '../LogicalIRCompiler'
import type { WorkflowStep } from '../../../../pilot/types/pilot-dsl-types'
import { BaseCompilerRule } from './CompilerRule'
import { DataSourceResolver } from '../resolvers/DataSourceResolver'
import { TransformResolver } from '../resolvers/TransformResolver'
import { AIOperationResolver } from '../resolvers/AIOperationResolver'
import { DeliveryResolver } from '../resolvers/DeliveryResolver'

// ============================================================================
// Simple Workflow Rule
// ============================================================================

export class SimpleWorkflowRule extends BaseCompilerRule {
  name = 'SimpleWorkflowRule'
  description = 'Simple linear workflow: Read → Transform → Deliver'
  priority = 50 // Low priority - fallback for simple cases

  private dataSourceResolver!: DataSourceResolver
  private transformResolver!: TransformResolver
  private aiOperationResolver!: AIOperationResolver
  private deliveryResolver!: DeliveryResolver

  /**
   * Check if this rule supports the IR
   */
  supports(ir: ExtendedLogicalIR): boolean {
    this.log('Checking if IR matches simple workflow pattern...')

    // Must have at least one data source
    if (ir.data_sources.length === 0) {
      this.log('✗ No data sources')
      return false
    }

    // Must have delivery
    if (ir.delivery.length === 0) {
      this.log('✗ No delivery methods')
      return false
    }

    // Should NOT have partitions, grouping, loops, or conditionals
    // (those are handled by specialized rules)
    if (this.hasPartitions(ir)) {
      this.log('✗ Has partitions (use specialized rule)')
      return false
    }

    if (this.hasGrouping(ir)) {
      this.log('✗ Has grouping (use specialized rule)')
      return false
    }

    if (this.hasLoops(ir)) {
      this.log('✗ Has loops (use specialized rule)')
      return false
    }

    if (this.hasConditionals(ir)) {
      this.log('✗ Has conditionals (use specialized rule)')
      return false
    }

    // This is a simple linear workflow
    this.logSuccess('Simple workflow pattern matched!')
    return true
  }

  /**
   * Compile IR to workflow steps
   */
  async compile(context: CompilerContext): Promise<WorkflowStep[]> {
    const { ir, plugin_manager } = context
    this.log('Starting simple workflow compilation...')

    // Initialize resolvers with PluginManagerV2
    this.dataSourceResolver = new DataSourceResolver(plugin_manager)
    this.transformResolver = new TransformResolver()
    this.aiOperationResolver = new AIOperationResolver()
    this.deliveryResolver = new DeliveryResolver(plugin_manager)

    const steps: WorkflowStep[] = []
    let currentVariable = 'data'

    // STEP 1: Read data sources
    this.log('Step 1: Resolving data sources...')
    const dataSourceSteps = await this.dataSourceResolver.resolve(ir.data_sources, 'read')
    steps.push(...dataSourceSteps)

    // If multiple data sources, use the last one as current
    if (dataSourceSteps.length > 0) {
      currentVariable = dataSourceSteps[dataSourceSteps.length - 1].output_variable!
    }
    this.logSuccess(`Data sources resolved: ${dataSourceSteps.length} sources`)

    // STEP 2: Apply filters
    if (this.hasFilters(ir)) {
      this.log('Step 2: Resolving filters...')
      const filterSteps = await this.transformResolver.resolveFilters(ir.filters!, currentVariable, 'filter')
      steps.push(...filterSteps)
      if (filterSteps.length > 0) {
        currentVariable = filterSteps[filterSteps.length - 1].output_variable!
      }
      this.logSuccess(`Filters resolved: ${filterSteps.length} filters`)
    }

    // STEP 3: Apply transforms
    if (this.hasTransforms(ir)) {
      this.log('Step 3: Resolving transforms...')
      const transformSteps = await this.transformResolver.resolveTransforms(ir.transforms!, currentVariable, 'transform')
      steps.push(...transformSteps)
      if (transformSteps.length > 0) {
        currentVariable = transformSteps[transformSteps.length - 1].output_variable!
      }
      this.logSuccess(`Transforms resolved: ${transformSteps.length} transforms`)
    }

    // STEP 4: Apply AI operations
    if (this.hasAIOperations(ir)) {
      this.log('Step 4: Resolving AI operations...')
      const aiSteps = await this.aiOperationResolver.resolve(ir.ai_operations!, currentVariable, 'ai')
      steps.push(...aiSteps)
      if (aiSteps.length > 0) {
        currentVariable = aiSteps[aiSteps.length - 1].output_variable!
      }
      this.logSuccess(`AI operations resolved: ${aiSteps.length} operations`)
    }

    // STEP 5: Deliver results
    this.log('Step 5: Resolving delivery...')
    const deliverySteps = await this.deliveryResolver.resolve(ir.delivery, currentVariable, 'deliver')
    steps.push(...deliverySteps)
    this.logSuccess(`Delivery resolved: ${deliverySteps.length} deliveries`)

    this.logSuccess(`Simple workflow compilation complete: ${steps.length} total steps`)
    return steps
  }

  /**
   * Validate IR before compilation
   */
  validate(ir: ExtendedLogicalIR): { valid: boolean; errors?: string[]; warnings?: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    // Check data sources have locations
    for (const ds of ir.data_sources) {
      if (!ds.location) {
        errors.push(`Data source ${ds.id} missing location`)
      }
    }

    // Check email deliveries have recipients
    for (const delivery of ir.delivery) {
      if (delivery.method === 'email') {
        if (!delivery.config.recipient && !delivery.config.recipient_source) {
          errors.push('Email delivery missing recipient')
        }
      }
      if (delivery.method === 'slack') {
        if (!delivery.config.channel) {
          errors.push('Slack delivery missing channel')
        }
      }
    }

    // Warn if too many AI operations
    if (ir.ai_operations && ir.ai_operations.length > 3) {
      warnings.push(`High number of AI operations (${ir.ai_operations.length}) may increase cost`)
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }

  /**
   * Estimate compilation metrics
   */
  estimate(ir: ExtendedLogicalIR): {
    estimatedSteps: number
    estimatedAISteps: number
    estimatedDeterministicSteps: number
  } {
    let steps = ir.data_sources.length
    steps += ir.filters?.length || 0
    steps += ir.transforms?.length || 0
    steps += ir.ai_operations?.length || 0
    steps += ir.delivery.length

    const aiSteps = ir.ai_operations?.length || 0
    const deterministicSteps = steps - aiSteps

    return {
      estimatedSteps: steps,
      estimatedAISteps: aiSteps,
      estimatedDeterministicSteps: deterministicSteps
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create the rule
 */
export function createSimpleWorkflowRule(): SimpleWorkflowRule {
  return new SimpleWorkflowRule()
}
