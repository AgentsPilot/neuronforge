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
import type { WorkflowDataSchema } from '../logical-ir/schemas/workflow-data-schema'
import { createLogger } from '@/lib/logger'
import { SubsetRefResolver, type SubsetResolutionResult } from './SubsetRefResolver'
import { DataSchemaBuilder } from './DataSchemaBuilder'
import { InputTypeChecker } from './InputTypeChecker'

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
  /** Direction #3: Full ranked candidate list retained for Phase 2b re-selection */
  _ranked_candidates?: ActionCandidate[]
  /** Direction #3: Candidates rejected by input-type check */
  rejected_candidates?: Array<{ plugin_key: string; action_name: string; rejection_reason: string }>
}

export type BoundIntentContract = IntentContract & {
  steps: BoundStep[]
  subset_resolution?: SubsetResolutionResult
  /** Workflow data schema — constructed deterministically after binding from plugin output schemas + step declarations */
  data_schema?: WorkflowDataSchema
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
          user_id: userId,
          plugin_key: key,
          plugin_name: key,
          username: 'system',
          status: 'active',
          access_token: 'system',
          refresh_token: null,
          expires_at: null,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
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

    // Phase 1: Bind all steps
    const boundSteps = await this.bindSteps(intent.steps, connectedPlugins)

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

    // Phase 2: Build data_schema from bound steps + plugin output schemas
    const schemaBuilder = new DataSchemaBuilder(this.pluginManager)
    const { schema: dataSchema, warnings: schemaWarnings } = schemaBuilder.build(boundSteps)

    boundIntent.data_schema = dataSchema

    if (schemaWarnings.length > 0) {
      logger.warn(
        { warningCount: schemaWarnings.length, warnings: schemaWarnings },
        '[CapabilityBinderV2] data_schema built with warnings'
      )
    } else {
      logger.info(
        { slotCount: Object.keys(dataSchema.slots).length },
        '[CapabilityBinderV2] data_schema built successfully'
      )
    }

    // WP-2 Phase 2: Reconcile field references against data_schema.
    // The LLM may reference fields by the consuming action's param name (e.g., "message_id")
    // when the producing step's output schema uses a different name (e.g., "id").
    // Now that we have the data_schema with actual field names, validate and rewrite.
    const reconciledCount = this.reconcileFieldReferences(boundSteps, dataSchema)
    if (reconciledCount > 0) {
      logger.info(
        { reconciledCount },
        '[CapabilityBinderV2] WP-2: Reconciled field references against data_schema'
      )
    }

    // Direction #3 — Phase 2b: Input-type compatibility validation.
    // Now that data_schema exists, check that each bound action's input-type
    // requirements (from_type) match the source slot's semantic type.
    // If the top candidate fails, try the next-ranked one.
    this.validateInputTypeCompatibility(boundSteps, dataSchema)

    // Clean up internal-only fields before returning — _ranked_candidates
    // holds full ActionDefinition/PluginDefinition objects that would bloat
    // serialized output (JSON.stringify of the BoundIntentContract).
    this.cleanupInternalFields(boundSteps)

    return boundIntent
  }

  /**
   * Recursively bind steps (handles nested loops, decisions, parallel)
   */
  private async bindSteps(
    steps: IntentStep[],
    connectedPlugins: Record<string, any>
  ): Promise<BoundStep[]> {
    const boundSteps: BoundStep[] = []

    for (const step of steps) {
      const boundStep = await this.bindStep(step, connectedPlugins)

      // Handle nested steps in loops
      if (step.kind === 'loop' && (step as any).loop?.do) {
        const nestedBound = await this.bindSteps((step as any).loop.do, connectedPlugins)
        ;(boundStep as any).loop.do = nestedBound
      }

      // Handle nested steps in decisions
      if (step.kind === 'decide' && (step as any).decide) {
        if ((step as any).decide.then) {
          const thenBound = await this.bindSteps((step as any).decide.then, connectedPlugins)
          ;(boundStep as any).decide.then = thenBound
        }
        if ((step as any).decide.else) {
          const elseBound = await this.bindSteps((step as any).decide.else, connectedPlugins)
          ;(boundStep as any).decide.else = elseBound
        }
      }

      // Handle nested steps in parallel branches
      if (step.kind === 'parallel' && (step as any).parallel?.branches) {
        const branches = (step as any).parallel.branches
        for (let i = 0; i < branches.length; i++) {
          const branch = branches[i]
          if (branch.steps) {
            branch.steps = await this.bindSteps(branch.steps, connectedPlugins)
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
    connectedPlugins: Record<string, any>
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

    // Direction #3: Retain full ranked list for Phase 2b re-selection
    boundStep._ranked_candidates = scoredCandidates

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

    return boundStep
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

  /**
   * WP-2: Reconcile field references in bound steps against the data_schema.
   *
   * Walks all value references ({kind: "ref", ref: "X", field: "Y"}) and checks
   * if field "Y" exists in the source variable's schema (from data_schema.slots).
   * If not, tries resolution strategies:
   *   1. Prefix stripping: message_id → id, file_id → id, contact_id → id
   *   2. Case-insensitive match: Subject → subject
   *   3. Underscore/space normalization: lead_name → "Lead Name"
   *
   * Rewrites the field name in place so the IR converter gets correct references.
   */
  private reconcileFieldReferences(steps: BoundStep[], dataSchema: any): number {
    let count = 0

    // Build field lookup: variable name → set of known field names
    const fieldsByVariable = new Map<string, Set<string>>()
    if (dataSchema?.slots) {
      for (const [varName, slot] of Object.entries(dataSchema.slots) as [string, any][]) {
        const fields = new Set<string>()
        // Direct properties
        const props = slot.schema?.properties || slot.schema?.items?.properties || {}
        for (const key of Object.keys(props)) {
          fields.add(key)
        }
        if (fields.size > 0) {
          fieldsByVariable.set(varName, fields)
        }
      }
    }

    const reconcileValue = (value: any): void => {
      if (!value || typeof value !== 'object') return

      if (value.kind === 'ref' && typeof value.field === 'string' && typeof value.ref === 'string') {
        const varName = value.ref
        const field = value.field
        const knownFields = fieldsByVariable.get(varName)

        if (knownFields && !knownFields.has(field)) {
          // Strategy 1: Prefix stripping (message_id → id)
          if (field.endsWith('_id') && knownFields.has('id')) {
            logger.info({ ref: varName, from: field, to: 'id' }, '[WP-2] Reconciled field ref (prefix strip)')
            value.field = 'id'
            count++
            return
          }

          // Strategy 2: Case-insensitive match
          for (const known of knownFields) {
            if (known.toLowerCase() === field.toLowerCase()) {
              logger.info({ ref: varName, from: field, to: known }, '[WP-2] Reconciled field ref (case match)')
              value.field = known
              count++
              return
            }
          }

          // Strategy 3: Underscore/space normalization
          const normalized = field.replace(/_/g, ' ')
          for (const known of knownFields) {
            if (known.toLowerCase() === normalized.toLowerCase()) {
              logger.info({ ref: varName, from: field, to: known }, '[WP-2] Reconciled field ref (space/underscore)')
              value.field = known
              count++
              return
            }
          }

          logger.warn({ ref: varName, field, knownFields: [...knownFields] },
            '[WP-2] Field not found in source schema and could not be reconciled')
        }
      }

      // Recurse into arrays and objects
      if (Array.isArray(value)) {
        value.forEach(reconcileValue)
      } else {
        for (const val of Object.values(value)) {
          reconcileValue(val)
        }
      }
    }

    const walkSteps = (steps: BoundStep[]): void => {
      for (const step of steps) {
        // Walk all value-bearing fields in the step
        reconcileValue(step)

        // Recurse into nested steps
        if ((step as any).loop?.do) walkSteps((step as any).loop.do)
        if ((step as any).decide?.then) walkSteps((step as any).decide.then)
        if ((step as any).decide?.else) walkSteps((step as any).decide.else)
        if ((step as any).parallel?.branches) {
          for (const branch of (step as any).parallel.branches) {
            if (branch.steps) walkSteps(branch.steps)
          }
        }
      }
    }

    walkSteps(steps)
    return count
  }

  /**
   * Direction #3 — Phase 2b: Validate input-type compatibility for all bound steps.
   *
   * For each bound step with _ranked_candidates:
   * 1. Check the current binding against the data_schema using InputTypeChecker
   * 2. If incompatible, try the next candidate in the ranked list
   * 3. If no candidate survives, mark unbound with reason 'input_type_incompatible'
   *
   * Mutates boundSteps in place.
   */
  private validateInputTypeCompatibility(
    boundSteps: BoundStep[],
    dataSchema: WorkflowDataSchema,
  ): void {
    const checker = new InputTypeChecker()

    const walkSteps = (steps: BoundStep[]): void => {
      for (const step of steps) {
        if (step.plugin_key && step.action && step._ranked_candidates) {
          this.checkAndReselect(step, checker, dataSchema)
        }

        // Recurse into nested steps
        if ((step as any).loop?.do) walkSteps((step as any).loop.do)
        if ((step as any).decide?.then) walkSteps((step as any).decide.then)
        if ((step as any).decide?.else) walkSteps((step as any).decide.else)
        if ((step as any).parallel?.branches) {
          for (const branch of (step as any).parallel.branches) {
            if (branch.steps) walkSteps(branch.steps)
          }
        }
      }
    }

    walkSteps(boundSteps)
  }

  /**
   * Check a single bound step's input-type compatibility.
   * If the current binding fails, try next candidates in rank order.
   */
  private checkAndReselect(
    step: BoundStep,
    checker: InputTypeChecker,
    dataSchema: WorkflowDataSchema,
  ): void {
    const candidates = step._ranked_candidates
    if (!candidates || candidates.length === 0) return

    // Get the step's input refs
    const stepInputs = step.inputs as string[] | undefined

    // Try each candidate in rank order
    const rejections: Array<{ plugin_key: string; action_name: string; rejection_reason: string }> = []

    for (const candidate of candidates) {
      const result = checker.check(
        candidate.action,
        stepInputs,
        dataSchema,
        step.id,
      )

      if (result.compatible) {
        // If we had to swap (current binding was rejected), rebind to this candidate
        if (candidate.plugin_key !== step.plugin_key || candidate.action_name !== step.action) {
          logger.info(
            {
              step_id: step.id,
              rejected: `${step.plugin_key}.${step.action}`,
              selected: `${candidate.plugin_key}.${candidate.action_name}`,
              rejections: rejections.map(r => r.rejection_reason),
            },
            '[Phase 2b] Input-type check: swapped to compatible candidate'
          )

          step.plugin_key = candidate.plugin_key
          step.action = candidate.action_name
          step.binding_confidence = Math.min(candidate.score, 1.0)
          step.binding_reason = [
            ...(step.binding_reason || []),
            `✅ Input types compatible (Phase 2b)`,
          ]
        }

        step.rejected_candidates = rejections.length > 0 ? rejections : undefined
        return // Found a compatible candidate
      }

      // This candidate failed — record rejection
      const violation = result.violations[0]
      rejections.push({
        plugin_key: candidate.plugin_key,
        action_name: candidate.action_name,
        rejection_reason: violation?.reason || 'input_type_incompatible',
      })
    }

    // All candidates failed input-type check
    logger.warn(
      {
        step_id: step.id,
        originalBinding: `${step.plugin_key}.${step.action}`,
        rejections,
      },
      '[Phase 2b] All candidates rejected by input-type check — marking unbound'
    )

    step.plugin_key = undefined
    step.action = undefined
    step.binding_method = 'unbound'
    step.binding_reason = [
      ...(step.binding_reason || []),
      'input_type_incompatible',
    ]
    step.rejected_candidates = rejections
  }

  /**
   * Remove internal-only fields from bound steps before returning.
   * _ranked_candidates holds full ActionDefinition/PluginDefinition objects
   * that are only needed during Phase 2b and would massively bloat serialized output.
   */
  private cleanupInternalFields(steps: BoundStep[]): void {
    for (const step of steps) {
      delete step._ranked_candidates

      if ((step as any).loop?.do) this.cleanupInternalFields((step as any).loop.do)
      if ((step as any).decide?.then) this.cleanupInternalFields((step as any).decide.then)
      if ((step as any).decide?.else) this.cleanupInternalFields((step as any).decide.else)
      if ((step as any).parallel?.branches) {
        for (const branch of (step as any).parallel.branches) {
          if (branch.steps) this.cleanupInternalFields(branch.steps)
        }
      }
    }
  }
}
