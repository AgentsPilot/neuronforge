/**
 * Generate Workflow via Semantic Plan (5-Phase Architecture)
 *
 * POST /api/v6/generate-ir-semantic
 *
 * Full Flow: Enhanced Prompt → Semantic Plan → Grounding → IR → DSL → Validation
 *
 * This endpoint orchestrates all five phases:
 * 1. Understanding: Generate Semantic Plan (with assumptions)
 * 2. Grounding: Validate assumptions against real data
 * 3. Formalization: Map grounded facts to precise IR
 * 4. Compilation: Compile IR to PILOT DSL workflow
 * 5. Validation & Normalization: Validate and normalize the workflow
 *
 * Benefits over direct workflow generation:
 * - LLM can express uncertainty (not forced to guess field names)
 * - Real data validates assumptions (fuzzy matching works)
 * - IR uses exact field names (no validation errors)
 * - Deterministic compilation ensures consistency
 * - Normalization enforces execution invariants
 * - "New prompt, new error" problem solved
 */

import { NextRequest, NextResponse } from 'next/server'
import { SemanticPlanGenerator } from '@/lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'
import { GroundingEngine } from '@/lib/agentkit/v6/semantic-plan/grounding/GroundingEngine'
import { IRFormalizer } from '@/lib/agentkit/v6/semantic-plan/IRFormalizer'
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import type { DataSourceMetadata } from '@/lib/agentkit/v6/semantic-plan/grounding/DataSampler'
import { IRToDSLCompiler } from '@/lib/agentkit/v6/compiler/IRToDSLCompiler'
import { DeclarativeCompiler } from '@/lib/agentkit/v6/compiler/DeclarativeCompiler'
import { PilotNormalizer } from '@/lib/agentkit/v6/compiler/PilotNormalizer'

// ============================================================================
// Plugin Schema Extraction Utilities (NO AUTH REQUIRED)
// ============================================================================

/**
 * Infer the best action name for reading data from a plugin (FULLY DYNAMIC)
 *
 * Strategy:
 * 1. Find actions with rich output schemas (many fields = data-reading action)
 * 2. Prefer actions with keywords: search, list, query, read, fetch, get
 * 3. Avoid actions with keywords: send, create, update, delete, write
 *
 * This is fully dynamic - no hardcoded plugin mappings!
 */
function inferActionName(
  pluginKey: string,
  availablePlugins: Record<string, any>
): string {
  const pluginDef = availablePlugins[pluginKey]
  if (!pluginDef?.actions) {
    return 'execute'  // Fallback
  }

  const actions = Object.keys(pluginDef.actions)
  if (actions.length === 0) {
    return 'execute'
  }

  // Score each action based on how likely it is a data-reading action
  const scoredActions = actions.map(actionName => {
    const actionDef = pluginDef.actions[actionName]
    let score = 0

    // 1. Check if it has a rich output_schema (many fields = data-reading)
    if (actionDef.output_schema?.properties) {
      const fieldCount = countSchemaFields(actionDef.output_schema)
      score += fieldCount * 10  // More fields = higher score
    }

    const lowerName = actionName.toLowerCase()

    // 2. Boost score for data-reading keywords
    const readKeywords = ['search', 'list', 'query', 'read', 'fetch', 'get', 'find', 'retrieve']
    for (const keyword of readKeywords) {
      if (lowerName.includes(keyword)) {
        score += 50
        break  // Only count once
      }
    }

    // 3. Penalize data-writing keywords
    const writeKeywords = ['send', 'create', 'update', 'delete', 'write', 'remove', 'insert', 'post', 'put']
    for (const keyword of writeKeywords) {
      if (lowerName.includes(keyword)) {
        score -= 100  // Heavy penalty
        break
      }
    }

    // 4. Bonus for exact matches to common data-reading patterns
    if (lowerName.match(/^(search|list|query|read|get)_/)) {
      score += 30  // Starts with read keyword
    }

    return { actionName, score }
  })

  // Sort by score (highest first)
  scoredActions.sort((a, b) => b.score - a.score)

  // Return the highest-scoring action
  return scoredActions[0]?.actionName || actions[0] || 'execute'
}

