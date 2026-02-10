/**
 * Compile with User Decisions (Phases 3+4+5)
 *
 * POST /api/v6/compile-with-decisions
 *
 * This endpoint completes the V6 pipeline after user review:
 * 1. Phase 3: IR Formalization (with user decisions as constraints)
 * 2. Phase 4: Compilation (IR → PILOT DSL)
 * 3. Phase 5: Normalization & Validation
 *
 * Input:
 * - grounded_plan: From /api/v6/generate-semantic-grounded
 * - user_decisions: From Review & Customize UI
 * - enhanced_prompt: Original Enhanced Prompt from Thread-Based Phase 3
 *
 * Output:
 * - ir: The formalized Declarative Logical IR
 * - workflow: Compiled workflow steps
 * - validation: Workflow validation results
 * - metadata: Timing and compilation info
 *
 * This is the second of two split APIs for the Intent Validation flow.
 */

import { NextRequest, NextResponse } from 'next/server'
import { IRFormalizer } from '@/lib/agentkit/v6/semantic-plan/IRFormalizer'
import { DeclarativeCompiler } from '@/lib/agentkit/v6/compiler/DeclarativeCompiler'
import { IRToDSLCompiler } from '@/lib/agentkit/v6/compiler/IRToDSLCompiler'
import { validateDeclarativeIR } from '@/lib/agentkit/v6/logical-ir/validation/DeclarativeIRValidator'
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import { validateWorkflowStructure } from '@/lib/pilot/schema'
import { wrapInPilotDSL } from '@/lib/agentkit/v6/compiler/utils/DSLWrapper'
import { createLogger } from '@/lib/logger'

// Create module-scoped logger
const logger = createLogger({ module: 'V6', route: '/api/v6/compile-with-decisions' })

// ============================================================================
// Types
// ============================================================================

interface ReviewUIDecisions {
  // Mandatory responses
  confirmed_patterns?: Record<string, string>     // { item_id: selected_option_id }
  resolved_ambiguities?: Record<string, string>   // { ambiguity_id: selected_option_id }
  fake_validation_acks?: string[]                 // IDs of acknowledged fake validations

  // Optional responses
  approved_assumptions?: string[]                 // IDs of approved assumptions
  disabled_assumptions?: string[]                 // IDs user unchecked
  edge_case_handling?: Record<string, string>     // { edge_case_id: handling_option }

  // Schedule & Settings
  schedule_config?: {
    mode: 'on_demand' | 'scheduled'
    cron?: string
    timezone?: string
  }

  input_parameters?: Record<string, any>
  notification_settings?: {
    on_success: boolean
    on_failure: boolean
  }
}

interface CompileWithDecisionsRequest {
  grounded_plan: any         // GroundedSemanticPlan from API Call 1
  user_decisions: ReviewUIDecisions
  enhanced_prompt: any       // Original Enhanced Prompt from Thread-Based Phase 3
  userId: string
  config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
  }
  // Feedback for workflow regeneration
  feedback?: {
    previous_workflow: any[]           // What LLM generated before
    user_feedback: string              // What user said is wrong
    feedback_history?: string[]        // All previous feedback attempts
    regeneration_attempt?: number      // Which attempt this is (1, 2, 3...)
  }
}

interface CompileWithDecisionsResponse {
  success: boolean

  // Phase 3 output
  ir?: any

  // Phase 4+5 output
  workflow?: any[]
  dsl?: any

  // Validation
  validation?: {
    valid: boolean
    errors?: any[]
  }

  // Metadata
  metadata?: {
    phase_times_ms: {
      formalization: number
      compilation: number
      normalization: number
    }
    total_time_ms: number
    steps_generated: number
    plugins_used: string[]
    compiler_used: string
  }

