/**
 * Hard Requirements Extractor (LLM-Based)
 *
 * Following OpenAI's compiler approach: Extract machine-checkable constraints
 * from Enhanced Prompt that MUST be enforced through the pipeline.
 *
 * Uses GPT-4o-mini for reliable extraction from natural language.
 * Pattern matching is too brittle for the variety of user phrasings.
 *
 * Principle: Workflow creation is COMPILATION, not generation.
 * Every transformation must be: Lossless, Traceable, Constraint-preserving, Rejectable
 *
 * Uses ProviderFactory for centralized token tracking.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { ProviderFactory, PROVIDERS } from '@/lib/ai/providerFactory'
import { OPENAI_MODELS } from '@/lib/ai/providers/openaiProvider'
import type { CallContext } from '@/lib/ai/providers/baseProvider'

// Enhanced Prompt structure from Phase 0
export type EnhancedPrompt = {
  sections: {
    data: string[]
    actions?: string[]
    output?: string[]
    delivery: string[]
    processing_steps?: string[]
  }
  user_context?: any
  specifics?: any
  plan_title?: string
  plan_description?: string
}

/**
 * Hard Requirements - Non-negotiable constraints extracted from Enhanced Prompt
 */
export interface HardRequirements {
  /** Stable IDs for each requirement (R1, R2, R3...) */
  requirements: Array<{
    id: string
    type: 'unit_of_work' | 'threshold' | 'routing_rule' | 'invariant' |
          'empty_behavior' | 'required_output' | 'side_effect_constraint'

    /** Machine-checkable constraint */
    constraint: string

    /** Source in Enhanced Prompt */
    source: string
  }>

  /** Unit of work - what is being processed */
  unit_of_work: 'email' | 'attachment' | 'row' | 'file' | 'record' | null

  /** Thresholds that gate actions */
  thresholds: Array<{
    field: string
    operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'ne' | 'exists' | 'not_exists'
    value: any
    applies_to: string[]  // Which actions this gates
  }>

  /** Routing rules (deterministic, not user choices) */
  routing_rules: Array<{
    condition: string
    destination: string
    field_value: string
  }>

  /** Invariants - things that MUST NEVER happen */
  invariants: Array<{
    type: 'no_duplicate_writes' | 'sequential_dependency' | 'data_availability' | 'custom'
    description: string
    check: string
  }>

  /** Behavior when no data found */
  empty_behavior: 'fail' | 'skip' | 'notify' | null

  /** Fields that MUST exist in final outputs */
  required_outputs: string[]

  /** Constraints on when side effects can occur */
  side_effect_constraints: Array<{
    action: string
    allowed_when: string
    forbidden_when: string
  }>
}

/**
 * Requirement map - tracks how requirements flow through stages
 */
export interface RequirementMap {
  [requirementId: string]: {
    semantic_construct?: string
    grounded_capability?: string
    ir_node?: string
    dsl_step?: string
    status: 'pending' | 'mapped' | 'grounded' | 'compiled' | 'enforced'
  }
}

/**
 * Gate result - PASS or FAIL with reason
 */
export interface GateResult {
  stage: 'semantic' | 'grounding' | 'ir' | 'compilation' | 'validation'
  result: 'PASS' | 'FAIL'
  reason?: string
  unmapped_requirements?: string[]
  violated_constraints?: string[]
}

export interface RequirementsExtractorConfig {
  provider?: 'openai' | 'anthropic'
  model?: string
  temperature?: number
}

/**
 * Hard Requirements Extractor
 *
 * Extracts machine-checkable constraints from Enhanced Prompt using LLM.
 * LLM-based extraction is necessary to handle natural language variations.
 * Uses ProviderFactory for centralized token tracking.
 */
export class HardRequirementsExtractor {
  private systemPrompt: string
  private config: Required<RequirementsExtractorConfig>

  constructor(config: RequirementsExtractorConfig = {}) {
    // Set defaults
    this.config = {
      provider: config.provider || 'openai',
      model: config.model || OPENAI_MODELS.GPT_4O_MINI,
      temperature: config.temperature ?? 0.0
    }

    // ProviderFactory handles LLM client initialization - no direct SDK instantiation needed

    // Load system prompt from file
    // Use process.cwd() instead of __dirname for Next.js compatibility
    const promptPath = join(process.cwd(), 'lib', 'agentkit', 'v6', 'requirements', 'prompts', 'hard-requirements-extraction-system.md')
    this.systemPrompt = readFileSync(promptPath, 'utf-8')
  }

  /**
   * Extract hard requirements from Enhanced Prompt using LLM
   * Uses ProviderFactory for centralized token tracking
   */
  async extract(enhancedPrompt: EnhancedPrompt): Promise<HardRequirements> {
    console.log(`[HardRequirementsExtractor] Starting LLM-based extraction via ProviderFactory (${this.config.provider}/${this.config.model})...`)

    try {
      // Get provider from factory for centralized token tracking
      const providerName = this.config.provider === 'openai' ? PROVIDERS.OPENAI : PROVIDERS.ANTHROPIC
      const provider = ProviderFactory.getProvider(providerName)
      const context: CallContext = {
        userId: 'system',
        feature: 'v6_pipeline',
        component: 'HardRequirementsExtractor',
        category: 'agent_generation',
        activity_type: 'requirements_extraction',
        activity_name: 'extract_hard_requirements',
      }

      // Call LLM via ProviderFactory (returns OpenAI-compatible format)
      const response = await provider.chatCompletion({
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: 4000,
        response_format: this.config.provider === 'openai' ? { type: 'json_object' } : undefined,
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: JSON.stringify(enhancedPrompt, null, 2) }
        ]
      }, context)

      // ProviderFactory returns OpenAI-compatible format
      const content = response.choices?.[0]?.message?.content

      if (!content) {
        throw new Error('Empty response from LLM')
      }

      // Extract JSON from markdown code fences if present
      let jsonText = content.trim()
      const jsonMatch = jsonText.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim()
      }

      const extracted = JSON.parse(jsonText) as HardRequirements

      console.log(`[HardRequirementsExtractor] Extracted ${extracted.requirements?.length || 0} requirements`)
      console.log(`[HardRequirementsExtractor] Unit of work: ${extracted.unit_of_work || 'none'}`)
      console.log(`[HardRequirementsExtractor] Thresholds: ${extracted.thresholds?.length || 0}`)
      console.log(`[HardRequirementsExtractor] Routing rules: ${extracted.routing_rules?.length || 0}`)
      console.log(`[HardRequirementsExtractor] Invariants: ${extracted.invariants?.length || 0}`)
      console.log(`[HardRequirementsExtractor] Required outputs: ${extracted.required_outputs?.length || 0}`)

      return extracted
    } catch (error) {
      console.error('[HardRequirementsExtractor] LLM extraction failed:', error)

      // Fallback to empty requirements rather than failing the entire pipeline
      return {
        requirements: [],
        unit_of_work: null,
        thresholds: [],
        routing_rules: [],
        invariants: [],
        empty_behavior: null,
        required_outputs: [],
        side_effect_constraints: []
      }
    }
  }


  /**
   * Initialize requirement map with all requirement IDs
   */
  createRequirementMap(hardReqs: HardRequirements): RequirementMap {
    const map: RequirementMap = {}

    hardReqs.requirements.forEach(req => {
      map[req.id] = {
        status: 'pending'
      }
    })

    return map
  }
}
