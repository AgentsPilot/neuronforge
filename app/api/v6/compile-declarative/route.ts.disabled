/**
 * Compile Declarative IR API Endpoint
 *
 * Converts Declarative Logical IR → PILOT_DSL Workflow (LLM-based compilation)
 *
 * Flow:
 * 1. Receive Declarative IR from client (NO IDs, NO loops)
 * 2. Validate IR is purely declarative (forbidden token check)
 * 3. Compile IR using IRToDSLCompiler (single LLM call with gpt-5.2)
 * 4. Return PILOT_DSL workflow ready for execution
 *
 * This endpoint demonstrates V6 Pure Declarative Architecture.
 */

import { NextRequest, NextResponse } from 'next/server'
import { IRToDSLCompiler } from '@/lib/agentkit/v6/compiler/IRToDSLCompiler'
import { DeclarativeCompiler } from '@/lib/agentkit/v6/compiler/DeclarativeCompiler'
import { compilerMetrics } from '@/lib/agentkit/v6/compiler/CompilerMetrics'
import { validateDeclarativeIR } from '@/lib/agentkit/v6/logical-ir/validation/DeclarativeIRValidator'
import type { DeclarativeLogicalIR } from '@/lib/agentkit/v6/logical-ir/schemas/declarative-ir-types'
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import { validateWorkflowStructure } from '@/lib/pilot/schema'
import { wrapInPilotDSL } from '@/lib/agentkit/v6/compiler/utils/DSLWrapper'

// ============================================================================
// Types
// ============================================================================

interface CompileDeclarativeRequest {
  ir: DeclarativeLogicalIR
  userId?: string
  agentId?: string
  pipeline_context?: {
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
  enhanced_prompt?: any // Deprecated - use pipeline_context instead
  compiler_config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
  }
}

