/**
 * Thinking Words
 *
 * A collection of words and phrases displayed while an agent is processing.
 * These rotate/cycle to give users feedback that work is happening.
 *
 * Categories:
 * - General thinking/processing
 * - Business/SMB domain
 * - Data & analysis
 * - Planning & strategy
 */

export const THINKING_WORDS: readonly string[] = [
  // General thinking/processing
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

  // Business/SMB domain
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

  // Data & analysis
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

  // Planning & strategy
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

  // Problem solving
  'Troubleshooting',
  'Diagnosing',
  'Debugging',
  'Resolving',
  'Untangling',
  'Working through',
  'Finding solutions',
  'Brainstorming',

  // Communication & collaboration
  'Drafting response',
  'Composing',
  'Formatting',
  'Refining',
  'Polishing',
  'Fine-tuning',

  // Progress indicators
  'Almost there',
  'Making progress',
  'Getting closer',
  'Wrapping up',
  'Final checks',
  'Double-checking',
  'Verifying',
  'Confirming',

  // Friendly/casual
  'Mulling it over',
  'On it',
  'Working on it',
  'Figuring out',
  'Putting it together',
  'Brewing ideas',
  'Cooking up',
  'Digging in',
] as const;

/**
 * Get a random thinking word
 */
export function getRandomThinkingWord(): string {
  const index = Math.floor(Math.random() * THINKING_WORDS.length);
  return THINKING_WORDS[index];
}

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
 * Get a shuffled copy of thinking words
 */
export function getShuffledThinkingWords(): string[] {
  const shuffled = [...THINKING_WORDS];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}