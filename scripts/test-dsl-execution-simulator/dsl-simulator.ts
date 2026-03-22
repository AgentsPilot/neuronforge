/**
 * A4-A8: DSLSimulator — Step execution engine
 *
 * Walks DSL steps in order, executing each based on its type.
 * Uses VariableStore for state and StubDataGenerator for plugin action outputs.
 */

import { VariableStore } from './variable-store'
import { generateFromSchema, GeneratorOptions } from './stub-data-generator'

export interface StepLogEntry {
  step_id: string
  type: string
  plugin?: string
  operation?: string
  description: string
  resolved_config?: any
  output_variable?: string
  output_shape?: { type: string; keys?: string[]; length?: number }
  status: 'ok' | 'warning' | 'error'
  warnings: string[]
  errors: string[]
  unresolved_refs: string[]
}

export interface SimulationResult {
  stepLog: StepLogEntry[]
  totalSteps: number
  executed: number
  skipped: number
  warnings: number
  errors: number
}

export class DSLSimulator {
  private store: VariableStore
  private stepLog: StepLogEntry[] = []
  private iterationIndex: number = 0

  constructor(store: VariableStore) {
    this.store = store
  }

  /**
   * Run all DSL steps sequentially.
   */
  async run(steps: any[]): Promise<SimulationResult> {
    this.stepLog = []

    for (const step of steps) {
      await this.executeStep(step)
    }

    const warnings = this.stepLog.filter(s => s.status === 'warning').length
    const errors = this.stepLog.filter(s => s.status === 'error').length

    return {
      stepLog: this.stepLog,
      totalSteps: this.stepLog.length,
      executed: this.stepLog.length,
      skipped: 0,
      warnings,
      errors,
    }
  }

  private async executeStep(step: any): Promise<void> {
    const type = step.type
    const entry: StepLogEntry = {
      step_id: step.step_id || step.id,
      type,
      description: step.description || '',
      status: 'ok',
      warnings: [],
      errors: [],
      unresolved_refs: [],
    }

    try {
      switch (type) {
        case 'action':
          this.executeAction(step, entry)
          break
        case 'transform':
          this.executeTransform(step, entry)
          break
        case 'conditional':
          await this.executeConditional(step, entry)
          break
        case 'scatter_gather':
          await this.executeScatterGather(step, entry)
          break
        case 'ai_processing':
          this.executeAiProcessing(step, entry)
          break
        default:
          entry.warnings.push(`Unknown step type: ${type}`)
          entry.status = 'warning'
      }
    } catch (err: any) {
      entry.errors.push(err.message || String(err))
      entry.status = 'error'
    }

    if (entry.unresolved_refs.length > 0) {
      entry.status = entry.status === 'error' ? 'error' : 'warning'
    }

    this.stepLog.push(entry)
    this.logStepToConsole(entry)
  }

  /**
   * A4: Execute action step — resolve config params, generate stub from output_schema.
   */
  private executeAction(step: any, entry: StepLogEntry): void {
    entry.plugin = step.plugin
    entry.operation = step.operation || step.action

    // Resolve config/params
    const config = step.config || step.params || {}
    const { resolved, unresolvedRefs } = this.store.resolveDeep(config)
    entry.resolved_config = resolved
    entry.unresolved_refs = unresolvedRefs

    // Generate stub output from output_schema
    if (step.output_variable && step.output_schema) {
      const opts: GeneratorOptions = { indexSuffix: this.iterationIndex > 0 ? String(this.iterationIndex).padStart(3, '0') : '001' }
      const stubData = generateFromSchema(step.output_schema, opts)
      this.store.setStepOutput(step.output_variable, stubData)
      entry.output_variable = step.output_variable
      entry.output_shape = describeShape(stubData)
    } else if (step.output_variable) {
      entry.warnings.push(`No output_schema for action step — cannot generate stub data`)
      this.store.setStepOutput(step.output_variable, {})
      entry.output_variable = step.output_variable
    }
  }

