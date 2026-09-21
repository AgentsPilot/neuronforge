# Plugin Visibility Scoping (Business-OS-only plugins)

> **Last Updated**: 2026-09-19

## Overview

Some V2 plugins are **internal / surface-scoped**: they are fully-functional standard plugins (registered, executable, V6-resolvable by key) but should **not** appear in the platform's general plugin **discovery** surfaces (the public plugin list, the agent-creation capability hints, the V6 capability binder/vocabulary) unless a caller **explicitly requests** them. The internal **CRM** plugin is the first such plugin: for now it is Business-OS-only.

This document defines the `visibility` metadata field, the exact discovery surfaces it gates, and — critically — the surfaces it must **not** gate (registry resolution by key), so an explicitly-requested internal plugin still binds, compiles, and executes.

Design reviewed and corrected by SA (2026-08-06): the original proposal to filter `getAvailablePlugins()` was rejected because that method is the V6 compiler's **registry-resolution primitive** (indexed by key at ~15 sites), not a discovery method — filtering it would make an explicitly-requested CRM workflow fail to compile.

## The rule

**Discovery vs. resolution.** `visibility` governs **discovery/enumeration** ("what plugins exist / are available for this user?") — never **resolution by key** ("give me the definition/executor for `crm`"). A `business_os` plugin is:

- **Hidden by default** from the five discovery surfaces below.
- **Included** in a discovery surface only when that caller opts in (`includeBusinessOs` / the plugin's key appears in `servicesInvolved`).
- **Always resolvable by key** — `getPluginDefinition('crm')`, `getActionDefinition`, `PluginExecuterV2.execute(userId, 'crm', …)`, `/api/plugins/action-schema`, and every V6 compiler resolution site are unaffected.

Access to actually *run* an internal plugin remains gated separately by its `access_strategy` (CRM uses `db_active`, fail-closed — see [access-strategy.ts](/lib/server/access-strategy.ts)). Visibility is orthogonal to both `isSystem` (which only means "no OAuth rail") and `access_strategy`.

## Metadata

`lib/types/plugin-types.ts` — on `PluginDefinition.plugin`:

```ts
type PluginVisibility = 'public' | 'business_os';
// plugin.visibility?: PluginVisibility   // default 'public' when absent
```

A single closed enum (not `surfaces: string[]`) — only one non-public surface exists today; matches the `access_strategy.type` closed-enum precedent; a future widening to a set is a backward-compatible migration. CRM's `crm-plugin-v2.json` sets `"visibility": "business_os"`.

Shared predicate — `lib/plugins/plugin-visibility.ts`:

```ts
isPluginDiscoverable(def, includeBusinessOs = false): boolean
  // → def.plugin.visibility !== 'business_os' || includeBusinessOs === true
```

## The five discovery surfaces gated (and the opt-in)

| # | Site | Default | Opt-in source |
|---|---|---|---|
| 1 | `PluginManagerV2.getActionableSystemPlugins(userId, { includeBusinessOs })` — feeds `getConnectedPlugins` / `getAllActivePluginKeys` / `generateLLMContext` | exclude | `includeBusinessOs` threaded from the caller |
| 2 | `GET /api/plugins/available` (UI, settings, test-page labels) | exclude | `?includeBusinessOs=true` query param |
| 3 | `CapabilityBinderV2` — `isSystem` injection into the V6 binding candidate set | exclude | `allowedBusinessOsKeys` (from grounded `servicesInvolved`) |
| 4 | `PluginVocabularyExtractor.extract(userId, { servicesInvolved })` — `isSystem` injection into V6 vocabulary | exclude | a `business_os` plugin is included iff its key ∈ `servicesInvolved` |
| 5 | agent-creation `process-message` — `getAvailablePlugins()` → `user_available_services` LLM capability hints | exclude | (none for now — internal plugins are not suggested as general capabilities) |

`getExecutablePlugins()` iterates OAuth DB connections only, so an internal plugin (no `plugin_connections` row) never appears there — no change needed. `getDisconnectedPlugins()` already skips `isSystem` — unaffected.

### Resolution surfaces intentionally NOT gated

`getAvailablePlugins()` stays unfiltered. Its by-key consumers must keep resolving `crm`: `PluginResolver`, `ExecutionGraphCompiler` (param build / schema validation), `PluginParameterValidator` (which hard-errors `Plugin 'crm' not found` and fails compilation if the plugin is missing), `FieldReferenceValidator`, `/api/plugins/execute`, `getPluginDefinition` / `getActionDefinition` / `getAllPluginNames`.

### Profile gate (upstream)

Visibility is the **second** of two gates. The first is the active **plugin profile** (`lib/server/plugin-profile.ts`, see [BUSINESS_OS_PLUGIN_PROFILE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLUGIN_PROFILE_REQUIREMENT.md)). The profile decides which plugins are **loaded** at all; visibility decides which **loaded** plugins are **discoverable**. The rule above, "never gate resolution-by-key", applies to loaded plugins: a plugin outside the profile cannot be resolved because it was never loaded, which is intended and is not a visibility change. The profile never reads or sets `visibility`, and `plugin-visibility.ts` does not import the profile.

Four metadata readers load definition JSON straight from disk by key: `ExecutionGraphCompiler.loadPluginAction`, `ExecutionSummaryCollector`, and the summary-metadata reads in `StepExecutor` and `WorkflowPilot`. They are read-only metadata for a step that already exists, not a load, discovery or execution gate. The profile is enforced where it matters: at `PluginManagerV2` load and at `PluginExecuterV2.execute` (which returns `plugin_not_enabled`).

## Interaction with the "standard V2 plugin, platform-wide" decision

The internal CRM plugin remains a standard, V6-resolvable, executable plugin (decision #2). This scoping only makes **discovery** hidden-by-default. Promoting CRM platform-wide later is a **one-line flip** — set `visibility: 'public'` (or remove the field) and it reappears in all five discovery surfaces; resolution/execution were never touched. The opt-in seam (V6 sites keying off `servicesInvolved`) also allows explicit V6 invocation before any such flip, with no re-plumbing.

## Blast radius

Contained to the five named sites + the metadata field + one predicate helper. Every existing plugin is `visibility: 'public'` by default, so their behavior is byte-for-byte unchanged. The only observable delta is CRM disappearing from the intended default surfaces while remaining fully executable by key.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-06 | Initial design | Added `plugin.visibility` (`public` \| `business_os`), gated the five discovery surfaces with a shared `isPluginDiscoverable` predicate + opt-in, and explicitly excluded `getAvailablePlugins()` and the V6 by-key resolution sites from filtering (SA correction). CRM set to `business_os`. |
| 2026-09-19 | Profile gate (upstream) note | Added the relationship to the plugin profile (`lib/server/plugin-profile.ts`): profile = what is loaded, visibility = what loaded plugins are discoverable. Recorded the four disk-reading metadata readers as non-gates. |
