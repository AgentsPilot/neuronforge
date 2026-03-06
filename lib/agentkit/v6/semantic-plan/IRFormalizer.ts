/**
 * IRFormalizer - Maps Enhanced Prompt to Precise IR
 *
 * WEEK 1 UPDATE: Now uses Enhanced Prompt DIRECTLY (skips semantic plan & grounding phases).
 * This is the FORMALIZATION PHASE (not understanding, not reasoning).
 * Takes an Enhanced Prompt with structured sections (data, actions, output, delivery, processing_steps)
 * and mechanically maps it to the strict IR schema.
 *
 * Key Principles:
 * 1. Use Enhanced Prompt sections EXACTLY (no modifications)
 * 2. Mechanical mapping (no reasoning)
 * 3. Follow IR schema strictly
 * 4. Use plugin schemas for correct action selection
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
// WEEK 1: No longer using GroundedSemanticPlan - using Enhanced Prompt directly
// import type { GroundedSemanticPlan } from './schemas/semantic-plan-types'
import type { EnhancedPrompt } from './SemanticPlanGenerator'
import type { DeclarativeLogicalIRv4 } from '../logical-ir/schemas/declarative-ir-types-v4'
import type { HardRequirements } from '../requirements/HardRequirementsExtractor'
import { PluginParameterValidator } from '../utils/PluginParameterValidator'
import { SemanticSkeletonToIR } from './SemanticSkeletonToIR'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { PluginManagerV2 } from '../../../server/plugin-manager-v2'
import { createLogger, Logger } from '@/lib/logger'
import { HardRequirementsFormatter } from '../utils/HardRequirementsFormatter'
import { getModelMaxOutputTokens } from '@/lib/ai/context-limits'

// Week 2: Import validators for comprehensive validation
import { validateExecutionGraph } from '../logical-ir/validation/ExecutionGraphValidator'
import { validateFieldReferences } from '../validators/FieldReferenceValidator'
import { validateTypeConsistency } from '../validators/TypeConsistencyValidator'
import { validateRequirementEnforcement } from '../validators/RequirementEnforcementValidator'

// Create module-scoped logger
const moduleLogger = createLogger({ module: 'V6', service: 'IRFormalizer' })

export interface IRFormalizerConfig {
  model?: string
  model_provider?: 'openai' | 'anthropic'  // NEW: Specify provider
  temperature?: number
  max_tokens?: number
  openai_api_key?: string
  anthropic_api_key?: string  // NEW: Support Anthropic
  pluginManager?: PluginManagerV2
  servicesInvolved?: string[] // From Enhanced Prompt specifics.services_involved
  resolvedUserInputs?: Array<{ key: string; value: any }> // From Enhanced Prompt specifics.resolved_user_inputs
  enhancedPrompt?: EnhancedPrompt // Full Enhanced Prompt (WEEK 1: replaces semantic plan)
}

export interface FormalizationResult {
  ir: DeclarativeLogicalIRv4  // Using v4.0 Execution Graph format
  formalization_metadata: {
    provider: string
    model: string
    grounded_facts_used: Record<string, any>
    missing_facts: string[]
    formalization_confidence: number
    timestamp: string
  }
}

export class IRFormalizer {
  private config: {
    model: string
    model_provider: 'openai' | 'anthropic'
    temperature: number
    max_tokens: number
    openai_api_key: string
    anthropic_api_key: string
    pluginManager?: PluginManagerV2
    servicesInvolved?: string[]
    resolvedUserInputs?: Array<{ key: string; value: any }>
    enhancedPrompt?: EnhancedPrompt
  }
  private openai?: OpenAI
  private anthropic?: Anthropic
  private systemPrompt: string
  private pluginManager?: PluginManagerV2
  // private groundedPlan?: any  // DEPRECATED - We skip Phases 1 & 2 and use Enhanced Prompt directly
  private servicesInvolved?: string[]  // From Enhanced Prompt
  private resolvedUserInputs?: Array<{ key: string; value: any }>  // From Enhanced Prompt
  private enhancedPrompt?: EnhancedPrompt  // Full Enhanced Prompt (replaces semantic plan)
  private logger: Logger

  constructor(config: IRFormalizerConfig) {
    this.logger = moduleLogger.child({ method: 'constructor' })

    // Auto-detect provider from model name if not specified
    let provider = config.model_provider
    if (!provider) {
      if (config.model?.includes('claude') || config.model?.includes('opus') || config.model?.includes('sonnet')) {
        provider = 'anthropic'
      } else {
        provider = 'openai'
      }
    }

    // Determine model name for max_tokens lookup
    const modelName = config.model || 'gpt-4o-mini'
    const defaultMaxTokens = getModelMaxOutputTokens(modelName)

    this.config = {
      model: modelName,
      model_provider: provider,
      temperature: config.temperature ?? 0.1, // Low but allows slight reasoning for processing_order
      max_tokens: config.max_tokens ?? defaultMaxTokens, // Use model's actual limit instead of hardcoded 4000
      openai_api_key: config.openai_api_key || process.env.OPENAI_API_KEY || '',
      anthropic_api_key: config.anthropic_api_key || process.env.ANTHROPIC_API_KEY || '',
      pluginManager: config.pluginManager,
      servicesInvolved: config.servicesInvolved,
      resolvedUserInputs: config.resolvedUserInputs,
      enhancedPrompt: config.enhancedPrompt
    }

    this.pluginManager = config.pluginManager
    this.servicesInvolved = config.servicesInvolved
    this.resolvedUserInputs = config.resolvedUserInputs
    this.enhancedPrompt = config.enhancedPrompt

    // Initialize LLM client based on provider
    if (this.config.model_provider === 'anthropic') {
      this.anthropic = new Anthropic({ apiKey: this.config.anthropic_api_key })
    } else {
      this.openai = new OpenAI({ apiKey: this.config.openai_api_key })
    }

    // Load formalization system prompt
    // Use process.cwd() instead of __dirname for Next.js compatibility
    // UPDATED: Now using IR v4.0 execution graph prompt
    const promptPath = join(process.cwd(), 'lib', 'agentkit', 'v6', 'semantic-plan', 'prompts', 'formalization-system-v4.md')
    this.systemPrompt = readFileSync(promptPath, 'utf-8')

    this.logger.info({
      model: this.config.model,
      provider: this.config.model_provider,
      hasPluginManager: !!this.pluginManager,
      pluginManagerType: this.pluginManager ? this.pluginManager.constructor.name : 'null',
      promptPath
    }, 'Initialized')
    this.logger.debug({ promptLength: this.systemPrompt.length }, 'System prompt loaded')
  }

  /**
   * Formalize Enhanced Prompt directly to IR (WEEK 1: Skip Phases 1 & 2)
   *
   * FEATURE FLAGS:
   * - V6_VALIDATION_DRIVEN_ENABLED: Uses validation-driven retry loop
   * - V6_SEMANTIC_SKELETON_ENABLED: Uses 2-stage semantic skeleton approach
   *
   * @param enhancedPrompt - Enhanced Prompt with sections (data, actions, output, delivery, processing_steps)
   * @param hardRequirements - Hard requirements extracted from Enhanced Prompt in Phase 0
   * @param semanticSkeleton - Optional semantic skeleton from Phase 1 (if enabled)
   */
  async formalize(
    enhancedPrompt: EnhancedPrompt,
    hardRequirements?: HardRequirements,
    semanticSkeleton?: any  // SemanticSkeleton type from Phase 1
  ): Promise<FormalizationResult> {
    const useValidationDriven = process.env.V6_VALIDATION_DRIVEN_ENABLED === 'true'
    const useSemanticSkeleton = process.env.V6_SEMANTIC_SKELETON_ENABLED === 'true'

    // Priority: Semantic Skeleton > Validation-Driven > V5 (single-attempt)
    if (useSemanticSkeleton && semanticSkeleton) {
      // NEW: 2-stage semantic skeleton approach
      return this.formalizeWithSkeleton(enhancedPrompt, semanticSkeleton, hardRequirements)
    } else if (useValidationDriven) {
      // Validation-driven with retry loop
      return this.formalizeWithValidation(enhancedPrompt, hardRequirements)
    } else {
      // OLD PATH: Current single-attempt IR generation (preserved for rollback)
      return this.formalizeV5(enhancedPrompt, hardRequirements)
    }
  }

  /**
   * Skeleton-Guided IR Generation (2-STAGE APPROACH)
   *
   * Uses semantic skeleton to guide IR generation. The skeleton provides
   * STRUCTURE (loops, conditionals, flow) while this method fills in DETAILS
   * (plugin operations, field names, configs).
   *
   * @param enhancedPrompt - Enhanced Prompt with sections
   * @param skeleton - Semantic skeleton from Phase 1
   * @param hardRequirements - Hard requirements from Phase 0
   */
  private async formalizeWithSkeleton(
    enhancedPrompt: EnhancedPrompt,
    skeleton: any,  // SemanticSkeleton type
    hardRequirements?: HardRequirements
  ): Promise<FormalizationResult> {
    const formalizeLogger = moduleLogger.child({ method: 'formalizeWithSkeleton' })
    const startTime = Date.now()

    formalizeLogger.info({
      hasHardRequirements: !!hardRequirements,
      skeletonGoal: skeleton.goal,
      skeletonUnitOfWork: skeleton.unit_of_work,
      skeletonFlowLength: skeleton.flow?.length || 0
    }, 'Starting skeleton-guided IR generation')

    // Import and use SemanticSkeletonToIR translator
    const { SemanticSkeletonToIR } = await import('./SemanticSkeletonToIR')
    const translator = new SemanticSkeletonToIR()

    // Validate skeleton before augmenting
    try {
      translator.validateSkeleton(skeleton)
    } catch (error) {
      formalizeLogger.error({ error: (error as Error).message }, 'Skeleton validation failed')
      throw new Error(`Skeleton validation failed: ${(error as Error).message}`)
    }

    // Augment Enhanced Prompt with skeleton structure
    const augmentedPrompt = translator.augmentEnhancedPrompt(enhancedPrompt, skeleton)

    formalizeLogger.info({
      loopStructureCount: augmentedPrompt.semantic_structure.loop_structure.length,
      loopStructure: JSON.stringify(augmentedPrompt.semantic_structure.loop_structure, null, 2),
      conditionalLogicCount: augmentedPrompt.semantic_structure.conditional_logic.length,
      collectionPointsCount: augmentedPrompt.semantic_structure.collection_points.length,
      filterHintsCount: augmentedPrompt.semantic_structure.filter_hints?.length || 0,
      filterHints: JSON.stringify(augmentedPrompt.semantic_structure.filter_hints, null, 2)
    }, 'Enhanced Prompt augmented with semantic structure')

    // Build formalization request with augmented prompt
    const userMessage = this.buildFormalizationRequest(augmentedPrompt as any, hardRequirements)

    // Call LLM based on provider
    const ir = this.config.model_provider === 'anthropic'
      ? await this.formalizeWithAnthropic(userMessage)
      : await this.formalizeWithOpenAI(userMessage)

    // Ensure goal field is present
    if (!ir.goal) {
      ir.goal = skeleton.goal || enhancedPrompt.sections?.processing_steps?.[0] || 'Execute workflow'
      formalizeLogger.debug('Added goal from skeleton')
    }

    // Validate v4.0 IR structure
    if (!ir.execution_graph || !ir.execution_graph.nodes) {
      formalizeLogger.error('IR missing execution_graph - v4.0 format required')
      throw new Error('IR formalization failed: missing execution_graph (v4.0 format required)')
    }

    if (ir.ir_version !== '4.0') {
      formalizeLogger.error({ version: ir.ir_version }, 'Invalid IR version - expected 4.0')
      throw new Error(`Invalid IR version: ${ir.ir_version}. Expected 4.0`)
    }

    // Run parameter validation
    if (this.pluginManager) {
      const validator = new PluginParameterValidator(this.pluginManager)
      const paramValidation = validator.validateExecutionGraph(ir.execution_graph)

      if (paramValidation.corrections > 0) {
        formalizeLogger.warn({
          corrections: paramValidation.corrections
        }, 'Auto-corrected plugin parameters')
      }

      if (paramValidation.errors.length > 0) {
        formalizeLogger.error({
          errors: paramValidation.errors
        }, 'Plugin parameter validation errors found')
      }
    }

    // Auto-recovery: Fix filter transforms with object input (common LLM error)
    const filterFixCount = this.autoFixFilterTransforms(ir, skeleton)
    if (filterFixCount > 0) {
      formalizeLogger.info({ fixedCount: filterFixCount }, 'Auto-fixed filter transforms using object instead of nested array field')
    }

    // Embed hard requirements in IR context
    if (hardRequirements && hardRequirements.requirements.length > 0) {
      if (!ir.context) {
        ir.context = {}
      }
      ir.context.hard_requirements = hardRequirements

      formalizeLogger.info({
        requirementsCount: hardRequirements.requirements.length
      }, 'Embedded hard requirements in IR context')
    }

    // Store enhanced prompt for reference
    this.enhancedPrompt = enhancedPrompt

    const endTime = Date.now()

    formalizeLogger.info({
      latencyMs: endTime - startTime,
      nodeCount: Object.keys(ir.execution_graph.nodes).length,
      variableCount: ir.execution_graph.variables?.length || 0
    }, 'Skeleton-guided IR generation complete')

    return {
      ir,
      formalization_metadata: {
        provider: this.config.model_provider,
        model: this.config.model,
        grounded_facts_used: { semantic_skeleton: skeleton },
        missing_facts: [],
        formalization_confidence: 0.95, // High confidence with skeleton guidance
        timestamp: new Date().toISOString(),
      },
    }
  }

  /**
   * V5 formalization: Single-attempt IR generation (PRESERVED FOR ROLLBACK)
   * This is the original implementation kept for instant rollback capability.
   *
   * @param enhancedPrompt - Enhanced Prompt with sections
   * @param hardRequirements - Hard requirements from Phase 0
   */
  private async formalizeV5(
    enhancedPrompt: EnhancedPrompt,
    hardRequirements?: HardRequirements
  ): Promise<FormalizationResult> {
    const formalizeLogger = moduleLogger.child({ method: 'formalize' })
    const startTime = Date.now()

    // Use hard requirements from parameter (Phase 0 → Phase 3 propagation)
    const requirements = hardRequirements

    formalizeLogger.info({
      hasHardRequirements: !!requirements,
      requirementsCount: requirements?.requirements.length || 0,
      requirementsSource: 'phase0_extraction'
    }, 'Starting formalization (direct from Enhanced Prompt)')

    // Store enhanced prompt for section extraction
    this.enhancedPrompt = enhancedPrompt

    // WEEK 1: No grounded facts - we skip Phase 2 (grounding is mocked for API workflows)
    // Enhanced Prompt provides all needed information directly
    formalizeLogger.info('Building formalization request directly from Enhanced Prompt (Week 1: no grounding phase)')

    // Build formalization request (direct from Enhanced Prompt - no semantic plan)
    const userMessage = this.buildFormalizationRequest(enhancedPrompt, requirements)

    // Debug: Log the available plugins section
    if (process.env.DEBUG_IR_FORMALIZER === 'true') {
      formalizeLogger.debug({
        userMessageLength: userMessage.length,
        userMessagePreview: userMessage.substring(0, 2000)
      }, 'User message for LLM')
    }

    // Call LLM based on provider
    const ir = this.config.model_provider === 'anthropic'
      ? await this.formalizeWithAnthropic(userMessage)
      : await this.formalizeWithOpenAI(userMessage)

    // Ensure goal field is present (use first processing step or generic goal)
    if (!ir.goal) {
      ir.goal = enhancedPrompt.sections?.processing_steps?.[0] || 'Execute workflow based on Enhanced Prompt'
      formalizeLogger.debug('Added missing goal field from Enhanced Prompt')
    }

    // Validate v4.0 IR structure
    if (!ir.execution_graph || !ir.execution_graph.nodes) {
      formalizeLogger.error('IR missing execution_graph - v4.0 format required')
      throw new Error('IR formalization failed: missing execution_graph (v4.0 format required)')
    }

    if (ir.ir_version !== '4.0') {
      formalizeLogger.error({ version: ir.ir_version }, 'Invalid IR version - expected 4.0')
      throw new Error(`Invalid IR version: ${ir.ir_version}. Expected 4.0`)
    }

    // Post-generation parameter validation and auto-correction
    if (this.pluginManager) {
      formalizeLogger.debug('Running parameter validation with PluginManager')
      const validator = new PluginParameterValidator(this.pluginManager)
      const paramValidation = validator.validateExecutionGraph(ir.execution_graph)

      formalizeLogger.debug({
        corrections: paramValidation.corrections,
        errors: paramValidation.errors.length,
        msg: 'Parameter validation complete'
      })

      if (paramValidation.corrections > 0) {
        formalizeLogger.warn({
          corrections: paramValidation.corrections,
          msg: 'Auto-corrected plugin parameters based on schema'
        })
      }

      if (paramValidation.errors.length > 0) {
        formalizeLogger.error({
          errors: paramValidation.errors,
          msg: 'Plugin parameter validation errors found'
        })
      }
    } else {
      formalizeLogger.warn('PluginManager not available - skipping parameter validation')
    }

    // Embed requirements in IR context (Phase 3: Phase 1 → Phase 3 propagation)
    if (requirements && requirements.requirements.length > 0) {
      if (!ir.context) {
        ir.context = {}
      }
      ir.context.hard_requirements = requirements

      formalizeLogger.info({
        requirementsCount: requirements.requirements.length,
        hasEnforcementTracking: !!ir.requirements_enforcement
      }, 'Embedded hard requirements in IR context')

      // Validate that LLM provided requirements_enforcement tracking
      if (!ir.requirements_enforcement || ir.requirements_enforcement.length === 0) {
        formalizeLogger.warn(
          'IR missing requirements_enforcement field - LLM did not track enforcement'
        )
      } else {
        // Log enforcement tracking summary
        const trackedRequirements = new Set(
          ir.requirements_enforcement.map(e => e.requirement_id)
        )
        const untrackedRequirements = requirements.requirements.filter(
          req => !trackedRequirements.has(req.id)
        )

        if (untrackedRequirements.length > 0) {
          formalizeLogger.warn({
            untrackedCount: untrackedRequirements.length,
            untrackedIds: untrackedRequirements.map(r => r.id)
          }, 'Some requirements not tracked in requirements_enforcement')
        }

        formalizeLogger.info({
          trackedCount: ir.requirements_enforcement.length,
          passedCount: ir.requirements_enforcement.filter(e => e.validation_passed).length
        }, 'Requirements enforcement tracking embedded in IR')
      }
    }

    // ARCHITECTURAL FIX: Validate IR structure before returning
    // This catches LLM generation errors that would otherwise cause silent failures
    this.validateIRStructure(ir, formalizeLogger)

    // Calculate confidence based on Enhanced Prompt completeness (WEEK 1: No grounded facts)
    const formalizationConfidence = this.calculateFormalizationConfidence(enhancedPrompt)

    const duration = Date.now() - startTime
    formalizeLogger.info({
      duration,
      confidence: formalizationConfidence,
      nodesCount: ir.execution_graph?.nodes ? Object.keys(ir.execution_graph.nodes).length : 0
    }, 'Formalization complete and validated')

    return {
      ir,
      formalization_metadata: {
        provider: 'openai',
        model: this.config.model,
        grounded_facts_used: {}, // WEEK 1: Empty - no grounding phase
        missing_facts: [],       // WEEK 1: Empty - no grounding phase
        formalization_confidence: formalizationConfidence,
        timestamp: new Date().toISOString()
      }
    }
  }

  /**
   * Validation-Driven Formalization with Retry Loop (NEW)
   *
   * This method implements the Silent Self-Healing approach:
   * 1. Generate IR from Enhanced Prompt
   * 2. Validate IR comprehensively
   * 3. If errors detected → Retry with focused error feedback (max 3 attempts)
   * 4. All retries are SILENT (users never see technical errors)
   *
   * @param enhancedPrompt - Enhanced Prompt with sections
   * @param hardRequirements - Hard requirements from Phase 0
   */
  private async formalizeWithValidation(
    enhancedPrompt: EnhancedPrompt,
    hardRequirements?: HardRequirements
  ): Promise<FormalizationResult> {
    const formalizeLogger = moduleLogger.child({ method: 'formalizeWithValidation' })
    const startTime = Date.now()
    const maxAttempts = 3

    let ir: DeclarativeLogicalIRv4 | null = null
    let validationErrors: any[] = []
    let attemptNumber = 0

    formalizeLogger.info({
      hasHardRequirements: !!hardRequirements,
      requirementsCount: hardRequirements?.requirements.length || 0,
      maxAttempts
    }, 'Starting validation-driven formalization with retry loop')

    // Store enhanced prompt for section extraction
    this.enhancedPrompt = enhancedPrompt

    for (attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
      formalizeLogger.info({ attemptNumber, maxAttempts }, 'IR generation attempt')

      try {
        // Generate or fix IR
        if (attemptNumber === 1) {
          // First attempt: Generate fresh IR from Enhanced Prompt
          ir = await this.generateIRAttempt(enhancedPrompt, hardRequirements, formalizeLogger)
        } else {
          // Retry attempts: Fix IR based on validation errors
          if (!ir) {
            throw new Error('Cannot fix IR: previous attempt returned null')
          }
          ir = await this.fixIRAttempt(
            ir,
            validationErrors,
            enhancedPrompt,
            hardRequirements,
            attemptNumber,
            formalizeLogger
          )
        }

        // Comprehensive validation
        validationErrors = this.validateIRComprehensive(ir, hardRequirements, formalizeLogger)

        if (validationErrors.length === 0) {
          // SUCCESS!
          const duration = Date.now() - startTime

          formalizeLogger.info({
            attemptNumber,
            duration,
            nodesCount: ir.execution_graph?.nodes ? Object.keys(ir.execution_graph.nodes).length : 0
          }, 'IR validation successful - formalization complete')

          // Log metrics for analysis
          this.logValidationMetrics(attemptNumber, validationErrors, true, duration)

          // Calculate confidence
          const formalizationConfidence = this.calculateFormalizationConfidence(enhancedPrompt)

          return {
            ir,
            formalization_metadata: {
              provider: this.config.model_provider,
              model: this.config.model,
              grounded_facts_used: {},
              missing_facts: [],
              formalization_confidence: formalizationConfidence,
              timestamp: new Date().toISOString()
            }
          }
        }

        // Validation failed
        formalizeLogger.warn({
          attemptNumber,
          errorCount: validationErrors.length,
          errorCategories: this.categorizeErrors(validationErrors)
        }, 'IR validation failed')

        if (attemptNumber === maxAttempts) {
          // All attempts exhausted
          const duration = Date.now() - startTime

          formalizeLogger.error({
            attempts: maxAttempts,
            duration,
            totalErrors: validationErrors.length,
            errorSummary: validationErrors.slice(0, 5).map(e => e.message)
          }, 'IR validation failed after all retry attempts')

          // Log metrics for failure
          this.logValidationMetrics(attemptNumber, validationErrors, false, duration)

          throw new Error(
            `IR validation failed after ${maxAttempts} attempts. ` +
            `Errors: ${validationErrors.map(e => e.message).join('; ')}`
          )
        }

        // Log metrics for retry
        this.logValidationMetrics(attemptNumber, validationErrors, false, Date.now() - startTime)

      } catch (error) {
        formalizeLogger.error({
          attemptNumber,
          error: error instanceof Error ? error.message : String(error)
        }, 'Error during IR generation attempt')

        if (attemptNumber === maxAttempts) {
          throw error
        }

        // Continue to next attempt
        formalizeLogger.info({ attemptNumber }, 'Retrying after error...')
      }
    }

    // Should never reach here
    throw new Error('Unexpected: retry loop completed without success or final failure')
  }

  /**
   * Generate IR from Enhanced Prompt (first attempt)
   */
  private async generateIRAttempt(
    enhancedPrompt: EnhancedPrompt,
    hardRequirements: HardRequirements | undefined,
    logger: Logger
  ): Promise<DeclarativeLogicalIRv4> {
    logger.debug('Generating IR from Enhanced Prompt (first attempt)')

    const userMessage = this.buildFormalizationRequest(enhancedPrompt, hardRequirements)

    const ir = this.config.model_provider === 'anthropic'
      ? await this.formalizeWithAnthropic(userMessage)
      : await this.formalizeWithOpenAI(userMessage)

    // Ensure goal field is present
    if (!ir.goal) {
      ir.goal = enhancedPrompt.sections?.processing_steps?.[0] || 'Execute workflow based on Enhanced Prompt'
      logger.debug('Added missing goal field from Enhanced Prompt')
    }

    // Basic structure validation
    if (!ir.execution_graph || !ir.execution_graph.nodes) {
      throw new Error('IR missing execution_graph - v4.0 format required')
    }

    if (ir.ir_version !== '4.0') {
      throw new Error(`Invalid IR version: ${ir.ir_version}. Expected 4.0`)
    }

    // Embed requirements in IR context
    if (hardRequirements && hardRequirements.requirements.length > 0) {
      if (!ir.context) {
        ir.context = {}
      }
      ir.context.hard_requirements = hardRequirements
    }

    return ir
  }

  /**
   * Fix IR based on validation errors (retry attempts)
   */
  private async fixIRAttempt(
    previousIR: DeclarativeLogicalIRv4,
    errors: any[],
    enhancedPrompt: EnhancedPrompt,
    hardRequirements: HardRequirements | undefined,
    attemptNumber: number,
    logger: Logger
  ): Promise<DeclarativeLogicalIRv4> {
    logger.info({
      attemptNumber,
      errorCount: errors.length
    }, 'Generating IR fix based on validation errors')

    const fixPrompt = this.buildFixPrompt(errors, previousIR, enhancedPrompt, hardRequirements)

    const ir = this.config.model_provider === 'anthropic'
      ? await this.formalizeWithAnthropic(fixPrompt)
      : await this.formalizeWithOpenAI(fixPrompt)

    // Ensure goal field is present
    if (!ir.goal) {
      ir.goal = previousIR.goal || enhancedPrompt.sections?.processing_steps?.[0] || 'Execute workflow'
    }

    // Basic structure validation
    if (!ir.execution_graph || !ir.execution_graph.nodes) {
      throw new Error('Fixed IR missing execution_graph')
    }

    if (ir.ir_version !== '4.0') {
      throw new Error(`Fixed IR has invalid version: ${ir.ir_version}`)
    }

    // Embed requirements in IR context
    if (hardRequirements && hardRequirements.requirements.length > 0) {
      if (!ir.context) {
        ir.context = {}
      }
      ir.context.hard_requirements = hardRequirements
    }

    return ir
  }

  /**
   * Build fix prompt with error feedback
   */
  private buildFixPrompt(
    errors: any[],
    previousIR: DeclarativeLogicalIRv4,
    enhancedPrompt: EnhancedPrompt,
    hardRequirements: HardRequirements | undefined
  ): string {
    const errorSummary = errors.map((e, i) => {
      const category = e.category || 'unknown'
      const nodeId = e.node_id ? `Node '${e.node_id}': ` : ''
      const message = e.message || 'Unknown error'
      const suggestion = e.suggestion || 'Fix the error and try again'

      return `${i + 1}. [${category}] ${nodeId}${message}\n   Suggestion: ${suggestion}`
    }).join('\n\n')

    return `# IR Validation Failed - Fix Required

Your generated IR has ${errors.length} error(s) that must be fixed:

${errorSummary}

## Your Task

Fix the IR by addressing each error above. Output the CORRECTED IR as valid JSON.

## Original Enhanced Prompt

${JSON.stringify(enhancedPrompt, null, 2)}

${hardRequirements ? `## Hard Requirements\n\n${JSON.stringify(hardRequirements, null, 2)}\n` : ''}

## Your Previous IR (WITH ERRORS)

${JSON.stringify(previousIR, null, 2)}

## Output Instructions

Output ONLY the corrected IR as valid JSON. Do not include explanations or markdown code blocks.
Ensure the corrected IR is complete and valid.`
  }

  /**
   * Comprehensive IR validation (stub - will be enhanced in Week 2)
   */
  /**
   * Comprehensive IR Validation (Week 2 Enhancement)
   *
   * Runs all validators to ensure IR is correct:
   * 1. Structure validation (JSON schema compliance)
   * 2. Execution graph validation (control flow, data flow)
   * 3. Field reference validation (fields exist in plugin schemas)
   * 4. Type consistency validation (operations receive correct types)
   * 5. Requirement enforcement validation (hard requirements enforced)
   */
  private validateIRComprehensive(
    ir: DeclarativeLogicalIRv4,
    hardRequirements: HardRequirements | undefined,
    logger: Logger
  ): any[] {
    const errors: any[] = []

    logger.debug('Starting comprehensive IR validation')

    // Validation 1: JSON Schema Structure
    try {
      this.validateIRStructure(ir, logger)
      logger.debug('✓ Schema validation passed')
    } catch (error) {
      errors.push({
        category: 'schema',
        message: error instanceof Error ? error.message : String(error),
        suggestion: 'Ensure IR follows v4.0 schema structure'
      })
      logger.warn('✗ Schema validation failed')
    }

    // Validation 2: Execution Graph (control flow, data flow, cycles)
    if (ir.execution_graph) {
      const graphValidation = validateExecutionGraph(ir.execution_graph)

      if (!graphValidation.valid) {
        errors.push(...graphValidation.errors)
        logger.warn(`✗ Execution graph validation failed: ${graphValidation.errors.length} errors`)
      } else {
        logger.debug('✓ Execution graph validation passed')
      }

      // Log warnings separately (non-blocking)
      if (graphValidation.warnings.length > 0) {
        logger.info(`⚠ Execution graph warnings: ${graphValidation.warnings.length}`, {
          warnings: graphValidation.warnings
        })
      }
    }

    // Validation 3: Field References (fields exist in plugin schemas)
    if (ir.execution_graph && this.pluginManager) {
      const fieldErrors = validateFieldReferences(ir.execution_graph, this.pluginManager)

      if (fieldErrors.length > 0) {
        errors.push(...fieldErrors)
        logger.warn(`✗ Field reference validation failed: ${fieldErrors.length} errors`)
      } else {
        logger.debug('✓ Field reference validation passed')
      }
    } else if (!this.pluginManager) {
      logger.warn('⚠ Skipping field reference validation - no plugin manager available')
    }

    // Validation 4: Type Consistency (operations receive correct types)
    if (ir.execution_graph) {
      const typeErrors = validateTypeConsistency(ir.execution_graph)

      if (typeErrors.length > 0) {
        errors.push(...typeErrors)
        logger.warn(`✗ Type consistency validation failed: ${typeErrors.length} errors`)
      } else {
        logger.debug('✓ Type consistency validation passed')
      }
    }

    // Validation 5: Requirement Enforcement (hard requirements enforced)
    if (ir.execution_graph && hardRequirements) {
      const requirementErrors = validateRequirementEnforcement(ir.execution_graph, hardRequirements)

      if (requirementErrors.length > 0) {
        errors.push(...requirementErrors)
        logger.warn(`✗ Requirement enforcement validation failed: ${requirementErrors.length} errors`)
      } else {
        logger.debug('✓ Requirement enforcement validation passed')
      }
    } else if (!hardRequirements) {
      logger.debug('⚠ Skipping requirement validation - no hard requirements provided')
    }

    logger.info({
      totalErrors: errors.length,
      errorCategories: this.categorizeErrors(errors)
    }, 'Comprehensive validation complete')

    return errors
  }

  /**
   * Categorize errors for metrics
   */
  private categorizeErrors(errors: any[]): Record<string, number> {
    const categories: Record<string, number> = {}

    for (const error of errors) {
      const category = error.category || 'unknown'
      categories[category] = (categories[category] || 0) + 1
    }

    return categories
  }

  /**
   * Log validation metrics for analysis
   */
  private logValidationMetrics(
    attemptNumber: number,
    errors: any[],
    success: boolean,
    durationMs: number
  ): void {
    const metricsLogger = moduleLogger.child({ method: 'logValidationMetrics' })

    const metrics = {
      attempt_number: attemptNumber,
      success,
      error_count: errors.length,
      error_categories: this.categorizeErrors(errors),
      duration_ms: durationMs,
      model: this.config.model,
      timestamp: new Date().toISOString()
    }

    metricsLogger.info(metrics, 'Validation metrics')

    // TODO (Week 3): Store metrics in database for dashboard
  }

  /**
   * DEPRECATED (WEEK 1): No longer used - we skip Phase 2 (grounding)
   *
   * Extract grounded facts from validation results
   *
   * Returns validated assumptions as key-value pairs.
   * Logs warnings when grounding results are empty or all validations failed.
   */
  /* private extractGroundedFacts(groundedPlan: GroundedSemanticPlan): Record<string, any> {
    const extractLogger = moduleLogger.child({ method: 'extractGroundedFacts' })
    const facts: Record<string, any> = {}

    // Check if grounding_results exists and has entries
    if (!groundedPlan.grounding_results || groundedPlan.grounding_results.length === 0) {
      extractLogger.warn('No grounding_results in groundedPlan - formalization will proceed without grounded facts')
      extractLogger.warn('This may indicate an API-only workflow (no tabular metadata) or a grounding failure')
      return facts
    }

    for (const result of groundedPlan.grounding_results) {
      if (result.validated && result.resolved_value !== null) {
        facts[result.assumption_id] = result.resolved_value
      }
    }

    // Warn if no facts were extracted despite having grounding results
    if (Object.keys(facts).length === 0) {
      extractLogger.warn({
        failedAssumptions: groundedPlan.grounding_results.map(r => r.assumption_id)
      }, 'All grounding_results failed validation - no grounded facts available')
    } else {
      extractLogger.info({
        factsCount: Object.keys(facts).length,
        factKeys: Object.keys(facts)
      }, 'Extracted grounded facts')
    }

    return facts
  } */

  /**
   * DEPRECATED (WEEK 1): No longer used - we skip Phase 2 (grounding)
   *
   * Identify assumptions that failed validation
   */
  /* private identifyMissingFacts(groundedPlan: GroundedSemanticPlan): string[] {
    const missing: string[] = []

    for (const result of groundedPlan.grounding_results) {
      if (!result.validated || result.resolved_value === null) {
        missing.push(result.assumption_id)
      }
    }

    return missing
  } */

  /**
   * Build processing_steps section for formalization request
   * (Hybrid Order Architecture - Phase 1)
   */
  private buildProcessingStepsSection(): string {
    const processingSteps = this.enhancedPrompt?.sections?.processing_steps

    if (!processingSteps || processingSteps.length === 0) {
      return ''
    }

    const stepsFormatted = processingSteps
      .map((step, idx) => `${idx + 1}. ${step}`)
      .join('\n')

    return `
## User's Workflow Steps (Execution Order Intent)

${stepsFormatted}

**HYBRID ORDER ARCHITECTURE:**

Generate a \`processing_order\` field in your IR output that contains an ordered array of IR field names reflecting the execution sequence described above.

**What to do:**
1. After generating all IR fields (data_sources, filters, ai_operations, etc.), determine which order they should execute in
2. The order should match the sequential logic described in the workflow steps above
3. Include only the IR field names that are actually present in your output
4. Populate the \`processing_order\` array with these field names in execution order

**Example IR output:**
\`\`\`json
{
  "processing_order": ["data_sources", "filters", "ai_operations", "conditionals", "file_operations", "delivery_rules"],
  "data_sources": [...],
  "filters": {...},
  "ai_operations": [...],
  ...
}
\`\`\`

The compiler will validate that this order satisfies data dependencies (e.g., conditionals that reference AI output fields must come after ai_operations).
`
  }

  /**
   * Build formalization request message (WEEK 1: No grounded facts needed)
   */
  private buildFormalizationRequest(
    enhancedPrompt: EnhancedPrompt,
    hardRequirements?: HardRequirements
  ): string {
    // Get available plugins if plugin manager is provided
    const availablePluginsSection = this.buildAvailablePluginsSection()

    // Always include search criteria instructions (harmless if not needed, critical if needed)
    const hasSearchCriteria = true

    const searchCriteriaInstructions = hasSearchCriteria ? `

## SPECIAL INSTRUCTION: Search Criteria Handling

The Enhanced Prompt includes search_criteria or filter conditions.

**Follow these rules**:
1. **Time-based filters** (newer_than:7d, older_than:30d, etc.) → Use data_source.config.query
2. **Keyword/text matching** (subject contains "complaint", etc.) → Use IR.filters with "contains" operator
3. **Complex AND/OR logic** → Use IR.filters.groups structure

**Example - Gmail with time filter + keyword matching:**
\`\`\`json
{
  "data_sources": [{
    "plugin_key": "google-mail",
    "operation_type": "search",
    "config": {
      "query": "newer_than:7d",
      "max_results": 100
    }
  }],
  "filters": {
    "combineWith": "OR",
    "conditions": [],
    "groups": [
      {
        "combineWith": "OR",
        "conditions": [
          {"field": "subject", "operator": "contains", "value": "complaint"},
          {"field": "subject", "operator": "contains", "value": "angry"}
        ]
      }
    ]
  }
}
\`\`\`
` : ''

    // Build processing_steps section if available (Hybrid Order Architecture)
    const processingStepsSection = this.buildProcessingStepsSection()

    // Build resolved user inputs section if available
    let resolvedUserInputsSection = ''
    if (this.resolvedUserInputs && this.resolvedUserInputs.length > 0) {
      resolvedUserInputsSection = `
## Resolved User Inputs (USE LITERAL VALUES - HIGHEST PRIORITY)

These are pre-validated constant values from the user. When a plugin parameter semantically matches a resolved input, use the LITERAL VALUE directly (not as a variable reference).

${this.resolvedUserInputs.map(input => `- **${input.key}**: \`${input.value}\``).join('\n')}

