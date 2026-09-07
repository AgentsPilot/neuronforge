# Requirement: UI-Based Plugin API Tester

> **Last Updated**: 2026-07-27

**Created by:** BA
**Date:** 2026-07-27
**Status:** Requirement finalized (user ratified the 5 questions + the D6 gating decision, 2026-07-27). **Ready for workplan pending SA re-confirmation of the gating substitution** — the user consciously overrode SA flag F4 (admin/dev gate) and adopted connection-completeness as the sole access gate; SA should re-confirm or formally record the accepted risk before Dev starts.

## Overview

A no-code section in the plugin test page that lets the user (and QA) exercise any plugin action's **real API** end-to-end from the UI: pick a plugin, pick an action, fill a form that is auto-generated from the action's input schema, run it against a live connection, and read the response. A persistent **side console** logs every plugin API call (request + response) as the user tests, so calls accumulate into a running history rather than only showing the last result. All operations run under the **userId set in the test page's existing userId field**, scoped to that user's connected plugins, and the tester is **enabled only once that userId is connected to all relevant Google Suite plugins** (the sole access gate). The immediate driver is validating the newly extended Google Suite actions (Drive, Sheets, Docs, Gmail, Calendar — including `list_available_slots`) without hand-writing JSON payloads or one-off test scripts. This document captures the capability at the business/product level; the architecture and implementation are left to SA/Dev.

## Table of Contents

