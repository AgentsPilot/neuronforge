/**
 * Feature Flags Utility
 *
 * Centralized feature flag management for gradual rollouts and A/B testing.
 */

import { clientLogger } from '@/lib/logger/client';

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
  clientLogger.debug({ flag: 'NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION', value: flag ?? null }, 'Feature flag evaluated');
  return parseBooleanFlag(flag);
}

// Retired 2026-05-31: USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW
// flag + useEnhancedTechnicalWorkflowReview() helper were a rollout safety net
// for picking between V4 (standard) and V5 (LLM-reviewed) generators inside
// /api/generate-agent-v4. Git log shows the flag was never enabled in any
// commit since its introduction (c29c93f), and the V4 route itself is now the
// dormant fallback when NEXT_PUBLIC_USE_V6_AGENT_GENERATION=true (V6 is the
// production primary). Route collapsed to V4-only; V5WorkflowGenerator source
// kept for now (broader V4/V5 stack retirement is a separate cleanup).

/**
 * Check if new conversational UI V2 is enabled
 *
 * @returns {boolean} True if new UI should be used, false to use legacy UI
 */
export function useNewAgentCreationUI(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI;
  clientLogger.debug({ flag: 'NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI', value: flag ?? null }, 'Feature flag evaluated');
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
  clientLogger.debug({ flag: 'NEXT_PUBLIC_USE_V6_AGENT_GENERATION', value: flag ?? null }, 'Feature flag evaluated');
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
  clientLogger.debug({ flag: 'NEXT_PUBLIC_USE_V6_REVIEW_MODE', value: flag ?? null, default: true }, 'Feature flag evaluated');
  // Default to TRUE - review mode is enabled by default
  return parseBooleanFlag(flag, true);
}

/**
 * Move the user to calibration after agent creation.
 *
 * Default OFF. When off, agent creation auto-redirects to the agent page as
 * today. When on, a choice card invites the user to calibrate the new agent
 * before going live (approve → /v2/sandbox/[id]?from=creation, decline →
 * /agents/[id]). Opt-in via NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION=true.
 *
 * @returns {boolean} True if the post-creation calibration prompt should show
 */
export function useMoveToCalibrationAfterCreation(): boolean {
  const flag = process.env.NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION;
  clientLogger.debug({ flag: 'NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION', value: flag ?? null, default: false }, 'Feature flag evaluated');
  return parseBooleanFlag(flag, false);
}

// Retired 2026-05-20 (P6): NEXT_PUBLIC_USE_V6_PIPELINE_A flag + useV6PipelineA()
// helper were a rollout safety net for switching the V2 UI from the semantic
// pipeline (Pipeline B) to the IntentContract pipeline (Pipeline A). Pipeline A
// is now the unconditional V6 path. See docs/v6/V6_PIPELINE_A_MIGRATION.md § P6.

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
    useV6AgentGeneration: useV6AgentGeneration(),
    useV6ReviewMode: useV6ReviewMode(),
    useMoveToCalibrationAfterCreation: useMoveToCalibrationAfterCreation(),
  };
}