interface CompileDeclarativeResponse {
  success: boolean
  workflow?: any[]  // Legacy format (just steps)
  dsl?: any         // NEW: Full PILOT DSL structure
  errors?: string[]
  validation?: {
    valid: boolean
    errors?: any[]
  }
  metadata?: {
    compilation_time_ms: number
    step_count: number
    plugins_used: string[]
    token_usage?: {
      input: number
      output: number
      total: number
    }
    compiler_used?: string
    fallback_reason?: string
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Transform workflow steps for execution compatibility
 *
 * Handles two formats:
 *
 * 1. LEGACY V6 format (config.data, config.actions) - converted to execution format
 * 2. NEW V6 format (scatter.input, scatter.steps, gather.operation) - already correct, just step_id → id
 *
 * Execution format:
 * {
 *   id: 'step4',
 *   type: 'scatter_gather',
 *   scatter: {
 *     input: '{{step1.emails}}',
 *     steps: [ ... nested steps ... ]
 *   },
 *   gather: {
 *     operation: 'collect'
 *   }
 * }
 */
function transformScatterGatherSteps(workflow: any[]): any[] {
  return workflow.map(step => {
    // Transform step_id → id for execution compatibility
    const baseStep = {
      ...step,
      id: step.step_id || step.id,
      step_id: undefined
    }
    delete baseStep.step_id

    // LEGACY FORMAT: config.data + config.actions
    if (step.type === 'scatter_gather' && step.config?.data && step.config?.actions) {
      console.log(`[Transform] Converting LEGACY scatter_gather step ${step.step_id || step.id} to execution format`)

      // Extract V6 format fields
      const { data, item_variable, actions, ...restConfig } = step.config

      // Recursively transform nested actions
      const transformedActions = actions.map((action: any) => ({
        ...action,
        id: action.step_id || action.id,
        step_id: undefined
      }))

      // Build execution format
      const transformedStep = {
        ...baseStep,
        scatter: {
          input: data,
          itemVariable: item_variable, // Keep for context
          steps: transformedActions.map((a: any) => {
            const cleaned = { ...a }
            delete cleaned.step_id
            return cleaned
          })
        },
        gather: {
          operation: 'collect' // Default gather operation
        },
        // Remove config entirely (replaced by scatter/gather)
        config: undefined
      }

      // Clean up undefined fields
      delete transformedStep.config

      console.log(`[Transform] ✓ Transformed ${step.step_id || step.id}:`, {
        from: { data, actions: actions.length },
        to: { 'scatter.input': data, 'scatter.steps': transformedActions.length }
      })

      return transformedStep
    }

    // NEW FORMAT: scatter.input + scatter.steps + gather.operation
    // Already in correct format, just transform nested steps for step_id → id
    if (step.type === 'scatter_gather' && step.scatter?.input && step.scatter?.steps) {
      console.log(`[Transform] Processing NEW format scatter_gather step ${step.step_id || step.id}`)

      // Transform nested steps (step_id → id)
      const transformedNestedSteps = step.scatter.steps.map((nestedStep: any) => ({
        ...nestedStep,
        id: nestedStep.step_id || nestedStep.id,
        step_id: undefined
      }))

      // Clean step_id from nested steps
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
 * Simplify overly complex filter conditions
 *
 * Detects patterns like:
 * (field.includes('word1') || field.includes('word2') || ... || field.includes('wordN'))
 *
 * And simplifies to:
 * ['word1', 'word2', ..., 'wordN'].some(kw => field1.includes(kw) || field2.includes(kw))
 */
function simplifyComplexConditions(workflow: any[]): any[] {
  return workflow.map(step => {
    if (step.type === 'transform' && step.operation === 'filter' && step.config?.condition) {
      const condition = step.config.condition

      // Only process string conditions (skip structured condition objects)
      if (typeof condition !== 'string') {
        console.log(`[Simplify] Step ${step.id || step.step_id}: Skipping non-string condition (type: ${typeof condition})`)
        return step
      }

      // Detect pattern: multiple .includes() calls chained with ||
      const includesPattern = /\(([^)]+)\)\.toLowerCase\(\)\.includes\('([^']+)'\)/g
      const matches = [...condition.matchAll(includesPattern)]

      if (matches.length > 10) {
        // Complex condition detected - extract unique fields and keywords
        const uniqueFields = new Set<string>()
        const allKeywords = new Set<string>()

        for (const match of matches) {
          // Extract field reference (e.g., "item.subject ?? '' ?? ''")
          let field = match[1].trim()

          // Normalize field: extract base field name (e.g., "item.subject")
          // Remove extra null coalescing operators
          const baseFieldMatch = field.match(/(item\.\w+)/)
          if (baseFieldMatch) {
            field = baseFieldMatch[1]
          }

          uniqueFields.add(field)
          allKeywords.add(match[2])
        }

        console.log(`[Simplify] Step ${step.id || step.step_id}: Simplifying ${matches.length} .includes() calls`)
        console.log(`[Simplify] Unique fields: ${Array.from(uniqueFields).join(', ')}`)
        console.log(`[Simplify] Unique keywords: ${allKeywords.size}`)

        // Build single keyword array
        const keywordArray = `['${Array.from(allKeywords).join("', '")}']`

        // Build simplified condition: ONE .some() with field checks inside
        const fieldChecks = Array.from(uniqueFields)
          .map(field => `(${field} ?? '').toLowerCase().includes(kw)`)
          .join(' || ')

        const simplifiedCondition = `${keywordArray}.some(kw => ${fieldChecks})`

        console.log(`[Simplify] ✓ Simplified to: ${simplifiedCondition.substring(0, 200)}`)

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

/**
 * Remove output_variable from most steps, but KEEP it for scatter_gather steps
 *
 * The execution context stores most step outputs under step.id, not output_variable.
 * However, scatter_gather steps use output_variable to name their collected results,
 * and subsequent steps reference this name (e.g., {{ai_extraction_results}}).
 *
 * This function removes output_variable EXCEPT for scatter_gather steps.
 */
function removeOutputVariables(workflow: any[]): any[] {
  return workflow.map(step => {
    // Keep output_variable for scatter_gather - it defines where results are stored
    if (step.type === 'scatter_gather') {
      return step
    }
    if (step.output_variable) {
      console.log(`[Cleanup] Removing unused output_variable from ${step.step_id || step.id}`)
      const cleaned = { ...step }
      delete cleaned.output_variable
      return cleaned
    }
    return step
  })
}

/**
 * Standardize variable references across all steps
 *
 * Ensures consistent data access patterns:
 * - Transform steps with output_variable: Use {{output_variable}}
 * - Plugin steps: Use {{step_id}}
 * - Scatter-gather: Use {{step_id}} for the gathered result
 *
 * This prevents mismatches like {{step3.data}} when it should be {{step3_output}}
 */
function standardizeVariableReferences(workflow: any[]): any[] {
  // Build maps for step metadata
  const stepOutputMap = new Map<string, string>()
  const stepTypeMap = new Map<string, string>()

  workflow.forEach(step => {
    const stepId = step.step_id || step.id
    const stepType = step.type

    stepTypeMap.set(stepId, stepType)

    if (step.output_variable) {
      stepOutputMap.set(stepId, step.output_variable)
    } else {
      // For steps without output_variable, the output is stored as {{step_id}}
      stepOutputMap.set(stepId, stepId)
    }
  })

  console.log('[Standardize] Step output map:', Object.fromEntries(stepOutputMap))
  console.log('[Standardize] Step type map:', Object.fromEntries(stepTypeMap))

  // Helper function to normalize a variable reference
  const normalizeReference = (ref: string): string => {
    // Match patterns like {{stepX}}, {{stepX.data}}, {{stepX.something}}
    const match = ref.match(/\{\{(step\d+)(\..*?)?\}\}/)
    if (!match) return ref // Not a step reference, leave as-is

    const stepId = match[1]
    const property = match[2] // Could be .data, .output, etc.

    // Look up step metadata
    const outputVar = stepOutputMap.get(stepId)
    const stepType = stepTypeMap.get(stepId)

    if (!outputVar) {
      console.log(`[Standardize] Warning: Reference to unknown step ${stepId}`)
      return ref
    }

    // Handle different step types differently
    const isPluginStep = stepType === 'action'

    if (property) {
      // Has property accessor like .data, .emails, .values, etc.

      // CRITICAL FIX: Plugin steps store output directly, NOT under .data
      // So {{step1.data.emails}} should be {{step1.emails}}
      if (isPluginStep && property === '.data') {
        console.log(`[Standardize] Removing invalid .data accessor from plugin step: ${ref} → {{${stepId}}}`)
        return `{{${stepId}}}`
      }

      // For references like {{step1.data.emails}}, split and fix
      if (property.startsWith('.data.') && isPluginStep) {
        const actualProperty = property.replace('.data.', '.')
        const normalized = `{{${stepId}${actualProperty}}}`
        console.log(`[Standardize] Fixing plugin reference: ${ref} → ${normalized}`)
        return normalized
      }

      // Transform steps store under .data, so {{step3.data}} is correct
      // Scatter-gather steps also store under step ID
      // Keep the original step ID for property accessors
      return ref
    } else {
      // No property accessor - use output_variable if different from step ID
      const normalized = `{{${outputVar}}}`
      if (normalized !== ref) {
        console.log(`[Standardize] ${ref} → ${normalized}`)
      }
      return normalized
    }
  }

  // Recursively normalize all string values in an object
  const normalizeObject = (obj: any): any => {
    if (typeof obj === 'string') {
      return normalizeReference(obj)
    }
    if (Array.isArray(obj)) {
      return obj.map(normalizeObject)
    }
    if (obj && typeof obj === 'object') {
      const normalized: any = {}
      for (const [key, value] of Object.entries(obj)) {
        normalized[key] = normalizeObject(value)
      }
      return normalized
    }
    return obj
  }

  // Apply normalization to all steps
  return workflow.map(step => {
    const normalized = normalizeObject(step)
    return normalized
  })
}

/**
 * Fix step dependencies to ensure all referenced steps exist
 */
function fixStepDependencies(workflow: any[]): any[] {
  const allStepIds = new Set(workflow.map(s => s.step_id || s.id))

  return workflow.map(step => {
    if (step.dependencies && Array.isArray(step.dependencies)) {
      const validDependencies = step.dependencies.filter((depId: string) => {
        if (!allStepIds.has(depId)) {
          console.log(`[Fix] Removing invalid dependency "${depId}" from step ${step.step_id || step.id}`)
          return false
        }
        return true
      })

      return {
        ...step,
        dependencies: validDependencies
      }
    }

    return step
  })
}

/**
 * Fix common LLM compilation mistakes in workflows
 *
 * Common issues:
 * 1. Using {{stepX.data}} for transform outputs instead of {{stepX}}
 * 2. Using `newItem` variable in non-scatter contexts
 * 3. Useless transforms like `expression: "item"`
 * 4. Useless filters like `condition: "true"`
 */
function fixCommonCompilationMistakes(workflow: any[]): any[] {
  return workflow.map(step => {
    // Fix transform output references: {{stepX.data}} → {{stepX}}
    // Transform outputs are stored as { stepId: 'stepX', data: [...] }
    // So we reference them as {{stepX}} in inputs, NOT {{stepX.data}}
    if (step.input && typeof step.input === 'string') {
      const fixedInput = step.input.replace(/\{\{(step\d+)\.data\}\}/g, '{{$1}}')
      if (fixedInput !== step.input) {
        console.log(`[Fix] ${step.id}: Fixed transform output reference: ${step.input} → ${fixedInput}`)
        step = { ...step, input: fixedInput }
      }
    }

    // Fix config.expression references
    if (step.config?.expression && typeof step.config.expression === 'string') {
      const fixedExpr = step.config.expression.replace(/\{\{(step\d+)\.data\}\}/g, '{{$1}}')
      if (fixedExpr !== step.config.expression) {
        console.log(`[Fix] ${step.id}: Fixed expression reference: ${step.config.expression} → ${fixedExpr}`)
        step = {
          ...step,
          config: { ...step.config, expression: fixedExpr }
        }
      }
    }

    // Remove useless map transforms that just return the item unchanged
    if (step.type === 'transform' && step.operation === 'map' && step.config?.expression === 'item') {
      console.log(`[Fix] ${step.id}: Detected useless map transform (expression: "item") - marking for removal`)
      // We can't remove it here without breaking dependencies, but we can flag it
      step = { ...step, _useless: true }
    }

    // Fix useless filter transforms with condition: "true"
    if (step.type === 'transform' && step.operation === 'filter' && step.config?.condition === 'true') {
      console.log(`[Fix] ${step.id}: Detected useless filter (condition: "true") - marking for removal`)
      step = { ...step, _useless: true }
    }

    return step
  })
}

/**
 * Remove steps marked as useless and fix dependencies
 */
function removeUselessSteps(workflow: any[]): any[] {
  const uselessStepIds = new Set(
    workflow.filter(s => s._useless).map(s => s.id)
  )

  if (uselessStepIds.size === 0) {
    return workflow
  }

  console.log(`[Cleanup] Removing ${uselessStepIds.size} useless steps: ${Array.from(uselessStepIds).join(', ')}`)

  // Build step replacement map: useless step → its input step
  // This handles chains: if step3 depends on step2, and step3 is useless,
  // any step depending on step3 should now depend on step2
  const replacementMap = new Map<string, string>()

  workflow.forEach(step => {
    if (step._useless && step.input) {
      // Extract step ID from input like {{stepX}}
      const match = step.input.match(/\{\{(step\d+)\}\}/)
      if (match) {
        replacementMap.set(step.id, match[1])
        console.log(`[Cleanup] ${step.id} will be replaced with ${match[1]}`)
      }
    }
  })

  // Resolve chains: if A→B→C and both A and B are useless, replace A with C
  const resolveReplacement = (stepId: string, visited = new Set<string>()): string => {
    if (visited.has(stepId)) {
      // Circular reference protection
      return stepId
    }
    visited.add(stepId)

    const replacement = replacementMap.get(stepId)
    if (!replacement) {
      return stepId
    }

    // If the replacement is also useless, recursively resolve
    if (uselessStepIds.has(replacement)) {
      return resolveReplacement(replacement, visited)
    }

    return replacement
  }

  // Remove useless steps
  const filtered = workflow.filter(s => !s._useless)

  // Fix references to removed steps in remaining steps
  return filtered.map(step => {
    let updated = { ...step }

    // Fix input references
    if (updated.input && typeof updated.input === 'string') {
      let fixedInput = updated.input
      uselessStepIds.forEach(uselessId => {
        const replacement = resolveReplacement(uselessId)
        const pattern = new RegExp(`\\{\\{${uselessId}\\}\\}`, 'g')
        if (pattern.test(fixedInput)) {
          fixedInput = fixedInput.replace(pattern, `{{${replacement}}}`)
          console.log(`[Cleanup] ${step.id}: Updated input reference ${uselessId} → ${replacement}`)
        }
      })
      updated.input = fixedInput
    }

    // Fix config.expression references (for transform steps)
    if (updated.config?.expression && typeof updated.config.expression === 'string') {
      let fixedExpr = updated.config.expression
      uselessStepIds.forEach(uselessId => {
        const replacement = resolveReplacement(uselessId)
        const pattern = new RegExp(`\\{\\{${uselessId}\\}\\}`, 'g')
        if (pattern.test(fixedExpr)) {
          fixedExpr = fixedExpr.replace(pattern, `{{${replacement}}}`)
          console.log(`[Cleanup] ${step.id}: Updated config.expression reference ${uselessId} → ${replacement}`)
        }
      })
      updated.config = { ...updated.config, expression: fixedExpr }
    }

    // Fix dependencies array
    if (updated.dependencies && Array.isArray(updated.dependencies)) {
      const originalDeps = [...updated.dependencies]

      // Replace dependencies on useless steps with their replacements
      const fixedDeps = updated.dependencies
        .map((depId: string) => {
          if (uselessStepIds.has(depId)) {
            const replacement = resolveReplacement(depId)
            if (replacement !== depId) {
              console.log(`[Cleanup] ${step.id}: Replaced dependency ${depId} → ${replacement}`)
            }
            return replacement
          }
          return depId
        })
        // Remove duplicates (in case multiple useless steps resolve to the same replacement)
        .filter((depId: string, index: number, arr: string[]) => arr.indexOf(depId) === index)
        // Ensure the replacement step actually exists in the filtered workflow
        .filter((depId: string) => !uselessStepIds.has(depId))

      updated.dependencies = fixedDeps

      if (JSON.stringify(originalDeps) !== JSON.stringify(fixedDeps)) {
        console.log(`[Cleanup] ${step.id}: Dependencies updated from [${originalDeps.join(', ')}] to [${fixedDeps.join(', ')}]`)
      }
    }

    return updated
  })
}

// ============================================================================
// POST Handler
// ============================================================================

export async function POST(request: NextRequest) {
  console.log('[API] /api/v6/compile-declarative - POST')

  const startTime = Date.now()

  try {
    // Parse request body
    const body: CompileDeclarativeRequest = await request.json()
    console.log('[API] Compiling Declarative IR with goal:', body.ir?.goal)
    console.log('[API] IR keys received:', body.ir ? Object.keys(body.ir) : 'NO IR')

    // Validate request
    if (!body.ir) {
      console.log('[API] ✗ Missing IR')
      return NextResponse.json(
        {
          success: false,
          errors: ['Declarative IR is required']
        } as CompileDeclarativeResponse,
        { status: 400 }
      )
    }

    // Validate IR structure
    if (!body.ir.ir_version || !body.ir.goal || !body.ir.data_sources || !body.ir.delivery_rules) {
      console.log('[API] ✗ Invalid IR structure')
      console.log('[API] IR structure check:', {
        has_ir_version: !!body.ir.ir_version,
        has_goal: !!body.ir.goal,
        has_data_sources: !!body.ir.data_sources,
        has_delivery_rules: !!body.ir.delivery_rules,
        ir_keys: Object.keys(body.ir)
      })
      return NextResponse.json(
        {
          success: false,
          errors: ['Invalid IR structure - missing required fields (ir_version, goal, data_sources, delivery_rules)']
        } as CompileDeclarativeResponse,
        { status: 400 }
      )
    }

    // STEP 1: Validate IR is purely declarative
    console.log('[API] Step 1: Validating declarative IR...')
    const validation = validateDeclarativeIR(body.ir)

    if (!validation.valid) {
      console.log('[API] ✗ Declarative IR validation failed')
      console.log('[API] Validation errors:', JSON.stringify(validation.errors, null, 2))
      console.log('[API] Full IR structure:', JSON.stringify(body.ir, null, 2))
      return NextResponse.json(
        {
          success: false,
          errors: validation.errors.map(e => e.message),
          validation: {
            valid: false,
            errors: validation.errors
          }
        } as CompileDeclarativeResponse,
        { status: 400 }
      )
    }

    console.log('[API] ✓ Declarative IR validation passed')

    // STEP 2: Initialize PluginManager
    console.log('[API] Step 2: Initializing PluginManager...')
    const pluginManager = await PluginManagerV2.getInstance()
    console.log('[API] ✓ PluginManager initialized')

    // STEP 3: Compile IR to DSL
    console.log('[API] Step 3: Compiling IR to DSL...')

    // Try DeclarativeCompiler first, fall back to LLM on failure
    let compilationResult: any
    let usedFallback = false

    try {
      console.log('[API] Attempting deterministic compilation with DeclarativeCompiler...')
      const declarativeCompiler = new DeclarativeCompiler(pluginManager)
      compilationResult = await declarativeCompiler.compile(body.ir)

      if (compilationResult.success) {
        console.log('[API] ✓ Deterministic compilation successful')
        console.log('[API] Generated', compilationResult.workflow.length, 'steps')
      } else {
        throw new Error(`Deterministic compilation failed: ${compilationResult.errors?.join(', ')}`)
      }
    } catch (error) {
      console.error('[API] ❌ DeclarativeCompiler FAILED:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorType: error?.constructor?.name
      })
      console.warn('[API] ⚠ Falling back to LLM compiler...')
      usedFallback = true

      // Fallback to LLM compilation
      const llmCompiler = new IRToDSLCompiler({
        temperature: 0,
        maxTokens: 8000,
        pluginManager
      })

      // Use pipeline_context if available, otherwise fall back to enhanced_prompt (deprecated)
      if (body.enhanced_prompt && !body.pipeline_context) {
        console.log('[API] ⚠️ Using deprecated enhanced_prompt - consider using pipeline_context instead')
      }

      compilationResult = await llmCompiler.compile(body.ir, body.pipeline_context)
    }

    if (!compilationResult.success) {
      console.log('[API] ✗ Compilation failed:', compilationResult.errors)
      return NextResponse.json(
        {
          success: false,
          errors: compilationResult.errors || ['Compilation failed']
        } as CompileDeclarativeResponse,
        { status: 500 }
      )
    }

    console.log('[API] Compilation method:', usedFallback ? 'LLM (fallback)' : 'DeclarativeCompiler')

    console.log('[API] ✓ Compilation successful')
    console.log('[API] Steps generated:', compilationResult.workflow.length)
    if (compilationResult.plugins_used) {
      console.log('[API] Plugins used:', compilationResult.plugins_used.join(', '))
    }
    if (compilationResult.token_usage) {
      console.log('[API] Token usage:', compilationResult.token_usage)
    }

    // PHASE 4: ESSENTIAL POST-PROCESSING ONLY (Band-aids removed!)
    // Compiler now uses strict schema mode + validation with retry
    // So we only keep format transformations and schema enforcement

    // STEP 4: Simplify overly complex filter conditions (Performance optimization)
    console.log('[API] Step 4: Simplifying complex filter conditions...')
    const simplifiedWorkflow = simplifyComplexConditions(compilationResult.workflow)
    console.log('[API] ✓ Condition simplification complete')

    // STEP 5: Remove output_variable fields (Format requirement)
    console.log('[API] Step 5: Removing unused output_variable fields...')
    const workflowWithoutOutputVars = removeOutputVariables(simplifiedWorkflow)
    console.log('[API] ✓ Output variables removed')

    // STEP 6: Transform V6 scatter_gather format to WorkflowPilot execution format (Format requirement)
    console.log('[API] Step 6: Transforming scatter_gather steps to execution format...')
    const transformedWorkflow = transformScatterGatherSteps(workflowWithoutOutputVars)
    console.log('[API] ✓ Scatter_gather transformation complete')

    // PHASE 4 REMOVED:
    // - standardizeVariableReferences() - Fixed in Phase 1 compiler
    // - fixCommonCompilationMistakes() - Prevented by strict schema mode
    // - removeUselessSteps() - Prevented by strict schema mode

    // Return success response with compiler info
    const compilationTime = Date.now() - startTime

    // PHASE 5: Generate DSL from transformed workflow
    // Only generate DSL if DeclarativeCompiler was used (not LLM fallback)
    let dsl = undefined
    if (!usedFallback && compilationResult.ir) {
      console.log('[API] Phase 5: Generating PILOT DSL from transformed workflow...')
      dsl = wrapInPilotDSL(
        transformedWorkflow,  // Use final transformed steps
        compilationResult.ir,  // Use IR from compiler
        {
          plugins_used: compilationResult.plugins_used || [],
          compilation_time_ms: compilationResult.compilation_time_ms || compilationTime
        }
      )
      console.log('[API] ✓ DSL structure created with', transformedWorkflow.length, 'steps')
    }

    // PHASE 5: Validate DSL structure (if present)
    let dslValidation = { valid: true, errors: [], warnings: [] }
    if (dsl) {
      console.log('[API] Phase 5: Validating PILOT DSL structure...')
      dslValidation = validateWorkflowStructure(dsl.workflow_steps)

      if (!dslValidation.valid) {
        console.warn('[API] ⚠ DSL validation warnings:', dslValidation.errors)
        // Don't fail - just log warnings. The workflow may still be executable.
      } else {
        console.log('[API] ✓ DSL validation passed')
      }
    }

    const response: CompileDeclarativeResponse = {
      success: true,
      workflow: transformedWorkflow,  // Legacy format (just steps)
      dsl: dsl,                       // NEW: Full DSL structure (if available)
      validation: {
        valid: dslValidation.valid,
        errors: dslValidation.errors.length > 0 ? dslValidation.errors : undefined
      },
      metadata: {
        compilation_time_ms: compilationResult.compilation_time_ms || compilationTime,
        step_count: transformedWorkflow.length, // Use final count after cleanup
        plugins_used: compilationResult.plugins_used || [],
        token_usage: compilationResult.token_usage,
        compiler_used: usedFallback ? 'llm' : 'declarative',
        fallback_reason: usedFallback ? 'DeclarativeCompiler failed' : undefined
      }
    }

    console.log('[API] ✓ Declarative workflow compiled in', compilationResult.compilation_time_ms || compilationTime, 'ms')
    console.log('[API] Compiler used:', usedFallback ? 'LLM (fallback)' : 'DeclarativeCompiler')

    // Get compiler metrics summary
    const metricsSummary = compilerMetrics.getSummary(60) // Last hour
    console.log('[API] Compiler metrics (last hour):', {
      success_rate: metricsSummary.successRate != null ? `${metricsSummary.successRate.toFixed(1)}%` : 'N/A',
      total_compilations: metricsSummary.totalCompilations || 0,
      avg_time_ms: metricsSummary.avgCompilationTime != null ? `${metricsSummary.avgCompilationTime.toFixed(0)}ms` : 'N/A'
    })

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('[API] ✗ Error compiling declarative IR:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      {
        success: false,
        errors: [errorMessage]
      } as CompileDeclarativeResponse,
      { status: 500 }
    )
  }
}

// ============================================================================
// OPTIONS Handler (for CORS)
// ============================================================================

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  })
}
