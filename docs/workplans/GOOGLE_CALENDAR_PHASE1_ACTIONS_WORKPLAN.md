# Workplan: Google Calendar Plugin — Phase 1 Availability Actions

> **Last Updated**: 2026-07-27

**Developer:** Dev
**Requirement:** [GOOGLE_SUITE_PLUGIN_ROBUSTNESS_REQUIREMENT.md](/docs/requirements/GOOGLE_SUITE_PLUGIN_ROBUSTNESS_REQUIREMENT.md) (✅ Approved — Phase 1 Calendar slice)
**Branch:** `feature/google-suite-phase1-actions` — ✅ confirmed current branch (`git branch --show-current`). This document is workplan-only; **no implementation code** is written until SA workplan-review passes. RM owns branch creation and the eventual merge; Dev never commits to `main`.
**Status:** Code Complete (awaiting SA code review)

## Overview

This workplan covers the **Phase 1 Google Calendar slice** of the Google Suite robustness requirement: **2 new read-only actions** on the existing `google-calendar` V2 plugin that lay the **availability foundation** for the Phase 2 `list_available_slots` and Phase 3 booking surface — without doing any slot math in this slice.

1. `get_free_busy` — query busy/free intervals over a time window via Calendar `freebusy.query` (`POST /freeBusy`). Inputs: time window (RFC3339 start/end) + which calendar(s) to query (default `primary`). Output: busy intervals per calendar. **Must-have** per the requirement's Additional-Capabilities shortlist. Returns **raw busy/free data only — NO slot computation** (that is the Phase 2 `list_available_slots` action per the SA feasibility table). 🟢
2. `list_calendars` — list the user's calendars via `calendarList.list` (`GET /users/me/calendarList`). Output: id/summary/timezone/primary/access-role per calendar. **Nice-to-have** per the requirement (surface `list_calendars` as a first-class action so multi-calendar users can target the right calendar). 🟢

