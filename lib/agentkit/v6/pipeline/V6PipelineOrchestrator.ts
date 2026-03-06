/**
 * V6 Pipeline Orchestrator with Validation Gates
 *
 * Following OpenAI's compiler approach:
 * Each phase has a validation gate that ensures requirements are preserved.
 *
 * Pipeline Flow:
 * Enhanced Prompt → [Extract Hard Requirements]
 *   → Semantic Plan → [Gate 1]
 *   → Grounding → [Gate 2]
 *   → IR → [Gate 3]
 *   → Compilation → [Gate 4]
 *   → Final Validation → [Gate 5]
 *   → PASS or FAIL
 */

import { SemanticPlanGenerator, type EnhancedPrompt } from '../semantic-plan/SemanticPlanGenerator'
import { IRFormalizer } from '../semantic-plan/IRFormalizer'
import { ExecutionGraphCompiler } from '../compiler/ExecutionGraphCompiler'
import type { DeclarativeLogicalIRv4 } from '../logical-ir/schemas/declarative-ir-types-v4'
import type { WorkflowDataSchema } from '../logical-ir/schemas/workflow-data-schema'
import {
  HardRequirementsExtractor,
  HardRequirements,
  RequirementMap,
  GateResult,
  ValidationGates
} from '../requirements'
import { AutoRecoveryHandler } from '../requirements/AutoRecoveryHandler'
import { createLogger } from '@/lib/logger'
import * as fs from 'fs'
import * as path from 'path'
import { PluginManagerV2 } from '../../../server/plugin-manager-v2'
import { getAgentGenerationConfig } from '../config/AgentGenerationConfigService'

const moduleLogger = createLogger({ module: 'V6', service: 'PipelineOrchestrator' })

export interface PipelineConfig {
  provider?: 'openai' | 'anthropic'
  model?: string
  temperature?: number
  max_tokens?: number
  openai_api_key?: string
  anthropic_api_key?: string
}

export interface PipelineResult {
  success: boolean
  workflow?: any
  hardRequirements?: HardRequirements
  requirementMap?: RequirementMap
  /** Workflow Data Schema extracted from IR (Phase 5 Addendum) */
  data_schema?: WorkflowDataSchema
  validationResults?: {
    semantic: GateResult
    grounding: GateResult
    ir: GateResult
    compilation: GateResult
    final: GateResult
  }
  // Intermediate phase outputs for debugging
  semanticPlan?: any
  groundedPlan?: any
  ir?: any
  dslBeforeTranslation?: any
  // Compilation logs (warnings, detections, etc.)
  compilationLogs?: string[]
  compilationErrors?: string[]
  error?: {
    phase: string
    message: string
    gate?: GateResult
  }
}

/**
 * V6 Pipeline Orchestrator
 *
 * Manages the full workflow generation pipeline with validation gates at each phase
 */
export class V6PipelineOrchestrator {
  private recovery: AutoRecoveryHandler

  constructor() {
    this.recovery = new AutoRecoveryHandler()
  }

