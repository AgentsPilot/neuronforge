/**
 * Feature Flags Utility
 *
 * Centralized feature flag management for gradual rollouts and A/B testing.
 */

import { clientLogger } from '@/lib/logger/client';

// C-33: the parser now lives in a zero-import module so server code can share
// the same rules without importing this module's dependency graph.
import { parseBooleanFlag } from '@/lib/utils/parseBooleanFlag';

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
 * Check if AI Data Layer is enabled for Business OS Chat
 *
 * When enabled, the Business OS chat uses the new AI Data Layer with
 * autonomous tool calling instead of the hardcoded capability system.
 *
 * Features:
 * - LLM can directly query any entity (contacts, services, bookings, etc.)
 * - LLM can perform mutations with user confirmation
 * - No hardcoded capabilities or switch statements
 * - Multi-language support through natural LLM generation
 *
 * @returns {boolean} True if AI Data Layer is enabled, false for legacy system
 */
export function useAIDataLayer(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_AI_DATA_LAYER;
  clientLogger.debug({ flag: 'NEXT_PUBLIC_USE_AI_DATA_LAYER', value: flag ?? null, default: false }, 'Feature flag evaluated');
  return parseBooleanFlag(flag, false);
}

/**
 * Get all feature flags status
 * Useful for debugging and admin dashboards
 *
 * @returns {object} Object with all feature flags and their status
 */
/**
 * Whether the customer-facing "delete my business" surface should be RENDERED.
 *
 * ⚠️ **THIS IS A RENDERING HINT. IT IS NOT AN AUTHORIZATION BOUNDARY.**
 *
 * A `NEXT_PUBLIC_*` value is compiled into the client bundle, and the purge
 * routes are callable directly regardless of what the UI chooses to draw. The
 * boundary is `authorizePurge()` in `lib/business-os/purge/purgeAuthz.ts`,
 * which performs its own server-side read (C-22) and, while this flag is off,
 * restricts the customer-surface Purge to platform admins.
 *
 * **Do not "simplify" `authorizePurge` to call this hook.** Doing so would move
 * a destructive-capability check into the client bundle and reopen on the
 * customer surface exactly the hole T30 closed on the internal one. That is not
 * a hypothetical tidy-up: it is the shape this codebase has already shipped
 * more than once. A test in the purge route suite asserts the server refusal,
 * so this note is backed by something that fails rather than by good intentions.
 *
 * Defaults to **off** (D9): un-gating requires the AC-2/5/10/13/16/24/37
 * checklist demonstrated on a real account.
 *
 * @returns {boolean} True if the customer-facing delete surface should render
 */
export function useBusinessDeleteSurface(): boolean {
  const flag = process.env.NEXT_PUBLIC_ENABLE_BUSINESS_DELETE;
  return parseBooleanFlag(flag);
}

export function getFeatureFlags() {
  return {
    useThreadBasedAgentCreation: useThreadBasedAgentCreation(),
    useNewAgentCreationUI: useNewAgentCreationUI(),
    useV6AgentGeneration: useV6AgentGeneration(),
    useV6ReviewMode: useV6ReviewMode(),
    useMoveToCalibrationAfterCreation: useMoveToCalibrationAfterCreation(),
    useAIDataLayer: useAIDataLayer(),
    useBusinessDeleteSurface: useBusinessDeleteSurface(),
  };
}