Both fit the **already-granted `https://www.googleapis.com/auth/calendar` scope** — confirmed against `google-calendar-plugin-v2.json` (`required_scopes` includes `calendar` + `calendar.events`). `freebusy.query` and `calendarList.list` are both covered by the `calendar` scope. **No new OAuth scope, no re-consent, no Google app re-verification.** Purely additive. Both actions are **read-only → naturally idempotent** with no destructive/confirmation concerns.

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [Files to Create / Modify](#files-to-create--modify)
4. [Per-Action Specifications](#per-action-specifications)
5. [Task List](#task-list)
6. [Testing](#testing)
7. [Standards & Risks](#standards--risks)
8. [Open Questions for SA](#open-questions-for-sa)
9. [SA Review Notes](#sa-review-notes)
10. [QA Testing Report](#qa-testing-report)
11. [Commit Info](#commit-info)
12. [Change History](#change-history)

---

## Analysis Summary

**What this touches:**

| Layer | File | Change |
|---|---|---|
| Plugin definition | `lib/plugins/definitions/google-calendar-plugin-v2.json` | Add 2 entries to `actions{}`; bump `plugin.version` `1.0.0` → `1.1.0` |
| Executor | `lib/server/google-calendar-plugin-executor.ts` | Add 2 `switch` cases + 2 private methods (`getFreeBusy`, `listAllCalendars`). **No logging conversion needed — file is already zero-`console.*`** |
| Registry | `lib/server/plugin-executer-v2.ts` | **No change** — `google-calendar` already registered |
| Plugin manager | `lib/server/plugin-manager-v2.ts` | **No change** — definition auto-loaded; actions auto-discovered by CapabilityBinder |
| Test page | `app/test-plugins-v2/page.tsx` | Add 2 `PARAMETER_TEMPLATES` entries under `"google-calendar"` (smoke-check UX) |
| Unit tests | `tests/plugins/unit-tests/google-calendar.test.ts` | Add LEAN 3-per-action unit coverage (6) + 1 safety assertion |
| Integration tests | `tests/plugins/integration-tests/google-calendar.integration.test.ts` | **Create** credential-gated coverage (skips without `GOOGLE_CALENDAR_TEST_TOKEN`) |
| Integration config | `tests/plugins/integration-tests/integration-config.ts` | Register `google-calendar` in `CREDENTIAL_MAP` (new — no entry today) |
| Plugin doc | `docs/plugins/google-calendar-plugin.md` | Document both new actions + version-history bump; Last Updated 2026-07-27 |

**Confirmed from code grounding:**

- **Executor contract (`base-plugin-executor.ts`):** the base `executeAction` template handles param normalisation, the runtime param-constraint guard, schema validation, confirmation surfacing (**advisory only** — lines 69–74 log "Confirmations required (would be handled via UI)" and do **not** block), connection retrieval, success formatting, and error mapping. Each new action = one `case` in `executeSpecificAction` (dispatch confirmed at line 110) + one private method that makes the Google call and returns a schema-shaped object.
- **Auth:** `connection.access_token` bearer, exactly as the existing 5 Calendar actions do. Never log the token.
- **Base URL:** `this.googleApisUrl = 'https://www.googleapis.com'` (from `google-base-plugin-executor.ts:18`). So `freebusy.query` → `POST ${this.googleApisUrl}/calendar/v3/freeBusy`; `calendarList.list` → `GET ${this.googleApisUrl}/calendar/v3/users/me/calendarList`.
- **HTTP style:** the Calendar executor uses **raw `fetch` + manual `!response.ok` throw** for every action method (`throw new Error(\`Calendar API error: ${status} - ${errorData}\`)`), then formats structured output. New methods follow the same raw-fetch style. It does **not** use the base `handleApiResponse`.
- **Return shape:** existing actions return a **dual snake_case + legacy camelCase** object with an `x-guaranteed` `*_at`/`retrieved_at` timestamp. New actions follow suit (snake_case primary fields + a camelCase mirror for parity with the file's convention).
- **RFC3339 datetime convention:** `list_events` already takes `time_min`/`time_max` string params (described "ISO 8601 format, e.g. '2024-01-01T00:00:00Z'") and passes them straight through as `timeMin`/`timeMax` query params. `get_free_busy` **reuses the exact same `time_min`/`time_max` param names** (RFC3339 == the ISO 8601 profile Google requires here) — one consistent time vocabulary across the plugin.
- **⚠️ Naming collision — `list_calendars`:** the executor **already has a public method `list_calendars(connection, options)`** (line 514) that is the **dynamic-options dropdown fetcher** — it is referenced by every existing action's `calendar_id` param via `x-dynamic-options: { source: "list_calendars" }`, returns `{ value, label, description, icon, group }[]`, and is invoked via `PluginExecuterV2.fetchDynamicOptions` → `executor[source]`, **not** through the action switch. The new **action** `list_calendars` must dispatch (via the `executeSpecificAction` switch) to a **distinctly-named private method** — proposed `listAllCalendars` — mirroring the Gmail slice's `list_labels` → `listAllLabels` resolution. The dropdown fetcher stays **untouched**. Confirmed via `base-plugin-executor.ts:110` that the switch is the only action path (no `executor[actionName]` dynamic-dispatch fallback that could shadow the fetcher). See [OQ2](#open-questions-for-sa).
- **Logging:** the executor uses `this.logger` (Pino) throughout — `this.logger.debug(...)` for the `DEBUG:` traces and `this.logger.error({ err, status }, ...)` on failures. **Grep-confirmed: 0 `console.*` calls in `google-calendar-plugin-executor.ts`.** No Mandatory-Rule-3 conversion is required for this file (positive finding — reported in [Standards & Risks](#standards--risks)). Contrast the Sheets slice, which had 1 `console.error` at line 247.
- **Registry/manager:** `google-calendar` is present in `plugin-executer-v2.ts`; the definition JSON is auto-loaded and actions auto-discovered. **No wiring changes.**
- **Version state (no drift this time):** `google-calendar-plugin-v2.json` `plugin.version` is `1.0.0` **and** `docs/plugins/google-calendar-plugin.md` header reads `1.0.0` — they already agree (unlike the Gmail JSON-vs-doc `1.0.0`/`1.1.0` drift). This slice sets **BOTH** to `1.1.0` in the same change (applying the drift lesson: bump JSON and doc together to the same version). See [OQ5](#open-questions-for-sa).
- **Integration harness:** there is **no** `google-calendar.integration.test.ts` today and **no** `google-calendar` entry in `integration-config.ts`'s `CREDENTIAL_MAP`. Both are created in this slice (credential-gated, skip-without-token), mirroring the `google-sheets` entry shape.

---

## Implementation Approach

**One executor method per action, each a thin typed wrapper over the relevant Calendar REST call**, returning a snake_case (+ legacy camelCase) object matching the action's `output_schema`. Both actions are read-only.

**Root-cause phase (per CLAUDE.md V6 protocol):** This is **plugin-layer work only**. No V6 pipeline/compiler changes — the actions are standard-shaped and auto-discovered by CapabilityBinder. Per Platform Design Principles, **no plugin-specific rules are added to any system prompt or the compiler**; the definition schema (`domain`/`capability`/`input_entity`/`output_entity`/cardinality/`output_dependencies`) is the sole source of truth.

### Idempotency (reasoned from Calendar API semantics — no hacks)

| Action | Idempotent? | Reasoning |
|---|---|---|
| `get_free_busy` | **`true`** | Pure read (`freebusy.query`). Re-running over the same window returns the same busy intervals (barring underlying calendar changes). No state mutated. |
| `list_calendars` | **`true`** | Pure read (`calendarList.list`). No state mutated. |

### Safety / privacy (read-only — no destructive or confirmation concerns)

- **Both actions are read-only** → no `rules.confirmations`, no destructive posture, no trash-vs-delete decision. Nothing to gate.
- **`get_free_busy` is privacy-sensitive in principle but returns only busy/free intervals** (`{ start, end }` per calendar) — the `freebusy.query` API itself never returns event summaries, attendees, or descriptions. The executor **must keep it that way**: map **only** the `start`/`end` of each busy block into the output; never enrich a busy interval with event detail from a secondary call. This is stated in `usage_context` and is the privacy invariant the SA Architectural Review flagged ("freebusy is privacy-safe busy/free only — keep it that way").
- **`get_free_busy` malformed-time-window guard (the one genuine risk):** validate that `time_min` and `time_max` are present and that `time_min < time_max` **before** issuing the fetch, rejecting an inverted/degenerate window with a clean `invalid_time_range` validation error. This is the single safety-critical property for this slice and gets one dedicated unit assertion (see [Testing](#testing)). `list_calendars` has no such risk (no meaningful input).

### Calendar-count bound (`get_free_busy`)

`freebusy.query` accepts at most **50 calendars** per call (`calendarExpansionMax`). A `rules.limits` entry (`calendar_ids_count > 50` → block) is declared for catalog uniformity, and the executor additionally guards `calendar_ids.length` before the call. (Consistent with the platform note that `rules.limits` is advisory/inert pending `extractRuleContext` `${param}_count` coverage — task_2ea2e007 — so real enforcement is the in-executor guard, not the declarative rule. Since Google enforces the 50-cap server-side anyway, this is a lightweight fail-fast, not a new safety test.)

---

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/plugins/definitions/google-calendar-plugin-v2.json` | modify | Add 2 action definitions (full top-level metadata block, `x-dynamic-options` on calendar inputs, output_schema, output_guidance/common_errors, `rules.limits` on `get_free_busy` calendar count); bump `plugin.version` → `1.1.0` |
| `lib/server/google-calendar-plugin-executor.ts` | modify | Add 2 `switch` cases + 2 private methods (`getFreeBusy`, `listAllCalendars`). No logging conversion (already zero `console.*`) |
| `app/test-plugins-v2/page.tsx` | modify | Add 2 `PARAMETER_TEMPLATES` entries under `"google-calendar"` |
| `tests/plugins/unit-tests/google-calendar.test.ts` | modify | Add LEAN 3-per-action unit tests (6) + 1 `get_free_busy` malformed-window safety assertion |
| `tests/plugins/integration-tests/google-calendar.integration.test.ts` | **create** | Credential-gated lifecycle coverage (skips without `GOOGLE_CALENDAR_TEST_TOKEN`) |
| `tests/plugins/integration-tests/integration-config.ts` | modify | Add `google-calendar` entry to `CREDENTIAL_MAP` (`GOOGLE_CALENDAR_TEST_TOKEN` + optional `GOOGLE_CALENDAR_TEST_CALENDAR_ID`) |
| `docs/plugins/google-calendar-plugin.md` | modify | Document both new actions + version-history bump; version → `1.1.0`; Last Updated 2026-07-27 |

**Not touched / not needed:**
- `lib/server/plugin-executer-v2.ts`, `lib/server/plugin-manager-v2.ts` — no registry/manager change (auto-discovery).
- The existing public `list_calendars` dropdown fetcher (line 514) — **left as-is**; the new action uses the distinct `listAllCalendars` method.

---

## Per-Action Specifications

Notation: `→` = maps to. Base host is `this.googleApisUrl` (= `https://www.googleapis.com`).

### 1. `get_free_busy` 🟢

| Field | Value |
|---|---|
| **Google API** | `POST /calendar/v3/freeBusy` with body `{ timeMin, timeMax, timeZone?, items: [{ id }] }` |
| **domain** `calendar` · **capability** `get` · input_entity `null` · output_entity `free_busy` (descriptive only — no `x-semantic-type`, see [OQ3](#open-questions-for-sa)) · cardinalities `null`/`collection` |
| **idempotent** | `true` |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `calendar_ids` | string[] | ❌ (default `["primary"]`) | Which calendar(s) to query. Bounded ≤ 50 (`calendarExpansionMax`). `x-dynamic-options: { source: "list_calendars" }` (the existing dropdown fetcher). **Shape = array** because multi-calendar querying is freebusy's core value — see [OQ1](#open-questions-for-sa). |
| `time_min` | string | ✅ | RFC3339 window start (e.g. `2026-03-27T00:00:00Z`). Same param name + format as `list_events.time_min`. |
| `time_max` | string | ✅ | RFC3339 window end. **Required** for freebusy (unlike `list_events` where `time_max` is optional). |
| `time_zone` | string | ❌ (default `UTC`) | IANA timezone for interpreting the response (`timeZone` field). |

**Method logic:** (1) validate `time_min`/`time_max` present and `time_min < time_max` (else `invalid_time_range` — **before** any fetch); guard `calendar_ids.length ≤ 50`. (2) build `items = calendar_ids.map(id => ({ id }))`. (3) `POST …/freeBusy` with `{ timeMin, timeMax, timeZone, items }`. (4) parse `data.calendars` (a map keyed by calendar id) → for each, emit `{ calendar_id, busy: [{ start, end }], errors? }` copying **only** `start`/`end` from each busy block (privacy invariant) and surfacing any per-calendar `errors` array Google returns (e.g. `notFound`). Return `{ calendars: [...], time_min, time_max, time_zone, queried_at }`.

**Output schema (key fields):** `calendars` (array of `{ calendar_id, busy: [{ start, end }], errors? }`), `time_min` / `time_max` / `time_zone` (echoed), `queried_at` (x-guaranteed timestamp). **No `x-semantic-type`** on the busy-interval items (output-leaf; consistent with `list_events.events` being unannotated — see [OQ3](#open-questions-for-sa)).

**Confirmation/safety:** none (read-only). Privacy invariant: only `start`/`end` surfaced. `common_errors`: `auth_failed`, `calendar_not_found`, `invalid_time_format`, `invalid_time_range`, `permission_denied`, `api_rate_limit`, `insufficient_permissions`.

### 2. `list_calendars` 🟢

| Field | Value |
|---|---|
| **Google API** | `GET /calendar/v3/users/me/calendarList` (optional `minAccessRole` query param) |
| **domain** `calendar` · **capability** `list` · input_entity `null` · output_entity `calendar` (descriptive only — no `x-semantic-type`, see [OQ3](#open-questions-for-sa)) · cardinalities `null`/`collection` |
| **idempotent** | `true` |
| **executor method** | `listAllCalendars` (⚠️ **not** `list_calendars` — that name is the dropdown fetcher; see [OQ2](#open-questions-for-sa)) |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `min_access_role` | string (enum `freeBusyReader`/`reader`/`writer`/`owner`) | ❌ | Optional filter passed through as `minAccessRole` — only return calendars where the user has at least this role. Omitted ⇒ all calendars. |

**Method logic:** `GET …/users/me/calendarList` (append `minAccessRole` when provided); map each `data.items[]` to `{ id, summary, description?, time_zone, primary, access_role }`. Return `{ calendars: [...], total_found, listed_at }`.

**Output schema (key fields):** `calendars` (array of `{ id, summary, description, time_zone, primary, access_role }`), `total_found` (integer), `listed_at` (x-guaranteed timestamp). **No `x-semantic-type`** on the item (output-leaf: a `calendar_id` is consumed downstream only as a plain string param, e.g. `list_events.calendar_id` / `get_free_busy.calendar_ids` — never as a bindable input entity; consistent with `list_events.events` being unannotated — see [OQ3](#open-questions-for-sa)).

**Confirmation/safety:** none (read-only). `common_errors`: `auth_failed`, `api_rate_limit`, `insufficient_permissions`.

---

## Task List

**Definition JSON (`google-calendar-plugin-v2.json`)**
- [x] ✅ Add `get_free_busy` (full top-level metadata block, `x-dynamic-options { source: "list_calendars" }` on `calendar_ids`, output_schema with `calendars[]`/`queried_at` x-guaranteed, `rules.limits` `calendar_ids_count > 50`, common_errors incl. `invalid_time_range`, `idempotent: true`, privacy note in `usage_context`)
- [x] ✅ Add `list_calendars` (full block, optional `min_access_role` enum, output_schema with `calendars[]`/`total_found`/`listed_at`, common_errors, `idempotent: true`)
- [x] ✅ Bump `plugin.version` `1.0.0` → `1.1.0` (OQ5)

**Executor (`google-calendar-plugin-executor.ts`)**
- [x] ✅ Add 2 `case` branches to `executeSpecificAction` switch (`get_free_busy` → `this.getFreeBusy`, `list_calendars` → `this.listAllCalendars`)
- [x] ✅ `getFreeBusy()` — time-window guard (`time_min < time_max`, both present RFC3339) + 50-calendar guard **before** fetch → `POST /freeBusy` → parse `data.calendars` map → per-calendar `{ calendar_id, busy:[{start,end}], errors? }` (start/end only — privacy; per-calendar errors surfaced, not thrown — CR-1)
- [x] ✅ `listAllCalendars()` — **distinct method name** (not the `list_calendars` dropdown fetcher, OQ2); `GET /users/me/calendarList` (+ optional `minAccessRole`) → `{ id, summary, description, time_zone, primary, access_role }[]`
- [x] ✅ Confirm all new methods use `this.logger` only (file remains **zero** `console.*` — grep-confirmed 0)
- [x] ✅ Verify no `executor[actionName]` dynamic-dispatch fallback shadows the switch (confirmed `base-plugin-executor.ts:110` dispatches only via `executeSpecificAction`)

**Wiring**
- [x] ✅ Confirm NO registry/manager change needed (definition auto-loaded; `google-calendar` already in `plugin-executer-v2.ts`)
- [x] ✅ Add 2 `PARAMETER_TEMPLATES` entries under `"google-calendar"` in `app/test-plugins-v2/page.tsx` (no new `console.*`; pre-existing client DEBUG logs left as-is)

**Tests** (see [Testing](#testing))
- [x] ✅ Unit: LEAN 3 per action — happy + auth-failure (401) + invalid-input (6 total)
- [x] ✅ Unit: **S1 safety assertion** — `get_free_busy` inverted/degenerate window (`time_min >= time_max`) → `invalid_time_range`, **no fetch issued**
- [x] ✅ Unit: **S2 partial-error assertion (CR-2)** — one calendar with `errors`, another with `busy` → both surfaced, action succeeds (not thrown)
- [x] ✅ Integration: **created** `google-calendar.integration.test.ts` (skips without `GOOGLE_CALENDAR_TEST_TOKEN`) — `list_calendars` (assert primary) + `get_free_busy` over a live window (assert per-calendar busy shape is start/end only) + inverted-window guard
- [x] ✅ Register `google-calendar` in `integration-config.ts` `CREDENTIAL_MAP`
- [x] ✅ `x-semantic-type` check: neither action introduces a new type (type-clean, OQ3) — no `input-type-compat.ts` change
- **Result: `npx jest tests/plugins/unit-tests/google-calendar.test.ts --runInBand` → Test Suites: 1 passed; Tests: 27 passed, 27 total (3.073 s).**

**Docs**
- [x] ✅ Update `docs/plugins/google-calendar-plugin.md`: added `get_free_busy` + `list_calendars` action sections + version-history row; version → `1.1.0`; Last Updated 2026-07-27; fixed the `update_event` PATCH→GET+PUT HTTP-method row (OQ4/CR-3).

---

## Testing

Follows the existing `tests/plugins/unit-tests/google-calendar.test.ts` harness (`createTestExecutor`, `expectSuccessResult`, `expectErrorResult`, `expectFetchCalledWith` from `../common/test-helpers`; `mockFetchSuccess`, `mockFetchError`, `mockFetchSequence`, `restoreFetch` from `../common/mock-fetch`), matching the `[smoke]` (happy) / `[full]` (failure + safety) split used today.

### LEAN test policy (binding — user directive)

**Exactly 3 unit tests per action: happy path + auth-failure (401) + invalid-input. 6 total.** Plus **exactly 1 safety-critical assertion** — the `get_free_busy` malformed-window guard, the only genuine risk in this read-only slice. `list_calendars` gets **no** safety assertion (no meaningful input / no risk). Deeper coverage → the credential-gated integration file.

| Action | Happy path (mock) | Auth failure | Invalid input |
|---|---|---|---|
| `get_free_busy` | `POST /freeBusy` 200 → `calendars[].busy[{start,end}]` parsed; `expectFetchCalledWith('/freeBusy','POST')` | 401 → `expectErrorResult` | missing `time_max` → validation error |
| `list_calendars` | `GET /calendarList` 200 → `calendars[]` + `total_found`; `expectFetchCalledWith('users/me/calendarList')` | 401 → `expectErrorResult` | invalid `min_access_role` enum → validation error |

**Safety-critical assertion (the only permitted extra — 1 total, minimal):**

| # | Action | Assertion |
|---|---|---|
| S1 | `get_free_busy` | An **inverted/degenerate** window (`time_min >= time_max`) resolves to an `invalid_time_range` error **before any network call** — `getAllFetchCalls()` is empty (guard precedes the fetch). Protects against issuing a malformed/unbounded freebusy query. |

> Note: the privacy invariant (busy intervals carry only `start`/`end`, never event summaries) is verified structurally in the happy-path assertion (the mocked freebusy response is mapped to `{start,end}`-only items) and exercised end-to-end in the integration test — it does not need a separate unit slot, since `freebusy.query` never returns summaries in the first place.

### Scoped fast command

```bash
npx jest tests/plugins/unit-tests/google-calendar.test.ts
```

Expected: existing Calendar suite stays green; +6 LEAN unit tests + 1 safety assertion for the 2 new actions.

### Integration tests

**Create** `tests/plugins/integration-tests/google-calendar.integration.test.ts` (skips without `GOOGLE_CALENDAR_TEST_TOKEN`, mirroring the `google-sheets` skip-without-token pattern) plus a `google-calendar` entry in `integration-config.ts` `CREDENTIAL_MAP`. Lifecycle: `list_calendars` (assert `primary` present) → `get_free_busy` over a live window on the primary calendar (assert each returned busy block has `start`/`end` and **no** `summary`/event-detail keys — the privacy invariant).

---

## Standards & Risks

- **Logging (Mandatory Rule 3) — no action needed for the executor.** `lib/server/google-calendar-plugin-executor.ts` contains **exactly 0 `console.*` calls** (grep-confirmed) — it already uses `this.logger` (Pino) throughout, with structured context and `{ err }` on errors. Both new methods will use `this.logger` only. **No conversion required.** (Contrast the Sheets slice, which had 1 `console.error` at line 247.)
- **Touched-file logging flag (CR-B parity):** this slice also modifies `app/test-plugins-v2/page.tsx` (adding `PARAMETER_TEMPLATES`). That file contains **pre-existing client-side `console.*` `DEBUG` logs** (the same ones the user chose to LEAVE in the Drive/Sheets/Gmail slices — it is a `'use client'` component where Pino/`createLogger` is server-only, so it is **not** a straight conversion). Surfaced per CLAUDE.md § Logging "non-compliant files you touch"; **no new `console.*` added**, and no conversion unless the user decides otherwise. **This is the only logging item that needs user awareness in this slice.**
- **OAuth scope:** ✅ **No new scope.** `get_free_busy` (`freebusy.query`) and `list_calendars` (`calendarList.list`) both fit the already-granted `https://www.googleapis.com/auth/calendar` scope declared in `google-calendar-plugin-v2.json` (`required_scopes`). Zero re-consent, zero Google app re-verification. Confirmed against the definition.
- **Idempotency:** both read-only → `idempotent: true`. No executor-side dedupe (none needed).
- **Safety / privacy:** both read-only → no `rules.confirmations`, no destructive posture. `get_free_busy` privacy invariant: surface only `start`/`end` per busy block, never event detail (freebusy never returns detail anyway — the executor must not enrich). The one real risk is a malformed time window → guarded before the fetch (S1 assertion).
- **No hardcoding:** no plugin-specific rules added to any system prompt or the compiler; the definition schema is the sole source of truth (Platform Design Principles).
- **Repository pattern / Supabase:** N/A — executors are stateless; no DB writes in this slice.
- **V6 pipeline / type-cleanliness:** no compiler changes; actions are standard-shaped and auto-discovered. **Recommend keeping this slice type-clean:** neither `get_free_busy` (busy intervals) nor `list_calendars` (calendar objects) introduces a new `x-semantic-type` — both are output-leaf, and a `calendar_id` is consumed downstream only as a plain string param (never a bindable input entity), exactly the reasoning that placed `gmail_label` in the ToType-only extras list. This is consistent with the existing `list_events.events` array carrying **no** `x-semantic-type`. So **no `input-type-compat.ts` change is expected.** (Contrast Phase 2's `list_available_slots`, which the requirement says WILL need a new `time_slot` type — explicitly **out of scope** here.) Run `validatePluginTypeAnnotations` to confirm nothing unknown slipped in. See [OQ3](#open-questions-for-sa) for the parity alternative (register `google_calendar` as an output-leaf like `gmail_label`), which I recommend against.
- **`list_calendars` naming collision:** the new action's executor method is `listAllCalendars`, NOT the existing public `list_calendars` dropdown fetcher (line 514). Dispatch is switch-only (`base-plugin-executor.ts:110`), so there is no shadow risk. Flagged (OQ2).
- **Version reconciliation:** JSON and doc both currently `1.0.0` (no drift). Set BOTH to `1.1.0` in this slice (drift-prevention lesson from Drive/Sheets — bump together). See OQ5.

---

## Open Questions for SA

1. **`get_free_busy` calendar-selection input shape (must-answer).** I propose `calendar_ids: string[]` (default `["primary"]`, bounded ≤ 50) with `x-dynamic-options: { source: "list_calendars" }`, rather than a single `calendar_id` string. Rationale: querying availability **across multiple calendars** (work + personal + team) is the core value of `freebusy.query` (it accepts an `items[]` array), and a single-string param would throw that away. The trade-off: every existing Calendar action binds `x-dynamic-options` to a **single** `calendar_id` string, so an **array**-typed dropdown binding is new for this plugin — confirm the dropdown/multi-select binding works for an array param, or whether SA prefers a single `calendar_id` string for v1 (simpler, but drops multi-calendar). **Recommendation: `calendar_ids` array.**
2. **`list_calendars` method-name collision.** The executor already has a public `list_calendars(connection, options)` **dropdown fetcher** (line 514, returns `{value,label,...}[]`, used by every action's `calendar_id` dropdown). The new **action** must dispatch to a distinctly-named private method. **Recommendation: `listAllCalendars`** (mirrors the Gmail slice's `listAllLabels`), leaving the dropdown fetcher untouched. Confirm the name and that the dropdown fetcher stays as-is.
3. **V6 type-cleanliness — no new semantic type (recommend) vs. `google_calendar` output-leaf for `gmail_label` parity.** Neither action needs a bindable input type; `calendar_id` flows downstream as a plain string. I recommend **no `x-semantic-type`** on either action's output items (type-clean; matches `list_events.events` being unannotated → no `input-type-compat.ts` change). The alternative is registering `google_calendar` (and/or a `busy_period`) as an **output-leaf** in `TO_TYPE_EXTRAS` for symmetry with the `gmail_label` decision. **Recommendation: stay type-clean (no annotation, no registry change); reserve the `time_slot` type work for Phase 2.** Confirm.
4. **Plugin-doc scope + a pre-existing doc bug.** The Calendar doc currently documents all 5 existing actions accurately, so there is **no back-fill gap** (unlike the Sheets slice). This slice adds the 2 new action sections + version history. While in the file, I noticed `update_event`'s "HTTP Method" row says **PATCH** but the executor actually does a GET-then-**PUT** (lines 265/312). Should I correct that doc row in this pass (small, improves accuracy) or leave it strictly scoped to the 2 new actions?
5. **Version number.** Both `google-calendar-plugin-v2.json` `plugin.version` and the plugin doc header are `1.0.0` (no drift). Proposed: bump **both** to `1.1.0` (2 new additive actions), set in the same change. Confirm `1.1.0`.
6. **`get_free_busy` capability + output_entity metadata.** I propose `capability: "get"` (a query/computation over a window) with `output_entity: "free_busy"` as a **descriptive** label carrying **no** `x-semantic-type` (so it does not register a type). Alternative: `capability: "list"` with `output_entity: null`. **Recommendation: `capability: "get"`, `output_entity: "free_busy"` (descriptive only).** Confirm, since this is the availability primitive Phase 2 will build `list_available_slots` on top of.

---

## SA Review Notes

_(SA to populate during workplan review.)_

---

## SA Workplan Review

**Reviewed by SA — 2026-07-27**
**Status:** ✅ **Approved for implementation** (no changes required to start; 3 small binding conditions folded into the tasks below)

Ground-truth confirmed against code before writing this review:
- `google-calendar-plugin-executor.ts` switch dispatches exactly 5 actions (`list_events`/`create_event`/`update_event`/`delete_event`/`get_event_details`); no collision with the two new action names.
- Public dropdown fetcher `list_calendars(connection, options)` exists at line 514 and is wired to every existing action's `calendar_id` via `x-dynamic-options: { source: "list_calendars" }`.
- `base-plugin-executor.ts:110` dispatches **only** via `executeSpecificAction` (the subclass switch). There is **no** `executor[actionName]` dynamic-dispatch fallback → the public `list_calendars` method cannot shadow, and cannot be reached as, an action. OQ2 resolution is sound.
- **0 `console.*`** in the executor (uses `this.logger` throughout) — confirmed. No Mandatory-Rule-3 conversion for this file.
- OQ4 confirmed: `update_event` does **GET (line 265) + PUT (line 313)**, not PATCH. The doc's "PATCH" row is a genuine pre-existing bug.
- `required_scopes` includes `calendar` + `calendar.events` (JSON lines 23–24) → `freebusy.query` and `calendarList.list` both covered. No new scope.
- JSON `plugin.version` is `1.0.0` (line 4); doc header `1.0.0` — aligned, no drift.
- Unit test file exists (→ modify); no `google-calendar.integration.test.ts` and no `google-calendar` in `integration-config.ts` `CREDENTIAL_MAP` (→ create/add). File table is accurate.

### Decisions on the 6 Open Questions

**OQ1 — `get_free_busy` calendar selection → `calendar_ids: string[]` (array). ✅ APPROVED (Dev's recommendation).**
Rationale: multi-calendar querying is the native shape of `freebusy.query` (`items:[{id}]`) and the whole point of the primitive; a single-string param throws away the core value and would force Phase 2 `list_available_slots` to re-plumb it. The array-binding concern Dev flagged is **not** a real risk:
- `x-dynamic-options` dispatch (`fetchDynamicOptions → executor[source]`) is param-type-agnostic — it returns options regardless of whether the target param is a string or array; there is no throw path tied to array typing.
- The base executor's **Step-0 normalization** (`base-plugin-executor.ts:33–40`) coerces a scalar string into a single-element array for any `type:"array"` param. So even if the V6 compiler/LLM emits `calendar_ids: "primary"`, it self-heals to `["primary"]` before validation and before the fetch. This is a positive, not a hazard.
Keep `default: ["primary"]`, bound ≤ 50, `x-dynamic-options { source: "list_calendars" }`. Test-page multi-select ergonomics are a UX nicety, not a blocker.

**OQ2 — `list_calendars` action → private `listAllCalendars`, public fetcher untouched. ✅ APPROVED (mirrors Gmail `listAllLabels`).**
Dispatch is switch-only (verified `base-plugin-executor.ts:110`), so no shadow risk. Leave the line-514 dropdown fetcher exactly as-is. Confirmed.

**OQ3 — No new `x-semantic-type` this slice. ✅ APPROVED (type-clean).**
Neither `free_busy` busy-intervals nor `calendar` items are bindable input entities — a `calendar_id` flows downstream only as a plain string param, exactly the reasoning behind `gmail_label` staying ToType-only, and consistent with `list_events.events` carrying no annotation. **No `input-type-compat.ts` change; do not register `google_calendar`/`busy_period`.** The `time_slot` type is genuinely Phase 2 (requirement feasibility table, Calendar `list_available_slots`, phase 2) — correctly out of scope. Run `validatePluginTypeAnnotations` to confirm nothing unknown slipped in.

**OQ4 — Fix the `update_event` PATCH→GET+PUT doc row. ✅ APPROVED (fix it in this pass).**
Confirmed the executor does GET+PUT. We are already editing `docs/plugins/google-calendar-plugin.md`; correcting a verified inaccuracy in the same file is low-risk and in-scope. Fix only that one HTTP-method row — do not expand scope into other existing-action edits.

**OQ5 — Bump BOTH JSON `plugin.version` and doc header `1.0.0 → 1.1.0` in the same change. ✅ APPROVED.**
Both currently aligned at `1.0.0`; keep them aligned (drift-prevention lesson from earlier slices). Add a version-history row.

**OQ6 — `capability: "get"` + `output_entity: "free_busy"` (descriptive, unregistered). ✅ APPROVED.**
Reasonable: `get_free_busy` is a query/computation over a window, not an entity enumeration. `free_busy` is a descriptive label carrying no `x-semantic-type`, so it does not register a type — consistent with OQ3. **Minor note (not a change-request):** `output_cardinality: "collection"` is acceptable given the `calendars[]` shape; `"single"` (one free/busy report) would also be defensible. Either is fine since the output is type-clean and non-bindable — pick `collection` as planned for parity with `list_events`.

### Per-item validation verdict

| Area | Verdict | Notes |
|---|---|---|
| Schema/convention parity | ✅ | Full metadata block, `x-dynamic-options` on `calendar_ids`, dual snake_case + legacy camelCase, `x-guaranteed` timestamp (`queried_at`/`listed_at`) all match the file's established shape. |
| RFC3339 datetime params | ✅ | Reusing `time_min`/`time_max` (same names + format as `list_events`) is the right consistency call. `time_zone` param (default UTC) is additive and fine. |
| `freebusy.query` request shape | ✅ | `POST /calendar/v3/freeBusy` with `{ timeMin, timeMax, timeZone, items:[{id}] }` is correct. |
| **Per-calendar error handling** | ⚠️ **Binding condition** | The response `calendars{}` map can carry a per-calendar `errors:[{reason:'notFound'|…}]` **inside a 200**. The action MUST surface those per-calendar errors in the output (`{ calendar_id, busy, errors? }`) and MUST NOT throw on them — only the top-level `!response.ok` HTTP failure throws. The plan states this in prose; make it explicit and cover it with one minimal assertion (see Testing condition below). |
| Privacy invariant | ✅ | Map **only** `start`/`end` per busy block; never a secondary GET to enrich. `freebusy` never returns summaries anyway — the executor must not add them. Preserved in the plan. |
| `calendarList.list` mapping | ✅ | `GET /users/me/calendarList` (+ optional `minAccessRole`) → `{ id, summary, description?, time_zone, primary, access_role }` is correct. |
| Time-window guard | ✅ | Validate both present + `time_min < time_max` **before** any fetch → `invalid_time_range`. Correct as the single safety-critical property. |
| 50-calendar bound | ✅ | In-executor guard is the real enforcement; the `rules.limits` entry is catalog-uniformity/advisory (consistent with the in-executor-over-inert-rule pattern). |
| Idempotency | ✅ | Both read-only → `idempotent: true`. No dedupe needed. |
| Confirmation posture | ✅ | Read-only → no `rules.confirmations`. Correct. |
| Standards (Pino / no hardcoding / no Supabase / type-clean) | ✅ | Executor stays 0 `console.*`; no plugin-specific compiler/prompt rules; executors stateless (no DB); no new semantic type. |
| Registry/manager | ✅ | No change — auto-discovery confirmed. |
| LEAN tests | ⚠️ **Binding condition** | 6 unit (3/action) + S1 malformed-window is right. **Add exactly one more assertion (S2)** for the per-calendar-error path (below). Do not inflate beyond that. |

### Binding conditions (fold into implementation — none blocks starting)

1. **[Correctness] `get_free_busy` partial-error semantics.** In `getFreeBusy`, iterate `data.calendars` and emit `{ calendar_id, busy: [{start,end}], errors? }` per calendar, copying **only** `start`/`end`. A per-calendar `errors` array is a **partial success**, not a failure — return `success: true` with that calendar's `errors` surfaced; never throw on it. Throw only on the top-level HTTP `!response.ok`.
2. **[Test] One added assertion S2 (permitted, minimal — not inflation).** Mock a 200 `freebusy` response where calendar A has `busy:[{start,end}]` and calendar B has `errors:[{reason:'notFound'}]`; assert the action returns success, surfaces A's busy interval, surfaces B's `errors`, and does **not** throw. This is the single behavior most likely to be implemented wrong (throw-vs-surface) and is distinct from S1. Total remains lean: 6 unit + S1 + S2.
3. **[Doc, OQ4] Fix only the `update_event` PATCH→PUT row.** Correct the verified inaccuracy; do not touch other existing-action doc content.

### No user decision required before Dev starts

- Executor is logging-clean (0 `console.*`) → no Rule-3 conversion, no user prompt.
- No new OAuth scope, no re-consent, no scope drift → nothing for the user to approve.
- No new scope, no new semantic type, no compiler change → no architectural decision pending.
- The only logging item is the **pre-existing client-side `console.*` DEBUG logs in `app/test-plugins-v2/page.tsx`** — already surfaced and already the user's standing "leave as-is" call from the Drive/Sheets/Gmail slices (it is a `'use client'` component where `createLogger` is server-only, so not a straight conversion). Dev must **not add new `console.*`** there and must not convert it absent a fresh user decision. This is awareness, not a blocker.

**Dev may begin implementation immediately, applying the 3 binding conditions above.**

---

## QA Testing Report

**QA — 2026-07-27**
**Test mode:** full (all acceptance criteria + the 2 safety assertions + error/edge paths)
**Strategy used:** A (Jest unit) + code inspection. This is stateless plugin-executor logic over `fetch`; the fetch-mocked unit harness is the correct level. Live Google calls are covered by the credential-gated integration file (not runnable here — no `GOOGLE_CALENDAR_TEST_TOKEN`).
**Focus:** api (plugin executor) — partial-error semantics, privacy invariant, time-window guard
**Skipped:** Integration (Option B/C) — credential-gated, skips without `GOOGLE_CALENDAR_TEST_TOKEN` (not set in this env). E2E (D) — N/A (no UI in this slice).
**Input source:** prompt keywords + workplan LEAN test policy

### Actual test run (on record)

Command: `npx jest tests/plugins/unit-tests/google-calendar.test.ts --runInBand`

```
PASS tests/plugins/unit-tests/google-calendar.test.ts
Test Suites: 1 passed, 1 total
Tests:       27 passed, 27 total
Snapshots:   0 total
Time:        3.796 s
```

27/27 green — matches Dev's reported count (19 pre-existing + 8 new: 6 LEAN + S1 + S2). All three critical behaviors have a named, passing test:
- `get_free_busy › should POST to /freeBusy and parse per-calendar busy intervals (start/end only)`
- `get_free_busy › S1: rejects an inverted window (time_min >= time_max) before any fetch`
- `get_free_busy › S2: surfaces per-calendar errors and busy intervals together (partial success)`

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| `get_free_busy` happy path — `POST /freeBusy`, per-calendar busy parsed | ✅ | Pass | `expectFetchCalledWith('/calendar/v3/freeBusy','POST')`; busy mapped to `{start,end}`. |
| `get_free_busy` auth failure (401) | ✅ | Pass | 401 → `expectErrorResult`; top-level `!response.ok` throws (executor line 517-520). |
| `get_free_busy` invalid input (missing `time_max`) | ✅ | Pass | Rejected pre-fetch, `getAllFetchCalls()` length 0. |
| **Partial-error (CR-1)** — per-calendar `errors` inside a 200 surfaced, not thrown | ✅ | Pass | S2: cal A busy + cal B `errors:[{reason:'notFound'}]` → `success:true`, both surfaced. |
| **Privacy invariant** — busy carries ONLY start/end | ✅ | Pass | Happy test injects `summary:'SHOULD NOT LEAK'`; asserts `Object.keys(busy[0])` === `['start','end']`. |
| **Time-window guard (S1)** — inverted window rejected before any fetch | ✅ | Pass | S1: `time_min >= time_max` → error, `getAllFetchCalls()` length 0. |
| `list_calendars` happy path — `GET calendarList`, items + `total_found` mapped | ✅ | Pass | `expectFetchCalledWith('calendar/v3/users/me/calendarList')`; snake_case mapping verified. |
| `list_calendars` auth failure (401) | ✅ | Pass | 401 → `expectErrorResult`. |
| `list_calendars` invalid input (non-string `min_access_role`) | ✅ | Pass | Type-violation rejected pre-fetch, zero fetch (enum-value not enforced pre-fetch — SA-approved deviation). |
| Existing 5 Calendar actions + standard error/malformed/auth-edge scenarios | ✅ | Pass | No regression — 19 pre-existing tests still green. |

### Code-inspection verdicts (against `lib/server/google-calendar-plugin-executor.ts`)

- **Partial-error (CR-1): CONFIRMED.** The only `throw` in `getFreeBusy` is inside the `!response.ok` block (line 517-520). Per-calendar `errors` inside a 200 are copied into `mapped.errors` (line 540-542) and returned with `success:true` — never thrown. S2 exercises the mixed busy+errored 200 and asserts both are surfaced. Correct.
- **Privacy invariant: CONFIRMED.** The busy map copies exactly `{ start: b.start, end: b.end }` (line 532) — no other keys, no secondary enrich call anywhere in the method. The happy test actively injects an event `summary` and asserts the output keys are exactly `['start','end']`, so the leak path is tested, not merely assumed. Correct.
- **Time-window guard (S1): CONFIRMED.** `Date.parse` NaN/missing guard (line 485-487) and `minMs >= maxMs` inverted-window guard (line 490-492) both `throw` before the `fetch` at line 500. S1 asserts zero fetch calls; the missing-`time_max` test also asserts zero fetch calls. Correct.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. (The double `new Date().toISOString()` for snake/camel timestamp mirrors is the SA-logged low/cosmetic nit, already documented — not re-reported.)

#### Edge Cases (nice to fix)
None new. Out-of-scope observation (pre-existing, NOT introduced by this slice, do not fix here): the existing `listEvents` error path logs `msg:"Calendar list failed"` for a list-events failure (visible in the standard-error-scenario output) — a mislabeled log string in existing code, cosmetic, unrelated to the 2 new actions.

### Test Outputs / Logs

```
get_free_busy
  √ should POST to /freeBusy and parse per-calendar busy intervals (start/end only) (9 ms)
  √ should return an error on 401 (auth failure) (4 ms)
  √ should reject a request missing time_max (invalid input) with no network call (4 ms)
  √ S1: rejects an inverted window (time_min >= time_max) before any fetch (4 ms)
  √ S2: surfaces per-calendar errors and busy intervals together (partial success) (4 ms)
list_calendars
  √ should GET calendarList and map items + total_found (5 ms)
  √ should return an error on 401 (auth failure) (7 ms)
  √ should reject a non-string min_access_role (invalid input) with no network call (3 ms)
```
(Guard confirmed at runtime: the `min_access_role: 123` case logged `Runtime param-constraint guard: invalid enum value — no default, passed through unchanged` then was rejected by the type validator with zero fetch — matches the SA-approved deviation reasoning.)

### Final Status
- [x] All acceptance criteria pass — **ready for commit**
- [ ] Issues found — Dev must address before commit

**QA sign-off: PASS.** 27/27 unit tests green; CR-1 partial-error, privacy invariant, and S1 time-window guard all confirmed in code and by named passing assertions. No High/Medium/Low bugs found. LEAN policy respected (6 + S1 + S2) — no additional tests warranted. Integration file is credential-gated and correctly skips without a token (not exercisable in this environment).

---

---

## Commit Info

| Field | Value |
|-------|-------|
| Branch | `feature/google-suite-phase1-actions` |
| Commit | `16e9a40` — `feat(plugins): add Phase 1 Google Calendar availability actions` |
| Date | 2026-07-27 |
| Files | 8 (definition JSON, executor, unit + integration tests, integration-config, plugin doc, test-page, this workplan) |
| Tests | 27/27 unit tests passing |
| Pushed | No — local commit only, pending PR |
| Gates | SA workplan-review ✅ · SA code-review ✅ · QA PASS ✅ · user-approved ✅ |
| Notes | Version reconciled JSON+doc → 1.1.0; fixed pre-existing update_event PATCH→PUT doc row; availability foundation for Phase 2 list_available_slots |

---

## SA Code Review

**Code Review by SA — 2026-07-27**
**Status:** ✅ **Code Approved for QA** — no blocking must-fix items. 4 nice-to-have polish notes below; none gates QA.

Reviewed the Calendar slice diff only (`git diff` scoped to the 8 Calendar files); pre-existing unrelated dirty files (`.claude/settings*`, `docs/architecture/`) ignored. Every binding decision and CR was checked against the actual code, not the prose.

### Per-area verdict

| Area | Verdict | Evidence |
|---|---|---|
| **CR-1 partial-error semantics** | ✅ **Holds** | `getFreeBusy` throws **only** on top-level `!response.ok` (executor: the sole `throw new Error('Calendar API error…')` is inside the `!response.ok` block). Per-calendar `errors` inside a 200 are copied into `mapped.errors` and returned — never thrown. **S2 test** mocks calendar A `busy:[{start,end}]` + calendar B `errors:[{reason:'notFound'}]`, asserts `expectSuccessResult`, and asserts both A's busy interval and B's `errors` are surfaced. Verified concretely — correct. |
| **Privacy invariant** | ✅ **Holds** | Map copies **only** `{ start: b.start, end: b.end }`; no secondary enrich call anywhere in the method. **Happy test** injects `summary: 'SHOULD NOT LEAK'` on the busy block and asserts `Object.keys(result.data.calendars[0].busy[0])` equals exactly `['start','end']`. Integration test re-asserts `Object.keys(interval).sort() === ['end','start']`. Verified — the leak path is actively tested, not just assumed. |
| **CR-3 doc fix (scoped)** | ✅ **Holds** | Only the `update_event` HTTP-method row changed (`PATCH` → `GET (fetch existing) + PUT (write merged event)`). No other existing-action row touched. Confirmed against the diff. |
| **SA decisions (OQ1–6)** | ✅ **All honored** | `calendar_ids` array, `default:["primary"]`, in-executor `> 50` guard present; `listAllCalendars` private method added, public `list_calendars` fetcher (actual line 672) untouched; no `input-type-compat.ts` change (type-clean); both JSON `plugin.version` and doc header → `1.1.0`; `get_free_busy` metadata `capability:get` / `output_entity:free_busy`, `output_cardinality:collection` as agreed. |
| **Correctness — freebusy request** | ✅ | Body is `{ timeMin, timeMax, timeZone, items: calendarIds.map(id => ({ id })) }` — correct `items:[{id}]` shape. |
| **Correctness — pre-fetch validation** | ✅ | `Date.parse` NaN guard + `minMs >= maxMs` guard throw **before** the fetch. **S1 test** asserts inverted window → error with `getAllFetchCalls()` length 0. Missing-`time_max` rejected pre-fetch (redundantly by `validateParametersAgainstSchema` required-check *and* the method guard) — `getAllFetchCalls()` length 0 asserted. Zero-fetch verified. |
| **Correctness — calendarList mapping** | ✅ | `GET …/users/me/calendarList`, `minAccessRole` appended only when provided via `URL.searchParams`, items mapped to `{id, summary, description, time_zone, primary, access_role}` with `primary` defaulting to `false`. Correct passthrough. |
| **Standards** | ✅ | Executor remains **0 `console.*`** (grep-confirmed); **0** `console.*` added to `page.tsx` or the test files. New methods use `this.logger.debug/error` with `{ err, status }`. No plugin-specific rules leaked to any prompt/compiler. Type-clean (no new `x-semantic-type`). |
| **Pattern consistency** | ✅ | Both action blocks reuse the plugin's established metadata shape (`domain`/`capability`/`output_fields`/`required_params`/`optional_params`/`must_support`) and the dual snake_case + legacy camelCase return convention. No new pattern introduced. |
| **LEAN tests** | ✅ | 6 unit (3/action: happy + 401 auth + invalid-input) + S1 (time-window guard) + S2 (partial-error) = exactly the agreed policy. Integration file created (credential-gated skip) + `google-calendar` registered in `CREDENTIAL_MAP`. Meets happy + auth + invalid across both actions. |

### Ruling on the Dev's flagged deviation (list_calendars invalid-input test)

**Verdict: the Dev made the right call. Approved. No executor-side enum guard warranted.**

Ground-truthed against `plugin-manager-v2.ts:validateParametersAgainstSchema` (lines 763–791): it performs basic **type** checks (line 784 rejects a non-string `min_access_role`) but has **no enum-value enforcement**. The param-constraint guard passes an unknown enum with no `default` through unchanged. So there is no pre-fetch path that rejects an *invalid enum value* — only an invalid *type*. The Dev's substitution (assert `min_access_role: 123` is rejected with zero fetch) is therefore the honest, real pre-fetch invalid-input assertion available, and it is documented inline.

The Dev's reasoning — that an executor-side enum throw would contradict the platform's self-heal/passthrough stance — is sound and aligns with CLAUDE.md's "no plugin-specific rules / schema is the source of truth" principle. Google enforces `minAccessRole` server-side (400), which the existing error path already surfaces cleanly. Adding a hardcoded enum whitelist in the executor would be exactly the kind of plugin-specific validation the platform avoids. **Do not add the guard.**

### Must-fix (blocking): none

### Nice-to-have (non-blocking — QA may proceed)

1. **[Low] Split-second timestamp skew.** `getFreeBusy` calls `new Date().toISOString()` twice (`queried_at` and the legacy `queriedAt` mirror); `listAllCalendars` does the same for `listed_at`/`listedAt`. The snake and camel mirrors can differ by a millisecond across a tick boundary. Cosmetic — compute once into a `const` and reuse for both. Not correctness-affecting.
2. **[Low] Stale line reference in code comments.** Both new comments cite the public fetcher as "(~line 514)"; it now lives at line 672. Update the two comments to avoid future confusion (or drop the line number and keep the method-name reference).
3. **[Low] `invalid_time_range` / `invalid_time_format` rely on base error-message mapping.** The guards `throw new Error('invalid_time_range: …')`; the user-facing message resolution depends on the base executor mapping that prefix to the declared `common_errors`. Tests assert only `expectErrorResult`, not the mapped message. Fine for this read-only slice, but worth a QA glance that the client sees the friendly `common_errors.invalid_time_range` text rather than the raw thrown string.
4. **[Low] `any` usage in new methods** (`connection: any`, `parameters: any`, `b: any`, `cal: any`) matches the file's existing convention and is *explicit* (not implicit `any`), so it does not violate strict mode. Acceptable as-is; a future typing pass on the whole executor would be the place to tighten it, not this slice.

### Code Approved for QA: **Yes**

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-27 | QA test pass | Ran `npx jest tests/plugins/unit-tests/google-calendar.test.ts --runInBand` — **27/27 passed, 1 suite passed (3.796 s)**, matching Dev's reported count (19 pre-existing + 8 new). Verified the three critical behaviors both in code and by named passing assertions: **partial-error (CR-1)** — only top-level `!response.ok` throws (executor 517-520), per-calendar `errors` inside a 200 copied to `mapped.errors` (540-542) and returned `success:true` (S2 asserts mixed busy+errored → success, both surfaced); **privacy invariant** — busy map copies only `{start,end}` (line 532), no enrich call, happy test injects a `summary` and asserts keys exactly `['start','end']`; **time-window guard (S1)** — NaN/missing + inverted-window guards (485-492) throw before the fetch (500), S1 + missing-`time_max` both assert zero fetch calls. No bugs found (High/Medium/Low all none). SA's 4 low nice-to-haves not re-reported. Integration file correctly skips (no `GOOGLE_CALENDAR_TEST_TOKEN`). **QA sign-off: PASS — ready for commit.** |
| 2026-07-27 | SA code review | Reviewed the Calendar slice diff (8 files, scoped; unrelated dirty files ignored). **Code Approved for QA — no blocking must-fix.** Verified concretely: CR-1 partial-error path surfaces per-calendar `errors` inside a 200 and only top-level `!response.ok` throws (S2 asserts mixed busy+errored → success); privacy invariant holds (only `start`/`end` copied, happy test injects a `summary` and asserts keys are exactly `['start','end']`, no enrich call); CR-3 doc fix scoped to the single `update_event` PATCH→GET+PUT row; all 6 SA decisions honored (calendar_ids array + ≤50 guard, `listAllCalendars` private / public fetcher at line 672 untouched, type-clean, version 1.1.0 in JSON+doc, capability:get/output_entity:free_busy); pre-fetch guards reject inverted/degenerate/missing windows with zero fetch (S1); 0 `console.*` preserved and none added; LEAN test count matches policy (6 + S1 + S2). **Ruled on Dev's invalid-input deviation: APPROVED** — `validateParametersAgainstSchema` has type checks but no enum enforcement, so a type-violation assertion is the honest pre-fetch invalid-input test; an executor-side enum guard would contradict the platform passthrough/self-heal stance and is NOT warranted. 4 low-priority nice-to-haves logged (double `toISOString()` mirror skew, stale ~line 514 comment, error-message mapping QA glance, explicit `any` matching file convention). |
| 2026-07-27 | Dev implementation (Code Complete) | Implemented both actions per SA-approved plan + 3 binding conditions. Executor: `getFreeBusy` (pre-fetch guards for missing/invalid RFC3339 + inverted window + 50-cap; `POST /freeBusy`; maps `data.calendars` map → `{calendar_id, busy:[{start,end}], errors?}` copying start/end ONLY; per-calendar `errors` surfaced as partial success, only top-level `!response.ok` throws) and `listAllCalendars` (`GET /users/me/calendarList` + optional `minAccessRole`). Switch cases added; public `list_calendars` dropdown fetcher untouched. JSON: 2 action blocks + version→1.1.0. Tests: 6 LEAN unit + S1 + S2, all green (27/27). Integration file created + `google-calendar` registered in CREDENTIAL_MAP. Docs: 2 sections + version history + `update_event` PATCH→GET+PUT fix. Executor stays 0 `console.*`. **Finding for SA:** the plan's `list_calendars` invalid-input case ("invalid `min_access_role` enum → validation error") is NOT enforced pre-fetch — `validateSchema` (plugin-manager-v2) has no enum check and `applyParamConstraintGuard` passes an invalid enum with no `default` through unchanged (never throws). Google enforces `minAccessRole` server-side (400). The genuine pre-fetch invalid-input rejection here is a TYPE violation, so the unit test asserts a non-string `min_access_role` is rejected with no network call (documented inline in the test). |
| 2026-07-27 | SA workplan review | SA ground-truthed the plan against the executor, definition JSON, base executor, and test harness. Resolved all 6 OQs: OQ1 `calendar_ids` array (approved — dropdown dispatch is type-agnostic + base Step-0 string→array normalization self-heals scalar inputs); OQ2 `listAllCalendars` private method, public fetcher untouched (switch-only dispatch confirmed, no shadow risk); OQ3 no new `x-semantic-type` (type-clean, `time_slot` stays Phase 2); OQ4 fix `update_event` PATCH→GET+PUT doc row (executor GET+PUT confirmed at lines 265/313); OQ5 bump both JSON+doc `1.0.0→1.1.0`; OQ6 `capability:get`+`output_entity:free_busy` descriptive. **Approved for implementation** with 3 binding conditions folded into tasks: (1) `get_free_busy` per-calendar `errors` inside a 200 = partial success, surface don't throw; (2) add one minimal S2 assertion for that partial-error path (total 6 unit + S1 + S2); (3) fix only the `update_event` doc row. Confirmed 0 `console.*` in executor, no new scope, no new type, no compiler change → **no user decision required before Dev starts** (client `test-plugins-v2` DEBUG logs are the standing leave-as-is item). |
| 2026-07-27 | Initial workplan | Dev drafted Phase 1 Calendar slice: 2 read-only availability actions (`get_free_busy` via `freebusy.query`, `list_calendars` via `calendarList.list`). Per-action schemas + Google API mappings + RFC3339 time handling + idempotency (both read-only → idempotent) + privacy invariant (busy start/end only). LEAN 3-per-action test plan + 1 malformed-window safety assertion; new credential-gated integration file + `integration-config.ts` registration. Standards flags: executor is **zero `console.*`** (no conversion; only the touched client `test-plugins-v2/page.tsx` DEBUG logs surfaced for user awareness); **no new OAuth scope** (`calendar` covers both); **type-clean** (no new `x-semantic-type`, no `input-type-compat.ts` change — `time_slot` deferred to Phase 2); JSON+doc version reconcile `1.0.0` → `1.1.0` (no prior drift). 6 open questions for SA (calendar-selection array shape, `list_calendars` method collision → `listAllCalendars`, type-cleanliness, plugin-doc scope + `update_event` PATCH/PUT doc bug, version, `get_free_busy` capability/output_entity metadata). Workplan only — no implementation code. |
