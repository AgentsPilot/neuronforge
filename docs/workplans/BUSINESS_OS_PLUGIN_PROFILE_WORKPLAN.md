# Workplan: Business OS Plugin Profile (Restrict Loaded Plugins)

> **Last Updated**: 2026-09-19

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLUGIN_PROFILE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLUGIN_PROFILE_REQUIREMENT.md) (SA CLEARED WITH CONDITIONS, 2026-09-19)
**Date:** 2026-09-19
**Branch:** `feature/business-os-plugin-profile` (created by RM, cut from `main` @ `01d0116b`). Worktree: `neuronforge-plugin-profile`. No commits by Dev.
**Status:** Code Complete (2026-09-19). SA approved the workplan with conditions W1–W7, all folded in and implemented. Awaiting SA code review. Nothing staged or committed.

## Overview

This workplan implements the SA-approved **named plugin profile + single resolver** pattern. A new module, `lib/server/plugin-profile.ts`, holds two profiles (`business_os`, 11 keys, and `all`, 28 keys) and a hardcoded `ACTIVE_PLUGIN_PROFILE = 'business_os'`. `PluginManagerV2` loads only the resolved set. `PluginExecuterV2` returns a clean `plugin_not_enabled` result for registered plugins outside the profile. The work also covers the test fallout (integrity-test rewrite, pinning suites to `all`), the `new-plugin` skill and doc updates, and the user's decision to accept that the V6 regression tooling does not run as committed (Option A).

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [User Decision: V6 Regression Tooling (Option A)](#2-user-decision-v6-regression-tooling-option-a)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify / Delete](#4-files-to-create--modify--delete)
5. [Task List (mapped to C1–C12)](#5-task-list-mapped-to-c1c12)
6. [Repo-wide Sweep](#6-repo-wide-sweep)
7. [Test Plan (mapped to AC1–AC15)](#7-test-plan-mapped-to-ac1ac15)
8. [Rollback](#8-rollback)
9. [Open Questions for SA](#9-open-questions-for-sa)
10. [SA Review Notes](#10-sa-review-notes)
11. [QA Testing Report](#11-qa-testing-report)
12. [Commit Info](#12-commit-info)
13. [Change History](#change-history)

---

## 1. Analysis Summary

| Area | What it touches | Change |
|---|---|---|
| Profile data + resolver | `lib/server/plugin-profile.ts` (new) | `PLUGIN_PROFILES`, `ACTIVE_PLUGIN_PROFILE`, `getPluginProfile`, `resolveActivePluginProfile` |
| Loader | `lib/server/plugin-manager-v2.ts` | `corePluginFiles` and module-load log deleted. `initializeWithCorePlugins(profile?)`, `loadCorePlugins(profile)`, new `getActiveProfile()`, one summary log line |
| Executor gate | `lib/server/plugin-executer-v2.ts` | `plugin_not_enabled` check before `getOrCreateExecutor` in `execute()` and `fetchDynamicOptions()`. INTERIM comment back-reference updated |
| Tests | integrity test, `mock-plugin-manager.ts`, two DeclarativeCompiler suites, two new test files | Rewrite, pin to `all`, new coverage |
| Docs / skill | `new-plugin` SKILL, `PLUGIN_GENERATION_WORKFLOW.md`, `V2_PLUGIN_MANAGER_BEHAVIOUR.md`, `PLUGIN_VISIBILITY_SCOPING.md`, V6 regression runbooks | Registration instructions, profile-gate note, flip-locally instruction |
| DB | none | `plugin_connections` untouched (FR17). No migration |
| API routes | none | `/api/plugins/execute` returns 404 "Plugin not found" for an excluded key, because the definition lookup comes first (`route.ts` L89–96). `plugin_not_enabled` reaches only in-process `PluginExecuterV2` callers (Q7, corrected by QA) |
| Provider factory / V6 pipeline code | none | Behaviour narrows as documented in the requirement's Impact section |

**Q4 record (SA decision):** no Business OS runtime path calls a discovery or LLM-context method (`getAvailablePlugins`, `getPluginSummariesForStage1`, `getAllActivePluginKeys`, `generateLLMContext`, `getConnectedPlugins`, `getExecutablePlugins`). BOS reaches plugins only by key through `PluginExecuterV2.execute`. The smaller LLM context therefore benefits the **shared deployment** (AgentsPilot agent creation, V6, `/api/llm/context`), not BOS chat. For BOS the benefits are less parsing and memory and no env-var warnings from integrations it does not offer. This does not change scope.

**Not a V6 pipeline fix.** No V6 phase (IntentContract, CapabilityBinderV2, IntentToIRConverter, ExecutionGraphCompiler) is modified. The V6 Work Protocol's WEAK_POINTS and OPEN_ITEMS bookkeeping does not apply. The only V6 doc touched is the runbook line (C10).

---

## 2. User Decision: V6 Regression Tooling (Option A)

**Resolved by the user on 2026-09-19: Option A.**

- The AgentsPilot agent-generation regression suite (`tests/v6-regression/run-regression.ts` and the `scripts/test-*` V6 scripts: Gmail, Drive, Sheets and similar scenarios) **cannot run as committed** while `business_os` is the active profile. This is accepted.
- A developer who needs the suite changes the single `ACTIVE_PLUGIN_PROFILE` line in `lib/server/plugin-profile.ts` to `'all'` **locally** and **does not commit** that change.
- **No test-only or script-only switch is added.** There is exactly one way to change the plugin set.
- Recorded in the requirement (question marked resolved, Change History row) and implemented as the runbook line in task C10.

The Jest-level pinning in C6 (`jest.mock` of the profile module in singleton suites, explicit `getPluginProfile('all')` in the test manager) is **not** a runtime switch. It is the SA-approved Q5 test seam and stays in scope.

---

## 3. Implementation Approach

### 3.1 `lib/server/plugin-profile.ts` (C1, C3): exact shape

Plain data plus two pure functions. It has no imports: no `fs`, no logger, no `process.env`, and nothing from `plugin-visibility.ts`. This keeps it side-effect free and cheap for the integrity test to import.

**File:** `lib/server/plugin-profile.ts`

```typescript
// lib/server/plugin-profile.ts
//
// Which V2 plugins this deployment loads. Plain data plus one resolver.
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
    'google-calendar',          // CalendarSyncService (two-way calendar sync)
    'meta-insights',            // channel insights (Facebook Page + Instagram)
    'google-analytics',         // channel insights (GA4)
    'google-business-profile',  // channel insights (connect / list locations)
    'outlook',                  // CalendarSyncService (alternative provider)
    'stripe',                   // Stripe Connect OAuth definition only; executor never invoked by BOS
    // ---------------------------------------------------------------------
    // <INTERIM DUPLICATION comment moved VERBATIM from plugin-manager-v2.ts,
    //  with `intake` removed: "four granular repository-backed internal plugins",
    //  "crm / scheduling / payments / website", "the generator never sees the four".>
    //
    // `business-os` MUST remain in this `business_os` profile for the same reason:
    // removing it here unloads it entirely and breaks agent generation over the
    // user's own records, exactly as hiding it via `visibility` would.
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
 * THE ONE-LINE SWITCH. Change to 'all' to load every plugin again (restores the
 * pre-profile behaviour exactly). Hardcoded on purpose: no env var, DB or admin
 * setting (requirement U2). To run the V6 regression tooling, flip this locally
 * and do NOT commit it (requirement, user decision Option A).
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
 * The only answer to "which plugins are active". Synchronous, argument-free,
 * stable for the process lifetime. A future env/DB source replaces only this body.
 */
export function resolveActivePluginProfile(): PluginProfile {
  return getPluginProfile(ACTIVE_PLUGIN_PROFILE);
}
```

Notes:
- The comment block in `business_os` is a placeholder in this plan. In the code, the INTERIM DUPLICATION text is pasted **verbatim** from `plugin-manager-v2.ts` L38–62 with only the `intake` edits SA required (C3, Q10), plus the one "must remain" sentence.
- The per-key trailing comments in `business_os` repeat the requirement's evidence table in one line each. They are optional and can be dropped if SA prefers pure data.
- No other exports: no `setActiveProfile`, no helper class, no error class (C1).

### 3.2 `PluginManagerV2` (C1, C8)

**File:** `lib/server/plugin-manager-v2.ts`

| Change | Detail |
|---|---|
| Import | `import { type PluginProfile, getPluginProfile, resolveActivePluginProfile } from '@/lib/server/plugin-profile';` |
| Delete | `corePluginFiles` (L14–72) including the INTERIM comment (moved in C3), and the module-load `logger.info` plus its `if (!globalForPluginManager.pluginManagerInstance)` guard (L80–86). The `globalForPluginManager` declaration stays because `getInstance()` uses it. |
| New field | `private profile: PluginProfile \| null = null;` |
| `initializeWithCorePlugins(profile: PluginProfile = resolveActivePluginProfile())` | If already initialised: existing debug log and return (a second call with a different profile is ignored, as today). Otherwise set `this.profile = profile`, `await this.loadCorePlugins(profile)`, set `initialized = true`, then emit the **single** summary line (below). `getInstance()` keeps calling it with no argument. |
| `loadCorePlugins(profile: PluginProfile)` | `for (const pluginKey of profile.pluginKeys)`, `fileName = \`${pluginKey}-plugin-v2.json\``, then read, env-substitute, validate and `this.plugins.set(pluginKey, …)` exactly as today. The existing `logger.error({ err, fileName }, 'Failed to load plugin')` covers a profile key with no file (FR10, SA correction: no new branch). |
| `getActiveProfile(): PluginProfile` | Returns the profile this instance loaded. Before initialisation it returns `resolveActivePluginProfile()` (see SA question 1). |
| Summary log (replaces L144) | `logger.info({ profile: profile.name, loadedPluginKeys, loadedCount, skippedPluginKeys, skippedCount }, 'Plugin manager initialized')`. `loadedPluginKeys = [...this.plugins.keys()]` (actually registered). `skippedPluginKeys = getPluginProfile('all').pluginKeys.filter(k => !profile.pluginKeys.includes(k))` (empty under `all`). |

No other method changes. Discovery methods iterate `this.plugins`, so they narrow automatically. `processEnvironmentVariables` is untouched, and skipped files are never read, so they produce no warnings (FR19, FR20).

### 3.3 `PluginExecuterV2`: the `plugin_not_enabled` path (C4, C8)

**File:** `lib/server/plugin-executer-v2.ts`

One private helper shared by both call sites. It decides "not enabled" only for keys that **are** in the registry, so "not registered" (a real bug) keeps today's result (FR14, AC9):

```typescript
// Returns the not-enabled message for a registered plugin outside the manager's
// active profile, or null when the call should proceed. Unregistered keys return
// null on purpose so they keep today's "executor not found" execution_error.
private getNotEnabledMessage(pluginName: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(PluginExecuterV2.executorRegistry, pluginName)) {
    return null;
  }
  const profile = this.pluginManager.getActiveProfile();
  if (profile.pluginKeys.includes(pluginName)) return null;
  return `Plugin '${pluginName}' is not enabled in the '${profile.name}' plugin profile`;
}
```

`hasOwnProperty` is used instead of `in` so prototype names such as `constructor` are not treated as registered.

**`execute()`**: the check runs first, **before** the `'Executing plugin action'` info log and before `getOrCreateExecutor`:

```typescript
const notEnabledMessage = this.getNotEnabledMessage(pluginName);
if (notEnabledMessage) {
  logger.warn(
    { pluginKey: pluginName, profile: this.pluginManager.getActiveProfile().name, actionName },
    'Plugin not enabled in active profile'
  );
  return { success: false, error: 'plugin_not_enabled', message: notEnabledMessage };
}
logger.info({ userId, pluginName, actionName }, 'Executing plugin action');
// ... existing try/catch unchanged
```

**`fetchDynamicOptions()`**: its contract is throw-on-failure, so it throws before constructing:

```typescript
const notEnabledMessage = this.getNotEnabledMessage(pluginName);
if (notEnabledMessage) {
  logger.warn({ pluginKey: pluginName, profile: this.pluginManager.getActiveProfile().name }, 'Plugin not enabled in active profile');
  throw new Error(notEnabledMessage);
}
const executor = this.getOrCreateExecutor(pluginName);
```

Properties this gives (C4, Q8):
- The executor gates through `this.pluginManager.getActiveProfile()`, never the resolver, so executor and manager agree by construction, including test managers built with an explicit profile.
- The message contains only the key and the profile name. It has no stack trace or path, and none of the retryable tokens that `ErrorRecovery` or `lib/pilot/shadow/FailureClassifier.ts` match (`timeout`, `ECONN*`, `ENOTFOUND`, `429`, `50x`, `rate limit`, …). It also does not match the classifier's `/not found/i`, which is correct: this is a configuration choice, not a missing resource.
- The `executorRegistry` object literal is not edited except for the comment (C3). The integrity test's `registeredExecutorKeys()` regex takes the **first** `executorRegistry …= {` in the file, which is still the declaration. The new helper references it only later. The updated comment inside the registry must not contain a `'key':` pattern or a line starting with `}`, because either would corrupt that regex.
- C3 comment update inside the registry: "INTERIM DUPLICATION - see the note on the `business-os` entry of PLUGIN_PROFILES in lib/server/plugin-profile.ts" and "the four internal plugins below" (was "five").

### 3.4 Logging decision (C8)

| Event | Level | Fields | Count |
|---|---|---|---|
| Manager initialised | `info` | `profile, loadedPluginKeys, loadedCount, skippedPluginKeys, skippedCount` | Exactly one per manager initialisation |
| Module load | — | — | Deleted |
| Skipped plugin | — | — | None (never read) |
| Missing env var, in-profile plugin | `warn` (unchanged) | `varName` | Unchanged (FR20) |
| Not-enabled request (`execute`) | `warn` | `userId, pluginKey, profile, actionName` (W2) | Once per request, before any execution log |
| Not-enabled request (`fetchDynamicOptions`) | `warn` | `pluginKey, profile` (W2; no `userId` parameter there) | Once per call, before the throw |

---

## 4. Files to Create / Modify / Delete

| File | Action | Reason | Condition |
|---|---|---|---|
| `lib/server/plugin-profile.ts` | create | Profile data + resolver, canonical shape | C1, C3 |
| `lib/server/plugin-manager-v2.ts` | modify | Delete `corePluginFiles`, module-load log. Profile-driven loader, `getActiveProfile()`, summary log | C1, C3, C8 |
| `lib/server/plugin-executer-v2.ts` | modify | `plugin_not_enabled` gate in `execute` + `fetchDynamicOptions`. INTERIM back-reference | C3, C4, C8 |
| `tests/plugins/unit-tests/plugin-registry-integrity.test.ts` | modify | Replace source parsing of the manager with `PLUGIN_PROFILES`. AC4 home | C2 |
| `tests/plugins/common/mock-plugin-manager.ts` | modify | `initializeWithCorePlugins(getPluginProfile('all'))` | C6 |
| `__tests__/DeclarativeCompiler-comprehensive.test.ts` | modify | Pin `all` via `jest.mock('@/lib/server/plugin-profile', …)` | C6 |
| `__tests__/DeclarativeCompiler-regression.test.ts` | modify | Same pin | C6 |
| Any further singleton suite found by the baseline diff | modify | Same pin (or explicit profile) | C6 |
| `tests/plugins/unit-tests/plugin-manager-profile.test.ts` | create | AC2, AC3, AC5, AC6, AC7, AC11, AC12 | C6, C7, C8 |
| `tests/plugins/unit-tests/plugin-executer-profile-gate.test.ts` | create | AC8, AC9, AC10 | C4, C7 |
| `.claude/skills/new-plugin/SKILL.md` | modify | L50 table row + L82 checklist item | C5 |
| `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md` | modify | §9a (L560–563) + L904 | C5 |
| `docs/V2_PLUGIN_MANAGER_BEHAVIOUR.md` | modify | §5 step 2 (L549) | C5 |
| `docs/PLUGIN_VISIBILITY_SCOPING.md` | modify | "Profile gate (upstream)" note + Change History row | C9 |
| `tests/v6-regression/scripts/README.md` | modify | One line: flip `ACTIVE_PLUGIN_PROFILE` to `'all'` locally, never commit | C10 |
| `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md` | modify | Same line under "Prerequisites" + Change History row | C10 |
| `docs/requirements/BUSINESS_OS_PLUGIN_PROFILE_REQUIREMENT.md` | modify (done in this planning step) | Option A recorded, Change History row | — |
| `docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md` | modify | Recipe step 3 (L46) registers the key in `PLUGIN_PROFILES.all` **and** `business_os`. Last Updated + Change History row | C5 / W3 |
| — | delete | **No files deleted.** Only the `corePluginFiles` array and the module-load log block are removed from inside `plugin-manager-v2.ts` | C12 |

**Not touched (C11, C12 scope guard):** `lib/plugins/pluginList.tsx`, `lib/plugins/plugin-visibility.ts`, `app/oauth/callback/[plugin]/route.ts`, `app/api/v2/plugins/connect/route.ts`, `lib/plugins/pluginKeys.ts` (`PLUGIN_KEYS`), `plugin_connections` data, any definition JSON, any executor class, `lib/agentkit/convertPlugins.ts` (has `console.*` but is out of scope).

---

## 5. Task List (mapped to C1–C12)

Mark each ✅ when complete.

- [x] ✅ **T0: Baseline (C6).** On a clean checkout of `main` @ `01d0116b`, after `npm ci` completes, run `npx jest --ci --silent --json --outputFile=<scratchpad>/baseline-main.json`. Extract the sorted list of failing test IDs (`file › full test name`) into `baseline-main-failures.txt`. Record the pass/fail/skip counts in §7.3. Use the worktree before any code change, or a second clean `main` worktree.
- [x] ✅ **T1: C1. Create `lib/server/plugin-profile.ts`** exactly as in §3.1. `all` has 28 keys in today's `corePluginFiles` order; `business_os` has the 11 keys as an ordered subsequence.
- [x] ✅ **T2: C3. Move the INTERIM DUPLICATION comment** verbatim into `plugin-profile.ts` next to `business_os`'s `business-os` entry. Remove `intake` ("four", "crm / scheduling / payments / website", "never sees the four"). Add the "must remain in the `business_os` profile" sentence. Keep the "user's own business records / regenerate" comment and the "Internal repository-backed" comment with their entries.
- [x] ✅ **T3: C1, C8, W1. Refactor `plugin-manager-v2.ts`** per §3.2. Delete `corePluginFiles` and the module-load log block, add `profile` field, parameterised `initializeWithCorePlugins` / `loadCorePlugins`, `getActiveProfile()`, and the single summary `info` line. Verify by grep that no `-plugin-v2.json'` literal and no plugin key list remains in the file.
- [x] ✅ **T4: C3, C4, C8, W2, W5. Gate `plugin-executer-v2.ts`** per §3.3. Add the `getNotEnabledMessage` helper, the `execute()` early return with a `warn` before the info log, the `fetchDynamicOptions()` throw before construction, and update the registry comment. The registry literal itself stays unchanged.
- [x] ✅ **T5: C2, W5. Rewrite `plugin-registry-integrity.test.ts`** per §7.1.
- [x] ✅ **T6: C6. Pin `mock-plugin-manager.ts`** to `getPluginProfile('all')`. This one change covers every suite built on `createTestPluginManager`/`createTestExecutor` (~20 per-plugin unit suites through `test-helpers.ts` and `error-scenarios.ts`, 7 integration suites, `base-executor.test.ts`).
- [x] ✅ (deviation, see §11) **T7: C6. Pin singleton suites** (`DeclarativeCompiler-comprehensive`, `DeclarativeCompiler-regression`) with the Q5-b `jest.mock` (§7.2). Then add the same pin to any other suite the T11 diff shows as newly failing because a non-BOS plugin is absent.
- [x] ✅ **T8: C7, C8. Write `plugin-manager-profile.test.ts`** (AC2, AC3, AC5, AC6, AC7, AC11, AC12).
- [x] ✅ **T9: C4, C7, W2. Write `plugin-executer-profile-gate.test.ts`** (AC8, AC9, AC10).
- [x] ✅ **T10: C5, C9, C10, W3, W4. Docs and skill** per §7.4.
- [x] ✅ **T11: C6. Branch run and diff.** Run the same Jest command on the branch into `branch-failures.txt`, then `comm -13 baseline-main-failures.txt branch-failures.txt`. It must be **empty** (zero new failures). Also list tests that went from failing to passing, and fix or pin any new failure with T7's pattern. No `.skip`, no deletion, no weakened assertion.
- [x] ✅ **T12: C11. Standards check.** `npx tsc --noEmit` shows no new errors in touched files. No `any` in `plugin-profile.ts`. No `console.*` added. Imports use `@/`. See the logging check below.
- [x] ✅ **T13: C12. Scope check.** `git diff --stat main` lists only the files in §4. Run `git diff main -- lib/plugins app/oauth app/api/v2 lib/plugins/pluginKeys.ts lib/plugins/definitions` and confirm it is empty.
- [x] ✅ **T14.** Fill in the Dev implementation notes (files, deviations, baseline diff result) and notify TL for SA code review.

**Logging-standard check (CLAUDE.md § Logging):** `plugin-manager-v2.ts` 0 `console.*`, `plugin-executer-v2.ts` 0, `mock-plugin-manager.ts` 0, `plugin-registry-integrity.test.ts` 0, `DeclarativeCompiler-comprehensive.test.ts` 0. `DeclarativeCompiler-regression.test.ts` has 7, but it is a test file outside the `lib/`/`app/`/`components/` scope of the rule, and only one `jest.mock` block is added to it, so no conversion is proposed. `lib/agentkit/convertPlugins.ts` has `console.*` but is not touched (C11).

---

## 6. Repo-wide Sweep

### 6.1 `corePluginFiles` references

| Location | Kind | Action |
|---|---|---|
| `lib/server/plugin-manager-v2.ts` L14, L83–84, L154 | Code | Removed / replaced (T3) |
| `lib/server/plugin-executer-v2.ts` L63 | Comment back-reference | Repointed to `plugin-profile.ts` (T4, C3) |
| `tests/plugins/unit-tests/plugin-registry-integrity.test.ts` L43–47 | Source-parsing test | Rewritten (T5, C2) |
| `.claude/skills/new-plugin/SKILL.md` L50, L82 | Skill (source of truth) | Updated (C5) |
| `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md` L560–563, L904 | How-to | Updated (C5) |
| `docs/V2_PLUGIN_MANAGER_BEHAVIOUR.md` L549 | How-to | Updated (C5) |
| `docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md` L53, L67, L230 | Historical SA review | **No change.** It is a point-in-time record |
| `docs/workplans/BUSINESS_OS_{CRM,SCHEDULING,PAYMENTS,INTAKE,WEBSITE}_*_WORKPLAN.md` | Historical workplans | No change |
| `docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md` L46 ("3. Register: add the definition to `corePluginFiles`") | **Living** roadmap with a forward-looking recipe | See SA question 3 (proposal: update the one line to `PLUGIN_PROFILES.all` (+ `business_os` for BOS modules), same as C5) |
| `docs/PERFORMANCE_OPTIMIZATION_PLAN.md` L1703–1705 (`Plugin-Manager-v2 module loaded` log excerpt) | Historical log capture | No change. No code or alert keys on either removed log message |

### 6.2 Loader callers (`initializeWithCorePlugins` / `new PluginManagerV2`)

| Caller | Under `business_os` | Action |
|---|---|---|
| `PluginManagerV2.getInstance()` | Loads the 11 | Intended |
| `tests/plugins/common/mock-plugin-manager.ts` | Would lose Gmail/Drive/… definitions | Pin `all` (T6) |
| `scripts/qa-v6-execution-layer.ts`, `scripts/test-v6-gmail-complaints.ts`, `scripts/test-document-extractor-plugin.ts` | Default profile, so non-BOS plugins are missing | **No change.** Covered by the Option A runbook line (flip locally) |
| `__tests__/v6-integration.test.ts` (`new PluginManagerV2()` with no argument and never initialised) | Unaffected by the profile (already constructs incorrectly) | No change. Its status is whatever the baseline shows |
| `archive/test-*.ts` | Archived | No change |

### 6.3 Other consumers of "which plugins exist"

| Finding | Assessment |
|---|---|
| **Four production paths read definition JSON straight from disk by key, bypassing the manager:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` L4686–4705 (`loadPluginAction`), `lib/pilot/shadow/ExecutionSummaryCollector.ts` L25–36, `lib/pilot/StepExecutor.ts` L6462–6470, `lib/pilot/WorkflowPilot.ts` L1249–1257 | These do not hold a plugin **list** (FR7 is not violated). They read metadata (action parameter schemas, output/summary hints) for a key that is already in a workflow. For an excluded plugin they would still find the file. This does not open an execution path, because every execution goes through the gated `PluginExecuterV2.execute`, and V6 compilation fails earlier in `PluginParameterValidator`. It does mean that "excluded is absent from every surface" is not literally true for these metadata reads. **Proposal: no change this cycle** (V6/Pilot code is out of scope, and routing these through the manager is a separate refactor). See SA question 2. |
| `lib/plugins/tester/connection-gate.ts` `REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS` (Drive, Sheets, Docs, Gmail, Calendar) | The `/test-plugins-v2` Plugin API Tester only enables itself when all five are connected. Four of the five are excluded, so under `business_os` the tester panel is **permanently gated off**. This is an AgentsPilot internal tool and falls under the accepted U4 impact (the requirement already says `/test-plugins-v2` lists only profile plugins), but neither BA nor SA called out this specific effect. No change. Recorded for QA's expectations. |
| `app/api/plugins/schema-metadata/route.ts` L43 `getAllPluginNames()` | Narrows to the 11. Intended |
| `lib/plugins/pluginKeys.ts` `PLUGIN_KEYS`, `lib/plugins/pluginList.tsx` | Out of scope (C12, Q9) |
| `executorRegistry` referenced outside the executor | Only by the integrity test's source regex (kept). See §3.3 for the regex constraint |
| Test files that `jest.mock('@/lib/server/plugin-manager-v2', …)` with stubs lacking `getActiveProfile` (`StructuralRepairEngine.*`, `transformParametersForPlugin.objectPassthrough`, `action-schema` route, `identity-hardening`) | None of them drives the **real** `PluginExecuterV2.execute` (identity-hardening and ChannelMetricsSyncService mock the executer module itself). No breakage expected. The T11 diff is the backstop |
| V6 unit tests with stub managers (`CapabilityBinderV2.wp63`, `DataSchemaBuilder.*`, `W2-pipeline`, `v4-generator`) | Stubs only, not affected |

---

## 7. Test Plan (mapped to AC1–AC15)

### 7.1 `plugin-registry-integrity.test.ts` rewrite (C2, AC1, AC4)

This stays a source/filesystem test that costs nothing: `plugin-profile.ts` has no imports, so importing it has no side effects.

| Before | After |
|---|---|
| `managerPluginKeys()` regex over `plugin-manager-v2.ts` source | **Deleted.** Replaced by `import { PLUGIN_PROFILES } from '@/lib/server/plugin-profile'` |
| `it('loads every plugin definition in the plugin manager')` | `it('the all profile lists every plugin definition exactly once')`: `[...PLUGIN_PROFILES.all].sort()` **equals** `definedPluginKeys()`, **and** `new Set(all).size === all.length`. This is strictly stronger than before, because it also catches extras and duplicates |
| — | `it('every key in every profile has a definition file')`: for each `[name, keys]` of `Object.entries(PLUGIN_PROFILES)`, keys not in `definedPluginKeys()` equals `[]` (message names the profile) |
| — | `it('business_os is an ordered subsequence of all')`: walk `all` with a cursor, and assert every `business_os` key is found in order with no duplicates |
| — | `it('business_os keeps both Business OS plugin surfaces')`: contains `business-os`, `crm`, `scheduling`, `payments`, `website` |
| `finds the three registries`, `advertises no plugin the backend cannot load`, `registers an executor for every plugin definition`, `exports only real plugin keys from PLUGIN_KEYS` | **Unchanged.** Not weakened (C2). The header comment gains one sentence: the catalog check is against definition files, not the active profile (SA's accepted consequence) |

### 7.2 Pinning pattern for singleton suites (C6, AC15, Q5-b)

**File:** `__tests__/DeclarativeCompiler-comprehensive.test.ts`, `__tests__/DeclarativeCompiler-regression.test.ts` (and any suite T11 surfaces)

```typescript
// These suites exercise non-Business-OS plugins (Gmail, Sheets, Slack) through the
// PluginManagerV2 singleton, so pin the 'all' profile. Test-only module substitution,
// not a runtime switch (requirement SA Q5-b).
jest.mock('@/lib/server/plugin-profile', () => {
  const actual = jest.requireActual('@/lib/server/plugin-profile');
  return { ...actual, resolveActivePluginProfile: () => actual.getPluginProfile('all') };
});
```

This works because `initializeWithCorePlugins`'s default parameter is evaluated at call time. Each Jest test file has its own module registry and `globalThis`, so the singleton cannot leak between files. Suites that import `'../lib/server/plugin-manager-v2'` relatively still hit the mock, because the manager imports the profile module through `@/`, which resolves to the same file.

### 7.3 Acceptance-criteria matrix

| AC | Test / check | Where | Type |
|---|---|---|---|
| AC1 | `all` equals definitions set, same order as today's `corePluginFiles` (order confirmed by review against the deleted array in the diff) | integrity test + SA review | Unit + review |
| AC2 | Build two managers with `new PluginManagerV2(createMockUserConnections())`, init with `getPluginProfile('business_os')` and `getPluginProfile('all')`. `getAllPluginNames()` has length 11 and 28 respectively. Separately assert `resolveActivePluginProfile().name === 'business_os'` (pins the committed constant) | `plugin-manager-profile.test.ts` | Unit |
| AC3 | Review grep: no `-plugin-v2.json'` literal or key list in `plugin-manager-v2.ts`. Test: the summary log's `loadedPluginKeys` equals the profile's keys, and `skippedPluginKeys` equals `all` minus profile | review + `plugin-manager-profile.test.ts` | Review + unit |
| AC4 | Every profile key has a file. `business_os` ⊂ `all` in order. The five BOS keys are present | integrity test | Unit |
| AC5 | `getAllPluginNames()` sorted equals the profile keys sorted, for both profiles. `getActiveProfile()` returns the profile passed in | `plugin-manager-profile.test.ts` | Unit |
| AC6 | `jest.spyOn(require('fs'), 'readFileSync')` wraps the real function. After a `business_os` init, no call's first argument ends in an excluded `<key>-plugin-v2.json`. Env: collect `${VAR}` names that occur **only** in excluded definition files, delete them from `process.env` for the test, and assert no mocked-logger `warn` call has `varName` in that set. Fallback if the spy does not intercept through the TS namespace import: `jest.mock('fs', …)` with a pass-through `jest.fn` | `plugin-manager-profile.test.ts` | Unit (C7) |
| AC7 | Under `business_os`: `getPluginDefinition('business-os')` is defined, has no `visibility`, and `isPluginDiscoverable(def)` is `true`. For `crm`/`scheduling`/`payments`/`website`, `isPluginDiscoverable(def)` is `false` without the opt-in | `plugin-manager-profile.test.ts` | Unit |
| AC8 | Executor gate test (setup below): `execute('u1', 'google-mail', 'send_email', {})` **resolves** to `{ success: false, error: 'plugin_not_enabled', message }`, and the message contains `'google-mail'` and `'business_os'`. The mocked `GmailPluginExecutor` constructor has 0 calls. A `warn` is logged with `{ userId, pluginKey, profile, actionName }` (W2), and the `'Executing plugin action'` info is **not** logged | `plugin-executer-profile-gate.test.ts` | Unit (C7) |
| AC9 | `execute('u1', 'does-not-exist', 'x', {})` resolves to `{ success: false, error: 'execution_error' }`, and the message contains `Plugin executor not found` | same | Unit |
| AC10 | `fetchDynamicOptions('google-mail', 'listLabels', {}, {})` **rejects** with the not-enabled message. `GmailPluginExecutor` has 0 constructions | same | Unit (C7) |
| AC11 | Manager on `business_os` with a mocked `UserPluginConnections` returning active rows for `google-mail` and `google-calendar`: `getConnectedPlugins` / `getExecutablePlugins` resolve without throwing, include `google-calendar`, and exclude `google-mail` | `plugin-manager-profile.test.ts` | Regression |
| AC12 | With `@/lib/logger` mocked (the shared-object pattern from `app/api/admin/chat-usage/__tests__/route.test.ts`), one `business_os` init produces exactly **one** `info` call, with message `'Plugin manager initialized'` and fields `profile/loadedPluginKeys/loadedCount/skippedPluginKeys/skippedCount` (skippedCount 17). No logger call of any level mentions an excluded key | `plugin-manager-profile.test.ts` | Unit (C8) |
| AC13 | Existing `ChatCommandExecutor` / crm / scheduling / payments executor tests pass unchanged. Confirmed by the T11 diff | existing suites | Regression |
| AC14 | Existing `ChannelMetricsSyncService` and `CalendarSyncService` tests pass (T11). **QA manual smoke:** on a dev server, connect one channel provider (e.g. `google-analytics` via `/business-os` channel connect) or run the Calendar sync settings connect. Record the result, and confirm the startup summary line shows `profile: business_os`, `loadedCount: 11`, `skippedCount: 17`, and that no `Environment variable not found` warning names a variable used only by excluded plugins, e.g. Slack or Notion client ids (W7) | existing suites + QA | Regression + manual |
| AC15 | T6 + T7 pins. T11 diff shows **zero new failures**. Nothing deleted or skipped | whole suite | Regression |

**Executor gate test setup (AC8–AC10):**
- `jest.mock('@/lib/server/gmail-plugin-executor', () => ({ GmailPluginExecutor: jest.fn() }))`. The registry statically imports it, so the mock replaces the class in the registry.
- Build `testManager = new PluginManagerV2(createMockUserConnections())` and `await testManager.initializeWithCorePlugins(getPluginProfile('business_os'))`.
- `jest.spyOn(PluginManagerV2, 'getInstance').mockResolvedValue(testManager)`, then `const executer = await PluginExecuterV2.getInstance()`. This uses the real private constructor through the public factory, and `UserPluginConnections.getInstance()` is safe because `tests/plugins/jest-setup.ts` stubs the Supabase env.
- The module-level `pluginExecuterInstance` singleton is fine within this single file.

### 7.4 Doc and skill updates (C5, C9, C10)

| File | Change |
|---|---|
| `.claude/skills/new-plugin/SKILL.md` L50 | Row becomes: `new only` \| `lib/server/plugin-profile.ts` \| add the plugin **key** to `PLUGIN_PROFILES.all` (keep `all` covering every definition file; the integrity test enforces it). Also add it to `PLUGIN_PROFILES.business_os` **only** if Business OS invokes it at runtime (keep `business_os` an ordered subsequence of `all`) |
| `.claude/skills/new-plugin/SKILL.md` L82 | "Plugin key is identical in three places: filename (`<name>-plugin-v2.json`), `PLUGIN_PROFILES.all` in `lib/server/plugin-profile.ts`, and `executorRegistry` key." Plus a note: while the active profile is `business_os`, a new non-BOS plugin is registered but not loaded. Flip `ACTIVE_PLUGIN_PROFILE` to `'all'` locally to test it, and do not commit |
| `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md` §9a (L556–571) | Retitle "Register in the plugin profile". File becomes `lib/server/plugin-profile.ts`, and the snippet shows adding `'{pluginName}'` to `PLUGIN_PROFILES.all` (and `business_os` only if BOS uses it). Log line updated |
| `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md` L904 | "Ensure the plugin key is listed in `PLUGIN_PROFILES.all` in `lib/server/plugin-profile.ts`" |
| `docs/V2_PLUGIN_MANAGER_BEHAVIOUR.md` L549 | "2. Add the plugin key to `PLUGIN_PROFILES.all` in `lib/server/plugin-profile.ts` (and `business_os` if Business OS uses it)". Bump Last Updated, and add a Change History row if the doc has one |
| `docs/PLUGIN_VISIBILITY_SCOPING.md` | New short section before "Change History", "Profile gate (upstream)": the active plugin profile (`lib/server/plugin-profile.ts`) decides what is **loaded**, visibility decides which loaded plugins are **discoverable**, and "never gate resolution-by-key" applies to loaded plugins (an unloaded plugin cannot be resolved by construction; this is not a visibility change). Change History row |
| `tests/v6-regression/scripts/README.md` | One line near Usage: "The committed plugin profile is `business_os`, so Gmail/Drive/Sheets scenarios cannot ground or compile. Set `ACTIVE_PLUGIN_PROFILE` to `'all'` in `lib/server/plugin-profile.ts` locally before running; never commit that change." |
| `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md` § Prerequisites | Same line, plus a Change History row |
| `docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md` L46 (W3) | "Add the key to `PLUGIN_PROFILES.all` **and** `PLUGIN_PROFILES.business_os` (`lib/server/plugin-profile.ts`) and the executor to `executorRegistry` (`plugin-executer-v2.ts`). BOS modules always go in both profiles." Last Updated bumped, Change History row |
| `docs/PLUGIN_VISIBILITY_SCOPING.md` (W4) | The profile-gate note also records the four disk-reading metadata readers as non-gates |

### 7.5 Baseline diff procedure (C6)

```bash
# 1. main baseline (clean checkout of 01d0116b, npm ci done)
npx jest --ci --silent --json --outputFile=<scratchpad>/main.json
node -e "const r=require('<scratchpad>/main.json');for(const f of r.testResults)for(const a of f.assertionResults)if(a.status==='failed')console.log(f.name.replace(/\\\\/g,'/').split('neuronforge-plugin-profile/')[1]+' › '+a.fullName)" | sort > <scratchpad>/main-failures.txt
# also count suites that failed to run (testResults[].status==='failed' with no assertionResults)

# 2. branch, same commands -> branch.json / branch-failures.txt

# 3. new failures must be empty
comm -13 <scratchpad>/main-failures.txt <scratchpad>/branch-failures.txt
```

Suite-level failures (a file that fails to compile or load, with no assertion results) are diffed the same way by file name. Results and counts are recorded in §11 by Dev before handing over to SA and QA.

---

## 8. Rollback

**One-line flip:** in `lib/server/plugin-profile.ts`, change

```typescript
const ACTIVE_PLUGIN_PROFILE: PluginProfileName = 'business_os';
```

to `'all'`. This restores the exact 28-plugin set in today's order: discovery, LLM context, connect, OAuth callback and execution all work again. Existing `plugin_connections` rows for the 17 plugins become usable immediately with no data migration (FR17). No other file changes. The profile module, manager refactor and executor gate stay in place and are inert under `all`: `skippedPluginKeys` is empty and no registered key is ever "not enabled".

A full revert of the branch is also clean, because there are no migrations and no data changes.

---

## 9. Open Questions for SA

1. **`getActiveProfile()` before initialisation.** Proposal: return `this.profile ?? resolveActivePluginProfile()`. The alternative is to throw. The executor only ever holds an initialised manager (through `getInstance()`), so this matters only for directly constructed managers. Throwing is stricter, but it would turn a misuse into an `execute()` exception outside the try/catch. OK to fall back?
2. **Direct-from-disk definition readers** (§6.3: `ExecutionGraphCompiler.loadPluginAction`, `ExecutionSummaryCollector`, `StepExecutor` L6466, `WorkflowPilot` L1252). They bypass the manager and would still read excluded definitions for metadata. Proposal: leave them this cycle (no execution path is opened, and V6/Pilot is out of scope) and, if SA wants it tracked, log one follow-up to route them through `PluginManagerV2.getPluginDefinition`. Agree?
3. **`BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md` L46** is a living recipe ("Register: add the definition to `corePluginFiles`"). It is not in C5's list. Proposal: update that one line alongside C5. OK?
4. **Not-enabled `warn` fields.** SA specified `{ pluginKey, profile, actionName? }`. Should `userId` be added (as the existing `'Executing plugin action'` line has it) so an operator can find the stale agent's owner? Proposal: add it. It is not sensitive and matches the neighbouring log.
5. **`getNotEnabledMessage` private helper** in `PluginExecuterV2`, shared by `execute` and `fetchDynamicOptions`. This is within "membership check at the call site" (it lives in the consumer, not the profile module). Confirm this is acceptable under Rule 7.

---

## 10. SA Review Notes

**Reviewed by SA on 2026-09-19**
**Status:** ✅ Approved with conditions. Proceed to implementation with W1–W7 below folded into the tasks. None of them changes the design.

### Conformance to requirement conditions C1–C12 and the canonical shape

| Cond. | Verdict | Notes |
|---|---|---|
| C1 | ✅ | §3.1 matches the canonical shape exactly: file, `PluginProfileName`, `PluginProfile`, exported frozen `PLUGIN_PROFILES`, private `ACTIVE_PLUGIN_PROFILE`, cached `getPluginProfile`, argument-free `resolveActivePluginProfile`, and no other exports. The module has no imports, which is better than required. I checked `business_os` against `all` order: google-calendar (5) < meta-insights (16) < google-analytics (17) < google-business-profile (18) < outlook (21) < stripe (23) < business-os … website. It is a valid ordered subsequence. The per-key trailing comments in `business_os` may stay: they are evidence, not logic. |
| C2 | ✅ | The §7.1 rewrite is strictly stronger (equality with the directory set plus a duplicate check). The four existing assertions are untouched. See W5 for the regex hazard. |
| C3 | ✅ | Verbatim move, `intake` removed, "must remain" sentence added, both back-references repointed. |
| C4 | ✅ | Registered-but-not-in-profile → `plugin_not_enabled` before construction and before the info log. Unregistered keys → unchanged `execution_error`. `hasOwnProperty` is a good call. `fetchDynamicOptions` throws. The message is free of retryable and `not found` tokens (I also checked `FailureClassifier`). |
| C5 | ✅ + W3 | Skill L50/L82 and both docs are covered. The roadmap line is added (W3). |
| C6 | ✅ | T0/T11 baseline diff with suite-level failures included. The `mock-plugin-manager.ts` pin is confirmed to cover the whole shared-helper family: 32 files reference `createTestPluginManager`/`createTestExecutor`/`test-helpers`/`error-scenarios`/`mock-plugin-manager`. Those helpers construct executor classes directly, so they bypass the gate and need only the definitions. The `jest.mock` pin pattern in §7.2 is correct, because the default parameter is evaluated at call time. |
| C7 | ✅ | The executor-module mock plus the `fs.readFileSync` spy with a `jest.mock('fs')` fallback is sound. The TS `__importStar` binding uses getters, so the spy should intercept. The fallback is fine if it doesn't. |
| C8 | ✅ + W2 | One summary line, a `warn` before the info line, module-load block deleted. `userId` is added (W2). |
| C9 | ✅ + W4 | The note gains one sentence about the disk readers (W4). |
| C10 | ✅ | Runbook line in both places. No script seam, per Option A. The three scripts that construct their own manager are left alone, which is correct: giving them an explicit profile would be the second switch the user declined. |
| C11 | ✅ | The `console.*` inventory is accurate. The test files are outside the rule's scope, and `convertPlugins.ts` is untouched. |
| C12 | ✅ | The T13 `git diff` guard is good. |

### Sweep spot-checks (verified)

| Dev finding | SA check | Result |
|---|---|---|
| Four direct-from-disk readers | Read each site: `ExecutionGraphCompiler.loadPluginAction` L4686–4705 (V6 compile, parameter schema), `ExecutionSummaryCollector.loadPluginDefinition` L25–36, `StepExecutor` L6462–6470 and `WorkflowPilot` L1249–1257 (post-execution summary metadata). A repo-wide grep for `plugins/definitions` / `-plugin-v2.json` in `lib`/`app` finds no others. | **Confirmed, and harmless.** All four are keyed by a step that already exists, and all are read-only metadata. The Pilot three run only **after** an action step, which the gate stops first. The V6 one runs inside compilation, which fails earlier at `PluginParameterValidator` for an excluded plugin. None opens an execution or discovery path, and none holds a plugin list, so FR7 is not violated. |
| `/test-plugins-v2` tester permanently gated | `lib/plugins/tester/connection-gate.ts` `REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS` (5 Google keys, 4 excluded), consumed by `FormTester.tsx` and `app/test-plugins-v2/page.tsx` | **Confirmed.** It is an AgentsPilot internal developer tool, so it falls within U4. The Option A local flip restores it. The CRM/BOS module tester moved to `/test-business-os` earlier and is unaffected. SA has added this to the requirement's accepted consequences (W6). No code change. |
| mock-plugin-manager pin covers ~20 suites | Counted as above | **Confirmed** (32 referencing files). One-line pin in T6. |
| Roadmap L46 "add to `corePluginFiles`" | `docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md` L46, the "3. Register" recipe row | **Confirmed**, and it is a living recipe. See W3. |
| Integrity-test regex sensitivity | `registeredExecutorKeys()` uses `/executorRegistry[^=]*=\s*\{([\s\S]*?)\n\s*\}/`, which anchors on the **first textual** `executorRegistry` in the file. Today that is the declaration at L50, and the other two mentions (L152, L154) come later. | **Confirmed**, and the hazard is slightly wider than §3.3 states. See W5. |

### Decisions on Dev's questions (§9)

| # | Decision |
|---|---|
| 1 | **Fall back** to `this.profile ?? resolveActivePluginProfile()`. Do not throw. The gate runs **outside** `execute()`'s try/catch, so a throw would make `execute()` reject, which FR12 forbids. Before `initializeWithCorePlugins` runs, the fallback is truthful: it is the profile the manager *will* load. Say that in the method's doc comment (W1). |
| 2 | **Leave the four disk readers this cycle. No follow-up and no WEAK_POINTS entry.** They are not a defect under the profile semantics (see the spot-check). Record their existence in the C9 note so nobody later mistakes them for a gate or a leak (W4). Routing them through `PluginManagerV2.getPluginDefinition` is a separate clean-up with its own risk: it skips env substitution today, and changing that changes schema reads. Only a real consumer need would justify it. |
| 3 | **Yes.** Update roadmap L46 as part of C5 (W3). It is a forward-looking recipe that the next module-plugin author will follow, so a stale line there is the same defect C5 prevents in the skill. |
| 4 | **Yes, add `userId`** to the `execute()` not-enabled `warn`. It matches the neighbouring `'Executing plugin action'` line (same logger, same sensitivity class), and it is what an operator needs to find the stale agent's owner. `fetchDynamicOptions` has no `userId` parameter, so its warn stays `{ pluginKey, profile }` (W2). |
| 5 | **Approved.** A private helper inside the consumer is ordinary encapsulation, not a new pattern. The profile module keeps no helpers, and membership logic stays at the consumer, as the canonical shape requires. The helper must remain `private` and must be declared **after** `executorRegistry` (W5). |

### Conditions (fold into tasks)

| # | Condition | Task | Priority |
|---|---|---|---|
| **W1** | `getActiveProfile()` returns `this.profile ?? resolveActivePluginProfile()`. Its doc comment states that before init this is the profile the manager will load, and that it must never throw (it is called outside `execute()`'s try/catch). | T3 | Medium |
| **W2** | The `execute()` not-enabled warn fields are `{ userId, pluginKey, profile, actionName }`. The `fetchDynamicOptions` warn is `{ pluginKey, profile }`. Update the AC8 assertion to include `userId`. Update §3.4's table. | T4, T9 | Low |
| **W3** | Add `docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md` L46 to §4 and §7.4. New text: "Add the key to `PLUGIN_PROFILES.all` **and** `PLUGIN_PROFILES.business_os` (`lib/server/plugin-profile.ts`) and the executor to `executorRegistry` (`plugin-executer-v2.ts`)". BOS modules always go in both. Bump its Last Updated date and add a Change History row. | T10 | Medium |
| **W4** | The C9 "Profile gate (upstream)" note gains one sentence: four metadata readers (`ExecutionGraphCompiler.loadPluginAction`, `ExecutionSummaryCollector`, `StepExecutor` summary metadata, `WorkflowPilot` summary metadata) read definition JSON from disk by key. They are read-only metadata for an already-present step, not a load, discovery or execution gate. The gate is enforced at `PluginManagerV2` load and at `PluginExecuterV2.execute`. | T10 | Low |
| **W5** | Integrity-regex safety in `plugin-executer-v2.ts`: (a) no new textual occurrence of `executorRegistry` **above** the registry declaration (file header, imports, type comments); (b) inside the registry literal, no comment containing a `'<key>':` shape and no line whose first non-blank character is `}`; (c) `getNotEnabledMessage` is declared after the registry. After T4, run the integrity test and compare `registeredExecutorKeys()` against the 28 keys. | T4, T5 | High |
| **W6** | Done by SA: the `/test-plugins-v2` tester gating is recorded in the requirement's "Accepted consequences (U4)". QA's expectations (§11) must list it as expected behaviour under `business_os`, not a defect. | QA | Low |
| **W7** | AC14's QA smoke should also confirm, from the startup line, `skippedCount: 17` and that no `Environment variable not found` warning names a variable used only by excluded plugins (for example Slack or Notion client ids). | QA | Low |

### Approval

[x] Workplan approved. Proceed to implementation with W1–W7. SA code review will re-check C2/W5 (integrity test green with the regex constraint), C4/W1/W2 (gate placement and non-throwing), C6 (empty `comm -13` diff with the suite-level failure list attached in §11) and C3 (verbatim comment).

---

**Code Review by SA on 2026-09-19** (uncommitted worktree diff: 11 modified files and 3 new code/test files, plus the requirement and workplan docs)
**Status:** 🔄 Fix Required, two small items (F1, F2). Both are test or comment changes. The design and production logic are approved as-is. SA re-checks only F1 and F2; no full re-review is needed.

### What SA verified independently

| Check | Result |
|---|---|
| New/changed suites (`plugin-registry-integrity`, `plugin-manager-profile`, `plugin-executer-profile-gate`) | Re-run by SA: **3/3 suites, 24/24 tests pass** |
| Broader regression (`tests/plugins`, `lib/server`, `lib/business-os/channel-insights`, `lib/services`) | Re-run by SA: **58 suites passed, 8 skipped, 0 failed; 1,099 tests passed.** Confirms the `mock-plugin-manager` pin covers the per-plugin suites (AC13/AC14 at unit level) |
| `tsc --noEmit` restricted to touched files (`plugin-profile`, `plugin-manager-v2`, `plugin-executer-v2`, the mock and the three test files) | **0 errors** in touched files. The repo-wide 2,037 matches Dev's main baseline; not re-diffed by SA |
| Deviation 1: DeclarativeCompiler suites not pinned | **Accepted.** Re-run by SA: both fail with `Cannot find module '../lib/agentkit/v6/compiler/DeclarativeCompiler'`. That module no longer exists, so a `jest.mock` pin would be dead code. They stay in the baseline failure list unchanged |
| Deviation 2: AC6 spy on `jest.requireActual('fs')` | **Accepted.** It is the real module object that the manager's compiled `import * as fs` reads through. The test has a positive guard (the read list must equal the 11 profile keys), so a spy that intercepts nothing would fail rather than pass vacuously |
| W5 integrity regex | The first textual `executorRegistry` is the declaration at L50, and the literal closes at L87. The helper is at L164. No `'key':` shape or leading `}` inside the registry comments. The test finds 28 keys ✅ |

### Conditions: C1–C12 and W1–W7

| Cond. | Verdict | Evidence |
|---|---|---|
| C1 | ✅ | `lib/server/plugin-profile.ts` matches the canonical shape exactly: two exported pure functions, frozen cached profiles, private `ACTIVE_PLUGIN_PROFILE`, no imports. `plugin-manager-v2.ts` has no key or filename list left; the only `-plugin-v2.json` is the derived template. |
| C2 | ✅ | `managerPluginKeys()` removed. Four new assertions (all = directory set + no duplicates, every profile key has a file, ordered subsequence, both BOS surfaces present). The four original assertions are untouched. |
| C3 | ✅ with F2 | Moved, `intake` removed, "four" in both files, "must remain" paragraph added, executor back-reference repointed. The action counts are stale; see F2. |
| C4 | ✅ | The gate runs before the info log and before `getOrCreateExecutor`. `hasOwnProperty` is used. It is non-throwing because `getActiveProfile()` cannot throw. `fetchDynamicOptions` throws before construction. The message has no retryable or `not found` token. |
| C5 / W3 | ✅ | Skill L50 and L82 (plus the flip-locally checklist line), `PLUGIN_GENERATION_WORKFLOW.md`, `V2_PLUGIN_MANAGER_BEHAVIOUR.md` and roadmap L46 ("BOS modules always go in both profiles") are all updated with Last Updated dates and Change History rows. |
| C6 | ✅ | Mock pinned to `all`. Dev's T0/T11 diff reports 0 new failures. The SA subset run is consistent with that. |
| C7 | ✅ | The Gmail executor module is mocked and its constructor count asserted as 0 (AC8, AC10). There is an fs spy with a positive guard, and an env-var test with a positive control under `all`. |
| C8 / W2 | ✅ | Module-load block deleted. One summary line, asserted as exactly one `info` call with the full field set (`skippedCount: 17`). The `execute()` warn carries `{ userId, pluginKey, profile, actionName }`; the `fetchDynamicOptions` warn carries `{ pluginKey, profile }`. |
| C9 / W4 | ✅ | "Profile gate (upstream)" section, including the four-reader sentence and a Change History row. |
| C10 | ✅ | Runbook line in `tests/v6-regression/scripts/README.md` and the EXECUTION_SCRIPTS Prerequisites, with a Change History row. No script seam. |
| C11 | ✅ | Pino only. No `any` in the new module. No `console.*` added to any touched file. |
| C12 | ✅ | No changes to `pluginList.tsx`, `plugin-visibility.ts`, the OAuth callback, `/api/v2/plugins/connect`, `pluginKeys.ts`, definitions or executors. |
| W1 | ✅ | `getActiveProfile()` returns `this.profile ?? resolveActivePluginProfile()`, with the "never throw" doc comment. |
| W5 | ✅ | See above. |
| W6 / W7 | QA | Carried into the QA notes below. |

### Code Review Comments

1. **F1: `tests/plugins/unit-tests/plugin-executer-profile-gate.test.ts`, missing positive gate case. Priority: Medium (must fix).** Every assertion checks a **blocked** key or an **unregistered** key. None checks that a registered key **in** the profile passes the gate. An inverted or over-broad gate (for example, one that returns the not-enabled message for every registered key) would pass all five tests while breaking every Business OS plugin call. Add one test: under `business_os`, `execute('user-1', 'crm', <any action>, {})` must **not** resolve to `error: 'plugin_not_enabled'`, and the `'Executing plugin action'` info line **is** logged. The simplest route is to `jest.mock('@/lib/server/crm-plugin-executor', () => ({ CRMPluginExecutor: jest.fn().mockImplementation(() => ({ executeAction: jest.fn().mockResolvedValue({ success: true }) })) }))` and assert that the constructor was called once and the result is `{ success: true }`.
2. **F2: `lib/server/plugin-profile.ts`, INTERIM comment, stale action counts. Priority: Low (must fix, one-line).** Measured now: `business-os-plugin-v2.json` has **107** actions (the comment says 67), and the four internal plugins total **67** (crm 17, scheduling 16, payments 23, website 11; the comment says 71). SA's "verbatim" instruction was about preserving the decision text, not about keeping wrong numbers. **Remove both parenthetical counts** rather than updating them: `business-os` is regenerated from the catalog, so any number drifts again. Nothing else in the comment changes. (The `executorRegistry` comment carries no counts, so no change there.)

### Rulings on Dev's raised items

| Item | Ruling |
|---|---|
| "(71 actions)" possibly stale | Yes. Both counts are stale (see F2). Remove them. |
| Stripe `${amount/100}` producing 2 false env-var warnings per cold start | **Pre-existing, not introduced here.** `stripe-plugin-v2.json` L261 and L325 put user-facing message templates in the `${…}` syntax, and `processEnvironmentVariables` treats any `${…}` as an env var. It warned identically before this change, because Stripe was always loaded. **Out of scope for this cycle** (C12, and it would change loader semantics). **Follow-up for TL to log (Low):** restrict substitution to env-name-shaped placeholders (`/\$\{([A-Z_][A-Z0-9_]*)\}/`) in `processEnvironmentVariables`. That is a generic fix: it also stops the loader from ever rewriting template text if a same-named env var existed. Do not edit the definition JSON to work around it. QA should treat these two warnings (`varName: 'amount/100'`) as known noise, not a regression. |

### Optimisation Suggestions (non-blocking)

- `plugin-executer-profile-gate.test.ts`, "does not treat prototype names as registered plugins": this passes because `getOrCreateExecutor` then does `new Object(...)` through the inherited `constructor` and fails later with `execution_error`. That is a pre-existing quirk of `getOrCreateExecutor`'s bracket lookup, outside this scope. The test correctly asserts only "not `plugin_not_enabled`". No action needed.
- In the roadmap, git warns that LF will be replaced by CRLF on the next checkout. The diff is only 5 lines, so there is no line-ending churn. RM should confirm the committed diff stays at 5 lines.

### Notes for QA

- **Expected under `business_os` (not defects):** `/test-plugins-v2` lists only the 11 profile plugins, and its Plugin API Tester panel stays gated off (W6). AgentsPilot connection cards for the 17 excluded plugins fail at once with "Plugin … not found", before any OAuth popup. `execute` via `/api/plugins/execute` for an excluded key returns 404 "Plugin not found" (corrected by QA: the route's definition lookup runs before the gate). The two Stripe `amount/100` env warnings are known noise.
- **AC14 smoke (W7):** start the dev server and confirm exactly one `Plugin manager initialized` line with `profile: business_os`, `loadedCount: 11` and `skippedCount: 17`. Confirm there is no `Environment variable not found` warning for a variable used only by excluded plugins (for example Slack, Notion or HubSpot client ids), and no `Plugin-Manager-v2 module loaded` line. Then run one Business OS connect flow (a channel-insights provider or Calendar sync settings) end to end.
- **BOS happy paths:** BOS chat create-task, booking and invoice (these run `crm`, `scheduling` and `payments` through `ChatCommandExecutor`) must behave exactly as on main. This also covers F1 live.
- **Rollback check (optional):** flip `ACTIVE_PLUGIN_PROFILE` to `'all'` locally. Expect one summary line with `loadedCount: 28, skippedCount: 0`, and `/test-plugins-v2` back to full. **Revert before handing to RM.**

### Code Approved for QA: No. Yes once F1 and F2 are done. SA re-checks only those two (test passes, and comment text).

**SA re-check of F1 and F2 on 2026-09-19**
**Status:** ✅ Code Approved

| Item | Verification | Result |
|---|---|---|
| F1 | New test "lets an in-profile plugin through to construction and execution" (mocked `CRMPluginExecutor`). It asserts the result is not `plugin_not_enabled` and equals the executor's result, one construction, `executeAction` called with the exact args, the `'Executing plugin action'` info logged, and no warn. **Mutation check by SA:** SA temporarily changed the gate's `profile.pluginKeys.includes(pluginName)` to `false && …` in `plugin-executer-v2.ts`, which makes it block every registered key. **Exactly this test failed** (1 failed, 5 passed), while the other five still passed, which confirms the gap F1 closed. The file was restored from a backup and its SHA-1 verified identical to Dev's version. | ✅ |
| F2 | Both parenthetical action counts are removed from the INTERIM DUPLICATION comment in `lib/server/plugin-profile.ts`. The rest of the text is unchanged (four plugins, `intake` gone, "must remain" paragraph intact). | ✅ |
| Suites | SA re-run: `plugin-executer-profile-gate`, `plugin-manager-profile`, `plugin-registry-integrity`: **3/3 suites, 25/25 tests pass.** The working tree has the same file set as before, and nothing is staged. | ✅ |

### Code Approved for QA: Yes

---

## 11. QA Testing Report

### 11.0 Dev implementation notes and pre-QA evidence (Dev, 2026-09-19)

**Files created:** `lib/server/plugin-profile.ts`, `tests/plugins/unit-tests/plugin-manager-profile.test.ts` (11 tests), `tests/plugins/unit-tests/plugin-executer-profile-gate.test.ts` (5 tests).
**Files modified:** `lib/server/plugin-manager-v2.ts`, `lib/server/plugin-executer-v2.ts`, `tests/plugins/common/mock-plugin-manager.ts`, `tests/plugins/unit-tests/plugin-registry-integrity.test.ts`, `.claude/skills/new-plugin/SKILL.md`, `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md`, `docs/V2_PLUGIN_MANAGER_BEHAVIOUR.md`, `docs/PLUGIN_VISIBILITY_SCOPING.md`, `docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md`, `tests/v6-regression/scripts/README.md`, `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md`, plus this workplan and the requirement.
**Files deleted:** none. Nothing staged or committed.

#### C6: Jest failure diff vs main (T0 / T11)

T0 was run on the worktree **before the first code edit**. At that point the tree differed from `01d0116b` only by the two untracked planning docs. T11 ran the same command (`npx jest --ci --silent --json`) on the branch.

| | Suites failed / skipped / passed (total) | Tests failed / skipped / passed (total) |
|---|---|---|
| main @ 01d0116b | 21 / 8 / 328 (357) | 129 / 58 / 4924 (5111) |
| branch | 21 / 8 / 330 (359) | 129 / 58 / 4943 (5130) |

The failure lists (129 failing tests plus 8 suites that fail to load = 137 entries) are **identical**: `comm -13 main-failures.txt branch-failures.txt` is **empty** (zero new failures), and `comm -23` is also empty (nothing fixed by accident). The +2 suites / +19 tests are the two new files (11 + 5) plus 3 new integrity assertions (5 → 8). Nothing was skipped or deleted.

Suite-level failures, identical on both sides (all pre-existing, unrelated to plugins):

| Suite | Cause on main |
|---|---|
| `__tests__/DeclarativeCompiler-comprehensive.test.ts` | `Cannot find module '../lib/agentkit/v6/compiler/DeclarativeCompiler'` |
| `__tests__/DeclarativeCompiler-regression.test.ts` | same |
| `__tests__/DeclarativeCompiler-dataflow.test.ts` | same |
| `__tests__/DeclarativeCompiler-dataflow-contract.test.ts` | same |
| `__tests__/DeclarativeCompiler-stress.test.ts` | same |
| `__tests__/v6-integration.test.ts` | Could not locate `@/lib/agentkit/v6/compiler/IRToDSLCompiler` |
| `lib/agentkit/v6/__tests__/integration/v6-end-to-end.test.ts` | Cannot find `EnhancedPromptToIRGenerator_DEPRECATED` |
| `lib/agentkit/v6/generation/__tests__/EnhancedPromptToIRGenerator.test.ts` | same |

The 129 assertion failures on both sides are in `v4-generator`, `LogicalIRCompiler`, `validation` (logical-ir schemas), `IRToNaturalLanguageTranslator`, `IntentClassifier`, `TokenBudgetManager`, `ConditionalEvaluator*`, `StructuredTransforms*`, `featureFlags` and `website-builder/archetypes`. None of them involves the plugin manager or executor.

#### Other checks

| Check | Result |
|---|---|
| **W5** integrity regex | `registeredExecutorKeys()` still extracts **28** keys, equal to the 28 definition files. The first textual `executorRegistry` in `plugin-executer-v2.ts` is still the declaration (L50). The helper is at L164, after it. The edited registry comment has no `'key':` shape and no line starting with `}`. Integrity test 8/8 green. |
| `tsc --noEmit` (8 GB heap) | 2037 errors on the branch and 2037 on a clean `git archive` extraction of `01d0116b`. The normalised error sets are **identical** (0 new, 0 gone). 0 errors in any touched file. |
| ESLint (`npx eslint -c eslint.config.mjs`) on the 7 changed/new TS files | New files (`plugin-profile.ts`, both new tests) and `mock-plugin-manager.ts`: **0**. The four pre-existing files: 32 problems on the branch vs **32** on main (pre-existing `no-explicit-any`, unused imports, and the `require()` of `PLUGIN_KEYS` in the integrity test). None on added lines. |
| `npm run build` | **Pass** (exit 0). The build's page-data step logged exactly one `'Plugin manager initialized'` line: `profile: business_os`, `loadedCount: 11`, `skippedCount: 17`. The 7 `Environment variable not found` warnings all come from **in-profile** plugins (`META_ADS_CLIENT_*` via meta-insights, `MICROSOFT_CLIENT_*` via outlook, `NEXT_PUBLIC_STRIPE_CLIENT_ID` and a `${amount/100}` template via stripe). None comes from an excluded plugin. The DYNAMIC_SERVER_USAGE error lines are Next's normal static-render probing of dynamic routes. |
| C12 scope guard | `git diff -- lib/plugins app/oauth app/api/v2 lib/plugins/pluginKeys.ts lib/plugins/definitions lib/agentkit supabase` is empty. |
| C11 / logging | No `console.*` and no `any` added. `plugin-profile.ts` has no imports. Imports use `@/`. |
| No hardcoded list in the manager (AC3) | `grep` for `-plugin-v2.json'` literals and plugin keys in `plugin-manager-v2.ts` finds nothing. The only filename is the derived template `${pluginName}-plugin-v2.json`. |

#### SA code-review fixes (Dev, 2026-09-19)

- [x] ✅ **F1 (Medium): positive-path gate test.** `plugin-executer-profile-gate.test.ts` gains `lets an in-profile plugin through to construction and execution`. With the CRM executor mocked, `execute('user-1', 'crm', 'list_contacts', …)` under `business_os` returns the executor's result (not `plugin_not_enabled`). The `CRMPluginExecutor` constructor is called once, `executeAction` receives the call, the `'Executing plugin action'` info line is logged with `{ userId, pluginName, actionName }`, and no `warn` is emitted. A gate that blocked everything would now fail.
- [x] ✅ **F2 (Low): action counts removed** from the moved INTERIM DUPLICATION comment in `lib/server/plugin-profile.ts`: "(67 actions)" and "(71 actions)" are gone, not updated, because `business-os` is regenerated from the catalog and any number drifts. The Notes item below about "(71 actions)" is resolved.
- Re-run: `plugin-registry-integrity` (8), `plugin-manager-profile` (11) and `plugin-executer-profile-gate` (now 6) all pass, **25/25**. With `base-executor.test.ts` included, 35/35. ESLint on both touched files: 0 problems.

#### Deviations

1. **T7: the DeclarativeCompiler suites were not pinned.** Both suites SA named (and three siblings) **fail to load on main**, because `lib/agentkit/v6/compiler/DeclarativeCompiler` no longer exists. A `jest.mock` pin in a suite that cannot load does nothing, and the T11 diff shows no other suite needing a pin. So no singleton suite was edited, and nothing was skipped. If SA wants the pin added anyway, for the day the module returns, it is the §7.2 block and a one-minute change.
2. **AC6 spy target.** `jest.spyOn` on the test's own `import * as fs` namespace throws `Cannot redefine property` under ts-jest. The test spies on `jest.requireActual('fs')` instead, which is the real module object that the manager's compiled import reads through. Neither the planned `jest.mock('fs')` fallback nor production code changed. The test also asserts that the spy saw exactly the 11 in-profile reads, so a spy that intercepts nothing would fail.
3. **Integrity test.** The four existing assertions are unchanged. The removed one (`loads every plugin definition in the plugin manager`) was replaced by the stronger `the all profile lists every plugin definition exactly once`, plus three AC4 assertions.

#### Notes for SA / QA

- **Verbatim INTERIM comment (C3):** the only text edits are "five" → "four" (twice), dropping `intake`, and re-flowing the left column that `intake` occupied. The count **"(71 actions)" was kept verbatim**, but it was written when a fifth (`intake`) plugin was counted, so it may now be stale. SA's call whether to correct it. Dev did not re-count, to keep the move verbatim.
- **Pre-existing, out of scope:** the stripe definition contains a `${amount/100}` template string that `processEnvironmentVariables` treats as an env var, which causes 2 spurious warnings per cold start. It is an in-profile plugin, so the warnings stay (FR20). It could become a small follow-up if the noise matters.
- **QA (W6):** under `business_os`, the `/test-plugins-v2` Plugin API Tester panel stays gated off (4 of its 5 required Google plugins are excluded). This is expected, not a defect.
- **QA (W7):** in the AC14 smoke, confirm from the startup line that `skippedCount: 17`, and that no env-var warning names a variable only excluded plugins use. The build output above already shows this.

### 11.1 QA report (QA, 2026-09-19)

**Test mode:** full
**Strategy used:** A + B (Jest unit / integration: full suite plus the three profile suites), C (a standalone `tsx` loader script for the rollback check), live HTTP probes against the running dev server (http://localhost:3003, this worktree), and E (the TL's server-log evidence, recorded below). No Playwright: this change has no UI flow, and the BOS logged-in paths need the user's session.
**Focus:** all (api, security, schema, pipeline impact)
**Skipped:** E2E / logged-in happy paths. These are **PENDING the user's sign-in**, not skipped by choice. The live execute gate returns 401 without a session, so the gate is covered by unit tests instead (see T2).
**Input source:** TL trigger prompt, plus SA §10 "Notes for QA" and W6/W7.
**Worktree state:** QA made no code change. The optional rollback flip was reverted byte-for-byte (SHA-1 of `lib/server/plugin-profile.ts` is `44766db2…05bd6` before and after). `git status` is identical before and after. Nothing staged or committed. `...\neuronforge` was not touched. No server was started or stopped.

#### Evidence

**E1: TL-verified server log (recorded as evidence).** `GET /api/plugins/available` returned 200. The log has exactly **one** `Plugin manager initialized` line: `profile: business_os`, `loadedCount: 11` (google-calendar, meta-insights, google-analytics, google-business-profile, outlook, stripe, business-os, crm, scheduling, payments, website), `skippedCount: 17`. There is **no** `Plugin-Manager-v2 module loaded` line. The only env-var warnings are `META_ADS_CLIENT_ID/SECRET` (meta-insights), `MICROSOFT_CLIENT_ID/SECRET` (outlook), `NEXT_PUBLIC_STRIPE_CLIENT_ID` and 2× the known `amount/100` (stripe). All come from in-profile plugins, none from an excluded one (W7 satisfied).

**T1: `GET /api/plugins/available` (live, 3003).**

| Request | HTTP | Keys returned | Excluded keys present |
|---|---|---|---|
| `/api/plugins/available` | 200 | 7: `google-calendar, meta-insights, google-analytics, google-business-profile, outlook, stripe, business-os` | **none** of the 17 |
| `/api/plugins/available?includeBusinessOs=true` | 200 | 11: the 7 above + `crm, scheduling, payments, website` | **none** of the 17 |

This is correct. The default list is the in-profile **discoverable** set: `business-os` is visible, and the four internal plugins stay hidden by `visibility` (AC7 live). The opt-in list is exactly the 11-key profile. The endpoint was re-checked after the rollback revert and still returned the same 7.

**T2: `POST /api/plugins/execute` (live).**

| Body | HTTP | Response |
|---|---|---|
| `{"pluginName":"slack","actionName":"send_message","parameters":{}}` (excluded) | 401 | `{"success":false,"error":"Authentication required"}` |
| `{"pluginName":"crm","actionName":"list_contacts","parameters":{}}` (in profile) | 401 | `{"success":false,"error":"Authentication required"}` |

Order in `app/api/plugins/execute/route.ts` (unchanged vs main): Zod validation → `resolveActingUserIdentity` (**401 here, before any plugin logic**) → `pluginManager.getPluginDefinition` (404 `Plugin not found`) → `getActionDefinition` (404) → `PluginExecuterV2.execute` (profile gate). The live gate cannot be reached without a session, so it was **not** faked. The gate is covered by `plugin-executer-profile-gate.test.ts` (6/6 pass: blocked key, in-profile pass-through (F1), warn fields, unregistered key, prototype name, `fetchDynamicOptions`). See Edge Case 1: a signed-in call for an excluded key gets a **404 `Plugin not found`** from the route's definition check, not `plugin_not_enabled`.

**T3: Full Jest run (`MSYS_NO_PATHCONV=1 npx jest --ci --silent --json`, branch, 96 s).**

| | Suites failed / skipped / passed (total) | Tests failed / skipped / passed (total) |
|---|---|---|
| main @ 01d0116b (Dev's `main.json`, re-parsed by QA) | 21 / 8 / 328 (357) | 129 / 58 / 4924 (5111) |
| branch (QA run) | 21 / 8 / 330 (359) | 129 / 58 / **4944** (5131) |

- QA re-derived both failure lists from the raw JSON with its own parser (129 failed assertions + 8 suites that fail to load = **137 entries each**). `comm -13 main branch` (new failures) is **empty**. `comm -23` (fixed by accident) is **empty**. The failure set equals main's 21 suites / 129 tests exactly.
- Branch passes are +20 vs main: Dev's +19, plus the F1 test added after Dev's run.
- Target suites: `plugin-registry-integrity` **8/8**, `plugin-manager-profile` **11/11**, `plugin-executer-profile-gate` **6/6**. All pass.
- BOS regression suites (AC13/AC14, unit level), all green: `crm-plugin-executor` 13, `scheduling-plugin-executor` 16, `payments-plugin-executor` 24, `website-plugin-executor` 22, `ChannelMetricsSyncService` 14, `ChannelPerformanceService` 22, other channel-insights suites 76, `base-executor` 10.
- The 8 load-failing suites (DeclarativeCompiler ×5, `v6-integration`, `v6-end-to-end`, `EnhancedPromptToIRGenerator`) and the 13 assertion-failing files (v4-generator, LogicalIRCompiler, logical-ir validation, IRToNaturalLanguageTranslator, IntentClassifier, TokenBudgetManager, ConditionalEvaluator ×2, StructuredTransforms ×3, featureFlags, website-builder archetypes) are all pre-existing and unrelated to plugins.

**T4: Rollback check (optional, done, reverted).**

| Step | Result |
|---|---|
| AC1 order check: old `corePluginFiles` (from `git show main:…plugin-manager-v2.ts`) vs `PLUGIN_PROFILES.all` | **Identical** 28 keys, identical order |
| Script (`tsx`, `new PluginManagerV2(stub).initializeWithCorePlugins()` with no argument, same default as `getInstance()`), committed constant | `resolved: business_os`, `loadedCount: 11`, `skippedCount: 17` |
| Flip line 112 to `'all'` (only diff: that one line), same script | `resolved: all`, `loadedCount: 28` in original order, `skippedPluginKeys: []`, `skippedCount: 0` |
| Revert (restored from backup) | SHA-1 identical to the pre-test value. `git status` unchanged. Live `/api/plugins/available` still returns the 7 |

The one-line rollback (FR3 / AC2 / U4) is confirmed end to end on the real loader, not only by the test seam.

#### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| AC1: one profile structure, `all` = today's set in today's order | ✅ | **PASS** | Integrity test (all = definitions dir, no duplicates) + QA order diff against main's `corePluginFiles`: identical |
| AC2: one active constant = `business_os`; flipping it loads 28 | ✅ | **PASS** | Unit (`commits business_os…`, `loads exactly…` ×2) + live rollback flip: 11 → 28 → reverted |
| AC3: resolver is the only list source; log uses resolver output | ✅ | **PASS** | Diff review: `corePluginFiles` and module-load log deleted, only the derived `${pluginName}-plugin-v2.json` template remains. Summary-log test asserts loaded/skipped keys |
| AC4: every profile key has a file; BOS keys present | ✅ | **PASS** | Integrity test 8/8 |
| AC5: loads exactly the set, both profiles | ✅ | **PASS** | Unit + script (11 and 28) |
| AC6: skipped files never read; no env warnings from excluded-only vars | ✅ | **PASS** | Unit (fs spy with positive guard, env test with positive control) + E1 live log (W7) |
| AC7: `business-os` discoverable, 4 internal hidden | ✅ | **PASS** | Unit + live T1 (7 by default, 11 with `includeBusinessOs=true`) |
| AC8: `execute` excluded key → `plugin_not_enabled`, no construction | ✅ | **PASS** (unit) | Live path blocked by 401 before the gate (T2). Not faked |
| AC9: unregistered key keeps `execution_error` | ✅ | **PASS** | Unit |
| AC10: `fetchDynamicOptions` rejects, no construction | ✅ | **PASS** | Unit |
| AC11: connected/executable lists drop an excluded live connection without error | ✅ | **PASS** | Unit (`drops a live connection…`) |
| AC12: exactly one summary info line, no per-skipped lines | ✅ | **PASS** | Unit (mocked logger) + E1 live log + QA script output (one line, `skippedCount: 17`) |
| AC13: BOS chat CRM / scheduling / payments unchanged | ⚠️ | **PASS (unit) / PENDING (live)** | crm/scheduling/payments/website executor suites green, 0 new failures. There is no dedicated `ChatCommandExecutor` test (Edge Case 2). Live chat: create a task, a booking and an invoice is **PENDING the user's sign-in** |
| AC14: channel insights + calendar resolve under `business_os`; manual connect smoke | ⚠️ | **PASS (unit + startup) / PENDING (live connect)** | `ChannelMetricsSyncService` 14/14. Startup line and W7 env check PASS (E1). All 5 plugins present in the live list. One channel-insights or calendar connect end to end is **PENDING the user's sign-in**. No `CalendarSyncService` test exists; it is covered only by the live smoke |
| AC15: no new failures; nothing deleted or skipped | ✅ | **PASS** | T3: 137 = 137 entries, `comm` empty both ways |

**Expected under `business_os`, not defects (per W6 / SA notes):** the `/test-plugins-v2` Plugin API Tester is gated off. AgentsPilot connect cards for the 17 excluded plugins fail at once with "Plugin … not found". The two stripe `amount/100` env warnings are known noise (TL follow-up already ruled by SA).

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. Load work now scales with the 11-plugin profile (E1).

#### Edge Cases (nice to fix)

1. **Doc inaccuracy: `/api/plugins/execute` does not return `plugin_not_enabled` for an excluded key.** Severity: Low (docs only, behaviour acceptable). Files: requirement SA-Q7 decision, workplan §1 "API routes" row and §10 "Notes for QA".
   - Steps: as a signed-in user, `POST /api/plugins/execute {"pluginName":"slack",…}`.
   - Expected per the docs: `error: 'plugin_not_enabled'` "for free" through `PluginExecuterV2.execute`.
   - Actual (by code reading of the unchanged route, L89–96): the route calls `pluginManager.getPluginDefinition(pluginName)` first. Excluded plugins are not loaded, so it returns **404 `{ error: 'Plugin not found' }`** and never reaches the executor gate. This is clean and non-crashing, and it matches SA's ruling that the other HTTP surfaces keep "not found". FR12 (which is about `PluginExecuterV2.execute`) is still met, and the executor gate stays the protection for internal callers (Pilot `StepExecutor`, `ChatCommandExecutor`, channel and calendar services). **Recommendation:** correct the three doc sentences. No code change is needed unless a client must tell the two cases apart (SA Q7 re-open condition).
2. **No dedicated unit tests for `ChatCommandExecutor` or `CalendarSyncService`.** AC13/AC14 rely on the per-plugin executor suites plus the pending live smoke. This is pre-existing and not a regression. Low.

#### Pre-existing observation, out of scope (for TL to log)

- **`GET /api/plugins/available` is unauthenticated and returns each plugin's full processed `auth_config`, including `client_secret`** (route L34–35 `auth_config: definition.plugin.auth_config`, unchanged vs main). QA confirmed that a cookie-less `curl` returns 200 with a non-empty `client_secret` for all 7 listed plugins. Secret values are deliberately not reproduced here. This branch does not cause it, and it actually **narrows** the exposure from 28 plugins to 7 (11 with the opt-in). **Severity: High (pre-existing security).** Recommend TL log a follow-up to strip `client_secret` (and any server-only fields) from the public response, in line with the P0 key-rotation work already tracked in the environments strategy.

### Pending (user sign-in required)

| # | Item | AC |
|---|---|---|
| P1 | BOS chat: create a task (`crm`) | AC13 |
| P2 | BOS chat: create a booking (`scheduling`) | AC13 |
| P3 | BOS chat: create an invoice (`payments`) | AC13 |
| P4 | One channel-insights connect (e.g. `google-analytics`) **or** Calendar sync settings connect (`google-calendar`/`outlook`), end to end | AC14 |
| P5 (optional) | Signed-in `POST /api/plugins/execute` for `slack`: expect **404 `Plugin not found`** (see Edge Case 1), and for an in-profile key, normal execution | AC8 (live) |

### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] **Code verdict: PASS, no bugs.** AC1–AC12 and AC15 PASS. AC13/AC14 PASS at unit and startup level. Their live logged-in happy paths (P1–P4) are **PENDING the user's sign-in** and must be confirmed before TL user approval and RM commit. Edge Case 1 is a doc fix Dev/SA can fold in without re-review of code.

---

## 12. Commit Info

_RM will populate this section._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-19 | Workplan created (Dev) | Tasks T0–T14 mapped to SA conditions C1–C12. Canonical `plugin-profile.ts` shape, executor `plugin_not_enabled` gate, integrity-test rewrite, pinning pattern, doc/skill updates, AC test matrix with main-vs-branch failure diff, repo-wide sweep, one-line rollback. Records the user's Option A decision for V6 regression tooling. |
| 2026-09-19 | SA workplan review: ✅ Approved with conditions | Conformance to C1–C12 confirmed. Sweep spot-checked (four disk readers are metadata-only and harmless; tester gating falls under U4; 32 files covered by the mock pin; roadmap L46 confirmed; integrity-regex hazard widened). Dev Q1–Q5 decided: resolver fallback, leave readers (documented, not tracked), roadmap in C5, `userId` in warn, private helper approved. Conditions W1–W7. |
| 2026-09-19 | Implementation complete (Dev) | T0–T14 done with W1–W7 folded in. Jest diff vs main: 0 new failures (137 = 137 entries). tsc 2037 = 2037 (identical). ESLint: no new problems. Build passes. Deviations: DeclarativeCompiler suites not pinned (they cannot load on main), fs spy on `jest.requireActual('fs')`. Results in §11.0. |
| 2026-09-19 | SA code review: 🔄 Fix Required (F1, F2) | C1–C12 and W1–W7 verified. SA re-ran 3 new/changed suites (24/24) and the plugin/server/services subset (58 passed, 0 failed); 0 tsc errors in touched files. Deviations accepted (DeclarativeCompiler module no longer exists; fs spy has a positive guard). F1: add a positive in-profile gate test (Medium). F2: remove the stale action counts from the INTERIM comment (Low). Stripe `amount/100` warning is pre-existing: follow-up for TL, out of scope. QA notes added. |
| 2026-09-19 | SA code-review fixes F1/F2 (Dev) | F1: positive-path gate test (`crm` under `business_os` is constructed, executed and logged, not blocked). F2: removed both action counts from the moved INTERIM DUPLICATION comment. Profile suites + integrity test 25/25 green, ESLint clean. |
| 2026-09-19 | SA re-check: ✅ Code Approved | F1 verified by mutation (a block-everything gate fails exactly the new in-profile test; file restored, SHA-1 verified). F2 counts removed. 25/25 across the three profile suites. Approved for QA. |
| 2026-09-19 | QA report (QA): PASS with live items pending | Full Jest: failure set identical to main (137 = 137 entries; 21 suites / 129 tests), target suites 25/25. Live: `/api/plugins/available` returns only in-profile plugins (7 discoverable, 11 with opt-in). `/api/plugins/execute` 401s before the gate, which is covered by unit tests. Rollback flip verified (11 → 28) and reverted byte-identical. No bugs. One Low doc edge case (the execute route 404s before the gate, not `plugin_not_enabled`). Pre-existing High observation for TL: the public `/api/plugins/available` exposes `client_secret`. AC13/AC14 live happy paths pending the user's sign-in. |
