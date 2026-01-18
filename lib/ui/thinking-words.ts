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
