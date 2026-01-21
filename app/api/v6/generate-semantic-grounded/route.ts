/**
 * Generate Semantic Plan + Grounded Plan (Phases 1+2 + 5-Layer Detection)
 *
 * POST /api/v6/generate-semantic-grounded
 *
 * This endpoint runs the first part of the V6 pipeline for Intent Validation:
 * 1. Phase 1: Understanding (Semantic Plan Generation) - ~5-15s
 * 2. Phase 2: Grounding (Assumption Validation) - ~100-500ms
 * 3. 5-Layer Ambiguity Detection - ~50-100ms
 *
 * Returns data for the Review & Customize UI, including:
 * - semantic_plan: The understood intent and structure
 * - grounded_plan: Validated assumptions with real data
 * - ambiguity_report: Items requiring user confirmation
 * - assumptions: List of assumptions for review
 * - edge_cases: Edge cases with handling options
 *
 * This is the first of two split APIs for the Intent Validation flow.
 * After user review, call /api/v6/compile-with-decisions for Phase 3+4+5.
 */

import { NextRequest, NextResponse } from 'next/server'
import { SemanticPlanGenerator } from '@/lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'
import { GroundingEngine } from '@/lib/agentkit/v6/semantic-plan/grounding/GroundingEngine'
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import type { DataSourceMetadata } from '@/lib/agentkit/v6/semantic-plan/grounding/DataSampler'
import { detectAmbiguities } from '@/lib/agentkit/v6/ambiguity-detection'
import { createLogger } from '@/lib/logger'

// Create module-scoped logger
const logger = createLogger({ module: 'V6', route: '/api/v6/generate-semantic-grounded' })

// ============================================================================
// Types
// ============================================================================

interface GenerateSemanticGroundedRequest {
  enhanced_prompt: any // EnhancedPrompt structure from Thread-Based Phase 3
  userId: string
  config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
    understanding_temperature?: number
    grounding_min_confidence?: number
    skip_grounding?: boolean // For testing
  }
}

// ============================================================================
// Plugin Schema Extraction Utilities (copied from generate-ir-semantic)
// ============================================================================

function inferActionName(
  pluginKey: string,
  availablePlugins: Record<string, any>
): string {
  const pluginDef = availablePlugins[pluginKey]
  if (!pluginDef?.actions) {
    return 'execute'
  }

  const actions = Object.keys(pluginDef.actions)
  if (actions.length === 0) {
    return 'execute'
  }

  const scoredActions = actions.map(actionName => {
    const actionDef = pluginDef.actions[actionName]
    let score = 0

    if (actionDef.output_schema?.properties) {
      const fieldCount = countSchemaFields(actionDef.output_schema)
      score += fieldCount * 10
    }

    const lowerName = actionName.toLowerCase()

    const readKeywords = ['search', 'list', 'query', 'read', 'fetch', 'get', 'find', 'retrieve']
    for (const keyword of readKeywords) {
      if (lowerName.includes(keyword)) {
        score += 50
        break
      }
    }

    const writeKeywords = ['send', 'create', 'update', 'delete', 'write', 'remove', 'insert', 'post', 'put']
    for (const keyword of writeKeywords) {
      if (lowerName.includes(keyword)) {
        score -= 100
        break
      }
    }

    if (lowerName.match(/^(search|list|query|read|get)_/)) {
      score += 30
    }

    return { actionName, score }
  })

  scoredActions.sort((a, b) => b.score - a.score)
  return scoredActions[0]?.actionName || actions[0] || 'execute'
}

function countSchemaFields(schema: any): number {
  if (!schema || typeof schema !== 'object') {
    return 0
  }

  let count = 0

  if (schema.properties) {
    count += Object.keys(schema.properties).length

    for (const propSchema of Object.values(schema.properties)) {
      if (typeof propSchema === 'object' && propSchema !== null) {
        const prop = propSchema as any
        if (prop.type === 'object') {
          count += countSchemaFields(prop)
        } else if (prop.type === 'array' && prop.items) {
          count += countSchemaFields(prop.items)
        }
      }
    }
  }

  if (schema.type === 'array' && schema.items) {
    count += countSchemaFields(schema.items)
  }

  return count
}

