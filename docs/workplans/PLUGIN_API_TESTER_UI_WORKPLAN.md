# Workplan: UI-Based Plugin API Tester

> **Last Updated**: 2026-07-27

**Developer:** Dev
**Requirement:** [PLUGIN_API_TESTER_UI_REQUIREMENT.md](/docs/requirements/PLUGIN_API_TESTER_UI_REQUIREMENT.md)
**Branch:** `feature/plugin-api-tester-ui` (created by RM; confirmed checked out — Dev does not commit/push)
**Date:** 2026-07-27
**Status:** Code Complete (Phase A + Phase B implemented; folds in CR1–CR5; awaiting user code review → QA)

## Overview

Add a schema-driven, form-based plugin API tester as a **new mode inside the existing Plugins tab** of `/test-plugins-v2`. The user picks a Google Suite plugin + action, fills a form auto-generated from the action's declared input schema, runs it live against the userId's connected plugin, and reads the result. A persistent, session-scoped **side console** logs every plugin API call (request + normalized response + metadata). Access is gated solely on **connection completeness** (FR12/D6): the tester is usable only once the active userId has all five Google Suite plugins connected. The raw-JSON textarea that exists today becomes an "advanced" toggle beside the generated form.

This workplan is structured by the SA's phasing (A/B/C). **Phase A is the first implementable slice.** It carries the one required additive backend change (a read-only action-schema endpoint) plus the schema-driven form, live execution, current-result display, destructive-confirm gate, userId scoping, and the connection-completeness gate. Phase B adds the side console (client-side Level 1). Phase C is a deferred fast-follow, outlined only.

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [Files to Create / Modify](#files-to-create--modify)
4. [New Endpoint Contract](#new-endpoint-contract)
5. [Schema → Form Mapping Approach](#schema--form-mapping-approach)
6. [Destructive-Action Detection (schema-driven)](#destructive-action-detection-schema-driven)
7. [Connection-Completeness Gate](#connection-completeness-gate)
8. [FR8 Side Console Design](#fr8-side-console-design)
9. [Task List](#task-list)
10. [Testing](#testing)
11. [Standards & Risks (F1/F2/F3/F5)](#standards--risks-f1f2f3f5)
12. [Open Questions for SA](#open-questions-for-sa)
13. [SA Review Notes](#sa-review-notes)
14. [QA Testing Report](#qa-testing-report)
15. [Commit Info](#commit-info)
16. [Change History](#change-history)

---

## Analysis Summary

**Surfaces this feature touches:**

| Area | File | Role in this feature |
|---|---|---|
| Test page | `app/test-plugins-v2/page.tsx` (5689 lines) | Host page. Extend the Plugins tab with a new "Form Tester" mode. Reuse `userId` state (`NEXT_PUBLIC_TEST_PAGE_USER_ID`), `loadUserStatus`/`getUserPluginStatus`, `connectPlugin`, `executeAction`, plugin/action selectors, and `PARAMETER_TEMPLATES` (seed for JSON sub-editors). The current raw-JSON `parameters` textarea becomes the "advanced" toggle. |
| Client wrapper | `lib/client/plugin-api-client.ts` | `executeAction(userId, plugin, action, params)` → `POST /api/plugins/execute` (unchanged in Phase A). `getUserPluginStatus(userId)`, `connectPlugin(userId, key)` reused for the gate. Add a thin `getActionSchema(plugin, action?)` method for the new endpoint. |
| Execute route | `app/api/plugins/execute/route.ts` | **Unchanged behaviorally in Phase A.** Confirmed F3 finding below — flag only. |
| Schema source | `lib/plugins/definitions/{name}-plugin-v2.json` | Source of truth for the form: per-action `parameters` (JSON Schema), `required_params`/`optional_params`, `x-dynamic-options`, `rules.confirmations`, `capability`, `idempotent`, `output_schema`. |
| Plugin manager | `lib/server/plugin-manager-v2.ts` | `getPluginDefinition`, `getActionDefinition`, `getAllPluginNames` — used by the new endpoint (same access pattern as `schema-metadata/route.ts`). |
| Precedent endpoint | `app/api/plugins/schema-metadata/route.ts` | Canonical example: `getUser` + `createLogger` + correlationId + error envelope reading from `PluginManagerV2`. The new endpoint mirrors this shape. |

**Confirmed SA findings (verified in code):**

- **Action schemas are NOT exposed to the client today.** `GET /api/plugins/available` returns `actions: string[]` (names only). `GET /api/plugins/execute?plugin=X` returns per action `{name, description, usage_context, parameters}` — it exposes `parameters` but **not** `rules`, `required_params`/`optional_params`, `capability`, `idempotent`, or `output_schema`. So a new read endpoint is genuinely required for FR3 (form) + FR6 (confirm gate). ✅ SA gap #1 confirmed.
- **Destructive signal shape confirmed.** `google-drive delete_file`: `rules.confirmations` is an **object** keyed by rule name, each value `{ condition, action: "confirm", message }`. `revoke_access` is `capability: "update"` (would be missed by a capability-only check) yet **does** carry a `confirmations` entry. So keying on `rules.confirmations[*].action === "confirm"` is the correct, hardcode-free signal. ✅ SA Resolution 1 confirmed.
- **F3 confirmed:** `app/api/plugins/execute/route.ts` has **5 `console.*` calls** (lines 27, 57, 68, 84, 129), **no `getUser`/auth**, **no Zod** (manual `if (!userId ...)` checks), and executes via `PluginExecuterV2` (service-role path). See [Standards & Risks](#standards--risks-f1f2f3f5).

---

## Implementation Approach

**Phase A — core tester (first implementable slice).** Deliver an end-to-end usable form tester for Google Suite actions:

1. Add the read-only `GET /api/plugins/action-schema` endpoint that returns the full per-action block the form + confirm gate need. Modeled on `schema-metadata/route.ts` (Zod on query params, `createLogger`, correlationId, standard error envelope — F1). Read-only, no persistence → no repository needed.
2. Build the schema→form logic as a **pure, testable helper** (`lib/plugins/tester/schema-to-form.ts`) that maps a JSON-Schema action block to a flat list of typed field descriptors. UI components render from those descriptors — no plugin/action names anywhere in the code (F5/D2).
3. Render the form in a new `'use client'` sub-component tree under `components/test-plugins/tester/`. Reuse the existing `executeAction(userId, …)` path verbatim for Run (FR5) — no change to `/api/plugins/execute` behavior in Phase A.
4. Current-result display (FR7) — readable success payload + error, driven off the same `ExecutionResult` the page already handles.
5. Destructive-confirm gate (FR6) keyed on `rules.confirmations` from the new endpoint (see [design](#destructive-action-detection-schema-driven)).
6. userId scoping (FR11) — reuse the page `userId` field; empty userId blocks Run with a clear "userId required" state.
7. Connection-completeness gate (FR12/D6) — reuse `getUserPluginStatus`; enable the tester only when all five Google Suite plugins are connected; show per-plugin state; prompt to connect missing ones.

**Phase B — side console (FR8), client-side Level 1.** A persistent panel beside the form; one entry per Run appended from data the client already holds (assembled request + normalized `ExecutionResult` + metadata). Expand/copy/clear, most-recent-N cap, active-userId scoping. No backend change, no token on this path. Redaction remains an explicit acceptance criterion even though Level 1 carries no secret by construction.

**Phase C — fast-follow (outline only).** `x-dynamic-options` live pickers (D4); Level-2 raw upstream HTTP passthrough **only** behind the mandatory server-side redaction constraint (F2). Not decomposed into tasks here.

**Why this decomposition:** Phase A is independently shippable and demoable (form + live run + result + gates). Phase B is additive UI over data Phase A already produces. Phase C depends on decisions/constraints outside this cycle. This matches the SA's A/B/C phasing exactly, with Phase A's admin/dev gate replaced by the FR12 connection-completeness gate per D6.

---

## Files to Create / Modify

| File | Action | Phase | Reason |
|------|--------|-------|--------|
| `app/api/plugins/action-schema/route.ts` | create | A | New read-only endpoint returning full per-action schema block (F1 pattern). |
| `app/api/plugins/action-schema/__tests__/route.test.ts` | create | A | Integration test: happy + invalid query + missing plugin/action. |
| `lib/plugins/tester/schema-to-form.ts` | create | A | Pure helper: JSON-Schema action block → typed form-field descriptors + destructive-detection. |
| `lib/plugins/tester/schema-to-form.test.ts` | create | A | Unit tests for the mapping + destructive detection. |
| `lib/plugins/tester/tester-types.ts` | create | A | Shared TS types (`ActionSchema`, `FormFieldDescriptor`, `ConsoleEntry`). No `any`. |
| `lib/plugins/tester/connection-gate.ts` | create | A | Pure helper: given user status + required plugin keys → `{ enabled, missing[] }`. |
| `lib/plugins/tester/connection-gate.test.ts` | create | A | Unit test for the gate logic. |
| `components/test-plugins/tester/FormTester.tsx` | create | A | `'use client'` container for the new mode (selectors + form + result + advanced toggle). |
| `components/test-plugins/tester/SchemaForm.tsx` | create | A | Renders form fields from descriptors (text/number/boolean/enum/scalar-array + JSON sub-editor). |
| `components/test-plugins/tester/ConnectionGatePanel.tsx` | create | A | Per-plugin connected state + connect prompts; disables tester until complete. |
| `components/test-plugins/tester/DestructiveConfirm.tsx` | create | A | Lightweight confirm dialog rendering the `rules.confirmations` message. |
| `components/test-plugins/tester/ResultView.tsx` | create | A | FR7 current-result render (success payload + error). |
| `components/test-plugins/tester/SideConsole.tsx` | create | B | FR8 persistent request/response console. |
| `hooks/useSideConsole.ts` | create | B | Session-scoped console state (append/clear, retention cap, userId scoping). |
| `lib/client/plugin-api-client.ts` | modify | A | Add `getActionSchema(plugin, action?)` wrapper for the new endpoint. |
| `app/test-plugins-v2/page.tsx` | modify | A/B | Mount the new mode inside the Plugins tab; keep raw-JSON as "advanced" toggle; wire console (B). Scope changes tightly (see F3 note on not converting unrelated `console.*`). |
| `docs/V2_TEST_PAGE_SCOPE.md` | modify | A/B | Document the new tester mode when it ships. |

---

## New Endpoint Contract

**`GET /api/plugins/action-schema`** — read-only; returns the full per-action schema block for form generation + confirm gate. Follows the `schema-metadata/route.ts` precedent.

**Query params (Zod-validated — F1):**

| Param | Type | Required | Notes |
|---|---|---|---|
| `plugin` | `string` (non-empty) | yes | Plugin key, e.g. `google-drive`. |
| `action` | `string` | no | If present, returns that one action; if absent, returns all actions for the plugin. |

```typescript
const querySchema = z.object({
  plugin: z.string().min(1),
  action: z.string().min(1).optional(),
});
```

**Response (success):**

```json
{
  "success": true,
  "plugin": "google-drive",
  "actions": [
    {
      "name": "delete_file",
      "description": "…",
      "parameters": { "type": "object", "properties": { "...": {} } },
      "required_params": ["file_id"],
      "optional_params": [],
      "capability": "delete",
      "idempotent": true,
      "rules": { "confirmations": { "confirm_trash": { "action": "confirm", "message": "Move this file to Trash? …" } } },
      "output_schema": { "...": {} }
    }
  ],
  "action_count": 1
}
```

**Response (errors):** standard envelope. `400` invalid/missing `plugin` (Zod), `404` unknown plugin or unknown action, `500` unexpected (details guarded by `NODE_ENV === 'development'`).

**Contract notes:**
- Returns plugin **definition metadata only** — no user data, no connections, no tokens. Safe to expose (a strict subset of the same data `GET /api/plugins/execute?plugin=X` already returns unauthenticated, plus the `rules`/`required_params`/`capability` fields).
- Uses `PluginManagerV2.getInstance()` → `getActionDefinition` / `getPluginDefinition` (same as `schema-metadata`).
- `createLogger({ module: 'API', service: 'PluginActionSchema' })`, `child({ correlationId })`, standard error envelope. Read-only → **no AuditTrailService, no repository** (v1 has no persistence).
- **Auth decision is an open question for SA** — see [Open Questions](#open-questions-for-sa) Q1. `schema-metadata` gates on `getUser`; the current test page is unauthenticated. F1 mandates Zod+Pino+envelope but not `getUser`.

---

## Schema → Form Mapping Approach

Encapsulated in `lib/plugins/tester/schema-to-form.ts` as a **pure function** `buildFormFields(actionSchema): FormFieldDescriptor[]` — no React, no fetch, fully unit-testable. Schema-generic (F5): it reads JSON-Schema constructs only, never plugin/action names.

**Per top-level property in `parameters.properties`, emit a descriptor:**

| JSON-Schema shape | Control | Notes |
|---|---|---|
| `type: string` (no `enum`) | text input | `description` → hint; honor `default`. |
| `type: string` with `enum` | dropdown | options from `enum`; honor `default`. |
| `type: number` / `integer` | number input | `minimum`/`maximum` → validation hints. |
| `type: boolean` | checkbox/toggle | honor `default`. |
| `type: array` of scalars | scalar list (chips / comma input) | e.g. `calendar_ids`, `file_types`. |
| `type: object` (nested) | **scoped JSON sub-editor** | small JSON textarea bound to that subtree, seeded from `default`/`PARAMETER_TEMPLATES` (SA Resolution 3). |
| `type: array` of objects, or 2-D matrix | **scoped JSON sub-editor** | e.g. `reminders.overrides`, `working_hours.windows`, `sheets…values`. |
| any field carrying `x-dynamic-options` | labeled free-text input | v1 per D4; picker deferred to Phase C. Label surfaces the field meaning + `source`. |

**Descriptor shape (indicative):**

```typescript
interface FormFieldDescriptor {
  name: string;
  control: 'text' | 'number' | 'boolean' | 'enum' | 'scalar-array' | 'json-subtree';
  required: boolean;              // from required_params
  label: string;                  // from name (humanized)
  description?: string;
  enumValues?: string[];
  defaultValue?: unknown;
  min?: number; max?: number;
  isDynamicOption?: boolean;      // x-dynamic-options present (free-text in v1)
}
```

**Required-field validation (FR3):** `required` comes from `required_params`. The form blocks Run until every required scalar/enum/array field is non-empty; for `json-subtree` fields, it validates the sub-editor parses as JSON before Run. Assembly walks descriptors + sub-editor JSON into the final `parameters` object passed to `executeAction`.

**No `oneOf`/`anyOf`/`allOf`/`$ref`** appear in the Google definitions (SA spot-check), so a single-pass generator suffices; the JSON sub-editor + FR4 advanced toggle are the escape hatches for anything the generator can't render structurally.

---

## Destructive-Action Detection (schema-driven)

**Key on `rules.confirmations`, per SA Resolution 1 — confirmed in code (`delete_file`, `revoke_access`).** No hardcoded action list (F5).

- **Confirm gate fires** when the selected action's schema has any `rules.confirmations[key].action === "confirm"`. `rules.confirmations` is an **object** keyed by rule name, so iterate `Object.values`.
- **Confirm text** = that rule's authored `message` (e.g. `delete_file` → "Move this file to Trash? It can be restored from Google Drive Trash within 30 days."). Reuses platform-authored copy.
- **Do NOT evaluate the rule `condition`** string (e.g. `file_id != null`) client-side — presence of a `confirm` rule is sufficient for v1 (SA: condition parsing is fragile, out of scope).
- **Red "destructive" badge** (visual, distinct from the confirm click): additionally style when `capability === "delete"` **OR** `idempotent === false`. `revoke_access` (capability `update`) still gets the confirm gate via its `confirmations` entry — which is exactly why the gate keys on `rules.confirmations`, not `capability`.
- **Acceptable caveat:** some non-destructive threshold prompts (e.g. `list_files` `large_list`) also carry a `confirm` rule; surfacing a confirm there is harmless/arguably correct.

Detection lives in the same pure helper (`schema-to-form.ts` → `getConfirmation(actionSchema): { requiresConfirm: boolean; message?: string; isDestructiveStyle: boolean }`) so it is unit-tested without the UI.

---

## Connection-Completeness Gate

**FR12/D6 — sole access gate.** Pure helper `evaluateConnectionGate(userStatus, requiredPluginKeys): { enabled: boolean; perPlugin: Array<{key, connected}>; missing: string[] }`.

- `requiredPluginKeys` = the five Google Suite plugin keys (`google-drive`, `google-sheets`, `google-docs`, `google-mail`, `google-calendar`). These are the **v1 coverage set** (D2), sourced from a single named constant — not scattered literals — so extending coverage later is one edit. (This is v1 scoping, not per-plugin behavioral hardcoding; the form/gate logic itself stays schema-generic.)
- `enabled` iff every required key is in `userStatus.connected`.
- When disabled: render `ConnectionGatePanel` showing per-plugin connected state (reuse `getPluginStatus`), and a connect prompt per missing plugin (reuse `connectPlugin(userId, key)` → refresh status). No runnable form is exposed until all five are connected.
- When enabled: selector exposes exactly the connected Google Suite plugins.
- Empty userId (FR11): gate short-circuits to a "userId required" state; no status fetch, no Run.

Unit-tested in `connection-gate.test.ts`: all-connected → enabled; missing one → disabled + `missing` lists it; empty/parital status handled.

---

## FR8 Side Console Design

**Phase B, client-side Level 1 (SA Resolution 2). No backend change; no token on this path.**

- **State:** `useSideConsole` hook holds an in-memory, session-scoped array of `ConsoleEntry`. Not persisted beyond the session (v1).
- **Per-call entry** appended on each Run:
  ```typescript
  interface ConsoleEntry {
    id: string;
    timestamp: string;
    userId: string;               // active userId at run time (FR8 scoping)
    plugin: string;
    action: string;
    request: Record<string, unknown>;   // assembled parameters sent
    response: unknown;                    // normalized ExecutionResult (data or error)
    outcome: 'success' | 'error';
    durationMs: number;
  }
  ```
- **Accumulates chronologically** across runs (newest first or appended list — SA/Dev detail; propose newest-first).
- **Expandable & copyable:** each entry expands to full request/response JSON with copy-to-clipboard (reuse existing `copyToClipboard` pattern).
- **Manageable:** clear-all button; **retention cap** most-recent-N (propose N=50, matching the page's existing `debugLogs` `slice(-49)` convention) to bound memory.
- **userId scoping:** entry records the userId it ran under; if userId changes mid-session, entries remain labeled with their originating userId.
- **Redaction (acceptance criterion even at Level 1):** the console renders only the assembled business-parameter request and the normalized `ExecutionResult`. **No `Authorization`/`Bearer` header, `access_token`, `refresh_token`, `client_secret`, or cookie is ever in scope on this path** (those live server-side inside the executor). A defensive client-side redaction pass over rendered entries is included as belt-and-suspenders, but the security guarantee is structural (Level 1 never receives secrets). Any future Level-2 raw path is gated by the F2 server-side redaction constraint — see risks.

---

## Task List

### Phase A — core tester (FR1–7, FR9–12)

- [x] ✅ A1: Created `lib/plugins/tester/tester-types.ts` (shared types; no `any`).
- [x] ✅ A2: Created `app/api/plugins/action-schema/route.ts` — Zod query schema, `createLogger` + correlationId, `PluginManagerV2` read, standard error envelope (F1). **UNAUTHENTICATED read-only per SA Q1 (CR3)** — metadata-only invariant documented in-code.
- [x] ✅ A3: Added integration test `action-schema/__tests__/route.test.ts` (happy single + all-actions; invalid query 400; unknown plugin 404; unknown action 404; metadata-only assertion). 7 tests pass.
- [x] ✅ A4: Added `getActionSchema(plugin, action?)` + `recordTesterAudit(...)` to `lib/client/plugin-api-client.ts`.
- [x] ✅ A5: Created `lib/plugins/tester/schema-to-form.ts` — `buildFormFields` + `getConfirmation` (pure). **CR1 folded in** — `getConfirmation` classifies confirm rules by CONDITION SHAPE (`isPresenceCheckCondition`): presence-check → blocking, threshold/boolean → advisory.
- [x] ✅ A6: Unit-tested `schema-to-form.test.ts` (all control types, required from `required_params`, enum, scalar-array, nested→json-subtree, x-dynamic-options→free-text). **CR1/CR5**: destructive classifier proven against the REAL definitions — 6 presence-check destructive actions block (see note); `list_files`/`read_file_content`/`read_range`/`send_email`/`list_events` do NOT block.
- [x] ✅ A7: Created `lib/plugins/tester/connection-gate.ts` + `connection-gate.test.ts` (FR12 logic; five-key constant; empty-userId short-circuit).
- [x] ✅ A8: Built `SchemaForm.tsx` (render descriptors; required validation surfaced; JSON sub-editor for complex subtrees; defaults/hints). Pure assembly/validation factored into `lib/plugins/tester/form-values.ts` (+ unit tests).
- [x] ✅ A9: Built `ConnectionGatePanel.tsx` (per-plugin state + connect prompts; userId-required state).
- [x] ✅ A10: Built `DestructiveConfirm.tsx` (renders presence-check confirm message; blocks Run until confirmed).
- [x] ✅ A11: Built `ResultView.tsx` (FR7 current-result render).
- [x] ✅ A12: Built `FormTester.tsx` container (selectors → form → confirm → Run via injected `executeAction` → result); advanced raw-JSON toggle (FR4) seeded from form assembly; template seed via `PARAMETER_TEMPLATES` (SA decision 4, convenience only).
- [x] ✅ A13: Mounted `FormTester` as a new **Form Tester** sub-mode inside the Plugins tab in `app/test-plugins-v2/page.tsx` (Classic raw-JSON preserved as the other sub-mode); empty-userId blocks Run (FR11).
- [x] ✅ A14: **(MANDATORY per CR2)** Per-execution audit via the **isolated** `POST /api/plugins/test-audit` endpoint (Zod+Pino+correlationId+envelope), `AuditTrailService.log` non-blocking; client calls it after each Run. Integration test added. Registered `PLUGIN_TESTER_EXECUTE` audit event. Accepted limitation (no verified operator identity) documented in-code.
- [x] ✅ A15: `docs/V2_TEST_PAGE_SCOPE.md` updated for the new mode.

### Phase B — side console (FR8)

- [x] ✅ B1: Created `hooks/useSideConsole.ts` (append/clear, retention cap N=50, userId scoping, redaction at capture).
- [x] ✅ B2: Built `SideConsole.tsx` (chronological newest-first entries, expand/copy/clear).
- [x] ✅ B3: Wired console into `FormTester` — one entry per Run; laid out beside the form.
- [x] ✅ B4: Added `hooks/useSideConsole.test.tsx` (append + cap + clear + userId + redaction) and `lib/plugins/tester/redaction.test.ts` (tokens/auth stripped — Phase B AC).
- [x] ✅ B5: **RTL component test is the CI gate (SA Q4)** — `components/test-plugins/tester/__tests__/FormTester.test.tsx` (render from schema → required block → destructive confirm gate → run → result + console entry). Live Playwright deliberately NOT written (real Google side effects).

### F3 — tracked security debt (CR4 — NOT fixed this cycle)

- [x] ✅ **RECORDED as tracked debt.** `app/api/plugins/execute/route.ts` was **NOT touched** this cycle (per user decision to leave it as tracked debt). Its 5 `console.*` calls were **NOT** converted (shared production route — needs explicit user sign-off per CLAUDE.md §Logging; user declined editing it this cycle). Its missing auth + missing Zod remain **open TL/SA-tracked security debt**. A follow-up task should be filed to (a) convert the 5 `console.*`→Pino and (b) scope auth+Zod as a separate cycle with regression testing for all callers (agent execution, orchestration, V6). The tester's per-execution audit was deliberately implemented as the isolated `test-audit` endpoint (CR2) so the feature ships without touching the shared route.

### Phase C — fast-follow (outline only; not implemented this cycle)

- [ ] C1: `x-dynamic-options` live pickers (fetch real folders/labels/calendars) via existing `fetch-options` route (D4).
- [ ] C2: Level-2 raw upstream HTTP envelope — **only** behind mandatory server-side redaction (F2). Requires executor test-mode capture; default OFF.

---

## Testing

Right-sized to the project testing standard (new API route → integration; pure helpers → unit; critical UI path → Playwright, with a lighter fallback proposed).

| Target | Type | Cases |
|---|---|---|
| `action-schema` endpoint | Integration (Jest) | Happy path (valid plugin[/action] → full schema block); invalid input (missing/empty `plugin` → 400 Zod); unknown plugin/action → 404. Mock `PluginManagerV2.getInstance()`. If SA requires `getUser`, add a 401 case. |
| `schema-to-form.buildFormFields` | Unit (Jest) | string→text, enum→dropdown, number+min/max, boolean+default, scalar-array, nested object→json-subtree, array-of-objects→json-subtree, `x-dynamic-options`→free-text, required from `required_params`. |
| `schema-to-form.getConfirmation` | Unit (Jest) | `delete_file` (confirm + destructive style), `revoke_access` (confirm via `confirmations`, capability `update`, still gated), non-destructive action (no confirm), threshold `large_list` (confirm fires — acceptable). |
| `connection-gate.evaluateConnectionGate` | Unit (Jest) | all five connected → enabled; missing one → disabled + `missing`; empty status → disabled. |
| `useSideConsole` | Unit (Jest) | append appends; cap bounds to N; clear empties; entry carries active userId. |
| Critical UI path | Playwright (proposed) | Select plugin → action → fill form → Run → see result + console entry. **Flag:** if the repo's Playwright setup requires live OAuth'd Google connections it becomes heavy/flaky (real side effects, real accounts). **Lighter alternative:** a component/integration test (React Testing Library) driving `FormTester` with a mocked `executeAction` + mocked `getActionSchema`, asserting form render, required-validation block, confirm-gate on a destructive action, and a console entry appended. Recommend the lighter alternative for CI; leave Playwright as a manual/optional smoke. **SA to confirm** which is required for the QA gate. |

QA gate minimum (per CLAUDE.md): happy path + one failure path covered — met by the endpoint integration test (happy + 400/404) and the helper unit tests.

---

## Standards & Risks (F1/F2/F3/F5)

| Flag | Handling in this workplan |
|---|---|
| **F1 (High)** | New `action-schema` endpoint: **Zod** on query params, **Pino `createLogger`** + `child({ correlationId })`, standard success/error envelope, `NODE_ENV` guard on error details. Read-only → no repository, no audit. ✅ Baked into task A2. |
| **F2 (High)** | v1 (Level 1 console) carries **no secret by construction** — the client only ever sees assembled business params + normalized `ExecutionResult`. **Any future Level-2 raw-capture path (Phase C) MUST redact server-side, inside the executor/route boundary, before the response leaves the API** (strip `Authorization`/`Bearer`, `access_token`, `refresh_token`, `client_secret`, cookies). Recorded as a hard constraint on C2; a defensive client-side redaction pass is added at Level 1 as belt-and-suspenders only. |
| **F3 (Medium, pre-existing)** | **Confirmed:** `app/api/plugins/execute/route.ts` — **5 `console.*` calls** (lines 27, 57, 68, 84, 129), **no auth/`getUser`**, **no Zod** (manual field checks), service-role execution path. This feature **builds on this route but does not substantially modify it in Phase A** (execution behavior unchanged). Per CLAUDE.md §Logging + Mandatory Rule 3: **flag to TL/user** — propose Pino conversion of the 5 `console.*`; **escalate the missing auth/Zod as security debt** for TL/SA to scope as a separate item. **Do NOT silently extend or half-fix.** Whether to fix any of it in this cycle is [Open Question Q3](#open-questions-for-sa). Note: `page.tsx` also contains stray `console.log` DEBUG lines (e.g. lines 1070/1072) in a token-refresh path I am not otherwise changing — I will not reformat that unrelated code; if the tester wiring lands in the same function region I'll flag those specific lines rather than bulk-convert. |
| **F4** | Superseded by D6 — connection-completeness is the sole gate (see [gate design](#connection-completeness-gate)). Accepted-risk recorded in the requirement. Not re-raised. |
| **F5 (Medium)** | Form generation, gate, and destructive detection all read the plugin definition schema — **no per-plugin/per-action hardcoding**. Confirm gate keys on `rules.confirmations`. The only plugin-key literals are the D2 v1-coverage constant (five Google keys), isolated in one named constant and clearly a scope boundary, not behavioral branching. |

**Accepted-risk note (recorded, from requirement):** the tester runs real, irreversible actions against real customer Google accounts on behalf of any client-supplied `userId` that has the five plugins connected, with no admin/env gate; FR8 surfaces that account's request/response. Knowingly accepted by the user (2026-07-27). `.eq('user_id', userId)` scoping and F2 redaction remain mandatory.

**Optional hardening (SA a/b/c — non-blocking):** I recommend **(a) per-execution `AuditTrailService` entry** on Run (`{ operatorContext, targetUserId, plugin, action, outcome }`, non-blocking `.catch()`) as the lowest-cost traceability win (task A14, gated on Q2). (b) cross-account warning banner and (c) non-production default of the entry point are listed but not planned unless requested.

---

## Open Questions for SA

1. **Auth on the new `action-schema` endpoint?** The precedent `schema-metadata/route.ts` requires `getUser`, but the current `/test-plugins-v2` page is fully unauthenticated and `GET /api/plugins/execute` already exposes `parameters` unauthenticated. F1 mandates Zod+Pino+envelope but not auth. Should the new endpoint (a) require `getUser` (consistent with `schema-metadata`, but would need the test page to be authenticated), or (b) stay unauthenticated read-only metadata (consistent with the existing execute GET and the D6 no-admin-gate decision)? **Dev recommendation: (b)** — it's non-sensitive plugin metadata and matches the page's current auth posture; revisit if the page is ever locked down.
2. **Include optional hardening (a) — per-execution audit entry — in Phase A?** Recommended and cheap. Include as task A14, or defer? (Needs SA/user nod.)
3. **F3 scope:** in this cycle, do we (i) leave `/api/plugins/execute` untouched and only file the security-debt item, (ii) convert just the 5 `console.*` to Pino (logging-standard cleanup, no behavior change), or (iii) also add Zod+auth (larger, changes behavior/coupling for other callers)? **Dev recommendation: file the debt item now; optionally do (ii) if the user approves the Pino conversion; treat (iii) as a separate TL-tracked cycle** to avoid regressing other callers of the shared execute route.
4. **Playwright vs lighter component test** for the critical UI path (see Testing) — which satisfies the QA gate, given live Playwright would hit real Google side effects?
5. **JSON sub-editor seeding:** seed complex subtrees from `PARAMETER_TEMPLATES` (existing, hand-maintained) or from the schema `default` only? Templates give better DX but reintroduce a hand-maintained source. **Dev leaning: schema `default` first, fall back to `PARAMETER_TEMPLATES` when no default** — confirm acceptable.

---

## CRITICAL bug fix — form discarded typed input, sent template seed (2026-08-03, for SA re-review)

**Symptom (live, user's Gmail + dev.log):** typed real addresses for `google-mail send_email`, but the email went out with the `PARAMETER_TEMPLATES` placeholders `recipient@example.com` / `cc@example.com`.

**Root cause (traced + confirmed):** `page.tsx` passed `<FormTester>` INLINE arrow-function props (`getActionSchema`, `executeAction`, `recordAudit`, `onConnect`, `onRefresh`, `onRefreshAll`) → new identity every render. FormTester's schema-load `useEffect` depends on `[selectedPlugin, getActionSchema]` → re-fired every render → refetched → `setActionSchemas(new array)`. A real fetch JSON-parses a fresh schema object, so `activeSchema` (`useMemo find`) got a new identity → the seed `useEffect` (keyed on `[activeSchema]`) re-ran → `setValues(seedInitialValues(...))` **overwrote the user's typed input with the template seed**. Run then sent the template. RTL missed it because the mocks were stable-identity.

**Fix (both trigger + robustness):**
1. **page.tsx — stabilized the callback props.** `getActionSchema` / `executeAction` / `recordAudit` wrapped in `useCallback([apiClient])`; the connect/refresh trio wrapped via a latest-`useRef` (`testerHandlersRef`) + `useCallback([])` so identities stay stable without going stale. This stops the load effect from re-firing every render.
2. **FormTester — seed-key guard (essential robustness).** The seed effect now tracks the last-seeded `${plugin}/${action}` in a `useRef` and only (re)seeds when that key actually changes — i.e. only when the user selects a DIFFERENT action, NEVER on a same-action background re-fetch. So typed input survives re-renders/refetches regardless of prop stability.

Net: once the user edits any field, their value persists through re-renders and background re-fetches, and Run sends exactly what's in the form (template only if untouched).

**Regression test added** (`FormTester.test.tsx` — "preserves user-typed nested input through a background re-fetch"): reproduces the real-page condition — an UNSTABLE `getActionSchema` (new arrow + fresh cloned schema each call) with a template placeholder for the nested `recipients.to` (the reported case); user edits the field, a parent re-render triggers a background refetch, then asserts the edited value PERSISTS and `executeAction` is called with `{ recipients: { to: ['me@myreal.com'] } }` — not the placeholder. **Verified it FAILS without the seed-key guard** (`Received: "recipient@example.com"`) and **passes with it**. 106 tester tests pass; feature files `tsc`-clean; no new `console.*`; `execute/route.ts` untouched.

## Post-review addition — token refresh in the connection panel (2026-07-28, for SA re-review)

User request: let the Form Tester connection panel refresh expired tokens without a full OAuth reconnect, reusing the existing `refreshPluginToken` path. Keeps the 9 tester suites green (**103 tests**) and feature files `tsc`-clean.

- **Per-plugin "Refresh token"** on each ⚠ EXPIRED plugin → new `onRefresh?: (key) => void` prop (FormTester → ConnectionGatePanel), wired in `page.tsx` to the existing `refreshPluginToken(key)` (simple `POST /api/plugins/refresh-token`, no OAuth popup). Genuinely DISCONNECTED plugins keep the full-OAuth **Connect** button; expired-but-refreshable get **Refresh token**.
- **"Refresh all tokens (N)"** shown when ≥1 required Google Suite plugin is expired → new `onRefreshAll` prop. `page.tsx`'s `refreshAllExpiredTokens` filters `REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS` by `userStatus.active_expired` (F5 — iterates the required-keys list, no hardcoding) and calls the new pure helper `runSequentialRefresh(keys, refreshOne, onProgress)` which awaits each `refreshPluginToken(key)` **one by one**. Since `refreshPluginToken` re-syncs `userStatus` after each, the panel goes green live. A `refreshAllProgress` state drives the button label "Refreshing google-drive… (2/3)".
- **Failure handling:** `runSequentialRefresh` catches a failing key, continues the rest (doesn't wedge), and returns the failed keys. All connect/refresh buttons disable while `connectDisabled` (reuses the page's in-flight `isLoading`).
- **Scope call for SA:** "Refresh all" is scoped to the panel's required Google Suite set (the gating keys), NOT all expired plugins system-wide — flagged per instruction; this is the default the panel gates on.
- Reuses the page's single `userStatus`/`loadUserStatus` (no forked fetch). No new `console.*`; `execute/route.ts` untouched.
- Tests added: `ConnectionGatePanel.test.tsx` (Refresh on expired / Connect on disconnected / refresh-all visibility + progress + disabled); `runSequentialRefresh` unit tests (sequential ordering, progress, continue-past-failure); FormTester RTL expired scenario (per-plugin refresh + refresh-all fire).

**SA must-fix RESOLVED (2026-07-28) — dead-refresh-token dead-end.** SA verified that a genuinely DEAD refresh token is unrecoverable: `user-status` keeps the plugin in `active_expired` (the connection row survives), `refresh-token` pushes it to `failed[]` without deleting the row, so the panel offered only "Refresh token" (which keeps failing) and never revealed the full-OAuth path (gated on `!connected && !expired`) → gate locked forever. **Fix:** the ⚠ expired state now shows BOTH the primary **Refresh token** (simple, common case) AND a secondary **Reconnect (OAuth)** escape hatch wired to the existing full-OAuth `onConnect`/`connectPlugin` path — so a dead token is always recoverable. Every state now has a forward path: connected → none; expired → Refresh + Reconnect; disconnected → Connect. F5-generic (iterates required-keys, no per-plugin logic). Tests updated to assert both buttons on expired and that Reconnect triggers the OAuth connect path; added a no-dead-end assertion. 105 tester tests pass; feature files `tsc`-clean; no new `console.*`; `execute/route.ts` untouched.

## Post-review live-testing fixes (2026-07-28 — for SA re-review)

Two fixes from the user's live testing of the Form Tester. Both keep the 8 tester suites green (now **92 tests**) and the feature files `tsc`-clean.

**Fix 1 — Connection panel now aligns with User Configuration (incl. expired state).**
- Root cause found: the gate only considered `userStatus.connected` and treated everything else as a bare ✗. A plugin sitting in `userStatus.active_expired` (connected but token expired) therefore showed ✗ and never matched the User Configuration section, which reports connected / **expired** / disconnected separately. There was also no re-sync when the OAuth popup/redirect returned focus (a connect that resolves early, or a missed popup message, left the panel stale).
- Changes: `evaluateConnectionGate` now takes `active_expired`; a required plugin is "genuinely connected" only when in `connected` AND not expired. `ConnectionGateResult`/`PluginGateState` gained `expired`; `ConnectionGatePanel` renders three states aligned with User Configuration (✓ connected / ⚠ expired — "Reconnect" / ✗ not connected). The page passes `active_expired` into `FormTester` and re-fetches `loadUserStatus()` on window `focus`/`visibilitychange` (single source of truth — no forked status fetch). Expired keeps the gate locked (an expired token is not runnable).

**Fix 2 — Default form is now 100% free-text/simple inputs (NO JSON) — reverses SA Resolution 3.**
- The user (product owner) rejected the scoped JSON sub-editor. The default form now decomposes every shape into plain labeled inputs, mapped back into the correct nested payload on submit:
  - **Nested objects** → a titled group of flattened labeled inputs (e.g. `start` → "Date Time" + "Time Zone"), reassembled into the nested object.
  - **Arrays of objects** → an **add row / remove row repeater** of flattened item inputs (e.g. `attendees`, `reminders.overrides`, `working_hours.windows`).
  - **2-D matrices** (Sheets `values`) → a repeater of comma-separated rows, reassembled into `[[...]]`.
  - Scalars / enums / booleans / scalar-arrays unchanged. `x-dynamic-options` still labeled free-text.
- Implementation: descriptors are now a recursive tree (`children` for objects, `itemFields` for object-arrays) carrying a `path`; `form-values.ts` holds nested values mirroring the payload and reassembles via a recursive coercer + `getByPath`/`setByPath`; `SchemaForm.tsx` is a recursive path-based renderer. The **Advanced (raw JSON)** toggle remains as the power-user escape hatch (JSON only there).
- **SA to scrutinize:** (a) the SA-Resolution-3 reversal itself; (b) required-validation semantics for composites — a fully-empty required object reports the object (`start`), a partially-filled one reports the specific missing leaf (`start.date_time`); a required object-array needs ≥1 row; (c) booleans always emit their value (incl. `false`), consistent with the existing top-level behavior, so object-array rows include default `false` booleans; (d) a blank object-array row (only default booleans, no other content) is dropped on assemble. No pathological shape (array-of-arrays-of-objects) exists in the Google Suite set, so no JSON fallback is triggered; an unknown array shape falls back to a scalar-array free-text input, never JSON.

## Dev Implementation Notes (for SA code review)

**CR1 classifier resolves to SIX presence-check destructive actions, not five.** The condition-shape classifier (`isPresenceCheckCondition` → `getConfirmation`) blocks on `<field> != null` / `== null` conditions. Verified against the real definitions, this class is: `google-drive.delete_file` (`file_id != null`), `google-drive.revoke_access` (`file_id != null`), `google-sheets.clear_range` (`spreadsheet_id != null`), `google-sheets.delete_rows` (`spreadsheet_id != null`), `google-mail.delete_label` (`label_id != null`), **and `google-calendar.delete_event` (`event_id != null`)**. The SA's CR1 enumeration named "exactly 5" and omitted `delete_event` — but `delete_event` is genuinely destructive ("This action cannot be undone") and carries a presence-check confirm, so the **generic** classifier correctly blocks it. This is F5-correct behavior (no hardcoded action list); the "exactly 5" was an enumeration oversight, not a classifier bug. Unit test `getConfirmation — CR1: destructive actions BLOCK` asserts all six block; `threshold actions do NOT block` asserts `list_files`/`read_file_content`/`read_range`/`send_email`/`list_events` do not. **SA: please confirm blocking `delete_event` is acceptable (it is the safe default).**

**Test toolchain added.** RTL was entirely absent from the repo. Added devDependencies `@testing-library/react@16`, `@testing-library/dom@10`, `@testing-library/jest-dom@6`, `@testing-library/user-event@14`, `jest-environment-jsdom@29` (installed with `--legacy-peer-deps` due to the repo's `canvas@3` vs jsdom's `canvas@2` peer). Changed `jest.config.js` transform `jsx: 'react'` → `jsx: 'react-jsx'` (automatic runtime, matches Next 14) so component tests don't need `import React`; backward-compatible, verified no regression on the two existing route test suites.

**Not touched:** `app/api/plugins/execute/route.ts` (CR4). No new `console.*` introduced anywhere; server code uses Pino `createLogger`, client components use the page's existing `clientLogger`/`addDebugLog` approach.

## SA Review Notes

_[SA will populate this section.]_

## SA Workplan Review

**Reviewed by SA — 2026-07-27**
**Status:** 🔄 Changes Required (fold in CR1–CR5, then proceed to implementation — no second workplan gate; CR1 approach re-checked at code review). Scope of this verdict: Phase A + Phase B. Phase C stays outline.

Ground-truth verified against code: `execute/route.ts` (F3 finding confirmed — 5 `console.*`, no `getUser`, no Zod, service-role via `PluginExecuterV2`), `schema-metadata/route.ts` (getUser + Pino + envelope precedent), `available`/`user-status` routes (both **unauthenticated**, `user-status` reads client-supplied `userId` from query), `base-plugin-executor.ts` (computes `confirmations_required` via `validateActionParameters`, only logs "would be handled via UI" — confirms no executor change needed), and all five `google-*-plugin-v2.json` definitions.

### Decisions on the 5 Open Questions

**Q1 — Auth on `GET /api/plugins/action-schema`: (b) UNAUTHENTICATED read-only. Approved.**
The endpoint returns only plugin-definition metadata (schemas, `rules`, `required_params`, `capability`, `idempotent`, `output_schema`) — no user data, no connections, no tokens. It is a strict superset of what the already-unauthenticated `GET /api/plugins/execute?plugin=X` returns today. The entire `/test-plugins-v2` surface (`available`, `user-status`, `execute`) is unauthenticated and client-`userId`-driven, and D6 consciously declined an auth gate. Requiring `getUser` here would gate harmless read metadata while live execution stays wide open — incoherent security theater. `schema-metadata`'s `getUser` is **not** a binding precedent (it is reached from authenticated app flows, not this test page). F1 mandates Zod + Pino `createLogger` + `correlationId` + standard error envelope — **not** `getUser`. **Ruling:** no `getUser`; Zod + Pino + correlationId + envelope mandatory. Record a **metadata-only invariant** in the route comment: if this endpoint is ever extended to return anything user-scoped, auth must be revisited.

**Q2 — Per-execution AuditTrail in Phase A: YES — make A14 MANDATORY (not optional).** Given the accepted cross-user-exposure risk (the tester runs real, irreversible actions against any `userId`'s real Google account with no auth gate), a per-execution audit entry is the single cheapest control that directly offsets that risk — it converts "no record" into "there is a record that account X had action Y run via the tester at time T with outcome Z." It adds no gate and no friction (`.catch()` non-blocking). **Placement constraint (important):** do **NOT** implement it by editing the shared `/api/plugins/execute` route in Phase A (that couples to F3 and to the shared-route sign-off — see Q3). Implement it as an **isolated dedicated server endpoint** the tester calls after each Run (e.g. `POST /api/plugins/tester-execution-audit`), Zod-validated + Pino + `AuditTrailService.log({ action: 'PLUGIN_TESTER_EXECUTE', targetUserId, plugin, action, outcome, durationMs }).catch(...)`. **Accepted limitation to record:** because the page is unauthenticated, the entry captures `targetUserId` (the account acted upon) but **cannot** capture a verified operator identity — that is a direct consequence of the accepted F4 risk, and the entry still provides the "which account, what action, what outcome" traceability that matters. The server-side audit-in-execute-route remains the correct long-term home and should ride the future F3 remediation cycle.

**Q3 — F3 scope this cycle: (ii) convert the 5 `console.*` to Pino (contingent on USER sign-off), file auth+Zod as tracked security debt, do NOT add auth/Zod now.** The execute route is a **shared production route** — it is called by real agent execution, orchestration, and V6 paths, not just this tester. Adding Zod+auth (option iii) changes its input contract/behavior and risks regressing those callers; that must be a **separate TL-tracked security-debt cycle** with its own regression testing, not bundled into a UI feature. The `console.*`→Pino conversion (option ii) is a pure, non-behavioral logging-standard cleanup and is the right thing to do — **but because it edits a shared production route file, it needs explicit USER sign-off** before Dev touches that file (per CLAUDE.md §Logging "proceed once the user approves"). With the Q2 audit implemented as an isolated endpoint, the feature does **not** otherwise touch `execute/route.ts`, so if the user declines, the `console.*` conversion + auth/Zod both stay as **one explicitly recorded, TL-tracked security-debt item** — this escalation must be **recorded (a tracked entry), not half-done**.

**Q4 — RTL component test is the CI QA gate; Playwright live smoke is optional/manual. Approved.** Live Playwright would send real emails / delete real files against real Google accounts — unacceptable in CI (destructive, flaky, needs OAuth'd fixtures). The QA gate (happy + one failure path) is met by: the `action-schema` integration test (happy + 400/404), the pure-helper unit tests, and **one RTL component test** driving `FormTester` with mocked `getActionSchema` + mocked `executeAction`, asserting: form renders from schema, required-validation blocks Run, destructive confirm gate blocks until confirmed, result renders, one console entry appended. Playwright stays an optional manual smoke against a throwaway account — **not** a CI gate.

**Q5 — JSON sub-editor seeding: schema `default` first, fall back to `PARAMETER_TEMPLATES`. Approved with amendment.** Schema `default` keeps the form schema-driven (definition = source of truth); `PARAMETER_TEMPLATES` is a pragmatic DX fallback. **Amendment:** `PARAMETER_TEMPLATES` is a pure *convenience seed* only — never a validation source. When neither a `default` nor a template exists, seed an **empty scaffold derived from the subtree schema** (`{}` / `[]` / typed skeleton), never a blank editor. Required-field validation must key off descriptors/`required_params`, not the template, so a missing template can never block Run and a non-Google plugin with no templates still seeds correctly.

### Per-area validation verdicts

1. **Phase A scope as first slice — ✅.** End-to-end usable (form + live run + result + gates); matches SA A/B/C phasing with the FR12 gate replacing the F4 admin gate.
2. **New endpoint contract + F1 compliance — ✅** with Q1 folded (no `getUser`; Zod + Pino + correlationId + envelope; 400 on invalid `plugin`, 404 unknown plugin/action, `NODE_ENV`-guarded details).
3. **schema→form as pure testable helper — ✅.** `buildFormFields` / `getConfirmation` factored out of React/fetch — correct.
4. **Destructive detection keyed on `rules.confirmations` — ⚠️ CR1 (Change Required).** Verified in code: a bare "any `rules.confirmations[*].action === 'confirm'`" signal fires on **nearly every action**, not "some" — `read_range` (`estimated_cells > 1000`), `list_files` (`max_results > 50`), `list_events` (`max_results > 500`), `create_event`, `insert_text`, `append_text`, `send_email`, `write_range`, `create_document`, etc. all carry threshold `confirm` rules. Applied literally, the "destructive confirm gate" becomes an **always-on** gate, diluting FR6 and inducing confirm-fatigue (users click through reflexively → the safety signal is lost). The data shows a clean structural split: **destructive confirms use presence-check conditions** (`file_id != null`, `spreadsheet_id != null`, `label_id != null` — effectively unconditional) while **threshold confirms use numeric comparisons** (`>`, `<`, `>=`, `<=`). **Ruling:** the *blocking* confirm gate fires only on the **unconditional/presence-check** class (which is exactly the 5 destructive actions: `delete_file`, `revoke_access`, `clear_range`, `delete_rows`, `delete_label`); threshold confirms are **advisory** (omit in v1, or render as a non-blocking notice). This is a static classification of the condition's **shape** (presence-check vs numeric-threshold) — **not** runtime evaluation of the condition against form values, so it does not reintroduce the fragile-evaluation problem the requirement's Resolution 1 warned against; it refines "presence is sufficient" now that full ground-truth shows threshold confirms are near-universal, not rare. It stays F5-schema-generic (reads condition shape, no action-name list) and is unit-testable. If product instead wants an always-on confirm on every action, that is an explicit UX product call — but destructive-only via this classification is the safe default and my recommendation.
5. **FR12 connection gate reads status generically — ✅.** Pure `evaluateConnectionGate`, five-key coverage constant isolated in one named constant (scope boundary, not behavioral hardcoding).
6. **Nested inputs → JSON sub-editor + raw-JSON advanced escape hatch — ✅.** Matches Resolution 3; confirmed no `oneOf`/`anyOf`/`allOf`/`$ref` in the Google definitions, so single-pass generator + sub-editor suffices.
7. **FR8 side console = client-side Level 1, no token on path, redaction AC carried — ✅.** Structural guarantee (client only ever holds assembled params + normalized `ExecutionResult`) is sound; defensive client redaction as belt-and-suspenders is fine; F2 server-side constraint correctly carried onto any future Level-2 (C2).
8. **Standards — ✅** with fold-ins: endpoint Zod+Pino+correlationId+envelope+no secrets (Q1); the **new audit endpoint (Q2) must also be Zod+Pino+envelope**; no per-plugin hardcoding (F5) holds, including the CR1 refinement; `'use client'` component pattern correct; no direct Supabase — read-only endpoint needs no repository (confirmed), and `AuditTrailService` (not a repo) is the right channel for the audit entry (no persistence layer added → no repo-pattern flag).
9. **F3 surfaced, not silently extended — ✅ / ⚠️ CR4.** Surfaced correctly. Requirement: the auth+Zod gap must be recorded as an **explicit, tracked TL security-debt item** (not just prose in the risk table) and the `console.*`→Pino path resolved per Q3 (with USER sign-off if the shared route is edited). Escalation must be recorded, not half-done.
10. **Testing right-sized — ✅ / ⚠️ CR5.** Add: (a) destructive-detection unit tests must now cover the **threshold-vs-destructive classification** — `read_range`/`list_files`/`list_events` MUST NOT trigger the blocking gate; `delete_file`/`revoke_access`/`clear_range`/`delete_rows`/`delete_label` MUST; (b) the new audit endpoint (Q2) needs its own integration test (happy + invalid input).

### Change-requests the Dev must fold in

- **CR1 (Destructive detection — substantive):** refine `getConfirmation` to classify confirm rules by condition shape; **blocking** confirm only for unconditional presence-check confirms; threshold confirms advisory/omitted (Tasks A5/A6 + tests).
- **CR2 (Audit — Q2):** make A14 **mandatory**; implement via an **isolated** Zod+Pino audit endpoint calling `AuditTrailService` non-blocking; do **not** edit the shared execute route for it in Phase A. Add its integration test.
- **CR3 (Q1):** `action-schema` endpoint unauthenticated read-only; Zod+Pino+correlationId+envelope; document the metadata-only invariant in-code.
- **CR4 (F3/Q3):** record the execute-route auth+Zod gap as an explicit TL-tracked security-debt entry; the `console.*`→Pino conversion only with USER sign-off (shared prod route); do **not** add auth/Zod this cycle.
- **CR5 (Tests):** add the threshold-vs-destructive classification cases and the audit-endpoint integration test (per verdict 10).

### Needs USER sign-off before Dev edits it (business terms)

1. **Editing the shared `/api/plugins/execute` route.** Any change to that file — the `console.*`→Pino logging cleanup, or (not recommended for this cycle) adding a generic execution audit there — modifies a **production route that real agent execution, orchestration, and V6 rely on**, not just this tester. It needs an explicit user OK before Dev touches it. If the user prefers to keep the tester fully isolated, the audit rides a **separate dedicated endpoint** (CR2) and the execute route's `console.*` + missing auth/Zod stay as one **recorded, TL-tracked security-debt item** — the feature ships without touching the shared route.
2. **(Minor, product UX)** Whether the blocking confirm should be **destructive-only** (SA-recommended, via CR1) or **on every action** (always-on). Not a blocker — CR1 is the safe default — but a genuine UX product call if the user wants it different.

### Verdict

**Changes Required (Phase A + B).** Approve the architecture and phasing; Dev may proceed on all Phase A/B tasks **folding in CR1–CR5**. No second workplan-review gate — CR1's classification approach will be re-checked at code review. Phase C stays outline. **Item 1 above (shared execute-route edit) must get USER sign-off before that file is touched**; the core feature is designed to ship without it.

## SA Code Review

**Code Review by SA — 2026-07-28**
**Scope:** Phase A + Phase B only (Phase C stays outline). Reviewed the working-tree diff on `feature/plugin-api-tester-ui`; pre-existing unrelated dirty files ignored per brief.
**Status:** 🔄 One Fix Required (mechanical, log-only) then ✅ Code Approved for QA. The feature logic, endpoints, security, and tests are approved as-is; the single Fix-Required item is the 14× TS2769 in `lib/client/plugin-api-client.ts` (see Addendum below) — a touched file with a feature-introduced error, so it must be corrected before QA. Other nice-to-haves do not gate QA.

Ground-truth verification done in-review: enumerated every `rules.confirmations[*].condition` across all five Google defs; ran the full 152-file Jest suite; proved the pre-existing suite failures are independent of this branch by re-running representative suites against the baseline `jest.config`; ran all 8 new tester suites (87 tests, green).

### Per-area verdicts

1. **CR1 destructive classifier — ✅ Correct. RULING: block `delete_event` (6, not 5) is right.**
   `isPresenceCheckCondition` uses `^\s*[A-Za-z_][\w.]*\s*(!=|==)\s*null\s*$` — a static shape match, no runtime evaluation (does not reintroduce the fragile-evaluation risk Resolution 1 warned against). Verified against the definitions: there are **exactly 6** presence-check (`!= null`) confirm conditions, on `delete_file`, `revoke_access` (drive), `clear_range`, `delete_rows` (sheets), `delete_label` (mail), `delete_event` (calendar) — every one genuinely irreversible. **No false positives** (no presence-check condition sits on a non-destructive action). Threshold (`>`, `<`, `>=`, `<=`), boolean (`== true`), and compound (`&&`) conditions all correctly fall through to advisory. `delete_event` carries `event_id != null` and is genuinely irreversible ("cannot be undone"); the F5-generic classifier **must** block it — special-casing it *out* to match the SA's original "exactly 5" enumeration would be the hardcoding anti-pattern. The SA's "5" was an enumeration oversight; the classifier is correct. `schema-to-form.test.ts` proves all 6 block and `list_files`/`read_range`/`send_email`/`list_events` do not, **loading the real definition JSON** (not fixtures) — robust regression coverage (CR5 met).
   - *Residual caveat (nice-to-have, non-blocking):* the gate keys on the *presence* of a confirm rule. A genuinely destructive action authored with **no** confirmation entry would not be gated (false-negative by omission). That is a definition-authoring concern, not a classifier bug; acceptable for v1. One-line note worth carrying.

2. **New endpoints F1 + security — ✅ No secrets leak.**
   - `action-schema`: Zod query, `createLogger`+`child({correlationId})`, standard envelope, `NODE_ENV`-guarded details, 400/404/500 paths. `projectAction` hand-picks only metadata fields (`description`, `parameters`, `required_params`, `optional_params`, `capability`, `idempotent`, `rules`, `output_schema`) — no user data, connections, or tokens. Metadata-only invariant documented in-code; route test asserts response keys exclude `access_token`/`connection`. Unauthenticated posture matches CR3. ✅
   - `test-audit`: Zod body, Pino+correlationId, envelope, `AuditTrailService.log(...).catch(...)` non-blocking, records only `{targetUserId, plugin, action, outcome, durationMs, source}` — no params/tokens. Accepted "no verified operator identity" limitation documented. ✅
   - *Nice-to-have:* `test-audit` is an **unauthenticated write** surface accepting a client-supplied `targetUserId` — an audit-row-injection/pollution vector (bounded: fixed event type, non-sensitive fixed-shape fields, no secret exposure). Consistent with the accepted F4/D6 unauthenticated posture, but unlike the read-only `action-schema` it *writes*. Record as a known limitation; consider non-prod-only or lightweight rate-limiting in a follow-up.

3. **CR4 — execute route untouched — ✅.** `app/api/plugins/execute/route.ts` is not in the diff at all. Its 5 `console.*` + missing auth/Zod remain tracked security debt exactly as agreed.

4. **No new `console.*` — ✅.** Grep across all created/modified files: zero `console.*` calls. Server uses Pino; client uses the existing `clientLogger`. (The lone "console" token is the word "side console" in a comment.)

5. **Redaction (F2 AC) — ✅.** `redactSensitive` runs at **capture** inside `useSideConsole.append` over both `request` and `response`; covers credential-shaped keys (authorization/bearer/access·refresh·id-token/client_secret/api_key/secret/password/cookie) and value shapes (`Bearer …`, `ya29.…`, JWT `eyJ…`); depth-bounded, non-mutating. Level-1 is secret-free by construction anyway; this is sound belt-and-suspenders. No path by which a token reaches the console un-redacted.

6. **Connection gate (FR12) — ✅.** `REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS` is a single named constant (one clear place); `evaluateConnectionGate` is pure, generic, empty-userId short-circuits (FR11). No per-plugin behavioral branching.

7. **Schema→form mapping — ✅.** Control selection correct (string→text/enum, number+min/max, boolean, scalar-array, object/array-of-objects/unknown→json-subtree escape hatch); required keys off `required_params` (authoritative even when empty) with schema-`required` fallback; `x-dynamic-options`→labeled free-text; seed order default→template→schema scaffold (never blank), template convenience-only, never a validation source (Q5 honored).

8. **Jest/RTL toolchain — ✅ Acceptable; QA does NOT need to chase the pre-existing red.**
   The global `jsx: 'react'`→`'react-jsx'` change is backward-compatible. **Proven, not assumed:** the full suite shows 21 failed suites / 129 failed tests, but re-running representative failing suites (`featureFlags`, `plugin-definitions`, `ConditionalEvaluator`) against the **baseline** `jest.config` reproduces the identical failures — they are pre-existing (flag/env assertions, timeouts, V6 logic) and unrelated to this branch. All 8 new tester suites pass (87 tests). Only the one RTL file opts into jsdom via a `@jest-environment jsdom` docblock; the rest stay `node`. RTL/jsdom deps are dev-only. *Nice-to-have:* `jest-environment-jsdom@^29` is version-skewed against `jest@^30` core — it works (the jsdom test passes) but pinning to `@30` would remove the skew. **Guidance for QA:** the repo suite is already red on baseline, so a naive "full suite green" gate is unachievable and out of scope — QA should gate on the **scoped tester suites (all green)** and treat the pre-existing failures as out-of-scope debt, not a regression from this cycle.

9. **page.tsx integration — ✅.** New `pluginTabMode` sub-mode switch; the entire Classic raw-JSON block is preserved intact, wrapped under `pluginTabMode === 'classic'`. Reuses existing `userId`/`userStatus`/`connectPlugin`/`executeAction`/`PARAMETER_TEMPLATES`. `'use client'` boundaries correct (`FormTester` and children declare it; host page already client). No regression to existing behavior. (Default sub-mode is `form` — a deliberate UX choice.)

10. **Standards — ✅ with minor notes.** No direct Supabase (audit via `AuditTrailService` singleton — correct channel, no new DB access to route through a repository). No per-plugin hardcoding (F5) beyond the isolated coverage constant. Component/DI patterns clean. *Nice-to-have:* the two new `plugin-api-client.ts` methods use `actions: any[]` / `error: any` without the CLAUDE.md §6 justifying comment — but this matches the surrounding file, which is uniformly `any`-typed, and the tester's own typed boundary (`ActionSchema`) is enforced in `FormTester`. The flagged `clientLogger` overload warnings are pre-existing to that file, not introduced here. Non-blocking.

11. **FormTester DI design — ✅.** Injected `getActionSchema`/`executeAction`/`recordAudit` is clean and proportionate — it is exactly what makes the RTL CI gate possible without live Google calls; the page wires the real `apiClient`. Not over-engineered.

### Must-fix (blocking)
- **None.**

### Nice-to-have (non-blocking; may defer)
1. `test-audit` unauthenticated write accepting client-supplied `targetUserId` — record as a known limitation; consider non-prod gating / rate-limit in a follow-up.
2. CR1 residual: destructive action authored with no confirm rule would not be gated (definition-authoring caveat) — carry as a one-line note.
3. Pin `jest-environment-jsdom` to `^30` to remove the jest-core version skew.
4. Add §6 justifying comments (or tighten types) on the two new `any`-typed client methods if the file is ever de-`any`-ed.

### Code Approved for QA: **Yes** (Phase A + B)
QA gate = the scoped tester suites (endpoint integration happy+400+404, pure-helper units incl. the CR1 threshold-vs-destructive matrix, `useSideConsole`/redaction, and the `FormTester` RTL path). Pre-existing repo-wide test failures are out of scope for this cycle.

### Addendum — `plugin-api-client.ts` 14× TS2769 (upgraded to Fix Required)

On re-examination this is **not** a pre-existing warning to wave through — one of the 14 (`line 228`, `getActionSchema`) was **introduced by this feature**, and two more feature calls (`245`, `267`) follow the same broken pattern but compile by luck. Upgrading to **🔄 Fix Required** for the Dev.

**Root cause — confirmed: argument-order inversion at the call sites, not a logger-definition bug.** `clientLogger` (imported from `@/lib/logger/client`, which re-exports from `@/lib/logger` → Pino `Logger`) takes `(obj, msg)` — object first, message second (the CLAUDE.md standard). Every call in this file passes them backwards (`(msg, obj)` / `(msg, error, obj)`). Verified against the actual pino `LogFn` overloads (`node_modules/pino/pino.d.ts:345`): for a string-first call, overload 1 parses the message for printf placeholders and expects **no** trailing args; overloads 2/3 set `msg?: never` when the first arg is a string — so a trailing **object** literal matches nothing → TS2769.

**Why only 14 error, not all ~24:** calls whose 2nd arg is a **concrete object** (`{ userId }`) or an explicit `error as Error` (lines 303, 377) fail (14 total). Calls with a **bare `error`** from `catch` (typed `any`) compile — because `any` is assignable to `never` (the `msg?: never` slot) — but are **equally wrong**: Pino treats the string as the object-merge target and silently **drops the error object** from the log. Those are the more dangerous ones (silent error-swallowing), which is a second reason to fix the whole file rather than only the type errors.

**Fix-scope ruling: fix ALL call sites in this file (agree with coordinator).** CLAUDE.md "fix TS errors in touched files — fix them anyway"; the file is already modified this cycle; it is one mechanical, uniform swap; and it clears the file to zero TS2769 while restoring lost error context. Keep the change scoped to this file and to logging statements only — no other refactoring.

**Exact pattern for the Dev:**
- Debug with context: `clientLogger.debug('Getting plugin status', { userId })` → `clientLogger.debug({ userId }, 'Getting plugin status')`. Single-arg message-only calls (e.g. `clientLogger.debug('Getting available plugins')`) are already correct — leave them.
- Error, bare error 2nd arg: `clientLogger.error('Error getting available plugins', error)` → `clientLogger.error({ err: error }, 'Error getting available plugins')`.
- Error, error + context: `clientLogger.error('Error connecting plugin', error, { pluginKey })` → `clientLogger.error({ err: error, pluginKey }, 'Error connecting plugin')`.
- Error with cast: `clientLogger.error('...', error as Error)` → `clientLogger.error({ err: error }, '...')` (drop the now-redundant cast).
- **Wrap any non-object 2nd arg as `{ err }`** — applies to lines 32, 67, 118, 148, 190, 217, 245*, 267*, 292, 303, 318, 377 (`*` = feature-introduced). The 10 debug-with-object lines (45, 79, 94, 102, 128, 144, 163, 181, 201, 228*, 276, 310) just swap order.

**Risk: log-only, no behavioral/control-flow impact.** These are pure logging statements; return values and flow are untouched. Log **output shape does improve** — the currently-dropped `err` object becomes properly serialized under `err` — but nothing consumes this client log programmatically, so there is no dependency on the current (broken) output to break. Safe.

Re-review at next pass: confirm `npx tsc --noEmit` shows 0 errors for `lib/client/plugin-api-client.ts`.

### SA Re-Review — user-feedback fixes (2026-07-28)

Reviewed the two live-test-feedback fixes (connection panel expiry + free-text form replacing the JSON sub-editor). Verified against the real Google definitions, ran `tsc` on the feature files (clean, and the earlier 14× TS2769 in `plugin-api-client.ts` are now resolved too), and re-ran the tester suites (**8 suites / 92 tests green**). No new `console.*` in feature files; execute route still untouched.

**Verdict: ✅ Approved — no must-fix. Ready for the user to re-test.** Two nice-to-haves below; neither blocks.

#### Fix 1 — connection panel (expiry-aware) + focus/visibility re-sync
- **Expired = gate-locked — ✅ correct.** An expired OAuth token is not runnable (execute would fail with an auth error), so counting expired as not-connected and keeping the gate locked is the right call. `connected = connectedSet.has(key) && !expired`; `missing` includes expired keys; `enabled = missing.length === 0`. The panel's third state (⚠ expired → **Reconnect**) is clear.
- **Mirrors User Configuration — ✅.** `active_expired` is read from the same `userStatus` field the User Configuration section derives its "expired" count from (`user-status` route → client → page), so the panel genuinely reflects the same source of truth. Confirmed the field exists end-to-end (not a silent `undefined`).
- **Focus/visibility re-sync — ✅ sound.** Guards on `visibilityState === 'visible' && userId.trim()`, reuses `loadUserStatus` (single source), cleans up both listeners. No infinite loop (`loadUserStatus` doesn't mutate `userId`, the effect's only dep). *Nice-to-have:* `focus` and `visibilitychange` can both fire on a single tab-return → up to 2 back-to-back refetches; harmless on a dev page but a small debounce (or listening to only one event) would tidy it.

#### Fix 2 — free-text form (reverses SA Resolution 3)
1. **Reassembly correctness — ✅ verified against real defs.** Spot-checked the exact payload shapes: Calendar `create_event` (`attendees` scalar-array of emails; `reminders` → object `{use_default, overrides[]}` where `overrides` is an object-array of `{method, minutes}`; `send_notifications`); `list_available_slots` (`working_hours` → object `{time_zone, windows[]}`, `windows` an object-array of `{days, start, end}`); Sheets `write_range` (`values` → `scalar-matrix` → `[[...]]`). `getByPath`/`setByPath` + the recursive coercer reconstruct the precise nested shape the action schema expects. No path found where the reassembled shape diverges from the schema. (Minor: matrix cells serialize as strings since inner `items.items.type` is unspecified — Sheets `input_option` parses them; acceptable.)
2. **F5 genericity — ✅.** The recursion derives purely from JSON-Schema `type`/`items`/`properties`/`required`. No action/plugin names anywhere.
3. **Required-validation semantics — ✅ sensible, no false pos/neg.** Fully-empty required object reports the object path; a provided object descends and reports the missing required *leaf*; a required object-array needs ≥1 row; required scalar-array needs ≥1 parsed item. Matches the descriptor/`required_params` source (never templates).
4. **Booleans always emit `false` — ⚠️ ruled ACCEPTABLE (nice-to-have, not must-fix).** Ground-truth check: every boolean in the spot-checked actions carries an explicit `default` — `create_event.send_notifications = true`, `reminders.use_default = true`, `write_range.overwrite_existing = true`. `buildDescriptor` seeds `defaultValue: prop.default ?? false`, so these render **checked** and, if untouched, emit the **documented default (`true`)** — a faithful payload, **not** an unintended `false`. The coordinator's specific worry (`send_notifications:false` when the user meant "unset") therefore does **not** occur for these fields — the user sees the box checked and can uncheck deliberately. The only residual is a boolean with **no** schema default, which falls back to `?? false` and always emits `false` (a minor invented value). *Nice-to-have refinement (hand to Dev, non-blocking):* make no-default booleans tri-state — seed `undefined`, and in `coerceField` return `value === undefined ? undefined : Boolean(value)` so an untouched, defaultless boolean is pruned rather than sent as `false`. Not required because (a) all Google-suite booleans carry defaults and emit correctly, and (b) the Advanced raw-JSON path covers precise control. (The same reasoning applies to the object that is always emitted because it contains a boolean — e.g. `reminders:{use_default:true}` equals the default, so it's harmless.)
5. **Resolution-3 reversal — ✅ accepted.** For a tester aimed at non-technical use, free-text flattening (no raw-JSON in the default path) is the right UX call; the add-row/remove-row repeater for arrays-of-objects is a reasonable simple pattern; and the "unrecognized array shape → scalar-array free-text, never JSON" fallback (`buildDescriptor`) degrades gracefully with no crash and no JSON requirement. Advanced (raw JSON) is retained as the single escape hatch. I formally supersede my original SA Resolution 3 (JSON sub-editor) with this approach.
6. **Standards — ✅.** No new `console.*` in feature files; `app/api/plugins/execute/route.ts` untouched; `tsc` clean for all feature files (incl. the now-fixed `plugin-api-client.ts` logger calls); 8 suites / 92 tests pass.

**Must-fix (blocking):** none.
**Nice-to-have (defer OK):** (a) tri-state no-default booleans (prune untouched); (b) debounce the focus+visibility re-sync; (c) carryover — the pre-existing `console.log` DEBUG lines in `page.tsx` (~L1093/1095, token-refresh path) remain flagged debt, not introduced here and out of scope.

**Re-Review verdict: ✅ Code Approved — ready for user re-test → QA.**

### SA Re-Review — token-refresh feature (2026-07-28)

Reviewed the focused token-refresh addition (per-plugin "Refresh token" on expired plugins, "Refresh all tokens (N)" sequential run, `runSequentialRefresh` helper). Verified against the backend `refresh-token`/`user-status` routes, ran `tsc` (feature files clean), tester suites **9 passed / 103 tests**. No new `console.*`; execute route untouched.

**Verdict: ✅ Approved with ONE must-fix (Medium) — the happy-path refresh is correct and safe to put in front of the user now; the must-fix (expired-plugin OAuth fallback) should land before QA sign-off/merge.**

1. **`runSequentialRefresh` correctness — ✅ (helper) / ⚠️ failed-key surfacing is nice-to-have.** Genuinely one-by-one (`for` loop, `await refreshOne(key)` before the next), progress emitted *before* each await so the label tracks the in-flight key, per-key `try/catch` pushes a failed key and continues (doesn't wedge the run), returns `failed[]`. Correct and cleanly unit-testable. **Caveat (matches Dev flag #4):** the injected `refreshOne` (`refreshPluginToken`) swallows its own errors and never throws, and the caller discards the returned `failed[]`, so the helper's failed-key path is effectively dead *for this caller*. **Ruling on visibility: nice-to-have, not must-fix.** A failed refresh is still adequately visible — the plugin visibly stays ⚠ expired (doesn't flip to ✓), its "Refresh token" button remains, the gate stays locked, and a debug-log `Token refresh failed for X` line is written. That is a correct, honest "it didn't work, try again" signal. Optional polish: surface `failed[]` as a small inline "Failed to refresh: X, Y" notice instead of relying on the debug log + residual ⚠.

2. **Expired vs disconnected path — ⚠️ MUST-FIX (Medium): a dead refresh token is a dead-end.** The button split is coherent for the happy path (expired→Refresh, disconnected→Connect, connected→none; expired never shows Connect because of `!p.connected && !p.expired`). **But Dev flag #2's assumption that a dead-refresh plugin "falls back to disconnected/Connect on next status load" is NOT supported by the backend.** `user-status` classifies a plugin as `active_expired` whenever it has a connection row with an expired token; `refresh-token` on a dead/invalid refresh token pushes the key to `failed[]` **without deleting the connection row**. So the plugin **remains `active_expired`** across reloads — the panel keeps offering only "Refresh token" (which keeps failing) and **never** offers the full-OAuth "Connect". A genuinely dead Google refresh token (revoked access, 6-month idle, scope change, 50-token limit) therefore has **no path forward within this panel** — the gate stays locked with no UI recovery. **Fix:** on an expired plugin, also offer an OAuth "Reconnect" escape hatch (e.g. a secondary button, or reveal Connect once a refresh has failed) so there is always a way to un-stick the gate. This does not block the user's immediate re-test of the *refreshable* happy path, but must be resolved before QA sign-off.

3. **F5 genericity — ✅.** `refreshAllExpiredTokens` filters `REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS` by `active_expired`; the panel iterates `gate.perPlugin`; `runSequentialRefresh` iterates the given keys. No per-plugin branching anywhere.

4. **In-flight disabling — ✅ acceptable v1 (Dev flag #3).** Coarse shared `isLoading` disables all connect/refresh buttons during any refresh, preventing overlap. *Minor nice-to-have:* `refreshPluginToken` toggles `isLoading` false in its `finally` between each sequential call, so there's a brief window mid-run where buttons re-enable; gating on `refreshAllProgress != null` (already tracked) would keep them disabled for the whole run. Per-plugin spinner also deferrable.

5. **Scope of Refresh-all — ✅ acceptable (Dev flag #1).** Scoped to the required Google Suite gating set (`REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS ∩ active_expired`), which is exactly what the panel gates on — coherent, not system-wide.

6. **Standards — ✅.** No **new** `console.*` (0 added in the diff; the `console.log` at `page.tsx` ~L1097/1099 lives inside the **pre-existing** `refreshPluginToken`, not added here — carryover debt already tracked). `app/api/plugins/execute/route.ts` untouched. `tsc` clean for all feature files. 9 suites / 103 tests green.

**Must-fix (blocking before QA sign-off):** (2) add an OAuth "Reconnect" fallback on expired plugins so a dead refresh token is not a dead-end.
**Nice-to-have (defer OK):** (a) surface `runSequentialRefresh` `failed[]` as an inline notice; (b) keep buttons disabled for the whole refresh-all run via `refreshAllProgress`; (c) per-plugin spinner; (d) carryover `console.log` DEBUG at `page.tsx` ~L1097/1099.

**Re-Review verdict: ✅ Approved for immediate user re-test of the refresh happy path; ONE must-fix (Medium — expired-plugin OAuth fallback) required before QA sign-off.**

### SA Re-Review — input-reset bugfix (2026-08-03)

Reviewed the fix for the critical input-loss bug (form reverting typed input to the `PARAMETER_TEMPLATES` seed — `send_email` went out with `recipient@example.com` instead of the user's address). Verified root cause, traced every re-seed path, ran `tsc` (feature files clean) and the tester suites (**9 suites / 106 tests green**). No new `console.*`; execute route untouched.

**Verdict: ✅ Approved — no must-fix. Data-loss bug fully closed. Ready for the user to re-test.**

1. **Fix closes the data loss — ✅ confirmed across all re-seed paths.** The seed effect now early-returns when `lastSeededKey.current === \`${selectedPlugin}/${selectedAction}\``, so a background re-fetch of the SAME action (new `activeSchema` object identity, new `fields` array) no longer overwrites `values`. I walked every path:
   - *Same-action re-fetch / action-list reload* → seedKey unchanged → early return, input preserved (the core bug). ✅
   - *Different-action switch (same plugin)* → `selectedAction` changes → seedKey differs → re-seeds correctly. ✅
   - *Plugin change* → the plugin `<select>` `onChange` resets `selectedAction=''` (FormTester L294) → seed effect hits the deselect branch (`setValues({})`, `lastSeededKey=null`), then a new action seeds fresh. No stale input carried across plugins. ✅
   - *Deselect → reselect same action* → deselect nulls the tracker, reselect re-seeds fresh (intentional reset, not data loss). ✅
   - *Advanced (raw JSON) toggle* → doesn't touch plugin/action/schema, so the seed effect doesn't run; `values` preserved; on same-action re-fetch `setAdvanced(false)` is not reached (guarded by the early return). ✅
   - *Typing WHILE a re-fetch is in flight* → refetch resolves → `setActionSchemas` → new `activeSchema` → seed effect runs → seedKey same → early return → the just-typed value survives. ✅
   No remaining path found where user input is clobbered. (Extreme edge: if the backend returned a *structurally different* schema for the same action name mid-session it would not re-seed — but definitions are static within a session and preserving input is the correct priority; not a real concern.)
2. **Latest-ref pattern (onConnect/onRefresh/onRefreshAll) — ✅ correct, no staleness.** `testerHandlersRef.current` is reassigned to the fresh `{connectPlugin, refreshPluginToken, refreshAllExpiredTokens}` closures on every render, and the `useCallback([])` wrappers read `ref.current` at call time — so identity is stable (won't retrigger child effects) while always invoking the current handler that closes over current `userId`/state. The render-time ref assignment is the sanctioned "latest ref" idiom (idempotent, read only in post-commit event handlers → StrictMode/concurrent-safe, no tearing). Hooks called unconditionally at top level — no rules-of-hooks issue.
3. **`useCallback([apiClient])` for the three data fns — ✅ genuinely stable.** `apiClient = useState(() => new PluginAPIClient())` (L787) is a lazy-init singleton stable for the component lifetime, so `[apiClient]` never changes → `testerGetActionSchema`/`testerExecuteAction`/`testerRecordAudit` keep stable identity and the schema-load effect (dep on `getActionSchema`) no longer refires every render. The fix is effective, not moot.
4. **Regression test quality — ✅ genuinely reproduces + asserts payload.** Uses an UNSTABLE inline `getActionSchema` (new identity per render) returning a FRESH `JSON.parse(JSON.stringify(SEND_EMAIL))` clone per fetch (so `activeSchema` identity changes exactly as in the live bug), types `me@myreal.com` into nested `recipients.to`, forces a parent re-render, and deterministically waits for the refetch to resolve (`waitFor(schemaCalls increment)` + `act` flushes). Asserts both that the input persists AND that `executeAction` is called with `{ recipients: { to: ['me@myreal.com'] } }` — never the placeholder. Fails without the guard, passes with it. Would catch a regression.
5. **Standards — ✅.** No new `console.*` (0 added; FormTester has none). `app/api/plugins/execute/route.ts` untouched. `tsc` clean for all feature files. 9 suites / 106 tests green.

**Must-fix (blocking):** none.
**Nice-to-have (defer OK, carryover):** the prior token-refresh must-fix (expired-plugin OAuth fallback for a dead refresh token) is unaffected by this bugfix and still stands before QA sign-off; plus the earlier nice-to-haves (tri-state no-default booleans; debounce focus re-sync; pre-existing `page.tsx` DEBUG `console.log`s).

**Re-Review verdict: ✅ Code Approved — input-loss bug fully closed; ready for user re-test.**

## QA Testing Report

**QA — 2026-07-28**
**Test mode:** full (scoped to this branch's tester surface per the SA out-of-scope ruling on the ~21 pre-existing red suites)
**Strategy used:** B (Jest integration for the two endpoints) + A (Jest unit for the pure helpers) + D-lite (RTL component test for the critical UI path) — the exact strategy mix the SA approved as the CI gate; live Playwright deliberately omitted (real Google side effects).
**Focus:** api + schema + security (redaction, gate, metadata-only endpoints) + the CR1 destructive classifier.
**Skipped:** live Playwright (real, irreversible Google side effects — SA Q4 ruling); the ~21 pre-existing failing repo suites (SA proved identical on baseline `jest.config`; out of scope for this cycle).
**Input source:** QA task brief + workplan `SA Code Review` gate definition.

### Test Run (on record)

Command: `npx jest app/api/plugins/action-schema app/api/plugins/test-audit lib/plugins/tester hooks/useSideConsole components/test-plugins --runInBand`

```
Test Suites: 8 passed, 8 total
Tests:       87 passed, 87 total
Snapshots:   0 total
Time:        7.717 s
```

All 8 tester suites green (real run, not inferred): `action-schema/route.test.ts`, `test-audit/route.test.ts`, `schema-to-form.test.ts`, `form-values.test.ts`, `connection-gate.test.ts`, `redaction.test.ts`, `useSideConsole.test.tsx`, `FormTester.test.tsx`.

### tsc — feature files

`npx tsc --noEmit` filtered to feature files → **ZERO errors** in `lib/client/plugin-api-client.ts` (the clientLogger addendum fix), `lib/plugins/tester/*.ts`, `app/api/plugins/action-schema/route.ts`, `app/api/plugins/test-audit/route.ts`, and the `components/test-plugins/tester/*` components. The Addendum's 14× TS2769 in `plugin-api-client.ts` is confirmed resolved. (Repo may carry unrelated pre-existing tsc errors elsewhere — not attributable to this feature.)

### Test Coverage
| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Schema-derived form (controls/required/enum/defaults) | ✅ | Pass | `schema-to-form.test.ts` covers text/enum/number+min-max/boolean/scalar-array/nested→json-subtree/array-of-objects→json-subtree/x-dynamic-options→free-text; FormTester RTL renders form from schema. |
| Required-field validation blocks Run | ✅ | Pass | FormTester RTL: Run disabled until `name` filled. |
| Run executes live under active userId | ✅ | Pass | FormTester asserts `executeAction('u1','google-drive','create_folder',{name})`; page wires real apiClient. |
| Empty userId → "userId required", no execution | ✅ | Pass | `connection-gate.test.ts` (userIdRequired) + FormTester `gate-userid-required`. |
| Gate enabled only when all 5 Google plugins connected | ✅ | Pass | `connection-gate.test.ts` all-connected→enabled; FormTester hides Plugin selector when missing. |
| Per-plugin connected state shown / missing prompted | ✅ | Pass | `connection-gate` perPlugin + missing; ConnectionGatePanel rendered. |
| Destructive actions flagged + confirm click | ✅ | Pass | CR1 classifier + FormTester confirm-gate (block→confirm→run, and cancel path). |
| Current-result readable success/error | ✅ | Pass | FormTester `tester-result` shows Success. |
| Persistent side console, one entry/run, chronological, userId-scoped | ✅ | Pass | `useSideConsole.test.tsx` newest-first + userId label; FormTester appends 1 entry/run. |
| Console entry expand/copy/clear | ⚠️ | Partial | Clear + append + cap unit-tested; expand/copy is presentational (SideConsole.tsx) — not asserted in a test, low risk. |
| No tokens/secrets in console (redaction) | ✅ | Pass | `redaction.test.ts` + `useSideConsole` redaction-at-capture test (access_token/authorization→REDACTED). |
| action-schema endpoint metadata-only, Zod 400/404/envelope | ✅ | Pass | `action-schema/route.test.ts` 400/404×2/happy/all-actions + metadata-only key assertion. |
| test-audit records non-sensitive fields, non-blocking | ✅ | Pass | `test-audit/route.test.ts` happy/400×3 + non-blocking-on-reject. |
| x-dynamic-options → labeled free-text | ✅ | Pass | `schema-to-form.test.ts`. |
| New action surfaces with no UI code change / no hardcoding | ✅ | Pass | buildFormFields is schema-generic; only literals are the isolated 5-key coverage constant. |

### Correctness verdicts

- **CR1 destructive classifier — PASS.** `isPresenceCheckCondition` (`^\s*[A-Za-z_][\w.]*\s*(!=|==)\s*null\s*$`) is a static shape match (no runtime evaluation). `schema-to-form.test.ts` loads the **real** definition JSON from `lib/plugins/definitions/` and proves the blocking gate fires on exactly the 6 presence-check destructives (`delete_file`, `revoke_access`, `clear_range`, `delete_rows`, `delete_label`, `delete_event`) and does NOT fire on `list_files`/`read_file_content`/`read_range`/`send_email`/`list_events`; threshold confirms surface as non-blocking advisories. Blocking `delete_event` (6, not the SA's original "5") is the correct F5-generic result — confirmed.
- **Redaction (FR8/F2) — PASS.** `redactSensitive` runs at **capture** inside `useSideConsole.append` over both request and response; strips credential-shaped keys (authorization/bearer/access·refresh·id-token/client_secret/api_key/secret/password/cookie) and value shapes (`Bearer …`, `ya29.…`, JWT `eyJ…`), depth-bounded, non-mutating. A token cannot reach the stored/rendered/copied entry un-redacted. Level-1 is also secret-free by construction. Verified by `redaction.test.ts` + the `useSideConsole` capture test.
- **Connection gate (FR12) — PASS.** `evaluateConnectionGate` is pure/generic; enabled iff all 5 keys connected; disabled lists `missing`; empty/whitespace userId short-circuits to `userIdRequired`; null status treated as not-connected. Five-key coverage in one named constant.
- **action-schema endpoint — PASS.** Zod query (400 on missing plugin), 404 unknown plugin/action, standard envelope, `NODE_ENV`-guarded details, `createLogger`+correlationId. `projectAction` hand-picks only metadata fields; route test asserts response keys exclude `access_token`/`connection`/`user_id`. Unauthenticated metadata-only posture matches CR3; invariant documented in-code.
- **test-audit endpoint — PASS.** Zod body, enum-validated outcome, records only `{targetUserId, plugin, action, outcome, durationMs, source}` (no params/tokens), `AuditTrailService.log(...).catch(...)` non-blocking (proven: 200 even when log rejects). Accepted "no verified operator identity" limitation documented.

### CR4 / logging checks

- `app/api/plugins/execute/route.ts` — **NOT modified** (`git diff --stat` empty; not present in the diff). Its 5 `console.*` + missing auth/Zod remain tracked security debt exactly as agreed.
- **No new `console.*`** in any feature source file (endpoints, tester helpers, hooks, tester components) — grep clean; server uses Pino, client uses `clientLogger`.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None observed (pure helpers, session-only console with N=50 cap, no redundant network calls).

#### Edge Cases (nice to fix) — carried forward, non-blocking
1. Side-console expand/copy interaction is presentational and not asserted in a test (low risk).
2. Re-affirming SA's non-blocking notes: `test-audit` is an unauthenticated write accepting client-supplied `targetUserId` (bounded, fixed-shape, no secret exposure); CR1 residual — a genuinely destructive action authored with no confirm rule would not be gated (definition-authoring caveat); consider pinning `jest-environment-jsdom` to `^30`.

### Final Status
- [x] All in-scope acceptance criteria pass — ready for commit
- No High/Medium bugs open. QA sign-off: **PASS** (Phase A + B).

---

### Final QA Sweep (2026-08-03)

Re-run after the multiple SA-reviewed fix rounds that landed since the first QA pass: free-text form (no JSON sub-editor), status-alignment + focus re-sync, per-plugin Refresh + Refresh-all-sequential, dead-refresh OAuth-reconnect fallback, and the critical input-reset bugfix. User has live-verified `send_email` (received a real email). No implementation modified during this sweep.

**Test run (on record).** Command: `npx jest lib/plugins/tester hooks/useSideConsole components/test-plugins app/api/plugins/action-schema app/api/plugins/test-audit --runInBand`

```
Test Suites: 9 passed, 9 total
Tests:       106 passed, 106 total
Snapshots:   0 total
Time:        10.521 s
```

Grew from 8/87 → **9 suites / 106 tests** (new `ConnectionGatePanel.test.tsx` + expanded FormTester/form-values coverage). Real run, not inferred.

**tsc — feature files: CLEAN.** `npx tsc --noEmit` filtered to `app/test-plugins-v2/page.tsx`, `lib/client/plugin-api-client.ts`, `lib/plugins/tester/*.ts`, `hooks/useSideConsole.ts`, both new routes, and `components/test-plugins/tester/*.tsx` → **ZERO errors**. (Unrelated pre-existing tsc errors elsewhere ignored.)

**Correctness verdicts (final integrated state):**

- **Input persistence (the fixed bug) — PASS.** `FormTester.test.tsx` "preserves user-typed nested input through a background re-fetch" reproduces the exact live bug: an UNSTABLE `getActionSchema` identity (fresh arrow + JSON-cloned actions each render) forces a real background refetch; the test types `me@myreal.com` into nested `recipients.to`, waits for the refetch to resolve/flush, and asserts the value did NOT revert to the `PARAMETER_TEMPLATES` placeholder (`recipient@example.com`) and that `executeAction` receives `{ recipients: { to: ['me@myreal.com'] } }`. This is a faithful, deterministic regression guard for the send_email bug.
- **Free-text form reassembly — PASS.** No JSON textarea rendered for nested shapes (asserted absent). `form-values.test.ts` + FormTester prove: nested object flatten (`content.{subject,body}`, `start.date_time`), object-array repeater (`attendees[]` add-row → `[{email, optional}]`, empty rows dropped), 2-D matrix (Sheets `values` comma rows → `[['a','b'],['c','d']]`), scalar coercion, empty-optional omission, false-boolean retained. create_event spot-check yields the exact nested payload.
- **Destructive classifier (CR1) — PASS.** Unchanged, still green: `schema-to-form.test.ts` loads the real definition JSON and proves the 6 presence-check destructives block (`delete_file`, `revoke_access`, `clear_range`, `delete_rows`, `delete_label`, `delete_event`) while `read_range`/`send_email`/`list_files`/`list_events`/`read_file_content` do not (threshold confirms surface as non-blocking advisories).
- **Redaction (FR8) — PASS.** `redactSensitive` runs at capture in `useSideConsole.append`; credential-shaped keys/values stripped to `[REDACTED]` before any entry is stored/rendered/copied. Level-1 also secret-free by construction.
- **Connection gate (FR12) — PASS, now three-state.** `evaluateConnectionGate` treats a plugin as runnable only when `connected AND NOT active_expired`; surfaces `expired` distinctly; expired keeps the gate locked; empty/whitespace userId → `userIdRequired`; null status = not-loaded. Aligns with User Configuration's connected/expired/disconnected reporting.
- **Token refresh + NO DEAD-END — PASS (earlier must-fix CLOSED).** `ConnectionGatePanel.test.tsx` explicitly asserts every state has a forward path: connected → no action; **expired → BOTH "Refresh token" AND "Reconnect (OAuth)"** (the dead-token escape hatch — `Reconnect (OAuth)` triggers the full-OAuth connect path); disconnected → "Connect". Per-plugin `onRefresh(key)`, sequential "Refresh all tokens (N)" via `runSequentialRefresh` (awaits each, continues past failures, reports progress), live progress label, and in-flight disabling all covered. A dead refresh token is recoverable.
- **Endpoints — PASS.** `action-schema` metadata-only (Zod 400 / 404×2 / envelope; response keys exclude `access_token`/`connection`/`user_id`); `test-audit` records only `{targetUserId, plugin, action, outcome, durationMs, source}`, non-blocking (200 even when `AuditTrailService.log` rejects).

**CR4 / logging:** `app/api/plugins/execute/route.ts` **NOT modified** (empty `git diff --stat`; absent from diff). **No new `console.*`** in any feature source (grep clean; server Pino, client `clientLogger`).

**Bugs found:** None.

**Sweep sign-off: PASS** (Phase A + B). No High/Medium bugs open; all in-scope criteria pass across the final integrated state. Ready for commit. (Pre-existing ~21 red repo suites remain out of scope per SA's baseline-`jest.config` proof.)

## Commit Info

_[RM will populate this section.]_

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-03 | QA final sweep | QA appended `### Final QA Sweep (2026-08-03)` after the SA-reviewed fix rounds (free-text form, status-align + focus re-sync, per-plugin/refresh-all-sequential, dead-refresh OAuth-reconnect fallback, input-reset bugfix; user live-verified send_email). Verdict: **PASS** (Phase A + B). Real run: **9 suites / 106 tests green**; `tsc --noEmit` zero errors across all feature files. Correctness all PASS incl. the two focus items: **input-persistence regression** (typed nested `recipients.to` survives a background refetch → executeAction gets the user value, not the template) and **no-dead-end refresh** (expired offers BOTH Refresh token AND Reconnect (OAuth); every connection state has a forward path — earlier must-fix closed). Also PASS: free-text nested/object-array/matrix reassembly, CR1 classifier (6 destructives block; reads/sends don't), redaction at capture, three-state FR12 gate, metadata-only/non-blocking endpoints. execute route untouched; no new console.*. No bugs. |
| 2026-07-28 | QA test pass | QA appended `## QA Testing Report`. Verdict: **PASS** (Phase A + B). Real scoped run on record: **8 suites / 87 tests green** (`action-schema`, `test-audit`, `schema-to-form`, `form-values`, `connection-gate`, `redaction`, `useSideConsole`, `FormTester`). `tsc --noEmit` **zero errors** across all feature files incl. the `plugin-api-client.ts` clientLogger fix (14× TS2769 confirmed resolved). Correctness verdicts all PASS: CR1 classifier (6 presence-check destructives block, threshold reads/sends do not — proven against real definition JSON); redaction at capture (token cannot reach console); FR12 gate; metadata-only `action-schema` (400/404/envelope, no secret keys); non-blocking `test-audit` (non-sensitive fields only). Confirmed execute route untouched (CR4) and zero new `console.*`. No bugs. Pre-existing ~21 red repo suites confirmed out of scope. |
| 2026-08-03 | SA re-review (input-reset bugfix) | SA appended `### SA Re-Review — input-reset bugfix`. Verdict: **✅ Approved, no must-fix — data-loss bug fully closed.** Confirmed the seed-key guard (`${plugin}/${action}` in a ref) prevents re-seed on same-action background re-fetch while still re-seeding on a genuine action switch; walked all paths (plugin change, deselect/reselect, advanced toggle, in-flight typing) — no remaining clobber. Latest-ref pattern for connect/refresh handlers is correct (stable identity, no staleness, StrictMode-safe); `useCallback([apiClient])` genuinely stable (`apiClient` is a lazy-init `useState` singleton). Regression test truly reproduces (unstable getActionSchema + fresh schema clone per fetch) and asserts the `executeAction` payload carries the user's value, not the placeholder. No new `console.*`, execute route untouched, `tsc` clean, 9 suites / 106 tests green. Prior token-refresh must-fix (expired-plugin OAuth fallback) unaffected and still stands before QA sign-off. |
| 2026-07-28 | SA re-review (token-refresh feature) | SA appended `### SA Re-Review — token-refresh feature`. Verdict: **✅ Approved with ONE must-fix (Medium).** `runSequentialRefresh` correct (sequential, progress, per-key resilience); failed-refresh visibility ruled adequate (plugin stays ⚠ expired + debug-log) → nice-to-have. **Must-fix:** expired→Refresh / disconnected→Connect split has a dead-end — a dead/invalid refresh token keeps the plugin in `active_expired` (backend doesn't delete the connection row on failed refresh), so the panel only ever offers "Refresh token" and never full-OAuth "Connect"; add an OAuth reconnect fallback on expired plugins before QA sign-off. Does NOT block immediate user re-test of the refreshable happy path. F5-generic; coarse `isLoading` disabling acceptable v1; refresh-all scoped to the gating set — all OK. No new `console.*`, execute route untouched, `tsc` clean, 9 suites / 103 tests green. |
| 2026-07-28 | SA re-review (user-feedback fixes) | SA appended `### SA Re-Review — user-feedback fixes` to the SA Code Review area. Reviewed Fix 1 (expiry-aware connection panel + focus/visibility re-sync) and Fix 2 (free-text recursive form replacing the JSON sub-editor, reversing SA Resolution 3). Verdict: **✅ Approved, no must-fix, ready for user re-test.** Verified reassembly against real Google defs (`create_event`, `list_available_slots`, `write_range` — nested objects/object-arrays/2-D matrix reassemble to exact schema shape); F5-generic; required-validation sound. Ruled the "booleans always emit false" concern ACCEPTABLE — all Google-suite booleans carry `default:true`, so untouched booleans emit the documented default (not an unintended false); tri-state pruning of no-default booleans left as a nice-to-have. Confirmed no new `console.*`, execute route untouched, `tsc` clean for all feature files (prior 14× TS2769 in `plugin-api-client.ts` now resolved), 8 suites / 92 tests green. |
| 2026-07-28 | SA code review | SA appended `## SA Code Review`. Verdict: **Code Approved for QA** (Phase A + B), no must-fix blockers. Ruled CR1 correct — blocking `delete_event` (6 presence-check destructives, not 5) is the right F5-generic result; verified against all five defs, no false positives; CR5 regression coverage loads real definition JSON. Confirmed: execute route untouched (CR4); zero new `console.*`; `action-schema` metadata-only + `test-audit` records only non-sensitive fixed-shape fields — neither leaks secrets. Proved the 21 pre-existing failing suites are unrelated to this branch (identical on baseline `jest.config`); all 8 new tester suites green (87 tests). Four non-blocking nice-to-haves recorded (unauthenticated audit-write vector; CR1 no-confirm-rule caveat; pin jsdom to @30; `any` comments on 2 client methods). |
| 2026-07-27 | SA workplan review | SA appended `## SA Workplan Review`. Verdict: **Changes Required** (fold CR1–CR5), Phase A+B; Phase C stays outline. Decisions: Q1 endpoint **unauthenticated** read-only (metadata-only, Zod+Pino+correlationId+envelope, no `getUser`); Q2 per-execution audit **mandatory in Phase A** via an isolated dedicated Zod+Pino endpoint (not the shared execute route); Q3 F3 = convert 5 `console.*`→Pino **only with USER sign-off** (shared prod route), file auth+Zod as tracked TL security debt, no auth/Zod this cycle; Q4 RTL component test = CI gate, Playwright optional/manual; Q5 schema `default` → `PARAMETER_TEMPLATES` → empty schema scaffold. Substantive change CR1: verified the `rules.confirmations`-presence signal fires on ~every action (threshold confirms near-universal) — blocking confirm gate must classify condition shape (presence-check = destructive/blocking vs numeric-threshold = advisory), still F5-generic + unit-testable. USER sign-off named: editing the shared `/api/plugins/execute` route. |
| 2026-07-27 | Initial workplan | Dev authored the workplan from the SA-cleared requirement. Structured by SA phasing A/B/C (Phase A detailed). Defined the `action-schema` endpoint contract, schema→form mapping helper, `rules.confirmations`-keyed destructive detection, FR12 connection-completeness gate, FR8 Level-1 side console. Confirmed SA findings in code (schemas not client-exposed; `rules.confirmations` object shape incl. `revoke_access`; F3 = 5 `console.*` + no auth/Zod in `/api/plugins/execute`). Baked in F1/F2/F5; flagged F3 as security debt. Raised 5 open questions for SA. Status: Planning (awaiting SA workplan review). |
</content>
</invoke>