  /**
   * A5: Execute transform step — filter, flatten, map, reduce.
   */
  private executeTransform(step: any, entry: StepLogEntry): void {
    const config = step.config || {}
    const operation = step.operation || config.type

    // Resolve the input reference
    const inputRef = step.input || config.input
    let inputData: any = null
    if (inputRef) {
      const { resolved } = this.store.resolveDeep(inputRef)
      inputData = resolved
    }

    let output: any = null

    switch (operation) {
      case 'filter': {
        if (Array.isArray(inputData)) {
          // Simulate filter — for stub purposes, keep ~2/3 of items
          const condition = config.condition
          output = this.simulateFilter(inputData, condition)
        } else {
          output = inputData
          entry.warnings.push(`Filter input is not an array: ${typeof inputData}`)
        }
        break
      }
      case 'flatten': {
        if (Array.isArray(inputData)) {
          output = inputData
        } else if (inputData && typeof inputData === 'object') {
          // Simulate flatten: extract nested arrays
          // For email→attachments, generate stub attachment items
          if (step.output_schema) {
            output = generateFromSchema(step.output_schema, { arrayItemCount: 3 })
          } else {
            output = [inputData]
          }
        } else {
          output = inputData
        }
        break
      }
      case 'map': {
        if (Array.isArray(inputData)) {
          // For map, if there's an output_schema, generate items matching that schema
          if (step.output_schema?.items) {
            output = inputData.map((_, i) =>
              generateFromSchema(step.output_schema.items, { indexSuffix: String(i + 1).padStart(3, '0') })
            )
          } else {
            output = inputData
          }
        } else {
          output = inputData
        }
        break
      }
      case 'reduce': {
        const reduceOp = config.reduce_operation || config.reducer
        if (reduceOp === 'count') {
          output = Array.isArray(inputData) ? inputData.length : 0
        } else if (reduceOp === 'sum') {
          output = Array.isArray(inputData) ? inputData.reduce((sum: number, item: any) => sum + (item?.amount || 0), 0) : 0
        } else {
          output = Array.isArray(inputData) ? inputData.length : 0
        }
        break
      }
      default:
        entry.warnings.push(`Unknown transform operation: ${operation}`)
        output = inputData
    }

    if (step.output_variable) {
      this.store.setStepOutput(step.output_variable, output)
      entry.output_variable = step.output_variable
      entry.output_shape = describeShape(output)
    }

    // Resolve any {{}} refs in config for validation
    const { unresolvedRefs } = this.store.resolveDeep(config)
    entry.unresolved_refs = unresolvedRefs
    entry.resolved_config = { operation, input: inputRef, itemCount: Array.isArray(output) ? output.length : undefined }
  }

  /**
   * Simulate a filter operation based on condition.
   * For stub data, we evaluate what we can and pass through the rest.
   */
  private simulateFilter(items: any[], condition: any): any[] {
    if (!condition) return items

    // For complex_and conditions, just return ~2/3 of items as a simulation
    if (condition.conditionType === 'complex_and' || condition.conditionType === 'complex_or') {
      return items.slice(0, Math.max(1, Math.ceil(items.length * 0.67)))
    }

    // Simple conditions — try to evaluate
    const field = condition.field?.replace('item.', '') || ''
    const operator = condition.operator
    const condValue = condition.value

    return items.filter(item => {
      const itemValue = getNestedValue(item, field)
      switch (operator) {
        case 'eq': return itemValue === condValue
        case 'neq': return itemValue !== condValue
        case 'gt': return typeof itemValue === 'number' && itemValue > Number(condValue)
        case 'gte': return typeof itemValue === 'number' && itemValue >= Number(condValue)
        case 'lt': return typeof itemValue === 'number' && itemValue < Number(condValue)
        case 'exists': return itemValue !== undefined && itemValue !== null
        case 'contains': return typeof itemValue === 'string' && itemValue.includes(String(condValue))
        default: return true // pass through unknown operators
      }
    })
  }

