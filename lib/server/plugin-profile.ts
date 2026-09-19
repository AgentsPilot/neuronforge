// lib/server/plugin-profile.ts
//
// Which V2 plugins this deployment loads: plain data plus one resolver.
// See docs/requirements/BUSINESS_OS_PLUGIN_PROFILE_REQUIREMENT.md.
//
// The profile is a LOAD gate: a plugin outside the active profile is never read,
// parsed or registered, so it is absent from discovery AND from resolution by key.
// Visibility (lib/plugins/plugin-visibility.ts) is a separate DISCOVERY gate over
// what was loaded. This module must not read or set `visibility`.

export type PluginProfileName = 'business_os' | 'all';

export interface PluginProfile {
  readonly name: PluginProfileName;
  readonly pluginKeys: readonly string[];
}

/**
 * Plugin keys per profile. The definition file is always `${key}-plugin-v2.json`
 * in lib/plugins/definitions/. `all` must list every definition file exactly once
 * (enforced by tests/plugins/unit-tests/plugin-registry-integrity.test.ts).
 * `business_os` must be an ordered subsequence of `all`, so iteration order (and
 * therefore LLM-context order) is stable across profiles.
 */
export const PLUGIN_PROFILES: Readonly<Record<PluginProfileName, readonly string[]>> = Object.freeze({
  all: Object.freeze([
    'google-mail',
    'google-drive',
    'google-sheets',
    'google-docs',
    'google-calendar',
    'slack',
    'whatsapp-business',
    'hubspot',
    'chatgpt-research',
    'document-extractor',
    'linkedin',
    'airtable',
    'discord',
    'dropbox',
    'meta-ads',
    'meta-insights',
    'google-analytics',
    'google-business-profile',
    'notion',
    'onedrive',
    'outlook',
    'salesforce',
    'stripe',
    // business-os + internal plugins: see the INTERIM DUPLICATION note on `business_os` below.
    'business-os',
    'crm',
    'scheduling',
    'payments',
    'website',
  ]),
  business_os: Object.freeze([
    'google-calendar', // CalendarSyncService (two-way calendar sync)
    'meta-insights', // channel insights (Facebook Page + Instagram)
    'google-analytics', // channel insights (GA4)
    'google-business-profile', // channel insights (connect / list locations)
    'outlook', // CalendarSyncService (alternative calendar provider)
    'stripe', // Stripe Connect OAuth definition only; BOS never invokes its executor
    // ---------------------------------------------------------------------
    // INTERIM DUPLICATION - a decision is owed here. Two Business OS plugin
    // surfaces are loaded on purpose, because they were built in parallel and
    // each already has its own consumer:
    //
    //   business-os          one catalog-generated plugin, backed by the
    //                        BizQL compiler + MutateExecutor. Reached by
    //                        DISCOVERY (no `visibility` field), so it is what
    //                        the agent-generation pipeline grounds against
    //                        (see lib/agentkit/convertPlugins.ts).
    //
    //   crm / scheduling /   four granular repository-backed internal plugins
    //   payments / website   with `visibility: "business_os"`, so they
    //                        are HIDDEN from discovery. Reached only by explicit
    //                        key from lib/business-os/ChatCommandExecutor.ts.
    //
    // They therefore do not contend: the generator never sees the four, and
    // nothing invokes `business-os` by key. Keep it that way until the shape is
    // decided - in particular do NOT add `visibility: "business_os"` to
    // business-os-plugin-v2.json, which would hide it from the generator and
    // break agent generation over the user's own records.
    //
    // For the same reason `business-os` MUST remain in this `business_os`
    // profile: dropping it here unloads it entirely, which breaks agent
    // generation over the user's own records just as hiding it would.
    //
    // See docs/requirements/BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md - decision
    // D9, open questions Q2/Q3/Q4.
    // ---------------------------------------------------------------------
    // The user's own business records. Generated from the Business Catalog -
    // see scripts/generate-business-os-plugin.ts. Regenerate after any catalog
    // change; the drift test fails if this file falls behind.
    'business-os',
    // Internal repository-backed Business OS plugins (db_active access strategy).
    'crm',
    'scheduling',
    'payments',
    'website',
  ]),
});

/**
 * THE ONE-LINE SWITCH. Change to 'all' to load every plugin again, which restores
 * the pre-profile set and order exactly. Hardcoded on purpose: no env var, DB or
 * admin setting (requirement U2). To run the AgentsPilot V6 regression tooling,
 * flip this to 'all' locally and do NOT commit it (requirement, user decision
 * Option A).
 */
const ACTIVE_PLUGIN_PROFILE: PluginProfileName = 'business_os';

// Frozen and cached so every caller gets the same reference for a given name.
const profileCache = new Map<PluginProfileName, PluginProfile>();

/** Pure lookup of a named profile. Tests use this to drive the loader explicitly. */
export function getPluginProfile(name: PluginProfileName): PluginProfile {
  const cached = profileCache.get(name);
  if (cached) return cached;
  const profile: PluginProfile = Object.freeze({ name, pluginKeys: PLUGIN_PROFILES[name] });
  profileCache.set(name, profile);
  return profile;
}

/**
 * The only answer to "which plugins are active". Synchronous, argument-free and
 * stable for the process lifetime. A future env/DB source replaces only this body.
 */
export function resolveActivePluginProfile(): PluginProfile {
  return getPluginProfile(ACTIVE_PLUGIN_PROFILE);
}
