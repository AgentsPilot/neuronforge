/**
 * Thinking Words
 *
 * A collection of words and phrases displayed while an agent is processing.
 * These rotate/cycle to give users feedback that work is happening.
 *
 * Words are organized by category and can be filtered by user role to provide
 * domain-relevant feedback that resonates with the user's day-to-day work.
 */

import type { UserRole } from '@/components/onboarding/hooks/useOnboarding';

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

// =============================================================================
// Words by Category
// =============================================================================

export const THINKING_WORDS_BY_CATEGORY: Record<ThinkingCategory, readonly string[]> = {
  // Universal words - always included for all roles
  general: [
    'Thinking',
    'Processing',
    'Analyzing',
    'Evaluating',
    'Computing',
    'Reasoning',
    'Pondering',
    'Considering',
    'Reviewing',
    'Examining',
    'Exploring',
    'Investigating',
    'Assessing',
    'Weighing options',
    'Connecting dots',
    'Piecing together',
  ],

  // Business/SMB domain
  business: [
    'Forecasting',
    'Budgeting',
    'Scheduling',
    'Optimizing',
    'Strategizing',
    'Planning ahead',
    'Crunching numbers',
    'Running scenarios',
    'Checking inventory',
    'Reviewing metrics',
    'Calculating ROI',
    'Balancing priorities',
    'Streamlining',
    'Coordinating',
    'Delegating tasks',
    'Mapping workflow',
  ],

  // Data & analysis
  data_analysis: [
    'Parsing data',
    'Aggregating',
    'Cross-referencing',
    'Validating',
    'Synthesizing',
    'Correlating',
    'Filtering',
    'Sorting',
    'Indexing',
    'Querying',
    'Compiling results',
    'Building insights',
    'Pattern matching',
    'Extracting details',
    'Summarizing',
  ],

  // Planning & strategy
  planning: [
    'Drafting',
    'Formulating',
    'Outlining',
    'Mapping out',
    'Charting course',
    'Setting priorities',
    'Aligning goals',
    'Preparing',
    'Organizing',
    'Structuring',
    'Sequencing',
    'Prioritizing',
    'Scoping',
  ],

  // Problem solving
  problem_solving: [
    'Troubleshooting',
    'Diagnosing',
    'Debugging',
    'Resolving',
    'Untangling',
    'Working through',
    'Finding solutions',
    'Brainstorming',
  ],

  // Communication & collaboration
  communication: [
    'Drafting response',
    'Composing',
    'Formatting',
    'Refining',
    'Polishing',
    'Fine-tuning',
  ],

  // Progress indicators
  progress: [
    'Almost there',
    'Making progress',
    'Getting closer',
    'Wrapping up',
    'Final checks',
    'Double-checking',
    'Verifying',
    'Confirming',
  ],

  // Friendly/casual
  friendly: [
    'Mulling it over',
    'On it',
    'Working on it',
    'Figuring out',
    'Putting it together',
    'Brewing ideas',
    'Cooking up',
    'Digging in',
  ],
} as const;

// =============================================================================
// Role → Category Mapping
// =============================================================================

/**
 * Maps each user role to relevant thinking word categories.
 * The 'general' category is always included automatically.
 */
export const ROLE_CATEGORY_MAP: Record<UserRole, ThinkingCategory[]> = {
  business_owner: ['business', 'planning', 'progress'],
  manager: ['planning', 'communication', 'progress'],
  consultant: ['planning', 'problem_solving', 'data_analysis'],
  operations: ['data_analysis', 'problem_solving', 'business'],
  sales: ['business', 'communication', 'friendly'],
  marketing: ['data_analysis', 'planning', 'friendly'],
  finance: ['business', 'data_analysis'],
  other: ['friendly', 'progress'],
};

// =============================================================================
// Flat Array (Backward Compatibility)
// =============================================================================

/**
 * Flat array of all thinking words (for backward compatibility)
 */
export const THINKING_WORDS: readonly string[] = Object.values(THINKING_WORDS_BY_CATEGORY).flat();

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get words for a specific role (general + role-specific categories)
 */
export function getWordsForRole(role: UserRole): string[] {
  const roleCategories = ROLE_CATEGORY_MAP[role] || [];
  const categories: ThinkingCategory[] = ['general', ...roleCategories];

  // Use Set to avoid duplicates if a word appears in multiple categories
  const wordSet = new Set<string>();
  for (const category of categories) {
    for (const word of THINKING_WORDS_BY_CATEGORY[category]) {
      wordSet.add(word);
    }
  }

  return Array.from(wordSet);
}

/**
 * Get words for specific categories
 */
export function getWordsForCategories(categories: ThinkingCategory[]): string[] {
  const wordSet = new Set<string>();
  for (const category of categories) {
    for (const word of THINKING_WORDS_BY_CATEGORY[category]) {
      wordSet.add(word);
    }
  }
  return Array.from(wordSet);
}

// =============================================================================
// Random Selection
// =============================================================================

/**
 * Get a random thinking word (from all words)
 */
export function getRandomThinkingWord(): string {
  const index = Math.floor(Math.random() * THINKING_WORDS.length);
  return THINKING_WORDS[index];
}

/**
 * Get a random thinking word for a specific role
 */
export function getRandomThinkingWordForRole(role: UserRole): string {
  const words = getWordsForRole(role);
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
  let index = 0;
  return (): string => {
    const word = THINKING_WORDS[index];
    index = (index + 1) % THINKING_WORDS.length;
    return word;
  };
}

/**
 * Create a cycler for a specific user role
 * Returns words from general + role-specific categories
 */
export function createThinkingWordCyclerForRole(role: UserRole) {
  const words = getWordsForRole(role);
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
 * Get a shuffled copy of all thinking words
 */
export function getShuffledThinkingWords(): string[] {
  const shuffled = [...THINKING_WORDS];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Get a shuffled copy of thinking words for a specific role
 */
export function getShuffledThinkingWordsForRole(role: UserRole): string[] {
  const words = getWordsForRole(role);
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words;
}
