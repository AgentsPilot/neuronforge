/**
 * 5-Layer Ambiguity Detection Types
 *
 * These types define the structure of ambiguity detection results
 * used by the Review & Customize UI.
 */

// ============================================================================
// Input Types (from Semantic Plan and Grounding)
// ============================================================================

export interface SemanticPlanInput {
  goal: string
  understanding?: {
    data_sources?: Array<{
      source_description: string
      type: string
      location: string
      role: string
      [key: string]: any
    }>
    delivery?: {
      pattern?: string
      grouping?: string
      per_item?: boolean
      per_group?: boolean
      [key: string]: any
    }
    edge_cases?: Array<{
      scenario: string
      handling?: string
      recommended_action?: string
      [key: string]: any
    }>
    [key: string]: any
  }
  assumptions: Array<{
    id: string
    assumption: string
    confidence: number
    impact_if_wrong?: 'low' | 'medium' | 'high' | 'critical' | string
    category?: string
    [key: string]: any
  }>
  ambiguities?: Array<{
    id?: string
    description: string
    requires_user_input: boolean
    possible_resolutions?: string[]
    recommended_resolution?: string
    [key: string]: any
  }>
  inferences?: Array<{
    id: string
    inference: string
    based_on: string[]
    confidence: number
    [key: string]: any
  }>
  [key: string]: any
}

export interface GroundedPlanInput {
  grounded: boolean
  grounding_results: Array<{
    assumption_id: string
    assumption_text?: string
    field?: string
    validated: boolean
    confidence: number
    resolved_value?: any
    validation_method?: string
    alternatives?: Array<{
      value: any
      label?: string
      metadata?: Record<string, any>
    }>
    error?: string
    skipped?: boolean
  }>
  grounding_errors: Array<{
    assumption_id?: string
    error_type: string
    message: string
    severity: 'warning' | 'error'
  }>
  grounding_confidence: number
  validated_assumptions_count: number
  total_assumptions_count: number
}

export interface EnhancedPromptInput {
  sections?: {
    data?: string[]
    actions?: string[]
    output?: string[]
    delivery?: string[]
  }
  specifics?: {
    services_involved?: string[]
    trigger_scope?: string
  }
}

// ============================================================================
// Output Types (for Review UI)
// ============================================================================

export interface AmbiguityReport {
  must_confirm: MustConfirmItem[]
  should_review: ShouldReviewItem[]
  looks_good: LooksGoodItem[]
  grounding_ambiguities: GroundingAmbiguity[]
  overall_confidence: number
}

export interface MustConfirmItem {
  id: string
  layer: 1 | 2 | 3 | 4 | 5
  type: MustConfirmType
  title: string
  description: string
  options: ConfirmOption[]
  recommended?: string // ID of recommended option
  source_assumption_id?: string
}

export type MustConfirmType =
  | 'confidence_mismatch'      // Layer 1: Grounding confidence < semantic confidence
  | 'pattern_detected'         // Layer 2: Delivery pattern ambiguity (per_item vs per_group)
  | 'cross_conflict'           // Layer 3: Assumptions contradict each other
  | 'vague_language'           // Layer 4: Vague terms detected in prompt
  | 'business_risk'            // Layer 5: High-impact assumption (PII, irreversible)
  | 'fake_validation'          // Layer 1: Grounding returned "not implemented"
  | 'low_confidence'           // Layer 1: Very low confidence score
  | 'semantic_ambiguity'       // Layer 4: Semantic plan flagged as ambiguous

export interface ConfirmOption {
  id: string
  label: string
  description: string
  impact?: string
}

export interface ShouldReviewItem {
  id: string
  type: 'medium_confidence' | 'vague_detected' | 'conflict_potential' | 'inferred'
  assumption: string
  confidence: number
  grounding_result?: string
  source_assumption_id?: string
}

export interface LooksGoodItem {
  id: string
  assumption: string
  confidence: number
  validated_by: string
  source_assumption_id?: string
}

export interface GroundingAmbiguity {
  id: string
  field: string
  description: string
  discovered_options: AmbiguityOption[]
  source: 'grounding' | 'semantic'
}

export interface AmbiguityOption {
  id: string
  label: string
  metadata?: Record<string, any>
}

// ============================================================================
// Layer Detection Results
// ============================================================================

export interface LayerDetectionResult {
  layer: 1 | 2 | 3 | 4 | 5
  must_confirm: MustConfirmItem[]
  should_review: ShouldReviewItem[]
  looks_good: LooksGoodItem[]
}

// ============================================================================
// Detection Context
// ============================================================================

export interface DetectionContext {
  semanticPlan: SemanticPlanInput
  groundedPlan: GroundedPlanInput
  enhancedPrompt: EnhancedPromptInput
}
