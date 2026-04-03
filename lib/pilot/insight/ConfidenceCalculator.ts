/**
 * Confidence Calculator
 *
 * Determines confidence mode based on execution count and provides
 * language constraints for each mode.
 *
 * Based on: docs/shadow-critic-architecture.md (lines 787-856)
 *
 * Confidence Modes:
 * - observation (1 run): Describe what happened, no trends
 * - early_signals (2-3 runs): "early", "possible", "may" language
 * - emerging_patterns (4-10 runs): "appears", "likely", "consider" language
 * - confirmed (10+ runs): Full confidence, trends, recommendations
 */

import { ConfidenceMode, ConfidenceThresholds } from './types';

/**
 * Default confidence thresholds
 */
export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  early_signals_threshold: 2,
  emerging_patterns_threshold: 4,
  confirmed_threshold: 10,
};

/**
 * Language constraints for each confidence mode
 */
export const CONFIDENCE_LANGUAGE = {
  observation: {
    mode: 'observation' as ConfidenceMode,
    allowed: ['observed', 'noticed', 'detected', 'found', 'single', 'one', 'this'],
    forbidden: ['trend', 'pattern', 'usually', 'often', 'always', 'typically', 'consistently'],
    guidance: 'Describe only what happened in this single execution. No trends or predictions.',
    example_phrases: [
      'We observed...',
      'In this execution...',
      'This workflow...',
      'The agent detected...',
    ],
  },
  early_signals: {
    mode: 'early_signals' as ConfidenceMode,
    allowed: ['early', 'possible', 'may', 'might', 'could', 'initial', 'preliminary'],
    forbidden: ['always', 'definitely', 'confirmed', 'established', 'proven'],
    guidance: 'Use cautious language. Indicate this is an early pattern with limited data.',
    example_phrases: [
      'We\'re seeing early signals...',
      'There may be a pattern...',
      'Initial data suggests...',
      'This could indicate...',
    ],
  },
  emerging_patterns: {
    mode: 'emerging_patterns' as ConfidenceMode,
    allowed: ['appears', 'likely', 'seems', 'suggests', 'indicates', 'consider', 'probably'],
    forbidden: ['always', 'never', 'guaranteed', 'certain'],
    guidance: 'Indicate a probable pattern with moderate confidence. Suggest considerations.',
    example_phrases: [
      'A pattern appears to be emerging...',
      'This likely indicates...',
      'The data suggests...',
      'Consider investigating...',
    ],
  },
  confirmed: {
    mode: 'confirmed' as ConfidenceMode,
    allowed: [
      'consistently',
      'established',
      'trend',
      'regularly',
      'frequently',
      'recommend',
      'should',
      'will',
    ],
    forbidden: [],
    guidance:
      'Use confident language. Provide trends, recommendations, and actionable next steps.',
    example_phrases: [
      'This is a confirmed trend...',
      'The data clearly shows...',
      'We recommend...',
      'You should consider...',
    ],
  },
};

/**
 * Calculate confidence mode based on execution count
 */
export function calculateConfidenceMode(
  runCount: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS
): ConfidenceMode {
  if (runCount < thresholds.early_signals_threshold) {
    return 'observation';
  }

  if (runCount < thresholds.emerging_patterns_threshold) {
    return 'early_signals';
  }

  if (runCount < thresholds.confirmed_threshold) {
    return 'emerging_patterns';
  }

  return 'confirmed';
}

/**
 * Get language constraints for a confidence mode
 */
export function getLanguageConstraints(mode: ConfidenceMode) {
  return CONFIDENCE_LANGUAGE[mode];
}

/**
 * Validate if text follows confidence mode constraints
 * Returns { valid: boolean, violations: string[] }
 */
export function validateLanguage(
  text: string,
  mode: ConfidenceMode
): { valid: boolean; violations: string[] } {
  const constraints = CONFIDENCE_LANGUAGE[mode];
  const lowerText = text.toLowerCase();
  const violations: string[] = [];

  // Check for forbidden words
  for (const forbidden of constraints.forbidden) {
    if (lowerText.includes(forbidden.toLowerCase())) {
      violations.push(`Forbidden word "${forbidden}" used in ${mode} mode`);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Get confidence mode description for UI
 */
export function getConfidenceModeDescription(mode: ConfidenceMode): string {
  const descriptions: Record<ConfidenceMode, string> = {
    observation: 'Based on a single execution. Observational data only.',
    early_signals: 'Based on 2-3 executions. Early pattern detected.',
    emerging_patterns: 'Based on 4-10 executions. Likely pattern emerging.',
    confirmed: 'Based on 10+ executions. Confirmed trend with high confidence.',
  };

  return descriptions[mode];
}

/**
 * Get confidence score (0-1) based on run count
 * Useful for sorting insights by confidence
 */
export function getConfidenceScore(
  runCount: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS
): number {
  if (runCount >= thresholds.confirmed_threshold) {
    return 1.0;
  }

  if (runCount >= thresholds.emerging_patterns_threshold) {
    // Scale from 0.6 to 0.9 between emerging_patterns and confirmed
    const range = thresholds.confirmed_threshold - thresholds.emerging_patterns_threshold;
    const position = runCount - thresholds.emerging_patterns_threshold;
    return 0.6 + (position / range) * 0.3;
  }

  if (runCount >= thresholds.early_signals_threshold) {
    // Scale from 0.3 to 0.5 between early_signals and emerging_patterns
    const range = thresholds.emerging_patterns_threshold - thresholds.early_signals_threshold;
    const position = runCount - thresholds.early_signals_threshold;
    return 0.3 + (position / range) * 0.3;
  }

  // Observation mode: 0.1 to 0.2
  return 0.1;
}

/**
 * Generate AI prompt constraints for confidence mode
 */
export function generatePromptConstraints(mode: ConfidenceMode): string {
  const constraints = CONFIDENCE_LANGUAGE[mode];

  return `
**LANGUAGE CONSTRAINTS FOR ${mode.toUpperCase()} MODE:**

Guidance: ${constraints.guidance}

✅ Use these words: ${constraints.allowed.join(', ')}
${constraints.forbidden.length > 0 ? `❌ NEVER use: ${constraints.forbidden.join(', ')}` : ''}

Example phrases:
${constraints.example_phrases.map((phrase) => `- ${phrase}`).join('\n')}
`.trim();
}
