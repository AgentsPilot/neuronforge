/**
 * Tabular Grouped Delivery Rule
 *
 * Handles the most common workflow pattern:
 * 1. Read from tabular data source (spreadsheet/database)
 * 2. Filter/transform data
 * 3. Optionally: classify/process with AI
 * 4. Partition/group by field
 * 5. Deliver one output per group (e.g., one email per salesperson)
 *
 * Example use cases:
 * - "Send stage 4 leads to sales people" (group by Sales Person)
 * - "Email each manager their team's metrics" (group by Manager)
 * - "Send regional reports to local teams" (group by Region)
 *
 * This pattern covers ~60% of business workflows.
 */

import type { ExtendedLogicalIR } from '../../logical-ir/schemas/extended-ir-types'
import type { CompilerContext } from '../LogicalIRCompiler'
import type { WorkflowStep } from '../../../../pilot/types/pilot-dsl-types'
import { BaseCompilerRule } from './CompilerRule'
import { DataSourceResolver } from '../resolvers/DataSourceResolver'
import { TransformResolver } from '../resolvers/TransformResolver'
import { AIOperationResolver } from '../resolvers/AIOperationResolver'
import { LoopResolver } from '../resolvers/LoopResolver'
import { DeliveryResolver } from '../resolvers/DeliveryResolver'
import { PluginResolver } from '../utils/PluginResolver'

// ============================================================================
// Tabular Grouped Delivery Rule
// ============================================================================

export class TabularGroupedDeliveryRule extends BaseCompilerRule {
  name = 'TabularGroupedDeliveryRule'
  description = 'Tabular data → Filter/Transform → Group → Deliver per group'
  priority = 200 // High priority for common pattern

  private dataSourceResolver!: DataSourceResolver
  private transformResolver!: TransformResolver
  private aiOperationResolver!: AIOperationResolver
  private loopResolver!: LoopResolver
  private deliveryResolver!: DeliveryResolver
  private pluginResolver!: PluginResolver

  /**
   * Check if this rule supports the IR
   */
  supports(ir: ExtendedLogicalIR): boolean {
    this.log('Checking if IR matches pattern...')

    // Must have exactly 1 tabular data source
    if (!this.isTabularDataSource(ir) || ir.data_sources.length !== 1) {
      this.log('✗ Does not have single tabular data source')
      return false
    }

    // Must have delivery
    if (!ir.delivery || ir.delivery.length === 0) {
      this.log('✗ No delivery methods')
      return false
    }

    // Must have partitions OR grouping for "per group" delivery
    const hasPartitionOrGrouping = this.hasPartitions(ir) || this.hasGrouping(ir)
    if (!hasPartitionOrGrouping) {
      this.log('✗ No partitions or grouping (not a grouped delivery pattern)')
      return false
    }

    // Must emit per group
    if (ir.grouping && !ir.grouping.emit_per_group) {
      this.log('✗ Grouping exists but not emitting per group')
      return false
    }

    // Cannot have webhooks (different pattern)
    if (this.isWebhookDataSource(ir)) {
      this.log('✗ Webhook data source (use EventTriggeredRule instead)')
      return false
    }

    // Can have simple conditionals (e.g., for handling edge cases)
    // but not complex branching logic (that would be ConditionalBranchingRule)
    if (this.hasConditionals(ir)) {
      const hasComplexConditionals = ir.conditionals && ir.conditionals.some(c =>
        c.then && c.then.length > 1 || c.else && c.else.length > 1
      )
      if (hasComplexConditionals) {
        this.log('✗ Has complex conditionals (use ConditionalBranchingRule instead)')
        return false
      }
      this.log('✓ Has simple conditionals (acceptable for edge case handling)')
    }

    this.logSuccess('Pattern matched!')
    return true
  }

  /**
   * Compile IR to workflow steps
   */
  async compile(context: CompilerContext): Promise<WorkflowStep[]> {
    const { ir, plugin_manager } = context
    this.log('Starting compilation...')

    // Initialize resolvers with PluginManagerV2
    this.dataSourceResolver = new DataSourceResolver(plugin_manager)
    this.transformResolver = new TransformResolver()
    this.aiOperationResolver = new AIOperationResolver()
    this.loopResolver = new LoopResolver(plugin_manager)
    this.deliveryResolver = new DeliveryResolver(plugin_manager)
    this.pluginResolver = new PluginResolver(plugin_manager)

    const steps: WorkflowStep[] = []
    let currentVariable = 'data'

    // STEP 1: Read data source
    this.log('Step 1: Resolving data source...')
    const dataSourceSteps = await this.dataSourceResolver.resolve(ir.data_sources, 'read')
    steps.push(...dataSourceSteps)
    currentVariable = dataSourceSteps[0].output_variable!
    this.logSuccess(`Data source resolved: ${currentVariable}`)

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

    // STEP 4: Apply AI operations (if any)
    if (this.hasAIOperations(ir)) {
      this.log('Step 4: Resolving AI operations...')
      const aiSteps = await this.aiOperationResolver.resolve(ir.ai_operations!, currentVariable, 'ai')
      steps.push(...aiSteps)
      if (aiSteps.length > 0) {
        currentVariable = aiSteps[aiSteps.length - 1].output_variable!
      }
      this.logSuccess(`AI operations resolved: ${aiSteps.length} operations`)
    }

    // STEP 5: Partition data
    if (this.hasPartitions(ir)) {
      this.log('Step 5: Resolving partitions...')
      const partitionSteps = await this.loopResolver.resolvePartitions(ir.partitions!, currentVariable, 'partition')
      steps.push(...partitionSteps)
      if (partitionSteps.length > 0) {
        currentVariable = partitionSteps[partitionSteps.length - 1].output_variable!
      }
      this.logSuccess(`Partitions resolved: ${partitionSteps.length} partitions`)
    }

    // STEP 6: Group data
    if (this.hasGrouping(ir)) {
      this.log('Step 6: Resolving grouping...')
      const groupStep = await this.loopResolver.resolveGrouping(ir.grouping, currentVariable, 'group')
      if (groupStep) {
        steps.push(groupStep)
        currentVariable = groupStep.output_variable!
      }
      this.logSuccess('Grouping resolved')
    }

    // STEP 7: Scatter-gather for per-group processing
    this.log('Step 7: Creating scatter-gather for per-group delivery...')
    const scatterGatherStep = this.createPerGroupScatterGather(ir, currentVariable)
    steps.push(scatterGatherStep)
    this.logSuccess('Scatter-gather created')

    this.logSuccess(`Compilation complete: ${steps.length} total steps`)
    return steps
  }

