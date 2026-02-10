/**
 * IR to DSL Compiler
 *
 * Single LLM-based compiler that converts Declarative IR → PILOT DSL
 * Replaces DeclarativeCompiler (deterministic) + DSLRepairer (LLM repair)
 *
 * Architecture:
 * - Extracts only used plugins from IR (reduces tokens 70%)
 * - Single LLM call with full context (IR + Enhanced Prompt + Plugin Schemas)
 * - No error accumulation across multiple phases
 * - Plugin-agnostic and maintainable
 */

import OpenAI from 'openai'
import type { PluginManagerV2 } from '../../../server/plugin-manager-v2'
import type { DeclarativeLogicalIR } from '../logical-ir/schemas/declarative-ir-types'
import { validateWorkflowStructure } from '../../../pilot/schema/runtime-validator'
import { WorkflowPostValidator } from './WorkflowPostValidator'
import { PilotNormalizer } from './PilotNormalizer'
import { createLogger, Logger } from '@/lib/logger'

// Create module-scoped logger
const moduleLogger = createLogger({ module: 'V6', service: 'IRToDSLCompiler' })

// ============================================================================
// Types
// ============================================================================

export interface PipelineContext {
  semantic_plan?: {
    goal: string
    understanding?: any
    reasoning_trace?: any[]
  }
  grounded_facts?: Record<string, any>
  formalization_metadata?: {
    grounded_facts_used: Record<string, any>
    missing_facts: string[]
    formalization_confidence: number
  }
}

export interface IRToDSLConfig {
  temperature?: number
  maxTokens?: number
  pluginManager: PluginManagerV2
}

export interface CompilationResult {
  success: boolean
  workflow: any[]
  plugins_used: string[]
  compilation_time_ms: number
  token_usage?: {
    input: number
    output: number
    total: number
  }
  errors?: string[]
}

// User feedback for workflow regeneration
export interface UserFeedback {
  previous_workflow: any[]
  user_feedback: string
  feedback_history?: string[]
  regeneration_attempt?: number
}

// ============================================================================
// IR to DSL Compiler
// ============================================================================

export class IRToDSLCompiler {
  private openai: OpenAI
  private model: string = 'gpt-5.2'
  private temperature: number
  private maxTokens: number
  private pluginManager: PluginManagerV2
  private logger: Logger