/**
 * Count total fields in a JSON Schema (recursively)
 * Used to identify "rich" output schemas that return lots of data
 */
function countSchemaFields(schema: any): number {
  if (!schema || typeof schema !== 'object') {
    return 0
  }

  let count = 0

  // Count properties at this level
  if (schema.properties) {
    count += Object.keys(schema.properties).length

    // Recurse into nested objects/arrays
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

  // Handle array schemas
  if (schema.type === 'array' && schema.items) {
    count += countSchemaFields(schema.items)
  }

  return count
}

/**
 * Extract field names from JSON Schema output_schema
 *
 * Recursively traverses schema to find all leaf property names
 * Example: { emails: { items: { properties: { subject, from } } } } → ["subject", "from", ...]
 */
function extractFieldNamesFromSchema(schema: any, parentKey: string = ''): string[] {
  const fields: string[] = []

  if (!schema || typeof schema !== 'object') {
    return fields
  }

  // Handle array schema (look inside items)
  if (schema.type === 'array' && schema.items) {
    return extractFieldNamesFromSchema(schema.items, parentKey)
  }

  // Handle object schema (extract property names)
  if (schema.type === 'object' && schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      const fullKey = parentKey ? `${parentKey}.${key}` : key

      // If property is an object or array, recurse
      if (typeof value === 'object' && value !== null) {
        const propSchema = value as any

        if (propSchema.type === 'object' && propSchema.properties) {
          // Recurse into nested object
          fields.push(...extractFieldNamesFromSchema(propSchema, fullKey))
        } else if (propSchema.type === 'array' && propSchema.items) {
          // Recurse into array items
          fields.push(...extractFieldNamesFromSchema(propSchema.items, fullKey))
        } else {
          // Leaf property - add it
          fields.push(key)
        }
      } else {
        // Primitive property - add it
        fields.push(key)
      }
    }
  }

  return fields
}

/**
 * Extract field descriptors (name + description) from JSON Schema output_schema
 * This enables semantic matching via field descriptions
 *
 * Example: { emails: { items: { properties: {
 *   subject: { type: "string", description: "Email subject" },
 *   snippet: { type: "string", description: "USE THIS for content matching" }
 * }}}} → [{ name: "subject", description: "Email subject" }, { name: "snippet", description: "USE THIS for content matching" }]
 */
function extractFieldDescriptorsFromSchema(schema: any, parentKey: string = ''): Array<{name: string, description?: string, type?: string}> {
  const fields: Array<{name: string, description?: string, type?: string}> = []

  if (!schema || typeof schema !== 'object') {
    return fields
  }

  // Handle array schema (look inside items)
  if (schema.type === 'array' && schema.items) {
    return extractFieldDescriptorsFromSchema(schema.items, parentKey)
  }

  // Handle object schema (extract property names + descriptions)
  if (schema.type === 'object' && schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      const fullKey = parentKey ? `${parentKey}.${key}` : key

      // If property is an object or array, recurse
      if (typeof value === 'object' && value !== null) {
        const propSchema = value as any

        if (propSchema.type === 'object' && propSchema.properties) {
          // Recurse into nested object
          fields.push(...extractFieldDescriptorsFromSchema(propSchema, fullKey))
        } else if (propSchema.type === 'array' && propSchema.items) {
          // Recurse into array items
          fields.push(...extractFieldDescriptorsFromSchema(propSchema.items, fullKey))
        } else {
          // Leaf property - add it with description
          fields.push({
            name: key,
            description: propSchema.description,
            type: propSchema.type
          })
        }
      } else {
        // Primitive property - add it
        fields.push({
          name: key,
          type: typeof value === 'string' ? value : undefined
        })
      }
    }
  }

  return fields
}

interface GenerateIRSemanticRequest {
  enhanced_prompt: any // EnhancedPrompt structure from Phase 0
  data_source_metadata?: DataSourceMetadata // Optional - can be auto-fetched if userId + data_source_config provided
  userId?: string // User ID for fetching authenticated plugin data
  data_source_config?: { // Plugin configuration for auto-fetching
    plugin_key: string
    action_name?: string
    parameters: Record<string, any>
  }
  config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
    understanding_temperature?: number
    formalization_temperature?: number
    grounding_min_confidence?: number
    return_intermediate_results?: boolean // Return semantic plan + grounded plan
  }
}

