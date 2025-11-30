/**
 * ToonDataHelper: Bidirectional JSON <-> TOON conversion with validation
 *
 * TOON (Token-Oriented Object Notation) is a compact, schema-aware serialization
 * format optimized for LLM prompts and structured data exchange.
 *
 * Key Benefits:
 * - 30-60% token reduction compared to JSON for uniform arrays
 * - Better LLM comprehension due to explicit field declarations
 * - Drop-in compatibility - convert JSON <-> TOON losslessly
 *
 * @see docs/TOON_MIGRATION_GUIDE.md
 */

import { encode as toonEncode, decode as toonDecode } from '@toon-format/toon';

// ============================================================================
// Types
// ============================================================================

export interface ToonConversionResult {
  /** The TOON-formatted string */
  toon: string;
  /** Eligibility score (0-1) indicating how well-suited the data is for TOON */
  eligibilityScore: number;
}

export interface ToonConversionOptions {
  /** If true, logs a warning when eligibility score is below threshold */
  validateEligibility?: boolean;
  /** Minimum eligibility score threshold (default: 0.5) */
  eligibilityThreshold?: number;
}

export interface TokenSavingsReport {
  /** Original JSON string length in characters */
  originalSize: number;
  /** TOON string length in characters */
  toonSize: number;
  /** Percentage of size reduction */
  savingsPercent: number;
  /** Estimated original token count (chars / 4) */
  estimatedOriginalTokens: number;
  /** Estimated TOON token count (chars / 4) */
  estimatedToonTokens: number;
  /** Estimated tokens saved */
  estimatedTokensSaved: number;
}

export interface ArrayAnalysis {
  /** Name/key of the array field */
  fieldName: string;
  /** Number of items in the array */
  itemCount: number;
  /** Whether all items have the same structure */
  isUniform: boolean;
  /** Field names if uniform */
  fields: string[];
  /** Eligibility contribution (0-1) */
  eligibility: number;
}

// ============================================================================
// ToonDataHelper Class
// ============================================================================

/**
 * Utility class for converting between JSON and TOON formats.
 *
 * @example
 * ```typescript
 * // Convert to TOON
 * const { toon, eligibilityScore } = ToonDataHelper.toToon(data);
 *
 * // Convert back to JSON
 * const json = ToonDataHelper.fromToon(toon);
 *
 * // Check eligibility before converting
 * if (ToonDataHelper.calculateEligibility(data) > 0.6) {
 *   const { toon } = ToonDataHelper.toToon(data);
 * }
 * ```
 */
class ToonDataHelper {
  private static readonly DEFAULT_ELIGIBILITY_THRESHOLD = 0.5;
  private static readonly CHARS_PER_TOKEN = 4; // Rough estimate for English text

