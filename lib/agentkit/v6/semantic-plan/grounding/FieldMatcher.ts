/**
 * FieldMatcher - Fuzzy field name matching utility
 *
 * Matches semantic field names against actual data source field names using:
 * - Levenshtein distance (edit distance)
 * - Case-insensitive matching
 * - Space/underscore normalization
 * - Email format validation for recipient fields
 * - Confidence scoring
 */

export interface FieldWithDescription {
  name: string
  description?: string
}

export interface FieldMatchResult {
  matched: boolean
  actual_field_name: string | null
  confidence: number // 0.0 to 1.0
  match_method: 'exact' | 'case_insensitive' | 'normalized' | 'fuzzy' | 'description' | 'none'
  similarity_score?: number // For fuzzy matches
  matched_via_description?: boolean // True if matched using field description
  candidates?: Array<{
    field_name: string
    score: number
  }>
}

export interface FieldMatchOptions {
  // Minimum similarity threshold for fuzzy matching (0.0 to 1.0)
  min_similarity?: number

  // Maximum number of candidate matches to return
  max_candidates?: number

  // Whether to require email format validation
  require_email_format?: boolean

  // Whether to normalize spaces/underscores
  normalize_separators?: boolean
}

export class FieldMatcher {
  private defaultOptions: Required<FieldMatchOptions> = {
    min_similarity: 0.7,
    max_candidates: 3,
    require_email_format: false,
    normalize_separators: true
  }

  /**
   * Match a semantic field name against fields with descriptions (PREFERRED METHOD)
   * This method uses both field names AND descriptions for semantic matching
   *
   * Example:
   * matchFieldWithDescriptions("email content", [
   *   { name: "snippet", description: "USE THIS for content matching/filtering" },
   *   { name: "body", description: "Email body text (usually empty)" }
   * ])
   * // Returns: { matched: true, actual_field_name: "snippet", match_method: "description" }
   */
  matchFieldWithDescriptions(
    semanticName: string,
    availableFields: FieldWithDescription[],
    options?: FieldMatchOptions
  ): FieldMatchResult {
    const opts = { ...this.defaultOptions, ...options }
    const normalizedSemantic = this.normalizeFieldName(semanticName)

    // Step 1: Try exact name match
    const exactMatch = availableFields.find(f => f.name === semanticName)
    if (exactMatch) {
      return {
        matched: true,
        actual_field_name: exactMatch.name,
        confidence: 1.0,
        match_method: 'exact',
        matched_via_description: false
      }
    }

    // Step 2: Try case-insensitive name match
    const caseInsensitiveMatch = availableFields.find(
      f => f.name.toLowerCase() === semanticName.toLowerCase()
    )
    if (caseInsensitiveMatch) {
      return {
        matched: true,
        actual_field_name: caseInsensitiveMatch.name,
        confidence: 0.95,
        match_method: 'case_insensitive',
        matched_via_description: false
      }
    }

    // Step 3: Try normalized name match
    if (opts.normalize_separators) {
      const normalizedMatch = availableFields.find(
        f => this.normalizeFieldName(f.name) === normalizedSemantic
      )
      if (normalizedMatch) {
        return {
          matched: true,
          actual_field_name: normalizedMatch.name,
          confidence: 0.9,
          match_method: 'normalized',
          matched_via_description: false
        }
      }
    }

    // Step 4: NEW - Semantic matching via field descriptions
    // This is the KEY improvement for handling cases like "email content" → "snippet"
    const descriptionMatches: Array<{ field: FieldWithDescription; score: number }> = []

    for (const field of availableFields) {
      if (!field.description) continue

      const normalizedDescription = this.normalizeFieldName(field.description)

      // Check if semantic name appears in description (keyword matching)
      const semanticTokens = normalizedSemantic.split('_').filter(t => t.length > 2)
      let matchScore = 0

      for (const token of semanticTokens) {
        if (normalizedDescription.includes(token)) {
          matchScore += 0.3 // Each keyword match adds 0.3
        }
      }

      // Bonus for explicit instructions in description
      if (normalizedDescription.includes('use_this') || normalizedDescription.includes('use_for')) {
        matchScore += 0.2
      }

      // Bonus for matching exact phrase
      if (normalizedDescription.includes(normalizedSemantic)) {
        matchScore += 0.5
      }

      if (matchScore > 0) {
        descriptionMatches.push({ field, score: Math.min(matchScore, 1.0) })
      }
    }

    // Sort by score and return best description match
    if (descriptionMatches.length > 0) {
      descriptionMatches.sort((a, b) => b.score - a.score)
      const best = descriptionMatches[0]

      if (best.score >= 0.5) { // Require at least 50% confidence for description matches
        return {
          matched: true,
          actual_field_name: best.field.name,
          confidence: best.score,
          match_method: 'description',
          similarity_score: best.score,
          matched_via_description: true,
          candidates: descriptionMatches.slice(0, opts.max_candidates).map(m => ({
            field_name: m.field.name,
            score: m.score
          }))
        }
      }
    }

    // Step 5: Fuzzy name matching (fallback)
    const fieldNames = availableFields.map(f => f.name)
    const fuzzyMatches = this.fuzzyMatchAll(normalizedSemantic, fieldNames, opts)

    if (fuzzyMatches.length > 0 && fuzzyMatches[0].score >= opts.min_similarity) {
      return {
        matched: true,
        actual_field_name: fuzzyMatches[0].field_name,
        confidence: fuzzyMatches[0].score,
        match_method: 'fuzzy',
        similarity_score: fuzzyMatches[0].score,
        matched_via_description: false,
        candidates: fuzzyMatches.slice(0, opts.max_candidates)
      }
    }

    // Step 6: No match found
    return {
      matched: false,
      actual_field_name: null,
      confidence: 0.0,
      match_method: 'none',
      matched_via_description: false,
      candidates: fuzzyMatches.slice(0, opts.max_candidates)
    }
  }

