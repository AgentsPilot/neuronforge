# Requirement: Business OS Plugin Profile (Restrict Loaded Plugins)

> **Last Updated**: 2026-09-19

**Created by:** BA
**Date:** 2026-09-19
**Status:** SA CLEARED WITH CONDITIONS (2026-09-19). See [SA Review](#sa-review). User trade-off resolved (Option A, 2026-09-19). Dev workplan written, awaiting SA review.
**Branch / worktree:** `feature/business-os-plugin-profile` (cut from `main` @ `01d0116b`)

## Overview

Business OS (BOS) is the product focus. It uses `PluginManagerV2` as a kernel component, and that manager currently loads all 28 V2 plugin definitions on every cold start. Most of them have nothing to do with BOS. The extra plugins cost memory and startup work, add log noise (15–20 "Environment variable not found" warnings per cold start locally), and, most importantly, show up in every surface that lists or describes "all loaded plugins", including LLM prompt context. This requirement restricts the loaded set to a named **Business OS plugin profile**. For now the profile is **hardcoded at the PluginManagerV2 level**. It is built as if it were configuration: a declarative profile data structure plus **one resolver function** that every consumer asks for the active plugin set. A later change can then move the source to an env var, DB setting or per-org setting without touching the loader or its consumers.

---

## Table of Contents

1. [Binding User Decisions](#binding-user-decisions)
2. [Current State (Verified)](#current-state-verified)
3. [Proposed Business OS Plugin Set (Evidence)](#proposed-business-os-plugin-set-evidence)
4. [Profile vs. Visibility: Loading vs. Discovery](#profile-vs-visibility-loading-vs-discovery)
5. [User Stories](#user-stories)
6. [Functional Requirements](#functional-requirements)
7. [Non-Functional Requirements](#non-functional-requirements)
8. [Impact on the AgentsPilot App (Accepted)](#impact-on-the-agentspilot-app-accepted)
9. [Acceptance Criteria](#acceptance-criteria)
10. [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
11. [Open Questions for SA](#open-questions-for-sa)
12. [Notes on Integration Points](#notes-on-integration-points)
13. [SA Review](#sa-review)
14. [Change History](#change-history)

---

## Binding User Decisions

These are settled. SA review should cover **how** to build them, not **whether**.

| # | Decision |
|---|---|
| U1 | Restrict the plugins `PluginManagerV2` loads to a Business OS-relevant set. |
| U2 | The restriction is **hardcoded at the PluginManagerV2 level for now**. It is **not** an env var, DB setting or admin config. Nobody knows yet when this will change. |
| U3 | The code is **shaped as configuration**: a named, declarative profile / allow-list data structure, and **one resolver function** that every consumer asks for the active plugin set. Moving to a real setting later must not touch the loading logic or its consumers. |
| U4 | The user accepts the impact on AgentsPilot app flows (same deployment, same singleton). Switching back to "all plugins" must be a **one-line change**. |

---

## Current State (Verified)

All citations are to the `feature/business-os-plugin-profile` worktree.

| Finding | Location | Notes |
|---|---|---|
| Hardcoded `corePluginFiles` array, 28 JSON filenames | `lib/server/plugin-manager-v2.ts` L14–72 | Matches the 28 files in `lib/plugins/definitions/` one-for-one. |
| "INTERIM DUPLICATION" comment | `plugin-manager-v2.ts` L38–62; mirrored in `plugin-executer-v2.ts` L63–68 | `business-os` (BizQL-backed, **discoverable**, used by the agent-generation grounding) sits beside the granular internal plugins (hidden via `visibility: "business_os"`). The comment says **do not** add `visibility` to `business-os-plugin-v2.json`. `business-os` must stay loaded and discoverable. |
| Module-load `logger.info` lists all files | `plugin-manager-v2.ts` L81–86 | Logs `corePluginFiles` and `totalPlugins` once on first module load. |
| `loadCorePlugins()` reads, parses, env-substitutes and validates each file synchronously | `plugin-manager-v2.ts` L148–180 | TL measured about 43 ms for all 28. Time is minor. |
| One warn per missing `${VAR}` | `processEnvironmentVariables` L183–209, warn at L195 | Runs only for files that are actually loaded. Skipping a file before reading it removes its warnings automatically. |
| Discovery / LLM-context methods enumerate every loaded plugin | `getAvailablePlugins` L212; `getPluginSummariesForStage1` L231; `getActionableSystemPlugins` L323; `getAllActivePluginKeys` L362; `getConnectedPlugins` L382; `getDisconnectedPlugins` L553; `generateLLMContext` L637 | `getDisconnectedPlugins` → `generateLLMContext.available_plugins` pushes every loaded, unconnected OAuth plugin into LLM prompts. |
| `getAvailablePlugins()` is also the V6 **resolution** primitive | `docs/PLUGIN_VISIBILITY_SCOPING.md` § "Resolution surfaces intentionally NOT gated" | `PluginParameterValidator` hard-errors `Plugin 'X' not found` when a plugin is missing, so V6 compilation fails for any workflow that uses an excluded plugin. |
| Executor registry maps 28 keys to classes; instances are created lazily | `lib/server/plugin-executer-v2.ts` L50–86 (registry), L145–164 (`getOrCreateExecutor`) | Executor **classes are statically imported** (L10–37), so their module code loads whatever the profile says. An unknown key throws `Plugin executor not found for: X…`. `execute()` catches it and returns `error: 'execution_error'`. |
| `getExecutablePlugins` already skips connected-but-unregistered plugins | `plugin-manager-v2.ts` L456–459 | Logs at debug level and continues. An excluded plugin with a live `plugin_connections` row degrades cleanly here. |
| OAuth callback resolves the definition from the manager | `app/oauth/callback/[plugin]/route.ts` L102–114 | An excluded plugin returns "Plugin configuration not found", so no OAuth connection can be completed for it. |
| Visibility predicate | `lib/plugins/plugin-visibility.ts`; `docs/PLUGIN_VISIBILITY_SCOPING.md` | Governs **discovery only**, never resolution by key. |

---

## Proposed Business OS Plugin Set (Evidence)

The set comes from tracing actual runtime calls (plugin key passed to `PluginExecuterV2.execute`, or a definition needed for an OAuth connection), not from string mentions.

### Included (11)

| Plugin key | Why it is in the set | Evidence |
|---|---|---|
| `crm` | Internal module, invoked by key | `lib/business-os/ChatCommandExecutor.ts` L25 (`CRM_PLUGIN_KEY`); executor registry L81 |
| `scheduling` | Internal module, invoked by key | `ChatCommandExecutor.ts` L27; registry L82 |
| `payments` | Internal module, invoked by key | `ChatCommandExecutor.ts` L29; registry L83 |
| `website` | Internal module (db_active) | registry L84; `lib/business-os/actions/WebsiteActionHandler.ts` / `app/api/business-os/actions/website` |
| `business-os` | **Must remain** per the INTERIM DUPLICATION note. It is the discoverable surface the agent generator grounds against, and removing it would break generation over the user's own records. | `plugin-manager-v2.ts` L38–66 |
| `google-calendar` | Two-way calendar sync (push bookings, pull busy time) | `lib/services/CalendarSyncService.ts` L24–27 (`PROVIDER_TO_PLUGIN`), L94 `execute(..., 'create_event')`; driven by `app/api/cron/calendar-sync` |
| `outlook` | Same calendar sync, alternative provider | `CalendarSyncService.ts` L26 |
| `meta-insights` | Channel insights: Facebook Page + Instagram | `lib/business-os/channel-insights/providers.ts` L41; `ChannelMetricsSyncService.ts` L165–216; `app/api/business-os/channel-insights/connect/route.ts` L65; `app/api/cron/channel-metrics-sync` |
| `google-analytics` | Channel insights: GA4 traffic | `providers.ts` L65; `ChannelMetricsSyncService.ts` L248–330 |
| `google-business-profile` | Channel insights: connect / list locations (sync fetcher not built yet) | `providers.ts` L80; `connect/route.ts` via `CHANNEL_PROVIDERS`; `ChannelMetricsSyncService.ts` L153–156 |
| `stripe` | Stripe Connect **OAuth path**. `plugin_connections` rows with `plugin_key = 'stripe'` are a source of the business's connected account, and the OAuth callback needs the definition to complete. | `lib/payments/stripeAccountContext.ts` L99–107; `app/oauth/callback/[plugin]/route.ts` L106. Whether BOS also calls the **stripe executor** is unconfirmed (see SA-Q3). |

### Excluded (17)

`google-mail`, `google-drive`, `google-sheets`, `google-docs`, `slack`, `whatsapp-business`, `hubspot`, `chatgpt-research`, `document-extractor`, `linkedin`, `airtable`, `discord`, `dropbox`, `meta-ads`, `notion`, `onedrive`, `salesforce`.

Notes on exclusions that looked plausible:

| Key | Why excluded (subject to SA confirmation) |
|---|---|
| `linkedin` | In BOS code it appears only as a **channel attribution label** (`lib/business-os/channel-insights/channelFromReferrer.ts` L20). It is not a plugin call. |
| `google-mail` | BOS email (daily briefing, lead response, booking-link, invoices, bulk/one-off client email) goes through `lib/notifications/emailTransport.ts`: Resend, then SMTP, then an **env-configured** Gmail OAuth2 account through nodemailer. None of these uses the `google-mail` plugin. Evidence: `lib/business-os/bizql/mutate/emailSend.ts` L22; `LeadBookingLinkService.ts` L33; `DailyBriefingDispatchService.ts` L28. |
| `whatsapp-business` | No BOS runtime call found. `app/api/plugins/webhooks/whatsapp-business/route.ts` exists but uses `UserPluginConnections`, not the manager. "whatsapp" in BOS is also a channel label only. |
| `document-extractor`, `chatgpt-research` | No BOS usage found in the traced paths. Chat attachments use `ContactDocumentService` (`app/api/business-os/chat-v4/attach/route.ts` L34–38). Intake generation uses the provider factory directly (`lib/services/IntakeGenerationService.ts` L37). |
| `meta-ads` | Not referenced by channel insights. Only `meta-insights` is used. |

Tracing had no full-text search tool, so SA must confirm the exclusions with a repo-wide search for `execute(` / `getPluginDefinition(` call sites under BOS paths (SA-Q3).

---

## Profile vs. Visibility: Loading vs. Discovery

Two independent gates apply in this order:

| Gate | Question it answers | Mechanism | Effect when "no" |
|---|---|---|---|
| **1. Profile (this requirement)** | Does this plugin exist in this deployment at all? | Active profile, via the resolver | The plugin is never read or parsed. It is absent from **every** surface: discovery **and** resolution by key. |
| **2. Visibility (existing)** | Among loaded plugins, is this one listed in general discovery? | `plugin.visibility` + `isPluginDiscoverable()` | Hidden from the five discovery surfaces but **still resolvable by key**. |

Rules:

1. The profile **must not** read, set or change any plugin's `visibility`. `business-os` stays without a `visibility` field and is discoverable. `crm`/`scheduling`/`payments`/`website` stay `business_os`-hidden.
2. The rule in `plugin-visibility.ts` ("never gate resolution-by-key") still holds for **loaded** plugins. An excluded plugin cannot be resolved because it is not loaded. That is intended, and it is not a visibility change.
3. `isPluginDiscoverable` needs no change.

---

## User Stories

- As the **platform operator**, I want the Business OS deployment to load only the plugins Business OS uses, so that cold starts do less work and the logs show real problems instead of placeholders for integrations we don't offer.
- As a **Business OS user**, I want the assistant's LLM context to contain only integrations the product actually supports, so that it never offers or reasons about tools I cannot use.
- As a **developer**, I want one resolver for "which plugins are active", so that I never have to find and edit several hardcoded lists when the set changes.
- As a **future maintainer**, I want the active set expressed as named profile data, so that moving it to an env/DB/per-org setting is a change to the resolver's source only.
- As a **caller of a plugin outside the profile**, I want a clear "plugin not enabled" result instead of a crash or a misleading "executor not found", so that I can tell a configuration choice apart from a bug.

---

## Functional Requirements

### Profile data structure

- **FR1.** Define a declarative, named plugin-profile structure: a map from profile name to an allow-list of plugin **keys** (the key consumers use, e.g. `google-calendar`), not filenames. Whether filenames are derived from keys or kept in a separate key→file map is for SA to decide (SA-Q6).
- **FR2.** Define at least two profiles:
  - `business_os`: exactly the 11 keys in [Included](#included-11), pending SA confirmation.
  - `all`: every plugin currently in `corePluginFiles`, in the current order, so that "switch back" restores today's behaviour exactly.
- **FR3.** Define a single **active-profile constant** at the PluginManagerV2 level, set to `business_os`. Switching back to all plugins **must be a one-line change** to this constant (`business_os` → `all`).
- **FR4.** The profile data lives in code, at or beside the PluginManagerV2 layer. It **must not** read `process.env`, the DB or any admin config (U2).

### Resolver

- **FR5.** Provide **one resolver function** that returns the active plugin set (at minimum the active profile name and its ordered list of keys). It is the **only** way any code finds out which plugins are active.
- **FR6.** The resolver is synchronous and side-effect-free, and returns the same result for the whole process lifetime. Its signature must allow the source to be replaced later (env / DB / per-org) without changing its callers. If a future per-org resolution needs an argument or async, SA decides now whether to reserve that in the signature (SA-Q1).
- **FR7.** No other module may keep its own copy of the plugin list. The module-load log (L81–86) and `loadCorePlugins()` (L154) must both use the resolver.

### Loader

- **FR8.** `loadCorePlugins()` loads **exactly** the resolver's set. A plugin outside the set is **not read from disk, not parsed, not env-substituted and not validated**. As a result it produces no env-var warnings.
- **FR9.** Loading logic (read → env substitution → validate → register) is otherwise unchanged. A plugin in the set that fails to load keeps today's behaviour: one `error` log, then continue.
- **FR10.** A key in the active profile that has no definition file is logged **once at `error` level** at startup and skipped, never silently ignored. (A test also catches this, see AC4.)
- **FR11.** The loader takes the set as an input, or can be driven with an explicit profile, so tests can check "loads exactly this set" for any profile without an env var (SA-Q5).

### Behaviour for plugins outside the profile

- **FR12.** When `PluginExecuterV2.execute(userId, pluginKey, …)` is called for a key that is **not in the active set**, it returns a normal, non-throwing `ExecutionResult` with a **stable machine-readable code** (proposed: `error: 'plugin_not_enabled'`) and a clear message (proposed: `Plugin '<key>' is not enabled in the '<profile>' plugin profile`). It **must not**:
  - throw to the caller,
  - build the executor instance,
  - report `execution_error` or `Plugin executor not found`, which are reserved for real bugs.
- **FR13.** The same check applies to `PluginExecuterV2.fetchDynamicOptions` (L170), which today calls `getOrCreateExecutor` directly and would throw.
- **FR14.** The check runs **before** `getOrCreateExecutor`. "Not enabled" (in the registry but outside the profile) and "not registered" (a real bug) stay distinct results.
- **FR15.** A "not enabled" request is logged at `info` or `warn` (SA picks), with `pluginKey` and `profile`, once per request. It is not logged as an error.
- **FR16.** Manager lookups for an excluded key (`getPluginDefinition`, `getActionDefinition`, `validateActionParameters`, `getPluginSummariesForStage1`, `generateSkinnyLLMContextByPluginName`) keep their current not-found behaviour: `undefined`, a not-found validation result, or skip. They must not crash. SA decides whether the not-found messages on HTTP surfaces (`/api/plugins/*`, OAuth callback) should switch to the `plugin_not_enabled` wording (SA-Q7).
- **FR17.** Existing `plugin_connections` rows for excluded plugins are **left untouched**. No deletion, no status change. Re-enabling a plugin makes them usable again with no data migration.

### Logging

- **FR18.** At startup, exactly **one summary `info` line** that includes: active profile name, loaded plugin keys (and count), skipped plugin keys (and count). It replaces the current module-load line (L81–86) and the "initialized" line (L144), or SA may merge them into one.
- **FR19.** **No per-plugin log lines** (warn, info or debug) for skipped plugins, and no env-var warnings from skipped plugins.
- **FR20.** Env-var warnings for **in-profile** plugins stay as they are. They signal real misconfiguration of an integration BOS offers.

---

## Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Performance** | Cold-start load work scales with the profile size (11 of 28). Startup time is not the main goal (about 43 ms total today), so no timing target is set. The goals are fewer parsed definitions held in memory and smaller LLM-context payloads. Whether to make executor imports lazy is SA-Q2. |
| **Security** | No new inputs, env reads or DB reads. The resolver cannot be influenced by any request, header or user. The "not enabled" message may name the plugin key and profile (not sensitive) and must not include stack traces or internal paths. |
| **Reliability** | No crash paths. Every consumer handles an absent plugin the way it handles an unknown key today, or better. |
| **Maintainability** | One list and one resolver (FR5, FR7). Profile data is plain data with no logic, so it is readable at a glance and easy to move to a setting later. |
| **Observability** | One summary line per cold start (FR18). "Not enabled" requests can be found by a stable `error` code and log fields. |
| **Code standards** | Pino `createLogger` only, TypeScript strict, no new pattern without SA review (CLAUDE.md Mandatory Rules 3, 6, 7). Both touched files already use Pino. |
| **Accessibility** | N/A (no UI change in scope). |

---

## Impact on the AgentsPilot App (Accepted)

AgentsPilot shares the deployment and the `PluginManagerV2` singleton, so it runs under the `business_os` profile too. The user accepted this (U4). The impact is listed here so it is visible and testable, not so it can be mitigated.

| AgentsPilot surface | Effect under `business_os` profile |
|---|---|
| **V6 agent generation** (`lib/agentkit/v6/`, `CapabilityBinderV2`, `PluginVocabularyExtractor`, `ExecutionGraphCompiler`, `PluginParameterValidator`) | Only the 11 profile plugins can be bound. A prompt needing Gmail, Sheets, Slack and so on cannot be grounded, and compiling a workflow that references an excluded plugin fails with `Plugin 'X' not found`. |
| **Existing saved / scheduled agents** that use excluded plugins | Their steps fail at execution with the clean `plugin_not_enabled` result (FR12). Agent definitions are not changed. See SA-Q8 on retry/queue behaviour. |
| **Agent-creation LLM context** (`generateLLMContext`, `getPluginSummariesForStage1`, `process-message` capability hints) | Excluded plugins disappear from `connected_plugins` and `available_plugins`, even for users with a live connection. |
| **`/test-plugins-v2`** | Only profile plugins are listed and testable. Excluded plugins do not appear. |
| **Plugin connect UI / `GET /api/plugins/available`** | Returns only profile plugins. Excluded plugins cannot be connected, and the OAuth callback returns "Plugin configuration not found". |
| **`lib/plugins/pluginList.tsx`** (static UI metadata) | **Not changed** by this requirement. It can still show cards for excluded plugins, and connecting one fails at the callback. SA decides whether that inconsistency is acceptable for now (SA-Q9). |
| **Existing `plugin_connections` rows** | Kept (FR17). Hidden from connected lists and skipped for execution. |

**Revert path:** change the active-profile constant from `business_os` to `all` (FR3). This restores today's exact set and order.

---

## Acceptance Criteria

### Profile and resolver

- [ ] **AC1.** One declarative profile structure exists with `business_os` and `all`. `all` equals today's `corePluginFiles` set in the same order.
- [ ] **AC2.** One active-profile constant exists, set to `business_os`. Changing only that line to `all` makes the manager load all 28 plugins. A test proves this by driving the loader with each profile.
- [ ] **AC3.** The resolver is the only source of the plugin list. No other hardcoded plugin filename list remains in `plugin-manager-v2.ts` (checked by review, and by a test that the module-load / summary log uses the resolver's output).
- [ ] **AC4.** **Unit test (profile integrity):** every key in every profile maps to an existing file in `lib/plugins/definitions/`, and `business_os` contains `business-os`, `crm`, `scheduling`, `payments` and `website`.

### Loader

- [ ] **AC5.** **Unit/integration test (loads exactly the set):** after initialising with the `business_os` profile, `getAllPluginNames()` equals the resolver's key set exactly (no more, no fewer). The same holds for `all`.
- [ ] **AC6.** **Test (skipped plugins are not touched):** with `business_os` active, no definition file outside the profile is read (for example, a spied `fs.readFileSync` is never called with an excluded filename), and no `Environment variable not found` warning mentions a variable that only excluded plugins use.
- [ ] **AC7.** `business-os-plugin-v2.json` is loaded, has no `visibility` field, and `isPluginDiscoverable(def)` returns `true` for it. `crm`/`scheduling`/`payments`/`website` still return `false` without the opt-in.

### Clean skipped-plugin error

- [ ] **AC8.** **Unit test:** `PluginExecuterV2.execute(userId, 'google-mail', 'send_email', {})` under `business_os` resolves (does not reject) to `{ success: false, error: 'plugin_not_enabled', message: <names key and profile> }` and never constructs `GmailPluginExecutor`.
- [ ] **AC9.** **Unit test:** a key that is in **neither** the registry nor the profile (e.g. `does-not-exist`) still returns today's `execution_error` / "executor not found" result, distinct from AC8.
- [ ] **AC10.** **Unit test:** `fetchDynamicOptions` for an excluded key fails with the same `plugin_not_enabled` semantics and does not construct an executor.
- [ ] **AC11.** `getExecutablePlugins` and `getConnectedPlugins` for a user with an active `plugin_connections` row for an excluded plugin return without error and without that plugin (existing behaviour, covered by a regression test).

### Logging

- [ ] **AC12.** A cold start emits exactly one summary `info` line with `profile`, loaded keys/count and skipped keys/count, and no per-plugin log lines for skipped plugins.

### Business OS regression (happy path unchanged)

- [ ] **AC13.** The BOS chat CRM / scheduling / payments paths through `ChatCommandExecutor` work unchanged (existing executor tests pass).
- [ ] **AC14.** Channel insights connect + sync (`meta-insights`, `google-analytics`, `google-business-profile`) and calendar sync (`google-calendar`, `outlook`) resolve their plugins under `business_os`. Existing `ChannelMetricsSyncService` tests pass, and a manual smoke test of one connect flow is recorded by QA.
- [ ] **AC15.** Existing Jest suites that assume non-BOS plugins are loaded are identified and either pinned to the `all` profile through the test seam (FR11) or updated. None are deleted to make the build green.

---

## Out of Scope / Future Roadmap

**Out of scope**

- Making the profile configurable via **env var, DB setting, admin config or per-org setting** (U2).
- **Per-app scoping inside one deployment** (e.g. AgentsPilot requests see `all` while BOS requests see `business_os`). The active set is process-wide.
- **UI plugin list changes** (`lib/plugins/pluginList.tsx`, connect UI cards), unless SA decides a minimal change is needed for correctness (SA-Q9).
- Changing `visibility` semantics, `isPluginDiscoverable`, or resolving the INTERIM DUPLICATION decision (D9 / Q2–Q4 in `BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md`).
- Deleting or disabling `plugin_connections` rows, plugin definition files or executor classes.
- Fixing the env-var warnings of in-profile plugins (e.g. missing Stripe Connect client id locally). Those are real configuration gaps.

**Future roadmap (not scope)**

1. **Swap the resolver's source** for a real setting: env var (`PLUGIN_PROFILE=business_os|all`), DB/feature-flag row, or per-org entitlement. Only the resolver changes; the profile structure, loader and consumers stay the same.
2. **Per-request / per-org profiles**, if AgentsPilot and BOS need different sets in the same deployment. This needs the singleton to hold the full registry with per-request filtering, which is a larger design and SA-owned.
3. Converge the profile with a **subscription / entitlement** model if plugins become plan-gated.

---

## Open Questions for SA

Each question carries the BA's suggested resolution. None needs user input.

- [x] **SA-Q1 — Resolver home and signature.** Where should the profile structure and resolver live: inside `plugin-manager-v2.ts`, or a sibling module such as `lib/server/plugin-profile.ts`? Should the signature reserve room for a later per-org/async source? *Suggested:* a small sibling module exported for PluginManagerV2 and PluginExecuterV2. It stays synchronous and argument-free for now, since per-org is explicitly future work and reserving an unused parameter adds noise. (raised by: BA | status: resolved by SA, see [SA Review](#sa-review))
- [x] **SA-Q2 — Executor imports.** `plugin-executer-v2.ts` statically imports all 28 executor modules (L10–37), so their code loads whatever the profile says. Should this requirement also make executor loading lazy (dynamic `import()` per key)? *Suggested:* no. Keep the registry as it is and gate by profile only (FR12). Treat lazy imports as a separate, measured optimisation if bundle or cold-start cost justifies it. (raised by: BA | status: resolved by SA, see [SA Review](#sa-review))
- [x] **SA-Q3 — Confirm the BOS set.** Please confirm with a repo-wide search of `execute(` / `getPluginDefinition(` / `plugin_key` literals under `lib/business-os/**`, `lib/services/**`, `app/api/business-os/**`, `app/api/cron/**`, `components/business-os/**`:
  - (a) Does any BOS path call the **`stripe` executor**, or is `stripe` needed only for the OAuth connect/refresh path? *Suggested:* keep it either way, because the OAuth callback needs the definition.
  - (b) Do any BOS **kernel processes** (`lib/business-os/insight/kernel/KernelTrigger.ts`, "uses existing pilot infrastructure") run Pilot workflows with plugin steps (e.g. `google-mail`)? *Suggested:* if yes, add those keys to `business_os`.
  - (c) Confirm no BOS use of `whatsapp-business`, `google-mail`, `document-extractor`, `chatgpt-research`, `meta-ads`. *Suggested:* keep them excluded unless a call site is found.
  (raised by: BA | status: resolved by SA, see [SA Review](#sa-review))
- [x] **SA-Q4 — Which BOS paths hit discovery / LLM-context methods?** Confirm whether any BOS runtime path calls `getPluginSummariesForStage1`, `getAllActivePluginKeys`, `generateLLMContext`, `getConnectedPlugins` or `getAvailablePlugins`. The traced BOS chat (chat-v4 / BizQL) did not. The main consumers look like AgentsPilot agent creation and V6. *Suggested:* record the answer in the workplan. It decides whether the LLM-context saving applies to BOS itself or only to the shared deployment. (raised by: BA | status: resolved by SA, see [SA Review](#sa-review))
- [x] **SA-Q5 — Test seam without an env var.** How do tests (AC2, AC5, AC15) choose a profile when the production source is a hardcoded constant? *Suggested:* the loader takes the resolved set as a parameter (or the manager has a test-only factory taking a profile name), and the production `getInstance()` passes the resolver output. No env var and no global mutation. (raised by: BA | status: resolved by SA, see [SA Review](#sa-review))
- [x] **SA-Q6 — Keys vs. filenames.** Should profiles list keys and derive the filename (`<key>-plugin-v2.json`, matching L156's inverse), or keep an explicit key→file map? *Suggested:* list keys and derive the filename, with AC4 guarding against typos. All 28 files follow the convention today. (raised by: BA | status: resolved by SA, see [SA Review](#sa-review))
- [x] **SA-Q7 — HTTP-surface wording.** Should `/api/plugins/execute`, `/api/plugins/action-schema`, `/api/plugins/fetch-options`, `/api/plugins/refresh-token` and the OAuth callback return the `plugin_not_enabled` code for excluded keys instead of their current not-found messages? *Suggested:* yes for `/api/plugins/execute` (it goes through `PluginExecuterV2.execute`, so it gets this for free). Leave the others as not-found in this cycle and log a follow-up. (raised by: BA | status: resolved by SA, see [SA Review](#sa-review))
- [x] **SA-Q8 — Scheduled AgentsPilot agents.** Could an existing scheduled agent referencing an excluded plugin cause repeated failures or retry storms (e.g. via `app/api/cron/process-queue`)? *Suggested:* confirm that `plugin_not_enabled` is treated as non-retryable, or record the risk as accepted per U4. (raised by: BA | status: resolved by SA, see [SA Review](#sa-review))
- [x] **SA-Q9 — Static UI list.** `lib/plugins/pluginList.tsx` can still render connect cards for excluded plugins, and those connects fail at the OAuth callback. Is that acceptable for now? *Suggested:* yes, keep it out of scope (matches the user's steer), provided every connect UI that reads `/api/plugins/available` drops excluded plugins automatically. (raised by: BA | status: resolved by SA, see [SA Review](#sa-review))
- [x] **SA-Q10 — Stale comment.** The INTERIM DUPLICATION comment (L49–52) lists five internal plugins including **`intake`**, but there is no `intake-plugin-v2.json` and no `intake` executor. *Suggested:* while touching the file, correct the comment to four and do not add `intake` to any profile. (raised by: BA | status: resolved by SA, see [SA Review](#sa-review))

---

## Notes on Integration Points

| System | File(s) | Change expected |
|---|---|---|
| Plugin manager | `lib/server/plugin-manager-v2.ts` | Replace `corePluginFiles` with profile data + resolver. `loadCorePlugins` loads the resolved set. One summary log line. |
| Plugin executor | `lib/server/plugin-executer-v2.ts` | Profile check before `getOrCreateExecutor` in `execute` and `fetchDynamicOptions`. Returns `plugin_not_enabled`. |
| Visibility | `lib/plugins/plugin-visibility.ts`, `docs/PLUGIN_VISIBILITY_SCOPING.md` | No code change. SA may add a short note to the doc that profile gating sits upstream of visibility. |
| BOS consumers (unchanged, regression only) | `lib/business-os/ChatCommandExecutor.ts`, `lib/business-os/channel-insights/ChannelMetricsSyncService.ts`, `app/api/business-os/channel-insights/connect/route.ts`, `lib/services/CalendarSyncService.ts`, `lib/payments/stripeAccountContext.ts` | None |
| OAuth | `app/oauth/callback/[plugin]/route.ts` | None (excluded plugins get the existing not-found response, see SA-Q7) |
| AgentsPilot / V6 | `lib/agentkit/v6/**`, `lib/pilot/**`, `app/api/agent-creation/**`, `/test-plugins-v2` | None. Behaviour narrows as described in [Impact](#impact-on-the-agentspilot-app-accepted). |
| DB | `plugin_connections` | None (FR17) |
| Related docs | `docs/requirements/BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md` (D9, Q2–Q4) | None. The INTERIM DUPLICATION decision is respected, not resolved. |

---

## SA Review

**Reviewed by SA on 2026-09-19** (worktree `feature/business-os-plugin-profile` @ `01d0116b`, repo-wide grep)
**Verdict:** CLEARED WITH CONDITIONS. The requirement is architecturally sound. The profile gate sits upstream of visibility and does not disturb it, the 11-plugin set is confirmed, and there is no BOS regression path. The conditions (C1–C12 below) are mandatory workplan items. Most are consequences the BA could not see without full-text search. The main ones are a source-parsing integrity test, the `new-plugin` skill, and the V6 regression tooling.

### Corrections to the BA text (verified)

| Where | BA said | Actually |
|---|---|---|
| Current State / Impact: connect on an excluded plugin | Fails at the OAuth callback | It fails **earlier**, before any popup or OAuth round trip. `PluginAPIClient.connectPlugin` → `getPluginAuthConfig` → `getPluginDefinition` looks the key up in `/api/plugins/available` and throws `Plugin <key> not found` (`lib/client/plugin-api-client.ts` L333–350). `POST /api/v2/plugins/connect` returns 404 `Plugin not found` (`app/api/v2/plugins/connect/route.ts` L37–43). No half-completed OAuth and no orphan `plugin_connections` rows. |
| Q8 premise: scheduled agents hit `PluginExecuterV2` | Implied | The cron path (`run-scheduled-agents` → QStash → `process-queue`) runs `runAgentWithContext` by default (`use_agentkit` is not passed, so it is falsy). That uses the **deprecated V1** `pluginRegistry` through `PluginCoordinator` and never touches `PluginManagerV2`/`PluginExecuterV2`. The profile does not affect it. |
| FR10 needs new code | Implied | It does not. A profile key with no file already fails at `readFileSync`, which is caught by the existing `logger.error({ err, fileName }, 'Failed to load plugin')` once, and loading continues. AC4 is the real guard. No extra branch is needed. |
| `fetchDynamicOptions` would throw for an excluded key (FR13) | Correct, but not reachable today | Its only caller, `app/api/plugins/fetch-options/route.ts` L99–103, 404s on the missing definition first. FR13 stays as defence in depth. |

### Decisions on SA-Q1 – SA-Q10

| Q | Decision |
|---|---|
| **Q1: home and signature** | Sibling module **`lib/server/plugin-profile.ts`** (kebab-case, like its `lib/server/` neighbours). The resolver is **synchronous and argument-free**: `resolveActivePluginProfile(): PluginProfile`. Do **not** reserve a per-org or async parameter now. A later per-org source changes the signature and its (two) callers anyway, and that is the SA-owned roadmap item 2. The canonical shape is under "Approved pattern" below. |
| **Q2: executor imports** | **No lazy imports** in this cycle. The static imports stay, and the gate is the profile check only (FR12). The server bundle already contains all executor code, and module-evaluation cost is negligible next to the definition parsing we remove. Lazy `import()` would be a separate measured optimisation. It is not tracked because there is no evidence it is needed. |
| **Q3: BOS set** | **Confirmed: exactly the 11 keys** `business-os, crm, scheduling, payments, website, google-calendar, outlook, meta-insights, google-analytics, google-business-profile, stripe`. Evidence below. |
| **Q4: BOS use of discovery / LLM-context methods** | **None.** No file under `lib/business-os/**`, `app/api/business-os/**`, `app/business-os/**`, `components/business-os/**` or `app/api/cron/**` calls `getAvailablePlugins`, `getPluginSummariesForStage1`, `getAllActivePluginKeys`, `generateLLMContext`, `getConnectedPlugins`, `getExecutablePlugins` or `PluginManagerV2` at all. BOS reaches plugins **only by key** through `PluginExecuterV2.execute`. The single exception is `/test-business-os`, which reads `/api/plugins/available?includeBusinessOs=true`, and its keys are all in the profile. So the LLM-context saving applies to the **shared deployment** (AgentsPilot agent creation, V6, `/api/llm/context`), not to BOS chat. For BOS itself the benefits are less parsing and memory and no env-var warning noise from integrations we don't offer. Record this in the workplan. It is not a reason to change scope. |
| **Q5: test seam** | Three tiers, **no env var and no production global mutation**: (a) `initializeWithCorePlugins(profile: PluginProfile = resolveActivePluginProfile())` gets an optional parameter. `getInstance()` passes nothing. Tests that build their own manager pass `getPluginProfile('all')` or `getPluginProfile('business_os')` explicitly (AC2, AC5, AC6). (b) Jest suites that go through the `getInstance()` singleton pin the profile with `jest.mock('@/lib/server/plugin-profile', …)` so that `resolveActivePluginProfile` returns `getPluginProfile('all')`. That is test-only module substitution, not a runtime switch. (c) Standalone `tsx` scripts: see C10. |
| **Q6: keys vs filenames** | **Keys only**, with the filename derived as `` `${key}-plugin-v2.json` ``. All 28 files follow the convention, and I verified that each file's `plugin.name` equals its filename key. No key→file map. |
| **Q7: HTTP wording** | *(Corrected by QA 2026-09-19.)* `/api/plugins/execute` looks up the plugin definition before it calls `PluginExecuterV2.execute` (`route.ts` L89–96), so an excluded key gets **404 "Plugin not found"** and never reaches the gate. `plugin_not_enabled` is only returned to in-process callers of `PluginExecuterV2` (e.g. `ChatCommandExecutor`), which is enough. `/api/plugins/execute`, `/api/plugins/action-schema`, `/api/plugins/fetch-options`, `/api/plugins/refresh-token`, `/api/v2/plugins/connect` and the OAuth callback **keep their not-found responses**. "Not found" is truthful from the caller's view, and none of these is reachable from a BOS surface for an excluded key. **No follow-up is tracked.** Re-open only if a real client needs to tell the two apart. |
| **Q8: scheduled agents / retry storms** | **No retry-storm risk.** (1) The scheduled cron path uses V1 (see Corrections) and is unaffected. (2) The AgentKit path (`runAgentKit`, used when `use_agentkit` is true, e.g. `run-agent` async) builds tools with `convertPluginsToTools`, which reads `getExecutablePlugins` and `getAvailablePlugins`. An excluded plugin is skipped with one existing `console.warn`, the agent runs without that tool, and nothing throws, so QStash (`retries: 3`, only on a thrown or 500 response) never retries. (3) The Pilot path (`run-agent` sync, `sentinel/webhook`, calibrate) goes `StepExecutor` → `PluginExecuterV2.execute` → `plugin_not_enabled` → `ExecutionError`. `ErrorRecovery`'s retryable patterns (`TIMEOUT`, `RATE_LIMIT`, `ECONN*`, `ENOTFOUND`, `429/503/504`, …) cannot match the not-enabled message, so it fails once and is not retried. **Accepted residual (U4):** an AgentKit-path agent whose plugin is excluded may finish "completed" having done nothing useful, because the LLM had no tool. This is an existing AgentsPilot behaviour for any disconnected plugin, not new with the profile. |
| **Q9: static UI list / connect** | **Out of scope, no UI change.** No BOS surface renders `lib/plugins/pluginList.tsx`. BOS connects only in-profile keys: calendar (`components/scheduling/CalendarSyncSettings.tsx` → `google-calendar`/`outlook`), channels (`hooks/useChannelConnect.ts` → `meta-insights`/`google-analytics`/`google-business-profile`) and Stripe (`components/payments/StripeConnectWizard.tsx` L738 → `stripe`). Only the AgentsPilot connections page (`app/(protected)/settings/connections/page.tsx`, onboarding, wizard) still shows cards for the 17 excluded plugins. Clicking Connect fails immediately with "Plugin … not found" (see Corrections). That is accepted under U4. The OAuth callback needs no change. |
| **Q10: stale `intake` in comment** | **Confirmed stale.** There is no `intake-plugin-v2.json` and no `intake` executor. Correct the comment to **four** (`crm / scheduling / payments / website`) when it moves (C3). Do not add `intake` to any profile. |

### Q3 evidence (repo-wide grep)

| Check | Result |
|---|---|
| All `PluginExecuterV2` importers outside `lib/server/`, `lib/agentkit/**`, `lib/pilot/**`, `app/api/plugins/**` and `app/api/v6/**` | Only `lib/business-os/ChatCommandExecutor.ts` (keys `scheduling`, `crm`, `payments`), `lib/business-os/channel-insights/ChannelMetricsSyncService.ts` + `app/api/business-os/channel-insights/connect/route.ts` (keys from `CHANNEL_PROVIDERS`: `meta-insights`, `google-analytics`, `google-business-profile`) and `lib/services/CalendarSyncService.ts` (`google-calendar`, `outlook`). |
| `PluginManagerV2` in BOS / services / cron | Only `lib/services/PluginTokenService.ts`, used by `app/api/agents/[id]` and `run-agent-sandbox`, both AgentsPilot. It degrades to a `warn` + `failed[]` for an excluded key. |
| (a) `stripe` executor from BOS | **Never invoked.** `stripe` is needed for the definition only: `StripeConnectWizard` → `POST /api/v2/plugins/connect {plugin_key:'stripe'}` (404 without the definition), the OAuth callback, and `stripeAccountContext`/`create-checkout` reading `plugin_connections.plugin_key='stripe'`. The Express callback (`app/api/payments/stripe-connect/callback/route.ts` L151) writes that row through `UserPluginConnections` directly, without the manager. **Keep.** |
| (b) BOS kernel / pilot plugin steps | **None.** `lib/business-os/insight/kernel/KernelTrigger.ts` imports no executor and no pilot. `executeProcess` deliberately throws "not implemented" (L331–349), and the real actuator is BizQL `ForEachExecutor` → `lib/notifications/emailTransport.ts`. No BOS file imports `WorkflowPilot`, `runAgentKit`, `StepExecutor` or `lib/pilot`. |
| (c) `whatsapp-business`, `google-mail`, `document-extractor`, `chatgpt-research`, `meta-ads`, `linkedin` | No plugin use in any BOS path. The only hits are `linkedin` as a referrer/channel label (`channelFromReferrer.ts`, `ChannelSourcesSection.tsx`) and `PatternExtractor.ts` category tables (AgentsPilot analytics, no execution). BOS email is env-configured (`emailTransport.ts` L85–103: Resend → SMTP → `GMAIL_*` env OAuth), not the `google-mail` plugin. The `whatsapp-business` webhook uses `UserPluginConnections`, not the manager, and serves AgentsPilot. **All stay excluded.** |

### INTERIM DUPLICATION and visibility

- **No conflict.** `business-os-plugin-v2.json` has no `visibility` field, and the four internal plugins carry `"visibility": "business_os"`. I verified this by grep. The profile is a **load** gate and `isPluginDiscoverable` is a **discovery** gate over what was loaded. The profile module must not import `plugin-visibility.ts` or read `plugin.visibility`, and `plugin-visibility.ts` must not import the profile. `isPluginDiscoverable`'s rule ("never gate resolution-by-key") holds unchanged for every loaded plugin.
- `business-os` **and** the four internal keys are in `business_os`, so both INTERIM surfaces keep their consumers: the generator through discovery, and `ChatCommandExecutor` by key.

### Rule 7: approved pattern and canonical shape

The **named plugin profile + single resolver** pattern is **approved** for this use. It adds no speculative config plumbing: no env reads, no DB, no registry of profile sources, no per-org argument.

**File:** `lib/server/plugin-profile.ts`

| Element | Shape |
|---|---|
| `type PluginProfileName` | `'business_os' \| 'all'` (string-literal union, so a typo in the active constant is a compile error) |
| `interface PluginProfile` | `{ readonly name: PluginProfileName; readonly pluginKeys: readonly string[] }` |
| `PLUGIN_PROFILES` (exported, for the integrity test) | `Readonly<Record<PluginProfileName, readonly string[]>>`, **plain data, no logic**. `all` has the 28 keys in today's `corePluginFiles` order. `business_os` has the 11 keys as an **ordered subsequence of `all`**, so iteration order (and therefore LLM-context order) stays stable. |
| `ACTIVE_PLUGIN_PROFILE` (module-private `const`, type `PluginProfileName`) | `'business_os'`. **This is the one-line switch.** A comment on it says so and points to this requirement. |
| `getPluginProfile(name: PluginProfileName): PluginProfile` | Pure lookup. Returns a frozen, cached object (same reference each call). |
| `resolveActivePluginProfile(): PluginProfile` | `getPluginProfile(ACTIVE_PLUGIN_PROFILE)`. **The only answer to "which plugins are active"**, and the only function a future env/DB source replaces. |

No further exports (no `setActiveProfile`, no helper classes, no error class). Membership checks are `profile.pluginKeys.includes(key)` at the two call sites.

**Consumers (the only two):**
1. `PluginManagerV2`: `initializeWithCorePlugins(profile = resolveActivePluginProfile())` stores it (`private profile`) and passes it to `loadCorePlugins(profile)`. A new public accessor, **`getActiveProfile(): PluginProfile`**, returns what this instance actually loaded.
2. `PluginExecuterV2`: gates through **`this.pluginManager.getActiveProfile()`**, **not** by calling the resolver itself. That keeps the executor and the manager consistent by construction, including test managers built with an explicit profile.

### Logging decision

- Delete the module-load `logger.info` (L81–86) and its `globalThis` guard. Replace the "initialized" line (L144) with **one** `logger.info` at the end of `initializeWithCorePlugins`: `{ profile, loadedPluginKeys, loadedCount, skippedPluginKeys, skippedCount }` and message `'Plugin manager initialized'`. `loaded` means actually registered (after any load failure). `skipped` means `all` minus the active profile, so it is empty under `all`. That is exactly one line per singleton initialisation, and no per-plugin line for skipped plugins, because they are never read.
- FR15: a not-enabled request logs **`warn`**, once, with `{ pluginKey, profile, actionName? }`. It is actionable (a stale agent or caller references a plugin this deployment does not offer), and the volume is bounded (see Q8). It must not use `error`, and it must come **before** the existing `'Executing plugin action'` info line so a rejected call does not look like an execution.
- Env-var warnings for in-profile plugins are unchanged (FR20).

### Conditions for Dev (mandatory workplan items)

| # | Condition | Priority |
|---|---|---|
| **C1** | Implement exactly the canonical shape above (file, names, types, two consumers). There must be no hardcoded plugin filename or key list left in `plugin-manager-v2.ts`. | High |
| **C2** | **`tests/plugins/unit-tests/plugin-registry-integrity.test.ts` parses `plugin-manager-v2.ts` source for `'<key>-plugin-v2.json'` literals** (`managerPluginKeys()`). After the move it finds zero and fails. Rewrite that check to import `PLUGIN_PROFILES.all` and assert that **`all` equals the definitions directory set** (every file in exactly one entry, no extras). This test also becomes AC4's home: every key in every profile has a file, `business_os` ⊂ `all` in order, and `business_os` contains `business-os, crm, scheduling, payments, website`. Do not weaken the other assertions in that file. | High |
| **C3** | Move the INTERIM DUPLICATION comment **verbatim** into `plugin-profile.ts`, next to the `business-os` entry of `PLUGIN_PROFILES`, with `intake` removed ("four granular…", "crm / scheduling / payments / website"). Add one sentence stating that `business-os` **must remain in the `business_os` profile** for the same reason. Update the back-reference in `plugin-executer-v2.ts` (L63, "see the note on corePluginFiles in plugin-manager-v2.ts") to point at `plugin-profile.ts`. | High |
| **C4** | FR12/FR14 gate in `execute()`: if `pluginName` **is in `executorRegistry` but not in** `this.pluginManager.getActiveProfile().pluginKeys`, return `{ success: false, error: 'plugin_not_enabled', message: \`Plugin '${key}' is not enabled in the '${profile}' plugin profile\` }` **before** `getOrCreateExecutor` and before the execution info log. A key in neither keeps today's `execution_error`. `fetchDynamicOptions` makes the same check and **throws** `new Error(<same message>)` before constructing (its contract is throw-on-failure). Keep the message free of stack traces, paths and retryable tokens (Q8). | High |
| **C5** | Update the **`new-plugin` skill** (`.claude/skills/new-plugin/SKILL.md` L50 and the L82 checklist item, which say "add filename to `corePluginFiles[]`"). A new plugin's key goes into `PLUGIN_PROFILES.all`, and into `business_os` only when BOS invokes it. Also update the same instruction in `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md` (L560–563, L904) and `docs/V2_PLUGIN_MANAGER_BEHAVIOUR.md` (L549). The skill is the source of truth, and leaving it stale would make the next plugin scaffold wrong. | High |
| **C6** | Test fallout (AC15): `tests/plugins/common/mock-plugin-manager.ts` must call `initializeWithCorePlugins(getPluginProfile('all'))`. Otherwise every `tests/plugins/integration-tests/*` suite for Gmail, Drive, Sheets, Docs, Notion and Slack, plus `base-executor.test.ts`, loses its definitions. Singleton-based suites (`__tests__/DeclarativeCompiler-comprehensive.test.ts`, `DeclarativeCompiler-regression.test.ts` and any other found) pin `all` through `jest.mock` of the profile module (Q5-b). **Procedure:** record the full `npm test` failure list on `main` @ `01d0116b` first, then diff it against the branch. The branch may introduce **zero** new failures. Nothing is deleted or skipped to get green. | High |
| **C7** | AC8/AC10 "never constructs the executor": `jest.mock` the executor module (e.g. `./gmail-plugin-executor`) and assert that its constructor mock has 0 calls. AC6: spy `fs.readFileSync` and assert that no call path ends in an excluded `*-plugin-v2.json`. | Medium |
| **C8** | Logging exactly as in "Logging decision": one summary line, a `warn` for not-enabled, no module-load line, no per-skipped-plugin line. AC12 asserts the single line through a mocked logger. | Medium |
| **C9** | `docs/PLUGIN_VISIBILITY_SCOPING.md`: add a short "Profile gate (upstream)" note. The profile decides what is **loaded**, visibility decides what loaded plugins are **discoverable**, and "never gate resolution-by-key" applies to loaded plugins. Also add a Change History row. No code change in `plugin-visibility.ts`. | Low |
| **C10** | V6 / AgentsPilot `tsx` tooling (`tests/v6-regression/run-regression.ts` → `scripts/test-complete-pipeline-with-vocabulary.ts`, `scripts/test-*` V6 scripts) uses the real `PluginManagerV2.getInstance()` singleton, and V6 internals call `getInstance()` directly (`V6PipelineOrchestrator`, `WorkflowPilot`, shadow validators). Under `business_os`, every Gmail/Drive/Sheets regression scenario fails at grounding or compilation. **Per the user's decision (Option A, resolved 2026-09-19, see "Needs the user" below):** add one line to the regression runbook (`tests/v6-regression/scripts/README.md` and `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md`) saying "set `ACTIVE_PLUGIN_PROFILE` to `'all'` locally before running; never commit that change". Add **no** script-only override seam unless the user chooses option B. | Medium |
| **C11** | Pino only, TypeScript strict, and no `any` in the new module. Neither `plugin-manager-v2.ts` nor `plugin-executer-v2.ts` has `console.*`, so no conversion is owed there. `tests/plugins/common/mock-plugin-manager.ts` is test code. `lib/agentkit/convertPlugins.ts` has `console.*` but is **not** touched by this work. Do not edit it. | Medium |
| **C12** | Scope guard: no change to `pluginList.tsx`, `plugin-visibility.ts`, the OAuth callback, `/api/v2/plugins/connect`, `PLUGIN_KEYS` or any `plugin_connections` data. Plain key literals in `PLUGIN_PROFILES` are acceptable. `PLUGIN_KEYS` lacks 8 of the 11 BOS keys, and C2's integrity test is the typo guard. | Low |

### Accepted consequences (U4, no action)

- The AgentsPilot connections page, onboarding and wizard still show cards for the 17 excluded plugins. Connect fails at once with "Plugin … not found", and no OAuth starts. This re-opens, for AgentsPilot only, the "advertised but unloadable" state that `plugin-registry-integrity.test.ts` guards against. The test's catalog-vs-definitions check still passes because it checks files, not the profile.
- AgentsPilot users with live connections to excluded plugins stop seeing them as connected. Their rows are kept (FR17) and become usable again on revert.
- The `/test-plugins-v2` Plugin API Tester is **permanently gated off** under `business_os`. Its connection gate (`lib/plugins/tester/connection-gate.ts` `REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS`) needs all five Google Suite plugins, and four of them are excluded. It is an AgentsPilot internal developer tool, so the Option A local flip to `all` restores it. The BOS module tester on `/test-business-os` is unaffected. (Added by SA at workplan review, 2026-09-19.)

### Needs the user (one genuine business trade-off): RESOLVED, Option A

**Resolved by the user on 2026-09-19: Option A.** The AgentsPilot agent-generation regression suite (Gmail, Drive, Sheets and similar scenarios) does not run as committed while `business_os` is active. A developer who needs it changes the single `ACTIVE_PLUGIN_PROFILE` line in `lib/server/plugin-profile.ts` to `'all'` locally and does not commit that change. **No test-only or script-only switch is added.** C10 is implemented as the runbook line only. See the [workplan](/docs/workplans/BUSINESS_OS_PLUGIN_PROFILE_WORKPLAN.md) § 2.

**AgentsPilot agent-generation regression testing while Business OS is the focus.** With the Business OS profile on, the automated regression suite for AgentsPilot agent generation, which covers Gmail, Drive, Sheets and similar scenarios, cannot run as committed.
- **Option A (SA default, assumed unless the user says otherwise):** accept it. A developer who needs the suite flips the one-line switch to "all" on their machine and does not commit it. This costs nothing to build and matches "Business OS focus".
- **Option B:** add a small switch that only the testing scripts can use, so the suite runs as-is. This is a few lines of code, but it is a second way to change the plugin set, which the user asked to avoid.

### Approval

[x] Requirement cleared. Dev may write the workplan, which must carry C1–C12 as explicit tasks. SA will re-check C2, C3, C4, C5 and C6 at workplan review.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-19 | Initial draft (BA) | Profile + single resolver, hardcoded `business_os` active profile, 11-plugin BOS set with evidence, `plugin_not_enabled` contract, loading-vs-discovery relationship, AgentsPilot impact, 10 SA questions. |
| 2026-09-19 | SA review: CLEARED WITH CONDITIONS | Resolved SA-Q1–Q10. Confirmed the 11-plugin set by repo-wide grep (no BOS use of excluded plugins, stripe needed for OAuth only, no kernel/pilot plugin steps). Approved the `lib/server/plugin-profile.ts` profile + resolver pattern (Rule 7) with its canonical shape. Logging: one summary line, `warn` for not-enabled. Corrected the BA text: connect fails before OAuth, the scheduled cron path uses V1 and is unaffected. Added conditions C1–C12 (integrity-test rewrite, `new-plugin` skill + docs, test pinning, INTERIM comment move). One user trade-off: V6 regression tooling (default: accept, flip locally). |
| 2026-09-19 | User decision: Option A (V6 regression tooling) | User chose Option A. The AgentsPilot agent-generation regression suite does not run while `business_os` is active. Developers flip `ACTIVE_PLUGIN_PROFILE` to `'all'` locally and do not commit it. No test-only switch. The "Needs the user" item is marked resolved and C10 now cites the decision. Dev workplan: [BUSINESS_OS_PLUGIN_PROFILE_WORKPLAN.md](/docs/workplans/BUSINESS_OS_PLUGIN_PROFILE_WORKPLAN.md). |
| 2026-09-19 | SA workplan review | Added the `/test-plugins-v2` tester gating to the accepted consequences (U4). Workplan approved with conditions W1–W7; see the workplan § 10. |