**CRITICAL Parameter Resolution Rule:**
- For each plugin parameter, check if a resolved input key semantically matches the parameter
- If match found → use the LITERAL VALUE from above (e.g., "${this.resolvedUserInputs[0]?.value || 'actual_value_here'}")
- Do NOT create variable references like \`{{key_name}}\` for resolved inputs
- Resolved inputs are CONSTANTS, not variables

**Examples:**
- Resolved input: \`google_sheet_id_candidate: "1pM8Wb..."\`
- Plugin param: \`spreadsheet_id\`
- ✅ CORRECT: \`"spreadsheet_id": "1pM8Wb..."\` (literal value)
- ❌ WRONG: \`"spreadsheet_id": "{{google_sheet_id_candidate}}"\` (variable reference)

**Filter Conditions:**
- If a resolved input contains comparison logic (e.g., "Stage = 4"), parse it to extract field and value
- Use the extracted value as a literal in the condition
`
    }

    // Build semantic structure section (if skeleton-guided generation)
    let semanticStructureSection = ''
    if ((enhancedPrompt as any).semantic_structure) {
      const structure = (enhancedPrompt as any).semantic_structure
      semanticStructureSection = `
## Semantic Structure (PRE-DESIGNED - FOLLOW EXACTLY)

**Unit of Work:** ${structure.unit_of_work}

**Loop Structure (MUST IMPLEMENT EXACTLY AS SPECIFIED):**
${structure.loop_structure.map((loop: any, index: number) =>
  `${index + 1}. Level ${loop.level}: iterate over "${loop.over}" → collect_outputs: ${loop.collect_results}`
).join('\n')}

**CRITICAL:** Set collect_outputs on each loop to EXACTLY match the collect_results flag above.
The loop with collect_outputs=true determines output granularity (unit_of_work).

${structure.conditional_logic.length > 0 ? `**Conditional Logic:**
${structure.conditional_logic.map((cond: any, index: number) =>
  `${index + 1}. If "${cond.condition}" then [${cond.then_actions.join(', ')}]${cond.else_actions.length > 0 ? ` else [${cond.else_actions.join(', ')}]` : ''}`
).join('\n')}` : ''}

**Flow Outline:**
${structure.flow_outline.join('\n')}

${structure.filter_hints && structure.filter_hints.length > 0 ? `
**CRITICAL: Filter Action Field Access Instructions:**
${structure.filter_hints.map((hint: any) =>
  `- Pattern: "${hint.pattern}" → ${hint.hint}`
).join('\n')}
` : ''}

**CRITICAL PARSING RULES for Flow Actions:**
- When you see "filter: {collection} of {parent_item}" inside a loop:
  1. {parent_item} refers to the loop's item variable
  2. {collection} is a field within that item (check plugin schema for exact field name)
  3. Transform input MUST be: \`{{loop_item_var.collection_field}}\` NOT \`{{loop_item_var}}\`
  4. Example: "filter: attachments of current email" → input: \`{{current_email.attachments}}\`
`
    }

    // Build hard requirements section (Phase 0 → Phase 3 propagation)
    let hardRequirementsSection = ''
    if (hardRequirements && hardRequirements.requirements.length > 0) {
      hardRequirementsSection = '\n' + HardRequirementsFormatter.format(hardRequirements, {
        format: (process.env.HARD_REQS_FORMAT as any) || 'compact_hybrid',
        phaseContext: 'ir_formalization'
      })
    }

    // Build Enhanced Prompt sections (WEEK 1: Direct injection, no semantic plan noise)
    let dataSectionText = ''
    if (enhancedPrompt.sections?.data && enhancedPrompt.sections.data.length > 0) {
      dataSectionText = `
## Data Sources (from Enhanced Prompt)

${enhancedPrompt.sections.data.join('\n')}
`
    }

    let actionsSectionText = ''
    if (enhancedPrompt.sections?.actions && enhancedPrompt.sections.actions.length > 0) {
      actionsSectionText = `
## Actions & Logic (from Enhanced Prompt)

${enhancedPrompt.sections.actions.join('\n')}
`
    }

    let outputSectionText = ''
    if (enhancedPrompt.sections?.output && enhancedPrompt.sections.output.length > 0) {
      outputSectionText = `
## Required Output Format (from Enhanced Prompt)

${enhancedPrompt.sections.output.join('\n')}
`
    }

    let deliverySectionText = ''
    if (enhancedPrompt.sections?.delivery && enhancedPrompt.sections.delivery.length > 0) {
      deliverySectionText = `
## Delivery Method (from Enhanced Prompt)

${enhancedPrompt.sections.delivery.join('\n')}
`
    }

    return `# Formalization Request

You must map this Enhanced Prompt to precise IR (execution graph).
${semanticStructureSection}
${processingStepsSection}
${resolvedUserInputsSection}
${hardRequirementsSection}
${dataSectionText}
${actionsSectionText}
${outputSectionText}
${deliverySectionText}
${searchCriteriaInstructions}
${availablePluginsSection}

## Your Task

Map the Enhanced Prompt to IR structure.

**Critical Rules (WEEK 1 UPDATE):**
1. WEEK 1: No grounded facts - use Enhanced Prompt sections directly (data, actions, output, delivery)
2. Follow IR schema enum values strictly
3. Map Enhanced Prompt concepts to IR structure mechanically
4. **ALWAYS populate plugin_key and operation_type with actual values (NEVER null)**
5. **CRITICAL FILTERING RULE**:
   - For time-based filters (newer_than:7d, etc.) → use config.query
   - For keyword/text matching → ALWAYS use IR filters with "contains" operator
   - For complex AND/OR logic → use IR filters.groups structure
   - IR filters work on ALL data sources (tabular AND API) - use them for keyword matching

6. **CRITICAL: FILTER FIELD NAMES FOR API SOURCES (MOST IMPORTANT!)**:
   - For API data sources (google-mail, slack, etc.), Enhanced Prompt doesn't contain filter field names
   - You MUST look up the **Output Fields** in the "Available Plugins" section above
   - Find the plugin and action being used (e.g., google-mail → search_emails)
   - Copy the EXACT field name from "Output Fields" (e.g., "snippet", "subject", "from", "body")
   - NEVER use null for filter field names - ALWAYS populate with actual field name from Output Fields
   - NEVER invent names like "email_content_text" - use ONLY names from Output Fields
   - Example: If filtering Gmail for complaints, use "snippet" or "body" (from Output Fields), NOT null

7. **RESOLVED USER INPUTS OVERRIDE**: If "Resolved User Inputs" section exists above, parse the filter rules to extract exact field names and values. These are validated parameter values from the Enhanced Prompt.

Output ONLY the IR JSON (no explanations, no markdown).`
  }

  /**
   * Detect if semantic understanding includes search criteria that should use plugin queries
   */
  private detectSearchCriteria(understanding: any): boolean {
    const detectLogger = moduleLogger.child({ method: 'detectSearchCriteria' })

    if (!understanding) {
      return false
    }

    // CRITICAL: Check if filtering section exists (keyword matching, etc.)
    if (understanding.filtering && understanding.filtering.conditions) {
      detectLogger.debug('Detected filtering section with conditions - will inject filter instructions')
      return true
    }

    // Check if any data source has search_criteria
    if (understanding.data_sources && Array.isArray(understanding.data_sources)) {
      for (const ds of understanding.data_sources) {
        if (ds.search_criteria || ds.time_window || ds.query) {
          return true
        }
      }
    }

    // Check if it's an API plugin (type indicates it supports queries)
    if (understanding.data_sources && Array.isArray(understanding.data_sources)) {
      for (const ds of understanding.data_sources) {
        if (ds.type === 'api') {
          return true
        }
      }
    }

    return false
  }

  /**
   * Get plugin keys from Enhanced Prompt services_involved (simple, no guessing!)
   * WEEK 1 RENAMED: Was extractUsedPluginsFromSemanticPlan
   */
  private extractUsedPluginsFromEnhancedPrompt(): string[] {
    const extractPluginsLogger = moduleLogger.child({ method: 'extractUsedPluginsFromEnhancedPrompt' })

    // Use services_involved directly from Enhanced Prompt if available
    if (this.servicesInvolved && this.servicesInvolved.length > 0) {
      extractPluginsLogger.debug({ services: this.servicesInvolved }, 'Using services_involved from Enhanced Prompt')
      return this.servicesInvolved
    }

    // Fallback: If no services_involved, inject all plugins
    extractPluginsLogger.debug('No services_involved provided, will inject all plugins')
    return []
  }

  /**
   * Build available plugins section for formalization request
   * OPTIMIZED: Only inject plugins from Enhanced Prompt's services_involved (saves ~800 tokens/plugin)
   */
  private buildAvailablePluginsSection(): string {
    const buildPluginsLogger = moduleLogger.child({ method: 'buildAvailablePluginsSection' })

    if (!this.pluginManager) {
      return ''
    }

    const availablePlugins = this.pluginManager.getAvailablePlugins()

    // Extract only used plugins from Enhanced Prompt (servicesInvolved)
    const usedPluginKeys = this.extractUsedPluginsFromEnhancedPrompt()

    if (usedPluginKeys.length === 0) {
      const totalPlugins = Object.keys(availablePlugins).length
      buildPluginsLogger.warn({
        totalPlugins,
        estimatedTokenCost: totalPlugins * 800,
        msg: 'No services_involved in Enhanced Prompt, injecting all plugins (performance warning)'
      })
      // Fallback to all plugins if extraction fails
    } else {
      const totalPlugins = Object.keys(availablePlugins).length
      const savings = (totalPlugins - usedPluginKeys.length) * 800
      buildPluginsLogger.info({
        usedPlugins: usedPluginKeys,
        usedCount: usedPluginKeys.length,
        totalAvailable: totalPlugins,
        estimatedTokenSavings: savings,
        savingsPercentage: Math.round((savings / (totalPlugins * 800)) * 100),
        msg: 'Injecting only used plugins (token optimization)'
      })
    }

    // Filter to only used plugins (or all if extraction failed)
    const pluginsToInject = usedPluginKeys.length > 0
      ? usedPluginKeys
        .map(key => ({ key, def: availablePlugins[key] }))
        .filter(p => p.def) // Only include plugins that exist
      : Object.entries(availablePlugins).map(([key, def]) => ({ key, def }))

    // Build detailed plugin information including parameter schemas AND output schemas
    const pluginDetails = pluginsToInject.map(({ key, def: pluginDef }) => {
      const description = pluginDef.plugin?.description || 'No description'

      // List actions with their critical parameters AND output fields
      const actionsList = Object.entries(pluginDef.actions).map(([actionName, actionDef]) => {
        const params = (actionDef as any).parameters
        const outputSchema = (actionDef as any).output_schema

        // Build parameter info - include both description AND usage_context for better action selection
        const actionDescription = (actionDef as any).description || 'No description'
        const usageContext = (actionDef as any).usage_context
        let paramInfo = `    - ${actionName}: ${actionDescription}`
        if (usageContext) {
          paramInfo += `\n      Usage: ${usageContext}`
        }

        if (params && params.properties) {
          // Extract key parameters (especially query-like parameters)
          const keyParams: string[] = []
          for (const [paramName, paramDef] of Object.entries(params.properties as Record<string, any>)) {
            // Show query, search, filter-like parameters prominently
            if (paramName.includes('query') || paramName.includes('search') || paramName.includes('filter') || params.required?.includes(paramName)) {
              const paramDesc = paramDef.description || ''
              const paramType = paramDef.type || 'any'
              const isRequired = params.required?.includes(paramName) ? ' (required)' : ''
              const defaultValue = paramDef.default !== undefined ? ` [default: "${paramDef.default}"]` : ''
              keyParams.push(`      • ${paramName} (${paramType})${isRequired}${defaultValue}: ${paramDesc}`)
            }
          }

          if (keyParams.length > 0) {
            paramInfo += `\n${keyParams.join('\n')}`
          }
        }

        // Extract output fields from output_schema (CRITICAL for filter field names!)
        if (outputSchema) {
          const outputFields: string[] = []

          // Helper to extract fields from a properties object
          const extractFieldsFromProperties = (props: Record<string, any>) => {
            for (const [fieldName, fieldDef] of Object.entries(props)) {
              const fieldType = fieldDef.type || 'any'
              const fieldDesc = fieldDef.description || ''
              outputFields.push(`      • ${fieldName} (${fieldType}): ${fieldDesc}`)
            }
          }

          // Case 1: Direct array of items (e.g., type: "array", items: { properties: {...} })
          if (outputSchema.type === 'array' && outputSchema.items?.properties) {
            extractFieldsFromProperties(outputSchema.items.properties)
          }
          // Case 2: Object with nested array property (e.g., Gmail: { properties: { emails: { type: "array", items: {...} } } })
          else if (outputSchema.type === 'object' && outputSchema.properties) {
            // Look for the main array property (typically named "emails", "items", "results", "data", etc.)
            for (const [propName, propDef] of Object.entries(outputSchema.properties as Record<string, any>)) {
              if (propDef.type === 'array' && propDef.items?.properties) {
                // Found the main data array - extract its item fields
                extractFieldsFromProperties(propDef.items.properties)
                break // Use the first array property found (typically the main data)
              }
            }
            // If no nested array found, fall back to extracting top-level properties
            if (outputFields.length === 0) {
              extractFieldsFromProperties(outputSchema.properties)
            }
          }

          if (outputFields.length > 0) {
            paramInfo += `\n      **Output Fields (use these EXACT names in filters and rendering.columns_in_order):**\n${outputFields.join('\n')}`
          }
        }

        return paramInfo
      }).join('\n')

      return `- **${key}**: ${description}\n  Actions:\n${actionsList}`
    }).join('\n\n')

    if (pluginDetails.length === 0) {
      return ''
    }

    return `## Available Plugins (Use these plugin_key values)

${pluginDetails}

**CRITICAL INSTRUCTIONS - READ CAREFULLY:**

1. **Plugin Selection**: Use the exact plugin_key from the list above

2. **Operation Type Selection** (MOST CRITICAL):
   - For EVERY data_source and delivery_rule, you MUST set operation_type
   - operation_type MUST be an EXACT action name from the "Actions:" list of the chosen plugin
   - Find the plugin in the list above, look at its "Actions:" section
   - Copy the action name EXACTLY character-for-character
   - DO NOT infer, abbreviate, or create operation types - ONLY use listed action names
   - **APPEND vs WRITE distinction**: If the goal is to ADD rows/records to existing data, use an "append" or "add" action. If the goal is to OVERWRITE/REPLACE existing data, use a "write" action.
   - Example flow:
     * Chosen plugin_key: Look up in Available Plugins above
     * See its "Actions:" list
     * Choose the action that matches the intent (append for adding, write for replacing)
     * Set operation_type to EXACT match of the chosen action name

3. **Config Parameters** (CRITICAL - USE EXACT PARAMETER NAMES):
   - Look at the parameters listed under the chosen action
   - Use the EXACT parameter names as shown in the action's parameter list
   - DO NOT use different parameter names (e.g., do NOT use "sheet_name" if the plugin uses "range")
   - Copy parameter names character-for-character from the schema
   - Populate config object with required/relevant parameters from the action's parameter list
   - Use Enhanced Prompt sections to fill parameter VALUES (but keep parameter NAMES exact)

4. **Parameter Value Population**:
   - If an action has "query" or "search" parameters, populate from Enhanced Prompt sections
   - DO NOT leave required parameters empty
   - Example for google-sheets read_range:
     * CORRECT: {"spreadsheet_id": "...", "range": "SheetName"}
     * WRONG: {"spreadsheet_id": "...", "sheet_name": "SheetName"}

5. **Filter Field Names** (CRITICAL FOR FILTERING):
   - When creating filters.conditions[], the "field" property MUST use EXACT field names from "Output Fields"
   - Find the plugin/action that provides the data you're filtering
   - Look at its "Output Fields" section
   - Copy the field name EXACTLY character-for-character
   - DO NOT invent semantic names like "email_content_text" or "sender_email"
   - DO NOT use camelCase if the schema uses snake_case (or vice versa)
   - Example:
     * Filtering Gmail results for keyword in body
     * Look up google-mail plugin → search_emails action
     * See Output Fields: id, subject, from, snippet, body, date, etc.
     * Use EXACT field name: "snippet" or "body" (NOT "email_content_text")
     * filters.conditions[0].field = "snippet"
   - If unsure which field to use, prefer simpler fields like "snippet" over "body"
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
   * Formalize using OpenAI with timeout protection
   */
  private async formalizeWithOpenAI(userMessage: string): Promise<DeclarativeLogicalIRv4> {
    const openaiLogger = moduleLogger.child({ method: 'formalizeWithOpenAI', model: this.config.model })
    const startTime = Date.now()

    openaiLogger.info('Calling OpenAI API')

    const apiCall = this.openai.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: userMessage }
      ],
      response_format: { type: 'json_object' }, // Use json_object for gpt-5.2 compatibility
      temperature: this.config.temperature,
      max_completion_tokens: this.config.max_tokens
    })

    // Wrap with 90-second timeout (complex workflows need more time)
    const response = await this.callWithTimeout(apiCall, 90000)

    const content = response.choices[0]?.message?.content

    if (!content) {
      openaiLogger.error('No response content from OpenAI')
      throw new Error('No response content from OpenAI')
    }

    const ir = JSON.parse(content) as DeclarativeLogicalIRv4

    // Fix type coercion: LLM sometimes outputs numeric strings instead of numbers
    this.coerceIRTypes(ir)

    const duration = Date.now() - startTime
    openaiLogger.info({ duration, responseLength: content.length }, 'OpenAI response parsed successfully')

    return ir
  }

  /**
   * Formalize using Anthropic with timeout protection
   */
  private async formalizeWithAnthropic(userMessage: string): Promise<DeclarativeLogicalIRv4> {
    const anthropicLogger = moduleLogger.child({ method: 'formalizeWithAnthropic', model: this.config.model })
    const startTime = Date.now()

    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized')
    }

    const maxAttempts = 2
    let lastError = ''

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStartTime = Date.now()

      try {
        // Log message size for debugging
        const messageLength = userMessage.length
        const estimatedTokens = Math.ceil(messageLength / 4) // Rough estimate: 4 chars per token
        anthropicLogger.info({
          attempt,
          maxAttempts,
          messageLength,
          estimatedInputTokens: estimatedTokens
        }, 'Calling Anthropic API')

        // Add retry context to user message if this is a retry
        const finalUserMessage = attempt > 1 && lastError
          ? `${userMessage}\n\n---\n\nPREVIOUS ATTEMPT FAILED:\n${lastError}\n\nPlease ensure you generate valid, complete JSON. Do not truncate arrays or objects.`
          : userMessage

        const apiCall = this.anthropic.messages.create({
          model: this.config.model,
          max_tokens: this.config.max_tokens,
          temperature: this.config.temperature,
          system: this.systemPrompt,
          messages: [
            { role: 'user', content: finalUserMessage }
          ]
        })

        // Wrap with 90-second timeout (complex workflows need more time)
        const response = await this.callWithTimeout(apiCall, 90000)

        const content = response.content[0]
        if (content.type !== 'text') {
          lastError = 'Unexpected response type from Anthropic'
          anthropicLogger.warn({ attempt, error: lastError }, 'Attempt failed - unexpected response type')
          if (attempt === maxAttempts) {
            throw new Error(lastError)
          }
          continue
        }

        anthropicLogger.debug({ responseLength: content.text.length }, 'Received LLM response')

        // Extract JSON from response (Anthropic may wrap it in markdown code blocks)
        let jsonText = content.text.trim()

        // Try multiple patterns to extract JSON from markdown code fences
        const patterns = [
          /```json\s*\n([\s\S]*?)\n```/,      // Standard: ```json\n{...}\n```
          /```json\s+([\s\S]*?)```/,          // No newline after json: ```json {...}```
          /```\s*\n([\s\S]*?)\n```/,          // Generic: ```\n{...}\n```
          /```([\s\S]*?)```/,                 // Minimal: ```{...}```
        ]

        for (const pattern of patterns) {
          const jsonMatch = jsonText.match(pattern)
          if (jsonMatch && jsonMatch[1]) {
            jsonText = jsonMatch[1].trim()
            break
          }
        }

        // Final cleanup: remove any remaining backticks and whitespace
        jsonText = jsonText.trim().replace(/^`+|`+$/g, '').trim()

        // Additional safety: if text starts with "json" (literal word), remove it
        if (jsonText.startsWith('json')) {
          jsonText = jsonText.substring(4).trim()
        }

        const ir = JSON.parse(jsonText) as DeclarativeLogicalIRv4

        // Fix type coercion: LLM sometimes outputs numeric strings instead of numbers
        this.coerceIRTypes(ir)

        const attemptDuration = Date.now() - attemptStartTime
        const totalDuration = Date.now() - startTime
        anthropicLogger.info({
          attempt,
          attemptDuration,
          totalDuration,
          responseLength: content.text.length
        }, 'Anthropic response parsed successfully')

        return ir
      } catch (parseError) {
        lastError = parseError instanceof Error ? parseError.message : 'Unknown JSON parse error'
        const attemptDuration = Date.now() - attemptStartTime
        anthropicLogger.error({ err: parseError, attempt, attemptDuration }, 'Attempt failed with JSON parse error')

        // If this is the last attempt or a non-retryable error, fail immediately
        if (attempt === maxAttempts || lastError.includes('API key') || lastError.includes('rate limit')) {
          anthropicLogger.error({ totalAttempts: maxAttempts, lastError }, 'All attempts failed')
          throw new Error(`IR formalization failed after ${maxAttempts} attempts: ${lastError}`)
        }

        // Log retry attempt
        anthropicLogger.info({ nextAttempt: attempt + 1, error: lastError }, 'Retrying with error context...')
      }
    }

    // This should never be reached, but TypeScript needs it
    throw new Error('IR formalization failed: unexpected code path')
  }

  /**
   * Coerce IR types: LLM sometimes outputs strings instead of numbers
   * Fix temperature, max_tokens, and other numeric fields in execution graph nodes (v4.0)
   */
  private coerceIRTypes(ir: DeclarativeLogicalIRv4): void {
    if (!ir.execution_graph || !ir.execution_graph.nodes) {
      return
    }

    // Walk through all nodes and fix numeric fields
    for (const node of Object.values(ir.execution_graph.nodes)) {
      if (node.type !== 'operation') continue

      const operation = node.operation
      if (!operation) continue

      // Fix AI operation temperature/model (v4 has direct properties, no constraints object)
      if (operation.operation_type === 'ai' && operation.ai) {
        const aiConfig = operation.ai

        // Convert temperature string to number
        if (typeof aiConfig.temperature === 'string') {
          const temp = parseFloat(aiConfig.temperature)
          aiConfig.temperature = isNaN(temp) ? undefined : temp
        }

        // Model is already a string, no coercion needed
      }

      // Fix fetch/deliver config numeric fields (max_results, etc.)
      if (operation.operation_type === 'fetch' && operation.fetch?.config) {
        const config = operation.fetch.config
        if (typeof config.max_results === 'string') {
          const maxResults = parseInt(config.max_results, 10)
          config.max_results = isNaN(maxResults) ? undefined : maxResults
        }
      }
    }
  }

  /**
   * Calculate formalization confidence
   * Based on:
   * - Percentage of grounded facts used
   * - Number of critical assumptions validated
   * - Overall grounding confidence
   */
  /**
   * Calculate formalization confidence based on Enhanced Prompt completeness
   * WEEK 1: Simplified - no grounding phase to factor in
   */
  private calculateFormalizationConfidence(enhancedPrompt: EnhancedPrompt): number {
    // WEEK 1: Simplified confidence calculation (no grounding phase)
    // Start with high baseline since Enhanced Prompt is already validated
    let confidence = 0.95

    // Check if we have key sections populated
    const hasSections = enhancedPrompt.sections &&
      enhancedPrompt.sections.data &&
      enhancedPrompt.sections.delivery &&
      enhancedPrompt.sections.data.length > 0 &&
      enhancedPrompt.sections.delivery.length > 0

    if (!hasSections) {
      confidence *= 0.8 // Penalize if key sections missing
    }

    // Check if we have processing steps
    if (!enhancedPrompt.sections?.processing_steps || enhancedPrompt.sections.processing_steps.length === 0) {
      confidence *= 0.9 // Small penalty if no processing steps
    }

    return confidence
  }

  /**
   * Validate IR structure for common LLM generation errors
   *
   * ARCHITECTURAL FIX: This catches errors at formalization time instead of
   * allowing them to propagate to compilation where they cause silent failures.
   *
   * Validates:
   * 1. Transform operations have required configuration
   * 2. Variable types match operation requirements
   * 3. Required fields are present based on operation type
   */
  private validateIRStructure(ir: DeclarativeLogicalIRv4, logger: Logger): void {
    if (!ir.execution_graph) {
      return // No graph to validate
    }

    const errors: string[] = []

    // Validate each node
    for (const [nodeId, node] of Object.entries(ir.execution_graph.nodes)) {
      if (node.type !== 'operation') continue

      const operation = (node as any).operation
      if (!operation) continue

      // Validate transform operations
      if (operation.operation_type === 'transform') {
        const transform = operation.transform
        if (!transform) {
          errors.push(`Node '${nodeId}': transform operation missing transform config`)
          continue
        }

        // Validate filter operations
        if (transform.type === 'filter') {
          if (!transform.filter_expression) {
            errors.push(
              `Node '${nodeId}': filter operation missing filter_expression. ` +
              `Filter operations MUST have filter_expression to define filtering logic. ` +
              `Either add filter_expression OR change operation type.`
            )
          }

          // Auto-correct: if input is object type, try to find array field to filter on
          const inputVar = (node as any).inputs?.[0]?.variable
          if (inputVar) {
            const varDecl = ir.execution_graph.variables?.find(v => v.name === inputVar)
            if (varDecl && varDecl.type !== 'array') {
              // Attempt auto-correction: look for common array field names
              const commonArrayFields = ['attachments', 'items', 'results', 'data', 'list', 'records']
              let corrected = false

              // Check if transform.input is a variable reference
              const inputRef = transform.input
              if (inputRef && typeof inputRef === 'string' && inputRef.startsWith('{{') && inputRef.endsWith('}}')) {
                const varName = inputRef.slice(2, -2).trim()

                // Try appending common array field names
                for (const fieldName of commonArrayFields) {
                  const correctedInput = `{{${varName}.${fieldName}}}`

                  // Apply correction
                  transform.input = correctedInput
                  corrected = true

                  logger.warn({
                    nodeId,
                    originalInput: inputRef,
                    correctedInput,
                    reason: `Variable '${varName}' is type '${varDecl.type}', not 'array'. Auto-corrected to access nested array field '${fieldName}'.`
                  }, 'Auto-corrected filter input to access nested array field')

                  break // Use first match
                }
              }

              if (!corrected) {
                errors.push(
                  `Node '${nodeId}': filter operation requires array input, ` +
                  `but variable '${inputVar}' is declared as type '${varDecl.type}'. ` +
                  `Either change variable type to 'array' OR use different operation type.`
                )
              }
            }
          }
        }

        // Validate map operations
        // Note: map_expression is optional for simple operations where transform.input
        // itself defines the mapping (e.g., "{{item.field}}" extracts field from each item)
        // Only complex transformations require explicit map_expression
        if (transform.type === 'map') {
          // Skip validation - map_expression is optional
          // The runtime can handle maps with just an input field
        }

        // Validate reduce operations
        if (transform.type === 'reduce') {
          if (!transform.reduce_operation) {
            errors.push(
              `Node '${nodeId}': reduce operation missing reduce_operation. ` +
              `Must specify one of: sum, count, avg, min, max, concat`
            )
          }
        }

        // Validate group_by operations
        if (transform.type === 'group_by') {
          if (!transform.group_by_field) {
            errors.push(
              `Node '${nodeId}': group_by operation missing group_by_field`
            )
          }
        }

        // Validate sort operations
        if (transform.type === 'sort') {
          if (!transform.sort_field) {
            errors.push(
              `Node '${nodeId}': sort operation missing sort_field`
            )
          }
          if (!transform.sort_order) {
            errors.push(
              `Node '${nodeId}': sort operation missing sort_order (must be 'asc' or 'desc')`
            )
          }
        }
      }
    }

    // If errors found, fail formalization
    if (errors.length > 0) {
      logger.error({
        errorsCount: errors.length,
        errors
      }, 'IR structure validation failed')

      throw new Error(
        `IR structure validation failed with ${errors.length} error(s):\n` +
        errors.map((e, i) => `${i + 1}. ${e}`).join('\n')
      )
    }

    logger.info('IR structure validation passed')
  }

  /**
   * Auto-fix filter transforms that use object input instead of nested array field
   *
   * Common LLM error: generates "input": "{{loop_item}}" when it should be "{{loop_item.attachments}}"
   * This method detects this pattern using filter_hints from skeleton and fixes it automatically.
   */
  private autoFixFilterTransforms(ir: DeclarativeLogicalIRv4, skeleton?: SemanticSkeleton): number {
    if (!skeleton) return 0

    const translator = new SemanticSkeletonToIR()
    const filterHints = translator['extractFilterHints'](skeleton.flow)
    if (filterHints.length === 0) return 0

    let fixCount = 0
    const variables = ir.execution_graph.variables || []
    const variableTypes = new Map<string, string>()
    for (const v of variables) {
      variableTypes.set(v.name, v.type)
    }

    // Check each node for filter transform with object input
    for (const [nodeId, node] of Object.entries(ir.execution_graph.nodes)) {
      if (node.type === 'operation' && node.operation?.operation_type === 'transform') {
        const transform = node.operation.transform
        if (!transform || (transform.type !== 'filter' && transform.type !== 'map')) continue

        // Extract variable name from input
        const inputMatch = transform.input?.match(/^{{(.+?)}}$/)
        if (!inputMatch) continue

        const fullInputPath = inputMatch[1] // e.g., "current_email" or "current_email.attachments"
        const inputVar = fullInputPath.split('.')[0] // Get base variable name
        const inputType = variableTypes.get(inputVar)

        // Check if input is ONLY the base variable (no nested field access)
        const hasNestedAccess = fullInputPath.includes('.')

        // If input is an object but transform needs array, AND input doesn't already use nested access
        if (inputType === 'object' && !hasNestedAccess) {
          // Find matching filter hint
          for (const hint of filterHints) {
            const collectionField = hint.collectionField
            const fixedInput = `{{${inputVar}.${collectionField}}}`

            moduleLogger.info({
              nodeId,
              originalInput: transform.input,
              fixedInput,
              reason: `Filter hint suggests accessing nested field: ${collectionField}`
            }, 'Auto-fixing filter transform with object input')

            transform.input = fixedInput
            fixCount++
            break // Only apply first matching hint
          }
        } else if (hasNestedAccess) {
          // Already using nested access - no fix needed
          moduleLogger.debug({
            nodeId,
            input: transform.input,
            reason: 'Already using nested field access, skipping auto-fix'
          }, 'Transform input already correct')
        }
      }
    }

    return fixCount
  }
}