  // Error info
  error?: string
  details?: string
  phase?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Transform Review UI decisions into resolvedUserInputs for IRFormalizer
 *
 * The IRFormalizer accepts resolvedUserInputs as Array<{ key: string; value: any }>
 * We need to transform the Review UI decisions into this format.
 */
function transformDecisionsToResolvedInputs(
  decisions: ReviewUIDecisions,
  groundedPlan: any
): Array<{ key: string; value: any }> {
  const resolvedInputs: Array<{ key: string; value: any }> = []

  // 1. Resolved ambiguities → direct field overrides
  if (decisions.resolved_ambiguities) {
    for (const [ambiguityId, selectedValue] of Object.entries(decisions.resolved_ambiguities)) {
      // Try to find the original ambiguity to get the field name
      const ambiguity = groundedPlan.ambiguities?.find((a: any) => a.id === ambiguityId)
      const fieldName = ambiguity?.field || ambiguityId.replace('ambiguity_', '')

      resolvedInputs.push({
        key: fieldName,
        value: selectedValue
      })
    }
  }

  // 2. Confirmed patterns → behavior flags
  if (decisions.confirmed_patterns) {
    for (const [patternId, selectedOption] of Object.entries(decisions.confirmed_patterns)) {
      // Convert pattern ID to a key (e.g., "pattern_email_delivery" → "email_delivery")
      const key = patternId.replace('pattern_', '').replace('layer2_', '').replace('layer5_', '')

      resolvedInputs.push({
        key,
        value: selectedOption
      })
    }
  }

  // 3. Edge case handling → constraint flags
  if (decisions.edge_case_handling) {
    for (const [edgeCaseId, handlingOption] of Object.entries(decisions.edge_case_handling)) {
      const key = `edge_case_${edgeCaseId}`

      resolvedInputs.push({
        key,
        value: handlingOption
      })
    }
  }

  // 4. Input parameter overrides
  if (decisions.input_parameters) {
    for (const [paramName, paramValue] of Object.entries(decisions.input_parameters)) {
      resolvedInputs.push({
        key: paramName,
        value: paramValue
      })
    }
  }

  return resolvedInputs
}

/**
 * Apply disabled assumptions to the grounded plan
 *
 * When a user unchecks an assumption, we mark it as skipped in the grounding results.
 * This prevents the IR Formalizer from using that assumption.
 */
function applyDisabledAssumptions(
  groundedPlan: any,
  disabledAssumptions: string[]
): any {
  if (!disabledAssumptions || disabledAssumptions.length === 0) {
    return groundedPlan
  }

  const modifiedPlan = { ...groundedPlan }

  if (modifiedPlan.grounding_results && Array.isArray(modifiedPlan.grounding_results)) {
    modifiedPlan.grounding_results = modifiedPlan.grounding_results.map((result: any) => {
      if (disabledAssumptions.includes(result.assumption_id)) {
        return {
          ...result,
          skipped: true,
          validation_method: 'user_disabled'
        }
      }
      return result
    })
  }

  return modifiedPlan
}

/**
 * Transform workflow steps (reused from compile-declarative)
 */
function transformScatterGatherSteps(workflow: any[]): any[] {
  return workflow.map(step => {
    const baseStep = {
      ...step,
      id: step.step_id || step.id,
      step_id: undefined
    }
    delete baseStep.step_id

    if (step.type === 'scatter_gather' && step.config?.data && step.config?.actions) {
      const { data, item_variable, actions } = step.config

      const transformedActions = actions.map((action: any) => ({
        ...action,
        id: action.step_id || action.id,
        step_id: undefined
      }))

      const transformedStep = {
        ...baseStep,
        scatter: {
          input: data,
          itemVariable: item_variable,
          steps: transformedActions.map((a: any) => {
            const cleaned = { ...a }
            delete cleaned.step_id
            return cleaned
          })
        },
        gather: {
          operation: 'collect'
        },
        config: undefined
      }

      delete transformedStep.config
      return transformedStep
    }

    if (step.type === 'scatter_gather' && step.scatter?.input && step.scatter?.steps) {
      const transformedNestedSteps = step.scatter.steps.map((nestedStep: any) => ({
        ...nestedStep,
        id: nestedStep.step_id || nestedStep.id,
        step_id: undefined
      }))

      transformedNestedSteps.forEach((s: any) => delete s.step_id)

      return {
        ...baseStep,
        scatter: {
          ...step.scatter,
          steps: transformedNestedSteps
        },
        gather: step.gather || { operation: 'collect' }
      }
    }

    return baseStep
  })
}

/**
 * Remove output_variable from most steps except scatter_gather
 */
function removeOutputVariables(workflow: any[]): any[] {
  return workflow.map(step => {
    if (step.type === 'scatter_gather') {
      return step
    }
    if (step.output_variable) {
      const cleaned = { ...step }
      delete cleaned.output_variable
      return cleaned
    }
    return step
  })
}

/**
 * Simplify complex filter conditions
 */
function simplifyComplexConditions(workflow: any[]): any[] {
  return workflow.map(step => {
    if (step.type === 'transform' && step.operation === 'filter' && step.config?.condition) {
      const condition = step.config.condition

      if (typeof condition !== 'string') {
        return step
      }

      const includesPattern = /\(([^)]+)\)\.toLowerCase\(\)\.includes\('([^']+)'\)/g
      const matches = [...condition.matchAll(includesPattern)]

      if (matches.length > 10) {
        const uniqueFields = new Set<string>()
        const allKeywords = new Set<string>()

        for (const match of matches) {
          let field = match[1].trim()
          const baseFieldMatch = field.match(/(item\.\w+)/)
          if (baseFieldMatch) {
            field = baseFieldMatch[1]
          }
          uniqueFields.add(field)
          allKeywords.add(match[2])
        }

        const keywordArray = `['${Array.from(allKeywords).join("', '")}']`
        const fieldChecks = Array.from(uniqueFields)
          .map(field => `(${field} ?? '').toLowerCase().includes(kw)`)
          .join(' || ')

        const simplifiedCondition = `${keywordArray}.some(kw => ${fieldChecks})`

        return {
          ...step,
          config: {
            ...step.config,
            condition: simplifiedCondition
          }
        }
      }
    }

    return step
  })
}

