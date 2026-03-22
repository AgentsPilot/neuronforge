/**
 * B5: Pilot Runner — Mini step walker using real Pilot components
 *
 * Replaces WorkflowPilot's orchestration with a minimal loop that:
 * 1. Iterates DSL steps in order
 * 2. Calls real StepExecutor.execute() for each step
 * 3. Registers output_variable in ExecutionContext
 * 4. Handles scatter-gather via real ParallelExecutor
 * 5. Handles conditionals via real StepExecutor (which uses ConditionalEvaluator)
 */

export interface PilotRunResult {
  stepsExecuted: number
  stepsFailed: number
  stepLog: PilotStepLogEntry[]
  errors: string[]
  totalTokens: number
}

export interface PilotStepLogEntry {
  step_id: string
  type: string
  plugin?: string
  action?: string
  description: string
  output_variable?: string
  status: 'ok' | 'error'
  error?: string
  execution_time_ms: number
  tokens_used: number
}

/**
 * Run DSL steps through real Pilot StepExecutor.
 */
export async function runDSLWithPilot(
  steps: any[],
  context: any,
  stepExecutor: any,
  parallelExecutor?: any
): Promise<PilotRunResult> {
  const stepLog: PilotStepLogEntry[] = []
  let stepsExecuted = 0
  let stepsFailed = 0
  let totalTokens = 0
  const errors: string[] = []

  for (const step of steps) {
    const startTime = Date.now()
    const entry: PilotStepLogEntry = {
      step_id: step.id || step.step_id,
      type: step.type,
      plugin: step.plugin,
      action: step.action || step.operation,
      description: step.description || '',
      output_variable: step.output_variable,
      status: 'ok',
      execution_time_ms: 0,
      tokens_used: 0,
    }

    try {
      let output: any

      if (step.type === 'scatter_gather' && parallelExecutor) {
        // Use real ParallelExecutor for scatter-gather
        console.log(`  🔄 ${entry.step_id} [scatter_gather]: ${step.description}`)
        const result = await parallelExecutor.executeScatterGather(step, context)
        output = {
          stepId: step.id,
          plugin: 'system',
          action: 'scatter_gather',
          data: result,
          metadata: { success: true, executedAt: new Date().toISOString(), executionTime: Date.now() - startTime },
        }
      } else {
        // Use real StepExecutor for all other step types
        output = await stepExecutor.execute(step, context)
      }

      // Register step output in context
      if (output) {
        context.setStepOutput(step.id || step.step_id, output)

        // Register output_variable as named variable (mirrors WorkflowPilot behavior)
        if (step.output_variable && output.data !== undefined) {
          context.setVariable(step.output_variable, output.data)
        }

        entry.tokens_used = output.metadata?.tokensUsed || 0
        totalTokens += entry.tokens_used
      }

      stepsExecuted++
      const icon = step.type === 'action' ? '🔌' : step.type === 'transform' ? '🔄' : step.type === 'conditional' ? '🔀' : step.type === 'ai_processing' ? '🤖' : '⚙️'
      console.log(`  ✅ ${entry.step_id} (${step.type})${step.plugin ? ` [${step.plugin}/${entry.action}]` : ''}: ${step.description}${step.output_variable ? ` → ${step.output_variable}` : ''}`)

    } catch (err: any) {
      entry.status = 'error'
      entry.error = err.message || String(err)
      errors.push(`${entry.step_id}: ${entry.error}`)
      stepsFailed++
      console.log(`  ❌ ${entry.step_id} (${step.type}): ${entry.error}`)
    }

    entry.execution_time_ms = Date.now() - startTime
    stepLog.push(entry)
  }

  return {
    stepsExecuted,
    stepsFailed,
    stepLog,
    errors,
    totalTokens,
  }
}
