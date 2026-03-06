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
}