  /**
   * Convert JSON data to TOON format
   *
   * @param data - JavaScript object to convert
   * @param options - Optional configuration
   * @returns TOON-formatted string and eligibility score
   * @throws Error if encoding fails
   *
   * @example
   * ```typescript
   * const { toon, eligibilityScore } = ToonDataHelper.toToon({
   *   users: [
   *     { id: 1, name: 'Alice', role: 'admin' },
   *     { id: 2, name: 'Bob', role: 'user' }
   *   ]
   * });
   * // toon: "users[2]{id,name,role}:\n1,Alice,admin\n2,Bob,user"
   * ```
   */
  static toToon(
    data: Record<string, unknown>,
    options?: ToonConversionOptions
  ): ToonConversionResult {
    const eligibilityScore = this.calculateEligibility(data);
    const threshold = options?.eligibilityThreshold ?? this.DEFAULT_ELIGIBILITY_THRESHOLD;

    if (options?.validateEligibility && eligibilityScore < threshold) {
      console.warn(
        `[ToonDataHelper] Low TOON eligibility (${(eligibilityScore * 100).toFixed(1)}%). ` +
        `Consider keeping this data in JSON format for better efficiency.`
      );
    }

    try {
      const toon = toonEncode(data);
      return { toon, eligibilityScore };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`TOON encoding failed: ${message}`);
    }
  }

  /**
   * Convert TOON format back to JSON
   *
   * @param toonString - TOON-formatted string
   * @returns Parsed JavaScript object
   * @throws Error if decoding fails
   *
   * @example
   * ```typescript
   * const json = ToonDataHelper.fromToon("users[2]{id,name,role}:\n1,Alice,admin\n2,Bob,user");
   * // json: { users: [{ id: 1, name: 'Alice', role: 'admin' }, ...] }
   * ```
   */
  static fromToon(toonString: string): Record<string, unknown> {
    try {
      const json = toonDecode(toonString);
      return json as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`TOON decoding failed: ${message}`);
    }
  }

  /**
   * Validate that conversion preserves data integrity via round-trip
   *
   * @param original - Original data object
   * @param roundTripped - Data after JSON -> TOON -> JSON cycle
   * @returns true if data is identical, false otherwise
   *
   * @example
   * ```typescript
   * const original = { users: [...] };
   * const { toon } = ToonDataHelper.toToon(original);
   * const recovered = ToonDataHelper.fromToon(toon);
   * const isValid = ToonDataHelper.validateRoundTrip(original, recovered);
   * ```
   */
  static validateRoundTrip(
    original: Record<string, unknown>,
    roundTripped: Record<string, unknown>
  ): boolean {
    const originalJson = JSON.stringify(original, this.sortReplacer);
    const roundTrippedJson = JSON.stringify(roundTripped, this.sortReplacer);

    if (originalJson !== roundTrippedJson) {
      console.error('[ToonDataHelper] Round-trip validation failed!');
      console.error('Original:', originalJson.substring(0, 500));
      console.error('After conversion:', roundTrippedJson.substring(0, 500));
      return false;
    }

    return true;
  }

  /**
   * Perform a full round-trip test and return validation result
   *
   * @param data - Data to test
   * @returns Object with validation result and any error message
   */
  static testRoundTrip(data: Record<string, unknown>): {
    success: boolean;
    toon?: string;
    recovered?: Record<string, unknown>;
    error?: string;
  } {
    try {
      const { toon } = this.toToon(data);
      const recovered = this.fromToon(toon);
      const success = this.validateRoundTrip(data, recovered);

      return { success, toon, recovered };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Calculate TOON eligibility score (0-1)
   * Higher score = better candidate for TOON conversion
   *
   * Scoring factors:
   * - Array uniformity (consistent field structure across items)
   * - Array size (larger arrays benefit more from TOON)
   * - Data repetition (repeated keys multiply the benefit)
   *
   * @param data - Data to analyze
   * @returns Eligibility score between 0 and 1
   */
  static calculateEligibility(data: Record<string, unknown>): number {
    const analysis = this.analyzeArrays(data);

    if (analysis.length === 0) {
      return 0;
    }

    const totalEligibility = analysis.reduce((sum, arr) => sum + arr.eligibility, 0);
    return Math.min(totalEligibility / analysis.length, 1);
  }

  /**
   * Analyze arrays in the data structure for TOON suitability
   *
   * @param data - Data to analyze
   * @returns Array of analysis results for each array found
   */
  static analyzeArrays(data: Record<string, unknown>): ArrayAnalysis[] {
    const results: ArrayAnalysis[] = [];

    for (const key in data) {
      const value = data[key];

      if (Array.isArray(value) && value.length > 0) {
        const analysis = this.analyzeArray(key, value);
        results.push(analysis);
      } else if (typeof value === 'object' && value !== null) {
        // Recursively analyze nested objects
        const nested = this.analyzeArrays(value as Record<string, unknown>);
        results.push(...nested.map(n => ({
          ...n,
          fieldName: `${key}.${n.fieldName}`
        })));
      }
    }

    return results;
  }

  /**
   * Analyze a single array for uniformity and TOON eligibility
   */
  private static analyzeArray(fieldName: string, array: unknown[]): ArrayAnalysis {
    const firstItem = array[0];

    // Check if array contains objects
    if (typeof firstItem !== 'object' || firstItem === null) {
      // Simple value arrays have lower but still positive eligibility
      return {
        fieldName,
        itemCount: array.length,
        isUniform: true,
        fields: [],
        eligibility: Math.min(array.length / 50, 0.3) // Max 0.3 for simple arrays
      };
    }

    // Get field names from first item
    const firstKeys = Object.keys(firstItem as Record<string, unknown>).sort();

    // Check if all items have the same structure
    const isUniform = array.every(item => {
      if (typeof item !== 'object' || item === null) return false;
      const itemKeys = Object.keys(item as Record<string, unknown>).sort();
      return itemKeys.join(',') === firstKeys.join(',');
    });

    // Calculate eligibility based on uniformity and size
    let eligibility = 0;

    if (isUniform) {
      // Base score for uniform arrays
      eligibility = 0.6;

      // Bonus for larger arrays (up to 0.4 additional)
      const sizeBonus = Math.min(array.length / 100, 0.4);
      eligibility += sizeBonus;

      // Bonus for more fields (more savings per row)
      const fieldBonus = Math.min(firstKeys.length / 20, 0.1);
      eligibility += fieldBonus;
    } else {
      // Non-uniform arrays still get some credit
      eligibility = 0.1 + Math.min(array.length / 200, 0.2);
    }

    return {
      fieldName,
      itemCount: array.length,
      isUniform,
      fields: firstKeys,
      eligibility: Math.min(eligibility, 1)
    };
  }

  /**
   * Compare token usage before/after conversion
   * Helpful for reporting savings
   *
   * @param original - Original data object
   * @param toonString - TOON-formatted string
   * @returns Savings report with size and token estimates
   */
  static estimateTokenSavings(
    original: Record<string, unknown>,
    toonString: string
  ): TokenSavingsReport {
    const originalJson = JSON.stringify(original);
    const originalSize = originalJson.length;
    const toonSize = toonString.length;
    const savingsPercent = ((originalSize - toonSize) / originalSize) * 100;

    const estimatedOriginalTokens = Math.ceil(originalSize / this.CHARS_PER_TOKEN);
    const estimatedToonTokens = Math.ceil(toonSize / this.CHARS_PER_TOKEN);
    const estimatedTokensSaved = estimatedOriginalTokens - estimatedToonTokens;

    return {
      originalSize,
      toonSize,
      savingsPercent: Math.round(savingsPercent * 10) / 10,
      estimatedOriginalTokens,
      estimatedToonTokens,
      estimatedTokensSaved
    };
  }

  /**
   * Convert data to TOON only if eligibility exceeds threshold
   * Falls back to JSON.stringify if not eligible
   *
   * @param data - Data to convert
   * @param threshold - Minimum eligibility score (default: 0.6)
   * @returns Object with the serialized string and format used
   */
  static toToonOrJson(
    data: Record<string, unknown>,
    threshold = 0.6
  ): { content: string; format: 'toon' | 'json'; eligibility: number } {
    const eligibility = this.calculateEligibility(data);

    if (eligibility >= threshold) {
      const { toon } = this.toToon(data);
      return { content: toon, format: 'toon', eligibility };
    }

    return {
      content: JSON.stringify(data),
      format: 'json',
      eligibility
    };
  }

  /**
   * JSON replacer that sorts object keys for consistent comparison
   */
  private static sortReplacer(_key: string, value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce((sorted, key) => {
          sorted[key] = (value as Record<string, unknown>)[key];
          return sorted;
        }, {} as Record<string, unknown>);
    }
    return value;
  }

  /**
   * Generate a detailed report of TOON suitability for the data
   *
   * @param data - Data to analyze
   * @returns Formatted report string
   */
  static generateReport(data: Record<string, unknown>): string {
    const arrays = this.analyzeArrays(data);
    const overallEligibility = this.calculateEligibility(data);

    let report = '=== TOON Eligibility Report ===\n\n';
    report += `Overall Eligibility: ${(overallEligibility * 100).toFixed(1)}%\n`;
    report += `Recommendation: ${overallEligibility >= 0.6 ? 'USE TOON' : 'KEEP JSON'}\n\n`;

    if (arrays.length === 0) {
      report += 'No arrays found in data structure.\n';
      return report;
    }

    report += 'Array Analysis:\n';
    report += '-'.repeat(60) + '\n';

    for (const arr of arrays) {
      report += `\n${arr.fieldName}:\n`;
      report += `  Items: ${arr.itemCount}\n`;
      report += `  Uniform: ${arr.isUniform ? 'Yes' : 'No'}\n`;
      if (arr.fields.length > 0) {
        report += `  Fields: ${arr.fields.join(', ')}\n`;
      }
      report += `  Eligibility: ${(arr.eligibility * 100).toFixed(1)}%\n`;
    }

    // If eligible, show estimated savings
    if (overallEligibility >= 0.5) {
      try {
        const { toon } = this.toToon(data);
        const savings = this.estimateTokenSavings(data, toon);
        report += '\n' + '-'.repeat(60) + '\n';
        report += '\nEstimated Savings:\n';
        report += `  Original: ${savings.originalSize} chars (~${savings.estimatedOriginalTokens} tokens)\n`;
        report += `  TOON: ${savings.toonSize} chars (~${savings.estimatedToonTokens} tokens)\n`;
        report += `  Savings: ${savings.savingsPercent}% (~${savings.estimatedTokensSaved} tokens)\n`;
      } catch {
        report += '\n(Could not estimate savings - encoding error)\n';
      }
    }

    return report;
  }
}

export default ToonDataHelper;