// ============================================================================
// Main API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })
  const startTime = Date.now()

  requestLogger.info('Request received')

  try {
    const body: CompileWithDecisionsRequest = await request.json()

    // Validate request
    if (!body.grounded_plan) {
      requestLogger.warn('Missing required field: grounded_plan')
      return NextResponse.json(
        { success: false, error: 'Missing required field: grounded_plan' },
        { status: 400 }
      )
    }

    if (!body.user_decisions) {
      requestLogger.warn('Missing required field: user_decisions')
      return NextResponse.json(
        { success: false, error: 'Missing required field: user_decisions' },
        { status: 400 }
      )
    }

    if (!body.userId) {
      requestLogger.warn('Missing required field: userId')
      return NextResponse.json(
        { success: false, error: 'Missing required field: userId' },
        { status: 400 }
      )
    }

    requestLogger.debug({
      decisionsCount: Object.keys(body.user_decisions).length,
      hasDisabledAssumptions: (body.user_decisions.disabled_assumptions?.length || 0) > 0
    }, 'Processing user decisions')

    // Initialize PluginManager
    const pluginManager = await PluginManagerV2.getInstance()

    // Extract services_involved from Enhanced Prompt
    const servicesInvolved = body.enhanced_prompt?.specifics?.services_involved || []

    // ========================================================================
    // PHASE 3: IR Formalization (with user decisions)
    // ========================================================================

    requestLogger.info({ phase: 3 }, 'Phase 3: IR Formalization started')
    const phase3Start = Date.now()

    // Transform user decisions to resolvedUserInputs format
    const resolvedUserInputs = transformDecisionsToResolvedInputs(
      body.user_decisions,
      body.grounded_plan
    )

    requestLogger.debug({
      resolvedInputsCount: resolvedUserInputs.length
    }, 'Transformed user decisions to resolved inputs')

    // Apply disabled assumptions to grounded plan
    const modifiedGroundedPlan = applyDisabledAssumptions(
      body.grounded_plan,
      body.user_decisions.disabled_assumptions || []
    )

    // Create IRFormalizer with user constraints
    const irFormalizer = new IRFormalizer({
      model: body.config?.model || 'gpt-4o',
      pluginManager,
      servicesInvolved,
      resolvedUserInputs: resolvedUserInputs.length > 0 ? resolvedUserInputs : undefined
    })

    // Formalize grounded plan to IR
    const formalizationResult = await irFormalizer.formalize(modifiedGroundedPlan)

    const phase3Time = Date.now() - phase3Start
    requestLogger.info({
      phase: 3,
      duration: phase3Time,
      formalizationConfidence: formalizationResult.formalization_metadata.formalization_confidence
    }, 'Phase 3 complete')

    const ir = formalizationResult.ir

    // Validate IR structure
    const irValidation = validateDeclarativeIR(ir)
    if (!irValidation.valid) {
      requestLogger.error({
        phase: 3,
        errors: irValidation.errors
      }, 'IR validation failed')
      return NextResponse.json(
        {
          success: false,
          error: 'IR validation failed',
          details: irValidation.errors.map((e: any) => e.message).join('; '),
          phase: 'formalization'
        } as CompileWithDecisionsResponse,
        { status: 500 }
      )
    }

    // ========================================================================
    // PHASE 4+5: Compilation (Reuse compile-declarative logic)
    // ========================================================================

    requestLogger.info({ phase: 4 }, 'Phase 4+5: Compilation started')
    const phase4Start = Date.now()

    // Log if regenerating with feedback
    const hasFeedback = !!body.feedback
    if (hasFeedback) {
      requestLogger.info({
        regenerationAttempt: body.feedback!.regeneration_attempt,
        feedbackLength: body.feedback!.user_feedback.length,
        previousStepsCount: body.feedback!.previous_workflow?.length,
        feedbackHistoryCount: body.feedback!.feedback_history?.length || 0
      }, 'Regenerating workflow with user feedback')
    }

    let compilationResult: any
    let usedFallback = false

    // When feedback is present, skip deterministic compiler and use LLM directly
    // since only LLM can incorporate user feedback
    if (hasFeedback) {
      requestLogger.debug('Using LLM compiler directly for feedback-based regeneration')
      usedFallback = true

      const llmCompiler = new IRToDSLCompiler({
        temperature: 0.1, // Slightly higher temperature for regeneration variety
        maxTokens: 8000,
        pluginManager
      })

      compilationResult = await llmCompiler.compile(
        ir,
        {
          semantic_plan: {
            goal: body.grounded_plan.goal,
            understanding: body.grounded_plan.understanding,
            reasoning_trace: body.grounded_plan.reasoning_trace
          },
          grounded_facts: formalizationResult.formalization_metadata.grounded_facts_used,
          formalization_metadata: formalizationResult.formalization_metadata
        },
        0, // retryCount
        undefined, // previousValidationErrors
        // Pass user feedback to compiler
        {
          previous_workflow: body.feedback!.previous_workflow,
          user_feedback: body.feedback!.user_feedback,
          feedback_history: body.feedback!.feedback_history,
          regeneration_attempt: body.feedback!.regeneration_attempt
        }
      )
    } else {
      // Try DeclarativeCompiler first, fall back to LLM on failure
      try {
        requestLogger.debug('Attempting deterministic compilation with DeclarativeCompiler')
        const declarativeCompiler = new DeclarativeCompiler(pluginManager)
        compilationResult = await declarativeCompiler.compile(ir)

        if (!compilationResult.success) {
          throw new Error(`Deterministic compilation failed: ${compilationResult.errors?.join(', ')}`)
        }

        requestLogger.debug({
          stepsGenerated: compilationResult.workflow.length
        }, 'Deterministic compilation successful')
      } catch (error) {
        requestLogger.warn({ err: error }, 'DeclarativeCompiler failed, falling back to LLM compiler')
        usedFallback = true

        // Fallback to LLM compilation
        const llmCompiler = new IRToDSLCompiler({
          temperature: 0,
          maxTokens: 8000,
          pluginManager
        })

        compilationResult = await llmCompiler.compile(ir, {
          semantic_plan: {
            goal: body.grounded_plan.goal,
            understanding: body.grounded_plan.understanding,
            reasoning_trace: body.grounded_plan.reasoning_trace
          },
          grounded_facts: formalizationResult.formalization_metadata.grounded_facts_used,
          formalization_metadata: formalizationResult.formalization_metadata
        })
      }
    }

    if (!compilationResult.success) {
      const phase4Time = Date.now() - phase4Start
      requestLogger.error({
        phase: 4,
        duration: phase4Time,
        errors: compilationResult.errors
      }, 'Compilation failed')
      return NextResponse.json(
        {
          success: false,
          error: 'Workflow compilation failed',
          details: compilationResult.errors?.join('; '),
          phase: 'compilation'
        } as CompileWithDecisionsResponse,
        { status: 500 }
      )
    }

    // Post-processing pipeline (same as compile-declarative)
    let processedWorkflow = compilationResult.workflow

    // Simplify complex filter conditions
    processedWorkflow = simplifyComplexConditions(processedWorkflow)

    // Remove output_variable fields
    processedWorkflow = removeOutputVariables(processedWorkflow)

    // Transform scatter_gather steps to execution format
    processedWorkflow = transformScatterGatherSteps(processedWorkflow)

    const phase4Time = Date.now() - phase4Start

    // Generate DSL structure if DeclarativeCompiler was used
    let dsl = undefined
    if (!usedFallback && compilationResult.ir) {
      dsl = wrapInPilotDSL(
        processedWorkflow,
        compilationResult.ir,
        {
          plugins_used: compilationResult.plugins_used || [],
          compilation_time_ms: compilationResult.compilation_time_ms || phase4Time
        }
      )
    }

    // Validate DSL structure
    let dslValidation = { valid: true, errors: [] as any[], warnings: [] as string[] }
    if (dsl) {
      dslValidation = validateWorkflowStructure(dsl.workflow_steps)
      if (!dslValidation.valid) {
        requestLogger.warn({ errors: dslValidation.errors }, 'DSL validation warnings')
      }
    }

    requestLogger.info({
      phase: 4,
      duration: phase4Time,
      stepsGenerated: processedWorkflow.length,
      compilerUsed: usedFallback ? 'llm' : 'declarative'
    }, 'Phase 4+5 complete')

    // ========================================================================
    // Build Response
    // ========================================================================

    const totalTime = Date.now() - startTime

    // Warn if slow
    if (totalTime > 5000) {
      requestLogger.warn({
        duration: totalTime,
        phase3Time,
        phase4Time
      }, 'Slow request detected')
    }

    requestLogger.info({
      duration: totalTime,
      phase3Time,
      phase4Time,
      stepsGenerated: processedWorkflow.length
    }, 'Request completed')

    const response: CompileWithDecisionsResponse = {
      success: true,

      // Phase 3 output
      ir,

      // Phase 4+5 output
      workflow: processedWorkflow,
      dsl,

      // Validation
      validation: {
        valid: dslValidation.valid,
        errors: dslValidation.errors.length > 0 ? dslValidation.errors : undefined
      },

      // Metadata
      metadata: {
        phase_times_ms: {
          formalization: phase3Time,
          compilation: phase4Time,
          normalization: 0 // Included in compilation
        },
        total_time_ms: totalTime,
        steps_generated: processedWorkflow.length,
        plugins_used: compilationResult.plugins_used || [],
        compiler_used: usedFallback ? 'llm' : 'declarative'
      }
    }

    return NextResponse.json(response)

  } catch (error) {
    const duration = Date.now() - startTime
    requestLogger.error({ err: error, duration }, 'Request failed')

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to compile with decisions',
        details: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? errorStack : undefined
      } as CompileWithDecisionsResponse,
      { status: 500 }
    )
  }
}

// CORS headers
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-correlation-id'
    }
  })
}
