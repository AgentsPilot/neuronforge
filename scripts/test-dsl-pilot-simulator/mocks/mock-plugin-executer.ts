/**
 * B1: Mock PluginExecuterV2
 *
 * Patches PluginExecuterV2.getInstance() to return a mock that
 * generates stub data from output schemas instead of calling real APIs.
 */

import { generateFromSchema } from '../../test-dsl-execution-simulator/stub-data-generator'

type StubDataFn = (plugin: string, action: string, params: any, outputSchema?: any) => any

let mockExecuteFn: StubDataFn | null = null

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
