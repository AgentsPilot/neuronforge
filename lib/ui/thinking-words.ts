/**
 * Thinking Words
 *
 * A collection of words and phrases displayed while an agent is processing.
 * These rotate/cycle to give users feedback that work is happening.
 *
 * Words are loaded from a JSON dictionary file and can be filtered by user role
 * to provide domain-relevant feedback that resonates with the user's day-to-day work.
 *
 * @see thinking-words-dictionary.json - Edit this file to add/modify words
 * @see thinking-words-loader.ts - Singleton loader implementation
 */

import type { UserRole } from '@/components/onboarding/hooks/useOnboarding';
import { getThinkingWordsLoader, type ThinkingCategory } from './thinking-words-loader';

// Re-export types
export type { ThinkingCategory } from './thinking-words-loader';

// =============================================================================
// Constants (Backward Compatibility)
// =============================================================================

/**
 * Words organized by category
 * @deprecated Use getThinkingWordsLoader().getWordsByCategory() for dynamic access
 */
export const THINKING_WORDS_BY_CATEGORY = getThinkingWordsLoader().getWordsByCategory();

/**
 * Role to category mapping
 * @deprecated Use getThinkingWordsLoader().getRoleMapping() for dynamic access
 */
export const ROLE_CATEGORY_MAP = getThinkingWordsLoader().getRoleMapping();

/**
 * Flat array of all thinking words (for backward compatibility)
 */
export const THINKING_WORDS: readonly string[] = getThinkingWordsLoader().getAllWords();

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get words for a specific role (general + role-specific categories)
 */
export function getWordsForRole(role: UserRole): string[] {
  return getThinkingWordsLoader().getWordsForRole(role);
}

/**
 * Get words for specific categories
 */
export function getWordsForCategories(categories: ThinkingCategory[]): string[] {
  return getThinkingWordsLoader().getWordsForCategories(categories);
}

// =============================================================================
// Random Selection
// =============================================================================

/**
 * Get a random thinking word (from all words)
 */
export function getRandomThinkingWord(): string {
  const words = getThinkingWordsLoader().getAllWords();
  const index = Math.floor(Math.random() * words.length);
  return words[index];
}

/**
 * Get a random thinking word for a specific role
 */
export function getRandomThinkingWordForRole(role: UserRole): string {
  const words = getThinkingWordsLoader().getWordsForRole(role);
  const index = Math.floor(Math.random() * words.length);
  return words[index];
}

// =============================================================================
// Cyclers (Sequential)
// =============================================================================

/**
 * Get thinking words in sequence (cycles through the list)
 */
export function createThinkingWordCycler() {
  const words = getThinkingWordsLoader().getAllWords();
  let index = 0;
  return (): string => {
    const word = words[index];
    index = (index + 1) % words.length;
    return word;
  };
}

/**
 * Create a cycler for a specific user role
 * Returns words from general + role-specific categories
 */
export function createThinkingWordCyclerForRole(role: UserRole) {
  const words = getThinkingWordsLoader().getWordsForRole(role);
  let index = 0;
  return (): string => {
    const word = words[index];
    index = (index + 1) % words.length;
    return word;
  };
}

// =============================================================================
// Timed Cycler (Time-Aware Phase Progression)
// =============================================================================

/**
 * Time-tier configuration for timed thinking word cycler.
 * Each tier defines which categories to use and when to activate.
 * Tiers are evaluated in order — first matching tier wins.
 */
const TIMED_TIERS: Array<{
  afterMs: number
  categories: ThinkingCategory[]
}> = [
  { afterMs: 45000, categories: ['long_wait'] },
  { afterMs: 30000, categories: ['progress', 'communication'] },
  { afterMs: 15000, categories: ['data_analysis', 'planning'] },
  { afterMs: 0,     categories: ['general', 'friendly'] },
]

/**
 * Create a time-aware thinking word cycler.
 *
 * Internally tracks elapsed time and picks words from progressively
 * different categories:
 * - 0-15s:  General/friendly words ("Thinking", "On it")
 * - 15-30s: Domain words ("Parsing data", "Mapping out")
 * - 30-45s: Progress words ("Almost there", "Fine-tuning")
 * - 45s+:   Humorous long-wait ("Brewing extra coffee...")
 *
 * The caller just calls getNextWord() — all logic is internal.
 *
 * @param role Optional user role for role-aware word selection in early tiers
 */
export function createTimedThinkingWordCycler(role?: UserRole): () => string {
  const loader = getThinkingWordsLoader()
  const startTime = Date.now()

  // Pre-build shuffled word lists per tier
  const tierWords: string[][] = TIMED_TIERS.map(tier =>
    shuffleArray([...loader.getWordsForCategories(tier.categories)])
  )
  const tierIndices: number[] = TIMED_TIERS.map(() => 0)

  return (): string => {
    const elapsed = Date.now() - startTime

    // Find the active tier (first one where elapsed >= afterMs)
    let tierIndex = TIMED_TIERS.length - 1 // default to last (general)
    for (let i = 0; i < TIMED_TIERS.length; i++) {
      if (elapsed >= TIMED_TIERS[i].afterMs) {
        tierIndex = i
        break
      }
    }

    // Get next word from this tier's shuffled list
    const words = tierWords[tierIndex]
    const wordIdx = tierIndices[tierIndex] % words.length
    tierIndices[tierIndex]++

    return words[wordIdx]
  }
}

// =============================================================================
// Shuffled Lists
// =============================================================================

/**
 * Shuffle an array in place (Fisher-Yates)
 */
function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Get a shuffled copy of all thinking words
 */
export function getShuffledThinkingWords(): string[] {
  const words = [...getThinkingWordsLoader().getAllWords()];
  return shuffleArray(words);
}

/**
 * Get a shuffled copy of thinking words for a specific role
 */
export function getShuffledThinkingWordsForRole(role: UserRole): string[] {
  const words = getThinkingWordsLoader().getWordsForRole(role);
  return shuffleArray(words);
}

// =============================================================================
// Loader Access
// =============================================================================

/**
 * Get direct access to the thinking words loader for advanced usage
 */
export { getThinkingWordsLoader, resetThinkingWordsLoader } from './thinking-words-loader';
