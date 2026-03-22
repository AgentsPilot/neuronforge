/**
 * B3: Mock services — AuditTrailService + runAgentKit
 *
 * Pre-initializes singletons with disabled/no-op configs
 * to prevent DB calls during simulation.
 */

import { generateFromSchema } from '../../test-dsl-execution-simulator/stub-data-generator'

/**
 * Disable AuditTrailService by pre-initializing with enabled: false.
 * Must be called before StepExecutor imports AuditTrailService.
 */
export async function disableAuditTrail(): Promise<void> {
  try {
    const { AuditTrailService } = await import('../../../lib/services/AuditTrailService')
    AuditTrailService.getInstance({ enabled: false } as any)
    console.log('  ✅ AuditTrailService disabled (enabled: false)')
  } catch (err) {
    console.log('  ⚠️  AuditTrailService not found — skipping')
  }
}

/**
 * Patch runAgentKit to return stub data instead of calling LLM providers.
 * For ai_processing steps, generates output from the step's output_schema.
 */
export async function patchRunAgentKit(): Promise<void> {
  try {
    const mod = await import('../../../lib/agentkit/runAgentKit')

    // Store original
    const original = (mod as any).runAgentKit

    // Replace with mock
    ;(mod as any).runAgentKit = async (params: any) => {
      const outputSchema = params?.outputSchema || params?.output_schema
      let stubData: any = { result: 'mock_ai_output' }

      if (outputSchema) {
        stubData = generateFromSchema(outputSchema)
      }

      console.log(`     🤖 [MOCK] runAgentKit → stub AI output`)
      return {
        response: JSON.stringify(stubData),
        parsedResponse: stubData,
        tokensUsed: { input: 100, output: 50, total: 150 },
      }
    }

    console.log('  ✅ runAgentKit patched with mock')
  } catch (err) {
    console.log('  ⚠️  runAgentKit not found — AI steps may fail')
  }
}