  /**
   * Match a semantic field name against available field names (LEGACY METHOD)
   * Use matchFieldWithDescriptions() instead for better semantic matching
   */
  matchField(
    semanticName: string,
    availableFields: string[],
    options?: FieldMatchOptions
  ): FieldMatchResult {
    const opts = { ...this.defaultOptions, ...options }

    // Step 1: Try exact match
    const exactMatch = availableFields.find(f => f === semanticName)
    if (exactMatch) {
      return {
        matched: true,
        actual_field_name: exactMatch,
        confidence: 1.0,
        match_method: 'exact'
      }
    }

    // Step 2: Try case-insensitive match
    const caseInsensitiveMatch = availableFields.find(
      f => f.toLowerCase() === semanticName.toLowerCase()
    )
    if (caseInsensitiveMatch) {
      return {
        matched: true,
        actual_field_name: caseInsensitiveMatch,
        confidence: 0.95,
        match_method: 'case_insensitive'
      }
    }

    // Step 3: Try normalized match (spaces/underscores)
    if (opts.normalize_separators) {
      const normalizedSemantic = this.normalizeFieldName(semanticName)
      const normalizedMatch = availableFields.find(
        f => this.normalizeFieldName(f) === normalizedSemantic
      )
      if (normalizedMatch) {
        return {
          matched: true,
          actual_field_name: normalizedMatch,
          confidence: 0.9,
          match_method: 'normalized'
        }
      }
    }

    // Step 4: Fuzzy matching with Levenshtein distance
    const fuzzyMatches = this.fuzzyMatchAll(semanticName, availableFields, opts)

    if (fuzzyMatches.length > 0 && fuzzyMatches[0].score >= opts.min_similarity) {
      return {
        matched: true,
        actual_field_name: fuzzyMatches[0].field_name,
        confidence: fuzzyMatches[0].score,
        match_method: 'fuzzy',
        similarity_score: fuzzyMatches[0].score,
        candidates: fuzzyMatches.slice(0, opts.max_candidates)
      }
    }

    // Step 5: No match found
    return {
      matched: false,
      actual_field_name: null,
      confidence: 0.0,
      match_method: 'none',
      candidates: fuzzyMatches.slice(0, opts.max_candidates)
    }
  }