  /**
   * Run full pipeline with validation gates
   */
  async run(
    enhancedPrompt: EnhancedPrompt,
    config?: PipelineConfig
  ): Promise<PipelineResult> {
    const logger = moduleLogger.child({ method: 'run' })
    logger.info({ msg: 'Starting pipeline with validation gates' })

    // Load admin configuration (cached, 5-minute TTL)
    const adminConfig = await getAgentGenerationConfig()

    // Initialize PluginManager and ValidationGates
    const pluginManager = await PluginManagerV2.getInstance()
    const gates = new ValidationGates(pluginManager)

    // Initialize variables outside try block for error handling
    let hardReqs: HardRequirements | undefined
    let requirementMap: RequirementMap | undefined

    try {
      // Phase 0: Extract Hard Requirements
      logger.info({ phase: 0, msg: 'Extracting hard requirements' })

      try {
        // Initialize extractor with admin config
        const requirementsConfig = {
          provider: config?.provider || adminConfig.requirements.provider,
          model: config?.model || adminConfig.requirements.model,
          temperature: config?.temperature ?? adminConfig.requirements.temperature
        }

        const extractor = new HardRequirementsExtractor(requirementsConfig)
        hardReqs = await extractor.extract(enhancedPrompt)
        requirementMap = extractor.createRequirementMap(hardReqs)
      } catch (error) {
        logger.error({
          phase: 0,
          error: error instanceof Error ? error.message : String(error),
          msg: 'Hard requirements extraction failed'
        })
        return {
          success: false,
          error: {
            phase: 'requirements_extraction',
            message: error instanceof Error ? error.message : 'Hard requirements extraction failed'
          }
        }
      }

      logger.info({
        phase: 0,
        requirementsCount: hardReqs.requirements.length,
        unitOfWork: hardReqs.unit_of_work || 'none',
        thresholds: hardReqs.thresholds.length,
        invariants: hardReqs.invariants.length,
        msg: 'Hard requirements extracted'
      })

      /* PHASES 1 & 2 SKIPPED - ENHANCED PROMPT HAS ALL NEEDED INFO
       *
       * Phase 1 (Semantic Plan) and Phase 2 (Grounding) are commented out.
       * These phases just rephrase what's already in Enhanced Prompt:
       * - sections.data, actions, output, delivery already provide semantic understanding
       * - Grounding is mocked for API workflows (returns empty data)
       *
       * We now pass Enhanced Prompt DIRECTLY to Phase 3 (IR Formalization).
       * This eliminates ~3500 tokens of noise and 15-30 seconds of LLM time.
       *
       * IMPORTANT: Do NOT delete this code until we achieve "golden gate" (90%+ success)!
       *
      // Phase 1: Generate Semantic Plan
      logger.info({ phase: 1, msg: 'Generating semantic plan' })

      let semanticPlan: any
      try {
        // Map PipelineConfig to SemanticPlanConfig
        // Priority: user config > admin config > hardcoded defaults
        const semanticConfig = {
          model_provider: config?.provider || adminConfig.semantic.provider,
          model_name: config?.model || adminConfig.semantic.model,
          temperature: config?.temperature ?? adminConfig.semantic.temperature,
          max_tokens: config?.max_tokens
        }

        const semanticGenerator = new SemanticPlanGenerator(semanticConfig)
        const semanticPlanResult = await semanticGenerator.generate(enhancedPrompt, hardReqs)

        if (!semanticPlanResult.success || !semanticPlanResult.semantic_plan) {
          logger.error({
            phase: 1,
            errors: semanticPlanResult.errors,
            msg: 'Semantic plan generation failed'
          })
          return {
            success: false,
            hardRequirements: hardReqs,
            requirementMap,
            error: {
              phase: 'semantic',
              message: semanticPlanResult.errors?.join(', ') || 'Semantic plan generation failed'
            }
          }
        }

        semanticPlan = semanticPlanResult.semantic_plan
      } catch (error) {
        logger.error({
          phase: 1,
          error: error instanceof Error ? error.message : String(error),
          msg: 'Semantic plan generation threw error'
        })
        return {
          success: false,
          hardRequirements: hardReqs,
          requirementMap,
          error: {
            phase: 'semantic',
            message: error instanceof Error ? error.message : 'Semantic plan generation threw error'
          }
        }
      }

      // Gate 1: Validate Semantic Plan
      logger.info({ gate: 1, msg: 'Validating semantic plan' })
      const semanticGate = gates.validateSemanticPlan(
        semanticPlan,
        hardReqs,
        requirementMap
      )

      if (semanticGate.result === 'FAIL') {
        logger.error({
          gate: 1,
          result: 'FAIL',
          reason: semanticGate.reason,
          unmappedRequirements: semanticGate.unmapped_requirements,
          msg: 'Semantic validation failed'
        })

        return {
          success: false,
          hardRequirements: hardReqs,
          requirementMap,
          error: {
            phase: 'semantic',
            message: semanticGate.reason || 'Semantic validation failed',
            gate: semanticGate
          }
        }
      }

      const mappedCount = Object.values(requirementMap).filter(r => r.status === 'mapped').length
      logger.info({
        gate: 1,
        result: 'PASS',
        mappedCount,
        totalRequirements: hardReqs.requirements.length,
        msg: 'Semantic plan validated'
      })

      // Phase 2: Grounding (optional - may not exist in all pipelines)
      logger.info({ phase: 2, msg: 'Grounding (skipping for API workflows)' })
      // Create mock grounded plan from semantic plan
      const groundedPlan = {
        ...semanticPlan,
        grounded: true,
        grounding_results: [],
        grounding_errors: [],
        grounding_confidence: 1.0,
        grounding_timestamp: new Date().toISOString()
      } as any // For now, use mock grounded plan

      // Gate 2: Validate Grounding
      logger.info({ gate: 2, msg: 'Validating grounding' })
      const groundingGate = gates.validateGrounding(
        groundedPlan,
        hardReqs,
        requirementMap
      )

      if (groundingGate.result === 'FAIL') {
        logger.error({
          gate: 2,
          result: 'FAIL',
          reason: groundingGate.reason,
          msg: 'Grounding validation failed'
        })

        return {
          success: false,
          hardRequirements: hardReqs,
          requirementMap,
          error: {
            phase: 'grounding',
            message: groundingGate.reason || 'Grounding validation failed',
            gate: groundingGate
          }
        }
      }

      logger.info({ gate: 2, result: 'PASS', msg: 'Grounding validated' })
      */

      // Phase 3: Generate IR (NOW USES ENHANCED PROMPT DIRECTLY)
      logger.info({ phase: 3, msg: 'Formalizing to IR' })

      let ir: DeclarativeLogicalIRv4
      try {
        // Extract services_involved from Enhanced Prompt for plugin optimization
        const servicesInvolved = enhancedPrompt.specifics?.services_involved || []

        // Map PipelineConfig to IRFormalizerConfig
        // Priority: user config > admin config > hardcoded defaults
        const irConfig = {
          model: config?.model || adminConfig.formalization.model,
          model_provider: config?.provider || adminConfig.formalization.provider,
          temperature: config?.temperature ?? adminConfig.formalization.temperature,
          max_tokens: config?.max_tokens,
          openai_api_key: config?.openai_api_key || process.env.OPENAI_API_KEY,
          anthropic_api_key: config?.anthropic_api_key || process.env.ANTHROPIC_API_KEY,
          pluginManager: pluginManager,  // Pass pluginManager for parameter validation
          servicesInvolved: servicesInvolved,  // Pass filtered plugin list for token optimization
          resolvedUserInputs: enhancedPrompt.specifics?.resolved_user_inputs || [],  // CRITICAL: Pass resolved inputs for literal value injection
          enhancedPrompt: enhancedPrompt  // Pass full Enhanced Prompt for sections (data, actions, output, delivery)
        }

        // Log token optimization metrics
        if (servicesInvolved.length > 0 && pluginManager) {
          const totalPlugins = pluginManager.getAvailablePlugins()
          const totalCount = Object.keys(totalPlugins).length
          const savings = (totalCount - servicesInvolved.length) * 800  // ~800 tokens per plugin
          logger.info({
            phase: 3,
            totalPlugins: totalCount,
            filteredPlugins: servicesInvolved.length,
            pluginList: servicesInvolved,
            estimatedTokenSavings: savings,
            savingsPercentage: Math.round((savings / (totalCount * 800)) * 100),
            msg: 'Using filtered plugin list from Enhanced Prompt (token optimization)'
          })
        }

        const formalizer = new IRFormalizer(irConfig)
        // Pass Enhanced Prompt directly (skip Phase 1 & 2 rephrasing)
        const formalizationResult = await formalizer.formalize(enhancedPrompt, hardReqs)

        if (!formalizationResult.ir) {
          logger.error({ phase: 3, msg: 'IR formalization failed - no IR generated' })
          return {
            success: false,
            hardRequirements: hardReqs,
            requirementMap,
            error: {
              phase: 'ir',
              message: 'IR formalization failed - no IR generated'
            }
          }
        }

        ir = formalizationResult.ir as DeclarativeLogicalIRv4

        // Verify execution_graph exists (V4 IR requirement)
        if (!ir.execution_graph || !ir.execution_graph.nodes || Object.keys(ir.execution_graph.nodes).length === 0) {
          logger.error({ phase: 3, msg: 'IR formalization failed - execution_graph missing or empty' })
          return {
            success: false,
            hardRequirements: hardReqs,
            requirementMap,
            error: {
              phase: 'ir',
              message: 'IR formalization failed - execution_graph missing or empty'
            }
          }
        }
      } catch (error) {
        logger.error({
          phase: 3,
          error: error instanceof Error ? error.message : String(error),
          msg: 'IR formalization threw error'
        })
        // RETHROW so provider fallback can retry
        throw error
      }

      // === TRACE DUMP: Phase 3 IR output ===
      try {
        const traceDir = path.resolve(process.cwd(), 'dev-traces')
        if (!fs.existsSync(traceDir)) fs.mkdirSync(traceDir, { recursive: true })
        fs.writeFileSync(
          path.join(traceDir, 'phase3-ir.json'),
          JSON.stringify(ir, null, 2),
          'utf-8'
        )
        logger.info({ phase: 3, msg: '[TRACE] Phase 3 IR dumped to dev-traces/phase3-ir.json' })
      } catch (traceErr) {
        logger.warn({ msg: '[TRACE] Failed to write Phase 3 trace', error: String(traceErr) })
      }

      // WEEK 1 FIX: Update requirement map from IR's embedded enforcement tracking
      // Since we skip Phases 1 & 2, the requirement map never gets updated
      // But the IR has requirements_enforcement tracking - use that instead!
      if (ir.requirements_enforcement && requirementMap) {
        ir.requirements_enforcement.forEach(enforcement => {
          if (requirementMap![enforcement.requirement_id]) {
            requirementMap![enforcement.requirement_id].status = enforcement.validation_passed ? 'compiled' : 'pending'
            requirementMap![enforcement.requirement_id].ir_node = enforcement.enforced_by.node_ids.join(', ')
          }
        })
        logger.info({
          updatedRequirements: ir.requirements_enforcement.length,
          msg: 'Updated requirement map from IR enforcement tracking (Week 1 fix for skipped phases)'
        })
      }

      // Gate 3: Validate IR
      logger.info({ gate: 3, msg: 'Validating IR' })
      let irGate = gates.validateIR(ir, hardReqs, requirementMap)

      // Auto-recovery if validation fails
      if (irGate.result === 'FAIL') {
        logger.warn({
          gate: 3,
          result: 'FAIL',
          violatedConstraints: irGate.violated_constraints,
          msg: 'IR validation failed, attempting auto-recovery'
        })

        // Create validation errors from gate result
        const errors = (irGate.violated_constraints || []).map(constraint => ({
          type: 'nested_groups' as const,
          message: constraint,
          severity: 'error' as const
        }))

        // Attempt recovery
        const recoveryResult = this.recovery.recover('ir', ir, errors)

        if (!recoveryResult.stillFailing && recoveryResult.output) {
          logger.info({ msg: 'Auto-recovery successful, re-validating IR' })
          ir = recoveryResult.output

          // Re-validate after recovery
          irGate = gates.validateIR(ir, hardReqs, requirementMap)

          if (irGate.result === 'PASS') {
            logger.info({ gate: 3, result: 'PASS', msg: 'IR validated after auto-recovery' })
          }
        }

        // If still failing after recovery, return error
        if (irGate.result === 'FAIL') {
          logger.error({
            gate: 3,
            result: 'FAIL',
            reason: irGate.reason,
            msg: 'IR validation failed after recovery attempt'
          })

          return {
            success: false,
            hardRequirements: hardReqs,
            requirementMap,
            error: {
              phase: 'ir',
              message: irGate.reason || 'IR validation failed',
              gate: irGate
            }
          }
        }
      }

      const compiledCount = Object.values(requirementMap).filter(r => r.status === 'compiled').length
      logger.info({
        gate: 3,
        result: 'PASS',
        compiledCount,
        totalRequirements: hardReqs.requirements.length,
        msg: 'IR validated'
      })

      // Phase 4: Compile to DSL using ExecutionGraphCompiler (V4)
      logger.info({ phase: 4, msg: 'Compiling to DSL' })

      let dsl: any
      let compilationResult: any
      try {
        const compiler = new ExecutionGraphCompiler(pluginManager)
        compilationResult = await compiler.compile(ir, hardReqs)

        if (!compilationResult.success) {
          logger.error({
            phase: 4,
            errors: compilationResult.errors,
            msg: 'DSL compilation failed'
          })
          return {
            success: false,
            hardRequirements: hardReqs,
            requirementMap,
            error: {
              phase: 'compilation',
              message: compilationResult.errors?.join(', ') || 'DSL compilation failed'
            }
          }
        }

        dsl = compilationResult.workflow

        // === TRACE DUMP: Phase 4 compiled workflow ===
        try {
          const traceDir = path.resolve(process.cwd(), 'dev-traces')
          if (!fs.existsSync(traceDir)) fs.mkdirSync(traceDir, { recursive: true })
          fs.writeFileSync(
            path.join(traceDir, 'phase4-compiled.json'),
            JSON.stringify({
              workflow: compilationResult.workflow,
              logs: compilationResult.logs,
              plugins_used: compilationResult.plugins_used,
              compilation_time_ms: compilationResult.compilation_time_ms
            }, null, 2),
            'utf-8'
          )
          logger.info({ phase: 4, msg: '[TRACE] Phase 4 compiled workflow dumped to dev-traces/phase4-compiled.json' })
        } catch (traceErr) {
          logger.warn({ msg: '[TRACE] Failed to write Phase 4 trace', error: String(traceErr) })
        }
      } catch (error) {
        logger.error({
          phase: 4,
          error: error instanceof Error ? error.message : String(error),
          msg: 'DSL compilation threw error'
        })
        return {
          success: false,
          hardRequirements: hardReqs,
          requirementMap,
          error: {
            phase: 'compilation',
            message: error instanceof Error ? error.message : 'DSL compilation threw error'
          }
        }
      }

      // Gate 4: Validate Compilation
      logger.info({ gate: 4, msg: 'Validating compilation' })
      const compilationGate = gates.validateCompilation(
        compilationResult.workflow,
        hardReqs,
        requirementMap
      )

      if (compilationGate.result === 'FAIL') {
        logger.error({
          gate: 4,
          result: 'FAIL',
          reason: compilationGate.reason,
          msg: 'Compilation validation failed'
        })

        return {
          success: false,
          hardRequirements: hardReqs,
          requirementMap,
          error: {
            phase: 'compilation',
            message: compilationGate.reason || 'Compilation validation failed',
            gate: compilationGate
          }
        }
      }

      const enforcedCount = Object.values(requirementMap).filter(r => r.status === 'enforced').length
      logger.info({
        gate: 4,
        result: 'PASS',
        enforcedCount,
        totalRequirements: hardReqs.requirements.length,
        msg: 'Compilation validated'
      })

      // Phase 5: Translate DSL to PILOT format
      logger.info({ phase: 5, msg: 'Translating DSL to PILOT format' })
      dsl = this.translateToPilotFormat(dsl)
      logger.info({ phase: 5, stepCount: dsl.length, msg: 'Translation complete' })

      // === TRACE DUMP: Phase 5 PILOT-format steps ===
      try {
        const traceDir = path.resolve(process.cwd(), 'dev-traces')
        if (!fs.existsSync(traceDir)) fs.mkdirSync(traceDir, { recursive: true })
        fs.writeFileSync(
          path.join(traceDir, 'phase5-pilot.json'),
          JSON.stringify(dsl, null, 2),
          'utf-8'
        )
        logger.info({ phase: 5, msg: '[TRACE] Phase 5 PILOT steps dumped to dev-traces/phase5-pilot.json' })
      } catch (traceErr) {
        logger.warn({ msg: '[TRACE] Failed to write Phase 5 trace', error: String(traceErr) })
      }

      // Gate 5: Final Validation (Intent Satisfaction)
      logger.info({ gate: 5, msg: 'Final validation (intent satisfaction)' })
      const finalGate = gates.validateFinal(
        dsl || [],
        hardReqs,
        requirementMap
      )

      if (finalGate.result === 'FAIL') {
        logger.error({
          gate: 5,
          result: 'FAIL',
          reason: finalGate.reason,
          msg: 'Final validation failed - workflow could do the wrong thing!'
        })

        return {
          success: false,
          hardRequirements: hardReqs,
          requirementMap,
          error: {
            phase: 'final_validation',
            message: finalGate.reason || 'Workflow violates intent',
            gate: finalGate
          }
        }
      }

      logger.info({ gate: 5, result: 'PASS', msg: 'Final validation passed - all requirements enforced, workflow is correct' })

      // WEEK 1: Phases 1 & 2 skipped - create dummy gate results
      const semanticGate: GateResult = { stage: 'semantic', result: 'PASS', reason: 'SKIPPED (Week 1: Enhanced Prompt used directly)' }
      const groundingGate: GateResult = { stage: 'grounding', result: 'PASS', reason: 'SKIPPED (Week 1: Grounding not needed for API workflows)' }

      return {
        success: true,
        workflow: dsl,
        hardRequirements: hardReqs,
        requirementMap,
        // Extract data_schema from IR to top level (Phase 5 Addendum: plumbing)
        data_schema: ir.execution_graph?.data_schema,
        validationResults: {
          semantic: semanticGate,
          grounding: groundingGate,
          ir: irGate,
          compilation: compilationGate,
          final: finalGate
        },
        // Include intermediate outputs for debugging (Phases 1 & 2 skipped)
        semanticPlan: undefined,
        groundedPlan: undefined,
        ir,
        dslBeforeTranslation: compilationResult.workflow,
        // Include compilation logs for diagnostics
        compilationLogs: compilationResult.logs,
        compilationErrors: compilationResult.errors
      }
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        msg: 'Pipeline execution error'
      })

