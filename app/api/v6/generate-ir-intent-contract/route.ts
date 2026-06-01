/**
 * V6 Pipeline A — IntentContract → DSL HTTP endpoint
 *
 * Exposes the regression-tested V6 pipeline (the path
 * `scripts/test-complete-pipeline-with-vocabulary.ts` exercises) over HTTP so
 * the V2 UI can use it.
 *
 * Phases:
 *   0. Plugin vocabulary extraction (deterministic)
 *   1. IntentContract generation (1 LLM call via `generateGenericIntentContractV1`)
 *   2. Capability binding (deterministic via `CapabilityBinderV2`)
 *   3. IR conversion to v4.0 (deterministic via `IntentToIRConverter`)
 *   4. PILOT DSL compilation (shared `ExecutionGraphCompiler` with Pipeline B)
 *
 * Returns the same response envelope as Pipeline B (`/api/v6/generate-ir-semantic`)
 * so the V2 UI's existing `mapV6ResponseToAgent` consumer works unchanged.
 * See `docs/v6/V6_PIPELINE_A_MIGRATION.md` for the full contract.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import { PluginVocabularyExtractor } from '@/lib/agentkit/v6/vocabulary/PluginVocabularyExtractor'
import { generateGenericIntentContractV1 } from '@/lib/agentkit/v6/intent/generate-intent'
import { CapabilityBinderV2 } from '@/lib/agentkit/v6/capability-binding/CapabilityBinderV2'
import { IntentToIRConverter } from '@/lib/agentkit/v6/compiler/IntentToIRConverter'
import { ExecutionGraphCompiler } from '@/lib/agentkit/v6/compiler/ExecutionGraphCompiler'

const logger = createLogger({ module: 'V6PipelineA' })

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })
  const startedAt = Date.now()

  // Mirror Pipeline B's header handling: trust pass-through, no auth enforcement.
  // The V2 UI sends x-user-id from authenticated client state.
  const userId = request.headers.get('x-user-id') || ''
  const sessionId = request.headers.get('x-session-id') || undefined
  const agentId = request.headers.get('x-agent-id') || undefined

  requestLogger.info({ userId, sessionId, agentId }, '[API] /api/v6/generate-ir-intent-contract - POST')

  try {
    const body = await request.json().catch(() => ({}))
    const enhancedPrompt = body?.enhanced_prompt
    const config = body?.config || {}

    if (!enhancedPrompt || typeof enhancedPrompt !== 'object') {
      return NextResponse.json(
        { success: false, error: 'enhanced_prompt required in request body' },
        { status: 400 }
      )
    }
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'x-user-id header required' },
        { status: 400 }
      )
    }

    const servicesInvolved: string[] = enhancedPrompt?.specifics?.services_involved || []
    requestLogger.info({ servicesInvolved }, '[API] Services involved from Enhanced Prompt')

    // ============================================================
    // Phase 0 — Vocabulary extraction (deterministic, cheap)
    // ============================================================
    const phase0Start = Date.now()
    const pluginManager = await PluginManagerV2.getInstance()
    const vocabularyExtractor = new PluginVocabularyExtractor(pluginManager)
    const vocabulary = await vocabularyExtractor.extract(userId, { servicesInvolved })
    // Inject resolved_user_inputs as user context so the IC prompt sees the
    // user's pre-supplied config values (spreadsheet_id, recipients, etc.)
    if (enhancedPrompt?.specifics?.resolved_user_inputs?.length) {
      vocabulary.userContext = enhancedPrompt.specifics.resolved_user_inputs
    }
    const phase0Time = Date.now() - phase0Start
    requestLogger.info(
      {
        phase0Time,
        domains: vocabulary.domains?.length,
        capabilities: vocabulary.capabilities?.length,
        plugins: vocabulary.plugins?.length
      },
      '[API] Phase 0 complete — vocabulary extracted'
    )

    // ============================================================
    // Phase 1 — IntentContract generation (1 LLM call)
    // ============================================================
    const phase1Start = Date.now()
    const icResult = await generateGenericIntentContractV1({ enhancedPrompt, vocabulary })
    const intentContract = icResult.intent
    const phase1Time = Date.now() - phase1Start
    requestLogger.info(
      {
        phase1Time,
        goal: intentContract?.goal,
        steps: Array.isArray(intentContract?.steps) ? intentContract.steps.length : 0,
        configKeys: Array.isArray(intentContract?.config) ? intentContract.config.length : 0
      },
      '[API] Phase 1 complete — IntentContract generated'
    )

    if (!intentContract || !Array.isArray(intentContract.steps)) {
      return NextResponse.json(
        {
          success: false,
          error: 'IntentContract generation produced invalid output',
          phase: 'intent_generation'
        },
        { status: 500 }
      )
    }

    // ============================================================
    // Phase 2 — Capability binding (deterministic)
    // ============================================================
    const phase2Start = Date.now()
    const binder = new CapabilityBinderV2(pluginManager)
    const boundIntent = await binder.bind(intentContract, userId)
    const phase2Time = Date.now() - phase2Start
    const bindingCounts = boundIntent.steps.reduce(
      (acc: { bound: number; unbound: number }, step: any) => {
        if (step?.plugin_key) acc.bound += 1
        else acc.unbound += 1
        return acc
      },
      { bound: 0, unbound: 0 }
    )
    requestLogger.info(
      { phase2Time, ...bindingCounts },
      '[API] Phase 2 complete — capability binding done'
    )

    // ============================================================
    // Phase 3 — IR conversion (deterministic, IR v4.0)
    // ============================================================
    const phase3Start = Date.now()
    const converter = new IntentToIRConverter(pluginManager)
    const conversionResult = converter.convert(boundIntent) // synchronous
    const phase3Time = Date.now() - phase3Start

    if (!conversionResult.success || !conversionResult.ir) {
      requestLogger.error(
        { errors: conversionResult.errors, warnings: conversionResult.warnings },
        '[API] Phase 3 failed — IR conversion'
      )
      return NextResponse.json(
        {
          success: false,
          error: 'IR conversion failed',
          details: process.env.NODE_ENV === 'development' ? conversionResult.errors : undefined,
          phase: 'ir_conversion'
        },
        { status: 500 }
      )
    }
    requestLogger.info(
      {
        phase3Time,
        nodes: Object.keys(conversionResult.ir.execution_graph?.nodes || {}).length,
        warnings: conversionResult.warnings?.length || 0
      },
      '[API] Phase 3 complete — IR v4.0 generated'
    )

    // ============================================================
    // Phase 4 — Compilation to PILOT DSL (shared with Pipeline B)
    // ============================================================
    const phase4Start = Date.now()
    const compiler = new ExecutionGraphCompiler(pluginManager)
    const compilationResult = await compiler.compile(conversionResult.ir)
    const phase4Time = Date.now() - phase4Start

    if (!compilationResult.success) {
      requestLogger.error(
        { errors: compilationResult.errors },
        '[API] Phase 4 failed — compilation'
      )
      return NextResponse.json(
        {
          success: false,
          error: 'Compilation failed',
          details: process.env.NODE_ENV === 'development' ? compilationResult.errors : undefined,
          phase: 'compilation'
        },
        { status: 500 }
      )
    }
    requestLogger.info(
      {
        phase4Time,
        steps: compilationResult.workflow.length,
        plugins: compilationResult.plugins_used?.length || 0
      },
      '[API] Phase 4 complete — PILOT DSL compiled'
    )

    // ============================================================
    // Response envelope — matches Pipeline B's shape so the V2 UI
    // consumer code (`mapV6ResponseToAgent`) works unchanged.
    // See docs/v6/V6_PIPELINE_A_MIGRATION.md § Response Contract.
    // ============================================================
    const totalTime = Date.now() - startedAt
    const responseBody: Record<string, any> = {
      success: true,
      workflow: {
        workflow_steps: compilationResult.workflow,
        suggested_plugins: compilationResult.plugins_used || []
      },
      validation: { valid: true, issues: [], autoFixed: false, issueCount: 0 },
      metadata: {
        architecture: 'intent_contract_pipeline_a',
        provider: config.provider || 'auto',
        model: 'auto', // generateGenericIntentContractV1 resolves model internally; not exposed
        total_time_ms: totalTime,
        phase_times_ms: {
          vocabulary: phase0Time,
          intent_generation: phase1Time,
          capability_binding: phase2Time,
          ir_conversion: phase3Time,
          compilation: phase4Time
        },
        grounding_confidence: null, // Pipeline A has no grounding phase; V2 UI falls back to 0.8
        steps_generated: compilationResult.workflow.length,
        plugins_used: compilationResult.plugins_used || []
      },
      pipeline_context: {
        semantic_plan: null,
        grounded_facts: null,
        formalization_metadata: null
      },
      ir: conversionResult.ir,

      // WP-55: expose Phase 1 + Phase 2 artifacts so the V2 UI can forward
      // them to /api/create-agent for persistence on agents.agent_config.
      // Enables post-hoc diagnosis of Phase 1 LLM emission variance without
      // a non-deterministic LLM re-run. See WP-55 in WEAK_POINTS.md.
      intent_contract: intentContract,
      data_schema: conversionResult.ir?.execution_graph?.data_schema ?? null
    }

    // V2 UI uses intermediate_results.semantic_plan.goal as a fallback for
    // agent_name/description when enhancedPromptData.plan_title is missing.
    // Pipeline A has no semantic_plan but IntentContract carries the same
    // information in its top-level `goal` field — bridge it.
    if (config.return_intermediate_results) {
      responseBody.intermediate_results = {
        semantic_plan: { goal: intentContract.goal }
      }
    }

    requestLogger.info(
      {
        totalTime,
        stepsGenerated: compilationResult.workflow.length
      },
      '[API] Pipeline A completed successfully'
    )
    return NextResponse.json(responseBody)
  } catch (error: any) {
    requestLogger.error({ err: error }, '[API] Pipeline A endpoint error')
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
        phase: 'unhandled'
      },
      { status: 500 }
    )
  }
}