  constructor(config: IRToDSLConfig) {
    this.logger = moduleLogger.child({ method: 'constructor' })
    this.temperature = config.temperature ?? 0
    this.maxTokens = config.maxTokens ?? 8000
    this.pluginManager = config.pluginManager

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })

    this.logger.info({ model: this.model, temperature: this.temperature }, 'Initialized')
  }

  /**
   * Compile Declarative IR to PILOT DSL workflow
   *
   * @param ir - Declarative IR from Phase 3 (Formalization)
   * @param pipelineContext - Rich context from Phases 1-3 (semantic plan, grounded facts, metadata)
   * @param retryCount - Internal retry counter for validation failures
   * @param previousValidationErrors - Errors from previous validation attempts
   * @param userFeedback - Optional user feedback for workflow regeneration
   */
  async compile(
    ir: DeclarativeLogicalIR,
    pipelineContext?: PipelineContext,
    retryCount: number = 0,
    previousValidationErrors?: string[],
    userFeedback?: UserFeedback
  ): Promise<CompilationResult> {
    const compileLogger = moduleLogger.child({ method: 'compile', retryCount })
    const startTime = Date.now()

    try {
      // Extract used plugins from IR
      const usedPlugins = this.extractUsedPlugins(ir)
      compileLogger.info({ usedPlugins }, 'Extracted used plugins from IR')

      if (pipelineContext) {
        compileLogger.info({
          hasSemanticGoal: !!pipelineContext.semantic_plan?.goal,
          groundedFactsCount: pipelineContext.grounded_facts ? Object.keys(pipelineContext.grounded_facts).length : 0,
          formalizationConfidence: pipelineContext.formalization_metadata?.formalization_confidence || null
        }, 'Pipeline context available')
      } else {
        compileLogger.warn('No pipeline context provided - compilation may be less accurate')
      }

      // Log if regenerating with user feedback
      if (userFeedback) {
        compileLogger.info({
          attempt: userFeedback.regeneration_attempt || 1,
          previousStepsCount: userFeedback.previous_workflow?.length || 0,
          feedbackLength: userFeedback.user_feedback?.length || 0,
          feedbackHistoryCount: userFeedback.feedback_history?.length || 0
        }, 'Regenerating with user feedback')
      }

      // Build prompts
      const systemPrompt = this.buildSystemPrompt()
      const userPrompt = this.buildUserPrompt(ir, pipelineContext, usedPlugins, previousValidationErrors, userFeedback)

      // Call OpenAI gpt-5.2 with strict schema validation
      const result = await this.compileWithOpenAI(systemPrompt, userPrompt)
      let workflow = result.workflow
      const tokenUsage = result.tokenUsage

      // PHASE 4: Post-processing reduced to essentials only
      // Strict schema mode should prevent most LLM mistakes

      // KEEP: Fix variable references (legitimate transformation - Phase 1 fixed)
      workflow = this.fixVariableReferences(workflow)

      // REMOVED: renumberSteps() - PilotNormalizer.normalizePilot() already does this
      // Double renumbering causes duplicate step IDs and breaks cross-references

      // CRITICAL: Normalize PILOT DSL (forces sequential IDs, removes illegal fields, ensures structures)
      const normalizedResult = PilotNormalizer.normalizePilot({ workflow_steps: workflow }, usedPlugins)
      workflow = normalizedResult.workflow_steps

      // PHASE 4 REMOVED (Band-aids - strict schema should prevent these):
      // - fixParameterTypes() - Strict schema enforces correct types
      // - optimizeAIOperations() - Prompt improvements prevent unnecessary AI steps

      // POST-COMPILATION VALIDATION: Schema-driven validation and auto-fix
      const pluginSchemas = this.pluginManager.getAvailablePlugins()
      const postValidator = new WorkflowPostValidator(pluginSchemas)
      const postValidation = postValidator.validate({ workflow }, true) // autoFix=true

      if (postValidation.autoFixed && postValidation.fixedWorkflow) {
        compileLogger.info({
          autoFixedCodes: postValidation.issues.filter(i => i.autoFixable).map(i => i.code)
        }, 'Auto-fixed workflow issues')
        workflow = postValidation.fixedWorkflow.workflow

        // CRITICAL: Re-normalize after auto-fix to ensure sequential IDs
        // Auto-fix inserts new steps with temporary IDs like `step_autofix_123456789`
        // Normalization renumbers ALL steps to sequential IDs (step1, step2, step3...)
        // and updates all references ({{step_autofix_123.data.foo}} → {{step4.data.foo}})
        const reNormalizedResult = PilotNormalizer.normalizePilot({ workflow_steps: workflow }, usedPlugins)
        workflow = reNormalizedResult.workflow_steps
      }

      if (postValidation.issues.length > 0) {
        compileLogger.warn({
          issueCount: postValidation.issues.length,
          issues: postValidation.issues.map(issue => ({
            severity: issue.severity,
            stepId: issue.stepId,
            code: issue.code,
            message: issue.message,
            suggestion: issue.suggestion
          }))
        }, 'Post-validation issues found')
      }

      // PHASE 3 ADDITION: Validate workflow before returning
      const validation = validateWorkflowStructure(workflow)

      // Collect all validation errors (schema + post-validation)
      const allValidationErrors: string[] = []

      // Add schema validation errors
      if (!validation.valid) {
        allValidationErrors.push(...validation.errors)
      }

      // Add post-validation errors (only error-level, not warnings)
      const postValidationErrors = postValidation.issues
        .filter(issue => issue.severity === 'error')
        .map(issue => `[${issue.code}] Step ${issue.stepId}: ${issue.message}${issue.suggestion ? ` (Suggestion: ${issue.suggestion})` : ''}`)

      allValidationErrors.push(...postValidationErrors)

      // Retry if we have errors and haven't exceeded retry limit
      if (allValidationErrors.length > 0 && retryCount < 2) {
        compileLogger.warn({
          validationErrors: allValidationErrors,
          nextRetryAttempt: retryCount + 1
        }, 'Validation failed, retrying')
        return this.compile(ir, pipelineContext, retryCount + 1, allValidationErrors, userFeedback)
      }

      if (allValidationErrors.length > 0 && retryCount >= 2) {
        compileLogger.error({ validationErrors: allValidationErrors }, 'Validation failed after 2 retries')
        throw new Error(`Workflow validation failed: ${allValidationErrors.join(', ')}`)
      }

      const compilationTime = Date.now() - startTime

      compileLogger.info({
        stepsGenerated: workflow.length,
        duration: compilationTime,
        retriesUsed: retryCount
      }, 'Compilation successful')

      return {
        success: true,
        workflow,
        plugins_used: usedPlugins,
        compilation_time_ms: compilationTime,
        token_usage: tokenUsage
      }
    } catch (error) {
      compileLogger.error({ err: error }, 'Compilation failed')

      return {
        success: false,
        workflow: [],
        plugins_used: [],
        compilation_time_ms: Date.now() - startTime,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    }
  }

  /**
   * Fix variable references to unwrap nested plugin outputs
   *
   * Plugin actions often return structured objects like {emails: [...], total_found: 10}
   * When a step references {{step1.data}} for filtering/mapping, we need to detect
   * if the output has a primary array field and auto-unwrap it to {{step1.data.FIELD}}
   */
  private fixVariableReferences(workflow: any[]): any[] {
    const fixVarLogger = moduleLogger.child({ method: 'fixVariableReferences' })
    const availablePlugins = this.pluginManager.getAvailablePlugins()

    // Build map of step outputs (id → primary array field name)
    const stepOutputFields = new Map<string, string>()

    // Track which steps are transform steps (they always output to .data)
    const transformSteps = new Set<string>()

    workflow.forEach(step => {
      // Track transform steps
      if (step.type === 'transform' || step.type === 'scatter_gather') {
        transformSteps.add(step.id)
      }

      if (step.type === 'action' && step.plugin && step.action) {
        const pluginDef = availablePlugins[step.plugin]
        if (!pluginDef || !pluginDef.actions || !pluginDef.actions[step.action]) {
          return
        }

        const actionDef = pluginDef.actions[step.action]
        const outputSchema = actionDef.output_schema

        if (outputSchema && outputSchema.properties) {
          // Find the first array field in the output
          const arrayField = Object.entries(outputSchema.properties).find(
            ([_, schema]: [string, any]) => schema.type === 'array'
          )

          if (arrayField) {
            stepOutputFields.set(step.id, arrayField[0])
            fixVarLogger.debug({ stepId: step.id, arrayField: arrayField[0] }, 'Detected output array field')
          }
        }
      }
    })

    // Fix variable references in transform/loop steps
    return workflow.map(step => {
      if (step.type === 'transform' && step.input) {
        const fixed = this.unwrapVariableReference(step.input, stepOutputFields, transformSteps)
        if (fixed !== step.input) {
          fixVarLogger.debug({ stepId: step.id, original: step.input, fixed }, 'Fixed transform input')
          return { ...step, input: fixed }
        }
      }

      if (step.type === 'scatter_gather' && step.scatter?.input) {
        const fixed = this.unwrapVariableReference(step.scatter.input, stepOutputFields, transformSteps)
        if (fixed !== step.scatter.input) {
          fixVarLogger.debug({ stepId: step.id, original: step.scatter.input, fixed }, 'Fixed scatter data')
          return {
            ...step,
            scatter: { ...step.scatter, input: fixed }
          }
        }
      }

      return step
    })
  }

  /**
   * Unwrap a variable reference if it points to a plugin output with nested array
   * FIXED: Plugin outputs are stored directly, NOT under .data
   * {{step1}} → {{step1.emails}} (if step1 outputs {emails: [...]})
   * {{step1.data}} should not exist for plugin steps!
   *
   * Transform/scatter_gather steps always output to .data property
   * {{step3}} → {{step3.data}} (if step3 is a transform)
   */
  private unwrapVariableReference(
    ref: string,
    stepOutputFields: Map<string, string>,
    transformSteps: Set<string>
  ): string {
    // Match both {{step1}} and {{step1.data}} patterns
    const matchDirect = ref.match(/^\{\{(step\d+)\}\}$/)
    const matchData = ref.match(/^\{\{(step\d+)\.data\}\}$/)

    const match = matchDirect || matchData
    if (!match) {
      return ref // Not a simple step reference
    }

    const stepId = match[1]
    const arrayField = stepOutputFields.get(stepId)

    if (arrayField) {
      // CRITICAL FIX: Plugin outputs are stored in StepOutput.data property
      // ExecutionContext stores: { stepId, plugin, action, data: {...}, metadata }
      // So we must access: {{stepX.data.field}}, not {{stepX.field}}
      return `{{${stepId}.data.${arrayField}}}`
    }

    // If this is a transform/scatter_gather step, always add .data
    if (transformSteps.has(stepId)) {
      return `{{${stepId}.data}}`
    }

    // If no array field found, return the direct reference without .data
    return `{{${stepId}}}`
  }

  /**
   * Fix parameter types based on plugin schemas
   * Ensures primitive types aren't wrapped in objects and handles null values
   */
  private fixParameterTypes(workflow: any[]): any[] {
    const fixParamLogger = moduleLogger.child({ method: 'fixParameterTypes' })
    const availablePlugins = this.pluginManager.getAvailablePlugins()

    return workflow.map(step => {
      // Only process action steps with params
      if (step.type !== 'action' || !step.params || !step.plugin || !step.action) {
        return step
      }

      const pluginDef = availablePlugins[step.plugin]
      if (!pluginDef || !pluginDef.actions || !pluginDef.actions[step.action]) {
        fixParamLogger.warn({ plugin: step.plugin, action: step.action }, 'Plugin or action not found')
        return step
      }

      const actionDef = pluginDef.actions[step.action]
      const paramSchema = actionDef.parameters

      if (!paramSchema || !paramSchema.properties) {
        return step
      }

      // Fix each parameter based on schema
      const fixedParams: any = {}

      for (const [paramName, paramValue] of Object.entries(step.params)) {
        const paramDef: any = paramSchema.properties[paramName]

        if (!paramDef) {
          // Keep unknown params as-is
          fixedParams[paramName] = paramValue
          continue
        }

        const expectedType = paramDef.type

        // Handle null values - use schema default or omit
        if (paramValue === null) {
          if ('default' in paramDef) {
            fixedParams[paramName] = paramDef.default
            fixParamLogger.debug({
              plugin: step.plugin,
              action: step.action,
              param: paramName,
              defaultValue: paramDef.default
            }, 'Replaced null with default')
          } else {
            // Omit null params that have no default
            fixParamLogger.debug({
              plugin: step.plugin,
              action: step.action,
              param: paramName
            }, 'Omitted null value with no schema default')
          }
          continue
        }

        // Check if this should be a primitive type but is wrapped in an object
        if (expectedType === 'number' || expectedType === 'string' || expectedType === 'boolean') {
          // If the value is an object with a single property, unwrap it
          if (typeof paramValue === 'object' && paramValue !== null && !Array.isArray(paramValue)) {
            const keys = Object.keys(paramValue)
            if (keys.length === 1) {
              // Unwrap: { "value": 10 } → 10
              const unwrappedValue = (paramValue as Record<string, any>)[keys[0]]
              fixedParams[paramName] = unwrappedValue
              fixParamLogger.debug({
                plugin: step.plugin,
                action: step.action,
                param: paramName,
                expectedType
              }, 'Unwrapped object to primitive')
            } else {
              // Keep as-is if it's a complex object
              fixedParams[paramName] = paramValue
            }
          } else {
            // Already correct type
            fixedParams[paramName] = paramValue
          }
        } else {
          // Keep objects, arrays, etc. as-is
          fixedParams[paramName] = paramValue
        }
      }

      return {
        ...step,
        params: fixedParams
      }
    })
  }

  /**
   * Optimize away unnecessary AI operations
   *
   * Pattern: scatter_gather + AI classification for keyword matching
   * Detection: If scatter_gather uses AI plugin (chatgpt-*) and the prompt contains
   *            simple keyword matching logic (contains/includes/equals), replace with
   *            a single transform filter step.
   *
   * Example bloat pattern:
   *   step1: Get emails
   *   step2: scatter_gather over emails → step3 (chatgpt-research)
   *   step3: AI classifies each email as "complaint" or "not complaint"
   *   step4: parse JSON responses
   *   step5: filter for "complaint" classifications
   *
   * Simplified to:
   *   step1: Get emails
   *   step2: transform filter with condition: item.subject.toLowerCase().includes('complaint')
   */
  private optimizeAIOperations(workflow: any[]): any[] {
    const optimizeLogger = moduleLogger.child({ method: 'optimizeAIOperations' })
    optimizeLogger.debug('Starting AI operation optimization')

    // Detect pattern: scatter_gather → AI call → JSON parse → filter
    const optimizations: Array<{
      scatterStepIdx: number
      aiStepIdx: number
      parseStepIdx?: number
      filterStepIdx?: number
      keywords: string[]
      filterField?: string
    }> = []

    for (let i = 0; i < workflow.length; i++) {
      const step = workflow[i]

      // Look for scatter_gather steps with nested AI processing
      if (step.type === 'scatter_gather' && step.scatter?.steps && step.scatter.steps.length > 0) {
        // Check if any nested step is an AI operation
        const aiStepIdx = step.scatter.steps.findIndex((s: any) =>
          s.type === 'ai_call' ||
          s.type === 'ai_processing' ||
          (s.type === 'action' && (s.plugin?.startsWith('chatgpt-') || s.plugin?.startsWith('anthropic-')))
        )

        if (aiStepIdx === -1) continue

        const aiStep = step.scatter.steps[aiStepIdx]

        // Check if it's an AI step (ai_call type or AI plugin action)
        const isAIStep = true // Already filtered above

        if (isAIStep) {
          // Analyze the AI prompt for keyword matching patterns
          // For ai_call: check messages array, for plugin: check prompt/user_message params
          let prompt = ''
          if (aiStep.type === 'ai_call' && aiStep.params?.messages) {
            prompt = aiStep.params.messages.map((m: any) => m.content).join(' ')
          } else {
            prompt = aiStep.params?.prompt || aiStep.params?.user_message || ''
          }

          // Extract keywords from classification prompts
          const keywords = this.extractKeywordsFromClassificationPrompt(prompt)

          if (keywords.length > 0) {
            optimizeLogger.debug({ stepIndex: i, keywords }, 'Detected AI classification pattern')

            // Look for optional parse and filter steps after scatter
            let parseStepIdx: number | undefined
            let filterStepIdx: number | undefined
            let filterField: string | undefined

            // Check next few steps for JSON parse and filter
            for (let j = i + 1; j < Math.min(i + 5, workflow.length); j++) {
              const nextStep = workflow[j]

              if (nextStep.type === 'transform' && nextStep.operation === 'map') {
                // Likely JSON parsing step
                parseStepIdx = j
              }

              if (nextStep.type === 'transform' && nextStep.operation === 'filter') {
                filterStepIdx = j
                // Try to extract the field being filtered
                const condition = nextStep.condition || ''
                const fieldMatch = condition.match(/item\.(\w+)/)
                if (fieldMatch) {
                  filterField = fieldMatch[1]
                }
              }
            }

            optimizations.push({
              scatterStepIdx: i,
              aiStepIdx,
              parseStepIdx,
              filterStepIdx,
              keywords,
              filterField
            })
          }
        }
      }
    }

    if (optimizations.length === 0) {
      optimizeLogger.debug('No AI optimization opportunities found')
      return workflow
    }

    // Apply optimizations in reverse order to maintain indices
    for (const opt of optimizations.reverse()) {
      optimizeLogger.debug({ stepIndex: opt.scatterStepIdx }, 'Optimizing scatter_gather step')

      const scatterStep = workflow[opt.scatterStepIdx]
      const inputData = scatterStep.scatter?.input || '{{step1.data}}'

      // Determine which field to check (subject, body, from, etc.)
      const fieldToCheck = opt.filterField || 'subject'

      // Build keyword condition
      const conditions = opt.keywords.map(kw =>
        `item.${fieldToCheck}?.toLowerCase().includes('${kw.toLowerCase()}')`
      )
      const condition = conditions.join(' || ')

      // Create replacement transform filter step
      const optimizedStep = {
        id: scatterStep.id,
        type: 'transform',
        operation: 'filter',
        input: inputData,
        condition: condition,
        description: `Filter for items containing keywords: ${opt.keywords.join(', ')}`
      }

      // Replace scatter_gather with optimized filter
      workflow[opt.scatterStepIdx] = optimizedStep

      // Mark steps for removal
      const stepsToRemove = [opt.aiStepIdx]
      if (opt.parseStepIdx !== undefined) stepsToRemove.push(opt.parseStepIdx)
      if (opt.filterStepIdx !== undefined) stepsToRemove.push(opt.filterStepIdx)

      // Remove AI, parse, and filter steps (they're now replaced by single filter)
      workflow = workflow.filter((_, idx) => !stepsToRemove.includes(idx))

      optimizeLogger.info({
        stepsReplaced: stepsToRemove.length + 1,
        condition
      }, 'Optimized: Replaced scatter+AI+parse+filter with single filter')
    }

    // Renumber steps after removal
    workflow = this.renumberSteps(workflow)

    return workflow
  }

  /**
   * Extract keywords from AI classification prompts
   * Looks for patterns like "contains X", "includes Y", "is about Z"
   */
  private extractKeywordsFromClassificationPrompt(prompt: string): string[] {
    const keywords: string[] = []

    // Common classification patterns
    const patterns = [
      /contains?\s+["']([^"']+)["']/gi,
      /includes?\s+["']([^"']+)["']/gi,
      /about\s+["']([^"']+)["']/gi,
      /mentions?\s+["']([^"']+)["']/gi,
      /regarding\s+["']([^"']+)["']/gi,
      /related to\s+["']([^"']+)["']/gi,
      // Simple quoted words after classification instructions
      /classify.*["']([^"']+)["']/gi,
      /is (?:it|this) (?:a |an )?["']([^"']+)["']/gi
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(prompt)) !== null) {
        keywords.push(match[1])
      }
    }

    return [...new Set(keywords)] // Remove duplicates
  }

  /**
   * Renumber steps sequentially after removals
   * Handles nested steps in scatter_gather, loop, etc.
   */
  private renumberSteps(workflow: any[]): any[] {
    const stepIdMap = new Map<string, string>()
    let globalCounter = 1

    // Recursively collect all step IDs (including nested)
    const collectStepIds = (steps: any[]) => {
      steps.forEach(step => {
        if (step.id) {
          const newId = `step${globalCounter++}`
          stepIdMap.set(step.id, newId)
        }
        // Check for nested steps in scatter_gather
        if (step.scatter?.steps) {
          collectStepIds(step.scatter.steps)
        }
        // Check for nested steps in loops
        if (step.loopSteps) {
          collectStepIds(step.loopSteps)
        }
        // Check for nested steps in parallel groups
        if (step.steps) {
          collectStepIds(step.steps)
        }
      })
    }

    // Build mapping of all old IDs to new sequential IDs
    collectStepIds(workflow)

    // Recursively update step IDs
    const updateStepIds = (steps: any[]): any[] => {
      return steps.map(step => {
        const newStep = { ...step }

        // Update this step's ID
        if (newStep.id && stepIdMap.has(newStep.id)) {
          newStep.id = stepIdMap.get(newStep.id)
        }

        // Update variable references
        if (newStep.description) {
          newStep.description = this.updateStepReferences(newStep.description, stepIdMap)
        }
        if (newStep.input) {
          newStep.input = this.updateStepReferences(newStep.input, stepIdMap)
        }
        if (newStep.condition) {
          newStep.condition = this.updateStepReferences(newStep.condition, stepIdMap)
        }
        if (newStep.params) {
          newStep.params = this.updateObjectReferences(newStep.params, stepIdMap)
        }
        if (newStep.config) {
          newStep.config = this.updateObjectReferences(newStep.config, stepIdMap)
        }

        // Recursively update nested steps
        if (newStep.scatter?.steps) {
          newStep.scatter.steps = updateStepIds(newStep.scatter.steps)
        }
        if (newStep.loopSteps) {
          newStep.loopSteps = updateStepIds(newStep.loopSteps)
        }
        if (newStep.steps) {
          newStep.steps = updateStepIds(newStep.steps)
        }

        return newStep
      })
    }

    return updateStepIds(workflow)
  }

  /**
   * Update step references in a string
   */
  private updateStepReferences(text: string, stepIdMap: Map<string, string>): string {
    if (typeof text !== 'string') return text

    let updated = text
    for (const [oldId, newId] of stepIdMap.entries()) {
      // Match {{stepN...}} patterns
      updated = updated.replace(
        new RegExp(`\\{\\{${oldId}(\\.|\\})`, 'g'),
        `{{${newId}$1`
      )
    }
    return updated
  }

  /**
   * Recursively update step references in objects
   */
  private updateObjectReferences(obj: any, stepIdMap: Map<string, string>): any {
    if (typeof obj === 'string') {
      return this.updateStepReferences(obj, stepIdMap)
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.updateObjectReferences(item, stepIdMap))
    }

    if (obj && typeof obj === 'object') {
      const updated: any = {}
      for (const [key, value] of Object.entries(obj)) {
        updated[key] = this.updateObjectReferences(value, stepIdMap)
      }
      return updated
    }

    return obj
  }

  /**
   * Extract plugin keys used in this IR (for smart schema injection)
   */
  private extractUsedPlugins(ir: DeclarativeLogicalIR): string[] {
    const plugins = new Set<string>()

    // Extract from data sources
    ir.data_sources.forEach(ds => {
      if (ds.plugin_key) {
        plugins.add(ds.plugin_key)
      }
    })

    // Extract from delivery rules
    const { per_item_delivery, per_group_delivery, summary_delivery } = ir.delivery_rules

    if (per_item_delivery?.plugin_key) {
      plugins.add(per_item_delivery.plugin_key)
    }
    if (per_group_delivery?.plugin_key) {
      plugins.add(per_group_delivery.plugin_key)
    }
    if (summary_delivery?.plugin_key) {
      plugins.add(summary_delivery.plugin_key)
    }

    return Array.from(plugins)
  }

  /**
   * Build system prompt (DSL compilation instructions)
   */
  private buildSystemPrompt(): string {
    return `
You are a PILOT DSL Workflow Compiler. Convert Declarative IR to executable PILOT DSL.

# Output Format
Return JSON with workflow array:
{
  "workflow": [{
    "id": "step1",
    "name": "Description",
    "type": "action" | "transform" | "scatter_gather" | "ai_processing",
    "dependencies": [],  // REQUIRED: step IDs this depends on
    "plugin": "...",     // action only
    "action": "...",     // action only
    "params": {},        // action/ai_processing
    "operation": "...",  // transform only
    "input": "{{...}}",  // transform only
    "config": {}         // transform/scatter
  }]
}

# Step Types

**action**: Execute plugin operation
- Fields: id, name, type, dependencies, plugin, action, params
- Use EXACT param names from plugin schemas
- Support nested params: params.recipients.to, params.content.subject

**transform**: Data transformation
- Fields: id, name, type, dependencies, operation, input, config
- Operations: filter, map, sort, group, aggregate, flatten, deduplicate, reduce
- FORBIDDEN ops: render_table, extract_field, set_from_column, group_by
- Filter condition: valid JS expression (e.g., item.status === 'active')

**scatter_gather**: Parallel array processing
- Fields: id, name, type, dependencies, scatter, gather
- scatter: {input, itemVariable, steps[]}
- gather: {operation: "collect"}

**ai_processing**: LLM operations
- Fields: id, name, type, dependencies, params
- params: {messages[], temperature, max_tokens, response_format}

## AI Processing - Schema-Aware Prompt Generation (CRITICAL)

When generating AI processing prompts that analyze data from plugin actions:

**STEP 1: Read Plugin Output Schema**
- Check the plugin's output_schema field descriptions
- Identify which fields contain actual data vs empty fields
- Look for usage hints in field descriptions

**STEP 2: Identify Field Availability**
- ✅ USE fields marked: "USE THIS for...", "(contains...)", "Available"
- ❌ AVOID fields marked: "NOTE: Usually empty", "Always empty", "Not available"
- ⚠️  CHECK fields with warnings or caveats

**STEP 3: Generate Schema-Aware AI Prompts**
- Reference ONLY fields that contain data
- DO NOT ask AI to analyze empty fields
- Use field descriptions to understand what data is available

**Example - Gmail search_emails:**

Plugin output schema shows:
  snippet: "Email preview snippet (first ~200 chars - USE THIS for content matching)"
  body: "Email body text (NOTE: Usually empty - use 'snippet' instead)"

✅ CORRECT AI Prompt:
  "Analyze email subject and snippet for keywords. Email: Subject={{item.subject}}, Snippet={{item.snippet}}"

❌ WRONG AI Prompt:
  "Analyze email body for keywords. Email: Body={{item.body}}"  // body is empty!

**Other Examples:**
- Airtable: Use 'fields' object (available), not 'raw_data' (if unavailable)
- APIs: Use documented fields, not optional/deprecated fields
- Database: Use returned columns, not computed fields

# Critical Rules

## Dependencies
EVERY step MUST have dependencies array (empty [] if none).
First step: dependencies: []
Subsequent: dependencies: ["step1"] or ["step1", "step2"]

## Variable References
Step outputs wrapped in StepOutput.data:
- ✅ {{step1.data.emails}} - Access specific field
- ✅ {{step1.data}} - Full output
- ✅ {{step1}} - Auto-extract (scatter only)
- ❌ {{step1.emails}} - WRONG (emails is in .data)
- ✅ {{item.field}} - Loop/scatter item (NO .data prefix)

## Step ID Naming
MUST use sequential: step1, step2, step3...
NOT descriptive names like "fetch_data_1"

## IR Mapping Patterns

**Data Fetch**: IR.data_sources → action step
- Use 100 for max_results (NOT 10)

**Filters**: IR.filters → transform with operation: "filter"
- Check IR.filters.groups for OR/AND logic with multiple conditions
- Map IR field names to actual plugin fields (see Field Mapping below)
- CRITICAL - Condition syntax must be SIMPLE - evaluator does NOT support:
  - Method calls like .toLowerCase() or .includes()
  - String concatenation with +
  - Nullish coalescing ??
  - Parenthesized expressions with operators inside

- ✅ CORRECT filter patterns (evaluator supports these):
  1. For keyword matching (case-insensitive):
     Pre-compute match result in map, then filter on boolean:
     Step N-1 (map): {"expression": "[item, (item.subject.toLowerCase().includes('keyword') || item.snippet.toLowerCase().includes('keyword'))]"}
     Step N (filter): {"condition": "item[1] == true"}

  2. For simple field comparisons:
     {"condition": "item.status == 'active'"}
     {"condition": "item.score > 70"}

  3. For array membership:
     Pre-compute in prior map step, then filter on boolean:
     Step N-1 (map): {"expression": "[item, !existingIds.includes(item.id)]"}
     Step N (filter): {"condition": "item[1] == true"}

- ❌ WRONG - These will cause "Expected )" parser errors:
  {"condition": "item.subject?.toLowerCase().includes('keyword')"}  // method calls not supported
  {"condition": "((item.subject ?? '') + ' ' + (item.snippet ?? '')).toLowerCase().includes('keyword')"}  // too complex
  {"condition": "(item.snippet ?? '').toLowerCase().includes('keyword')"}  // method calls not supported

- NEVER use self-invoking functions: })()

**Field Mapping** (CRITICAL):
When IR.filters references fields not in plugin output schema:

1. Check plugin output_schema to find available fields
2. Map IR field to closest plugin field:
   - Gmail: IR "body" → use "snippet" (body is usually empty per schema)
   - IR "content" → use actual field from schema
   - IR "text" → use actual field from schema

3. Example - Gmail keyword filter where IR has field="body":
   Plugin schema shows: snippet (contains preview), body (usually empty)
   ✅ Use: (item.snippet ?? '').toLowerCase().includes('keyword')
   ❌ NOT: (item.body ?? '').toLowerCase().includes('keyword')

**Deduplication** (CRITICAL):
When IR has lookup data source with role="lookup", use pre-computed boolean pattern:

✅ CORRECT - Pre-compute membership test, then filter on boolean:
{
  "id": "step3",
  "type": "action",
  "plugin": "google-sheets",
  "action": "read_range",
  "params": {"spreadsheet_id": "...", "range": "SheetName"}
},
{
  "id": "step4",
  "type": "transform",
  "operation": "map",
  "input": "{{step3.data.values}}",
  "config": {"expression": "item[COL_INDEX]"}  // Extract ID from correct column
},
{
  "id": "step5",
  "type": "transform",
  "operation": "map",
  "input": "{{step2.data}}",  // New filtered items
  "config": {"expression": "[item, !{{step4.data}}.includes(item.id)]"}  // [item, isNew]
},
{
  "id": "step6",
  "type": "transform",
  "operation": "filter",
  "input": "{{step5.data}}",
  "config": {"condition": "item[1] == true"}  // Keep only new items
},
{
  "id": "step7",
  "type": "transform",
  "operation": "map",
  "input": "{{step6.data}}",
  "config": {"expression": "item[0]"}  // Extract original item
}

❌ WRONG - Do NOT use scatter_gather for simple deduplication
❌ WRONG - Do NOT use: "!{{step4.data}}.includes(item.id)" - .includes() is method call, evaluator can't parse
❌ WRONG - Do NOT use: !({{step4.data}}).includes(item.id) - extra parens AND method call

**Column Position Consistency** (CRITICAL):
ID column MUST be at same position when reading and writing:

1. Find ID field in IR.rendering.columns_in_order (e.g., "gmail_message_link_or_id")
2. Note its position (0-indexed): ["email", "subject", "date", "text", "id"] → id is index 4
3. When reading existing IDs: use item[4] to extract from column E
4. When writing new rows: put item.id at index 4: [item.email, item.subject, item.date, item.text, item.id]

Example for rendering.columns_in_order = ["sender_email", "subject", "date", "full_email_text", "gmail_message_link_or_id"]:
- Read IDs: item[4]  // 5th column (E)
- Write rows: [item.from, item.subject, item.date, item.snippet, item.id]  // ID also in 5th position

**Grounded Facts** (CRITICAL):
- Use ONLY validated field names from grounded_facts
- NO excessive fallbacks: item.from ?? item.sender ❌
- Single fallback only: item.from ?? '' ✅
- Construct missing fields: item.id ? \`url/\${item.id}\` : ''

**Rendering**: IR.rendering → transform with operation: "map"
- Format to rows: "[item.date, item.name]" (each item becomes a row array)

**Map Expression Patterns** (CRITICAL):
In a map operation, the runtime iterates over the input array for you.
\`item\` is ONE ELEMENT of the array, NOT the whole array.

1. **Transform each element** (e.g., spreadsheet row array to object):
   ✅ {"expression": "{ \"Date\": item[0], \"Name\": item[1], \"Email\": item[2] }"}
   ❌ WRONG - item is already one element, do NOT call array methods on it:
   {"expression": "item.map(row => ({ \"Date\": row[0] }))"}

2. **Extract single field from each item**:
   ✅ {"expression": "item[0]"}   // Extract first column value
   ✅ {"expression": "item.id"}   // Extract id field
   ❌ WRONG: {"expression": "item.map(row => row[0])"}  // item is NOT the array

3. **Create tuple pairs for filtering**:
   ✅ {"expression": "[item, item.status == 'active']"}  // Per-item, returns [item, boolean]

4. **NEVER call array methods on item**:
   ❌ item.map(...)    - item is one element, not the array
   ❌ item.filter(...)  - item is one element, not the array
   ❌ item.slice(...)   - item is one element, not the array
   ❌ item.reduce(...)  - item is one element, not the array

**Delivery**:
- summary: Single action step
- per_group: scatter_gather over groups
- per_item: scatter_gather over items

## Template Variable Scoping
❌ NEVER use {{vars}} inside function bodies:
  "(() => { const x = {{step1.data}}; })"  // FORBIDDEN
✅ Reference vars in input field, simple conditions in config

## Nested Step Scoping (CRITICAL)

**scatter_gather nested steps:**
- Nested steps inside scatter.steps[] are NOT addressable from top-level steps
- Nested steps execute in parallel for each item in the input array
- gather operation collects all nested outputs into parent step's output
- ONLY the parent step (not nested steps) is accessible to other top-level steps

**Correct pattern:**
✅ step1 → step2 (scatter) → step3 references {{step2.data}}
❌ step1 → step2 (scatter with step2_nest1 inside) → step3 references {{step2_nest1.data}}

**If you need scatter_gather results:**
- Reference the PARENT scatter step: {{step2.data}}
- The gather operation already collected all nested outputs
- NEVER add nested step IDs (step2_nest1, step3_nest1, etc.) to dependencies array
- NEVER reference nested steps with {{stepX_nestY.*}} from top-level steps

**Examples:**
❌ WRONG - Top-level step referencing nested step:
{
  "id": "step5",
  "dependencies": ["step4_nest1"],  // ERROR: nested step
  "input": "{{step4_nest1.data}}"   // ERROR: nested step
}

✅ CORRECT - Top-level step referencing parent scatter:
{
  "id": "step5",
  "dependencies": ["step4"],  // Parent scatter step
  "input": "{{step4.data}}"   // Parent's gathered output
}

## Important
- Use EXACT param/field names from schemas
- Trust grounded_facts (no guessing fields)
- NO {{vars}} inside closures
- NO nested step references from top-level steps
- Dependencies enable parallel execution
- Output JSON only
`.trim()
  }

  /**
   * Build user prompt with IR, pipeline context, and plugin schemas
   */
  private buildUserPrompt(
    ir: DeclarativeLogicalIR,
    pipelineContext: PipelineContext | undefined,
    usedPlugins: string[],
    previousValidationErrors?: string[],
    userFeedback?: UserFeedback
  ): string {
    const pluginSchemasSection = this.buildPluginSchemasSection(usedPlugins)

    // Build semantic context section (replaces enhancedPrompt)
    const semanticContextSection = pipelineContext?.semantic_plan
      ? `# Semantic Context (From Phase 1)

Goal: ${pipelineContext.semantic_plan.goal}

`
      : ''

    // Build grounded facts section (from Phase 2)
    const groundedFactsSection = pipelineContext?.grounded_facts && Object.keys(pipelineContext.grounded_facts).length > 0
      ? `# Grounded Facts (Validated Field Names from Phase 2)

${JSON.stringify(pipelineContext.grounded_facts, null, 2)}

These are EXACT field names validated against real data. Use these for variable references.

`
      : ''

    // Build validation errors section (for retries)
    const validationErrorsSection = previousValidationErrors && previousValidationErrors.length > 0
      ? `# ⚠️ CRITICAL: Previous Attempt Failed Validation

The previous workflow had the following validation errors. You MUST fix these:

${previousValidationErrors.map((error, i) => `${i + 1}. ${error}`).join('\n')}

Please carefully review these errors and correct them in the new workflow.

`
      : ''

    // Build user feedback section (for regeneration based on user feedback)
    const userFeedbackSection = userFeedback
      ? `# 🔄 USER FEEDBACK - WORKFLOW REGENERATION

This is regeneration attempt #${userFeedback.regeneration_attempt || 1}.
The user reviewed your previous workflow and identified problems that need to be fixed.

## Previous Workflow (User Rejected This)

\`\`\`json
${JSON.stringify(userFeedback.previous_workflow, null, 2)}
\`\`\`

## User's Feedback

"${userFeedback.user_feedback}"

${userFeedback.feedback_history && userFeedback.feedback_history.length > 0 ? `## Previous Feedback History

${userFeedback.feedback_history.map((fb, i) => `Attempt ${i + 1}: "${fb}"`).join('\n')}

` : ''}## Instructions for Regeneration

1. Carefully read and understand the user's feedback above
2. Identify which specific steps need to be changed based on the feedback
3. Generate an IMPROVED workflow that addresses the user's concerns
4. Keep steps that were NOT mentioned as problematic
5. Ensure the new workflow still achieves the original goal
6. Reference the specific step numbers from the previous workflow when making changes

IMPORTANT: The user expects the new workflow to be different and improved based on their feedback.

`
      : ''

    return `
${userFeedbackSection}${validationErrorsSection}${semanticContextSection}${groundedFactsSection}# Declarative IR (From Phase 3)

${JSON.stringify(ir, null, 2)}

${pluginSchemasSection}

# Task

Generate complete PILOT DSL workflow that executes this IR.
Use EXACT parameter names from plugin schemas above.
Follow workflow patterns from system prompt.
${previousValidationErrors && previousValidationErrors.length > 0 ? 'CRITICAL: Fix the validation errors listed above.\n' : ''}${userFeedback ? 'CRITICAL: Address the user feedback above and generate an improved workflow.\n' : ''}Output JSON only: { "workflow": [...] }
`.trim()
  }

  /**
   * Build plugin schemas section (only used plugins)
   */
  private buildPluginSchemasSection(usedPlugins: string[]): string {
    const buildSchemaLogger = moduleLogger.child({ method: 'buildPluginSchemasSection' })
    const availablePlugins = this.pluginManager.getAvailablePlugins()

    const pluginSchemas = usedPlugins
      .map(pluginKey => {
        const pluginDef = availablePlugins[pluginKey]
        if (!pluginDef) {
          buildSchemaLogger.warn({ pluginKey }, 'Plugin not found')
          return null
        }

        const actionsInfo = Object.entries(pluginDef.actions)
          .map(([actionName, actionDef]: [string, any]) => {
            const params = actionDef.parameters
            const output = actionDef.output_schema

            // Concise parameter formatting (no descriptions, just structure)
            const formatParams = (properties: any, indent: string = '    '): string => {
              return Object.entries(properties)
                .map(([paramName, paramSchema]: [string, any]) => {
                  const isReq = params?.required?.includes(paramName) ? '*' : ''
                  const type = paramSchema.type || 'any'

                  // Handle nested objects inline
                  if (type === 'object' && paramSchema.properties) {
                    const nested = Object.keys(paramSchema.properties).join(', ')
                    return `${indent}${paramName}${isReq} (${type}: {${nested}})`
                  }

                  return `${indent}${paramName}${isReq} (${type})`
                })
                .join(', ')
            }

            const formatOutput = (properties: any, prefix: string = ''): string => {
              const fields: string[] = []

              for (const [name, schema] of Object.entries(properties)) {
                const typedSchema = schema as any
                const type = typedSchema.type || 'any'
                const desc = typedSchema.description || ''

                // Extract field usage hints from description
                let hint = ''
                if (desc.includes('USE THIS')) {
                  hint = ' ✅USE_THIS'
                } else if (desc.includes('Usually empty') || desc.includes('Always empty') || desc.includes('NOT available') || desc.includes('Not available')) {
                  hint = ' ⚠️USUALLY_EMPTY'
                } else if (desc.includes('Available') || desc.includes('contains')) {
                  hint = ' ✅Available'
                }

                const fieldName = prefix ? `${prefix}.${name}` : name

                // Handle array types with nested items
                if (type === 'array' && typedSchema.items?.properties) {
                  fields.push(`${fieldName}[] (array)`)
                  // Recursively format nested fields
                  const nestedFields = formatOutput(typedSchema.items.properties, `${fieldName}[i]`)
                  fields.push(...nestedFields.split(', ').filter(f => f))
                } else {
                  fields.push(`${fieldName} (${type})${hint}`)
                }
              }

              return fields.join(', ')
            }

            // Build concise action info
            let actionInfo = `  ${actionName}:`

            if (params && params.properties) {
              actionInfo += ` ${formatParams(params.properties, '')}`
            } else {
              actionInfo += ' no params'
            }

            if (output && output.properties) {
              actionInfo += ` → ${formatOutput(output.properties)}`
            }

            return actionInfo
          })
          .join('\n')

        return `${pluginKey}:\n${actionsInfo}`
      })
      .filter(Boolean)
      .join('\n\n')

    if (!pluginSchemas) {
      return ''
    }

    return `
# Plugin Schemas (* = required)

${pluginSchemas}

## Field Usage Hints:
- ✅USE_THIS: Primary field for this use case (e.g., email content matching)
- ⚠️USUALLY_EMPTY: Field is typically empty - avoid using in conditions/filters
- ✅Available: Field contains data and can be used

CRITICAL: When filtering/mapping plugin output data, use fields marked ✅USE_THIS or ✅Available.
AVOID fields marked ⚠️USUALLY_EMPTY - they will cause empty results.

Use EXACT param names. Preserve nested structures (e.g., params.content.subject).
`
  }

  /**
   * Call LLM with timeout protection
   * Returns AbortController to allow cleanup
   */
  private async callWithTimeout<T>(
    apiCall: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    try {
      const result = await Promise.race([apiCall, timeoutPromise])
      if (timeoutId) clearTimeout(timeoutId)
      return result
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId)
      throw error
    }
  }

  /**
   * Compile with OpenAI and timeout protection
   */
  private async compileWithOpenAI(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ workflow: any[]; tokenUsage: any }> {
    const openaiLogger = moduleLogger.child({ method: 'compileWithOpenAI', model: this.model })

    if (!this.openai) {
      throw new Error('OpenAI client not initialized')
    }

    openaiLogger.info('Calling OpenAI API')

    // PHASE 3: Use json_object mode (strict mode disabled due to incompatibility with discriminated unions)
    // OpenAI strict mode cannot handle optional $ref fields in discriminated unions
    // Runtime validation via validateWorkflow() provides sufficient error checking
    const apiCall = this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: {
        type: 'json_object'
      },
      temperature: this.temperature,
      max_completion_tokens: this.maxTokens
    })

    // TO FIX: Move timeout value to DB config or environment variable
    // Wrap with 120-second timeout (complex workflows can take 60-90s)
    const response = await this.callWithTimeout(apiCall, 120000)

    const content = response.choices[0]?.message?.content
    if (!content) {
      const finishReason = response.choices[0]?.finish_reason
      openaiLogger.error({ finishReason, response }, 'Empty response from OpenAI')
      throw new Error(`Empty response from OpenAI (finish_reason: ${finishReason || 'unknown'}, model: ${this.model})`)
    }

    const parsed = JSON.parse(content)

    if (!parsed.workflow || !Array.isArray(parsed.workflow)) {
      throw new Error('Invalid response format - missing workflow array')
    }

    return {
      workflow: parsed.workflow,
      tokenUsage: {
        input: response.usage?.prompt_tokens || 0,
        output: response.usage?.completion_tokens || 0,
        total: response.usage?.total_tokens || 0
      }
    }
  }

}
