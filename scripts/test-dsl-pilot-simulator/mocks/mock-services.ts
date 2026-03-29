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
      const aiType = step.config?.ai_type || step.config?.type
      let stubData: any = { result: 'mock_ai_output' }

      // O28: Classify steps receive an array input and must return an array
      // with the classification field appended to each item. Without this,
      // the stub generator returns an empty object and downstream filter/
      // scatter_gather steps fail with "requires array input".
      if (aiType === 'classify') {
        const inputRef = step.config?.input || step.input
        // Resolve input: try params.input (already resolved), then context.variables
        let resolvedInput = params?.input
        if (!Array.isArray(resolvedInput) && inputRef && context?.variables) {
          // Handle dotted refs like "inbox_emails.emails"
          const parts = inputRef.replace(/^\{\{|\}\}$/g, '').split('.')
          let val = context.variables[parts[0]]
          for (let i = 1; i < parts.length && val != null; i++) {
            val = val[parts[i]]
          }
          resolvedInput = val
        }

        if (Array.isArray(resolvedInput)) {
          const labels = step.config?.labels || ['positive', 'negative']
          const classField = outputSchema?.fields?.[0]?.name || 'classification'
          stubData = resolvedInput.map((item: any, idx: number) => ({
            ...item,
            [classField]: labels[idx % labels.length],
          }))
          console.log(`     🤖 [MOCK] AI classify step ${step.id || step.step_id}: ${resolvedInput.length} items classified → field "${classField}" (labels: ${labels.join(', ')})`)
          return { data: stubData, tokensUsed: 150 }
        }
      }

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