  /**
   * Create scatter-gather step for per-group delivery
   */
  private createPerGroupScatterGather(ir: ExtendedLogicalIR, inputVariable: string): WorkflowStep {
    const groupField = ir.partitions?.[0]?.field || ir.grouping?.group_by || 'group'

    // Create nested actions for each group
    const nestedActions: any[] = []

    // STEP 1: Render the table for this group
    if (ir.rendering && ir.rendering.type) {
      nestedActions.push({
        step_id: 'render_group_table',
        type: 'transform',
        operation: 'render',
        config: {
          input: '{{group.items}}',
          type: ir.rendering.type,
          template: ir.rendering.template,
          columns_in_order: ir.rendering.columns_in_order,
          empty_message: ir.rendering.empty_message || 'No data'
        },
        output_variable: 'rendered_table'
      })
    }

    // STEP 2: Create delivery steps for each group
    for (let i = 0; i < ir.delivery.length; i++) {
      const delivery = ir.delivery[i]

      // Determine recipient
      let recipient = delivery.config.recipient

      // If recipient_source is specified, use group key
      if (delivery.config.recipient_source) {
        recipient = '{{group.key}}'
      }
      // If recipient contains a template variable that matches the grouping field, use group key
      else if (recipient && recipient.includes('{{') && recipient.includes('}}')) {
        // Extract variable name from template
        const varMatch = recipient.match(/\{\{([^}]+)\}\}/)
        const varName = varMatch ? varMatch[1].trim() : ''

        // If it matches the grouping field, replace with group.key
        if (varName === groupField) {
          recipient = '{{group.key}}'
        }
        // Otherwise keep the original (might be a static email or other variable)
      }
      // Static recipient - keep as is

      nestedActions.push({
        step_id: `group_delivery_${i + 1}`,
        type: 'action',
        plugin: this.getDeliveryPlugin(delivery.method),
        action: 'send_email',  // Use 'action' for PILOT executor compatibility
        config: {
          recipient,
          cc: delivery.config.cc || [],
          subject: delivery.config.subject || `${groupField} Report`,
          body: ir.rendering ? '{{rendered_table}}' : '{{group.items}}'
        },
        output_variable: `delivery_${i + 1}_result`
      })
    }

    return {
      id: 'scatter_deliver',
      step_id: 'scatter_deliver',
      name: `Deliver to each ${groupField}`,
      type: 'scatter_gather',
      operation: 'parallel_process',
      config: {
        input: `{{${inputVariable}}}`,
        item_variable: 'group',
        actions: nestedActions,
        max_concurrency: 10
      },
      output_variable: 'scatter_deliver_output',
      description: `Deliver to each ${groupField}`
    }
  }

  /**
   * Get delivery plugin name (schema-driven)
   * Uses PluginResolver to find plugins by capability instead of hardcoded mapping
   */
  private getDeliveryPlugin(method: string): string {
    return this.pluginResolver.resolveDeliveryMethodToPlugin(method)
  }

  /**
   * Validate IR before compilation
   */
  validate(ir: ExtendedLogicalIR): { valid: boolean; errors?: string[]; warnings?: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    // Check data source has location
    const dataSource = ir.data_sources[0]
    if (!dataSource.location) {
      errors.push('Data source missing location')
    }

    // Check partition/grouping field exists
    const partitionField = ir.partitions?.[0]?.field
    const groupingField = ir.grouping?.group_by

    if (!partitionField && !groupingField) {
      errors.push('Missing partition or grouping field')
    }

    // Check delivery has recipient or recipient_source
    for (const delivery of ir.delivery) {
      if (delivery.method === 'email') {
        if (!delivery.config.recipient && !delivery.config.recipient_source) {
          warnings.push('Email delivery missing recipient (will use group key)')
        }
      }
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
    let steps = 1 // data source
    steps += ir.filters?.length || 0
    steps += ir.transforms?.length || 0
    steps += ir.ai_operations?.length || 0
    steps += ir.partitions?.length || 0
    steps += ir.grouping ? 1 : 0
    steps += 1 // scatter-gather

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
export function createTabularGroupedDeliveryRule(): TabularGroupedDeliveryRule {
  return new TabularGroupedDeliveryRule()
}
