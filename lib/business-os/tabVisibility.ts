/**
 * Which navigation entries an account gets, given what it has switched on.
 *
 * Pure and free of React so it can be tested directly — the rule it encodes is
 * the kind that is easy to get subtly wrong and impossible to notice, because
 * the failure is a tab that quietly is not there.
 */

export type CapabilitiesStatus = 'loading' | 'ready' | 'error';

/** Anything with an optional capability gate — a tab, in practice. */
export interface CapabilityGated {
  capability?: string;
}

/**
 * The three states of the capabilities request each need a different answer,
 * and collapsing them produces one of two bad behaviours:
 *
 *   loading — show only the ungated entries. Revealing the rest a moment later
 *             is a smaller jolt than showing six and taking two away, which
 *             moves the bar under a finger already on its way down.
 *   ready   — show exactly what the account has.
 *   error   — show everything. A tab leading to a page with nothing on it is a
 *             far smaller harm than navigation quietly disappearing because one
 *             request timed out. This is the opposite of what the capability
 *             cards do on failure, and deliberately so: an absent card is a
 *             thing the reader never knows they missed, an absent tab is a
 *             thing they cannot reach.
 */
export function filterByCapability<T extends CapabilityGated>(
  items: T[],
  capabilities: Set<string>,
  status: CapabilitiesStatus
): T[] {
  return items.filter((item) => {
    if (!item.capability) return true;
    if (status === 'ready') return capabilities.has(item.capability);
    return status === 'error';
  });
}