1. [Goal & Business Value](#goal--business-value)
2. [Context — What Exists Today](#context--what-exists-today)
3. [User Stories](#user-stories)
4. [Functional Requirements](#functional-requirements)
5. [Scope — v1 vs Later](#scope--v1-vs-later)
6. [Non-Functional Requirements](#non-functional-requirements)
7. [Acceptance Criteria](#acceptance-criteria)
8. [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
9. [Resolved Decisions (2026-07-27)](#resolved-decisions-2026-07-27)
10. [Residual Notes for SA](#residual-notes-for-sa)
11. [Notes on Integration Points](#notes-on-integration-points)
12. [SA Architectural Review](#sa-architectural-review)
13. [Change History](#change-history)

---

## Goal & Business Value

The Google Suite plugins were just extended with 18 new actions (17 in Phase 1 + `list_available_slots`). Today, validating any of them from the UI means hand-writing a JSON parameter blob in a textarea and knowing the exact field names, nesting, and enums by heart. That is error-prone, slow, and only accessible to whoever wrote the plugin.

The goal is a **guided, form-driven tester**: the UI reads the action's declared input schema and renders the right fields (text, number, boolean, dropdowns, required markers) so the user can fill in values without knowing the JSON shape, run the action against their real connected plugin, and immediately see the success payload or error. A **persistent side console** records each plugin API call as it happens, so the user can watch calls accumulate across a testing session. This gives:

- **The user** a no-code way to sanity-check that each extended action actually works against live Google APIs.
- **QA** a fast manual-verification surface that complements (does not replace) the automated Jest/integration suites.
- **Faster feedback** when a plugin definition or executor changes — the form re-derives itself from the schema, so it never drifts from the action's real inputs.
- **Debuggability** — a running request/response log of every call made in the session, not just the most recent result.

## Context — What Exists Today

The `/test-plugins-v2` page (`app/test-plugins-v2/page.tsx`, documented in [V2_TEST_PAGE_SCOPE.md](/docs/V2_TEST_PAGE_SCOPE.md)) already has a **Plugins** tab that supports action testing, but only via a **raw JSON textarea**:

- A **userId field** (page state, initialized from `NEXT_PUBLIC_TEST_PAGE_USER_ID`, editable in the UI). All plugin operations are already scoped to it: status (`getUserPluginStatus(userId)`), connect/disconnect, and execute (`executeAction(userId, plugin, action, params)` → `POST /api/plugins/execute`, also sent as the `x-user-id` header).
- Plugin selector + action selector (dropdowns populated from `/api/plugins/available`).
- A `PARAMETER_TEMPLATES` constant holds hand-maintained example JSON per action (including the new Google Suite actions — see the `google-drive`, `google-sheets`, `google-docs`, `google-mail`, `google-calendar` entries).
- Execution via `POST /api/plugins/execute` (the real executor against the user's connection).
- Connection status surfacing (connected / token-expired / not-connected) and a raw JSON response viewer with copy-to-clipboard.

**What is missing** — and what this requirement adds — is a **schema-driven form** instead of a hand-maintained JSON blob, plus a **persistent side console** for the running request/response history. Each plugin definition JSON (`lib/plugins/definitions/{name}-plugin-v2.json`) already carries, per action, a full input schema: `parameters` (JSON-Schema `properties` with `type`, `enum`, `default`, `minimum`/`maximum`, nested objects/arrays), `required_params` / `optional_params`, `x-dynamic-options` (fields whose values can be fetched dynamically, e.g. a folder or label picker), and an `output_schema`. A form can be generated directly from this. Per the placement decision (below), the existing raw-JSON textarea becomes an **"advanced" toggle** that sits alongside the generated form in the same section rather than being replaced. The tester reuses the page's existing userId field and connection-status flow — no new identity mechanism is introduced.

**Relationship to the existing testing requirement:** [REQ_PLUGIN_TESTING_COMPREHENSIVE.md](/docs/requirements/REQ_PLUGIN_TESTING_COMPREHENSIVE.md) covers the **automated** Jest/integration test suite (mock-based CI + real-API integration tests) and explicitly lists "UI testing of plugin configuration screens" as out of scope. This requirement is the **complementary manual/interactive** surface. The two do not overlap: one is CI automation, the other is a human-driven exploratory tester.

## User Stories

- As the product owner, I want to pick a Google Drive action, fill a guided form, and run it against my real Drive, so that I can confirm the new `move_file` / `delete_file` actions behave correctly without writing JSON.
- As a QA engineer, I want the form to show me exactly which fields are required and which values are allowed (dropdowns), so that I can construct valid calls quickly and probe edge cases.
- As a developer, I want to set the userId I'm testing on behalf of and have every call run against that user's connected plugins, so that I can validate a specific account's setup.
- As a developer, I want the tester to tell me which Google Suite plugins that userId still needs to connect, and to stay disabled until they're all connected, so that I don't hit avoidable "not connected" failures mid-test.
- As a developer, I want to see both the rendered response and the raw request/response JSON, so that I can debug an executor without adding logging.
- As a tester running several actions in a row, I want a side console that keeps a chronological log of every request and response, so that I can compare calls and trace a sequence without losing earlier results.
- As any tester, I want to see whether the target plugin is connected (and its token valid) before I run, so that I understand an auth failure instead of guessing.
- As any tester, I want a clear confirm step before I run a destructive action against my real account, so that I don't accidentally delete or clear real data.

## Functional Requirements

1. **Plugin selector** — choose from the available plugins. For v1 the list is scoped to the Google Suite plugins (Drive, Sheets, Docs, Gmail, Calendar) — see Decision D2. The selector exposes exactly the Google Suite plugins that are connected for the active userId once the access gate (FR12) is satisfied.
2. **Action selector** — choose from the actions defined for the selected plugin, sourced from the plugin definition (the same source `/api/plugins/available` already exposes).
3. **Schema-derived form** — for the selected action, auto-generate an input form from the action's declared input schema:
   - Render a field per parameter with the appropriate control by type: text/number/boolean (checkbox/toggle), and **dropdowns for `enum` values**.
   - Mark **required** parameters (from `required_params`) and validate they are filled before allowing "Run".
   - Honor `default` values, and surface `description`, `minimum`/`maximum` and other constraints as hints/validation.
   - Handle **nested objects and arrays** (e.g. Gmail `recipients.to[]`, Calendar `working_hours.windows[]`, reminders) in a usable way — at minimum a structured sub-form or a clearly-scoped JSON sub-editor for complex nested shapes.
   - For fields carrying `x-dynamic-options`, v1 renders a **free-text input** (labeled with the field's meaning); live pickers are a deferred fast-follow (Decision D4).
   - The form generation must be **schema-generic** — driven entirely by the plugin definition, with no per-plugin or per-action hardcoding — so non-Google plugins can be enabled later with no UI rework (Decision D2).
4. **Advanced / raw JSON toggle** — provide a raw JSON editor toggle **alongside** the generated form (pre-filled from the form state and/or the existing `PARAMETER_TEMPLATES`) so power users can still hand-edit and complex payloads are never blocked by form limitations (Decision D3).
5. **Run (live execution)** — execute the selected action with the assembled parameters against the user's **connected** plugin, via the real executor path (the existing `POST /api/plugins/execute`). Execution is **live with real side effects** — there is no dry-run mode in v1 (Decision D1).
6. **Destructive-action confirm gate** — actions that mutate or delete (e.g. `delete_file`, `delete_label`, `clear_range`, `delete_rows`, `revoke_access`) must be visually flagged AND require a **lightweight explicit confirm click** before running, since the tester hits real data (Decisions D1 + D5). The set of "destructive" actions is derived from the plugin definition (e.g. its confirmation-rule / destructive markers) rather than a hardcoded list — SA to confirm the exact signal (see Residual Notes / SA review Resolution 1: key on `rules.confirmations`).
7. **Response display (current result)** — clearly present the outcome of the **most recent** run: success payload rendered readably, plus errors surfaced with the plugin's error message. This is the "what just happened" view; the full running history lives in the side console (FR8). To avoid duplication, the response area focuses on the current result and its rendered form, while the side console is the authoritative home for the raw, chronological request/response entries.
8. **Live side console (persistent request/response inspector)** — a persistent side panel, visible alongside the form, that logs **every plugin API call exercised through the UI** as a running, chronological history within the session:
   - **Per-call entry:** each run appends one entry capturing the outbound **request** (plugin, action, parameters/payload sent) and the returned **response** (success payload or error), plus useful metadata (timestamp, and ideally status/outcome and duration).
   - **Accumulates across runs:** entries persist and stack as the user runs more actions during the session — the console shows the sequence of calls, not just the last one. (Session-scoped; persistence beyond the session is out of scope for v1.)
   - **Scoped to the active userId (FR11):** the console logs the request/response of plugin API calls made on behalf of the currently-set userId. (If the tester later supports switching userId mid-session, SA/Dev should make clear which userId each entry belongs to — an implementation detail, not a v1 requirement.)
   - **Expandable & copyable:** each entry can be expanded to inspect the full request and response JSON, with copy-to-clipboard.
   - **Manageable:** the user can clear the console; a reasonable retention cap (e.g. most-recent-N entries) is acceptable to bound memory (exact cap is an SA/Dev detail).
   - **Redaction (security):** console entries must **never** include tokens, credentials, bearer/authorization headers, or other secrets — these must be redacted before an entry is rendered (see NFR Security and Acceptance Criteria).
   - This side console is the single home for the raw request/response data; it removes the need for a separate standalone raw-JSON debug block, though the current-result area (FR7) may still offer an inline "view raw" that points at / mirrors the console entry.
9. **Connection / auth status** — surface the selected plugin's connection state (connected / token-expired / not-connected) and, when not runnable, guide the user to connect or refresh (reusing existing status + connect/refresh affordances on the page).
10. **Placement** — the tester is a **new section/mode within the existing Plugins tab** on `/test-plugins-v2` (not a separate page), reusing that tab's plugin list, connection status, and execute path (Decision D3). The side console (FR8) is laid out as a panel beside the form within this section.
11. **userId scoping** — the tester executes under the **userId set in the test page's existing userId field** (reusing the current page state and its `NEXT_PUBLIC_TEST_PAGE_USER_ID` default — **no separate identity mechanism is added**). All action executions run against **that user's connected plugins**: the userId flows through the existing path (`executeAction(userId, …)` → `POST /api/plugins/execute` + `x-user-id` header → `plugin-executer-v2.ts` → `base-plugin-executor.ts executeAction(userId, …)`, which resolves that user's stored plugin connections). Connection/auth status (FR9), the access gate (FR12), and the side console (FR8) are likewise bound to this userId. If the userId field is **empty**, actions cannot run — the tester surfaces a clear "userId required" state and does not execute, mirroring the page's existing `if (!userId.trim())` guards. This is expected behavior, not an error condition.
12. **Access gate — connection completeness (SOLE gate)** — the Google Suite tester is **enabled only when the active userId (FR11) has OAuth connections to ALL relevant Google Suite plugins** — Drive, Sheets, Docs, Gmail, and Calendar:
    - The tester **displays which of those plugins are connected** for the active userId, reusing/extending the existing connection-status flow (`getUserPluginStatus(userId)` for status, `connectPlugin(userId, pluginKey)` to connect).
    - If **any** relevant plugin is **not connected**, the tester is **disabled** and **prompts the user to complete the missing OAuth connection(s)** — no runnable action form is exposed until all five are connected.
    - Once **all** relevant plugins are connected, the tester becomes usable and exposes exactly the connected Google Suite plugins and their actions.
    - **This connection-completeness check is the SOLE access gate.** Per the user's decision (D6, 2026-07-27), the SA-recommended admin / environment gate (SA review flag F4 / Residual Note 4) was reviewed and **deliberately not adopted**. The residual cross-user exposure (a client-supplied userId can drive the tester against any userId that already has these connections) is a **consciously accepted risk** for this dev/internal tester; the executor's `user_id` scoping and the FR8 redaction constraint remain mandatory regardless.

## Scope — v1 vs Later

### In scope for v1 (DECIDED)

- Schema-derived form for **flat and moderately-nested** inputs: text, number, boolean, and `enum` dropdowns, with required-field validation and defaults — built **schema-generically** (Decision D2).
- **Google Suite plugins only** (Drive, Sheets, Docs, Gmail, Calendar incl. `list_available_slots`) — the actions this initiative just shipped (Decision D2).
- **Live execution** against the user's connected plugin via the existing execute path — real side effects, no dry-run (Decision D1).
- **Destructive-action confirm gate** — lightweight confirm click on delete/clear/revoke-type actions (Decisions D1 + D5).
- **Connection-completeness access gate** (FR12): tester enabled only when the active userId is connected to all five relevant Google Suite plugins; shows connected plugins; prompts to connect any missing ones; sole access gate (Decision D6).
- **New mode inside the existing Plugins tab**, with the current raw-JSON textarea available as an "advanced" toggle beside the generated form (Decision D3).
- **Response display** of the current result: rendered success/error.
- **Live side console** (FR8): persistent, session-scoped, multi-entry request/response history with per-call entries, expand/copy, clear, and secret redaction.
- **userId scoping** (FR11): execute and log under the existing userId field; empty userId blocks execution.
- **Connection/auth status** surfacing.

### Deferred to later (DECIDED / fast-follow)

- `x-dynamic-options` **live pickers** (fetching real folders/labels/calendars into dropdowns) — deferred fast-follow; v1 uses free-text IDs (Decision D4).
- **Non-Google plugins** (Slack, HubSpot, Airtable, etc.) — enabled later with no rework thanks to the schema-generic build (Decision D2).
- Rich structured editors for deeply-nested/array-heavy inputs beyond a scoped JSON sub-editor.
- **Persisted test history** beyond the session (the v1 side console is in-session only) and downloadable/exportable console logs.
- **Saved test cases** (named, reusable parameter sets per action).
- **Response schema validation** (asserting the live response conforms to the action's `output_schema`).
- **Dry-run / read-only-first mode** for mutating actions — explicitly not in v1 (Decision D1); could be revisited if real-data side effects prove too risky in practice.
- Automated assertions / pass-fail scoring (that is the domain of REQ_PLUGIN_TESTING_COMPREHENSIVE, not this manual tester).

## Non-Functional Requirements

- **Security:** This is a testing surface that executes **real** API calls with real side effects. It must run only against the connections of the **userId currently set in the test page** (FR11) — plugin execution stays scoped by that `user_id` and must never reach another user's connections (platform security rule: always scope by `user_id`; no cross-user access). The **sole access gate** is connection-completeness (FR12 / Decision D6): the tester is usable only when that userId has connected all relevant Google Suite plugins. The user consciously chose **not** to add an admin/environment gate; the resulting residual exposure — the userId is **client-supplied**, so the tester can act on behalf of any userId that already has these connections — is a **knowingly accepted risk** for this dev/internal tool. (SA re-confirmation of this substitution for flag F4 is requested before workplan — see Status.) Never expose tokens/credentials in the UI, the current-result view, or the **side console** — auth/bearer headers and any secrets must be redacted **server-side, before the response leaves the API** (see SA review Resolution 2 / flag F2) before any request/response entry is rendered or copied. Follow the project's security rules for any new API route (Zod validation, user scoping). The destructive-action confirm gate is a required safety control given live execution.
- **Standards:** Any new API route follows the standard route pattern (auth, Zod validation, Pino structured logging with correlation ID, consistent error envelope). No direct Supabase calls outside repositories. No hardcoded model/provider names. The schema-to-form logic must read the plugin definition as the **source of truth** — no per-action hardcoding of field lists (consistent with the platform's no-hardcoding principle and Decision D2's schema-generic requirement).
- **Maintainability:** Because the form derives from the plugin definition, adding or changing a plugin action must require **no** change to the tester UI, and enabling a non-Google plugin later must require **no** rework. This is the key advantage over the hand-maintained `PARAMETER_TEMPLATES`.
- **Accessibility:** Standard app a11y for form controls and the side console (labels, keyboard nav, focus states) using the existing design-system primitives.

## Acceptance Criteria

- [ ] From the tester, a user can select a Google Suite plugin and one of its actions and see a form generated from that action's input schema (correct controls, required markers, enum dropdowns, defaults).
- [ ] Required-field validation prevents running an action until all required parameters are provided.
- [ ] "Run" executes the action **live** against the connections of the **userId set in the test page's userId field**, and returns the real API result.
- [ ] With the userId field **empty**, actions cannot run and the tester shows a clear "userId required" state (no execution attempted).
- [ ] The tester is **enabled only when the active userId has connections to all five relevant Google Suite plugins** (Drive, Sheets, Docs, Gmail, Calendar).
- [ ] The tester **displays, per relevant Google Suite plugin, whether it is connected** for the active userId.
- [ ] If **any** relevant plugin is not connected, the tester is **disabled** and **prompts the user to complete the missing OAuth connection(s)**; no action form is runnable until all are connected.
- [ ] Once all relevant plugins are connected, the tester exposes exactly the connected Google Suite plugins and their actions.
- [ ] Destructive actions are visually flagged and require a lightweight confirm click before executing.
- [ ] The response area shows the current run's readable success payload or a clear error.
- [ ] A persistent side console is visible beside the form and appends one entry per plugin API call, showing the request and response; entries **accumulate chronologically across multiple runs** in the session (not just the last result), scoped to the active userId.
- [ ] Each side-console entry is expandable to full request/response JSON and copyable, and the console can be cleared.
- [ ] **No tokens, credentials, bearer/authorization headers, or secrets appear in any side-console entry** (redacted before render/copy) — verified for at least one authenticated Google action.
- [ ] The selected plugin's connection/auth status is visible, and a not-connected/expired plugin produces a clear, actionable state rather than an opaque failure.
- [ ] The tester is a mode within the existing Plugins tab, with a raw-JSON "advanced" toggle available beside the generated form.
- [ ] `x-dynamic-options` fields render as labeled free-text inputs in v1 (no live picker required).
- [ ] Adding a new plugin action to a definition JSON surfaces in the tester with a working form **without** any UI code change; the form logic contains no Google-specific hardcoding.

## Out of Scope / Future Roadmap

- Automated/CI test execution and assertions (owned by REQ_PLUGIN_TESTING_COMPREHENSIVE).
- Bulk/sequential multi-action runs, response comparison across versions, and performance metrics (these appear in the existing test-page "Future Enhancements" list and remain future work).
- Persisted/exportable console history beyond the current session.
- A public/shared version of the tester for non-authenticated users.

## Resolved Decisions (2026-07-27)

The 5 open product questions plus the final gating decision were ratified by the user on 2026-07-27. Preserved here for the decision trail; the sections above are written to these decisions.

| # | Decision | Ruling | Rationale |
|---|----------|--------|-----------|
| D1 | **Execution mode** | **LIVE** against real connected plugins (real side effects). **No dry-run** in v1. Paired with a destructive-action confirm gate (D5). | The point is validating the real API end-to-end; a dry-run engine is significant extra scope. Safety handled via confirm gate instead. |
| D2 | **v1 plugin coverage** | **Google Suite only** (Drive/Sheets/Docs/Gmail/Calendar), but built **schema-generically** so other plugins can be enabled later with no rework. | Focuses v1 on the just-shipped actions while keeping the framework general. |
| D3 | **Placement** | A **new section/mode within the existing `/test-plugins-v2` page**; the current raw-JSON entry becomes an **"advanced" toggle** beside the generated form. Not a separate page. | Reuses the tab's plugin list, connection status, and execute path; avoids duplication. |
| D4 | **ID-type inputs** | **Free-text IDs in v1**; dynamic `x-dynamic-options` pickers (fetch real folders/labels/calendars) **deferred to a fast-follow**. | Keeps v1 shippable; pickers are an additive enhancement. |
| D5 | **Destructive-action confirmation** | **Yes** — a lightweight extra confirm click for destructive actions (delete/clear/revoke). Pairs with D1. | Guards real data given live execution. |
| D6 | **Access model / gating** | The tester is **enabled only when the active userId has OAuth connections to ALL relevant Google Suite plugins** (Drive/Sheets/Docs/Gmail/Calendar); it **shows which are connected** and **prompts to connect any missing ones**. This connection-completeness check is the **SOLE** access gate. The SA-recommended **admin/environment gate (flag F4 / Residual Note 4) was reviewed and NOT adopted.** | User wants a self-serve internal tester gated by **functional readiness**, not by role/environment. The residual cross-user exposure (a client-supplied userId can act on any userId that already has the connections) is a **consciously accepted risk** for this dev/internal tool; `user_id` scoping + server-side redaction remain mandatory. |

## Residual Notes for SA

These are implementation/architecture questions for SA to resolve at workplan time — **not** user decisions:

- **Destructive-action signal:** what exactly marks an action as "destructive" for the confirm gate — the plugin definition's `rules.confirmations` block, a derived capability/verb (delete/clear/revoke), or an explicit definition flag? BA suggestion: read it from the plugin definition (consistent with schema-generic build), not a hardcoded action list. SA to confirm the authoritative field. *(RESOLVED in SA review Resolution 1 — key on `rules.confirmations`.)*
- **Raw request/response availability for the side console:** does `/api/plugins/execute` already expose the raw outbound request payload and the upstream API response needed to populate the side console (FR8), or is a **test-mode passthrough** required to surface them? SA to determine — and to specify the **redaction guard** that strips auth/bearer headers, tokens, and secrets from whatever is returned to the client, so nothing sensitive can reach the console. The tester must never render more than the redacted request/response. *(RESOLVED in SA review Resolution 2 — v1 = client-side Level 1, no backend change; Level 2 deferred behind a mandatory server-side redaction constraint.)*
- **Client-supplied userId guard (FR11) — DECIDED (D6, 2026-07-27):** originally posed here as an open question; the user chose **connection-completeness as the SOLE access gate** (FR12) and **did not adopt** an admin/environment gate. See FR12, Decision D6, and the "User Decision on the Gating Question" note appended to the SA Architectural Review. Residual cross-user exposure is a consciously accepted risk; `user_id` scoping + server-side redaction remain mandatory. Retained here for trace only.
- **Nested/array input rendering:** the exact UX for deeply-nested shapes (structured sub-form vs scoped JSON sub-editor) is an SA/Dev design call within the "usable" requirement. *(RESOLVED in SA review Resolution 3 — scoped JSON sub-editor for complex subtrees.)*
- **Console retention cap:** the most-recent-N entry cap and clear behavior for the side console are SA/Dev details within the "session-scoped, bounded memory" requirement.

## Notes on Integration Points

- **Test page:** `app/test-plugins-v2/page.tsx` — extends the existing **Plugins** tab (userId field, connection-status flow, `PARAMETER_TEMPLATES`, plugin/action selectors, execute + response viewer, connection status) with the new generated-form mode, advanced toggle, connection-completeness gate, and side console.
- **userId flow:** page userId state (default `NEXT_PUBLIC_TEST_PAGE_USER_ID`) → `PluginAPIClient.executeAction(userId, …)` → `POST /api/plugins/execute` (`x-user-id` header) → `plugin-executer-v2.ts` (~line 106) → `base-plugin-executor.ts executeAction(userId, …)` which resolves that user's stored plugin connections.
- **Connection-gate flow (FR12):** reuse `getUserPluginStatus(userId)` for per-plugin connected state and `connectPlugin(userId, pluginKey)` to prompt/complete missing OAuth connections.
- **Test page docs:** [V2_TEST_PAGE_SCOPE.md](/docs/V2_TEST_PAGE_SCOPE.md) must be updated when this ships.
- **Existing precedent:** the page already has a "Debug Logs" panel concept and a `downloadCommunicationHistory` pattern in the Thread Conversation tab — the side console is a related but distinct, plugin-call-focused inspector; SA/Dev may reuse patterns but must keep it schema-generic and redacted.
- **Schema source of truth:** `lib/plugins/definitions/{name}-plugin-v2.json` — per-action `parameters` (JSON Schema), `required_params`/`optional_params`, `x-dynamic-options`, `output_schema`, and destructive/confirmation markers. This is what the form renders from.
- **Execution path:** existing `POST /api/plugins/execute` (real executor via `lib/server/{name}-plugin-executor.ts` + `plugin-executer-v2.ts` / `plugin-manager-v2.ts`).
- **Plugin/status APIs:** `GET /api/plugins/available`, `GET /api/plugins/user-status`, plus connect/refresh routes already used by the page.
- **Client:** `lib/client/plugin-api-client.ts` (`PluginAPIClient`) — the existing client wrapper the page uses.
- **Related requirement:** [REQ_PLUGIN_TESTING_COMPREHENSIVE.md](/docs/requirements/REQ_PLUGIN_TESTING_COMPREHENSIVE.md) — the automated testing counterpart (no overlap; complementary).

---

## SA Architectural Review

**Reviewed by SA — 2026-07-27**
**Status:** ✅ Feasible for workplan, with 2 gating decisions (one needs USER sign-off) and mandatory constraints below.

### Feasibility verdict

**Buildable on the existing `/test-plugins-v2` + `/api/plugins/execute` foundation — with ONE required, additive backend change and NO architectural rewrite.**

The live-execution path (`executeAction(userId, …)` → `POST /api/plugins/execute` → `PluginExecuterV2` → `BasePluginExecutor`) already works and is reused as-is. Three concrete gaps must be closed:

1. **Action schemas are not exposed to the client today.** `GET /api/plugins/available` returns only `actions: string[]` (action *names*). `GET /api/plugins/execute?plugin=X` returns `{name, description, usage_context, parameters}` — it exposes `parameters` but **not** `rules` (confirm gate), `required_params`/`optional_params`, `capability`/`idempotent`, or `output_schema`. The schema-derived form (FR3) and the confirm gate (FR6) therefore need a **read endpoint that returns the full per-action schema block**. Recommendation: add `GET /api/plugins/action-schema?plugin=<key>[&action=<name>]` (or extend the existing `GET /api/plugins/execute`) returning per action: `parameters` (full JSON Schema incl. `x-dynamic-options`), `required_params`/`optional_params`, `rules.confirmations`, `capability`, `idempotent`. This is a new/changed API input boundary → **Zod on the query params, Pino `createLogger`, standard error envelope** are mandatory (see flags).
2. **Confirm-gate data** rides along on that same endpoint (`rules.confirmations`) — see Residual Note 1.
3. **FR8 raw request/response** — see Residual Note 2; v1 is satisfiable client-side with no change to the execute path.

**Schema-generic form generation is confirmed feasible.** Spot-checked Drive, Sheets, Docs, Gmail, Calendar: all action `parameters` are standard JSON Schema (`type`, `properties`, `items`, `enum`, `default`, `minimum`/`maximum`, nested `object`/`array`). **No `oneOf`/`anyOf`/`allOf`/`$ref` anywhere in the Google definitions**, so a naive recursive generator will not hit a construct it can't resolve. The only shapes a naive per-field generator would render badly — and which must fall to the scoped JSON sub-editor (Residual Note 3) — are **arrays-of-objects** (`calendar.create_event.reminders.overrides`, `list_available_slots.working_hours.windows`, `airtable.records`) and **2-D matrices** (`sheets.write_range/append_rows.values`). These are the generator's edge cases, not blockers.

### Resolutions to the 4 Residual Notes

**1. Destructive-action signal for the confirm gate — RESOLVED: key on `rules.confirmations`, not a hardcoded list or `capability` alone.**
- `capability` is **not reliable**: `delete_file`, `clear_range`, `delete_rows`, `delete_label` are `capability: "delete"`, but **`revoke_access` is `capability: "update"`** (same as `rename_file`/`move_file`). Keying on `capability === "delete"` silently misses `revoke_access`.
- **Every one of the 5 destructive actions carries a `rules.confirmations` entry with `action: "confirm"`** and an authored, human-readable `message` (e.g. `delete_file` → "Move this file to Trash? It can be restored… within 30 days."). This is the authoritative, schema-generic, zero-hardcode signal, and it reuses the message the platform already wrote. **Ruling: the confirm gate fires when the selected action's definition has any `rules.confirmations[*].action === "confirm"`, and the tester renders that rule's `message` as the confirm text.**
- Caveat (acceptable for v1): `rules.confirmations` is **also** present on some non-destructive threshold prompts (`list_files`/`search_files` `large_list` at `max_results > 50`). Surfacing a confirm for those is harmless — arguably correct. For the **visual "destructive" red badge** (distinct from the confirm click), additionally treat `capability === "delete"` **OR** `idempotent === false` as the red-flag styling; but the gate itself keys on `rules.confirmations`. Do **not** evaluate the rule `condition` expressions (e.g. `file_id != null`) client-side — presence of a `confirm` rule is sufficient for v1; condition evaluation is fragile string-parsing and out of scope.
- Note: `BasePluginExecutor.executeAction` already computes `confirmations_required` via `validateActionParameters` but currently only logs it and proceeds ("would be handled via UI"). The tester supplies the missing UI. No executor change needed for v1.

**2. Raw request/response for FR8 + MANDATORY redaction — RESOLVED: v1 = client-side Level 1 (no backend change); raw upstream HTTP envelope (Level 2) deferred with a hard redaction constraint.**

Finding: `/api/plugins/execute` returns **only the normalized `ExecutionResult` (`{success, data, message, error}`)**. The raw outbound HTTP request to Google (URL/method/headers/body) and the raw upstream HTTP response body are built and consumed **entirely inside each executor's `executeSpecificAction` → `handleApiResponse`** and are never returned up the stack.

- **v1 (Level 1) — satisfies FR8 as written, zero backend change, zero token risk:** the tester assembles the request client-side (plugin, action, parameters) and already receives the normalized response. The side console logs **{plugin, action, assembled parameters, normalized data/error, timestamp, outcome, duration}** entirely from data the client already holds. FR8's literal text — "the outbound request (plugin, action, parameters/payload sent) and the returned response (success payload or error)" — is fully met by Level 1. **No auth token ever passes through this path** (parameters are user-entered business data; `ExecutionResult.data` is normalized Google payload), so it is safe by construction.
- **Level 2 (true raw upstream HTTP envelope — the "debug an executor without adding logging" story) is DEFERRED.** It requires a test-mode passthrough where executors capture the raw request/response and return them under a debug envelope. If/when built:

> ### 🔒 MANDATORY REDACTION CONSTRAINT (security-critical — applies to any raw-capture path, Level 2 or debug)
> Redaction MUST happen **server-side, inside the executor/route boundary, BEFORE the response leaves the API**. Strip `Authorization`/`Bearer` headers, `access_token`, `refresh_token`, `client_secret`, and cookies from any captured request/response before it is serialized into the API response. **Never rely on client-side redaction** — a client-side redactor means the secret already crossed the wire. The capture site is inside the executor (where `buildAuthHeader`/`connection.access_token` live); that is exactly where the redaction filter must sit. A test-mode/debug flag must default OFF and, if enabled, only ever return the redacted envelope. The tester must render nothing beyond the redacted payload.

**3. Nested/array input UX — RESOLVED: hybrid, JSON sub-editor for complex subtrees.**
Render scalars (`string`/`number`/`boolean`), `enum` dropdowns, and top-level arrays-of-scalars as structured controls. For **nested objects, arrays-of-objects, and 2-D matrices** (`recipients`, `content`, `reminders.overrides`, `working_hours.windows`, `sheets…values`, `initial_data`), render a **scoped JSON sub-editor** (a small JSON textarea bound to that subtree, seeded from `PARAMETER_TEMPLATES`/`default`) rather than recursive sub-forms. Consistent with FR3's "structured sub-form **or** clearly-scoped JSON sub-editor" latitude and the FR4 raw-JSON escape hatch. Full recursive structured editors for these shapes are deferred.

**4. Client-supplied userId guard (FR11) — RESOLVED, but the business trade-off needs USER sign-off (see below).**
Current state: **`/test-plugins-v2` and `/api/plugins/execute` have NO authentication, NO admin gate, and NO Zod** — `userId` is fully client-supplied and the route executes live actions against *any* user's stored connections via the service-role executor path. FR8 makes this materially worse by surfacing that user's request/response data in the console. **Ruling: the tester UI and every new endpoint it introduces (the action-schema endpoint, and any future Level-2 debug capability) MUST be gated to non-production OR authenticated-admin via `AdminAccessService` (NOT `profiles.role` — user-writable, see Security Rules).** The underlying `.eq('user_id', userId)` scoping inside the executor remains mandatory regardless. The pre-existing unauthenticated `/api/plugins/execute` route is flagged as security debt (see flags) — tightening it platform-wide is broader than this requirement and should be a separate TL-tracked item; at minimum the **new** surface must be gated.

### Mandatory / Security-rule flags

| # | Flag | Rule | Severity |
|---|------|------|----------|
| F1 | The **new** action-schema read endpoint must validate its query params with **Zod**, use **Pino `createLogger`**, and return the standard error envelope. | Mandatory Rules 2, 3 | High — blocks approval if skipped |
| F2 | **Redaction of any raw-capture path must be server-side, before the response leaves the API** (see boxed constraint). Not a v1 deliverable, but must be written into the workplan as the constraint gating any Level-2 work. | Security Rules (no secrets to client) | High |
| F3 | **`/api/plugins/execute` is unauthenticated, un-Zod'd, and logs via `console.*` (5 calls).** Pre-existing. Since the workplan *touches this surface*, per CLAUDE.md § Logging the `console.*` calls should be flagged and proposed for Pino conversion; the missing auth/Zod is a security-debt item to escalate to TL (do not silently extend). | Mandatory Rules 2, 3; Security Rules | Medium (pre-existing) — flag, don't necessarily fix in this cycle unless user approves |
| F4 | Tester UI + new endpoints must be **admin/dev-gated** (Residual Note 4). `AdminAccessService`, never `profiles.role`. | Security Rules (admin authz) | High — gates any production exposure |
| F5 | Form/gate logic must read the plugin definition as source of truth — **no per-plugin/per-action hardcoding** (already required by D2/NFR). Confirm gate keys on `rules.confirmations`, not a coded action list. | Platform Design: No Hardcoding | Medium |

No repository-pattern flag: v1 introduces **no persistence** (session-only console). If "saved test cases"/persisted history is ever added, it MUST go through `lib/repositories/` with `user_id` scoping.

### Proposed phasing

- **Phase A — Schema form + live execute + current-result display (FR1–7, FR9–11).** Add the action-schema read endpoint (F1). Build the schema-generic recursive form (scalars/enums/booleans/scalar-arrays structured; complex subtrees → JSON sub-editor, Residual Note 3). Required-field validation, defaults, `x-dynamic-options` → labeled free-text (D4). Reuse existing execute path, connection status, and userId field; empty-userId blocks. Confirm gate (FR6) reads `rules.confirmations` from the new endpoint (Residual Note 1). **Gated behind F4 (admin/dev).** *Gated by: Residual Notes 1, 3, 4.*
- **Phase B — Live side console, Level 1 (FR8).** Client-side capture of assembled request + normalized response, chronological accumulation, expand/copy/clear, retention cap, active-userId scoping. No backend change; no token exposure. *Gated by: Residual Note 2 (Level 1 ruling) — no external dependency, can follow A immediately.*
- **Phase C — Fast-follow (deferred).** `x-dynamic-options` live pickers (D4); and, only if the user still wants true raw upstream HTTP fidelity, Level-2 passthrough **subject to the boxed redaction constraint (F2)**. *Gated by: Residual Note 2 (Level 2), F2.*

### Needs USER decision before workplan (business terms)

1. **Should this tester be locked to admins / non-production only?** It executes **real, irreversible actions against real customer Google accounts** (send email, delete files, clear spreadsheet ranges) on behalf of *any* userId typed in, and the new side console surfaces that account's data. SA recommends admin-or-dev-gated. This is a genuine exposure trade-off (convenience of an open test page vs. a tool that can act on live customer accounts) and should be the user's call. *(Everything else — destructive signal, FR8 Level-1 scope, nested-input UX, redaction constraint — is an SA/architecture decision and is resolved above; no user input needed.)*

### User Decision on the Gating Question — recorded by BA, 2026-07-27

> This subsection is BA-authored and records the user's answer to the SA's "Needs USER decision" item 1 above. It does not modify any SA-authored text.

**Ruling (user, 2026-07-27):** The SA-recommended **admin / non-production gate** (item 1 above, and Residual Note 4 / flag **F4**) was **reviewed and deliberately NOT adopted.** The **sole** access gate is **connection completeness** — see **FR12** and **Decision D6**: the tester is enabled only when the active userId has OAuth connections to all relevant Google Suite plugins (Drive/Sheets/Docs/Gmail/Calendar); it shows which are connected and prompts the user to connect any missing ones. Only once all are connected does the tester expose runnable actions.

- **Consciously accepted risk:** the residual cross-user exposure the SA raised — a client-supplied `userId` can drive the tester against **any** userId that already has those connections, and FR8 surfaces that account's request/response data — is **knowingly accepted** by the user for this dev/internal tester.
- **Still binding, unaffected by this decision:** the executor's `.eq('user_id', userId)` scoping (no leakage beyond the entered userId) and the **server-side redaction constraint (F2)** remain mandatory. Flags **F1 (Zod+Pino on the new endpoint), F2 (redaction), F3 (pre-existing unauthenticated / un-Zod'd / `console.*` `/api/plugins/execute`), and F5 (no hardcoding) are NOT resolved by this decision and stay open/tracked.** In particular, **F3 remains a TL/SA-tracked security-debt item**, independent of the gating choice.
- **Only F4 is superseded.** Because this overrides an SA flag graded **High**, BA requests SA **re-confirm** that connection-completeness is an acceptable substitute for F4 (or formally record the accepted risk) before Dev begins — reflected in the document Status.

### SA Re-Confirmation (2026-07-27)

**Reviewed by SA — 2026-07-27** · **Verdict: ✅ Cleared for Dev workplan (with accepted risk recorded below).**

1. **F4 override — acknowledged and recorded as a user-accepted risk.** SA notes that connection-completeness (FR12/D6) is a **functional-readiness** gate, not an **authorization** gate — it confirms the entered userId *can* run the actions, but does not verify *who is operating the tool*. The residual exposure therefore stands and is explicitly accepted:
   > **Accepted risk (user, 2026-07-27):** the tester runs real, irreversible actions (send email, delete/trash files, clear spreadsheet ranges) against real customer Google accounts on behalf of any client-supplied `userId` that already has the five Google Suite plugins connected, and FR8 surfaces that account's request/response data — with no admin/environment gate. The user has knowingly accepted this cross-user exposure for this dev/internal tester.

   SA records this as accepted and does not re-raise F4 as a blocker.

2. **Optional hardening (not blockers; Dev MAY include).** These reduce exposure without adding the auth/env gate the user declined and do not contradict FR12/D6:
   - **(a) Per-execution audit entry** via `AuditTrailService` — log `{ operatorContext, targetUserId, plugin, action, outcome }` (non-blocking `.catch()`) so every live action taken through the tester is traceable after the fact. Lowest-cost, highest-value; recommended if any hardening is added.
   - **(b) In-UI warning banner** shown whenever the active userId differs from the authenticated session user (or is set from `NEXT_PUBLIC_TEST_PAGE_USER_ID`), making "you are acting on another account's real data" visible at run time.
   - **(c) Non-production default** — default the tester's *entry point* off in production via an existing feature-flag pattern, leaving it trivially enableable, without hard-gating access. This is a soft version of F4 and is compatible with D6.
   - All three are **optional**; omitting them does not block the workplan.

3. **Other flags stand as-is, unaffected by D6:**
   - **F1 (High)** — Zod + Pino + standard error envelope on the new action-schema read endpoint. Still mandatory.
   - **F2 (High)** — server-side redaction (Authorization/Bearer/`access_token`/`refresh_token`/`client_secret`/cookies) before any raw-capture payload leaves the API. Still mandatory for any raw-capture path (deferred Level 2), and reaffirmed by NFR Security.
   - **F3 (Medium, pre-existing)** — `/api/plugins/execute` unauthenticated / un-Zod'd / `console.*` (5 calls). Remains **TL/SA-tracked security debt**, independent of the gating choice; flag the `console.*` for Pino conversion if the workplan touches the route, and escalate the missing auth/Zod to TL rather than silently extending.
   - **F5 (Medium)** — no per-plugin/per-action hardcoding; confirm gate keys on `rules.confirmations`. Still required.

4. **Verdict: Cleared for Dev workplan.** No genuine blocker remains. The sole High-severity item touching production authorization (F4) is superseded by a consciously accepted user risk, recorded above. F1/F2/F5 remain mandatory implementation constraints for the workplan; F3 remains tracked security debt. Phasing A/B/C from the SA Architectural Review is unchanged (Phase A's admin/dev gate is replaced by the FR12 connection-completeness gate).

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-27 | Initial draft | BA drafted the UI-based plugin API tester requirement: goal/business value, current-state context on `/test-plugins-v2`, schema-derived-form functional requirements, v1-vs-later scope, and 5 open product questions for the user (live-vs-dry-run, v1 plugin set, destructive-action confirm, placement, dynamic pickers). Positioned as complementary to REQ_PLUGIN_TESTING_COMPREHENSIVE (manual/interactive vs automated). |
| 2026-07-27 | Decisions folded in; Draft → Ready for SA review | User ratified all 5 open questions. Converted "Open Questions for the user" into "Resolved Decisions (2026-07-27)" (D1 live execution + confirm gate, no dry-run; D2 Google Suite only but schema-generic; D3 mode within existing Plugins tab with raw-JSON advanced toggle; D4 free-text IDs, pickers deferred; D5 destructive-action confirm click). Updated Functional Requirements, v1 Scope, NFRs, and Acceptance Criteria to reflect DECIDED state. Added "Residual Notes for SA" (destructive-action signal source, raw request/response surfacing, nested-input UX). Status → Ready for SA review. |
| 2026-07-27 | Added live side console (request/response inspector) | Added FR8: a persistent, session-scoped side panel that logs every plugin API call exercised through the UI as a running, chronological, multi-entry history (per-call request + response + metadata, expandable/copyable, clearable, bounded). Reconciled with the response display (FR7 = current result; FR8 = running history + home for raw data — no duplication). Reinforced redaction of tokens/credentials/auth headers as an NFR and a dedicated acceptance criterion. Added SA residual note on whether `/api/plugins/execute` exposes raw request/upstream response or needs a test-mode passthrough, plus the redaction guard. Updated Overview, User Stories, Scope, ToC. Status unchanged (additive refinement). |
| 2026-07-27 | SA re-confirmation of gating decision | Appended `### SA Re-Confirmation (2026-07-27)` to the SA review area (no prior SA text altered). Formally acknowledged the F4 override as a **user-accepted risk** and recorded a one-line residual-exposure statement (client-supplied userId + FR8 data surfacing, no admin/env gate). Noted connection-completeness (FR12/D6) is a functional-readiness gate, not an authorization gate. Suggested 3 **optional** hardenings (per-execution `AuditTrailService` entry; cross-account warning banner; non-prod default) — none blockers. Confirmed F1/F2/F5 stand as mandatory and F3 stays TL/SA-tracked security debt. **Verdict: ✅ Cleared for Dev workplan** with accepted risk recorded; no remaining blocker. |
| 2026-07-27 | SA architectural review | Appended `## SA Architectural Review`. Verdict: feasible on existing `/test-plugins-v2` + `/api/plugins/execute` foundation with one additive read endpoint (per-action schema + `rules`); no rewrite. Resolved 4 residual notes: (1) confirm gate keys on `rules.confirmations` (all 5 destructive actions carry a `confirm` rule; `capability` alone misses `revoke_access`); (2) FR8 v1 = client-side Level-1 capture (no backend change, no token path); raw upstream HTTP envelope deferred behind a MANDATORY server-side redaction constraint; (3) nested/array inputs → scoped JSON sub-editor; (4) tester + new endpoints must be admin/dev-gated (`AdminAccessService`, not `profiles.role`). Flags: new endpoint needs Zod+Pino (F1); redaction server-side (F2); pre-existing unauth'd/un-Zod'd/`console.*` execute route (F3); admin gate (F4); no hardcoding (F5). Phasing A/B/C. One USER decision surfaced: lock the tester to admin/non-prod given it acts on real customer accounts. |
| 2026-07-27 | Added explicit userId scoping | Added FR11: the tester executes under the userId set in the existing test-page userId field (default `NEXT_PUBLIC_TEST_PAGE_USER_ID`; no separate identity mechanism); all executions run against that user's connected plugins via the existing `executeAction(userId, …)` → `/api/plugins/execute` (`x-user-id`) → `plugin-executer-v2.ts` → `base-plugin-executor.ts` path; empty userId blocks execution (mirrors existing `if (!userId.trim())` guards) as expected behavior. Scoped FR8 side console to the active userId. Added security note that the userId is client-supplied and execution must stay `user_id`-scoped (no cross-user access), redaction still applies. Added SA residual note on whether the client-supplied test-page userId pattern needs an additional environment/route guard. Updated Overview, Context, User Stories, NFR Security, Scope, Acceptance Criteria, Integration Points. Status unchanged (additive refinement). |
| 2026-07-27 | Gating decision (D6): connection-completeness = sole access gate | User's final gating decision recorded. Added **FR12** (tester enabled only when the active userId is connected to ALL relevant Google Suite plugins; shows connected plugins; prompts to connect missing ones; sole gate) and **Decision D6**. Added acceptance criteria for the gate. Reconciled with the SA review WITHOUT altering SA-authored text: appended a BA-authored "User Decision on the Gating Question" subsection answering the SA's "Needs USER decision" item 1 — the SA-recommended admin/env gate (flag F4 / Residual Note 4) was reviewed and NOT adopted; residual cross-user exposure is a consciously accepted risk. Flags F1/F2/F3/F5 remain open — **F3 stays TL/SA-tracked security debt, not resolved by this decision**; only F4 is superseded. Updated Overview, FR1/FR11, NFR Security, Scope, Residual Notes, Integration Points, ToC. **Status → Requirement finalized; Ready for workplan pending SA re-confirmation of the gating substitution.** |