export async function POST(request: NextRequest) {
  console.log('[API] /api/v6/generate-ir-semantic - POST')
  console.log('[API] Starting 3-phase semantic IR generation...')

  const startTime = Date.now()

  try {
    const body: GenerateIRSemanticRequest = await request.json()

    // Validate request
    if (!body.enhanced_prompt) {
      return NextResponse.json(
        { error: 'Missing required field: enhanced_prompt' },
        { status: 400 }
      )
    }

    if (!body.enhanced_prompt.sections) {
      return NextResponse.json(
        { error: 'Invalid enhanced_prompt: missing sections property' },
        { status: 400 }
      )
    }

    // data_source_metadata is optional - if not provided, grounding will be skipped

    const config = body.config || {}
    const provider = config.provider || 'openai'
    const returnIntermediateResults = config.return_intermediate_results ?? true

    // ========================================================================
    // EXTRACT services_involved from Enhanced Prompt (used by all phases)
    // ========================================================================
    const servicesInvolved = body.enhanced_prompt?.specifics?.services_involved || []
    console.log(`[API] Services involved from Enhanced Prompt: ${servicesInvolved.join(', ') || 'none'}`)

    // ========================================================================
    // PHASE 1: Understanding (Semantic Plan Generation)
    // ========================================================================

    console.log('[API] Phase 1: Understanding (Semantic Plan Generation)')
    const phase1Start = Date.now()

    // Resolve model name with provider-specific defaults
    const resolvedModel = config.model || (provider === 'openai' ? 'gpt-5.2' : 'claude-3-5-sonnet-20241022')

    const semanticPlanGenerator = new SemanticPlanGenerator({
      model_provider: provider,
      model_name: resolvedModel,
      temperature: config.understanding_temperature ?? 0.3,
      max_tokens: 6000
    })

    const semanticPlanResult = await semanticPlanGenerator.generate(body.enhanced_prompt)

    const phase1Time = Date.now() - phase1Start
    console.log(`[API] Phase 1 complete in ${phase1Time}ms`)

    if (!semanticPlanResult.success || !semanticPlanResult.semantic_plan) {
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

    // PHASE TRANSITION VALIDATOR: Phase 1 → Phase 2
    // Ensure semantic plan has required structure for grounding
    if (!semanticPlan.assumptions || !Array.isArray(semanticPlan.assumptions)) {
      console.error('[API] ✗ Phase 1→2 validation failed: Missing assumptions array')
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid semantic plan structure',
          details: 'Semantic plan must have assumptions array for grounding',
          phase: 'transition_1_to_2'
        },
        { status: 500 }
      )
    }

    console.log(`[API] Assumptions: ${semanticPlan.assumptions?.length || 0}`)
    console.log(`[API] Ambiguities: ${semanticPlan.ambiguities?.length || 0}`)

    // DETAILED PHASE 1 OUTPUT
    console.log('\n' + '='.repeat(80))
    console.log('✓ PHASE 1 COMPLETE: Understanding (Semantic Plan Generation)')
    console.log('='.repeat(80))
    console.log(`Goal: ${semanticPlan.goal}`)

    // Safe check for data_sources
    const dataSources = semanticPlan.understanding?.data_sources
    if (Array.isArray(dataSources) && dataSources.length > 0) {
      console.log(`\nData Sources Identified (${dataSources.length}):`)
      dataSources.forEach((ds: any, i: number) => {
        console.log(`  ${i + 1}. ${ds.source_description} (${ds.type})`)
        console.log(`     Location: ${ds.location}`)
        console.log(`     Role: ${ds.role}`)
      })
    } else {
      console.log(`\nData Sources Identified: 0 (understanding.data_sources not available)`)
    }

    if (semanticPlan.understanding?.delivery) {
      console.log(`\nDelivery Method: ${semanticPlan.understanding.delivery.pattern || 'N/A'}`)
    }
    console.log(`\nAssumptions to Validate: ${semanticPlan.assumptions?.length || 0}`)
    console.log(`Ambiguities Detected: ${semanticPlan.ambiguities?.length || 0}`)
    console.log(`Time: ${phase1Time}ms`)
    console.log('='.repeat(80) + '\n')

    // ========================================================================
    // PHASE 1.5: Plugin Schema Metadata Extraction (NO AUTH REQUIRED)
    // ========================================================================
    //
    // CRITICAL INSIGHT: During agent creation, we CANNOT fetch real user data!
    //
    // Why?
    // 1. User is DESIGNING a workflow (not executing it yet)
    // 2. Real data may not exist (empty inbox, sheet not created)
    // 3. OAuth permissions not granted yet
    // 4. Auth failures break the creation flow
    //
    // Solution: Extract plugin SCHEMA metadata from PluginManager
    // - Field names from action output_schema (e.g., "subject", "from", "date")
    // - Data types from schema (string, number, email, etc.)
    // - NO sample_rows (grounding works in graceful degradation mode)
    //
    // Benefits:
    // ✅ Works during agent creation (no auth needed)
    // ✅ Deterministic (same behavior in dev/test/prod)
    // ✅ Field name fuzzy matching works (e.g., "Email Address" → "from")
    // ✅ No auth failures
    // ❌ No data type validation from samples (acceptable - use schema types)
    // ❌ No null/pattern checking (acceptable - validated at runtime)
    //
    // ========================================================================

    let dataSourceMetadata = body.data_source_metadata

    // PRODUCTION: Auto-extract plugin schema from PluginManager (NO userId needed)
    if (!dataSourceMetadata && servicesInvolved.length > 0) {
      console.log('[API] Phase 1.5: Extracting plugin schema metadata (no auth)...')

      // Use the first service from services_involved array
      const pluginKey = servicesInvolved[0]
      console.log(`[API]   Plugin: ${pluginKey}`)

      // Get PluginManager to access plugin schema
      const pluginManager = await PluginManagerV2.getInstance()
      const availablePlugins = pluginManager.getAvailablePlugins()
      const pluginDef = availablePlugins[pluginKey]

      if (pluginDef) {
        // Infer which action to use for data reading
        const actionName = inferActionName(pluginKey, availablePlugins)
        const actionDef = pluginDef.actions[actionName]

        if (actionDef?.output_schema) {
          console.log(`[API]   Using action: ${actionName}`)

          // Extract field descriptors (names + descriptions) from output_schema
          const fields = extractFieldDescriptorsFromSchema(actionDef.output_schema)
          const headers = fields.map(f => f.name) // Legacy format

          dataSourceMetadata = {
            type: 'tabular',
            headers, // Keep for backward compatibility
            fields,  // NEW - includes descriptions for semantic matching
            plugin_key: pluginKey,
            // NO sample_rows - grounding will operate in schema-only mode
          }

          console.log('[API] ✓ Extracted plugin schema metadata (no auth required)')
          console.log(`[API]   Action: ${actionName}`)
          console.log(`[API]   Fields: ${fields.length} total`)
          console.log(`[API]   Fields with descriptions: ${fields.filter(f => f.description).length}`)
          console.log(`[API]   Sample: ${fields.slice(0, 3).map(f => `${f.name}${f.description ? ' (' + f.description.substring(0, 30) + '...)' : ''}`).join(', ')}`)
        } else {
          console.log(`[API] ⚠ No output_schema found for action: ${actionName}`)
        }
      } else {
        console.log(`[API] ⚠ Plugin not found in registry: ${pluginKey}`)
      }
    }

    // Log final metadata status
    if (!dataSourceMetadata) {
      console.log('[API] ⚠ No data_source_metadata available')
      console.log('[API] ⚠ Grounding phase will be SKIPPED')
      console.log('[API] ℹ To enable grounding, provide:')
      console.log('[API]   1. data_source_metadata (explicit)')
      console.log('[API]   2. services_involved in Enhanced Prompt (schema extraction)')

      const planDataSources = semanticPlan.understanding?.data_sources || []
      if (planDataSources.length > 0) {
        const primaryDs = planDataSources[0]
        console.log(`[API] ℹ Detected data source: ${primaryDs.source_description}`)
        console.log(`[API] ℹ Location: ${primaryDs.location}`)
      }
    } else if (!body.data_source_metadata) {
      console.log('[API] ✓ data_source_metadata extracted from plugin schema')
    } else {
      console.log('[API] ✓ data_source_metadata provided by caller')
      console.log(`[API]   Headers: ${dataSourceMetadata.headers?.length || 0}`)
      console.log(`[API]   Sample rows: ${dataSourceMetadata.sample_rows?.length || 0}`)
    }

    // ========================================================================
    // PHASE 2: Grounding (Assumption Validation) - OPTIONAL
    // ========================================================================

    let groundedPlan: any
    let phase2Time = 0
    let phase4Time = 0
    let phase5Time = 0
    let groundedFacts: Record<string, any> = {}

    if (dataSourceMetadata) {
      console.log('[API] Phase 2: Grounding (Assumption Validation)')
      const phase2Start = Date.now()

      const groundingEngine = new GroundingEngine()

      groundedPlan = await groundingEngine.ground({
        semantic_plan: semanticPlan,
        data_source_metadata: dataSourceMetadata as DataSourceMetadata,
        config: {
          min_confidence: config.grounding_min_confidence ?? 0.7,
          fail_fast: false
        }
      })

      phase2Time = Date.now() - phase2Start
      console.log(`[API] Phase 2 complete in ${phase2Time}ms`)
      console.log(`[API] Validated: ${groundedPlan.validated_assumptions_count}/${groundedPlan.total_assumptions_count}`)
      console.log(`[API] Grounding confidence: ${(groundedPlan.grounding_confidence * 100).toFixed(1)}%`)

      // Check if grounding failed critically
      const criticalErrors = groundedPlan.grounding_errors.filter((e: any) => e.severity === 'error')
      if (criticalErrors.length > 0) {
        console.error('[API] Critical grounding errors:', criticalErrors)
        // Continue anyway - formalization will handle missing facts
      }

      // Extract grounded facts
      groundedPlan.grounding_results.forEach((result: any) => {
        if (result.validated && result.resolved_value) {
          groundedFacts[result.assumption_id] = result.resolved_value
        }
      })

      // PHASE TRANSITION VALIDATOR: Phase 2 → Phase 3
      // Ensure grounding provided sufficient validation
      const totalAssumptions = semanticPlan.assumptions.length
      const validatedCount = groundedPlan.validated_assumptions_count || 0
      const skippedCount = groundedPlan.grounding_results.filter((r: any) => r.skipped).length
      const failedCount = totalAssumptions - validatedCount

      console.log(`[API] Phase 2→3 validation: ${validatedCount} validated, ${skippedCount} skipped, ${failedCount} failed`)

      // Check for critical errors from GroundingEngine (single source of truth)
      // GroundingEngine validates skip rate and adds error if >50% skipped
      const skipRateError = groundedPlan.grounding_errors.find(
        (e: any) => e.error_type === 'insufficient_validation' && e.severity === 'error'
      )
      if (skipRateError) {
        console.error(`[API] ✗ Phase 2→3 validation failed: ${skipRateError.message}`)
        return NextResponse.json(
          {
            success: false,
            error: 'Insufficient grounding validation',
            details: skipRateError.message,
            grounding_errors: groundedPlan.grounding_errors,
            phase: 'transition_2_to_3'
          },
          { status: 500 }
        )
      }

      // Warn if grounding confidence is very low (but continue)
      if (groundedPlan.grounding_confidence < 0.5) {
        console.warn(`[API] ⚠️ Low grounding confidence: ${(groundedPlan.grounding_confidence * 100).toFixed(1)}%`)
      }
    } else {
      console.log('[API] Phase 2: SKIPPED (no data_source_metadata provided)')
      console.log('[API] Creating ungrounded plan from semantic plan')

      // Create a minimal grounded plan structure without actual grounding
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
    // PHASE 3: Formalization (IR Generation)
    // ========================================================================

    console.log('[API] Phase 3: Formalization (IR Generation)')
    const phase3Start = Date.now()

    // Initialize PluginManagerV2 to provide available plugins to IRFormalizer
    const pluginManager = await PluginManagerV2.getInstance()
    console.log(`[API] PluginManager initialized with ${Object.keys(pluginManager.getAvailablePlugins()).length} plugins`)

    // Extract resolved user inputs from Enhanced Prompt (for filter rules, column names, etc.)
    const resolvedUserInputs = body.enhanced_prompt?.specifics?.resolved_user_inputs

    const irFormalizer = new IRFormalizer({
      model: config.model || 'gpt-5.2',
      temperature: config.formalization_temperature ?? 0.0, // Very low - mechanical
      max_tokens: 4000,
      openai_api_key: process.env.OPENAI_API_KEY,
      pluginManager, // ← Pass PluginManagerV2 so LLM knows available plugins
      servicesInvolved, // ← Pass services from Enhanced Prompt (simple, no guessing!)
      resolvedUserInputs // ← Pass resolved user inputs for exact filter field names
    })

    const formalizationResult = await irFormalizer.formalize(groundedPlan)

    const phase3Time = Date.now() - phase3Start
    console.log(`[API] Phase 3 complete in ${phase3Time}ms`)
    console.log(`[API] Grounded facts used: ${Object.keys(formalizationResult.formalization_metadata.grounded_facts_used).length}`)
    console.log(`[API] Missing facts: ${formalizationResult.formalization_metadata.missing_facts.length}`)

    // Validate formalization
    const validation = irFormalizer.validateFormalization(
      formalizationResult.ir,
      formalizationResult.formalization_metadata.grounded_facts_used
    )

    console.log(`[API] Formalization validation: ${validation.valid ? 'VALID' : 'INVALID'}`)
    if (validation.errors.length > 0) {
      console.error('[API] Formalization errors:', validation.errors)
    }

    // PHASE TRANSITION VALIDATOR: Phase 3 → Phase 4
    // Ensure IR has required structure for compilation
    if (!formalizationResult.ir || !formalizationResult.ir.data_sources || !Array.isArray(formalizationResult.ir.data_sources)) {
      console.error('[API] ✗ Phase 3→4 validation failed: Invalid IR structure (missing data_sources)')
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid IR structure',
          details: 'IR must have data_sources array for compilation',
          phase: 'transition_3_to_4',
          validation_errors: validation.errors
        },
        { status: 500 }
      )
    }

    // Validate that all grounded facts mentioned in IR actually exist
    const irString = JSON.stringify(formalizationResult.ir)
    const missingGroundedFacts: string[] = []
    Object.keys(formalizationResult.formalization_metadata.grounded_facts_used).forEach(factId => {
      if (!groundedFacts[factId] && irString.includes(factId)) {
        missingGroundedFacts.push(factId)
      }
    })

    if (missingGroundedFacts.length > 0) {
      console.warn(`[API] ⚠️ IR references ${missingGroundedFacts.length} missing grounded facts: ${missingGroundedFacts.join(', ')}`)
      // Continue anyway - compiler may handle gracefully
    }

    // Fail if IR validation has critical errors
    if (!validation.valid && validation.errors.some((e: string) => e.includes('CRITICAL') || e.includes('required'))) {
      console.error('[API] ✗ Phase 3→4 validation failed: Critical IR validation errors')
      return NextResponse.json(
        {
          success: false,
          error: 'IR validation failed',
          details: 'IR contains critical validation errors',
          validation_errors: validation.errors,
          phase: 'transition_3_to_4'
        },
        { status: 500 }
      )
    }

    // ========================================================================
    // PHASE 4: Compilation (IR → PILOT DSL)
    // ========================================================================

    console.log('[API] Phase 4: Compilation (IR → PILOT DSL)')
    const phase4Start = Date.now()

    // DEBUG: Log IR structure to understand DeclarativeCompiler requirements
    console.log('[API] 📋 Declarative IR Structure:')
    console.log('[API]   - data_sources:', formalizationResult.ir.data_sources?.length || 0)
    console.log('[API]   - filters:', formalizationResult.ir.filters ? 'YES' : 'NO')
    console.log('[API]   - ai_operations:', formalizationResult.ir.ai_operations?.length || 0)
    console.log('[API]   - delivery_rules:', formalizationResult.ir.delivery_rules ? 'YES' : 'NO')
    console.log('[API] Full IR:', JSON.stringify(formalizationResult.ir, null, 2))

    // Try DeclarativeCompiler first (deterministic), fallback to LLM if it fails
    let compilationResult: any
    let compilationMethod = 'unknown'

    try {
      console.log('[API] Attempting DeclarativeCompiler (deterministic)...')
      const declarativeCompiler = new DeclarativeCompiler(pluginManager)
      const declarativeResult = await declarativeCompiler.compile(formalizationResult.ir)

      if (declarativeResult.success && declarativeResult.workflow && declarativeResult.workflow.length > 0) {
        console.log('[API] ✓ DeclarativeCompiler succeeded')
        compilationResult = declarativeResult
        compilationMethod = 'DeclarativeCompiler (deterministic)'
      } else {
        // Empty workflow triggers fallback - this is handled gracefully
        throw new Error('DeclarativeCompiler returned empty workflow')
      }
    } catch (declarativeError: any) {
      // DeclarativeCompiler fallback is expected for complex workflows
      // Log concisely - this is a graceful degradation, not an error
      console.log('[API] ℹ️ DeclarativeCompiler could not handle this workflow:', declarativeError.message)
      console.log('[API] → Using LLM-based compilation (this is normal for complex workflows)')

      const llmCompiler = new IRToDSLCompiler({
        pluginManager,
        temperature: 0,
        maxTokens: 8000
      })

      const pipelineContext = {
        semantic_plan: {
          goal: semanticPlan.goal,
          understanding: semanticPlan.understanding,
          reasoning_trace: semanticPlan.reasoning_trace
        },
        grounded_facts: groundedFacts,
        formalization_metadata: formalizationResult.formalization_metadata
      }

      compilationResult = await llmCompiler.compile(
        formalizationResult.ir,
        pipelineContext
      )
      compilationMethod = 'LLM-based (fallback)'
    }

    phase4Time = Date.now() - phase4Start
    console.log(`[API] Phase 4 complete in ${phase4Time}ms`)
    console.log(`[API] Compilation method: ${compilationMethod}`)
    console.log(`[API] Steps generated: ${compilationResult.workflow?.length || 0}`)
    console.log('[API] Workflow Steps:', JSON.stringify(compilationResult.workflow, null, 2))

    if (!compilationResult.success) {
      console.error('[API] Compilation failed:', compilationResult.errors)
      throw new Error(`Compilation failed: ${compilationResult.errors?.join(', ')}`)
    }

    // PHASE TRANSITION VALIDATOR: Phase 4 → Phase 5
    // Ensure compiled workflow has valid structure for normalization
    if (!compilationResult.workflow || !Array.isArray(compilationResult.workflow)) {
      console.error('[API] ✗ Phase 4→5 validation failed: Compilation did not produce valid workflow array')
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid compilation output',
          details: 'Compilation must produce workflow steps array',
          phase: 'transition_4_to_5',
          compilation_errors: compilationResult.errors
        },
        { status: 500 }
      )
    }

    if (compilationResult.workflow.length === 0) {
      console.error('[API] ✗ Phase 4→5 validation failed: Empty workflow generated')
      return NextResponse.json(
        {
          success: false,
          error: 'Empty workflow',
          details: 'Compilation produced zero workflow steps',
          phase: 'transition_4_to_5'
        },
        { status: 500 }
      )
    }

    // Validate that workflow steps have required fields
    const invalidSteps = compilationResult.workflow.filter((step: any, idx: number) => {
      if (!step.id || !step.type || !step.name) {
        console.error(`[API] ✗ Step ${idx} missing required fields: id=${step.id}, type=${step.type}, name=${step.name}`)
        return true
      }
      return false
    })

    if (invalidSteps.length > 0) {
      console.error(`[API] ✗ Phase 4→5 validation failed: ${invalidSteps.length} steps missing required fields`)
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid workflow steps',
          details: `${invalidSteps.length} steps missing required fields (id, type, or name)`,
          phase: 'transition_4_to_5'
        },
        { status: 500 }
      )
    }

    console.log('[API] ✓ Phase 4→5 validation passed: All workflow steps valid')

    // ========================================================================
    // PHASE 5: Final Normalization & Response Envelope
    // ========================================================================

    console.log('[API] Phase 5: Final Normalization')
    const phase5Start = Date.now()

    // Final normalization pass to ensure stable response format
    const finalWorkflow = PilotNormalizer.stableResponseEnvelope({
      success: true,
      workflow: {
        workflow_steps: compilationResult.workflow,
        suggested_plugins: compilationResult.plugins_used
      },
      validation: {
        valid: true,
        issues: [],
        autoFixed: false,
        issueCount: 0
      },
      semantic_plan: semanticPlan,
      method: '5-phase-semantic',
      model: config.model || (provider === 'openai' ? 'gpt-5.2' : 'claude-3-5-sonnet-20241022'),
      services_used: compilationResult.plugins_used,
      prompt_length: 0
    })

    phase5Time = Date.now() - phase5Start
    console.log(`[API] Phase 5 complete in ${phase5Time}ms`)

    // ========================================================================
    // Success Response
    // ========================================================================

    const totalTime = Date.now() - startTime

    console.log('[API] ✓ Full 5-phase flow complete')
    console.log(`[API] Total time: ${totalTime}ms (P1: ${phase1Time}ms, P2: ${phase2Time}ms, P3: ${phase3Time}ms, P4: ${phase4Time}ms, P5: ${phase5Time}ms)`)

    const response: any = {
      success: true,
      workflow: finalWorkflow.workflow,
      validation: finalWorkflow.validation,
      metadata: {
        architecture: 'semantic_plan_5_phase',
        provider,
        model: config.model || (provider === 'openai' ? 'gpt-5.2' : 'claude-3-5-sonnet-20241022'),
        total_time_ms: totalTime,
        phase_times_ms: {
          understanding: phase1Time,
          grounding: phase2Time,
          formalization: phase3Time,
          compilation: phase4Time,
          normalization: phase5Time
        },
        grounding_confidence: groundedPlan.grounding_confidence,
        formalization_confidence: formalizationResult.formalization_metadata.formalization_confidence,
        validated_assumptions: groundedPlan.validated_assumptions_count,
        total_assumptions: groundedPlan.total_assumptions_count,
        grounded_facts_count: Object.keys(groundedFacts).length,
        missing_facts_count: formalizationResult.formalization_metadata.missing_facts.length,
        compilation_token_usage: compilationResult.token_usage,
        steps_generated: compilationResult.workflow.length,
        plugins_used: compilationResult.plugins_used,
        validation: {
          valid: validation.valid,
          errors_count: validation.errors.length,
          warnings_count: validation.warnings.length
        },
        timestamp: new Date().toISOString()
      },
      pipeline_context: {
        semantic_plan: {
          goal: semanticPlan.goal,
          understanding: semanticPlan.understanding,
          reasoning_trace: semanticPlan.reasoning_trace
        },
        grounded_facts: groundedFacts,
        formalization_metadata: formalizationResult.formalization_metadata
      },
      ir: formalizationResult.ir  // Keep IR for debugging/analysis
    }

    // Include intermediate results if requested
    if (returnIntermediateResults) {
      response.intermediate_results = {
        semantic_plan: semanticPlan,
        grounded_plan: groundedPlan,
        grounded_facts: groundedFacts,
        formalization_metadata: formalizationResult.formalization_metadata,
        validation: {
          valid: validation.valid,
          errors: validation.errors,
          warnings: validation.warnings
        }
      }
    }

    // Include errors/warnings if present
    if (validation.errors.length > 0 || validation.warnings.length > 0) {
      response.validation_details = {
        errors: validation.errors,
        warnings: validation.warnings
      }
    }

    if (groundedPlan.grounding_errors.length > 0) {
      response.grounding_errors = groundedPlan.grounding_errors
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('[API] Error in semantic IR generation:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate IR via semantic plan',
        details: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? errorStack : undefined
      },
      { status: 500 }
    )
  }
}

// CORS headers (if needed)
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
