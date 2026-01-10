/**
 * Thinking Words Dictionary Loader
 *
 * Singleton loader for the thinking words dictionary.
 * Loads words and role mappings from JSON configuration.
 */

import type { UserRole } from '@/components/onboarding/hooks/useOnboarding';
import dictionaryData from './thinking-words-dictionary.json';

// =============================================================================
// Types
// =============================================================================

export type ThinkingCategory =
  | 'general'
  | 'business'
  | 'data_analysis'
  | 'planning'
  | 'problem_solving'
  | 'communication'
  | 'progress'
  | 'friendly';

interface CategoryDefinition {
  description: string;
  words: string[];
}

interface ThinkingWordsDictionary {
  version: string;
  categories: Record<string, CategoryDefinition>;
  roleMapping: Record<string, string[]>;
}

// =============================================================================
// Singleton Loader
// =============================================================================

class ThinkingWordsLoader {
  private static instance: ThinkingWordsLoader | null = null;

  private dictionary: ThinkingWordsDictionary;
  private wordsByCategory: Map<ThinkingCategory, readonly string[]>;
  private allWords: readonly string[];
  private roleCategories: Map<UserRole, ThinkingCategory[]>;

  private constructor() {
    this.dictionary = dictionaryData as ThinkingWordsDictionary;
    this.wordsByCategory = new Map();
    this.roleCategories = new Map();
    this.allWords = [];

    this.initialize();
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): ThinkingWordsLoader {
    if (!ThinkingWordsLoader.instance) {
      ThinkingWordsLoader.instance = new ThinkingWordsLoader();
    }
    return ThinkingWordsLoader.instance;
  }

  /**
   * Reset the singleton (useful for testing or hot-reload)
   */
  static reset(): void {
    ThinkingWordsLoader.instance = null;
  }

  /**
   * Initialize the loader by parsing the dictionary
   */
  private initialize(): void {
    // Build words by category map
    for (const [categoryKey, categoryData] of Object.entries(this.dictionary.categories)) {
      this.wordsByCategory.set(
        categoryKey as ThinkingCategory,
        Object.freeze([...categoryData.words])
      );
    }

    // Build all words array
    const allWordsArray: string[] = [];
    for (const categoryData of Object.values(this.dictionary.categories)) {
      allWordsArray.push(...categoryData.words);
    }
    this.allWords = Object.freeze(allWordsArray);

    // Build role categories map
    for (const [role, categories] of Object.entries(this.dictionary.roleMapping)) {
      this.roleCategories.set(
        role as UserRole,
        categories as ThinkingCategory[]
      );
    }
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Get the dictionary version
   */
  getVersion(): string {
    return this.dictionary.version;
  }

  /**
   * Get all available category names
   */
  getCategoryNames(): ThinkingCategory[] {
    return Array.from(this.wordsByCategory.keys());
  }

  /**
   * Get category description
   */
  getCategoryDescription(category: ThinkingCategory): string | undefined {
    return this.dictionary.categories[category]?.description;
  }

  /**
   * Get words for a specific category
   */
  getWordsForCategory(category: ThinkingCategory): readonly string[] {
    return this.wordsByCategory.get(category) || [];
  }

  /**
   * Get all words (flat array)
   */
  getAllWords(): readonly string[] {
    return this.allWords;
  }

  /**
   * Get the categories mapped to a specific role
   */
  getCategoriesForRole(role: UserRole): ThinkingCategory[] {
    return this.roleCategories.get(role) || [];
  }

  /**
   * Get words for a specific role (general + role-specific categories)
   */
  getWordsForRole(role: UserRole): string[] {
    const roleCategories = this.getCategoriesForRole(role);
    const categories: ThinkingCategory[] = ['general', ...roleCategories];

    // Use Set to avoid duplicates
    const wordSet = new Set<string>();
    for (const category of categories) {
      const words = this.wordsByCategory.get(category);
      if (words) {
        for (const word of words) {
          wordSet.add(word);
        }
      }
    }

    return Array.from(wordSet);
  }

  /**
   * Get words for specific categories
   */
  getWordsForCategories(categories: ThinkingCategory[]): string[] {
    const wordSet = new Set<string>();
    for (const category of categories) {
      const words = this.wordsByCategory.get(category);
      if (words) {
        for (const word of words) {
          wordSet.add(word);
        }
      }
    }
    return Array.from(wordSet);
  }

  /**
   * Get the words by category map (for direct access)
   */
  getWordsByCategory(): Record<ThinkingCategory, readonly string[]> {
    const result: Partial<Record<ThinkingCategory, readonly string[]>> = {};
    for (const [category, words] of this.wordsByCategory) {
      result[category] = words;
    }
    return result as Record<ThinkingCategory, readonly string[]>;
  }

  /**
   * Get the role mapping (for direct access)
   */
  getRoleMapping(): Record<UserRole, ThinkingCategory[]> {
    const result: Partial<Record<UserRole, ThinkingCategory[]>> = {};
    for (const [role, categories] of this.roleCategories) {
      result[role] = categories;
    }
    return result as Record<UserRole, ThinkingCategory[]>;
  }

  /**
   * Get total word count
   */
  getTotalWordCount(): number {
    return this.allWords.length;
  }

  /**
   * Get word count for a category
   */
  getCategoryWordCount(category: ThinkingCategory): number {
    return this.wordsByCategory.get(category)?.length || 0;
  }
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the thinking words loader singleton
 */
export function getThinkingWordsLoader(): ThinkingWordsLoader {
  return ThinkingWordsLoader.getInstance();
}

/**
 * Reset the loader (for testing or hot-reload)
 */
export function resetThinkingWordsLoader(): void {
  ThinkingWordsLoader.reset();
}

export default ThinkingWordsLoader;
