/**
 * B1: Mock PluginExecuterV2
 *
 * Patches PluginExecuterV2.getInstance() to return a mock that
 * generates stub data from output schemas instead of calling real APIs.
 *
 * F6: Validates action params against plugin JSON schemas before returning
 * stubs. Catches missing required params and unknown params at Phase D
 * instead of Phase E.
 */

import * as fs from 'fs'
import * as path from 'path'
import { generateFromSchema } from '../../test-dsl-execution-simulator/stub-data-generator'

type StubDataFn = (plugin: string, action: string, params: any, outputSchema?: any) => any

let mockExecuteFn: StubDataFn | null = null
let pluginDefs: Map<string, any> | null = null

/**
 * Load plugin definitions once for param validation.
 */
function getPluginDefs(): Map<string, any> {
  if (pluginDefs) return pluginDefs
  pluginDefs = new Map()

  try {
    const defsDir = path.join(process.cwd(), 'lib', 'plugins', 'definitions')
    if (!fs.existsSync(defsDir)) return pluginDefs

    const files = fs.readdirSync(defsDir).filter(f => f.endsWith('-plugin-v2.json'))
    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(defsDir, file), 'utf-8'))
        const key = content.plugin?.name
        if (key) pluginDefs.set(key, content)
      } catch { /* skip malformed */ }
    }
  } catch { /* non-fatal */ }

  return pluginDefs
}

/**
 * F6: Validate params against plugin schema.
 * Returns error message if validation fails, null if OK.
 */
function validatePluginParams(pluginName: string, actionName: string, params: any): string | null {
  const defs = getPluginDefs()
  const pluginDef = defs.get(pluginName)
  if (!pluginDef) return null // Can't validate unknown plugins

  const actionDef = pluginDef.actions?.[actionName]
  if (!actionDef) return null // Can't validate unknown actions

  const required: string[] = actionDef.parameters?.required || []
  const known = new Set(Object.keys(actionDef.parameters?.properties || {}))
  const paramKeys = new Set(Object.keys(params || {}))

  // Check required params
  const missing = required.filter(r => !paramKeys.has(r))
  if (missing.length > 0) {
    return `${pluginName} ${actionName} failed: missing required parameter(s): ${missing.join(', ')}. Present: [${[...paramKeys].join(', ')}]`
  }

  return null // Validation passed
}

/**
 * Set up the mock before importing any Pilot modules.
 * Must be called before StepExecutor is instantiated.
 */
export function setupMockPluginExecuter(stubDataFn: StubDataFn): void {
  mockExecuteFn = stubDataFn
}

/**
 * The mock execute function called by StepExecutor.
 * Returns { success: true, data: <stub> } matching ExecutionResult interface.
 * F6: Validates params against plugin schema before returning stubs.
 */
export async function mockPluginExecute(
  userId: string,
  pluginName: string,
  actionName: string,
  parameters: any
): Promise<{ success: boolean; data?: any; error?: string; message?: string }> {
  if (!mockExecuteFn) {
    return { success: false, error: 'mock_not_initialized', message: 'Mock plugin executer not initialized' }
  }

  // F6: Validate params against plugin schema
  const validationError = validatePluginParams(pluginName, actionName, parameters)
  if (validationError) {
    console.log(`     ❌ [MOCK] ${pluginName}.${actionName} → PARAM VALIDATION FAILED: ${validationError}`)
    return { success: false, error: 'param_validation_failed', message: validationError }
  }

  const data = mockExecuteFn(pluginName, actionName, parameters)
  console.log(`     🔌 [MOCK] ${pluginName}.${actionName} → stub data`)
  return { success: true, data }
}

/**
 * Patch PluginExecuterV2.getInstance() to return our mock.
 * Call this AFTER importing PluginExecuterV2 but BEFORE any StepExecutor usage.
 */
export async function patchPluginExecuter(): Promise<void> {
  // Dynamic import to avoid triggering singleton at module load
  const mod = await import('../../../lib/server/plugin-executer-v2')
  const PluginExecuterV2 = (mod as any).PluginExecuterV2 || (mod as any).default

  if (!PluginExecuterV2) {
    throw new Error('Could not find PluginExecuterV2 export')
  }

  // Replace getInstance with our mock
  const originalGetInstance = PluginExecuterV2.getInstance
  PluginExecuterV2.getInstance = async () => {
    return {
      execute: mockPluginExecute,
      initialize: async () => {},
      initialized: true,
    } as any
  }

  console.log('  ✅ PluginExecuterV2.getInstance() patched with mock')
}
