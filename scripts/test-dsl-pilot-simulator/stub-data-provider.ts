/**
 * B4: Stub data provider
 *
 * Maps (plugin, action) → stub data using output schemas from DSL steps.
 * Reuses Phase A's stub-data-generator for schema-based generation.
 */

import { generateFromSchema, GeneratorOptions } from '../test-dsl-execution-simulator/stub-data-generator'

/**
 * Registry of output schemas indexed by "plugin/action".
 * Built from the DSL steps before execution starts.
 */
const schemaRegistry = new Map<string, any>()

/**
 * Register all output schemas from DSL steps.
 * Call this before execution so the stub provider knows what to generate.
 */
export function registerOutputSchemas(steps: any[]): void {
  const walkSteps = (stepList: any[]) => {
    for (const step of stepList) {
      if (step.type === 'action' && step.plugin && (step.action || step.operation)) {
        const action = step.action || step.operation
        const key = `${step.plugin}/${action}`
        if (step.output_schema) {
          schemaRegistry.set(key, step.output_schema)
        }
      }

      // Walk nested
      if (step.scatter?.steps) walkSteps(step.scatter.steps)
      if (step.steps) walkSteps(step.steps)
      if (step.then_steps) walkSteps(step.then_steps)
      if (step.else_steps) walkSteps(step.else_steps)
    }
  }

  walkSteps(steps)
  console.log(`  📦 Registered ${schemaRegistry.size} output schemas for stub generation`)
}

/**
 * Generate stub data for a plugin action.
 * Uses output schema from DSL step if available, otherwise returns generic stub.
 */
export function generateStubData(
  plugin: string,
  action: string,
  params: any,
  opts?: GeneratorOptions
): any {
  const key = `${plugin}/${action}`
  const schema = schemaRegistry.get(key)

  if (schema) {
    return generateFromSchema(schema, opts)
  }

  // Fallback — generic stub
  return {
    success: true,
    message: `Mock result for ${plugin}.${action}`,
    data: params,
  }
}
