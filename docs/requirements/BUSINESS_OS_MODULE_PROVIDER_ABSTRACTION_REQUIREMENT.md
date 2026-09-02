# Requirement: Business OS Module Provider Abstraction (Unified Plugin Model)

> **Last Updated**: 2026-08-05

**Created by:** BA
**Date:** 2026-08-05
**Status:** Draft

## Overview

Business OS (BOS) modules and external integrations should be served by **one abstraction: the plugin**. The user has decided (Option B) to **extend the existing V2 plugin concept to cover internal modules** rather than build a separate module/provider layer above plugins. An internal BOS module (CRM, Scheduling, …) becomes an **internal plugin** whose executor is **repository-backed** (no external HTTP endpoint); external integrations (Gmail, HubSpot, Stripe) remain plugins as they are today. The app "works with plugins — you pick and choose which you want," and the **plugin definition is the single source of truth** for the capabilities/operations a module exposes. There is no separate capabilities-registry layer.

To make internal plugins first-class, the plugin's OAuth/connection slot is generalized into a pluggable **access / eligibility strategy** ("can this user use this plugin right now?"): OAuth becomes one strategy among several, alongside a shared "user is active in the DB" strategy for internal plugins and a designed-but-unbuilt license/subscription-tier seam. **CRM is the pilot**: v1 delivers CRM as an internal, repository-backed plugin with the "DB-active" access strategy. This requirement sits **above** the repository layer ([Document 1](/docs/requirements/BUSINESS_OS_MODULE_REPOSITORY_LAYER_REQUIREMENT.md)): an internal plugin's executor calls repositories, never the DB directly.

## Agreed Implementation Approach & Status (2026-08-05)

The user has agreed a **phased, CRM-first pilot**, aligned with the [SA feasibility review](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md). This section records the agreed approach and decision status; the detailed requirement sections below remain the source of the "what/why."

**Phased approach:**

- **Step 1 — Repository layer:** all CRM data access goes through the CRM repositories; no direct DB access ([Document 1](/docs/requirements/BUSINESS_OS_MODULE_REPOSITORY_LAYER_REQUIREMENT.md), scoped to CRM for the pilot).
- **Step 2 — Internal CRM plugin:** an internal plugin whose executor calls the CRM repositories, exposing operations **backward-compatible with the current application layer so nothing breaks**. The existing Postgres triggers are **kept untouched** and continue to own cross-capability side-effects — executors must **NOT** re-emit activities/contacts (SA guardrail T8).
- **Step 3 — later, out of scope now:** migrate the triggers to an event-driven architecture across plugins. Not built or designed now.
- **Pilot on CRM** to prove the pattern and confirm nothing broke, before generalizing to other modules.

**Decision status:**

| # | Decision | Status |
|---|---|---|
| Approach | 3-step phased, CRM-first pilot | ✅ Agreed |
| 1 | Backward-compat = additive/gradual (plugin sits on top of repositories; existing callers migrate over time, nothing forced at once) | ✅ Recommended–agreed |
| 2 | CRM plugin built as a **standard V2 plugin** (reusable platform-wide, incl. by AI agents) | ✅ **Agreed 2026-08-05** (user-confirmed; alternative Business-OS-only was rejected) |
| 3 | Cleanup scope = CRM only for the pilot; broader repository gaps (insight subsystem, misplaced repos) tracked as separate tasks | ✅ Recommended–agreed |
| 4 | Boundaries: triggers stay, step 3 deferred, v1 access-check = "user is active in DB", external providers & partial-capabilities out of scope | ✅ Agreed |

**Parked (not needed for the pilot):** internal-vs-external provider selection & `business_profiles.primary_*` wiring; partial/negotiated external capabilities.

## Table of Contents