  /**
   * A6: Execute conditional step — evaluate condition, pick branch.
   */
  private async executeConditional(step: any, entry: StepLogEntry): Promise<void> {
    const condition = step.condition
    let conditionMet = false

    if (condition) {
      conditionMet = this.evaluateCondition(condition)
    }

    entry.resolved_config = {
      condition_evaluated: conditionMet,
      branch: conditionMet ? 'then' : 'else',
    }

    // Execute the selected branch
    const branchSteps = conditionMet ? (step.steps || step.then_steps || []) : (step.else_steps || [])

    if (branchSteps.length > 0) {
      for (const branchStep of branchSteps) {
        await this.executeStep(branchStep)
      }
    } else {
      entry.warnings.push(`No steps in ${conditionMet ? 'then' : 'else'} branch`)
    }
  }

  /**
   * Evaluate a condition against current variable state.
   */
  private evaluateCondition(condition: any): boolean {
    const { conditionType, operator, field, value } = condition

    if (conditionType === 'complex_and') {
      return (condition.conditions || []).every((c: any) => this.evaluateCondition(c))
    }
    if (conditionType === 'complex_or') {
      return (condition.conditions || []).some((c: any) => this.evaluateCondition(c))
    }

    // Simple condition
    const fieldRef = field || ''
    let fieldValue: any

    // Resolve field reference
    if (fieldRef.startsWith('item.')) {
      // Inside a filter — handled by simulateFilter
      return true
    }

    // Look up from variable store
    const { resolved } = this.store.resolveDeep(`{{${fieldRef}}}`)
    fieldValue = resolved === `{{${fieldRef}}}` ? undefined : resolved

    // Resolve condition value if it's a template
    let resolvedValue = value
    if (typeof value === 'string' && value.includes('{{')) {
      const { resolved: rv } = this.store.resolveDeep(value)
      resolvedValue = rv
    }

    switch (operator) {
      case 'exists': return fieldValue !== undefined && fieldValue !== null && fieldValue !== '' && (Array.isArray(fieldValue) ? fieldValue.length > 0 : true)
      case 'not_exists': return fieldValue === undefined || fieldValue === null
      case 'greater_than':
      case 'gt': return Number(fieldValue) > Number(resolvedValue)
      case 'less_than':
      case 'lt': return Number(fieldValue) < Number(resolvedValue)
      case 'eq':
      case 'equals': return fieldValue === resolvedValue
      case 'neq':
      case 'not_equals': return fieldValue !== resolvedValue
      case 'contains': return String(fieldValue).includes(String(resolvedValue))
      default: return true
    }
  }

  /**
   * A7: Execute scatter-gather step — fan out, run nested steps per item, collect.
   */
  private async executeScatterGather(step: any, entry: StepLogEntry): Promise<void> {
    const scatter = step.scatter
    if (!scatter) {
      entry.errors.push('scatter_gather step missing scatter config')
      entry.status = 'error'
      return
    }

    // Resolve scatter input
    const inputRef = scatter.input
    const { resolved: inputData } = this.store.resolveDeep(inputRef)
    const itemVariable = scatter.itemVariable || 'item'
    const nestedSteps = scatter.steps || []

    if (!Array.isArray(inputData)) {
      entry.warnings.push(`Scatter input is not an array: ${typeof inputData}`)
      if (step.output_variable) {
        this.store.setStepOutput(step.output_variable, [])
        entry.output_variable = step.output_variable
        entry.output_shape = { type: 'array', length: 0 }
      }
      return
    }

    entry.resolved_config = {
      input_items: inputData.length,
      item_variable: itemVariable,
      nested_steps: nestedSteps.length,
    }

    const collectedResults: any[] = []

    for (let i = 0; i < inputData.length; i++) {
      const item = inputData[i]
      this.iterationIndex = i + 1

      // Set the item variable in scope
      this.store.setScopedVar(itemVariable, item)

      // Execute nested steps for this iteration
      // We need a separate log for nested steps — they get added to main log
      let lastOutput: any = null
      for (const nestedStep of nestedSteps) {
        await this.executeStep(nestedStep)
        // Track last output for collection
        if (nestedStep.output_variable) {
          lastOutput = this.store.getStepOutput(nestedStep.output_variable)
        }
      }

      if (lastOutput !== null) {
        collectedResults.push(lastOutput)
      }

      // Clear scoped variable
      this.store.clearScopedVar(itemVariable)
    }

    this.iterationIndex = 0

    // Gather
    const gatherOp = step.gather?.operation || 'collect'
    let gatherResult: any

    switch (gatherOp) {
      case 'collect':
        gatherResult = collectedResults
        break
      case 'flatten':
        gatherResult = collectedResults.flat()
        break
      case 'merge':
        gatherResult = Object.assign({}, ...collectedResults)
        break
      default:
        gatherResult = collectedResults
    }

    if (step.output_variable) {
      this.store.setStepOutput(step.output_variable, gatherResult)
      entry.output_variable = step.output_variable
      entry.output_shape = describeShape(gatherResult)
    }
  }