      return {
        success: false,
        hardRequirements: hardReqs,
        requirementMap,
        error: {
          phase: 'unknown',
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    }
  }

  /**
   * Get lineage trace for debugging
   * Shows how each requirement flows through the pipeline
   */
  getLineageTrace(requirementMap: RequirementMap, hardReqs: HardRequirements): any[] {
    return hardReqs.requirements.map(req => {
      const mapping = requirementMap[req.id]

      return {
        id: req.id,
        type: req.type,
        constraint: req.constraint,
        source: req.source,
        status: mapping?.status || 'unmapped',
        semantic_construct: mapping?.semantic_construct || null,
        grounded_capability: mapping?.grounded_capability || null,
        ir_node: mapping?.ir_node || null,
        dsl_step: mapping?.dsl_step || null
      }
    })
  }

  /**
   * Translate V6 DSL format to PILOT format
   * Converts step_id -> id, adds name field, restructures config
   */
  private translateToPilotFormat(dslSteps: any[]): any[] {
    return dslSteps.map((step, index) => this.translateStep(step, index))
  }

  /**
   * Translate a single DSL step to PILOT format
   */
  private translateStep(dslStep: any, index: number): any {
    const pilotStep: any = {
      id: dslStep.step_id?.replace(/_/g, '') || `step${index + 1}`,
      step_id: dslStep.step_id?.replace(/_/g, '') || `step${index + 1}`,  // Keep step_id for compatibility
      name: this.generateStepName(dslStep),
      type: dslStep.type
    }

    // Copy output_variable if present
    if (dslStep.output_variable) {
      pilotStep.output_variable = dslStep.output_variable
    }

    // Copy description if present
    if (dslStep.description) {
      pilotStep.description = dslStep.description
    }

    // Pass through schema fields (Phase 5: Workflow Data Schema)
    if (dslStep.output_schema) {
      pilotStep.output_schema = dslStep.output_schema
    }
    if (dslStep.input_schema) {
      pilotStep.input_schema = dslStep.input_schema
    }

    // Handle action steps
    if (dslStep.type === 'action') {
      pilotStep.plugin = dslStep.plugin
      pilotStep.action = dslStep.operation
      pilotStep.params = dslStep.config || {}
    }

    // Handle transform steps
    else if (dslStep.type === 'transform') {
      // Get operation from top level first, fallback to config
      const transformType = dslStep.operation || dslStep.config?.transform_type || dslStep.config?.type
      pilotStep.operation = transformType

      // Extract input from various possible locations and move to top level
      // DSL may have: dslStep.input, config.input, config.config.source, config.source
      const inputValue = dslStep.input ||
                        dslStep.config?.input ||
                        dslStep.config?.config?.source ||
                        dslStep.config?.source
      if (inputValue) {
        pilotStep.input = inputValue
      }

      // For filter transforms - extract the filters config
      if (transformType === 'filter' && (dslStep.config?.filters || dslStep.config?.config?.filters)) {
        const filters = dslStep.config?.filters || dslStep.config?.config?.filters
        pilotStep.config = { condition: filters }
      }
      // For map transforms
      else if (transformType === 'map' && dslStep.config?.config?.mapping) {
        pilotStep.config = { mapping: dslStep.config.config.mapping }
      }
      // For other transforms - copy config but remove 'input' and 'source' to avoid duplication
      else if (dslStep.config?.config) {
        const { input, source, ...restConfig } = dslStep.config.config
        pilotStep.config = restConfig
      } else if (dslStep.config) {
        const { input, source, type, transform_type, ...restConfig } = dslStep.config
        pilotStep.config = restConfig
      }
    }

    // Handle AI processing steps
    else if (dslStep.type === 'ai_processing') {
      // Read from top level (where ExecutionGraphCompiler puts them)
      pilotStep.input = dslStep.input
      pilotStep.prompt = dslStep.prompt

      // Copy config object (model is determined by runtime routing, not hardcoded)
      if (dslStep.config) {
        pilotStep.config = {
          ai_type: dslStep.config.ai_type,
          output_schema: dslStep.config.output_schema,
          temperature: dslStep.config.temperature
        }
      }
    }

    // Handle scatter_gather (loop) steps
    else if (dslStep.type === 'scatter_gather' && dslStep.scatter) {
      pilotStep.scatter = {
        input: dslStep.scatter.input,
        itemVariable: dslStep.scatter.itemVariable || 'item',
        steps: dslStep.scatter.steps.map((s: any, i: number) => this.translateStep(s, i))
      }
      // Add gather configuration (required by PILOT format)
      pilotStep.gather = dslStep.gather || { operation: 'collect' }
    }

    // Handle conditional steps
    else if (dslStep.type === 'conditional') {
      pilotStep.condition = dslStep.condition

      // Compiler produces 'steps' for then-branch → PILOT expects 'then'
      if (dslStep.steps && Array.isArray(dslStep.steps)) {
        pilotStep.then = dslStep.steps.map((s: any, i: number) => this.translateStep(s, i))
      }

      // Compiler produces 'else_steps' for else-branch → PILOT expects 'else'
      if (dslStep.else_steps && Array.isArray(dslStep.else_steps)) {
        pilotStep.else = dslStep.else_steps.map((s: any, i: number) => this.translateStep(s, i))
      }
    }

    return pilotStep
  }

  /**
   * Generate human-readable step name from DSL step
   */
  private generateStepName(dslStep: any): string {
    // Use description if available
    if (dslStep.description) {
      return dslStep.description
        .split(':')[0]
        .trim()
        .split(' ')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    }

    // Generate from type and operation
    if (dslStep.type === 'action' && dslStep.operation) {
      return dslStep.operation
        .split('_')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    }

    if (dslStep.type === 'transform' && dslStep.config?.transform_type) {
      return dslStep.config.transform_type
        .split('_')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    }

    if (dslStep.type === 'scatter_gather') {
      return 'Loop Over Items'
    }

    if (dslStep.type === 'conditional') {
      return 'Conditional Branch'
    }

    // Fallback
    return (dslStep.step_id || `step${Math.random()}`)
      .split('_')
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }
}
