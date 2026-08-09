// lib/plugins/plugin-visibility.ts
//
// Single source of truth for the plugin discovery-visibility rule. `visibility` governs
// DISCOVERY/enumeration only — never resolution by key. See docs/PLUGIN_VISIBILITY_SCOPING.md.

import type { PluginDefinition } from '@/lib/types/plugin-types';

/**
 * Whether a plugin should appear in a general DISCOVERY surface.
 *
 * A `business_os` plugin is hidden by default and included only when the caller opts in
 * (`includeBusinessOs = true` — e.g. because the plugin's key was explicitly requested /
 * grounded in `servicesInvolved`). All other plugins (`visibility: 'public'` or absent) are
 * always discoverable.
 *
 * NOTE: do NOT use this to gate resolution-by-key (getPluginDefinition / execute / the V6
 * compiler's registry lookups) — those must always see every plugin.
 */
export function isPluginDiscoverable(
  def: Pick<PluginDefinition, 'plugin'> | undefined,
  includeBusinessOs = false
): boolean {
  if (!def) return false;
  return def.plugin.visibility !== 'business_os' || includeBusinessOs === true;
}
