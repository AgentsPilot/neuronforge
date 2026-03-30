/**
 * CapabilityBinder V2 - Deterministic Capability Binding
 *
 * This is the refactored capability binder that uses V6 plugin metadata for
 * deterministic binding without any hardcoded plugin logic.
 *
 * Key changes from V1:
 * - Uses per-step `uses` fields instead of global `intent.plugins`
 * - Matches based on domain + capability from plugin metadata
 * - Applies preference scoring (provider_family, must_support)
 * - Validates entity contracts and field guarantees
 * - NO hardcoded plugin-specific logic
 */

import type {
  IntentContract,
  IntentStep,
  CapabilityUse,
  Domain,
  Capability,
} from '../semantic-plan/types/intent-schema-types'
import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import type { ActionDefinition, PluginDefinition } from '@/lib/types/plugin-types'
import { createLogger } from '@/lib/logger'
import { SubsetRefResolver, type SubsetResolutionResult } from './SubsetRefResolver'
import { findBestFuzzyMatch, calculateTokenOverlap } from '../utils/fuzzy-matching'

const logger = createLogger({ module: 'CapabilityBinderV2', service: 'V6' })

/**
 * A step with resolved plugin binding
 */
export type BoundStep = IntentStep & {
  plugin_key?: string
  action?: string
  binding_confidence?: number
  binding_method?: 'exact_match' | 'preference_match' | 'entity_match' | 'unbound'
  binding_reason?: string[]
  /**
   * Fully mapped parameters after binding-time parameter mapping.
   * If present, downstream phases should use this instead of re-mapping.
   * Keys are concrete plugin parameter names, values are mapped from IntentContract payload.
   */
  mapped_params?: Record<string, any>
}

export type BoundIntentContract = IntentContract & {
  steps: BoundStep[]
  subset_resolution?: SubsetResolutionResult
}

/**
 * Candidate action for binding
 */
interface ActionCandidate {
  plugin_key: string
  plugin: PluginDefinition
  action_name: string
  action: ActionDefinition
  score: number
  reasons: string[]
}

/**
 * Deterministic capability binding using V6 plugin metadata
 *
 * Algorithm:
 * 1. Domain + Capability matching (required)
 * 2. Provider preference scoring (optional)
 * 3. Must-support filtering (optional)
 * 4. Entity contract validation (optional)
 * 5. Field guarantee validation (optional)
 *
 * NO HARDCODED PLUGIN LOGIC - All matching is data-driven from plugin metadata.
 */
export class CapabilityBinderV2 {
  private subsetResolver: SubsetRefResolver

  constructor(private pluginManager: PluginManagerV2) {
    this.subsetResolver = new SubsetRefResolver()
  }