  /**
   * A8: Execute ai_processing step — generate stub from output_schema.
   */
  private executeAiProcessing(step: any, entry: StepLogEntry): void {
    // Resolve input reference
    const inputRef = step.input
    let inputData: any = null
    if (inputRef) {
      const { resolved } = this.store.resolveDeep(inputRef)
      inputData = resolved
    }

    // Resolve prompt
    const prompt = step.prompt || ''
    const { resolved: resolvedPrompt, unresolvedRefs: promptRefs } = this.store.resolveDeep(prompt)
    entry.unresolved_refs.push(...promptRefs)

    // Generate stub output from the ai output_schema
    const outputSchema = step.config?.output_schema || step.output_schema
    if (step.output_variable && outputSchema) {
      const stubData = generateFromSchema(outputSchema)
      this.store.setStepOutput(step.output_variable, stubData)
      entry.output_variable = step.output_variable
      entry.output_shape = describeShape(stubData)
    }

    entry.resolved_config = {
      input_type: inputData ? (Array.isArray(inputData) ? `array[${inputData.length}]` : typeof inputData) : 'none',
      prompt_preview: String(resolvedPrompt).substring(0, 100) + '...',
    }
  }

  private logStepToConsole(entry: StepLogEntry): void {
    const icon = entry.status === 'ok' ? '✅' : entry.status === 'warning' ? '⚠️' : '❌'
    const plugin = entry.plugin ? ` [${entry.plugin}/${entry.operation}]` : ''
    const output = entry.output_variable ? ` → ${entry.output_variable}` : ''
    const shape = entry.output_shape ? ` (${formatShape(entry.output_shape)})` : ''

    console.log(`  ${icon} ${entry.step_id} (${entry.type})${plugin}: ${entry.description}${output}${shape}`)

    if (entry.unresolved_refs.length > 0) {
      console.log(`     ⚠️  Unresolved: ${entry.unresolved_refs.join(', ')}`)
    }
    for (const w of entry.warnings) {
      console.log(`     ⚠️  ${w}`)
    }
    for (const e of entry.errors) {
      console.log(`     ❌  ${e}`)
    }
  }
}

// --- Helper functions ---

function describeShape(data: any): { type: string; keys?: string[]; length?: number } {
  if (data === null || data === undefined) return { type: 'null' }
  if (Array.isArray(data)) return { type: 'array', length: data.length }
  if (typeof data === 'object') return { type: 'object', keys: Object.keys(data) }
  return { type: typeof data }
}

function formatShape(shape: { type: string; keys?: string[]; length?: number }): string {
  if (shape.type === 'array') return `array[${shape.length}]`
  if (shape.type === 'object' && shape.keys) return `object{${shape.keys.length} keys}`
  return shape.type
}

function getNestedValue(obj: any, path: string): any {
  if (!path) return obj
  const parts = path.split('.')
  let value = obj
  for (const part of parts) {
    if (value === null || value === undefined) return undefined
    value = value[part]
  }
  return value
}
