/**
 * Fuzzy Matching Utilities
 *
 * Shared token-based fuzzy matching utilities used across V6 pipeline phases.
 * Generic token-based matching (no hardcoded aliases):
 * 1. Split keys into semantic tokens (e.g., "spreadsheet_id" → ["spreadsheet", "id"])
 * 2. Calculate token overlap between target and config keys
 * 3. Rank by similarity score
 *
 * Examples:
 * - spreadsheet_id ↔ google_sheet_id (tokens: sheet, id → score: 0.5)
 * - sheet_tab_name ↔ google_sheet_tab (tokens: sheet, tab → score: 0.67)
 */

/**
 * Tokenize a key for fuzzy matching
 * Splits on underscore, hyphen, and camelCase boundaries
 */
export function tokenizeKey(key: string): string[] {
  return key
    .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase → snake_case
    .toLowerCase()
    .split(/[_-]/) // split on underscore or hyphen
    .filter((t) => t.length > 0)
}

/**
 * Calculate token overlap score between two keys
 * Returns score between 0 and 1 (0 = no overlap, 1 = identical)
 */
export function calculateTokenOverlap(key1: string, key2: string): number {
  const tokens1 = new Set(tokenizeKey(key1))
  const tokens2 = new Set(tokenizeKey(key2))

  const commonTokens = [...tokens1].filter((t) => tokens2.has(t))
  const allTokens = new Set([...tokens1, ...tokens2])

  if (allTokens.size === 0) return 0
  return commonTokens.length / allTokens.size
}

/**
 * Match result with score
 */
export interface FuzzyMatch {
  key: string
  score: number
}

/**
 * Find ALL fuzzy matches for a target key
 * Returns matches sorted by score descending
 *
 * @param targetKey - The parameter name to match
 * @param configKeys - Array of config keys or config entries to match against
 * @param threshold - Minimum score (0-1) required for match (default: 0.33)
 * @param skipExact - Whether to skip exact matches (default: true)
 * @returns Array of matches sorted by score descending
 */
export function findFuzzyMatches(
  targetKey: string,
  configKeys: string[] | Array<{ key: string; value: any }> | Record<string, any>,
  threshold: number = 0.33,
  skipExact: boolean = true
): FuzzyMatch[] {
  const matches: FuzzyMatch[] = []

  // Normalize input to array of keys
  let keys: string[]
  if (Array.isArray(configKeys)) {
    if (configKeys.length > 0 && typeof configKeys[0] === 'object' && 'key' in configKeys[0]) {
      // Array<{key, value}>
      keys = (configKeys as Array<{ key: string; value: any }>).map((c) => c.key)
    } else {
      // string[]
      keys = configKeys as string[]
    }
  } else {
    // Record<string, any>
    keys = Object.keys(configKeys)
  }

  for (const configKey of keys) {
    if (skipExact && configKey === targetKey) continue

    const score = calculateTokenOverlap(targetKey, configKey)

    if (score >= threshold) {
      matches.push({ key: configKey, score })
    }
  }

  // Sort by score descending
  return matches.sort((a, b) => b.score - a.score)
}

/**
 * Find BEST fuzzy match for a target key
 * Returns only the top match, or undefined if no match above threshold
 *
 * @param targetKey - The parameter name to match
 * @param configKeys - Array of config keys or config entries to match against
 * @param threshold - Minimum score (0-1) required for match (default: 0.33)
 * @returns The best matching key, or undefined if no match above threshold
 */
export function findBestFuzzyMatch(
  targetKey: string,
  configKeys: string[] | Array<{ key: string; value: any }> | Record<string, any>,
  threshold: number = 0.33
): string | undefined {
  const matches = findFuzzyMatches(targetKey, configKeys, threshold, false)
  return matches.length > 0 ? matches[0].key : undefined
}
