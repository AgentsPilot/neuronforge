/**
 * GroundingEngine - Validates Semantic Plan assumptions against real data
 *
 * Architecture:
 * 1. Takes Semantic Plan (understanding with assumptions)
 * 2. Takes Data Source Metadata (actual headers, sample data)
 * 3. Validates each assumption using FieldMatcher + DataSampler
 * 4. Produces Grounded Semantic Plan (verified assumptions, resolved field names)
 *
 * Key Features:
 * - Fuzzy field name resolution
 * - Data type validation
 * - Email field validation
 * - Pattern matching
 * - Confidence scoring
 * - Detailed validation evidence
 */

import type {
  SemanticPlan,
  GroundedSemanticPlan,
  Assumption,
  GroundingResult,
  GroundingError,
  FieldAssumption
} from '../schemas/semantic-plan-types'
import { FieldMatcher, type FieldMatchResult } from './FieldMatcher'
import { DataSampler, type DataSourceMetadata, type AssumptionValidationResult } from './DataSampler'

export interface GroundingConfig {
  // Minimum confidence threshold for accepting a match
  min_confidence?: number

  // Whether to fail fast on first validation error
  fail_fast?: boolean

  // Whether to require user confirmation for low-confidence matches
  require_confirmation_threshold?: number

  // Maximum number of field candidates to consider
  max_candidates?: number
}

export interface GroundingContext {
  semantic_plan: SemanticPlan
  data_source_metadata: DataSourceMetadata
  config?: GroundingConfig
}

export class GroundingEngine {
  private fieldMatcher: FieldMatcher
  private dataSampler: DataSampler
  private defaultConfig: Required<GroundingConfig> = {
    min_confidence: 0.7,
    fail_fast: false,
    require_confirmation_threshold: 0.85,
    max_candidates: 3
  }

  constructor() {
    this.fieldMatcher = new FieldMatcher()
    this.dataSampler = new DataSampler()
  }

