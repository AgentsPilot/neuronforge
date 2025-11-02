// lib/utils/formatActivityName.ts
// Utility function to normalize activity names from snake_case to Title Case

/**
 * Converts snake_case activity names to Title Case for display
 *
 * Examples:
 * - "summarize_execution" → "Summarize Execution"
 * - "agent_creation" → "Agent Creation"
 * - "memory_creation" → "Memory Creation"
 *
 * @param activityName - The snake_case activity name
 * @returns Formatted Title Case string
 */
export function formatActivityName(activityName: string | null | undefined): string {
  if (!activityName) return 'N/A';

  return activityName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Converts snake_case activity type to Title Case for display
 * Alias for formatActivityName for semantic clarity
 *
 * @param activityType - The snake_case activity type
 * @returns Formatted Title Case string
 */
export function formatActivityType(activityType: string | null | undefined): string {
  return formatActivityName(activityType);
}
