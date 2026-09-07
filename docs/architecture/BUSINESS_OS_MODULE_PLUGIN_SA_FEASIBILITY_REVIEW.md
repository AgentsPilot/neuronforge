# SA Feasibility Review — Business OS Unified Plugin Model (Option B)

> **Last Updated**: 2026-08-05

**Reviewed by:** SA
**Type:** Architectural feasibility review (pre-workplan). Review/design only — no code changed.
**Requirements under review:**
- [BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md) (Document 2)
- [BUSINESS_OS_MODULE_REPOSITORY_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_MODULE_REPOSITORY_LAYER_REQUIREMENT.md) (Document 1)

## Overview

The user has chosen **Option B — one unified plugin abstraction**: internal Business OS (BOS) modules (CRM first) become **internal plugins** with **repository-backed executors**, unified with external integrations under the existing V2 plugin system. The plugin definition becomes the single source of truth for exposed operations, and the OAuth/connection slot is generalized into a pluggable **access/eligibility strategy**.

This review assesses that decision against the **real** V2 plugin code (not the requirement's description of it), gives a feasibility verdict with the specific refactoring required, deep-dives the cross-capability side-effect question the user wants to debate, works through the remaining open questions, and checks Option B against platform standards.

**One-line verdict:** ✅ **Feasible — fits with bounded refactoring.** The V2 substrate already contains the exact seam Option B needs (the `isSystem` / `platform_key` non-OAuth path with a virtual connection), so an internal repository-backed plugin is an *extension* of an existing pattern, not a fight against the grain. The access-strategy generalization is a clean, contained refactor of one branch in `UserPluginConnections.getConnection`.

## Table of Contents

1. [Lead Verdict — Feasibility of Option B](#1-lead-verdict--feasibility-of-option-b)
2. [Deep Dive — Cross-Capability Side-Effects (Q5)](#2-deep-dive--cross-capability-side-effects-q5)
3. [Other Open Questions (Q2, Q3, Q4, Q6) + Registry-Collapse Correction](#3-other-open-questions-q2-q3-q4-q6--registry-collapse-correction)
4. [Standards / Fit Check](#4-standards--fit-check)
5. [Decisions That Need the User](#5-decisions-that-need-the-user)
6. [Proposed Edits to the Requirement Docs](#6-proposed-edits-to-the-requirement-docs)
7. [Change History](#7-change-history)

---

## 1. Lead Verdict — Feasibility of Option B

### 1.1 What the V2 substrate assumes about OAuth / HTTP

I traced the execution path end-to-end (`plugin-executer-v2.ts` → `base-plugin-executor.ts` → `plugin-manager-v2.ts` → `user-plugin-connections.ts`). The OAuth/HTTP assumptions are **fewer and shallower than the requirement fears**, and every one of them is already bypassed for "system" plugins:

| Assumed-external touch-point | Location | Does it fight an internal plugin? |
|---|---|---|
| Definition **must** declare `auth_config` | `plugin-manager-v2.ts` `validatePluginDefinition()` (throws if `plugin.auth_config` missing) | **Mildly.** Internal plugin must carry *an* `auth_config` — but `platform_key` system plugins already supply a stub one (empty `auth_url`/`token_url`). Bounded. |
| Connection lookup before execution | `base-plugin-executor.ts` Step 2: `getConnection(userId, name, authConfig)`, then `if (!connection && !isSystemPlugin) → auth_failed` | **No.** `isSystem` short-circuits the failure. System plugins already run with **no DB connection**. |
| Virtual vs OAuth connection branch | `user-plugin-connections.ts` `getConnection()` — `if (authConfig.auth_type === 'platform_key')` returns a **virtual connection** (no DB, no token, `user_id` embedded) | **No — this is the seam.** It is a two-strategy resolver in embryo (platform_key vs OAuth). |
| Token refresh / expiry | `getExecutablePlugins()`, `refreshToken()`, `isTokenValid()` | **No.** All gated behind `definition.plugin.isSystem` / `expires_at != null`. System plugins are "always executable." |
| HTTP helpers (`buildAuthHeader`, `handleApiResponse`, `getApiBaseUrl`, `performConnectionTest`) | `base-plugin-executor.ts` | **No.** These are `protected` helpers the subclass *may* call. An internal executor simply doesn't call them. |
| `executeSpecificAction(connection, action, params)` signature passes **connection, not userId** | `base-plugin-executor.ts` abstract method | **No.** The virtual connection already carries `connection.user_id`, so an internal executor reads `userId` from it and scopes repository calls. No signature change strictly required (though passing `userId` explicitly would be cleaner — see 1.3). |

**Key finding:** the template method `executeAction()` (param normalization → constraint guard → schema validation → connection resolve → `executeSpecificAction` → output formatting) is **provider-agnostic except for one Step-2 branch**, and that branch already has a non-OAuth exit for system plugins. Option B is riding a rail the platform already laid for `chatgpt-research` and `document-extractor`.

### 1.2 What is genuinely new (and therefore the real work)

The `platform_key` path is a *degenerate* access strategy: it returns a virtual connection **unconditionally** and performs **no eligibility check**. Option B's "DB-active" strategy is genuinely new logic — it must actually verify the user is an active BOS tenant (has a `business_profiles` row). So the access-strategy generalization is real work, not a rename. But it is contained to one resolver.

Two **pre-existing** registration facts (true for *every* plugin today, internal or external — not new debt Option B introduces):
- Definitions are loaded from a **hardcoded `corePluginFiles` array** (`plugin-manager-v2.ts`).
- Executor classes are wired in a **hardcoded `executorRegistry` map** (`plugin-executer-v2.ts`).

Adding the CRM internal plugin means editing both lists. That is the *existing* platform-authoring pattern (config, not application logic) and does **not** violate the no-hardcoding rule (which targets feature/app code). No change to that pattern is required for v1.

### 1.3 Refactoring required — itemized with effort / risk

| # | Change | Where | Effort | Risk |
|---|---|---|---|---|
| R1 | Generalize the connection/eligibility resolver: turn the `authConfig.auth_type === 'platform_key'` branch into a strategy switch (`oauth` \| `db_active` \| future `license_tier`). `db_active` verifies an active `business_profiles` tenant and returns a virtual connection carrying `user_id`. | `user-plugin-connections.ts` (+ a small `AccessStrategy` resolver) | 🟡 Medium | 🟡 Medium — it sits on the security-critical path; must fail closed. |
| R2 | Relax `validatePluginDefinition` so an internal plugin isn't forced to fake OAuth fields; accept an explicit `access_strategy` in place of a full `auth_config`. | `plugin-manager-v2.ts` | 🟢 Low | 🟢 Low |
| R3 | Add an `access_strategy` declaration to the plugin definition schema + `PluginDefinition` type; default internal → `db_active`. | `lib/plugins/definitions/*.json`, `plugin-types.ts` | 🟢 Low | 🟢 Low |
| R4 | Author the **CRM internal plugin definition** (operations = single source of truth: `create_contact`, `get_contact`, `list_contacts`, `update_contact`, `move_stage`, `log_activity`, `add_task`, `list_tasks`) with full param/output schemas + V6 `domain`/`capability` metadata. | new `lib/plugins/definitions/crm-plugin-v2.json` | 🟡 Medium | 🟢 Low |
| R5 | Author **`CRMPluginExecutor extends BasePluginExecutor`**: `executeSpecificAction` reads `connection.user_id`, dispatches per action to the CRM repositories (behavior-preserving vs the `CapabilityEngine` CRM branch). Recommend also widening `executeSpecificAction` to receive `userId` explicitly rather than only via the connection object — small, improves clarity/testability. | new `lib/server/crm-plugin-executor.ts` (monorepo: `packages/plugins`) | 🟡 Medium | 🟢 Low |
| R6 | Register CRM in `corePluginFiles` + `executorRegistry`. | 2 files | 🟢 Low | 🟢 Low |
| R7 | **Capability-selection resolver** (capability → plugin id), reading `business_profiles.primary_crm`, defaulting to internal, no plugin-name literals in app code. | new small resolver in a BOS service + `BusinessProfileRepository` | 🟡 Medium | 🟡 Medium — see Q4; audit what `primary_*` actually stores. |
| R8 | Wire **one real caller** (recommend the chat CRM path) to invoke `crm.*` via `PluginExecuterV2.execute()` instead of calling repositories directly — proving internal execution end-to-end. | `lib/business-os/chat/*` | 🟡 Medium | 🟡 Medium — behavior parity is the QA gate. |

**Not in the critical path but note:** `testConnection()` / `performConnectionTest()` assume a token; for internal plugins override to a trivial "tenant active?" check or skip. Cosmetic.

### 1.4 Target shape (concrete)

**How an internal plugin declares itself** — in its definition JSON, replacing the OAuth block with an explicit strategy:

```jsonc
{
  "plugin": {
    "name": "crm",
    "isSystem": true,                 // reuse the existing non-OAuth execution rail
    "provider_family": "internal-bos",
    "access_strategy": { "type": "db_active" },  // NEW — see R3; overridable per plugin
    "auth_config": { "auth_type": "internal" }   // minimal stub; R2 stops requiring OAuth URLs
  },
  "actions": { "create_contact": { /* full param + output schema + domain/capability */ } }
}
```

**Where the access strategy is resolved:** the plugin manager / `UserPluginConnections.getConnection` (single source of truth = definition; single resolution point = the layer that already resolves `auth_config`). Internal default = `db_active`.

**How the executor calls repositories:** `CRMPluginExecutor.executeSpecificAction(connection, action, params)` reads `const userId = connection.user_id`, then e.g. `crmContactRepository.create({ user_id: userId, ... })` — a ~1:1 map onto the existing `CapabilityEngine` CRM branch, satisfying the "no extra DB round-trips" NFR.

### 1.5 Verdict

**Fits with bounded refactoring.** No part of the substrate must be fought or rewritten; the OAuth coupling is confined to one resolver branch that already has a non-OAuth sibling. The dependency direction Option B needs (plugin executor → repository) is the monorepo-sanctioned direction (`packages/plugins → packages/repositories → packages/core`). The hard prerequisite is **Document 1** (conformant CRM repositories) — which for CRM is already largely met (the `CapabilityEngine` CRM branch already routes exclusively through `crmContactRepository` / `crmTaskRepository`). The single largest real design question is **not** feasibility of the plugin shell — it is **cross-capability side-effects** (Section 2).

---

## 2. Deep Dive — Cross-Capability Side-Effects (Q5)

This is the one the user wants to debate, so it is laid out to be debate-ready: the mechanism, why it breaks, four fully-articulated candidates, and a recommendation that keeps the alternatives live.

### 2.1 The mechanism today: an invisible integration layer made of Postgres triggers

Cross-module behavior in BOS is **not** in application code. It is enforced by **SECURITY DEFINER Postgres triggers** on the shared DB. Inventory (from [BUSINESS_OS_DATA_MODEL.md §3–§7, §12](/docs/architecture/BUSINESS_OS_DATA_MODEL.md#12-relationships-overview)):

| # | Trigger (behavior) | Fires on | Cross-effect |
|---|---|---|---|
| T1 | `create_crm_contact_from_booking_trigger` | `scheduling_bookings` INSERT | Creates/links a `crm_contacts` row (skips when `payment_status='pending'`) |
| T2 | `log_booking_activity_trigger` | `scheduling_bookings` INSERT / status UPDATE | Logs a `crm_activities` row |
| T3 | `log_payment_activity` | `payment_transactions` → succeeded | Logs a `crm_activities` row |
| T4 | `update_invoice_on_payment` | `payment_transactions` → succeeded | Flips linked `payment_invoices` to paid |
| T5 | `log_email_activity` | `email_sends` send | Logs a `crm_activities` row |
| T6 | `log_task_activity` / `set_task_completed_at` | `crm_tasks` complete | Logs a `crm_activities` row |
| T7 | `log_document_activity_trigger` | `contact_documents` upload | Logs a `crm_activities` row |
| T8 | `log_crm_contact_created_trigger` | `crm_contacts` INSERT | Logs a `contact_created` activity |
| T9 | `delete_future_bookings_on_contact_delete_trigger` | `crm_contacts` DELETE | Cancels/deletes future `scheduling_bookings` |

These fire **atomically, in-transaction, regardless of caller** — repository, chat engine, cron, or a raw SQL write. That is their strength (reliable, consistent) and the source of the problem (they are coupled to "all rows live in one Postgres").

### 2.2 Why it breaks at the external boundary — and why v1 is safe

- **v1 (all providers internal):** every write lands in local tables → every trigger fires → **behavior is unchanged. There is no v1 problem.** This is the single most important framing point: Option B v1 does **not** touch this mechanism.
- **The moment one capability is external**, the trigger web tears in one of two ways:
  - *External CRM, internal scheduling:* a booking still INSERTs into local `scheduling_bookings`, so T1/T2 fire and write a **phantom local contact/activity** — but HubSpot (the real system of record) never learns of the booking. Data splits.
  - *Internal CRM, external scheduling:* an external booking **never** INSERTs into local `scheduling_bookings`, so T1/T2 **never fire** — no contact, no activity. The cross-effect silently vanishes.
- Same failure shape for T3–T7 whenever payments/email are externalized.

The trigger web is, in effect, an **implicit provider-coupled event bus** that only works while there is exactly one provider per capability and they all share one database.

### 2.3 Candidate solutions

#### (i) Application-level domain-event / capability-event bus (move trigger logic up)

Each plugin operation, on success, emits a **normalized domain event** (`booking.created`, `payment.succeeded`, `email.sent`, …). A dispatcher invokes side-effects **through plugin operations** (`crm.find_or_create_contact`, `crm.log_activity`) — so they hit whichever provider serves CRM. The 7 triggers are re-implemented as event handlers and the DB triggers are **decommissioned**.

- **Cost:** High. Define event taxonomy; build dispatcher; re-implement T1–T9; migrate off triggers.
- **Risk:** High. Loses the trigger's **transactional atomicity** (bus is eventually-consistent → needs an outbox for reliability); **Vercel serverless has no persistent worker**, so dispatch is either inline best-effort or a durable queue; **double-fire** during transition (trigger + handler both live).
- **Interaction with trigger web:** replaces it wholesale.
- **Deferrable past v1?** Yes — v1 is internal-only. But the **seam** (taxonomy + dispatch point) should be designed now so the later switch isn't a rewrite.

#### (ii) Keep DB triggers for internal-internal; require external providers to emit normalized events (boundary hybrid)

Internal-internal keeps the fast atomic triggers (zero change). Only at an external boundary does an event bridge translate the external provider's actions into local side-effects (or into the other external provider's operations).

- **Cost:** Medium mechanics, but **high conceptual complexity** — two parallel side-effect mechanisms that must never double-fire. External-CRM + internal-scheduling means T1 must be **disabled per-tenant** (or it creates a phantom local contact) while the bridge routes the booking event to HubSpot.
- **Risk:** Medium-high — per-tenant trigger enable/disable and dual-mechanism coordination are error-prone and hard to reason about.
- **Interaction:** triggers and bridge coexist permanently; fragile.
- **Deferrable?** Yes.

#### (iii) Single provider-aware dispatch point, trigger-backed in v1 (staged toward (i))

Route **all** cross-capability side-effects through **one** application-level dispatcher, but let the dispatcher's *backend* be swappable. In v1 the backend is "the DB triggers already do it" (dispatcher is a documented pass-through). When the first external provider arrives, flip **specific** side-effects from trigger-backed to plugin-op-backed, retiring each trigger as its handler goes live. Unlike (ii) there is **one** conceptual mechanism with a swappable implementation, not two competing ones.

- **Cost:** Medium — design taxonomy + dispatch point now; keep triggers as the v1 backend.
- **Risk:** Medium — double-fire is controlled because a given side-effect is *either* trigger-backed *or* dispatcher-backed at any time, tracked explicitly.
- **Interaction:** triggers become the initial backend of the dispatcher, retired capability-by-capability.
- **Deferrable?** The plugin-op backend, yes; the taxonomy/seam, design now.

#### (iv) Constrain v1: cross-capability side-effects apply only when all involved capabilities are internal

External plugins are **leaf providers** — read/written directly, but **not** wired into the automatic trigger web. Documented limitation: *"bring-your-own external CRM won't auto-receive booking/payment activity logging in v1."*

- **Cost:** ~Zero (documentation + scoping; external is already out of v1 scope).
- **Risk:** Low technically; **product/UX** risk — the cross-capability "magic" is core BOS value, so silently not firing for external providers could erode trust. Must be surfaced explicitly, not buried.
- **Deferrable?** It *is* the deferral — the v1 answer regardless of the eventual target.

### 2.4 Recommendation

**For v1: adopt (iv) as the shipping scope, and design the (iii)→(i) seam now.**

Concretely:
1. **v1 ships on the DB triggers unchanged** (they are correct and atomic for internal-internal), external stays out of scope, and the external limitation from (iv) is **documented as a known product boundary**.
2. **Design now** (as part of this workplan's design output, not code): a normalized **cross-capability event taxonomy** and a **single dispatch point** in the plugin execution layer — so we know *where* events will one day fire, even though v1's backend for them remains the triggers.
3. **Later** (first external provider): migrate side-effects from triggers to the event-bus backend **one capability at a time**, retiring each trigger as its handler goes live — the staged path of (iii), converging on (i) as the correct end state (a single, provider-agnostic mechanism).

**Why this and not the others:** (i) built now pays a high cost (build bus + decommission triggers + outbox for reliability) for a capability that v1 cannot use (external is out of scope) — unjustified. (ii) is rejected as a *destination* because two permanent parallel mechanisms are a lasting coordination tax; it may appear transiently inside (iii) but is never the target. (iv) alone, with no seam design, risks a future rewrite. The recommended blend gets v1 shipped at near-zero cost while guaranteeing the eventual switch is an incremental migration, not a big bang.

> **Update (2026-08-05) — seam now designed and locked.** The (iii)→(i) event-driven seam described here has been whiteboarded and captured as a dedicated design doc: **[BUSINESS_OS_EVENT_DRIVEN_ARCHITECTURE.md](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_ARCHITECTURE.md)** (Step 3 — designed now, out of CRM-pilot v1 scope, built later). It confirms the backbone (`business_events` + `BusinessEventService`) is already built but unpopulated, locks the two-lane (fast/delayed) durable-queue model with application-level plugin emission (overriding the Insight plan's DB-trigger emission), and provides the concrete T1–T9 → lane classification. The v1 guardrail in §2.5 below feeds directly into that migration's no-double-fire discipline.

### 2.5 Concrete v1 guardrail for the Dev workplan

Even in all-internal v1 there is a **latent double-logging trap**: when `CRMPluginExecutor.create_contact` calls `crmContactRepository.create`, trigger **T8 still fires and logs the activity**. Behavior is preserved **only if the plugin executors do NOT also re-implement any side-effect**. Instruction for the workplan: **internal executors delegate to repositories and let the existing triggers own all cross-capability side-effects; they must not emit activities/contacts themselves.** (This is also why the dispatch point in 2.4 must start as a pass-through, not an active emitter.)

---

## 3. Other Open Questions (Q2, Q3, Q4, Q6) + Registry-Collapse Correction

### Q3 — Access-strategy home *(technical call — SA decides)*

**Declare it in the plugin definition** as an explicit `access_strategy` field (not by overloading `auth_config.auth_type`), resolved by the plugin manager / `UserPluginConnections`. Reason: the definition is the stated single source of truth, and the manager already resolves `auth_config`, so it is the natural resolution point. Requires R2 (relax `validatePluginDefinition`). **Confirmed.**

### Q4 — Selection storage *(technical call, with one audit the workplan must do)*

**Reuse `business_profiles.primary_crm` as the v1 read signal, behind a resolver interface** (`capability → plugin id`) so it can later migrate to a dedicated `capability_selection` table without app changes. Default → internal. **Mandatory audit before build:** `primary_crm` / `primary_calendar` / `primary_payment` are loosely-typed `TEXT`; the workplan must confirm **what values they currently hold** (plugin keys? provider labels? free text?) — the resolver must map them to canonical plugin ids, and the mapping must not become a hardcoded plugin-name switch in app code. **Confirmed, conditional on the audit.**

### Q6 — Kernel relationship *(mostly technical; one small product flag)*

**Author internal plugins as standard V2 plugins** so the V6/orchestrator pipeline can also invoke them — that unification is the point and it is free (the definition carries `domain`/`capability` metadata the V6 CapabilityBinder already consumes). Two notes for the workplan:
- Set the CRM plugin's `provider_family` and per-action `domain`/`capability` **deliberately**, so V6 capability-binding selects it predictably (it will otherwise become an auto-bindable `crm` provider across *both* apps).
- **Small product flag:** under the agreed shared data model (monorepo §8, Option A), an Orchestrator power-user invoking `crm.create_contact` writes the *same* tenant's CRM. That is consistent with "one customer, two front doors," but confirm it is intended rather than surprising. Low stakes.

### Q2 — Partial / negotiated external capabilities *(GENUINE BUSINESS DECISION — surface to user)*

Not a v1 blocker (external is out of scope) but it shapes the seam. In plain business terms: **when a customer brings their own external CRM that can't do everything our internal CRM does** (e.g. no pipeline stages, no task list), what happens?

- **(a) All-or-nothing:** the external CRM must support the full operation set or the customer can't select it. *Simplest, most predictable; rejects otherwise-usable CRMs.*
- **(b) Hybrid fallback:** use the external CRM for what it supports (contacts in HubSpot) and quietly keep the rest in our internal store (tasks/activities local). *Most capable; but data is split across two systems and can confuse users ("why are my HubSpot notes not in HubSpot?").*
- **(c) Graceful degrade:** unsupported operations return a defined "not supported here" result. *Honest and simple; some features visibly disappear per provider.*

This is a real product/trust/complexity trade-off, not a technical fork — **it needs the user.** (Recommend the seam be *designed* to permit (c) with an opt-in path to (b), but the choice is theirs.)

### Registry-collapse correction *(SA correction to Document 2 — important)*

Document 2 says the plugin definition becomes the single source of truth and "the four capability registries collapse." **That is correct for domain operations and I/O schemas, but the collapse must be partial, and the requirement should say so:**

1. **UI / navigation "capabilities" are not plugin operations.** The chat registry contains `calendar.open`, `navigate`, `preview.switch`, `contact.view` — these are **front-end routing actions with no repository/executor backing**. They must **not** be forced into the plugin model. They belong to the experience layer.
2. **Conversational / UX metadata has no home in the plugin action schema today.** The chat registry carries multilingual templates (`successTemplate_he`), param-gathering hints ("set `update_price=true` when the user wants to change price but hasn't given a number"), and the deterministic `command_sessions` state machine. The plugin definition covers operations, params, `rules`, and output — but **not** this conversational orchestration. The workplan must decide where it re-homes (plugin-definition extension fields vs a thin chat-presentation layer that *references* plugin operations) — do not assume a clean delete.
3. **The registries are already internally inconsistent** — the engine switches on `contact.create`/`task.create`/`booking.create`, while the registry defines `contact.add`/`activity.add`. This *strengthens* the case for one operational source of truth (the plugin definition), but underlines that the migration is a reconciliation, not a lift-and-shift.

**Net:** domain operations → plugin definition (single source of truth). UI/navigation intents + conversational/multilingual metadata → stay in a BOS experience/chat layer that invokes plugin operations. This is a scoping correction the requirement should absorb before the workplan.

---

## 4. Standards / Fit Check

| Principle | Verdict | Notes |
|---|---|---|
| **No hardcoding in app code** (CLAUDE.md rule #5 analog) | ✅ Respected | Capability selection is config-driven via `business_profiles`, defaulting to internal, no plugin-name literals in feature code. The `corePluginFiles`/`executorRegistry` hardcoded lists are **platform authoring config** (true for every existing plugin), not application logic — acceptable and unchanged. Guard: Q4's `primary_*` → plugin-id mapping must not become a hardcoded switch in app code. |
| **Repository pattern** (rule #1) | ✅ Respected / reinforced | Internal executors call repositories, never the DB. This is exactly Document 1's purpose; CRM already routes through `crmContactRepository`/`crmTaskRepository`. Direction `plugins → repositories` is monorepo-sanctioned. |
| **RLS / security** (rule #4) | ✅ with a load-bearing caveat | `userId` must be resolved **server-side** in the access strategy (from auth), never client-supplied; the executor scopes every repo call by `connection.user_id`. Caveat: BOS repositories use `supabaseServer` (service role, bypasses RLS) with **manual** `.eq('user_id')` — so the internal-plugin path inherits that manual scoping as security-load-bearing (Document 1 G5). Fine, but the plugin path must never drop `user_id`. |
| **Monorepo boundary** (headless packages) | ✅ Respected | CRM plugin = JSON definition + TS executor, no React. Independent of the pre-existing `lib/plugins/pluginList.tsx` React-in-package issue (monorepo §5.3), which Option B neither creates nor worsens. |
| **Serverless constraints** | ✅ for v1 | Internal execution is synchronous repo calls — no long-running work. The *only* serverless tension is the future event bus (Section 2.3(i)), which is explicitly deferred. |
| **Fix at root cause / correct phase** | ✅ | Access strategy and side-effect ownership are placed in the layers that own them (connection resolver; plugin/executor + DB triggers). No plugin-specific logic pushed into generic layers. |

No standards conflicts that block Option B.

---

## 5. Decisions That Need the User

Genuine business decisions (surface in business terms; do not let the workplan silently pick):

1. **Q2 — Partial/negotiated external capabilities:** all-or-nothing vs hybrid-fallback vs graceful-degrade when a customer's external CRM can't do everything (see Q2 above). Not a v1 blocker; shapes the seam.
2. **Cross-capability side-effects for external providers (the Section 2 debate):** confirm the recommended stance — **v1 ships internal-only on the existing triggers, external providers are explicitly a leaf/limited case, and the event-bus seam is designed-not-built.** The user asked to debate this; alternatives (i)–(iv) are laid out for that purpose.

Technical calls SA is making (no user needed, but recorded): Q3 (access-strategy in the definition), Q4 (reuse `business_profiles.primary_*` behind a resolver, pending the value audit), Q6 (author as standard V2 plugins), and the registry-collapse correction (partial collapse — UI/nav + conversational metadata stay in the experience layer).

### 5.1 Outcomes (recorded 2026-08-05 — BA)

The user reviewed this section and agreed a **phased, CRM-first pilot**. Outcomes against the two decisions above and the recorded technical calls:

| Item | Outcome |
|---|---|
| **Approach** | ✅ **Agreed** — 3-step phased, CRM-first pilot: (1) CRM repository layer, (2) internal CRM plugin over those repositories (backward-compatible; nothing forced to migrate at once), (3) trigger→event-driven migration **later** (out of scope now). Pilot on CRM to prove the pattern before generalizing. |
| **Decision 2 (Section 2 debate) — cross-capability side-effects** | ✅ **Agreed** as recommended: the **existing Postgres triggers are kept untouched** and remain the sole owner of cross-capability side-effects in v1; internal executors must **not** re-emit activities/contacts (guardrail T8, §2.5). Step-3 event-driven migration deferred; the seam is designed-not-built. |
| **Decision 1 (Q2) — partial/negotiated external capabilities** | 🅿️ **Parked** — external providers and partial-capability negotiation are out of scope for the pilot; revisit when the first external provider is scoped. |
| **Boundaries** | ✅ **Agreed** — triggers stay, Step 3 deferred, v1 access-check = "user is active in DB" (`db_active`), external providers & partial-capabilities out of scope. |
| **Q6 — author as a standard V2 plugin (reusable platform-wide, incl. AI agents)** | ✅ **Agreed 2026-08-05** (user-confirmed; Business-OS-only alternative rejected). Recorded in [Document 2 → decision-status #2](/docs/requirements/BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md#agreed-implementation-approach--status-2026-08-05). |
| **Q3 / Q4 (technical calls)** | ✅ Carried as recorded; Q4's `primary_*` value audit is a workplan pre-task. `primary_*` selection wiring itself is **parked** for the pilot (v1 uses the internal CRM plugin only). |
| **Cleanup scope** | ✅ **Agreed** — repository cleanup is **CRM only** for the pilot; the broader gaps (insight subsystem, misplaced repos) are tracked as **separate tasks** (Document 1). |

The full agreed approach and decision-status table live in [Document 2 → Agreed Implementation Approach & Status (2026-08-05)](/docs/requirements/BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md#agreed-implementation-approach--status-2026-08-05).

---

## 6. Proposed Edits to the Requirement Docs

Described, not applied (per review scope):

- **Document 2 §"What Collapses Under This Decision":** add the **partial-collapse correction** from Section 3 — UI/navigation intents and conversational/multilingual metadata are **out of** the plugin definition; only domain operations + I/O schemas collapse onto it.
- **Document 2 Q5:** replace the one-line "suggested resolution" with a pointer to Section 2 here, and record the recommended v1 stance (internal-only + designed seam) plus the v1 guardrail (executors must not re-implement side-effects; triggers own them).
- **Document 2 Q3/Q4:** mark **confirmed** with the specifics above; add the `primary_*` **value audit** as an explicit workplan pre-task for Q4.
- **Document 2 Acceptance Criteria:** add "internal executors must not duplicate trigger-owned side-effects (no double-logging)" and "capability-selection mapping contains no hardcoded plugin names."
- **Document 2 §Functional Requirements / access strategy:** note the `db_active` strategy is **new eligibility logic** (must verify active tenant, fail closed), not a reuse of the unconditional `platform_key` virtual-connection path.
- **Document 1:** no substantive change; reaffirm it is a hard prerequisite for R4/R5 and that CRM is the best-covered domain to pilot.

> **Status (2026-08-05):** these proposed edits have now been applied to Documents 1 and 2, and the user's agreed phased CRM-first approach is recorded in both (Document 2 gains an "Agreed Implementation Approach & Status" section; Document 1 gains a CRM-pilot-first scope callout). See §5.1.

---

## 7. Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-05 | Initial SA feasibility review | Assessed Option B (unified plugin model) against the real V2 plugin code. Verdict: feasible, fits with bounded refactoring (8 itemized refactors R1–R8). Deep-dived cross-capability side-effects (Q5): inventoried the 9-trigger web, showed v1 is safe and the break is at the external boundary, laid out 4 candidates (event bus / boundary hybrid / staged single-dispatch / v1 constraint) with trade-offs, recommended v1-internal-on-triggers + designed-not-built seam. Resolved Q3/Q4/Q6 as technical calls, flagged Q2 + the side-effect stance as user decisions, and issued a partial-registry-collapse correction (UI/nav + conversational metadata stay in the experience layer). Standards check passed. |
| 2026-08-05 | Annotated §5 with user outcomes | Added §5.1 recording the user's agreed **phased, CRM-first pilot**: approach agreed; the Section 2 side-effect stance agreed (triggers kept untouched, no-double-logging guardrail, Step-3 event migration deferred); Q2 partial-capabilities parked; the "standard V2 plugin" call (Q6) pending the user's explicit confirmation; cleanup scoped to CRM with broader gaps tracked separately. Noted in §6 that the proposed requirement-doc edits have been applied. |
| 2026-08-05 | Decision #2 / Q6 confirmed | User confirmed internal (CRM-first) plugins are built as **standard V2 plugins** — platform-wide, invokable by the V6/orchestrator pipeline; the Business-OS-only alternative was rejected. §5.1 and the Q6 rows updated to ✅ Agreed. Only remaining open user item: Q2 (partial/negotiated external capabilities), which stays parked until an external provider is built. |