  /**
   * Ground a Semantic Plan against real data
   * Main entry point for validation
   */
  async ground(context: GroundingContext): Promise<GroundedSemanticPlan> {
    const config = { ...this.defaultConfig, ...context.config }
    const { semantic_plan, data_source_metadata } = context

    const groundingResults: GroundingResult[] = []
    const groundingErrors: GroundingError[] = []
    let overallConfidence = 1.0
    let validatedCount = 0
    let skippedCount = 0
    let criticalSkippedCount = 0
    let totalAssumptions = semantic_plan.assumptions.length

    console.log(`[GroundingEngine] Starting grounding for ${totalAssumptions} assumptions`)

    // Validate each assumption
    for (const assumption of semantic_plan.assumptions) {
      try {
        const result = await this.validateAssumption(
          assumption,
          data_source_metadata,
          config
        )

        groundingResults.push(result)

        if (result.validated && !result.skipped) {
          // Real validation
          validatedCount++
          overallConfidence *= result.confidence
        } else if (result.skipped) {
          // Graceful degradation
          skippedCount++
          if (assumption.impact_if_wrong === 'critical') {
            criticalSkippedCount++
            groundingErrors.push({
              assumption_id: assumption.id,
              error_type: 'validation_skipped',
              message: `Critical assumption skipped: ${result.evidence || 'No metadata available'}`,
              severity: 'warning',
              suggested_fix: 'Provide complete metadata for all data sources'
            })
          }
          console.warn(`[GroundingEngine] ⚠️ Skipped assumption "${assumption.id}" (${assumption.impact_if_wrong})`)
        } else {
          // Failed validation
          groundingErrors.push({
            assumption_id: assumption.id,
            error_type: 'validation_failed',
            message: result.evidence || 'Assumption could not be validated',
            severity: assumption.impact_if_wrong === 'critical' ? 'error' : 'warning',
            suggested_fix: assumption.fallback || 'Manual correction required'
          })

          if (config.fail_fast && assumption.impact_if_wrong === 'critical') {
            console.error(`[GroundingEngine] Critical assumption failed: ${assumption.id}`)
            break
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`[GroundingEngine] Error validating assumption ${assumption.id}:`, errorMessage)

        groundingErrors.push({
          assumption_id: assumption.id,
          error_type: 'validation_error',
          message: errorMessage,
          severity: 'error',
          suggested_fix: assumption.fallback || 'Check assumption and retry'
        })

        if (config.fail_fast) {
          break
        }
      }
    }

    // Calculate final confidence (geometric mean of real validations only)
    const realValidationCount = validatedCount

    // CRITICAL: Prevent NaN when all assumptions skipped but overallConfidence=1.0
    // Math.pow(1.0, 1/0) = NaN, so check for this edge case
    let finalConfidence: number
    let allSkipped = false
    if (realValidationCount === 0) {
      // FIXED: If all assumptions were skipped, confidence should be 0 (not 0.5)
      // This signals to downstream that grounding is unreliable
      finalConfidence = 0.0
      allSkipped = true
      console.warn(`[GroundingEngine] ⚠️ All ${totalAssumptions} assumptions were skipped - confidence set to 0`)
    } else {
      // Normal case: geometric mean
      finalConfidence = Math.pow(overallConfidence, 1 / realValidationCount)
    }

    // CRITICAL: Fail if >50% of assumptions were skipped
    const skipRate = totalAssumptions > 0 ? skippedCount / totalAssumptions : 0
    if (skipRate > 0.5) {
      console.error(`[GroundingEngine] ✗ Grounding failed: ${skippedCount}/${totalAssumptions} assumptions skipped (${(skipRate * 100).toFixed(0)}%)`)
      groundingErrors.push({
        assumption_id: 'overall',
        error_type: 'insufficient_validation',
        message: `More than 50% of assumptions were skipped (${skippedCount}/${totalAssumptions}). Grounding cannot be trusted.`,
        severity: 'error',
        suggested_fix: 'Provide complete metadata for all data sources'
      })
    }

    const grounded: GroundedSemanticPlan = {
      ...semantic_plan,
      grounded: true,
      grounding_results: groundingResults,
      grounding_errors: groundingErrors,
      grounding_confidence: finalConfidence,
      grounding_timestamp: new Date().toISOString(),
      validated_assumptions_count: validatedCount,
      total_assumptions_count: totalAssumptions,
      all_assumptions_skipped: allSkipped,  // NEW: Explicit flag for downstream
      skipped_assumptions_count: skippedCount
    }

    console.log(`[GroundingEngine] Grounding complete: ${validatedCount} validated, ${skippedCount} skipped (${criticalSkippedCount} critical), confidence=${finalConfidence.toFixed(2)}`)

    return grounded
  }

  /**
   * Validate a single assumption
   */
  private async validateAssumption(
    assumption: Assumption,
    metadata: DataSourceMetadata,
    config: Required<GroundingConfig>
  ): Promise<GroundingResult> {
    console.log(`[GroundingEngine] Validating assumption: ${assumption.id} (${assumption.category})`)

    // Route to appropriate validation method based on category
    switch (assumption.category) {
      case 'field_name':
        return this.validateFieldNameAssumption(assumption, metadata, config)

      case 'data_type':
        return this.validateDataTypeAssumption(assumption, metadata, config)

      case 'value_format':
        return this.validateValueFormatAssumption(assumption, metadata, config)

      case 'structure':
        return this.validateStructureAssumption(assumption, metadata, config)

      case 'behavior':
        return this.validateBehaviorAssumption(assumption, metadata, config)

      default:
        console.warn(`[GroundingEngine] Unknown assumption category: ${assumption.category}`)
        return {
          assumption_id: assumption.id,
          validated: false,
          confidence: 0.0,
          resolved_value: null,
          validation_method: 'unknown',
          evidence: `Unknown assumption category: ${assumption.category}`
        }
    }
  }

  /**
   * Validate field_name assumption (most common)
   */
  private async validateFieldNameAssumption(
    assumption: Assumption,
    metadata: DataSourceMetadata,
    config: Required<GroundingConfig>
  ): Promise<GroundingResult> {
    // Graceful degradation: If metadata or headers missing, skip validation
    // This happens when grounding multiple data sources but only one metadata provided
    if (!metadata || !metadata.headers || metadata.headers.length === 0) {
      console.log(`[GroundingEngine] Skipping field_name assumption "${assumption.id}" - no metadata available (multi-datasource workflow)`)
      return {
        assumption_id: assumption.id,
        validated: false, // FIXED: Skipped ≠ validated (was true, now false)
        skipped: true,    // Flag as skipped for downstream handling
        confidence: 0.0,  // FIXED: Zero confidence when not validated (was 0.5)
        resolved_value: null,
        validation_method: 'skipped',
        evidence: 'No headers available in data source metadata (multi-datasource workflow - validation skipped)'
      }
    }

    // Extract field candidates from validation strategy
    const candidates = this.extractFieldCandidates(assumption)

    if (candidates.length === 0) {
      return {
        assumption_id: assumption.id,
        validated: false,
        confidence: 0.0,
        resolved_value: null,
        validation_method: 'field_match',
        evidence: 'No field candidates specified in assumption'
      }
    }

    // Try to match candidates against available fields
    // Prefer metadata.fields (with descriptions) over legacy metadata.headers
    let matchResult: any

    if (metadata.fields && metadata.fields.length > 0) {
      // NEW: Use semantic matching with field descriptions
      console.log(`[GroundingEngine] Using semantic matching with ${metadata.fields.length} fields (${metadata.fields.filter(f => f.description).length} have descriptions)`)

      // Try each candidate and pick the best match
      let bestMatch: any = null
      for (const candidate of candidates) {
        const result = this.fieldMatcher.matchFieldWithDescriptions(
          candidate,
          metadata.fields.map(f => ({ name: f.name, description: f.description })),
          {
            min_similarity: config.min_confidence,
            max_candidates: config.max_candidates,
            require_email_format: this.shouldRequireEmailFormat(assumption),
            normalize_separators: true
          }
        )

        if (result.matched && (!bestMatch || result.confidence > bestMatch.confidence)) {
          bestMatch = result
        }
      }

      matchResult = bestMatch || {
        matched: false,
        actual_field_name: null,
        confidence: 0.0,
        match_method: 'none',
        candidates: []
      }
    } else {
      // LEGACY: Fall back to name-only matching
      console.log(`[GroundingEngine] Using legacy name-only matching with ${metadata.headers?.length || 0} fields`)
      matchResult = this.fieldMatcher.matchMultipleCandidates(
        candidates,
        metadata.headers || [],
        {
          min_similarity: config.min_confidence,
          max_candidates: config.max_candidates,
          require_email_format: this.shouldRequireEmailFormat(assumption),
          normalize_separators: true
        }
      )
    }

    if (!matchResult.matched) {
      const availableFields = metadata.fields ? metadata.fields.map(f => f.name).join(', ') : (metadata.headers?.join(', ') || 'none')
      return {
        assumption_id: assumption.id,
        validated: false,
        confidence: matchResult.confidence,
        resolved_value: null,
        validation_method: 'field_match',
        evidence: `No matching field found. Tried: ${candidates.join(', ')}. Available: ${availableFields}`,
        alternatives: matchResult.candidates?.map((c: any) => ({
          value: c.field_name,
          confidence: c.score,
          reasoning: `${matchResult.match_method || 'fuzzy'} match with score ${c.score.toFixed(2)}`
        }))
      }
    }

    // Log successful match with method details
    console.log(`[GroundingEngine] ✓ Field matched: "${candidates[0]}" → "${matchResult.actual_field_name}" (method: ${matchResult.match_method}, confidence: ${matchResult.confidence.toFixed(2)})${matchResult.matched_via_description ? ' [via description]' : ''}`)

    // Field matched! Now validate with data sampling if we have sample data
    if (metadata.sample_rows && metadata.sample_rows.length > 0) {
      const fieldAssumption: FieldAssumption = {
        semantic_name: assumption.id,
        field_name_candidates: candidates,
        expected_type: this.extractExpectedType(assumption),
        required: assumption.impact_if_wrong === 'critical',
        reasoning: assumption.description
      }

      const dataValidation = await this.dataSampler.validateFieldAssumption(
        fieldAssumption,
        metadata,
        matchResult.actual_field_name!
      )

      // Combine field match confidence with data validation confidence
      const combinedConfidence = (matchResult.confidence + dataValidation.confidence) / 2

      return {
        assumption_id: assumption.id,
        validated: dataValidation.validated,
        confidence: combinedConfidence,
        resolved_value: matchResult.actual_field_name,
        validation_method: 'field_match_with_data_sample',
        evidence: `Field "${matchResult.actual_field_name}" matched via ${matchResult.match_method}. ${dataValidation.evidence.details}`,
        alternatives: matchResult.candidates?.map(c => ({
          value: c.field_name,
          confidence: c.score,
          reasoning: `Alternative field match`
        }))
      }
    }

    // No sample data, return field match result only
    return {
      assumption_id: assumption.id,
      validated: true,
      confidence: matchResult.confidence,
      resolved_value: matchResult.actual_field_name,
      validation_method: 'field_match',
      evidence: `Field "${matchResult.actual_field_name}" matched via ${matchResult.match_method} (no data validation available)`,
      alternatives: matchResult.candidates?.map(c => ({
        value: c.field_name,
        confidence: c.score,
        reasoning: `Alternative field match`
      }))
    }
  }

  /**
   * Validate data_type assumption
   */
  private async validateDataTypeAssumption(
    assumption: Assumption,
    metadata: DataSourceMetadata,
    config: Required<GroundingConfig>
  ): Promise<GroundingResult> {
    // Extract field name and expected type
    const fieldName = this.extractFieldName(assumption)
    const expectedType = this.extractExpectedType(assumption)

    if (!fieldName || !expectedType) {
      return {
        assumption_id: assumption.id,
        validated: false,
        confidence: 0.0,
        resolved_value: null,
        validation_method: 'data_type_check',
        evidence: 'Could not extract field name or expected type from assumption'
      }
    }

    if (!metadata.sample_rows || metadata.sample_rows.length === 0) {
      return {
        assumption_id: assumption.id,
        validated: false,
        confidence: 0.0,
        resolved_value: null,
        validation_method: 'data_type_check',
        evidence: 'No sample data available for type validation'
      }
    }

    // Sample and analyze data type
    const sampleResult = await this.dataSampler.sampleTabularData(metadata, fieldName, 10)

    if (!sampleResult.validation.is_valid) {
      return {
        assumption_id: assumption.id,
        validated: false,
        confidence: 0.0,
        resolved_value: null,
        validation_method: 'data_type_check',
        evidence: sampleResult.validation.errors.join('; ')
      }
    }

    const typeMatches = sampleResult.data_type === expectedType ||
      (expectedType === 'email' && sampleResult.data_type === 'string') ||
      (expectedType === 'date' && sampleResult.data_type === 'string')

    return {
      assumption_id: assumption.id,
      validated: typeMatches,
      confidence: typeMatches ? 0.95 : 0.3,
      resolved_value: sampleResult.data_type,
      validation_method: 'data_type_check',
      evidence: `Field "${fieldName}" contains ${sampleResult.data_type} data. Expected: ${expectedType}. Match: ${typeMatches}`
    }
  }

  /**
   * Validate value_format assumption (e.g., email format, date format)
   */
  private async validateValueFormatAssumption(
    assumption: Assumption,
    metadata: DataSourceMetadata,
    config: Required<GroundingConfig>
  ): Promise<GroundingResult> {
    const fieldName = this.extractFieldName(assumption)
    const pattern = this.extractPattern(assumption)

    if (!fieldName || !pattern) {
      return {
        assumption_id: assumption.id,
        validated: false,
        confidence: 0.0,
        resolved_value: null,
        validation_method: 'pattern_match',
        evidence: 'Could not extract field name or pattern from assumption'
      }
    }

    if (!metadata.sample_rows || metadata.sample_rows.length === 0) {
      return {
        assumption_id: assumption.id,
        validated: false,
        confidence: 0.0,
        resolved_value: null,
        validation_method: 'pattern_match',
        evidence: 'No sample data available for format validation'
      }
    }

    const patternResult = await this.dataSampler.validateFieldPattern(
      metadata,
      fieldName,
      new RegExp(pattern),
      0.8 // 80% of values must match
    )

    return {
      assumption_id: assumption.id,
      validated: patternResult.is_valid,
      confidence: patternResult.match_rate,
      resolved_value: pattern,
      validation_method: 'pattern_match',
      evidence: `${patternResult.matching_count}/${patternResult.sample_size} values matched pattern "${pattern}"`
    }
  }

  /**
   * Validate structure assumption (e.g., "data has header row")
   */
  private async validateStructureAssumption(
    assumption: Assumption,
    metadata: DataSourceMetadata,
    config: Required<GroundingConfig>
  ): Promise<GroundingResult> {
    // Graceful degradation for multi-datasource workflows
    if (!metadata || !metadata.headers) {
      console.log(`[GroundingEngine] Skipping structure assumption "${assumption.id}" - no metadata available`)
      return {
        assumption_id: assumption.id,
        validated: false, // FIXED: Skipped ≠ validated (was true, now false)
        skipped: true,    // Flag as skipped for downstream handling
        confidence: 0.0,  // FIXED: Zero confidence when not validated (was 0.5)
        resolved_value: null,
        validation_method: 'skipped',
        evidence: 'No metadata available (multi-datasource workflow - validation skipped)'
      }
    }

    // For now, assume structure is valid if we have headers
    const hasHeaders = metadata.headers && metadata.headers.length > 0

    return {
      assumption_id: assumption.id,
      validated: hasHeaders,
      confidence: hasHeaders ? 1.0 : 0.0,
      resolved_value: hasHeaders,
      validation_method: 'structure_check',
      evidence: hasHeaders
        ? `Data source has ${metadata.headers!.length} headers`
        : 'No headers found in data source'
    }
  }

  /**
   * Validate behavior assumption (e.g., "filter produces results")
   */
  private async validateBehaviorAssumption(
    assumption: Assumption,
    metadata: DataSourceMetadata,
    config: Required<GroundingConfig>
  ): Promise<GroundingResult> {
    // Behavior validation would require executing the operation
    // For now, mark as validated with medium confidence
    return {
      assumption_id: assumption.id,
      validated: true,
      confidence: 0.7,
      resolved_value: 'not_executed',
      validation_method: 'heuristic',
      evidence: 'Behavior validation not implemented, assuming valid'
    }
  }

  // Helper methods

  private extractFieldCandidates(assumption: Assumption): string[] {
    // Check validation_strategy.parameters.candidates
    if (assumption.validation_strategy?.parameters?.candidates) {
      return assumption.validation_strategy.parameters.candidates as string[]
    }

    // Try to extract from description
    const match = assumption.description.match(/column.*["']([^"']+)["']/i)
    if (match) {
      return [match[1]]
    }

    return []
  }

  private extractExpectedType(assumption: Assumption): 'string' | 'number' | 'date' | 'email' | 'boolean' | undefined {
    // Check validation_strategy.parameters
    if (assumption.validation_strategy?.parameters?.expected_type) {
      return assumption.validation_strategy.parameters.expected_type as any
    }

    // Check description for type hints
    if (assumption.description.toLowerCase().includes('email')) {
      return 'email'
    }
    if (assumption.description.toLowerCase().includes('date')) {
      return 'date'
    }
    if (assumption.description.toLowerCase().includes('number') ||
        assumption.description.toLowerCase().includes('numeric')) {
      return 'number'
    }

    return undefined
  }

  private extractFieldName(assumption: Assumption): string | null {
    // Try validation_strategy.parameters.field_name
    if (assumption.validation_strategy?.parameters?.field_name) {
      return assumption.validation_strategy.parameters.field_name as string
    }

    // Try to extract from description
    const match = assumption.description.match(/field\s+["']([^"']+)["']/i)
    if (match) {
      return match[1]
    }

    return null
  }

  private extractPattern(assumption: Assumption): string | null {
    // Try validation_strategy.parameters.pattern
    if (assumption.validation_strategy?.parameters?.pattern) {
      return assumption.validation_strategy.parameters.pattern as string
    }

    return null
  }

  private shouldRequireEmailFormat(assumption: Assumption): boolean {
    return assumption.description.toLowerCase().includes('email') ||
      assumption.validation_strategy?.parameters?.require_email_format === true
  }
}
