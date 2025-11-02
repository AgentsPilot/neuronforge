/**
 * Feature Flags Utility
 *
 * Centralized feature flag management for gradual rollouts and A/B testing.
 */

/**
 * Check if thread-based agent creation flow is enabled
 *
 * @returns {boolean} True if thread-based flow should be used, false to use legacy flow
 */
export function useThreadBasedAgentCreation(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION;

  console.log("Feature Flag: NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=",flag || 'none');

  // Default to false if not set, empty, or whitespace-only
  if (!flag || flag.trim() === '') {
    return false;
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

  // Default to false for any other value
  return false;
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
    // Add more feature flags here as needed
  };
}
