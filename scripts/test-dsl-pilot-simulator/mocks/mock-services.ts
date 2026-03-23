/**
 * B3/D2: Mock services — AuditTrailService + LLM execution
 *
 * Pre-initializes singletons with disabled/no-op configs
 * to prevent DB and LLM calls during simulation.
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
 * D-B2 fix: Patch StepExecutor.prototype.executeLLMDecision to return stub data.
 *
 * The old approach (patching runAgentKit module export) doesn't work because
 * ES module exports are immutable — StepExecutor holds a direct reference
 * from its top-level import.
 *
 * This approach patches the prototype method AFTER importing StepExecutor
 * but BEFORE execution starts. Works because prototype methods are mutable.
 *
 * Must be called AFTER StepExecutor is imported.
 */
export async function patchStepExecutorLLM(): Promise<void> {
  try {
    const { StepExecutor } = await import('../../../lib/pilot/StepExecutor')

    ;(StepExecutor.prototype as any).executeLLMDecision = async function(
      step: any,
      params: any,
      context: any
    ) {
      const outputSchema = step.config?.output_schema || step.output_schema
      let stubData: any = { result: 'mock_ai_output' }

      if (outputSchema) {
        stubData = generateFromSchema(outputSchema)
      }

      console.log(`     🤖 [MOCK] AI step ${step.id || step.step_id}: executeLLMDecision → stub output`)
      return {
        data: stubData,
        tokensUsed: 150,
      }
    }

    console.log('  ✅ StepExecutor.executeLLMDecision patched with mock')
  } catch (err) {
    console.log(`  ⚠️  Failed to patch StepExecutor LLM: ${err}`)
  }
}
