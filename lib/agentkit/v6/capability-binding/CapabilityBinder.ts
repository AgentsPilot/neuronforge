/* lib/agentkit/v6/capability-binding/CapabilityBinder.ts */

import type { IntentContract, IntentStep as Step } from '../semantic-plan/types/intent-schema-types'
import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import { createLogger } from '@/lib/logger'
import { SubsetRefResolver, type SubsetResolutionResult } from './SubsetRefResolver'

const logger = createLogger({ module: 'CapabilityBinder', service: 'V6' })

/**
 * A step with resolved plugin binding
 */
export type BoundStep = Step & {
  plugin_key?: string
  action?: string
  binding_confidence?: number
  binding_method?: 'exact_match' | 'semantic_match' | 'metadata_match' | 'unbound'
}

export type BoundIntentContract = IntentContract & {
  steps: BoundStep[]
  subset_resolution?: SubsetResolutionResult
}

/**
 * Deterministic capability binding: maps semantic actions → plugin actions
 *
 * Strategy (NO HARDCODING - all data from Plugin Registry):
 * 1. Exact match: semantic_action matches capability name exactly
 * 2. Semantic match: semantic_action verb matches capability verb (string matching)
 * 3. Metadata match: use action.usage_context from plugin registry to match step description/type
 * 4. Unbound: mark as unbound if no match found (will need user clarification)
 */
export class CapabilityBinder {
  private subsetResolver: SubsetRefResolver

  constructor(private pluginManager: PluginManagerV2) {
    this.subsetResolver = new SubsetRefResolver()
  }

  /**
   * Bind all steps in the Intent Contract to actual plugin actions
   */
  async bind(intent: IntentContract): Promise<BoundIntentContract> {
    logger.info('[CapabilityBinder] Starting capability binding...')

    // Phase 0: Resolve subset references (aggregate subset auto-promotion)
    const subsetResolution = this.subsetResolver.resolve(intent)
    if (!subsetResolution.success) {
      logger.error(
        { errors: subsetResolution.errors },
        '[CapabilityBinder] Subset resolution failed - cannot proceed with binding'
      )
      throw new Error(
        `Subset resolution failed: ${subsetResolution.errors.join('; ')}`
      )
    }

    logger.info(
      { subsetCount: subsetResolution.subsets.size },
      '[CapabilityBinder] Subset resolution complete - promoted subset outputs to global RefNames'
    )

    const boundSteps = await this.bindSteps(intent.steps, intent.plugins)

    const boundIntent: BoundIntentContract = {
      ...intent,
      steps: boundSteps,
      subset_resolution: subsetResolution,
    }

    // Validate all steps are bound
    const unboundSteps = this.findUnboundSteps(boundSteps)
    if (unboundSteps.length > 0) {
      logger.warn({ unboundSteps: unboundSteps.map(s => s.id) }, '[CapabilityBinder] Some steps could not be bound')
    } else {
      logger.info('[CapabilityBinder] All steps successfully bound')
    }

    return boundIntent
  }

  /**
   * Recursively bind steps (handles nested loops)
   */
  private async bindSteps(steps: Step[], plugins: PluginNeed[]): Promise<BoundStep[]> {
    const boundSteps: BoundStep[] = []

    for (const step of steps) {
      const boundStep = await this.bindStep(step, plugins)

      // Handle nested steps in loops and decisions
      if (step.kind === 'loop' && (step as any).do) {
        const nestedBound = await this.bindSteps((step as any).do, plugins)
        ;(boundStep as any).do = nestedBound
      }

      if (step.kind === 'decide') {
        if ((step as any).then) {
          const thenBound = await this.bindSteps((step as any).then, plugins)
          ;(boundStep as any).then = thenBound
        }
        if ((step as any).else) {
          const elseBound = await this.bindSteps((step as any).else, plugins)
          ;(boundStep as any).else = elseBound
        }
      }

      if (step.kind === 'parallel' && (step as any).branches) {
        const branches = (step as any).branches
        for (let i = 0; i < branches.length; i++) {
          const branch = branches[i]
          if (branch.steps) {
            branch.steps = await this.bindSteps(branch.steps, plugins)
          }
        }
      }

      boundSteps.push(boundStep)
    }

    return boundSteps
  }