function extractFieldDescriptorsFromSchema(schema: any, parentKey: string = ''): Array<{name: string, description?: string, type?: string}> {
  const fields: Array<{name: string, description?: string, type?: string}> = []

  if (!schema || typeof schema !== 'object') {
    return fields
  }

  if (schema.type === 'array' && schema.items) {
    return extractFieldDescriptorsFromSchema(schema.items, parentKey)
  }

  if (schema.type === 'object' && schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      const fullKey = parentKey ? `${parentKey}.${key}` : key

      if (typeof value === 'object' && value !== null) {
        const propSchema = value as any

        if (propSchema.type === 'object' && propSchema.properties) {
          fields.push(...extractFieldDescriptorsFromSchema(propSchema, fullKey))
        } else if (propSchema.type === 'array' && propSchema.items) {
          fields.push(...extractFieldDescriptorsFromSchema(propSchema.items, fullKey))
        } else {
          fields.push({
            name: key,
            description: propSchema.description,
            type: propSchema.type
          })
        }
      } else {
        fields.push({
          name: key,
          type: typeof value === 'string' ? value : undefined
        })
      }
    }
  }

  return fields
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
    const body: GenerateSemanticGroundedRequest = await request.json()

    // Validate request
    if (!body.enhanced_prompt) {
      requestLogger.warn('Missing required field: enhanced_prompt')
      return NextResponse.json(
        { error: 'Missing required field: enhanced_prompt' },
        { status: 400 }
      )
    }

    if (!body.userId) {
      requestLogger.warn('Missing required field: userId')
      return NextResponse.json(
        { error: 'Missing required field: userId' },
        { status: 400 }
      )
    }

    const config = body.config || {}
    const provider = config.provider || 'openai'

    // Extract services_involved from Enhanced Prompt
    const servicesInvolved = body.enhanced_prompt?.specifics?.services_involved || []
    requestLogger.debug({ servicesInvolved }, 'Services involved')

    // ========================================================================
    // PHASE 1: Understanding (Semantic Plan Generation)
    // ========================================================================

    requestLogger.info({ phase: 1 }, 'Phase 1: Understanding started')
    const phase1Start = Date.now()

    const resolvedModel = config.model || (provider === 'openai' ? 'gpt-4o' : 'claude-3-5-sonnet-20241022')

    const semanticPlanGenerator = new SemanticPlanGenerator({
      model_provider: provider,
      model_name: resolvedModel,
      temperature: config.understanding_temperature ?? 0.3,
      max_tokens: 6000
    })

    const semanticPlanResult = await semanticPlanGenerator.generate(body.enhanced_prompt)

    const phase1Time = Date.now() - phase1Start

    if (!semanticPlanResult.success || !semanticPlanResult.semantic_plan) {
      requestLogger.error({ phase: 1, duration: phase1Time, errors: semanticPlanResult.errors }, 'Phase 1 failed')
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to generate semantic plan',
          details: semanticPlanResult.errors?.join('; '),
          phase: 'understanding'
        },
        { status: 500 }
      )
    }

    const semanticPlan = semanticPlanResult.semantic_plan

    // Validate semantic plan structure
    if (!semanticPlan.assumptions || !Array.isArray(semanticPlan.assumptions)) {
      requestLogger.error({ phase: 1, duration: phase1Time }, 'Phase 1 validation failed: Missing assumptions array')
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid semantic plan structure',
          details: 'Semantic plan must have assumptions array for grounding',
          phase: 'understanding'
        },
        { status: 500 }
      )
    }

    requestLogger.info({
      phase: 1,
      duration: phase1Time,
      goal: semanticPlan.goal,
      assumptionsCount: semanticPlan.assumptions?.length || 0,
      ambiguitiesCount: semanticPlan.ambiguities?.length || 0
    }, 'Phase 1 complete')

    // ========================================================================
    // PHASE 1.5: Plugin Schema Metadata Extraction
    // ========================================================================

    let dataSourceMetadata: DataSourceMetadata | undefined

    if (servicesInvolved.length > 0) {
      requestLogger.debug({ phase: 1.5 }, 'Extracting plugin schema metadata')

      const pluginKey = servicesInvolved[0]

      const pluginManager = await PluginManagerV2.getInstance()
      const availablePlugins = pluginManager.getAvailablePlugins()
      const pluginDef = availablePlugins[pluginKey]

      if (pluginDef) {
        const actionName = inferActionName(pluginKey, availablePlugins)
        const actionDef = pluginDef.actions[actionName]

        if (actionDef?.output_schema) {
          const fields = extractFieldDescriptorsFromSchema(actionDef.output_schema)
          const headers = fields.map(f => f.name)

          dataSourceMetadata = {
            type: 'tabular',
            headers,
            fields,
            plugin_key: pluginKey,
          }

          requestLogger.debug({
            phase: 1.5,
            pluginKey,
            actionName,
            fieldsCount: fields.length
          }, 'Plugin schema metadata extracted')
        }
      }
    }

    // ========================================================================
    // PHASE 2: Grounding (Assumption Validation)
    // ========================================================================

    let groundedPlan: any
    let phase2Time = 0

    if (config.skip_grounding) {
      requestLogger.debug({ phase: 2, skipped: true, reason: 'skip_grounding=true' }, 'Phase 2 skipped')
      groundedPlan = {
        ...semanticPlan,
        grounded: false,
        grounding_results: [],
        grounding_errors: [],
        validated_assumptions_count: 0,
        total_assumptions_count: semanticPlan.assumptions.length,
        grounding_confidence: 0,
        timestamp: new Date().toISOString()
      }
    } else if (dataSourceMetadata) {
      requestLogger.info({ phase: 2 }, 'Phase 2: Grounding started')
      const phase2Start = Date.now()

      const groundingEngine = new GroundingEngine()

      groundedPlan = await groundingEngine.ground({
        semantic_plan: semanticPlan,
        data_source_metadata: dataSourceMetadata,
        config: {
          min_confidence: config.grounding_min_confidence ?? 0.7,
          fail_fast: false
        }
      })

      phase2Time = Date.now() - phase2Start
      requestLogger.info({
        phase: 2,
        duration: phase2Time,
        validatedCount: groundedPlan.validated_assumptions_count,
        totalCount: groundedPlan.total_assumptions_count,
        groundingConfidence: groundedPlan.grounding_confidence
      }, 'Phase 2 complete')
    } else {
      requestLogger.debug({ phase: 2, skipped: true, reason: 'no data_source_metadata' }, 'Phase 2 skipped')
      groundedPlan = {
        ...semanticPlan,
        grounded: false,
        grounding_results: [],
        grounding_errors: [],
        validated_assumptions_count: 0,
        total_assumptions_count: semanticPlan.assumptions.length,
        grounding_confidence: 0,
        timestamp: new Date().toISOString()
      }
    }

    // ========================================================================
    // 5-LAYER AMBIGUITY DETECTION
    // ========================================================================

    requestLogger.info('5-Layer Ambiguity Detection started')
    const detectionStart = Date.now()

    const ambiguityReport = detectAmbiguities(semanticPlan as any, groundedPlan as any, body.enhanced_prompt)

    const detectionTime = Date.now() - detectionStart
    requestLogger.info({
      duration: detectionTime,
      mustConfirmCount: ambiguityReport.must_confirm.length,
      shouldReviewCount: ambiguityReport.should_review.length,
      looksGoodCount: ambiguityReport.looks_good.length,
      groundingAmbiguitiesCount: ambiguityReport.grounding_ambiguities.length,
      overallConfidence: ambiguityReport.overall_confidence
    }, '5-Layer Detection complete')

    // ========================================================================
    // Build Response
    // ========================================================================

    const totalTime = Date.now() - startTime

    // Warn if total time exceeds 5 seconds
    if (totalTime > 5000) {
      requestLogger.warn({
        duration: totalTime,
        phase1Time,
        phase2Time,
        detectionTime
      }, 'Slow request detected')
    }

    requestLogger.info({
      duration: totalTime,
      phase1Time,
      phase2Time,
      detectionTime
    }, 'Request completed')

    // Extract assumptions and edge cases for Review UI
    const assumptions = semanticPlan.assumptions || []
    const edgeCases = semanticPlan.understanding?.edge_cases || []

    const response = {
      success: true,

      // Phase 1 output
      semantic_plan: {
        goal: semanticPlan.goal,
        understanding: semanticPlan.understanding,
        assumptions: semanticPlan.assumptions,
        ambiguities: semanticPlan.ambiguities,
        inferences: semanticPlan.inferences,
        reasoning_trace: semanticPlan.reasoning_trace
      },

      // Phase 2 output
      grounded_plan: {
        ...groundedPlan,
        // Ensure grounding_results is always an array
        grounding_results: groundedPlan.grounding_results || [],
        grounding_errors: groundedPlan.grounding_errors || [],
        grounding_confidence: groundedPlan.grounding_confidence || 0
      },

      // 5-Layer Detection output
      ambiguity_report: ambiguityReport,

      // For Review UI sections
      assumptions: assumptions,
      edge_cases: edgeCases,

      // Metadata
      metadata: {
        phase_times_ms: {
          understanding: phase1Time,
          grounding: phase2Time,
          ambiguity_detection: detectionTime
        },
        total_time_ms: totalTime,
        provider,
        model: resolvedModel,
        services_involved: servicesInvolved
      }
    }

    // Debug log the full response before returning
    requestLogger.debug({ response }, 'Full API response')

    return NextResponse.json(response)

  } catch (error) {
    const duration = Date.now() - startTime
    requestLogger.error({ err: error, duration }, 'Request failed')

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate semantic grounded plan',
        details: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? errorStack : undefined
      },
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id'
    }
  })
}