1. [Agreed Implementation Approach & Status (2026-08-05)](#agreed-implementation-approach--status-2026-08-05)
2. [Concept and Vocabulary](#concept-and-vocabulary)
3. [User Stories](#user-stories)
4. [The Unified Plugin Model](#the-unified-plugin-model)
5. [The Pluggable Access / Eligibility Strategy](#the-pluggable-access--eligibility-strategy)
6. [Capability Selection (Which Plugin Serves a Capability)](#capability-selection-which-plugin-serves-a-capability)
7. [The CRM Reference Plugin (Worked Example)](#the-crm-reference-plugin-worked-example)
8. [What Collapses Under This Decision](#what-collapses-under-this-decision)
9. [Functional Requirements](#functional-requirements)
10. [Non-Functional Requirements](#non-functional-requirements)
11. [Acceptance Criteria](#acceptance-criteria)
12. [In Scope / Out of Scope](#in-scope--out-of-scope)
13. [Roadmap — Standardized Capability-Class Interfaces (Later Phase)](#roadmap--standardized-capability-class-interfaces-later-phase)
14. [Open Questions / Risks for SA](#open-questions--risks-for-sa)
15. [Notes on Integration Points](#notes-on-integration-points)
16. [Change History](#change-history)

---

## Concept and Vocabulary

| Term | Definition | Example |
|---|---|---|
| **Plugin** | The single abstraction for a capability provider. A plugin exposes operations (its capabilities) via a definition + an executor. Can be **internal** (repository-backed) or **external** (HTTP/OAuth-backed). | Internal `crm` plugin; external `gmail` plugin. |
| **Plugin definition** | The single source of truth for the operations/capabilities a plugin exposes (action + I/O schemas). | `lib/plugins/definitions/*.json` |
| **Internal plugin** | A plugin whose executor is backed by BOS **repositories** rather than an external API. No external endpoint, no OAuth. | `crm` (over the CRM repositories) |
| **External plugin** | A plugin whose executor calls an external service (today's V2 plugins, unchanged). | `gmail`, `hubspot`, `stripe` |
| **Access / eligibility strategy** | A swappable per-plugin answer to "can this user use this plugin right now?" OAuth is one strategy; "DB-active" is another; license-tier is a future one. | Internal CRM → "user active in DB"; Gmail → OAuth connection |
| **Capability selection** | The per-tenant config decision of **which plugin** serves a capability. | Tenant A → internal `crm`; Tenant B → external `hubspot` |
| **Enablement (orthogonal)** | Whether a plugin/capability is turned on for a tenant — the analog of `plugin_connections` / `user_capabilities`. Not part of the contract. | `user_capabilities` row; `plugin_connections` row |

**The rule that follows:** application code (routes, the chat `CapabilityEngine`, the AI data layer, UI actions) invokes **plugin operations** through the existing plugin execution path. It does not import a repository directly for a domain served by an internal plugin, and it does not branch on internal-vs-external — the plugin abstraction hides that.

---

## User Stories

- As a **non-technical business owner**, I want to pick and choose which plugins power my business (an internal CRM, or my existing external CRM), so that BOS fits the tools I already use without behaving differently.
- As the **platform**, I want one plugin abstraction for both internal modules and external integrations, so that we maintain a single execution path, connection model, and enablement model instead of two.
- As a **BOS application developer**, I want to call a plugin operation and not care whether it is repository-backed or an external API, so that feature code is written once against the plugin.
- As a **plugin author**, I want to declare how a plugin decides "can this user use me" (OAuth, DB-active, or later a license tier), so that internal and external plugins share one gating mechanism.
- As the **System Architect**, I want internal modules expressed as plugins with the plugin definition as the single source of truth, so that the four overlapping capability registries collapse into one model.

---

## The Unified Plugin Model

**In plain English:** instead of adding a new "module/provider" layer on top of plugins, we make internal modules *be* plugins. One abstraction, two implementations of the executor's data path.

```
        Application (routes, CapabilityEngine, AI data layer, UI actions)
                              │ invokes plugin operations
                              ▼
        ┌──────────────────────────────────────────────────────────┐
        │   V2 PLUGIN  (definition = single source of truth for      │
        │   the exposed capabilities/operations)                     │
        │   + pluggable ACCESS / ELIGIBILITY STRATEGY                 │
        └──────────────────────────────────────────────────────────┘
                 │ executor data path
        ┌────────┴─────────────────────────┐
        ▼                                   ▼
 ┌─────────────────────────┐     ┌──────────────────────────┐
 │ INTERNAL plugin executor│     │ EXTERNAL plugin executor  │
 │ → lib/repositories/     │     │ → external API / OAuth    │
 │   (Document 1)          │     │   (today's V2 plugins)    │
 └─────────────────────────┘     └──────────────────────────┘

 Orthogonal ENABLEMENT axis:
   external → plugin_connections     internal → user_capabilities (or equivalent)
   ("is this plugin/capability turned on for this tenant" — NOT the contract)
```

**Key properties:**

- The **plugin definition** enumerates the operations a plugin exposes — this replaces the several bespoke capability registries as the source of truth for "what can this domain do."
- An **internal plugin executor** fulfills those operations by calling repositories (Document 1) instead of an external endpoint.
- **Enablement** (which plugins a tenant has) stays orthogonal: `plugin_connections` for external, `user_capabilities` (kept as-is) for internal — the analog concept, not part of the operation contract.

---

## The Pluggable Access / Eligibility Strategy

This is the reframe that makes Option B clean and must be captured explicitly. Today a V2 plugin's usability hinges on an **OAuth/connection** check. Generalize that single check into a swappable **"can this user use this plugin right now?"** strategy, of which OAuth is just one implementation.

| Strategy | Used by | Question it answers |
|---|---|---|
| **OAuth / connection** (today) | External plugins | Does the user have a valid `plugin_connections` entry/token for this plugin? |
| **DB-active** (v1, new — shared default) | Internal plugins | Is the user an active BOS user in the DB (e.g. has a `business_profiles` row / active tenant)? A shared default strategy across all internal plugins, overridable per plugin. |
| **License / subscription tier** (designed seam, NOT built) | Any plugin, later | Does the user's plan/tier entitle them to this plugin and its capabilities? |

Framing: **OAuth becomes one strategy among several, not the concept.** A plugin declares which access strategy gates it; the plugin manager resolves the strategy before executing an operation. Internal plugins use the shared DB-active default unless they override it.

---

## Capability Selection (Which Plugin Serves a Capability)

"Internal CRM vs external CRM" becomes **"which plugin is selected to serve the CRM capability for this tenant."** This must be **config-driven, never hardcoded**.

> **Pilot note (see Agreed Approach):** provider selection and the `business_profiles.primary_*` wiring are **parked** for the CRM pilot — v1 always uses the internal CRM plugin. This section defines the target mechanism so the seam is understood, but it is not built in the pilot.

- **Existing signal to build on:** `business_profiles.primary_crm`, `primary_calendar`, `primary_payment` (plus `default_payment_processor`, `connected_plugins`) — an existing per-tenant hint at which plugin serves each domain ([BUSINESS_OS_DATA_MODEL.md §2](/docs/architecture/BUSINESS_OS_DATA_MODEL.md#2-business-profile)). `business_profiles` is the natural per-tenant anchor (architecture §13 obs #12).
- **Default:** when the signal is unset, the capability resolves to the **internal** plugin. Internal is always the fallback so a tenant always has a working capability.
- **No hardcoded plugin identifiers** in application code (parallels CLAUDE.md rule #5 for models). Selection is data/config, testable, per-tenant — resolved server-side.

---

## The CRM Reference Plugin (Worked Example)

CRM is the fully specified pilot. Shapes below are illustrative; exact operations/signatures are for the workplan.

### CRM plugin — exposed operations (from the plugin definition)

| Operation | Purpose | Internal executor maps to |
|---|---|---|
| `create_contact` | Create a contact | `crmContactRepository.create` |
| `get_contact` | Fetch one contact | `crmContactRepository.findById` |
| `list_contacts` | List/search/filter | `crmContactRepository.list` |
| `update_contact` | Edit contact fields | `crmContactRepository.update` |
| `move_stage` | Move pipeline stage | `crmContactRepository.updateStage` (+ `CRMPipelineStagesRepository` for validation) |
| `log_activity` | Add timeline activity | `crmActivityRepository.create` |
| `add_task` / `list_tasks` | CRM tasks | `crmTaskRepository.*` |

### Internal CRM plugin (v1 deliverable)

- A plugin **definition** declaring the operations above as the single source of truth.
- A **repository-backed executor** delegating each operation to the CRM repositories (Document 1). Every operation is `user_id`/tenant-scoped. This is a refactor of the CRM branches of today's `lib/business-os/chat/CapabilityEngine.ts` (which already switches on capability id and calls repositories) into the plugin execution path.
- The **DB-active access strategy** gating it.

### How an external CRM plugin would slot in (designed seam, not built)

An external `hubspot`/`salesforce` CRM plugin implements the **same operations** via an external executor + OAuth strategy. Because the application invokes the CRM capability (not a repository), wiring tenant B to the external plugin is a **selection change** — no route, `CapabilityEngine`, or UI edit. Note that same-domain plugins are only truly interchangeable behind one code interface once **capability-class interfaces** exist — that normalization is a later roadmap phase (see below), not v1.

---

## What Collapses Under This Decision

The earlier draft weighed which of four capability constructs should become a canonical "module contract." **That question is now answered: the plugin definition is the single source of truth.** For historical context, the constructs that converge or retire:

| Construct | Location | Fate under Option B |
|---|---|---|
| Chat capability registry + engine | `lib/business-os/chat/CapabilityRegistry.ts`, `CapabilityEngine.ts` | The engine's CRM branch becomes the internal CRM plugin executor; the registry's operations are expressed by the plugin definition. |
| Intent capability registry | `lib/business-os/CapabilityRegistry.ts` | Superseded by the plugin definition as source of truth for operations. |
| AI data-layer capabilities | `lib/business-os/ai-data-layer/capabilities-schema.ts`, `SafeExecutionLayer.ts` | Its CRM operations route through the plugin path; schema converges on the plugin definition. |
| Capabilities DB schema | `capabilities`, `user_capabilities`, `UserCapabilityRepository` | **Kept, orthogonal** — the internal-plugin analog of `plugin_connections` (enablement per tenant), not part of the operation contract. |

> **SA correction — the collapse is partial (record before workplan).** Only **domain operations + I/O schemas** collapse onto the plugin definition. Two things must **not** be forced into the plugin model: (1) **UI/navigation intents** (`calendar.open`, `navigate`, `preview.switch`, `contact.view`) — front-end routing actions with no repository/executor backing; and (2) **conversational/UX metadata** (multilingual templates like `successTemplate_he`, param-gathering hints, the `command_sessions` state machine). These stay in a BOS experience/chat layer that *invokes* plugin operations. The registries are also already internally inconsistent (engine switches on `contact.create`/`task.create` while the registry defines `contact.add`/`activity.add`), so the migration is a reconciliation, not a lift-and-shift. See [SA feasibility review §3](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md#3-other-open-questions-q2-q3-q4-q6--registry-collapse-correction).

---

## Functional Requirements

1. **Internal plugins are first-class V2 plugins.** An internal BOS module is expressed as a plugin with a definition (operations = single source of truth) and a repository-backed executor. No external endpoint required.
2. **CRM internal plugin (v1).** Deliver CRM as an internal, repository-backed plugin: definition of its operations + executor delegating to the CRM repositories (Document 1), behavior-preserving vs. today's `CapabilityEngine` CRM branches.
3. **Pluggable access/eligibility strategy.** Generalize the plugin's OAuth/connection check into a swappable strategy. Ship the **OAuth** strategy (existing) and a shared **DB-active** default for internal plugins. The **DB-active** strategy is **new eligibility logic** — it must actually verify the user is an active BOS tenant (has a `business_profiles` row) and **fail closed**; it is not a reuse of the unconditional `platform_key` virtual-connection path. The **license-tier** strategy is a documented seam, not built.
4. **Config-driven capability selection.** Which plugin serves a capability is resolved per tenant from config (reading `business_profiles.primary_crm` etc.), defaulting to internal, with no hardcoded plugin names in application code. *(Parked for the CRM pilot — v1 uses internal only; see Agreed Approach.)*
5. **Application invokes plugins, not repositories, for served domains.** At least one real caller (recommended: the chat `CapabilityEngine` CRM path and/or `SafeExecutionLayer` CRM operations) invokes the CRM operations through the plugin path, proving internal execution works end-to-end.
6. **Plugin definition as single source of truth.** The operations a domain exposes are defined once, in the plugin definition — not duplicated across the legacy capability registries.
7. **Internal-only external providers.** No external CRM plugin is built in v1; the external path + license-tier strategy are designed seams, documented well enough that adding them later touches no application code.

## Non-Functional Requirements

- **Security:** access strategy and capability selection resolved server-side from trusted signals; every operation stays `user_id`/tenant-scoped (internal via repositories/Document 1; external via the tenant's own `plugin_connections`). Selection/enablement must never be client-supplied without server validation.
- **Extensibility:** adding an external plugin for a domain later must require zero application-code change — only authoring the plugin (definition + executor + access strategy) and updating selection config.
- **No hardcoding:** no plugin-specific branches or plugin-name literals in application code (consistent with CLAUDE.md rule #5 and the "schema/config as source of truth" design principle).
- **Performance:** the internal executor must not add DB round-trips — an operation should map ~1:1 onto the repository call it replaces.
- **Monorepo-compatibility:** internal plugins live with the plugin system (`packages/plugins` target); their executors depend on `packages/repositories`. Headless, one-way dependencies (`apps/* → packages/plugins → packages/repositories → packages/core`), subject to the ESLint boundary banning React/app imports in `packages/**` (architecture §6.4).

## Acceptance Criteria

- [ ] SA has assessed the **feasibility** (lead open question) of the V2 plugin system absorbing internal plugins + the pluggable access strategy, and has stated the required refactoring and its cost. *(Done — see [SA feasibility review](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md): feasible with bounded refactoring R1–R8.)*
- [ ] CRM is expressed as an internal plugin: a definition enumerating its operations + a repository-backed executor delegating to CRM repositories, behavior-preserving (QA parity on create/list/update/move_stage/log_activity/add_task).
- [ ] The plugin access check is a swappable strategy; the **OAuth** and **DB-active** strategies both exist; **DB-active** is the shared default for internal plugins, is overridable per plugin, verifies an active tenant, and fails closed.
- [ ] Internal executors must **not** duplicate trigger-owned side-effects (no double-logging of activities/contacts) — the existing Postgres triggers remain the sole owner of cross-capability side-effects.
- [ ] A per-tenant capability-selection resolver reads `business_profiles` (primary_crm etc.), defaults to internal, and has no hardcoded plugin names in application code. *(Parked for the CRM pilot.)*
- [ ] At least one real application caller invokes CRM operations through the plugin path (not a repository directly) and behaves identically to before.
- [ ] The **license-tier** access strategy and the **external CRM plugin** are documented as seams with a code-free-in-app add-later path (validated by SA as requiring no route/UI/engine edits).
- [ ] The plugin definition is the documented single source of truth for CRM **domain operations**; the legacy capability registries' CRM operations are converged or superseded (not left as parallel sources). UI/navigation intents and conversational/multilingual metadata remain in the experience/chat layer (partial collapse per SA correction).
- [ ] `capabilities` / `user_capabilities` remain the orthogonal enablement axis, not folded into the operation contract.

## In Scope / Out of Scope

**In scope (v1):** internal plugins as first-class V2 plugins; CRM internal plugin (definition + repository-backed executor); pluggable access strategy with OAuth + DB-active shipped; wiring one real caller to invoke CRM via the plugin path; establishing the plugin definition as single source of truth.

**Out of scope (v1):**
- Building any **external** provider plugin (no HubSpot/Salesforce/etc.) — external path is a designed seam.
- The **license / subscription-tier** access strategy — designed seam, not built.
- **Config-driven capability selection** and `business_profiles.primary_*` wiring — **parked** for the CRM pilot (v1 uses internal only).
- **Migrating triggers to an event-driven architecture** (Step 3) — not built or designed now.
- **Standardized capability-class interfaces** (shared abstract contract per capability class) — a separate, larger roadmap phase (see below).
- Scheduling/Payments/Website/Email internal plugins — CRM is the pilot; these follow the same pattern later.
- Restructuring the `capabilities`/`user_capabilities` enablement schema — kept orthogonal, not reworked here.
- The repository-layer remediation beyond CRM — [Document 1](/docs/requirements/BUSINESS_OS_MODULE_REPOSITORY_LAYER_REQUIREMENT.md) (the pilot scopes the repository step to CRM; broader gaps tracked separately).

## Roadmap — Standardized Capability-Class Interfaces (Later Phase)

**Explicitly OUT of v1 scope. Named here as a distinct future layer — do not merge it into v1.**

Today each plugin exposes its own bespoke actions (Gmail's actions differ in shape from Outlook's; internal CRM's from HubSpot's). To make same-class plugins truly **interchangeable behind one code interface**, a future phase introduces a **standardized abstract contract per capability class** — e.g. an abstract **Email** class implemented by both Gmail and Outlook, and an abstract **CRM** class implemented by both internal-CRM and HubSpot. Application code would then target the abstract class, and swapping providers within a class would require no caller change.

This is a **bigger, separate effort** than v1: it requires normalizing heterogeneous plugin actions to a shared contract, which is real design and migration work across many plugins. v1 deliberately stops at "CRM is an internal plugin"; the capability-class normalization is a named subsequent phase for SA to scope on its own.

## Open Questions / Risks for SA

- [x] **Q1 (LEAD — FEASIBILITY) — Can the current V2 plugin system absorb internal plugins + a pluggable access strategy without contortion?** **Resolved by the [SA feasibility review](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md):** ✅ feasible, fits with bounded refactoring (R1–R8). The `isSystem` / `platform_key` non-OAuth path is the exact seam; the access-strategy generalization is a contained refactor of one resolver branch in `UserPluginConnections.getConnection`.
- [ ] **Q2 — Partial/negotiated capabilities for external plugins (business trade-off).** (status: for user, via SA) When a customer's external CRM can't do everything the internal CRM does: all-or-nothing vs. hybrid-fallback vs. graceful-degrade. Not a v1 blocker (external out of scope) but shapes the seam. **Parked** for the pilot; recommend designing the seam to permit graceful-degrade with an opt-in to hybrid, but the choice is the user's.
- [x] **Q3 — Access-strategy home in the plugin definition.** **SA-confirmed:** declare an explicit `access_strategy` field in the plugin definition (not by overloading `auth_config.auth_type`), resolved by the plugin manager; internal default = `db_active` (requires relaxing `validatePluginDefinition`).
- [x] **Q4 — Selection storage.** **SA-confirmed, conditional on an audit:** reuse `business_profiles.primary_crm` as the v1 read signal behind a `capability → plugin id` resolver (migratable to a dedicated table later). **Workplan pre-task:** audit what `primary_crm`/`primary_calendar`/`primary_payment` currently store (plugin keys? labels? free text?) so the mapping doesn't become a hardcoded switch. *(Parked with selection for the CRM pilot.)*
- [ ] **Q5 — Cross-capability side-effects across the plugin boundary.** **SA-recommended stance (see [feasibility review §2](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md#2-deep-dive--cross-capability-side-effects-q5)):** v1 ships internal-only on the **existing 9 Postgres triggers unchanged**; external providers are an explicit leaf/limited case; the event-bus seam is **designed-not-built**. **v1 guardrail:** internal executors delegate to repositories and must **not** re-implement side-effects (triggers own them; no double-logging). Migrating triggers to events is Step 3, deferred.
- [x] **Q6 — Kernel relationship.** **SA-confirmed:** author internal plugins as standard V2 plugins so the V6/orchestrator pipeline can also invoke them; set `provider_family` + per-action `domain`/`capability` deliberately for predictable V6 binding. *(Decision-status item #2 — "standard V2 plugin, reusable platform-wide" — is pending the user's explicit confirmation; alternative is Business-OS-only.)*

*Superseded:* the earlier "which of four capability registries is canonical" question — resolved by this decision to **the plugin definition** (partial collapse per SA correction).

## Notes on Integration Points

- **Plugin substrate (internal + external):** `lib/server/base-plugin-executor.ts`, `lib/server/plugin-executer-v2.ts`, `lib/server/plugin-manager-v2.ts`, `lib/server/user-plugin-connections.ts`, `lib/plugins/definitions/*.json`, `plugin_connections` table ([PLUGIN_GENERATION_WORKFLOW.md](/docs/PLUGIN_GENERATION_WORKFLOW.md)).
- **Existing execution surfaces to converge onto the plugin path:** `lib/business-os/chat/CapabilityEngine.ts` + `CapabilityRegistry.ts`, `lib/business-os/CapabilityRegistry.ts` + `IntentParser.ts`, `lib/business-os/ai-data-layer/SafeExecutionLayer.ts` + `capabilities-schema.ts`.
- **Internal-plugin data layer:** CRM repositories (`CRMContactRepository`, `CRMActivityRepository`, `CRMTaskRepository`, `CRMPipelineStagesRepository`) and the rest of the BOS repository set — governed by [Document 1](/docs/requirements/BUSINESS_OS_MODULE_REPOSITORY_LAYER_REQUIREMENT.md).
- **Cross-capability side-effects:** the 9 Postgres triggers inventoried in [SA feasibility review §2.1](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md#21-the-mechanism-today-an-invisible-integration-layer-made-of-postgres-triggers) — kept untouched in v1.
- **Selection signals (parked):** `business_profiles.primary_crm` / `primary_calendar` / `primary_payment` / `default_payment_processor` / `connected_plugins` ([BUSINESS_OS_DATA_MODEL.md §2](/docs/architecture/BUSINESS_OS_DATA_MODEL.md#2-business-profile)).
- **Enablement (orthogonal):** `plugin_connections` (external), `capabilities` / `user_capabilities` / `UserCapabilityRepository` (internal analog).
- **Monorepo target:** internal plugins in `packages/plugins`; executors depend on `packages/repositories` ([architecture §4](/docs/architecture/BUSINESS_OS_MONOREPO_ARCHITECTURE.md#4-target-structure)).
- **Dependency:** relies on [Document 1](/docs/requirements/BUSINESS_OS_MODULE_REPOSITORY_LAYER_REQUIREMENT.md) being met for CRM (the repository-backed executor needs conformant CRM repositories).

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-05 | Initial draft | BA authored a module/provider-abstraction requirement (module contract + internal/external provider interface + selection layer above plugins), with CRM as pilot and the four overlapping capability constructs as the key reconciliation for SA. |
| 2026-08-05 | Reworked for Option B (unified plugin model) | Per the user's decision, replaced the separate module/provider layer with **one plugin abstraction**: internal BOS modules become **internal plugins with repository-backed executors**; the **plugin definition is the single source of truth**. Added the **pluggable access/eligibility strategy** (OAuth / DB-active shipped, license-tier as a seam). Reframed provider selection as **which plugin serves a capability**. Kept `capabilities`/`user_capabilities` as an orthogonal enablement axis. Made the lead SA question a **feasibility** assessment. Added a named **roadmap phase** for standardized capability-class interfaces. Retired the "which registry is canonical" question. |
| 2026-08-05 | Recorded agreed implementation approach & SA outcomes | Added the **Agreed Implementation Approach & Status (2026-08-05)** section (phased CRM-first pilot; 3 steps; decision-status table; parked items) after the Overview and to the ToC. Folded in the SA feasibility outcomes: marked Q1/Q3/Q4/Q6 resolved, recorded the Q5 v1-triggers-unchanged stance + the no-double-logging guardrail, absorbed the **partial registry-collapse correction** (UI/nav + conversational metadata stay in the experience layer), and moved capability selection / `primary_*` wiring and partial-capabilities to **parked/out-of-scope for the pilot**. No change to the core requirement intent. |
| 2026-08-05 | Decision #2 confirmed | User confirmed the CRM (and internal) plugins are built as **standard V2 plugins** (platform-wide, invokable by AI agents / the V6 pipeline); Business-OS-only alternative rejected. Decision-status row #2 updated to ✅ Agreed. All pilot decisions are now settled; only Q2 (partial external capabilities) remains parked for a future external provider. |