  /**
   * Bind a single step to a plugin action
   */
  private async bindStep(step: Step, plugins: PluginNeed[]): Promise<BoundStep> {
    const boundStep: BoundStep = { ...step }

    // Control flow steps don't bind to plugin actions
    if (step.kind === 'decide' || step.kind === 'loop' || step.kind === 'parallel') {
      boundStep.binding_method = 'unbound'
      return boundStep
    }

    // Get semantic_action from step (LLM-generated hint)
    const semanticAction = (step as any).semantic_action as string | undefined
    const stepDescription = (step as any).description as string | undefined

    // Strategy 1: Exact match (semantic_action === capability name)
    if (semanticAction) {
      const exactMatch = this.findExactMatch(semanticAction, plugins)
      if (exactMatch) {
        boundStep.plugin_key = exactMatch.plugin_key
        boundStep.action = exactMatch.action
        boundStep.binding_confidence = 1.0
        boundStep.binding_method = 'exact_match'
        logger.debug({ step_id: step.id, binding: exactMatch }, '[CapabilityBinder] Exact match found')
        return boundStep
      }
    }

    // Strategy 2: Semantic match (contains capability verb)
    if (semanticAction) {
      const semanticMatch = this.findSemanticMatch(semanticAction, plugins)
      if (semanticMatch) {
        boundStep.plugin_key = semanticMatch.plugin_key
        boundStep.action = semanticMatch.action
        boundStep.binding_confidence = semanticMatch.confidence
        boundStep.binding_method = 'semantic_match'
        logger.debug({ step_id: step.id, binding: semanticMatch }, '[CapabilityBinder] Semantic match found')
        return boundStep
      }
    }

    // Strategy 3: Metadata match (use usage_context from plugin registry)
    const metadataMatch = this.findMetadataMatch(step, stepDescription, plugins)
    if (metadataMatch) {
      boundStep.plugin_key = metadataMatch.plugin_key
      boundStep.action = metadataMatch.action
      boundStep.binding_confidence = metadataMatch.confidence
      boundStep.binding_method = 'metadata_match'
      logger.debug({ step_id: step.id, binding: metadataMatch }, '[CapabilityBinder] Metadata match found')
      return boundStep
    }

    // Could not bind
    boundStep.binding_method = 'unbound'
    logger.warn(
      { step_id: step.id, step_kind: step.kind, semantic_action: semanticAction },
      '[CapabilityBinder] Could not bind step'
    )

    return boundStep
  }

  /**
   * Strategy 1: Find exact match - semantic_action === capability name
   */
  private findExactMatch(
    semanticAction: string,
    plugins: PluginNeed[]
  ): { plugin_key: string; action: string } | null {
    for (const plugin of plugins) {
      // Check if semantic_action matches any capability exactly
      for (const capability of plugin.capabilities) {
        if (capability === semanticAction) {
          return { plugin_key: plugin.plugin_key, action: capability }
        }
      }
    }

    return null
  }

