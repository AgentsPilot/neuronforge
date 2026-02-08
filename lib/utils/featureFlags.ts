/**
 * Feature Flags Utility
 *
 * Centralized feature flag management for gradual rollouts and A/B testing.
 */

/**
 * Parse a boolean feature flag from environment variable
 *
 * @param flag - The environment variable value (may be undefined)
 * @param defaultValue - Default value when flag is not set (defaults to false)
 * @returns {boolean} True if flag is 'true' or '1', false if 'false' or '0', defaultValue otherwise
 */
function parseBooleanFlag(flag: string | undefined, defaultValue: boolean = false): boolean {
  // Default to defaultValue if not set, empty, or whitespace-only
  if (!flag || flag.trim() === '') {
    return defaultValue;
  }

  // Normalize the flag value (lowercase and trim)
  const normalizedFlag = flag.trim().toLowerCase();

  // Explicitly check for false values
  if (normalizedFlag === 'false' || normalizedFlag === '0') {
    return false;
  }

  // Enable if set to 'true' or '1'
  if (normalizedFlag === 'true' || normalizedFlag === '1') {
    return true;
  }

  // Default to defaultValue for any other/unrecognized value
  return defaultValue;
}

/**
 * Check if thread-based agent creation flow is enabled
 *
 * @returns {boolean} True if thread-based flow should be used, false to use legacy flow
 */
export function useThreadBasedAgentCreation(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION;
  console.log("Feature Flag: NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=", flag || 'none');
  return parseBooleanFlag(flag);
}

/**
 * Check if enhanced technical workflow review (V5 generator) is enabled
 *
 * When enabled, the technical workflow path uses LLM-based review and repair
 * before DSL building. This adds validation against plugin schemas and can
 * fix issues like missing steps or invalid references.
 *
 * Server-side only (no NEXT_PUBLIC_ prefix).
 *
 * @returns {boolean} True to use V5 generator with LLM review, false for V4
 */
export function useEnhancedTechnicalWorkflowReview(): boolean {
  const flag = process.env.USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW;
  return parseBooleanFlag(flag);
}

/**
 * Check if new conversational UI V2 is enabled
 *
 * @returns {boolean} True if new UI should be used, false to use legacy UI
 */
export function useNewAgentCreationUI(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI;
  console.log("Feature Flag: NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=", flag || 'none');
  return parseBooleanFlag(flag);
}

/**
 * Check if V6 agent generation is enabled
 *
 * When enabled, the agent creation flow will use the V6 5-phase pipeline
 * (semantic plan → grounding → formalization → compilation → validation)
 * instead of the V4 direct generation approach.
 *
 * @returns {boolean} True if V6 generation is enabled, false otherwise
 */
export function useV6AgentGeneration(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION;
  console.log("Feature Flag: NEXT_PUBLIC_USE_V6_AGENT_GENERATION=", flag || 'none');
  return parseBooleanFlag(flag);
}

/**
 * Check if V6 Review Mode is enabled
 *
 * When enabled, V6 agent generation uses split API flow with user review UI:
 * - API 1: generate-semantic-grounded (P1+P2+Detection)
 * - Review UI: User reviews ambiguities and makes decisions
 * - API 2: compile-with-decisions (P3+P4+P5)
 *
 * When disabled, uses single API flow (generate-ir-semantic) without review.
 *
 * NOTE: This flag only has effect when NEXT_PUBLIC_USE_V6_AGENT_GENERATION=true.
 * NOTE: This flag defaults to TRUE (enabled) when not set.
 *
 * @returns {boolean} True if review mode enabled, false for direct generation
 */
export function useV6ReviewMode(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE;
  console.log("Feature Flag: NEXT_PUBLIC_USE_V6_REVIEW_MODE=", flag || 'none (default: true)');
  // Default to TRUE - review mode is enabled by default
  return parseBooleanFlag(flag, true);
}

/**
 * Get all feature flags status
 * Useful for debugging and admin dashboards
 *
 * @returns {object} Object with all feature flags and their status
 */
export function getFeatureFlags() {
  return {
    useThreadBasedAgentCreation: useThreadBasedAgentCreation(),
    useNewAgentCreationUI: useNewAgentCreationUI(),
    useEnhancedTechnicalWorkflowReview: useEnhancedTechnicalWorkflowReview(),
    useV6AgentGeneration: useV6AgentGeneration(),
    useV6ReviewMode: useV6ReviewMode(),
  };
}