  /**
   * Bind all steps in the Intent Contract to actual plugin actions
   */
  async bind(intent: IntentContract, userId: string): Promise<BoundIntentContract> {
    logger.info('[CapabilityBinderV2] Starting capability binding...')

    // Phase 0: Resolve subset references (aggregate subset auto-promotion)
    const subsetResolution = this.subsetResolver.resolve(intent)
    if (!subsetResolution.success) {
      logger.error(
        { errors: subsetResolution.errors },
        '[CapabilityBinderV2] Subset resolution failed - cannot proceed with binding'
      )
      throw new Error(`Subset resolution failed: ${subsetResolution.errors.join('; ')}`)
    }

    logger.info(
      { subsetCount: subsetResolution.subsets.size },
      '[CapabilityBinderV2] Subset resolution complete'
    )

    // Get user's connected plugins
    const connectedPlugins = await this.pluginManager.getExecutablePlugins(userId)

    // Also get system plugins that are always available (isSystem: true)
    const allPlugins = this.pluginManager.getAvailablePlugins()
    const systemPlugins = Object.entries(allPlugins)
      .filter(([_, plugin]) => plugin.plugin.isSystem === true)
      .filter(([key, _]) => !connectedPlugins[key]) // Don't duplicate

    // Merge system plugins into connectedPlugins
    for (const [key, definition] of systemPlugins) {
      connectedPlugins[key] = {
        definition,
        connection: {
          userId,
          pluginKey: key,
          username: 'system',
          status: 'active',
          accessToken: 'system',
          refreshToken: null,
          expiresAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      }
    }

    logger.info(
      {
        userConnected: Object.keys(await this.pluginManager.getExecutablePlugins(userId)).length,
        systemAdded: systemPlugins.length,
        total: Object.keys(connectedPlugins).length
      },
      '[CapabilityBinderV2] Loaded plugins (user + system)'
    )

    // Phase 1: Bind all steps (pass workflow config for parameter mapping)
    const workflowConfig = this.extractWorkflowConfig(intent)
    const boundSteps = await this.bindSteps(intent.steps, connectedPlugins, workflowConfig)

    const boundIntent: BoundIntentContract = {
      ...intent,
      steps: boundSteps,
      subset_resolution: subsetResolution,
    }

    // Validate all steps are bound
    const unboundSteps = this.findUnboundSteps(boundSteps)
    if (unboundSteps.length > 0) {
      logger.warn(
        { unboundSteps: unboundSteps.map((s) => s.id) },
        '[CapabilityBinderV2] Some steps could not be bound'
      )
    } else {
      logger.info('[CapabilityBinderV2] All steps successfully bound')
    }

    return boundIntent
  }

  /**
   * Recursively bind steps (handles nested loops, decisions, parallel)
   */
  private async bindSteps(
    steps: IntentStep[],
    connectedPlugins: Record<string, any>,
    workflowConfig: Array<{ key: string; value: any }>
  ): Promise<BoundStep[]> {
    const boundSteps: BoundStep[] = []

    for (const step of steps) {
      const boundStep = await this.bindStep(step, connectedPlugins, workflowConfig)

      // Handle nested steps in loops
      if (step.kind === 'loop' && (step as any).loop?.do) {
        const nestedBound = await this.bindSteps((step as any).loop.do, connectedPlugins, workflowConfig)
        ;(boundStep as any).loop.do = nestedBound
      }

      // Handle nested steps in decisions
      if (step.kind === 'decide' && (step as any).decide) {
        if ((step as any).decide.then) {
          const thenBound = await this.bindSteps((step as any).decide.then, connectedPlugins, workflowConfig)
          ;(boundStep as any).decide.then = thenBound
        }
        if ((step as any).decide.else) {
          const elseBound = await this.bindSteps((step as any).decide.else, connectedPlugins, workflowConfig)
          ;(boundStep as any).decide.else = elseBound
        }
      }

      // Handle nested steps in parallel branches
      if (step.kind === 'parallel' && (step as any).parallel?.branches) {
        const branches = (step as any).parallel.branches
        for (let i = 0; i < branches.length; i++) {
          const branch = branches[i]
          if (branch.steps) {
            branch.steps = await this.bindSteps(branch.steps, connectedPlugins, workflowConfig)
          }
        }
      }

      boundSteps.push(boundStep)
    }

    return boundSteps
  }

  /**
   * Bind a single step to a plugin action using V6 metadata
   */
  private async bindStep(
    step: IntentStep,
    connectedPlugins: Record<string, any>,
    workflowConfig: Array<{ key: string; value: any }>
  ): Promise<BoundStep> {
    const boundStep: BoundStep = { ...step }

    // Control flow steps don't bind to plugin actions
    if (step.kind === 'decide' || step.kind === 'loop' || step.kind === 'parallel') {
      boundStep.binding_method = 'unbound'
      return boundStep
    }

    // Get capability requirements from step.uses
    const uses = step.uses
    if (!uses || uses.length === 0) {
      logger.warn(
        { step_id: step.id },
        '[CapabilityBinderV2] Step has no capability requirements (uses field empty)'
      )
      boundStep.binding_method = 'unbound'
      return boundStep
    }

    // For now, use the first capability requirement
    // TODO: Handle multiple capability requirements per step
    const capabilityUse = uses[0]

    // Find candidates based on domain + capability (with artifact strategy awareness)
    const candidates = this.findCandidates(capabilityUse, connectedPlugins, step)

    if (candidates.length === 0) {
      logger.warn(
        {
          step_id: step.id,
          domain: capabilityUse.domain,
          capability: capabilityUse.capability,
        },
        '[CapabilityBinderV2] No candidates found for domain + capability'
      )
      boundStep.binding_method = 'unbound'
      return boundStep
    }

    logger.debug(
      {
        step_id: step.id,
        candidateCount: candidates.length,
        candidates: candidates.map((c) => `${c.plugin_key}.${c.action_name}`),
      },
      '[CapabilityBinderV2] Found candidates'
    )

    // Apply preference scoring
    let scoredCandidates = this.scoreByPreferences(candidates, capabilityUse.preferences)

    // Apply artifact strategy bonus scoring (prefer idempotent actions)
    if (step.kind === 'artifact' && 'artifact' in step) {
      scoredCandidates = this.scoreByArtifactStrategy(scoredCandidates, step.artifact)
    }

    // Filter by must_support if specified
    if (capabilityUse.preferences?.must_support) {
      scoredCandidates = this.filterByMustSupport(scoredCandidates, capabilityUse.preferences.must_support)
    }

    // Validate entity contracts if we have downstream step info
    // TODO: This requires knowledge of next step's requirements
    // For now, we trust that output_entity matches downstream needs

    // Select best candidate
    if (scoredCandidates.length === 0) {
      logger.warn(
        { step_id: step.id },
        '[CapabilityBinderV2] All candidates filtered out by preferences/must_support'
      )
      boundStep.binding_method = 'unbound'
      return boundStep
    }

    // Sort by score descending
    scoredCandidates.sort((a, b) => b.score - a.score)
    const best = scoredCandidates[0]

    // Bind to best candidate
    boundStep.plugin_key = best.plugin_key
    boundStep.action = best.action_name
    boundStep.binding_confidence = Math.min(best.score, 1.0)
    boundStep.binding_method = best.score >= 1.0 ? 'exact_match' : 'preference_match'
    boundStep.binding_reason = best.reasons

    logger.info(
      {
        step_id: step.id,
        plugin: best.plugin_key,
        action: best.action_name,
        score: best.score,
        reasons: best.reasons,
      },
      '[CapabilityBinderV2] Step bound successfully'
    )

    // NEW: Map parameters at binding time (Phase 2 implementation)
    const mappingResult = this.mapPayloadToSchema(step, best.action, workflowConfig)

    if (mappingResult.params && Object.keys(mappingResult.params).length > 0) {
      boundStep.mapped_params = mappingResult.params

      logger.info(
        {
          step_id: step.id,
          mapped_count: Object.keys(mappingResult.params).length,
          warnings: mappingResult.warnings.length,
          errors: mappingResult.errors.length,
        },
        '[CapabilityBinderV2] Parameters mapped at binding time'
      )

      // Log warnings if any
      if (mappingResult.warnings.length > 0) {
        logger.warn(
          { step_id: step.id, warnings: mappingResult.warnings },
          '[CapabilityBinderV2] Parameter mapping warnings'
        )
      }

      // Log errors if any (non-fatal - downstream can handle)
      if (mappingResult.errors.length > 0) {
        logger.warn(
          { step_id: step.id, errors: mappingResult.errors },
          '[CapabilityBinderV2] Parameter mapping errors'
        )
      }
    }

    return boundStep
  }

  /**
   * Map IntentContract payload to concrete plugin parameters at binding time.
   *
   * This is the NEW comprehensive parameter mapping that happens during binding phase.
   * It applies all transformations in one place:
   * 1. x-from-artifact handling (extract artifact options)
   * 2. x-variable-mapping decomposition (extract fields from variables)
   * 3. x-context-binding injection (inject workflow config)
   * 4. Required parameter auto-injection (fill missing required params)
   * 5. Format transformations (e.g., tab_name → range with A1 notation)
   * 6. Structure conversions (e.g., fields object → values array)
   *
   * @param step - The IntentStep with abstract payload
   * @param action - The plugin action definition with parameter schema
   * @param workflowConfig - The workflow configuration (resolved_user_inputs)
   * @returns Mapping result with fully mapped parameters, warnings, and errors
   */
  private mapPayloadToSchema(
    step: IntentStep,
    action: ActionDefinition,
    workflowConfig: Array<{ key: string; value: any }>
  ): {
    params: Record<string, any>
    warnings: string[]
    errors: string[]
  } {
    const result = {
      params: {} as Record<string, any>,
      warnings: [] as string[],
      errors: [] as string[],
    }

    // Get parameter schema from action
    const paramSchema = action.parameters?.properties || {}
    const requiredParams = action.parameters?.required || []

    // Get generic payload from IntentContract step
    const genericPayload = step.payload || {}

    logger.debug(
      {
        step_id: step.id,
        schema_params: Object.keys(paramSchema).length,
        required: requiredParams,
        payload_keys: Object.keys(genericPayload),
      },
      '[mapPayloadToSchema] Starting parameter mapping'
    )

    // PHASE 2.1: Handle x-from-artifact parameters
    // These are parameters that should be automatically extracted from artifact options
    // Example: For artifact steps, extract fields like "tab_name" from artifact.options
    if (step.kind === 'artifact' && 'artifact' in step && step.artifact?.options) {
      const artifactOptions = step.artifact.options

      for (const [paramName, paramDef] of Object.entries(paramSchema)) {
        const fromArtifact = (paramDef as any)['x-from-artifact']
        if (!fromArtifact) continue

        // Get the artifact field name (defaults to same as param name)
        const artifactField = (paramDef as any)['x-artifact-field'] || paramName

        // Check if this field exists in artifact options
        if (artifactField in artifactOptions) {
          result.params[paramName] = artifactOptions[artifactField]
          logger.debug(
            { paramName, artifactField, value: artifactOptions[artifactField] },
            '[mapPayloadToSchema] Mapped from artifact options (x-from-artifact)'
          )
        }
      }
    }

    // PHASE 2.2: x-variable-mapping is skipped at binding time
    // Variable references don't exist yet - this is handled at IR conversion time

    // PHASE 2.3: Handle x-context-binding injection
    // These are parameters that should be injected from workflow config
    // Example: spreadsheet_id has x-context-binding: {source: "workflow_config", key: "spreadsheet_id"}
    for (const [paramName, paramDef] of Object.entries(paramSchema)) {
      // Skip if already mapped
      if (paramName in result.params) continue

      const binding = (paramDef as any)['x-context-binding']
      if (!binding) continue

      const configKey = binding.key

      // Try exact match first
      const exactMatch = workflowConfig.find((c) => c.key === configKey)
      if (exactMatch) {
        result.params[paramName] = `{{config.${configKey}}}`
        logger.debug(
          { paramName, configKey },
          '[mapPayloadToSchema] Injected from workflow config (x-context-binding exact)'
        )
        continue
      }

      // If exact match not found, try fuzzy matching with lower threshold to handle variations
      // Examples: spreadsheet_id ← google_sheet_id_candidate, sheet_tab_name ← tab_name
      const fuzzyMatch = findBestFuzzyMatch(configKey, workflowConfig, 0.20)
      if (fuzzyMatch) {
        result.params[paramName] = `{{config.${fuzzyMatch}}}`
        logger.debug(
          {
            paramName,
            configKey,
            fuzzyMatch,
            score: calculateTokenOverlap(configKey, fuzzyMatch).toFixed(3),
          },
          '[mapPayloadToSchema] Injected from workflow config (x-context-binding fuzzy)'
        )
        result.warnings.push(
          `Parameter '${paramName}' fuzzy matched '${configKey}' → '${fuzzyMatch}'`
        )
      } else {
        logger.debug(
          { paramName, configKey },
          '[mapPayloadToSchema] No match found for x-context-binding'
        )
        result.warnings.push(
          `Parameter '${paramName}' expects config key '${configKey}' but not found`
        )
      }
    }

    // PHASE 2.4: Auto-inject missing REQUIRED parameters using fuzzy matching
    // This handles cases where required params don't have x-context-binding but can be inferred
    for (const paramName of requiredParams) {
      // Skip if already mapped
      if (paramName in result.params) continue

      // Use x-artifact-field hint if available, otherwise use param name
      const paramDef = paramSchema[paramName]

      // CRITICAL: Skip parameters with x-variable-mapping - those will be handled in Phase 3 (IR conversion)
      if (paramDef && (paramDef as any)['x-variable-mapping']) {
        logger.debug(
          { paramName },
          '[mapPayloadToSchema] Skipping x-variable-mapping parameter (handled in Phase 3)'
        )
        continue
      }

      const artifactHint = paramDef ? (paramDef as any)['x-artifact-field'] : null
      const searchKey = artifactHint || paramName

      // Use more lenient threshold for artifact hints (they're semantic hints)
      const threshold = artifactHint ? 0.25 : 0.4

      const fuzzyMatch = findBestFuzzyMatch(searchKey, workflowConfig, threshold)
      if (fuzzyMatch) {
        result.params[paramName] = `{{config.${fuzzyMatch}}}`
        logger.debug(
          {
            paramName,
            searchKey,
            fuzzyMatch,
            score: calculateTokenOverlap(searchKey, fuzzyMatch).toFixed(3),
            hint: artifactHint ? 'artifact-field' : 'param-name',
          },
          '[mapPayloadToSchema] Auto-injected required parameter (fuzzy)'
        )
        result.warnings.push(
          `Required parameter '${paramName}' auto-injected from '${fuzzyMatch}' (fuzzy match)`
        )
      } else {
        logger.warn(
          { paramName, searchKey, required: true },
          '[mapPayloadToSchema] Required parameter not found in workflow config'
        )
        result.errors.push(
          `Required parameter '${paramName}' not found in workflow config`
        )
      }
    }

    // PHASE 2.5: Structure conversions - Convert deliver.mapping → values array
    // For deliver steps with mapping arrays, check if target action expects a 2D array parameter
    if (step.kind === 'deliver' && 'deliver' in step && step.deliver?.mapping) {
      const mapping = step.deliver.mapping

      // Check if any parameter in the schema expects a 2D array
      for (const [paramName, paramDef] of Object.entries(paramSchema)) {
        // Skip if already mapped
        if (paramName in result.params) continue

        const paramType = (paramDef as any).type
        const paramItems = (paramDef as any).items

        // Check if this parameter expects array of arrays (2D array)
        if (paramType === 'array' && paramItems?.type === 'array') {
          // Convert mapping array to values array
          const row: string[] = []

          for (const fieldMap of mapping) {
            // Extract the value reference
            let valueRef: string

            if (typeof fieldMap.from === 'object' && 'ref' in fieldMap.from) {
              // Variable reference with optional field extraction
              const ref = fieldMap.from.ref
              const field = fieldMap.from.field

              valueRef = field ? `{{${ref}.${field}}}` : `{{${ref}}}`
            } else if (typeof fieldMap.from === 'string') {
              // Direct string value or variable name
              valueRef = fieldMap.from.includes('{{') ? fieldMap.from : `{{${fieldMap.from}}}`
            } else {
              // Fallback: use the 'to' field as placeholder
              valueRef = `{{${fieldMap.to}}}`
            }

            row.push(valueRef)
          }

          // Create 2D array (single row)
          result.params[paramName] = [row]

          logger.debug(
            {
              paramName,
              mappingCount: mapping.length,
              columns: row.length,
            },
            '[mapPayloadToSchema] Converted deliver.mapping to 2D array'
          )

          break // Only map to one 2D array parameter
        }
      }
    }

    // PHASE 2.6: Format transformations
    // Apply schema-driven format transformations (e.g., A1 notation for Google Sheets range)
    for (const [paramName, paramDef] of Object.entries(paramSchema)) {
      // Skip if already mapped
      if (paramName in result.params) continue

      const artifactField = (paramDef as any)['x-artifact-field']

      // If parameter needs value from artifact field, check if we can transform it
      if (artifactField) {
        // Look for the source value in already-mapped params or workflow config
        let sourceValue: string | undefined

        // First check if source param is already mapped
        if (artifactField in result.params) {
          sourceValue = result.params[artifactField]
        } else {
          // Check workflow config
          const configMatch = workflowConfig.find((c) => c.key === artifactField)
          if (configMatch) {
            sourceValue = `{{config.${artifactField}}}`
          }
        }

        if (sourceValue) {
          // For Google Sheets range parameter, ensure A1 notation
          if (paramName === 'range' && typeof sourceValue === 'string') {
            // If value is config reference and doesn't have A1 notation, keep as-is
            // (A1 notation will be added by downstream phases if needed)
            result.params[paramName] = sourceValue

            logger.debug(
              { paramName, artifactField, sourceValue },
              '[mapPayloadToSchema] Mapped with artifact field hint'
            )
          } else {
            // For other parameters, just copy the value
            result.params[paramName] = sourceValue

            logger.debug(
              { paramName, artifactField, sourceValue },
              '[mapPayloadToSchema] Mapped from artifact field'
            )
          }
        }
      }
    }

    // Fallback: Copy any remaining fields from generic payload
    // BUT skip fields that have x-variable-mapping (they'll be handled at IR conversion)
    // Check if ANY schema parameter has x-variable-mapping
    let hasVariableMapping = false
    for (const [paramName, paramDef] of Object.entries(paramSchema)) {
      if ((paramDef as any)['x-variable-mapping']) {
        hasVariableMapping = true
        break
      }
    }

    for (const [key, value] of Object.entries(genericPayload)) {
      if (!(key in result.params)) {
        // Don't copy if this is a structured ref and schema has x-variable-mapping
        // (IntentToIRConverter will apply correct field paths from schema)
        if (hasVariableMapping && typeof value === 'object' && value?.kind === 'ref') {
          logger.debug(
            { key, ref: value.ref, field: value.field },
            '[mapPayloadToSchema] Skipping structured ref (schema has x-variable-mapping, defer to IR conversion)'
          )
          continue
        }
        result.params[key] = value
      }
    }

    logger.debug(
      {
        step_id: step.id,
        mapped_params: Object.keys(result.params).length,
        warnings: result.warnings.length,
        errors: result.errors.length,
      },
      '[mapPayloadToSchema] Parameter mapping complete (skeleton)'
    )

    return result
  }

  /**
   * Phase 1: Find candidates by domain + capability (REQUIRED match)
   *
   * For artifact steps with strategy="get_or_create", also includes "upsert" capability
   * candidates even if the intent specifies "create", since upsert is the idempotent
   * version of create.
   */
  private findCandidates(
    capabilityUse: CapabilityUse,
    connectedPlugins: Record<string, any>,
    step?: IntentStep
  ): ActionCandidate[] {
    const candidates: ActionCandidate[] = []

    // Determine which capabilities to match
    const capabilitiesToMatch = [capabilityUse.capability]

    // Special case: If artifact step with strategy="get_or_create" requests "create",
    // also consider "upsert" actions (idempotent alternative)
    if (
      step?.kind === 'artifact' &&
      'artifact' in step &&
      step.artifact?.strategy === 'get_or_create' &&
      capabilityUse.capability === 'create'
    ) {
      capabilitiesToMatch.push('upsert')
    }

    for (const [pluginKey, actionablePlugin] of Object.entries(connectedPlugins)) {
      const pluginDef = actionablePlugin.definition as PluginDefinition

      // Check each action in the plugin
      for (const [actionName, actionDef] of Object.entries(pluginDef.actions)) {
        // Match domain + capability (REQUIRED)
        if (
          actionDef.domain === capabilityUse.domain &&
          actionDef.capability &&
          capabilitiesToMatch.includes(actionDef.capability as any)
        ) {
          const isExactMatch = actionDef.capability === capabilityUse.capability

          candidates.push({
            plugin_key: pluginKey,
            plugin: pluginDef,
            action_name: actionName,
            action: actionDef,
            score: isExactMatch ? 1.0 : 0.8, // Slight penalty for expanded matches
            reasons: [
              `✅ Domain match: ${capabilityUse.domain}`,
              isExactMatch
                ? `✅ Capability match: ${capabilityUse.capability}`
                : `✅ Capability match (expanded): ${actionDef.capability} (requested: ${capabilityUse.capability})`,
            ],
          })
        }
      }
    }

    return candidates
  }

  /**
   * Phase 2: Score candidates by preferences (provider_family)
   */
  private scoreByPreferences(
    candidates: ActionCandidate[],
    preferences?: CapabilityUse['preferences']
  ): ActionCandidate[] {
    if (!preferences || !preferences.provider_family) {
      return candidates // No preferences, all candidates are equal
    }

    const preferredFamily = preferences.provider_family

    return candidates.map((candidate) => {
      const pluginFamily = candidate.plugin.plugin.provider_family

      if (pluginFamily === preferredFamily) {
        candidate.score += 0.5
        candidate.reasons.push(`✅ Provider preference matched: ${preferredFamily}`)
      } else {
        candidate.reasons.push(`⚠️  Provider preference not matched (wanted: ${preferredFamily}, got: ${pluginFamily})`)
      }

      return candidate
    })
  }

  /**
   * Phase 3: Score by must_support flags (bonus scoring, not filtering)
   *
   * NOTE: must_support is now OPTIONAL - used for scoring only, not filtering.
   * This prevents false negatives where LLM specifies flags that don't exactly match plugin schemas.
   */
  private filterByMustSupport(
    candidates: ActionCandidate[],
    mustSupport: string[]
  ): ActionCandidate[] {
    // Apply bonus scoring for matching must_support flags, but don't filter out candidates
    for (const candidate of candidates) {
      const actionSupport = candidate.action.must_support || []

      // Check if all requested flags are present
      const allSupported = mustSupport.every((flag) => actionSupport.includes(flag))

      if (allSupported) {
        candidate.score += 0.25
        candidate.reasons.push(`✅ Bonus: All must_support flags present: ${mustSupport.join(', ')}`)
      } else {
        const matching = mustSupport.filter((flag) => actionSupport.includes(flag))
        const missing = mustSupport.filter((flag) => !actionSupport.includes(flag))

        // Partial match: smaller bonus
        if (matching.length > 0) {
          candidate.score += 0.1
          candidate.reasons.push(
            `⚠️  Partial must_support match: ${matching.length}/${mustSupport.length} flags (missing: ${missing.join(', ')})`
          )
        } else {
          // No match: no bonus, but don't filter out
          candidate.reasons.push(
            `ℹ️  No must_support match: requested [${mustSupport.join(', ')}], available [${actionSupport.join(', ')}]`
          )
        }
      }
    }

    // Return all candidates (no filtering)
    return candidates
  }

  /**
   * Phase 3.5: Score by artifact strategy (prefer idempotent actions)
   *
   * UNIVERSAL PRINCIPLE: ALWAYS prefer idempotent actions for artifact creation
   * to ensure workflows are safe to re-run without creating duplicates.
   *
   * This applies REGARDLESS of the strategy specified in the IntentContract,
   * providing a safety net even when LLM forgets to use get_or_create.
   */
  private scoreByArtifactStrategy(
    candidates: ActionCandidate[],
    artifact: any
  ): ActionCandidate[] {
    if (!artifact) return candidates

    const strategy = artifact.strategy
    const artifactType = artifact.type

    for (const candidate of candidates) {
      const action = candidate.action

      // Match artifact type to action's output_entity
      // e.g., artifact.type='sheet_tab' should prefer output_entity='sheet'
      // This helps disambiguate between similar actions (spreadsheet vs sheet_tab)
      if (artifactType && action.output_entity) {
        // Normalize both to handle variations (sheet_tab → sheet, folder → folder, etc.)
        const normalizedType = artifactType.replace(/_/g, '').toLowerCase()
        const normalizedEntity = action.output_entity.replace(/_/g, '').toLowerCase()

        if (normalizedType.includes(normalizedEntity) || normalizedEntity.includes(normalizedType)) {
          candidate.score += 0.5
          candidate.reasons.push(`✅ Output entity matches artifact type (${action.output_entity} ~ ${artifactType})`)
        }
      }

      // UNIVERSAL RULE: For ALL artifact creation, prefer idempotent operations
      // This is a safety net that works regardless of what strategy the LLM chose
      if (action.idempotent === true) {
        candidate.score += 0.7  // Strong bonus for idempotent operations
        candidate.reasons.push('✅ Idempotent action (UNIVERSAL DEFAULT for artifact creation)')
      } else if (action.idempotent === false) {
        // Penalize non-idempotent operations unless explicitly needed
        if (strategy === 'create_new') {
          // Only allow non-idempotent when explicitly requested
          candidate.score += 0.1
          candidate.reasons.push('⚠️  Non-idempotent action (allowed for strategy: create_new)')
        } else {
          // Otherwise warn about non-idempotent choice
          if (action.idempotent_alternative) {
            candidate.reasons.push(
              `⚠️  Non-idempotent action (consider ${action.idempotent_alternative} for idempotency)`
            )
          } else {
            candidate.reasons.push('⚠️  Non-idempotent action (may fail on repeated execution)')
          }
        }
      }

      // Additional bonus for explicit get_or_create strategy alignment
      if (strategy === 'get_or_create' && action.idempotent === true) {
        candidate.score += 0.3  // Extra bonus for explicit alignment
        candidate.reasons.push('✅ Perfect match: idempotent action + get_or_create strategy')
      }

      // Strategy: use_existing → prefer read-only actions (get, list, search)
      if (strategy === 'use_existing') {
        if (action.capability === 'get' || action.capability === 'list' || action.capability === 'search') {
          candidate.score += 0.3
          candidate.reasons.push('✅ Read-only action matches strategy: use_existing')
        }
      }
    }

    return candidates
  }

  /**
   * Extract workflow config from IntentContract
   * Converts config format to array of {key, value} pairs for parameter mapping
   */
  private extractWorkflowConfig(intent: IntentContract): Array<{ key: string; value: any }> {
    if (!intent.config || intent.config.length === 0) {
      return []
    }

    // IntentContract.config is Array<ConfigParam> with {key, type, description?, default?}
    // We need to convert it to Array<{key, value}> format
    // For binding time, we use the default value if available, otherwise undefined
    return intent.config.map((configParam) => ({
      key: configParam.key,
      value: configParam.default,
    }))
  }

  /**
   * Find all unbound steps (for validation)
   */
  private findUnboundSteps(steps: BoundStep[]): BoundStep[] {
    const unbound: BoundStep[] = []

    for (const step of steps) {
      // Only report unbound for steps that should be bound (not control flow)
      if (
        step.binding_method === 'unbound' &&
        step.kind !== 'decide' &&
        step.kind !== 'loop' &&
        step.kind !== 'parallel'
      ) {
        unbound.push(step)
      }

      // Check nested steps
      if (step.kind === 'loop' && (step as any).loop?.do) {
        unbound.push(...this.findUnboundSteps((step as any).loop.do))
      }
      if (step.kind === 'decide' && (step as any).decide) {
        if ((step as any).decide.then) {
          unbound.push(...this.findUnboundSteps((step as any).decide.then))
        }
        if ((step as any).decide.else) {
          unbound.push(...this.findUnboundSteps((step as any).decide.else))
        }
      }
      if (step.kind === 'parallel' && (step as any).parallel?.branches) {
        for (const branch of (step as any).parallel.branches) {
          if (branch.steps) {
            unbound.push(...this.findUnboundSteps(branch.steps))
          }
        }
      }
    }

    return unbound
  }
}
