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
import {
  evaluateExtractionCoverage,
  outputSchemaIsFileAttachment,
  baseVarOfRef,
  type ExtractCoverageVerdict,
  type CoverageField,
} from './ExtractionCoverage'

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
  /**
   * WP-62: authoritative deterministic-vs-AI extraction coverage verdict for an
   * `extract` step, authored by Phase 2c (`routeExtractionCoverage`). The IR
   * converter HONORS this verdict — it does not recompute coverage (Q1
   * anti-double-decision guard).
   */
  extract_coverage?: ExtractCoverageVerdict
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
        userConnected: Object.keys(connectedPlugins).length - systemPlugins.length,
        systemAdded: systemPlugins.length,
        total: Object.keys(connectedPlugins).length
      },
      '[CapabilityBinderV2] Loaded plugins (user + system)'
    )

    // WP-57: a `fetch_content` step that feeds a document extractor must return file
    // BYTES (download_file), not text (read_file_content). Mark those steps so bindStep
    // can prefer the bytes-returning candidate.
    const bytesFetchSteps = this.collectFetchStepsFeedingDocExtractor(intent.steps)

    // Phase 1: Bind all steps
    const boundSteps = await this.bindSteps(intent.steps, connectedPlugins, bytesFetchSteps)

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
    const { schema: dataSchema, warnings: schemaWarnings, fieldRenames } = schemaBuilder.build(boundSteps)

    boundIntent.data_schema = dataSchema

    // WP-63 A2 (M4): apply the SAME declared→canonical rename map Gap A emitted to
    // EVERY downstream reference shape — bare `filters[].field`/`key_field` literals,
    // `{{var.field}}` template strings, and structured `{kind:"ref"}` value refs — so
    // the filter/scatter references match the reconciled camelCase schema. Literal map
    // application scoped by data_schema membership: NO second fuzzy match (avoids the
    // divergence class SA flagged HIGH in WP-62). Runs BEFORE WP-2 reconciliation.
    if (fieldRenames.size > 0) {
      const rewritten = this.applyTransformFieldRenames(boundSteps, fieldRenames, dataSchema)
      logger.info(
        { renames: Object.fromEntries(fieldRenames), rewritten },
        '[WP-63/A2] Applied transform field renames to downstream references'
      )
    }

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

    // WP-62 — Phase 2c: Deterministic-vs-AI extraction coverage routing.
    // The AUTHORITATIVE coverage-then-bind decision. Runs AFTER Phase 2b so it is
    // the single, final decision-maker for every `extract` step: it either
    // authors a live deterministic document-extractor binding (covered) or leaves
    // the step unbound so the converter's AI branch fires (not covered). The IR
    // converter only HONORS this verdict (Q1 — no double-decision).
    this.routeExtractionCoverage(boundSteps, connectedPlugins, dataSchema)

    // Clean up internal-only fields before returning — _ranked_candidates
    // holds full ActionDefinition/PluginDefinition objects that would bloat
    // serialized output (JSON.stringify of the BoundIntentContract).
    this.cleanupInternalFields(boundSteps)

    return boundIntent
  }

  /**
   * Recursively bind steps (handles nested loops, decisions, parallel)
   */
  /**
   * WP-57: collect the IDs of `data_source`/`fetch_content` steps whose output is
   * consumed by an `extract` step in the `document` domain. Those fetches must return
   * file BYTES (download_file), not text (read_file_content) — enforced in bindStep.
   * Plugin-agnostic: pattern-matched on step kinds/capabilities, no action names.
   */
  private collectFetchStepsFeedingDocExtractor(steps: IntentStep[]): Set<string> {
    const marked = new Set<string>()
    const usesDomain = (s: any, domain: string) =>
      Array.isArray(s?.uses) && s.uses.some((u: any) => u?.domain === domain)
    const hasFetchContent = (s: any) =>
      Array.isArray(s?.uses) && s.uses.some((u: any) => u?.capability === 'fetch_content')

    const walk = (list: any[]) => {
      if (!Array.isArray(list)) return
      // Map each output RefName → its producing step (within this scope).
      const byOutput = new Map<string, any>()
      for (const s of list) {
        if (s?.output) byOutput.set(s.output, s)
      }
      for (const s of list) {
        if (s?.kind === 'extract' && usesDomain(s, 'document')) {
          const inputRef = s?.extract?.input
          const producer = typeof inputRef === 'string' ? byOutput.get(inputRef) : undefined
          if (producer && producer.kind === 'data_source' && hasFetchContent(producer)) {
            marked.add(producer.id)
          }
        }
        // Recurse into nested scopes.
        if (s?.loop?.do) walk(s.loop.do)
        if (s?.decide?.then) walk(s.decide.then)
        if (s?.decide?.else) walk(s.decide.else)
        if (s?.parallel?.branches) {
          for (const b of s.parallel.branches) if (b?.steps) walk(b.steps)
        }
      }
    }
    walk(steps as any[])
    return marked
  }

  private async bindSteps(
    steps: IntentStep[],
    connectedPlugins: Record<string, any>,
    bytesFetchSteps: Set<string> = new Set()
  ): Promise<BoundStep[]> {
    const boundSteps: BoundStep[] = []

    for (const step of steps) {
      const boundStep = await this.bindStep(step, connectedPlugins, bytesFetchSteps)

      // Handle nested steps in loops
      if (step.kind === 'loop' && (step as any).loop?.do) {
        const nestedBound = await this.bindSteps((step as any).loop.do, connectedPlugins, bytesFetchSteps)
        ;(boundStep as any).loop.do = nestedBound
      }

      // Handle nested steps in decisions
      if (step.kind === 'decide' && (step as any).decide) {
        if ((step as any).decide.then) {
          const thenBound = await this.bindSteps((step as any).decide.then, connectedPlugins, bytesFetchSteps)
          ;(boundStep as any).decide.then = thenBound
        }
        if ((step as any).decide.else) {
          const elseBound = await this.bindSteps((step as any).decide.else, connectedPlugins, bytesFetchSteps)
          ;(boundStep as any).decide.else = elseBound
        }
      }

      // Handle nested steps in parallel branches
      if (step.kind === 'parallel' && (step as any).parallel?.branches) {
        const branches = (step as any).parallel.branches
        for (let i = 0; i < branches.length; i++) {
          const branch = branches[i]
          if (branch.steps) {
            branch.steps = await this.bindSteps(branch.steps, connectedPlugins, bytesFetchSteps)
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
    bytesFetchSteps: Set<string> = new Set()
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

    // WP-57: downstream-aware preference. If this fetch step feeds a document extractor,
    // prefer the candidate that returns file BYTES (output annotated
    // x-semantic-type: file_attachment, e.g. download_file) over a text reader
    // (read_file_content) — the extractor needs bytes. Plugin-agnostic: keys off the
    // output annotation, not action names. Fills the downstream-context gap noted here.
    if (bytesFetchSteps.has(step.id)) {
      for (const c of scoredCandidates) {
        const out = (c.action as any)?.output_schema
        if (out && out['x-semantic-type'] === 'file_attachment') {
          c.score += 0.5
          c.reasons.push('✅ Preferred bytes-returning fetch — feeds a document extractor (WP-57)')
        }
      }
    }

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
   * WP-63 A2 (M4): apply Gap A's declared→canonical field rename map to EVERY
   * downstream reference shape, so filter/scatter references match the reconciled
   * camelCase schema (a schema-only fix would still empty the filter if the bare
   * `condition.field` literal stayed snake_case). This is a LITERAL map application
   * scoped by data_schema membership — NOT a second fuzzy match (the divergence
   * class SA flagged HIGH in WP-62).
   *
   * Covers: structured `{kind:"ref", ref, field}` refs, `{{var.field}}` template
   * strings, and bare field literals (`key_field`/`reference_key_field`) — resolved
   * against the reconciled data_schema so an unrelated same-named field is not touched.
   */
  private applyTransformFieldRenames(
    steps: BoundStep[],
    renames: Map<string, string>,
    dataSchema: any
  ): number {
    let count = 0

    // Item fields of a (possibly dotted, possibly loop/scatter-item) variable.
    const itemFieldsOf = (varName: string): Set<string> | null => {
      const schema = this.resolveVarSchema(varName, dataSchema)
      if (!schema) return null
      const target = schema.type === 'array' ? schema.items : schema
      const props = target?.properties
      return props && typeof props === 'object' ? new Set(Object.keys(props)) : null
    }

    // Return the canonical name to rewrite `field` on `varName` to, or null.
    // Scoped: only rewrite when the variable's reconciled slot carries the canonical
    // (and not the old declared name). Unknown variable → best-effort (the field was
    // reconciled from a real producer, so a stale reference is the expected case).
    const canonicalFor = (varName: string | undefined, field: string): string | null => {
      const canonical = renames.get(field)
      if (!canonical) return null
      if (!varName) return canonical
      const fields = itemFieldsOf(varName)
      if (!fields) return canonical
      if (fields.has(field)) return null // slot genuinely has the old name — leave it
      return fields.has(canonical) ? canonical : null
    }

    // Rewrite `{{var.field...}}` templates inside a string (immediate field only).
    const rewriteTemplates = (str: string): string =>
      str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, inner) => {
        const parts = String(inner).split('.')
        if (parts.length < 2) return whole
        const base = parts[0]
        const c = canonicalFor(base, parts[1])
        if (!c) return whole
        parts[1] = c
        count++
        return `{{${parts.join('.')}}}`
      })

    const BARE_FIELD_KEYS = new Set(['key_field', 'reference_key_field'])

    const rewriteNode = (node: any): void => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const v of node) rewriteNode(v)
        return
      }
      // Structured value ref.
      if (node.kind === 'ref' && typeof node.ref === 'string' && typeof node.field === 'string') {
        const c = canonicalFor(node.ref, node.field)
        if (c) {
          node.field = c
          count++
        }
      }
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'string') {
          // Bare field literal on a keyed position → best-effort (unknown var).
          if (BARE_FIELD_KEYS.has(k) && renames.has(v)) {
            ;(node as any)[k] = renames.get(v)
            count++
          } else if (v.includes('{{')) {
            const nv = rewriteTemplates(v)
            if (nv !== v) (node as any)[k] = nv
          }
        } else {
          rewriteNode(v)
        }
      }
    }

    const walk = (list: BoundStep[]): void => {
      for (const step of list) {
        rewriteNode(step)
        if ((step as any).loop?.do) walk((step as any).loop.do)
        if ((step as any).decide?.then) walk((step as any).decide.then)
        if ((step as any).decide?.else) walk((step as any).decide.else)
        if ((step as any).parallel?.branches) {
          for (const b of (step as any).parallel.branches) if (b?.steps) walk(b.steps)
        }
      }
    }
    walk(steps)
    return count
  }

  /**
   * Resolve a variable RefName (dotted-aware) to its SchemaField in the data_schema.
   * Mirrors DataSchemaBuilder.resolveInputSlotSchema so A2 and Gap A agree on lookup.
   */
  private resolveVarSchema(varName: string, dataSchema: any): any | null {
    const slots = dataSchema?.slots
    if (!slots || !varName) return null
    const clean = String(varName).replace(/\{\{|\}\}/g, '').trim()
    if (slots[clean]?.schema) return slots[clean].schema
    const parts = clean.split('.')
    let cur: any = slots[parts[0]]?.schema
    if (!cur) return null
    for (let i = 1; i < parts.length; i++) {
      if (!cur || typeof cur !== 'object') return null
      if (cur.type === 'array' && cur.items) cur = cur.items
      cur = cur.properties?.[parts[i]]
    }
    return cur || null
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
        // D-B20: Skip input-type validation for notify steps — they use structured
        // notify.content/notify.recipients, not standard input refs. The checker
        // rejects valid bindings because notify inputs don't match action input_entity.
        if (step.plugin_key && step.action && step._ranked_candidates && step.kind !== 'notify') {
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
   * WP-62 — Phase 2c: deterministic-vs-AI extraction coverage routing.
   *
   * For every `extract` step (including loop/decide/parallel-nested), runs the
   * schema-driven coverage predicate and AUTHORS the verdict:
   *  - covered  → live binding to the connected deterministic document-extractor
   *               (surface fields), with the meta/computed split recorded for the
   *               converter to synthesize a downstream AI step (CC-3a).
   *  - not covered → leave the step unbound so the converter's AI branch fires
   *               (the safety net, unchanged).
   *
   * Plugin-agnostic: the extractor is discovered from plugin *schema*
   * (domain+capability), and field producibility is judged from each field's
   * DECLARED SOURCE — never from field-name or plugin-identity lists.
   */
  private routeExtractionCoverage(
    boundSteps: BoundStep[],
    connectedPlugins: Record<string, any>,
    dataSchema: WorkflowDataSchema,
  ): void {
    // Build output-ref → producing step map across ALL scopes so a loop-internal
    // producer (the scatter `get_email_attachment → extract` shape) resolves
    // correctly — the RCA's gate-1 fix (loop-internal producer was missed).
    // NOTE: `(s as any).loop?.do` etc. mirror the untyped nested-step traversal used
    // throughout this file (findUnboundSteps / validateInputTypeCompatibility) — the
    // BoundStep union doesn't expose the control-flow bodies structurally. (SA Nit #6.)
    const producerByOutput = new Map<string, BoundStep>()
    const collectProducers = (steps: BoundStep[]): void => {
      for (const s of steps) {
        if (s.output) producerByOutput.set(s.output, s)
        if ((s as any).loop?.do) collectProducers((s as any).loop.do)
        if ((s as any).decide?.then) collectProducers((s as any).decide.then)
        if ((s as any).decide?.else) collectProducers((s as any).decide.else)
        if ((s as any).parallel?.branches) {
          for (const b of (s as any).parallel.branches) if (b?.steps) collectProducers(b.steps)
        }
      }
    }
    collectProducers(boundSteps)

    const walk = (steps: BoundStep[]): void => {
      for (const step of steps) {
        if (step.kind === 'extract') {
          this.applyExtractionCoverageVerdict(step, connectedPlugins, dataSchema, producerByOutput)
        }
        if ((step as any).loop?.do) walk((step as any).loop.do)
        if ((step as any).decide?.then) walk((step as any).decide.then)
        if ((step as any).decide?.else) walk((step as any).decide.else)
        if ((step as any).parallel?.branches) {
          for (const b of (step as any).parallel.branches) if (b?.steps) walk(b.steps)
        }
      }
    }
    walk(boundSteps)
  }

  /**
   * Resolve CC-1 (is the extract input a document/file?) and author the coverage
   * verdict onto a single extract step.
   */
  private applyExtractionCoverageVerdict(
    step: BoundStep,
    connectedPlugins: Record<string, any>,
    dataSchema: WorkflowDataSchema,
    producerByOutput: Map<string, BoundStep>,
  ): void {
    const extract = (step as any).extract
    if (!extract) return

    const inputRef: string | undefined = typeof extract.input === 'string' ? extract.input : undefined
    const fields: CoverageField[] = Array.isArray(extract.fields) ? extract.fields : []

    // CC-1 — resolve the input's producer output schema (loop-internal aware),
    // then fall back to the data_schema slot if the producer can't be located.
    const inputIsFile = this.extractInputIsFile(inputRef, producerByOutput, dataSchema)

    const verdict = evaluateExtractionCoverage({
      fields,
      fileTypes: extract.content_hints?.file_types,
      inputIsFile,
      connectedPlugins,
    })

    step.extract_coverage = verdict

    if (verdict.covered && verdict.deterministicPlugin) {
      // Author a live deterministic binding (surface subset).
      step.plugin_key = verdict.deterministicPlugin.pluginKey
      step.action = verdict.deterministicPlugin.action
      step.binding_confidence = 1.0
      step.binding_method = 'exact_match'
      step.binding_reason = [
        ...(step.binding_reason || []),
        `✅ [WP-62] Extraction coverage: ${verdict.reason}`,
      ]
      // A live binder-authored binding is not subject to the Phase-2b rejection
      // reroute in the converter — clear any stale incompatibility reason.
      step.rejected_candidates = undefined
      logger.info(
        {
          step_id: step.id,
          plugin: step.plugin_key,
          action: step.action,
          surfaceFields: verdict.surfaceFields.map((f) => f.name),
          residualFields: verdict.residualFields.map((f) => f.name),
          decidingCriterion: verdict.decidingCriterion,
        },
        '[WP-62/Phase2c] Extract covered by deterministic document-extractor — bound',
      )
    } else {
      // Not covered → leave unbound; converter routes to the AI branch (net preserved).
      step.plugin_key = undefined
      step.action = undefined
      step.binding_method = 'unbound'
      step.binding_reason = [
        ...(step.binding_reason || []),
        `[WP-62] extraction_not_covered:${verdict.decidingCriterion}`,
      ]
      logger.info(
        {
          step_id: step.id,
          decidingCriterion: verdict.decidingCriterion,
          reason: verdict.reason,
        },
        '[WP-62/Phase2c] Extract not covered by a deterministic extractor — routing to AI (net preserved)',
      )
    }
  }

  /**
   * CC-1 signal: does the extract's input resolve to a document/file (bytes-bearing
   * / file_attachment) source? Prefers the producer step's bound action output
   * schema (robust for loop-internal producers); falls back to the data_schema slot.
   *
   * SA Finding #1: the input ref is NORMALIZED to its base variable first (strip
   * `{{ }}`, drop a dotted field tail) via the SHARED `baseVarOfRef`. Without this,
   * the WELL-PHRASED plan the B1 steer produces — `extract.input` pointed at the
   * bytes field, e.g. `{{attachment_content.data}}` — would miss its producer and
   * be misjudged "not a file" → AI fallback (the exact inversion this WP kills).
   * Sharing `baseVarOfRef`/`outputSchemaIsFileAttachment` with the converter's
   * `inputLooksLikeFileAttachment` keeps the two in lockstep (no dead B3 code).
   */
  private extractInputIsFile(
    inputRef: string | undefined,
    producerByOutput: Map<string, BoundStep>,
    dataSchema: WorkflowDataSchema,
  ): boolean {
    if (!inputRef) return false

    const baseVar = baseVarOfRef(inputRef)
    // Try both the raw ref and the normalized base variable at each lookup, so a
    // dotted bytes-field ref (`{{x.data}}`) resolves to its `x` producer.
    const refKeys = Array.from(new Set([inputRef, baseVar]))

    // Primary: the producing step's bound action output schema (B2 annotation lands here).
    for (const key of refKeys) {
      const producer = producerByOutput.get(key)
      if (producer?.plugin_key && producer?.action) {
        const def = this.pluginManager.getPluginDefinition(producer.plugin_key)
        const outputSchema = (def as any)?.actions?.[producer.action]?.output_schema
        if (outputSchema && outputSchemaIsFileAttachment(outputSchema)) return true
      }
    }

    // Fallback: the data_schema slot for this ref (semantic_type / bytes fields).
    for (const key of refKeys) {
      const slot = (dataSchema as any)?.slots?.[key]
      if (slot?.schema && outputSchemaIsFileAttachment(slot.schema)) return true
    }

    return false
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
