# Business OS — Intake Internal Plugin Workplan

> **Last Updated**: 2026-08-10
> **Module**: Intake (#5 in the [module roadmap](/docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md))
> **Status**: 🟢 **Implemented → SA code-review APPROVE (§9.2) → QA PASS (§10), no bugs.** Awaiting user code review before RM (RM held).
> **RM**: Held (same "hold RM until user reviews code" gate as CRM/Scheduling/Payments).

## Overview

Convert the Business OS **Intake** module into an internal, repository-backed V2 plugin, following the pattern proven on **CRM**, **Scheduling**, and **Payments**: a repository-delegating executor extending `BasePluginExecutor`, `access_strategy: db_active` (fail-closed), `visibility: business_os` (hidden from general discovery), `isSystem: true`, registered in `corePluginFiles` + `executorRegistry`, and surfaced automatically in the `/test-business-os` **Modules** tab.

Intake is the **smallest and cleanest** conversion in the initiative. It is a **configuration surface**: a global, read-only catalog of intake form templates plus a single per-user settings row (which template is active and when it's collected). Users **select** a seeded template and toggle collection settings — they do not author templates. The config surface has **no cross-capability side-effects** (the only trigger on the owned tables is an `updated_at` maintenance trigger), so there is **no double-log risk**.

## Table of Contents

1. [Scope](#1-scope)
2. [Assessment findings (Step 0 baseline)](#2-assessment-findings-step-0-baseline)
3. [Step 0 — Remediation](#3-step-0--remediation)
4. [Step 2 — Build the internal plugin](#4-step-2--build-the-internal-plugin)
5. [Guardrails](#5-guardrails)
6. [test-business-os Modules tab](#6-test-business-os-modules-tab)
7. [Open issues seeded to the roadmap](#7-open-issues-seeded-to-the-roadmap)
8. [Lean-test policy](#8-lean-test-policy)
9. [SA review](#9-sa-review)
10. [QA report](#10-qa-report)

---

## 1. Scope

### In scope (v1 — pure repo delegation, no network)

Wraps the **two owned Intake tables** via `IntakeRepository`:

| Table | Nature | v1 ops |
|---|---|---|
| `intake_form_templates` | Global read-only seed catalog (no `user_id`) | `list_intake_templates`, `get_intake_template` |
| `user_intake_settings` | Per-user config, `UNIQUE(user_id)`, one row | `get_intake_settings`, `update_intake_settings` |

**Proposed op set (4, SA to confirm):**
- `list_intake_templates` → `listTemplatesByVertical(vertical)` (vertical resolved from the caller's `business_profiles`, **not** a caller-supplied value; optionally merge the generic set, mirroring `app/api/intake/templates/route.ts`).
- `get_intake_template` → `getTemplateById(id)`.
- `get_intake_settings` → `getSettingsWithTemplate(userId)` (synthesizes disabled defaults when no row exists, mirroring `app/api/intake/settings/route.ts`).
- `update_intake_settings` → `upsertSettings(userId, { template_id?, is_enabled?, collect_during_booking?, send_after_booking? })`, validating `template_id` exists first (mirror `settings/route.ts`).

**Ship exactly these 4 ops** (M4). The `enable_intake` / `disable_intake` wrappers are **dropped** — `update_intake_settings({ is_enabled })` already covers it and there's no caller to justify the extra op-surface.

### Out of scope (v1)

- **Booking-response flow** — `IntakeRepository.saveIntakeResponses` / `getIntakeResponses` / `updateIntakeResponses` / `getEnabledTemplateForUser` operate on `scheduling_bookings.intake_responses`; these belong to **Scheduling's** response flow, not intake config. Not exposed here.
- **Template authoring (create/update/delete templates)** — the catalog is seed-managed (`20260728_seed_intake_templates.sql`); users select, they don't build. Custom-template CRUD is a future, larger scope.
- **The public form-submission path** — `app/api/website/forms/intake/route.ts` (writes CRM contacts/activities, currently with phantom columns) is a public leaf tracked under CRM **`task_dda5f400`**, not this module.

### Standalone plugin vs fold-into-CRM (SA decision)

The roadmap noted intake "could fold into CRM." **Recommendation: standalone `intake` plugin** — consistent with the one-plugin-per-module pattern, keeps the `visibility`/config surface isolated, and avoids bloating the CRM plugin's op list. SA to confirm or override.

---

## 2. Assessment findings (Step 0 baseline)

Read-only assessment, 2026-08-10. Full detail in the roadmap Intake section.

- **Repos:** `IntakeRepository` (singleton `intakeRepository`) owns both intake tables; `{data,error}`, Pino, no `console.*`. **Gap:** not constructor-DI — hardcodes `private supabase = supabaseServer` (`IntakeRepository.ts:73`). No delete methods (neither table has `deleted_at`; templates are read-only seed data).
- **Triggers:** only `update_user_intake_settings_updated_at` (BEFORE UPDATE, sets `updated_at`) — `20260728_create_intake_tables.sql:87-98`. No trigger on `intake_form_templates`. **Zero cross-capability side-effects on the config surface.**
- **Direct DB / phantom:** the owned tables are accessed **exclusively** through `IntakeRepository` (no `.from('intake_form_templates')` / `.from('user_intake_settings')` outside the repo). No phantom columns on the config surface.
- **Dead code:** `saveIntakeResponses` (`:403`) — no callers (the two public submit routes reimplement it inline). Unused: `listAllTemplates`, `getTemplateByKey`, `getSettings`, `createSettings`, `updateSettings`.
- **Capability wiring:** **not declared** in `capabilities-schema.ts` and **not wired** in `SafeExecutionLayer` — no existing chat/AI caller. The plugin + Modules tab is the **first executable surface** (no P4 caller to reuse; REST routes are the only current callers).
- **Data model:** templates carry multilingual `fields` JSONB + `is_default` per vertical; settings link to **one** template and gate collection (`is_enabled`, `collect_during_booking`, `send_after_booking`). Templates link to **verticals**, not services/contacts.

---

## 3. Step 0 — Remediation

Minimal — the surface is already clean.

| # | Item | Action | Risk |
|---|---|---|---|
| **I0.1** | `IntakeRepository` not constructor-DI | Convert to `constructor(private supabase: SupabaseClient = supabaseServer)`, singleton byte-compatible (`intakeRepository = new IntakeRepository(supabaseServer)`). **Consistency refactor, NOT a test prerequisite** (executor tests `jest.mock` the singleton module — Payments M8 precedent) (M3). Query logic unchanged. Optional M1 defense: move `user_id: userId` to after the `...settings` spread in `upsertSettings`/`createSettings`. | 🟢 Refactor. |
| **I0.2** | Dead/unused repo methods | **Do NOT prune in this workplan (M7).** Confirm `saveIntakeResponses` has zero callers and **report** — do not delete. Leave the response-flow methods in place, unwired. If any prune is done later, it goes in a **separate** commit, never entangled with the plugin. | 🟢 Housekeeping. |

> **Console-logging standard:** `IntakeRepository` already uses Pino — no `console.*` conversion needed. If any touched file logs via `console.*`, flag + convert per CLAUDE.md.
> **Not in this workplan:** the `website/forms/intake` phantom columns (CRM `task_dda5f400`) — cross-referenced only; confirm that item stays tracked.

---

## 4. Step 2 — Build the internal plugin

### 4.1 Definition — `lib/plugins/definitions/intake-plugin-v2.json`

- `key: "intake"`, `isSystem: true`, `visibility: "business_os"`, `access_strategy: { type: "db_active" }`, internal `auth_config` stub (mirror `crm`/`scheduling`/`payments`).
- **`domain: "crm"`** (M5) — the V6 `Domain` enum has no `intake`/`forms` member (`intent-schema-types.ts:30-44`); `crm` fits the lead/contact-capture semantics. (`internal` is an equally valid alternative — low-stakes metadata for a `business_os`-hidden plugin with no live V6 caller.) No enum change.
- **Exactly 4 actions** — each with `description`, `parameters`, **and `output_guidance`** (required by `validatePluginDefinition`, `plugin-manager-v2.ts`). Validate `db_active ⇒ isSystem`.

### 4.2 Executor — `lib/server/intake-plugin-executor.ts`

- `IntakePluginExecutor extends BasePluginExecutor`; `executeSpecificAction(connection, actionName, parameters)` reads `userId = connection?.user_id` (throw `access_denied` if missing).
- Import **only** `intakeRepository` + `businessProfileRepository` — the latter is **genuinely used** to resolve `vertical` for `list_intake_templates` (not vestigial — M6d). No CRM/Scheduling imports.
- **🔒 M1 (MEDIUM · security) — explicit field allow-list for `update_intake_settings`.** Sourcing `userId` from `connection.user_id` is necessary but **not sufficient**: `upsertSettings` (`IntakeRepository.ts:313-341`) builds the row as `{ user_id: userId, ...settings, updated_at }` with the spread landing **after** `user_id`, and `parameters` is `any` — so forwarding raw `params` as `settings` would let a caller-supplied `params.user_id` override the authenticated id and overwrite another tenant's row (via `onConflict: 'user_id'`). **The executor must pass only `{ template_id, is_enabled, collect_during_booking, send_after_booking }` picked explicitly from `params`** — never the raw `params` object. (This is a *lower, self-inflicted* class than Payments M1 / Scheduling M2 — Intake has no unscoped trigger and `template_id` is a global catalog id, so the only vector is a raw-`params` forward.) Optional repo-side defense-in-depth (I0.1): move `user_id: userId` to **after** the spread in `upsertSettings`/`createSettings` so the repo is immune regardless of caller.
- **Template reads take no `userId` (M2 — not a guard to build).** `list_intake_templates` / `get_intake_template` simply don't pass a `userId` to `listTemplatesByVertical` / `getTemplateById` (those methods don't accept one — `intake_form_templates` has no `user_id` column). There is no scoping middleware to defeat (`base-plugin-executor.ts`), so **do not add** a defensive phantom-filter check.
- **Executor mechanics to mirror the REST routes (M6 — QA oracle):**
  - `get_intake_template` and the `update_intake_settings` template-existence check must treat `getTemplateById`'s `{ data: null, error: null }` (PGRST116, `IntakeRepository.ts:137-141`) as **not-found** → check `!template`, not just `error` (mirror `templates/[id]/route.ts:54`, `settings/route.ts:120-126`).
  - `get_intake_settings` must **synthesize the disabled-defaults object** when `getSettingsWithTemplate` returns null (mirror `settings/route.ts:50-61`), not return null.
  - `list_intake_templates` mirrors the route's vertical + `'other'` generic merge (`templates/route.ts:40-47`); `vertical` comes from `businessProfileRepository`, never from `params`.

### 4.3 Register

- Add `'intake-plugin-v2.json'` to `corePluginFiles` (`plugin-manager-v2.ts`).
- Add `'intake': IntakePluginExecutor` to `executorRegistry` (`plugin-executer-v2.ts`).

### 4.4 P4 — real-caller wiring

**No pre-existing chat/AI caller exists** (intake isn't declared or wired). So there is no live caller to reroute (unlike CRM/Scheduling/Payments). The plugin + Modules tab is the first executable surface; the REST routes (`app/api/intake/**`) stay as-is (already repo-backed). Note this explicitly for SA — the "P4 reroute" step is N/A here.

### 4.5 Tests (lean — see §8)

`lib/server/intake-plugin-executor.test.ts` — fast pure unit tests with `jest.mock`ed `intakeRepository` + `businessProfileRepository`: dispatch table, missing-`userId` throws, **M1 test — `update_intake_settings` with a `params.user_id` present asserts `upsertSettings` receives the authenticated `userId` (the injected `params.user_id` is ignored)**, `update_intake_settings` rejects a non-existent `template_id` (`!template`), `get_intake_settings` synthesizes disabled defaults when no row exists, `list_intake_templates` resolves `vertical` from `businessProfileRepository` (not `params`), param guards.

---

## 5. Guardrails

- **`user_id` isolation (M1)** — settings ops always use the authenticated `userId`, AND the settings patch is built from an explicit 4-field allow-list so a caller-supplied `params.user_id` can never reach `upsertSettings`'s post-`user_id` spread. (Lower, self-inflicted class than Payments M1 — no unscoped trigger here.)
- **Global catalog (M2 — non-issue)** — template reads pass no `userId` (the repo methods don't accept one); nothing to filter, nothing defensive to add.
- **db_active fail-closed** — no `business_profiles` row / lookup error → `access_denied` (needed anyway to resolve `vertical`).
- **business_os visibility** — hidden from the 5 discovery sites; still resolvable by key.
- **No side-effects to delegate** — the config surface has no triggers beyond `updated_at`; nothing to avoid re-emitting.

---

## 6. test-business-os Modules tab

No new work — the Modules tab auto-lists any `visibility: business_os` plugin (data-driven). **Verification** (QA / user manual, needs dev-server restart to clear the cold-start plugin cache): Intake appears in the Modules tab; `get_intake_settings` returns the (synthesized) defaults for a fresh tenant; `list_intake_templates` returns the vertical's templates; `update_intake_settings` with a valid `template_id` + `is_enabled: true` persists and round-trips.

---

## 7. Open issues seeded to the roadmap

Recorded in the roadmap Intake section:
1. 🟢 `IntakeRepository` not constructor-DI (I0.1).
2. 🟢 Dead `saveIntakeResponses` + unused template/settings methods (I0.2).
3. ⬜ Intake not declared/wired — plugin is the first executable surface.
4. ℹ️ `user_id` isolation for settings + no phantom filter on the global catalog.
5. ℹ️ No template authoring in v1.
6. Cross-ref: `website/forms/intake` phantom columns stay under CRM `task_dda5f400`.

---

## 8. Lean-test policy

Only fast **pure mocked unit tests** run in-build (executor dispatch/guardrails). DB-backed behaviour (real upsert round-trip, defaults synthesis) is **QA-manual** — same policy as CRM/Scheduling/Payments.

---

## 9. SA review

**Reviewed by SA — 2026-08-10**
**Status:** 🔄 Revision Required — **APPROVE-WITH-CHANGES.** Architecturally sound and the cleanest conversion in the initiative: it reuses the shipped `db_active` + `visibility: business_os` substrate with **zero new access logic**, the config-surface / no-side-effects reading is correct, and the standalone-plugin call is right. There is **no High-severity finding** — Intake genuinely lacks the unscoped-trigger vector that made Payments M1/Scheduling M2 High. Fold in M1–M7 below (M1 is the only one with teeth: a settings-patch allow-list). No fundamental rework, no TL escalation. A diff against M1–M7 suffices — no second full review.

### Verification performed (against live code, not docs)

| Claim in the plan | Verdict | Evidence |
|---|---|---|
| `IntakeRepository` owns both tables, `{data,error}`, Pino, no `console.*`; DI gap at `:73` | ✅ Confirmed | `IntakeRepository.ts:73` `private supabase = supabaseServer`; logger `:10`; all methods return `{data,error}` |
| `intake_form_templates` has **no `user_id`** (global catalog) | ✅ Confirmed | `20260728_create_intake_tables.sql:8-30` — no `user_id` column |
| `user_intake_settings` is `UNIQUE(user_id)`; only trigger is `updated_at` | ✅ Confirmed | migration `:47` (`… UNIQUE`), `:87-98` (BEFORE UPDATE `updated_at` only). No cross-capability trigger. |
| `upsertSettings(userId, settings)` uses `onConflict: 'user_id'` | ✅ Confirmed, **with a footgun — see M1** | `IntakeRepository.ts:313-341` — upsert body is `{ user_id: userId, ...settings, updated_at }` (`:323-327`); the spread lands **after** `user_id`, so a `user_id` inside `settings` would override the authenticated one |
| `connection.user_id` is server-resolved (never client-supplied) | ✅ Confirmed | `access-strategy.ts:161,172-191` — `buildVirtualConnection(userId,…)` uses the server-resolved `userId` from `executeAction`; `db_active` fails closed `:138-157` |
| No generic scoping middleware injects a phantom `user_id` filter on template reads | ✅ Confirmed — **non-issue (M2)** | `base-plugin-executor.ts:27-153` — the template flow is param-normalize → constraint-guard → validate → access-resolve → `executeSpecificAction`; nothing injects a `user_id` filter, and the template repo methods take **no** `userId` arg |
| Domain enum has **no** `intake`/`forms`; `crm` exists | ✅ Confirmed | `intent-schema-types.ts:30-44` — members incl. `crm` (`:37`), `internal` (`:43`); no `intake`/`forms` |
| Intake **not** declared/wired — no live chat/AI caller (P4 N/A) | ✅ Confirmed | no `intake` in `capabilities-schema.ts`; no `SafeExecutionLayer` route; REST routes (`app/api/intake/**`) are the only current callers |
| `validatePluginDefinition` requires `description`+`parameters`+`output_guidance`; `db_active ⇒ isSystem` | ✅ Confirmed | `plugin-manager-v2.ts:754-755`, `:764` |
| Registration sites are `corePluginFiles` + `executorRegistry` | ✅ Confirmed | `plugin-manager-v2.ts:14-38`, `plugin-executer-v2.ts:45-70` (crm/scheduling/payments precedent) |

### Answers to the review questions

1. **4-op scope → ENDORSE.** `list_intake_templates` / `get_intake_template` over the global catalog + `get_intake_settings` / `update_intake_settings` over the per-user row is the correct cut. Excluding the booking-response methods is right — `saveIntakeResponses` / `getIntakeResponses` / `updateIntakeResponses` / `getEnabledTemplateForUser` all write/read `scheduling_bookings` (`IntakeRepository.ts:403-526`), i.e. **Scheduling's** response flow, not intake config. Excluding template authoring is right (seed-managed catalog, `20260728_seed_intake_templates.sql`). **Drop the optional `enable_intake`/`disable_intake` wrappers — see M4.**
2. **`user_id` isolation → the guard as written is NECESSARY but NOT SUFFICIENT; and it is a LOWER class than Payments M1 — see M1.** Sourcing `userId` from `connection.user_id` is correct and structurally guaranteed. But there is a second, mandatory half the plan omits: the executor must build the `settings` patch by an explicit 4-field allow-list, because `upsertSettings` spreads `...settings` *after* `user_id: userId` and `parameters` is typed `any` (TS won't catch a `params.user_id`). Note this is **not** "the same class as Payments M1": Intake has **no unscoped trigger** and `template_id` points at a **global** catalog, so no legitimate caller-supplied param is a cross-tenant vector — the only vector is a self-inflicted raw-`params` forward.
3. **Global-catalog guardrail → NON-ISSUE, do not add defensive code (M2).** There is no scoping middleware to defeat and the template repo methods take no `userId`; the "guardrail" is satisfied by simply *not* passing a `userId` to `listTemplatesByVertical` / `getTemplateById`. Reframe so Dev doesn't invent a phantom-filter guard (over-engineering).
4. **Standalone plugin → ENDORSE.** Consistent with one-plugin-per-module (crm/scheduling/payments), isolates the config surface, keeps the CRM op list lean. Do not fold into CRM.
5. **`domain: "crm"` → ACCEPTABLE (M5).** No `intake`/`forms` member exists; `crm` fits the lead/contact-capture semantics. `internal` (`intent-schema-types.ts:43`) is an equally valid alternative and arguably more literal (it is an internal BOS config module). Either is fine — low-stakes metadata for a `business_os`-hidden plugin with no live V6 caller. No enum change; no blocker.
6. **P4 N/A → CONFIRMED acceptable.** Unlike crm/scheduling/payments there is genuinely no chat/AI caller to reroute (not declared, not wired). The Modules tab + by-key execute is the first executable surface; the REST routes stay as parallel repo callers (same "same repo, no double-path" acceptance as Payments §4.4). No caller needs wiring.
7. **I0.1 DI → correct but reframe (M3).** DI is a **consistency** refactor, **not** a test prerequisite — the executor tests `jest.mock` the `intakeRepository` singleton module (exact Payments M8 precedent). Low-risk, singleton stays byte-compatible.
8. **No new patterns / standards → HELD.** Repository pattern (all DB via `IntakeRepository`), `db_active` fail-closed (reuses `AccessStrategyResolver`, unchanged), visibility gating only at the 5 sites (`getAvailablePlugins()` stays unfiltered), `output_guidance` required, lean-test policy — all consistent with the shipped modules. No new pattern.

### Must-fix (fold into the plan before coding)

- **M1 — [MEDIUM · security] `update_intake_settings` must build the settings patch by an explicit field allow-list; the "always pass the authenticated `userId`" guard alone is insufficient.** `upsertSettings` (`IntakeRepository.ts:313-341`) builds the upsert row as `{ user_id: userId, ...settings, updated_at }` — the `...settings` spread lands **after** `user_id` (`:323-327`), and the executor's `parameters` is `any`, so forwarding raw `params` as `settings` lets a caller-supplied `params.user_id` **override** the authenticated id and, via `onConflict: 'user_id'`, overwrite **another tenant's** settings row. **Fix (executor):** pass only `{ template_id, is_enabled, collect_during_booking, send_after_booking }` picked explicitly from `params` — never the raw `params` object. Add a unit test asserting a `params.user_id` is ignored (the upsert receives the authenticated `userId`). **Optional defense-in-depth (I0.1):** move `user_id: userId` to *after* the spread in `upsertSettings` (and `createSettings:261-266`) so the repo itself is immune. Reword §4.2/§5 to state the correct mechanism and drop the "same class as Payments M1 / Scheduling M2" framing (it is a lower, self-inflicted class — no unscoped trigger, global `template_id`).
- **M2 — [LOW] Recast the "global-catalog guardrail" as a confirmed non-issue, not a guard to implement.** No middleware injects a `user_id` filter (`base-plugin-executor.ts:27-153`) and the template methods take no `userId`. Amend §4.2/§5 to say "template reads pass no `userId` (methods don't accept one) — nothing to filter", so Dev does not add a defensive phantom-filter check (over-engineering).
- **M3 — [LOW] Reframe I0.1 rationale.** State DI is a **consistency** refactor, **not** a test prerequisite (executor tests `jest.mock` the singleton module — Payments M8). Keep the singleton export byte-compatible (`intakeRepository = new IntakeRepository(supabaseServer)`). Query logic unchanged.
- **M4 — [LOW] Drop the optional `enable_intake` / `disable_intake` wrappers from v1.** They add op-surface with no new capability — `update_intake_settings({ is_enabled })` already covers it — and there is no caller to justify the sugar. Ship the 4 ops; add wrappers later only if a real caller needs them.
- **M5 — [LOW] `domain`.** `crm` is acceptable; note `internal` as the equally valid alternative (SA decision, not a blocker). No enum change.
- **M6 — [LOW] Executor mechanics (state in §4.2 so QA has an oracle).** (a) `get_intake_template` and the `update_intake_settings` template-existence check must treat `getTemplateById`'s `{ data: null, error: null }` (PGRST116, `IntakeRepository.ts:137-141`) as **not-found** → check `!template`, not just `error` (mirror `settings/route.ts:120-126` and `templates/[id]/route.ts:54`). (b) `get_intake_settings` must **synthesize the disabled-defaults object** when `getSettingsWithTemplate` returns null (mirror `settings/route.ts:50-61`), not return null. (c) `list_intake_templates` should mirror the route's vertical + `'other'` generic merge (`templates/route.ts:40-47`). (d) Unlike Payments' QA note, `businessProfileRepository` **is genuinely used here** (resolving `vertical`) — so its import is correct, not vestigial; do not flag it unused.
- **M7 — [LOW] Do not prune dead repo methods in this workplan (I0.2).** Keep the change surface minimal to the plugin. Confirm zero callers and **report** before any deletion; if pruned, do it in a **separate** commit, never entangled with the plugin (the CRM/Scheduling/Payments commit-independence lesson). Leaving the response-flow methods in place, unwired, is correct.

### Approval

[ ] Workplan approved — proceed to implementation
[x] **Revision required — fold in M1–M7, then cleared for implementation** (no second full review; a diff against M1–M7 + the §-answers suffices). M1 is the load-bearing one: build the settings patch by explicit field allow-list — do not forward raw `params` into `upsertSettings`.

### 9.2 SA code review (post-implementation)

**Reviewed by SA — 2026-08-10**
**Status:** ✅ **APPROVE** — cleared for QA. All seven must-fix items (M1–M7) are correctly implemented, the load-bearing M1 allow-list is present in both the executor and the repo (defense-in-depth) and is directly asserted by a test, typecheck on the touched files is clean, and 15/15 unit tests pass. No High or Medium finding. Two Low/informational notes below are non-blocking.

#### Verification results (against the diff, not the notes)

| Priority | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | **M1 executor allow-list** — explicit 4-field pick, raw `params` never forwarded | ✅ | `intake-plugin-executor.ts:137-141` picks `template_id`/`is_enabled`/`collect_during_booking`/`send_after_booking` individually into a typed `patch`; `upsertSettings(userId, patch)` at `:151` — raw `params` is never passed. A `params.user_id` has no allow-list slot, so it cannot reach the upsert. |
| 1 | **M1 repo defense** — `user_id: userId` after the `...settings` spread | ✅ | `IntakeRepository.ts:333-334` (upsert) and `:269-270` (create) — spread lands before `user_id`, so a stray `settings.user_id` is overwritten by the authenticated id. `onConflict:'user_id'` target is therefore always the caller. |
| 1 | **M1 test** asserts injected `params.user_id` dropped + authenticated id reaches upsert | ✅ | `intake-plugin-executor.test.ts:108-126` — passes `user_id:'ATTACKER'`+`id:'ignored'`, asserts `passedUserId==='u1'`, `patch` equals only the 3 booleans, and `not.toHaveProperty('user_id'|'id')`. |
| 2 | **userId sourcing** — `connection.user_id`, throw `access_denied` if missing | ✅ | `:46-49`; tested `:151-153`. |
| 2 | **vertical from `businessProfileRepository`, never params** | ✅ | `:92-93` `findByUserId(userId)` → `profile.vertical || 'other'`; tested `:60-64` (attacker `params.vertical` ignored). |
| 3 | **M6a** `!template` not-found on get + update template check (PGRST116 `{data:null,error:null}`) | ✅ | get: `:62-64`; update: `:144-148`. Mirrors repo `:140-143`. Tested `:82-85`, `:135-141`. |
| 3 | **M6b** `get_intake_settings` synthesizes disabled defaults when row is null | ✅ | `:116-124` — byte-identical to `settings/route.ts:50-61`. Tested `:94-104`. |
| 3 | **M6c** `list_intake_templates` vertical + `'other'` generic merge | ✅ | `:97-103` — mirrors `templates/route.ts:40-47` incl. the "skip second fetch when vertical==='other'" branch. Tested `:66-73`. |
| 4 | **M2** template reads pass no `userId`; no phantom-filter code added | ✅ | `listTemplates`/`get_intake_template` call `listTemplatesByVertical`/`getTemplateById` with no userId; no defensive scoping added. |
| 5 | **I0.1 DI** — `constructor(private supabase = supabaseServer)`, singleton byte-compatible, query logic unchanged, no user_id scoping lost | ✅ | `IntakeRepository.ts:76`; singleton `:538` `new IntakeRepository(supabaseServer)`; settings queries still `.eq('user_id', userId)` (`:230`, `:301`); template queries still un-scoped. |
| 6 | **Definition** — 4 actions each with description+parameters+output_guidance; db_active+isSystem; visibility business_os; domain "crm"; registered both sites; no enable/disable wrappers | ✅ | `intake-plugin-v2.json` — 4 actions, all three required keys each; `isSystem:true` `:9`, `visibility:"business_os"` `:10`, `access_strategy.type:"db_active"` `:12`, `domain:"crm"` per action; `plugin-manager-v2.ts:38` + `plugin-executer-v2.ts:70`. |
| 7 | **P4 N/A** — nothing wired to SafeExecutionLayer/ChatCommandExecutor; REST routes untouched | ✅ | `grep intake` over SafeExecutionLayer/ChatCommandExecutor = empty; `git status` shows no `app/api/intake/**` changes. |
| 8 | **Standards** — repository pattern (no direct Supabase in executor), Pino not console.*, TS strict, no new patterns | ✅ | Executor imports only `intakeRepository`+`businessProfileRepository`; no `console.*` anywhere in the diff; `connection/parameters: any` is mandated by the abstract base signature (`base-plugin-executor.ts:156-160`), matching crm/scheduling/payments — not a new `any`. |

#### Typecheck + tests (run by SA)

- **`npx tsc --noEmit`** — 0 errors attributable to `intake-plugin-executor.ts`, `intake-plugin-v2.json`, or `IntakeRepository.ts` (filtered against the repo's large pre-existing baseline). Touched files clean.
- **`npx jest lib/server/intake-plugin-executor.test.ts`** — **15/15 pass** (1.9 s). Coverage matches §4.5: dispatch, missing-userId `access_denied`, M1 injection-dropped, template-existence rejection, defaults synthesis, vertical-from-profile, param guards, repo-error propagation.

#### Optimisation suggestions (Low · non-blocking, do NOT block QA)

1. **`update_intake_settings` returns the bare upsert row (no joined `template`).** The executor returns `upsertSettings`'s result directly (`:151`), whereas `settings/route.ts` POST does a follow-up `getSettingsWithTemplate` to return the enriched settings (with `.template`). This matches the workplan §4.2 spec exactly (M6b only mandates enrichment on `get`, not `update`), so it is not a defect — but a Modules-tab/UI caller reading `.template` off an update response will get `undefined`. If round-trip symmetry with `get_intake_settings` is wanted, mirror the route's post-upsert re-fetch. QA oracle note only.
2. **`domain` is action-level only** (each action carries `"domain":"crm"`; no plugin-level `domain`). Consistent with the sibling internal plugins — informational, no change needed.

#### Code Approved for QA: **Yes**

## 10. QA report

**QA — 2026-08-10**
**Test mode:** full
**Strategy used:** A (Jest unit run) + static source audit + typecheck. No dev server (Modules-tab live check is a user-manual step per §6). This is the correct strategy: the executor is pure repo-delegation logic best covered by mocked unit tests, and the guardrails (M1 allow-list, no-userId template reads, defense-in-depth spread order) are verifiable at the source.
**Focus:** security (M1 tenant-isolation), api parity, schema (definition validity)
**Skipped:** live Modules-tab round-trip (needs dev-server restart to clear cold-start plugin cache — user-manual, §6); DB integration (lean-test policy §8, intentional).
**Input source:** QA task prompt (explicit scope 1–7).

### Verdict: **PASS**

No High/Medium/Low bugs found. Implementation matches the SA-approved spec (M1–M7), guardrails hold at the source (not just green tests), and behaviour mirrors the REST routes. Two informational parity notes below are non-defects (documented spec choices), carried forward only as QA oracle context.

### Test + typecheck results

| Check | Result |
|---|---|
| `npx jest lib/server/intake-plugin-executor.test.ts` | ✅ **15/15 pass** (1.9 s) |
| `npx tsc --noEmit` (touched files: `intake-plugin-executor.ts`, `IntakeRepository.ts`, `intake-plugin-executor.test.ts`, `plugin-manager-v2.ts`, `plugin-executer-v2.ts`) | ✅ **0 new errors** in touched files (filtered against the repo's large pre-existing baseline) |

### Op coverage (all 4 ops covered — no gap)

| Op | Tested? | Cases |
|---|---|---|
| `list_intake_templates` | ✅ | happy (vertical+other merge), vertical-from-profile-not-params (attacker `params.vertical` ignored), no-profile → `'other'` single-fetch |
| `get_intake_template` | ✅ | happy, PGRST116 `!template` → not_found, missing `id` guard |
| `get_intake_settings` | ✅ | row present, null → disabled-defaults synthesis, repo-error propagation |
| `update_intake_settings` | ✅ | **M1 injection dropped**, template_id validated, non-existent template_id rejected before upsert, template_id absent → no lookup |
| Cross-cutting | ✅ | missing `userId` → `access_denied`; unknown action → not supported |

Required coverage from the prompt is all present: 4-op dispatch, missing-userId, M1 (`params.user_id`/`id` dropped; `upsertSettings` gets authenticated `u1` + patch of only the 3 booleans), `!template` rejection, defaults synthesis, vertical from `businessProfileRepository`.

### Guardrail audit (read at the source — not just tests)

- **M1 — no path where caller-supplied `user_id`/`id` reaches `upsertSettings`.** ✅ Verified. `updateSettings` (`intake-plugin-executor.ts:136-152`) builds `patch` from an explicit 4-key allow-list (`template_id`/`is_enabled`/`collect_during_booking`/`send_after_booking`); `user_id` and `id` have no slot and the raw `params` object is never forwarded. Even if a stray key existed, the repo applies **defense-in-depth**: `upsertSettings` spreads `...settings` **before** `user_id: userId` (`IntakeRepository.ts:333-334`) and `createSettings` likewise (`:269-270`), so `onConflict:'user_id'` always targets the authenticated tenant. Double-covered (executor allow-list + repo spread order).
  - `template_id` undefined vs null: `undefined` → key omitted from patch (no lookup, no write); `null` → included in patch, `if (patch.template_id)` is falsy so no catalog lookup, upsert clears it. Both correct and match `settings/route.ts:115` (`if (updates.template_id)`).
  - Empty patch / extra keys: extra keys silently dropped by the allow-list; empty patch → `upsertSettings(userId, {})` (see edge cases).
- **Template reads pass NO `userId`.** ✅ `listTemplatesByVertical(vertical)` / `getTemplateById(id)` take no userId arg; the executor passes none. No direct Supabase anywhere in the executor.
- **Imports.** ✅ Executor imports only `intakeRepository` + `businessProfileRepository` (plus base/manager/connection plumbing). No CRM/Scheduling/direct-DB imports.

### Definition sanity (`intake-plugin-v2.json`)

✅ Exactly 4 actions, each with `description` + `parameters` + `output_guidance`. `access_strategy.type: "db_active"`, `isSystem: true`, `visibility: "business_os"`, `domain: "crm"` (action-level, per sibling plugins). Passes `validatePluginDefinition` (`plugin-manager-v2.ts:738-771`): has `plugin.name`, declares `access_strategy` (and an internal `auth_config` stub), satisfies `db_active ⇒ isSystem`, ≥1 action, all actions carry the 3 required fields. Registered in `corePluginFiles` (`plugin-manager-v2.ts:38`) and `executorRegistry` (`plugin-executer-v2.ts:33` import, `:70` map entry).

### Behaviour parity vs REST routes — **PASS**

| Behaviour | Route | Executor | Verdict |
|---|---|---|---|
| Template not-found (`!template`, PGRST116) | `templates/[id]/route.ts:54`, `settings/route.ts:120` | `:62-64`, `:144-148` | PASS (identical) |
| Settings defaults synthesis on null | `settings/route.ts:50-61` | `:116-124` | PASS (byte-identical object) |
| Vertical + `'other'` merge, skip 2nd fetch when `'other'` | `templates/route.ts:41-47` | `:97-103` | PASS (identical) |
| `template_id` truthy-guard before lookup | `settings/route.ts:115` | `:144` | PASS |
| Vertical from `businessProfileRepository`, not params | `templates/route.ts:31-32` | `:92-93` | PASS |

### Edge cases (PASS/CONCERN — no fix needed)

1. **`update_intake_settings` with an empty patch (no fields)** → **PASS.** `patch = {}`, no template lookup, `upsertSettings(userId, {})`. Upsert body becomes `{ user_id, updated_at }`; for an existing row it just bumps `updated_at`, for a fresh tenant it creates a row on the DB column defaults (`is_enabled=false`, `collect_during_booking=true`, `send_after_booking=false`, `template_id` null — migration `:53-57`), which equals the synthesized `get_intake_settings` defaults. Benign, and the REST route accepts an all-optional body identically.
2. **`get_intake_settings` for a tenant whose settings row has `template_id = null`** → **PASS.** `getSettingsWithTemplate` returns the real row with `template: null` (join resolves to null); executor returns it as-is (truthy object, no defaults-substitution). Correct.
3. **`list_intake_templates` when the business profile has no vertical** → **PASS.** `profile.vertical || 'other'` → `'other'`; `vertical === 'other'` short-circuits the second fetch; returns the generic set. Mirrors `templates/route.ts` exactly. (Same path when `findByUserId` returns null.)

### Informational parity notes (non-defects — QA oracle only)

1. **`update_intake_settings` returns the bare upsert row (no joined `.template`).** The route POST does a follow-up `getSettingsWithTemplate` re-fetch; the executor returns `upsertSettings`'s result directly (`:151`). This matches spec §4.2 (M6b mandates enrichment on `get`, not `update`) and SA optimisation note #1 — **not a bug**. A future Modules-tab/UI caller reading `.template` off an *update* response would get `undefined`; if round-trip symmetry with `get_intake_settings` is wanted later, mirror the route's post-upsert re-fetch.
2. **No UUID-format validation on `template_id`/`id` at the executor layer.** Routes use Zod `z.string().uuid()`; the executor relies on the repo (`getTemplateById`). A malformed (non-UUID) id yields a Supabase cast error that propagates as a thrown error rather than the route's clean `400`/`not_found`. Both paths reject the input — no security or data-integrity impact; noted only as a message-shape divergence.

### Lean-build check — PASS

`intake-plugin-executor.test.ts` is pure mocked unit tests (`jest.mock` on both repos, no DB/network, 1.9 s). No integration/DB tests added — consistent with §8 lean-test policy.

### Final status
- [x] All acceptance criteria pass — **ready for commit** (RM still held per the user code-review gate; live Modules-tab round-trip remains a user-manual verification per §6).
- [ ] Issues found — Dev must address before commit

---

## 11. Implementation notes (Dev)

> **Implemented**: 2026-08-10 · Branch: `docs/business-os-event-driven-architecture` · RM held (no commit).

### Status of plan items

- [x] **I0.1** — `IntakeRepository` converted to constructor DI (`constructor(private supabase: SupabaseClient = supabaseServer)`); singleton export byte-compatible (`new IntakeRepository(supabaseServer)`). Query logic unchanged. M1 defense-in-depth applied: `user_id: userId` moved to AFTER the `...settings` spread in both `upsertSettings` and `createSettings`.
- [x] **I0.2** — No repo methods pruned. Grep verdict below.
- [x] **§4.1** — `intake-plugin-v2.json` created: 4 actions, each with `description` + `parameters` + `output_guidance`; `isSystem:true`, `visibility:business_os`, `access_strategy:{type:db_active}`, `domain:"crm"`, internal `auth_config` stub. No enable/disable wrappers (M4).
- [x] **§4.2** — `intake-plugin-executor.ts` created: `IntakePluginExecutor extends BasePluginExecutor`; `userId` from `connection.user_id` (throws `access_denied` if missing); imports only `intakeRepository` + `businessProfileRepository`. M1 explicit 4-field allow-list on `update_intake_settings`; M2 template reads pass no `userId`; M6 `!template` not-found checks (get + update), defaults synthesis on `get_intake_settings`, vertical+`'other'` merge from `businessProfileRepository`.
- [x] **§4.3** — Registered in `corePluginFiles` (`plugin-manager-v2.ts`) + `executorRegistry` (`plugin-executer-v2.ts`).
- [x] **§4.4 / P4** — N/A confirmed; no SafeExecutionLayer/ChatCommandExecutor wiring; REST routes unchanged.
- [x] **§4.5** — `intake-plugin-executor.test.ts` created; 15 tests, all pass.

### Files created / modified

| File | Action |
|---|---|
| `lib/repositories/IntakeRepository.ts` | modified (DI + M1 spread-order in upsert/create) |
| `lib/plugins/definitions/intake-plugin-v2.json` | create |
| `lib/server/intake-plugin-executor.ts` | create |
| `lib/server/intake-plugin-executor.test.ts` | create |
| `lib/server/plugin-manager-v2.ts` | modified (corePluginFiles += intake) |
| `lib/server/plugin-executer-v2.ts` | modified (import + executorRegistry += intake) |

### I0.2 dead-code grep verdict

`IntakeRepository.saveIntakeResponses` has **zero callers** — confirmed. The only `saveIntakeResponses` match in the codebase is a locally-defined function inside `components/crm/contact-drawer/BookingsTab.tsx` (not the repo method). The other response-flow methods are **not** dead and were correctly left in place: `getEnabledTemplateForUser`, `getIntakeResponses`, `updateIntakeResponses` have live callers (`app/api/book/manage/[token]/intake/route.ts`, `app/api/scheduling/bookings/[id]/intake/route.ts`, `app/api/website/booking/intake/route.ts`). Nothing pruned.

### Verification

- **Typecheck** — `npx tsc --noEmit` on touched files (`IntakeRepository.ts`, `intake-plugin-executor.ts`, `intake-plugin-executor.test.ts`): **0 errors**. (Repo has a large unrelated pre-existing error baseline; touched files are clean.)
- **Tests** — `npx jest lib/server/intake-plugin-executor.test.ts`: **15/15 pass**.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-10 | Created | Drafted from the read-only Intake assessment (the simplest conversion yet). Scope: 4 config ops over the two owned tables; booking-response flow + template authoring + the public form-submission path out of scope; I0.1 DI refactor; guardrails for settings `user_id` isolation + global-catalog (no phantom filter). |
| 2026-08-10 | SA-approved + M1–M7 folded in | APPROVE-WITH-CHANGES. Folded: **M1** explicit 4-field allow-list for `update_intake_settings` (upsertSettings spreads `...settings` after `user_id` — MEDIUM), **M2** global-catalog is a non-issue (no phantom-filter guard), **M3** I0.1 DI is consistency-only, **M4** dropped enable/disable wrappers (ship 4 ops), **M5** `domain:"crm"` (internal an alt), **M6** executor mechanics (not-found `!template`, defaults synthesis, vertical+other merge, businessProfileRepository genuinely used), **M7** don't prune dead repo methods. Cleared for implementation. |