  /**
   * Match multiple field candidates against available fields
   * Returns the best match from all candidates
   */
  matchMultipleCandidates(
    candidates: string[],
    availableFields: string[],
    options?: FieldMatchOptions
  ): FieldMatchResult {
    const allMatches: Array<FieldMatchResult & { candidate: string }> = []

    for (const candidate of candidates) {
      const result = this.matchField(candidate, availableFields, options)
      if (result.matched) {
        allMatches.push({ ...result, candidate })
      }
    }

    // Sort by confidence, return best match
    if (allMatches.length > 0) {
      allMatches.sort((a, b) => b.confidence - a.confidence)
      const best = allMatches[0]

      return {
        matched: best.matched,
        actual_field_name: best.actual_field_name,
        confidence: best.confidence,
        match_method: best.match_method,
        similarity_score: best.similarity_score,
        candidates: allMatches.slice(0, 3).map(m => ({
          field_name: m.actual_field_name!,
          score: m.confidence
        }))
      }
    }

    // No matches found, try fuzzy on all candidates
    const allFuzzyMatches: Array<{ field_name: string; score: number; candidate: string }> = []

    for (const candidate of candidates) {
      const fuzzyMatches = this.fuzzyMatchAll(candidate, availableFields, options)
      fuzzyMatches.forEach(m => {
        allFuzzyMatches.push({ ...m, candidate })
      })
    }

    // Sort and return best fuzzy match
    allFuzzyMatches.sort((a, b) => b.score - a.score)
    const opts = { ...this.defaultOptions, ...options }

    if (allFuzzyMatches.length > 0 && allFuzzyMatches[0].score >= opts.min_similarity) {
      return {
        matched: true,
        actual_field_name: allFuzzyMatches[0].field_name,
        confidence: allFuzzyMatches[0].score,
        match_method: 'fuzzy',
        similarity_score: allFuzzyMatches[0].score,
        candidates: allFuzzyMatches.slice(0, opts.max_candidates)
      }
    }

    return {
      matched: false,
      actual_field_name: null,
      confidence: 0.0,
      match_method: 'none',
      candidates: allFuzzyMatches.slice(0, opts.max_candidates)
    }
  }

  // REMOVED: validateEmailField() - Dead code, never called

  /**
   * Normalize field name for matching
   * - Lowercase
   * - Replace underscores/spaces with consistent separator
   * - Trim whitespace
   */
  private normalizeFieldName(fieldName: string): string {
    return fieldName
      .toLowerCase()
      .trim()
      .replace(/[\s_-]+/g, '_') // Normalize all separators to underscore
  }

  /**
   * Fuzzy match against all available fields using Levenshtein distance
   */
  private fuzzyMatchAll(
    semanticName: string,
    availableFields: string[],
    options?: FieldMatchOptions
  ): Array<{ field_name: string; score: number }> {
    const opts = { ...this.defaultOptions, ...options }
    const matches: Array<{ field_name: string; score: number }> = []

    const normalizedSemantic = this.normalizeFieldName(semanticName)

    for (const field of availableFields) {
      const normalizedField = this.normalizeFieldName(field)
      const distance = this.levenshteinDistance(normalizedSemantic, normalizedField)

      // Convert distance to similarity score (0.0 to 1.0)
      const maxLength = Math.max(normalizedSemantic.length, normalizedField.length)
      const similarity = maxLength > 0 ? 1 - (distance / maxLength) : 1.0

      if (similarity >= opts.min_similarity) {
        matches.push({ field_name: field, score: similarity })
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score)

    return matches.slice(0, opts.max_candidates)
  }

  /**
   * Calculate Levenshtein distance (edit distance) between two strings
   * https://en.wikipedia.org/wiki/Levenshtein_distance
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length
    const len2 = str2.length

    // Create a 2D matrix
    const matrix: number[][] = []

    // Initialize first column
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i]
    }

    // Initialize first row
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1

        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // Deletion
          matrix[i][j - 1] + 1,      // Insertion
          matrix[i - 1][j - 1] + cost // Substitution
        )
      }
    }

    return matrix[len1][len2]
  }

  // REMOVED: isSalespersonField() - Dead code, never called
  // REMOVED: isStageField() - Dead code, never called
}