  /**
   * Strategy 2: Find semantic match - semantic_action contains capability verb
   * Examples:
   * - "search_unread_emails" matches "search_emails"
   * - "upload_file_to_folder" matches "upload_file"
   */
  private findSemanticMatch(
    semanticAction: string,
    plugins: PluginNeed[]
  ): { plugin_key: string; action: string; confidence: number } | null {
    const semanticLower = semanticAction.toLowerCase()

    let bestMatch: { plugin_key: string; action: string; confidence: number } | null = null

    for (const plugin of plugins) {
      for (const capability of plugin.capabilities) {
        const capabilityLower = capability.toLowerCase()

        // Check if semantic action contains the capability verb
        // e.g., "search_unread_emails_with_attachments" contains "search_emails"
        if (semanticLower.includes(capabilityLower)) {
          const confidence = capabilityLower.length / semanticLower.length // Longer match = higher confidence
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { plugin_key: plugin.plugin_key, action: capability, confidence }
          }
        }

        // Also check reverse: capability contains semantic action
        // e.g., "search_emails" contains "search"
        if (capabilityLower.includes(semanticLower)) {
          const confidence = semanticLower.length / capabilityLower.length
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { plugin_key: plugin.plugin_key, action: capability, confidence }
          }
        }
      }
    }

    return bestMatch
  }

  /**
   * Strategy 3: Find metadata match using Plugin Registry metadata
   * Uses action.usage_context from plugin definitions (NO HARDCODING)
   */
  private findMetadataMatch(
    step: Step,
    stepDescription: string | undefined,
    plugins: PluginNeed[]
  ): { plugin_key: string; action: string; confidence: number } | null {
    if (!stepDescription) {
      return null
    }

    const descriptionLower = stepDescription.toLowerCase()
    let bestMatch: { plugin_key: string; action: string; confidence: number } | null = null

    for (const plugin of plugins) {
      const pluginDef = this.pluginManager.getPluginDefinition(plugin.plugin_key)
      if (!pluginDef) continue

      // Iterate through all actions in the plugin
      for (const [actionName, actionDef] of Object.entries(pluginDef.actions)) {
        // Check if this action is in the plugin's declared capabilities
        if (!plugin.capabilities.includes(actionName)) continue

        const usageContext = actionDef.usage_context
        if (!usageContext) continue

        // Score based on usage_context match
        let score = 0
        let totalKeywords = 0

        // Check description field
        if (usageContext.description) {
          const contextDesc = usageContext.description.toLowerCase()
          if (descriptionLower.includes(contextDesc) || contextDesc.includes(descriptionLower)) {
            score += 0.3
          }
        }

        // Check keywords field (most important)
        if (usageContext.keywords && usageContext.keywords.length > 0) {
          totalKeywords = usageContext.keywords.length
          let matchedKeywords = 0

          for (const keyword of usageContext.keywords) {
            if (descriptionLower.includes(keyword.toLowerCase())) {
              matchedKeywords++
            }
          }

          if (matchedKeywords > 0) {
            score += (matchedKeywords / totalKeywords) * 0.7 // Keywords are weighted heavily
          }
        }

        // Update best match if this is better
        if (score > 0 && (!bestMatch || score > bestMatch.confidence)) {
          bestMatch = { plugin_key: plugin.plugin_key, action: actionName, confidence: score }
        }
      }
    }

    return bestMatch
  }

  /**
   * Find all unbound steps (for validation)
   */
  private findUnboundSteps(steps: BoundStep[]): BoundStep[] {
    const unbound: BoundStep[] = []

    for (const step of steps) {
      // Only report unbound for steps that should be bound (not control flow)
      if (step.binding_method === 'unbound' && step.kind !== 'decide' && step.kind !== 'loop' && step.kind !== 'parallel') {
        unbound.push(step)
      }

      // Check nested steps
      if (step.kind === 'loop' && (step as any).do) {
        unbound.push(...this.findUnboundSteps((step as any).do))
      }
      if (step.kind === 'decide') {
        if ((step as any).then) {
          unbound.push(...this.findUnboundSteps((step as any).then))
        }
        if ((step as any).else) {
          unbound.push(...this.findUnboundSteps((step as any).else))
        }
      }
      if (step.kind === 'parallel' && (step as any).branches) {
        for (const branch of (step as any).branches) {
          if (branch.steps) {
            unbound.push(...this.findUnboundSteps(branch.steps))
          }
        }
      }
    }

    return unbound
  }
}
