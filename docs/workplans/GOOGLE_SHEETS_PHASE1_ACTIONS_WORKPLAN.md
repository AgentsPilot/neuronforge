# Workplan: Google Sheets Plugin — Phase 1 Formatting & Structural Actions

> **Last Updated**: 2026-07-26

**Developer:** Dev
**Requirement:** [GOOGLE_SUITE_PLUGIN_ROBUSTNESS_REQUIREMENT.md](/docs/requirements/GOOGLE_SUITE_PLUGIN_ROBUSTNESS_REQUIREMENT.md) (✅ Approved — Phase 1 Sheets slice)
**Branch:** `feature/google-suite-phase1-actions` — ✅ confirmed current branch (`git branch --show-current`). This document is workplan-only; **no implementation code** is written until SA workplan-review passes. RM owns branch creation and the eventual merge; Dev never commits to `main`.
**Status:** Code Complete (awaiting SA code review)

## Overview

This workplan covers the **Phase 1 Google Sheets slice** of the Google Suite robustness requirement: three new actions on the existing `google-sheets` V2 plugin that move it beyond value-level read/write into **formatting and structural editing**. Per the SA feasibility table and OQ4 granularity ruling, these are kept as distinct actions (not folded together), because they carry distinct intents and confirmation postures:

1. `format_cells` — cell formatting via `spreadsheets.batchUpdate` (`repeatCell` for bold/background + `updateSheetProperties` for a frozen header row). Directly serves the user's explicit "set headers on sheets" ask. **First `batchUpdate` formatting path in the Sheets executor.** 🟡
2. `clear_range` — clear the values in an A1 range. **Destructive** (declares a confirmation rule). 🟢
3. `delete_rows` — delete a row-index range via `batchUpdate` `deleteDimension`. **Destructive + structural** (declares a confirmation rule). 🟢

All three fit the **already-granted `https://www.googleapis.com/auth/spreadsheets` scope** — confirmed against `google-sheets-plugin-v2.json` (`required_scopes` includes `spreadsheets` and `drive`). **No new OAuth scope, no re-consent, no Google app re-verification.** Purely additive.

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
| Plugin definition | `lib/plugins/definitions/google-sheets-plugin-v2.json` | Add 3 entries to `actions{}` |
| Executor | `lib/server/google-sheets-plugin-executor.ts` | Add 3 `switch` cases + 3 private methods + shared batchUpdate/sheetId/A1 helpers; **convert 1 `console.error` → `this.logger.error`** (Mandatory Rule 3, pending user approval) |
| Registry | `lib/server/plugin-executer-v2.ts` | **No change** — `google-sheets` already registered (line 44) |
| Plugin manager | `lib/server/plugin-manager-v2.ts` | **No change** — definition auto-loaded; actions auto-discovered by CapabilityBinder |
| Test page | `app/test-plugins-v2/page.tsx` | Add `PARAMETER_TEMPLATES` entries for the 3 actions under `"google-sheets"` (smoke-check UX) |
| Unit tests | `tests/plugins/unit-tests/google-sheets.test.ts` | Add LEAN 3-per-action unit coverage + 1 safety assertion |
| Integration tests | `tests/plugins/integration-tests/google-sheets.integration.test.ts` | Add credential-gated deeper coverage (skips without token) |
| Plugin doc | `docs/plugins/google-sheets-plugin.md` | Document the 3 new actions + version-history bump (part of this slice's DoD) |

**Confirmed from code grounding:**

- **Executor contract (`base-plugin-executor.ts`):** the base `executeAction` template already handles param normalisation (string→array), the runtime param-constraint guard, schema validation, confirmation surfacing (**advisory only** — lines 69–74 log "would be handled via UI" and do **not** block), connection retrieval, success formatting, and error mapping. Each new action = one `case` in `executeSpecificAction` + one private method that makes the Google call and returns a schema-shaped object.
- **Auth:** `connection.access_token` bearer, exactly as the existing 7 Sheets actions do. Never log the token.
- **HTTP style:** the Sheets executor uses **raw `fetch` + manual `!response.ok` throw** (it does NOT use the base `handleApiResponse`). New methods follow the same raw-fetch style for consistency.
- **Return shape:** every existing action returns a **dual snake_case + legacy camelCase** object. New actions follow suit for the primary fields, with an `x-guaranteed` `*_at` timestamp.
- **`batchUpdate` precedent already exists:** `getOrCreateSheetTab` (line ~396) already POSTs to `${this.sheetsApisUrl}/${spreadsheet_id}:batchUpdate` with a `requests[]` body and reads `result.replies[...]`. The 3 new batchUpdate-based methods reuse this exact shape via a shared helper.
- **`sheetId` resolution is the key new concern:** `batchUpdate` (`repeatCell`, `updateSheetProperties`, `deleteDimension`) operates on a **numeric `sheetId` + `GridRange`**, NOT the A1 sheet-*name* the value-level actions use. `getSpreadsheetInfo` already returns each sheet's `sheet_id` + `title` — a shared resolver maps a tab name → numeric `sheetId` (see Implementation Approach).
- **Logging:** the executor uses `this.logger` (Pino) throughout **except one `console.error`** at **line 247** (in `appendRows`). Exact count confirmed via grep: **1 `console.*` call in the file.** Since this slice modifies the file, Mandatory Rule 3 applies — see [Standards & Risks](#standards--risks).
- **Registry/manager:** `google-sheets` is present in `plugin-executer-v2.ts` (line 44); the definition JSON is auto-loaded and actions auto-discovered. **No wiring changes** — only the definition + executor.

---

## Implementation Approach

**One executor method per action, each a thin typed wrapper over the relevant Google Sheets REST call**, returning a snake_case (+ legacy camelCase) object matching the action's `output_schema`.

**Root-cause phase (per CLAUDE.md V6 protocol):** This is **plugin-layer work only**. No V6 pipeline/compiler changes — actions are standard-shaped and auto-discovered by CapabilityBinder. Per Platform Design Principles, **no plugin-specific rules are added to any system prompt or the compiler**; the definition schema (`domain`/`capability`/`input_entity`/`output_entity`/cardinality/`x-semantic-type`/`output_dependencies`) is the sole source of truth.

### Shared helpers (added once, reused by the batchUpdate actions)

To keep the actions generic and avoid duplicated logic — and to keep A1/GridRange conversion in one unit-testable place — three small private helpers:

1. **`sheetsBatchUpdate(connection, spreadsheetId, requests[])`** — thin POST wrapper over `…/{id}:batchUpdate` mirroring the existing `getOrCreateSheetTab` call (raw fetch, manual error throw, returns `replies`). Used by `format_cells` and `delete_rows`.
2. **`resolveSheetId(connection, spreadsheetId, sheetName?)`** — calls the existing `getSpreadsheetInfo` and matches `sheetName` (case-insensitive) against the returned `sheets[].title`, returning the numeric `sheet_id`. If `sheetName` is omitted, resolve the first sheet (index 0). Throws a clean `sheet_not_found` error if the named tab does not exist. Reuses existing code — no new API surface.
3. **`a1RangeToGridRange(range, sheetId)`** — deterministic parse of an A1 range (e.g. `A1:D1`, `Sheet1!A1:D1`, `A:D`) into a `GridRange` (`{ sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex }`, 0-based half-open). Column letters → index, row numbers → 0-based. Open-ended ranges omit the corresponding bound (whole-column/whole-row semantics). Pure function → fully unit-testable, no network. Used by `format_cells`. **See OQ1** — the A1 sheet-name prefix, if present, feeds `resolveSheetId`.

None of these introduce plugin-specific compiler logic; they are executor-internal Google-API adapters.

### Idempotency (reasoned from Sheets API semantics — no hacks)

- `format_cells` — **idempotent.** Re-running with the same range/format yields the same visual state (bold stays bold, `frozenRowCount:1` stays 1). `idempotent: true`.
- `clear_range` — **idempotent.** Clearing an already-empty range is a no-op that still succeeds. `idempotent: true`.
- `delete_rows` — **NOT idempotent.** `deleteDimension` shifts all subsequent row indices up, so re-running the same `start_row`/`end_row` deletes a *different* set of rows. `idempotent: false`. Documented explicitly in `usage_context`; no dedupe magic in the executor.

### Destructive-action safety (Security Rule + SA flag)

`clear_range` and `delete_rows` are destructive. Both declare `rules.confirmations` with an explicit `condition` (mirroring the Drive slice's `"file_id != null"` pattern → here `"spreadsheet_id != null"`). Because confirmations are **advisory** in the executor (base only logs "would be handled via UI"), the executor's own behavior is what actually matters: each method performs exactly the scoped mutation requested (a single named range / a single explicit row-index range) and **never** a spreadsheet-wide clear or delete. `format_cells` is non-destructive → no confirmation rule.

---

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/plugins/definitions/google-sheets-plugin-v2.json` | modify | Add 3 action definitions (full metadata block, `x-dynamic-options`, output_schema, output_guidance/common_errors, `rules.confirmations` on the 2 destructive ones) |
| `lib/server/google-sheets-plugin-executor.ts` | modify | Add 3 `switch` cases + 3 private methods + 3 shared helpers; convert the line-247 `console.error` → `this.logger.error` |
| `app/test-plugins-v2/page.tsx` | modify | Add `PARAMETER_TEMPLATES` entries for the 3 new actions |
| `tests/plugins/unit-tests/google-sheets.test.ts` | modify | Add LEAN 3-per-action unit coverage + 1 delete-range safety assertion |
| `tests/plugins/integration-tests/google-sheets.integration.test.ts` | modify | Add credential-gated deeper coverage (skips without token) |
| `docs/plugins/google-sheets-plugin.md` | modify | Document the 3 new actions + version-history bump (this slice's DoD — closes the Drive-slice gap where the plugin MD was missed) |

---

## Per-Action Specifications

Notation: `→` = maps to. Base host constant in executor is `this.sheetsApisUrl` (= `https://sheets.googleapis.com/v4/spreadsheets`). All batchUpdate requests are wrapped by `sheetsBatchUpdate()`.

### 1. `format_cells` 🟡

| Field | Value |
|---|---|
| **Google API** | `POST /v4/spreadsheets/{spreadsheetId}:batchUpdate` with a `requests[]` array combining `repeatCell` (for bold/background) and `updateSheetProperties` (for `gridProperties.frozenRowCount`) |
| **domain** `table` · **capability** `update` · input_entity `row` · output_entity `row` · cardinalities `collection`/`collection` |
| **idempotent** | `true` |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `spreadsheet_id` | string | ✅ | `x-dynamic-options: { source: "list_spreadsheets" }` + `x-context-binding` (match existing actions) |
| `range` | string | ✅ | A1 range to format (e.g. `Sheet1!A1:D1`). `x-dynamic-options: { source: "list_sheet_names", depends_on: ["spreadsheet_id"] }`. Parsed to a `GridRange` via `a1RangeToGridRange`; the sheet-name prefix (if any) resolves the `sheetId` via `resolveSheetId`. |
| `bold` | boolean | ❌ (default `false`) | Applies `textFormat.bold` via `repeatCell` with `fields: "userEnteredFormat.textFormat.bold"`. |
| `background_color` | string | ❌ | Hex (e.g. `#FDE68A`) → normalized to a `{red,green,blue}` 0–1 `Color`; applied via `repeatCell` `fields: "userEnteredFormat.backgroundColor"`. |
| `freeze_rows` | integer | ❌ | Freeze the first N rows (header freeze). Applied via `updateSheetProperties` `fields: "gridProperties.frozenRowCount"`. `0` unfreezes. |

At least one of `bold` / `background_color` / `freeze_rows` should be provided; if none are set the method is a no-op success (nothing to format).

**Method logic:** resolve `sheetId` from the range's sheet-name prefix (or default sheet); build a `requests[]` array — a `repeatCell` request (only the format subfields actually provided, with a precise `fields` mask) when `bold`/`background_color` are set, and an `updateSheetProperties` request when `freeze_rows` is provided; POST once via `sheetsBatchUpdate`.

**Output schema (key fields):** `spreadsheet_id` (x-guaranteed), `sheet_id`, `range`, `formatted_cells` (bool/summary of what was applied — `bold_applied`, `background_applied`, `frozen_rows`), `formatted_at` (x-guaranteed timestamp).

**Confirmation/safety:** none (non-destructive). `common_errors` reuse the established vocabulary (`auth_failed`, `spreadsheet_not_found`, `invalid_range`, `permission_denied`, `api_rate_limit`, `insufficient_permissions`) + `sheet_not_found`.

### 2. `clear_range` 🟢

| Field | Value |
|---|---|
| **Google API** | `POST /v4/spreadsheets/{spreadsheetId}/values/{range}:clear` (values-level clear — A1-based, no `sheetId`/`GridRange` needed) |
| **domain** `table` · **capability** `delete` · input_entity `row` · output_entity `row` · cardinalities `collection`/`collection` |
| **idempotent** | `true` |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `spreadsheet_id` | string | ✅ | `x-dynamic-options: { source: "list_spreadsheets" }` + `x-context-binding`. |
| `range` | string | ✅ | A1 range to clear (e.g. `Sheet1!A2:D100`). `x-dynamic-options: { source: "list_sheet_names", depends_on: ["spreadsheet_id"] }`. |

**Method logic:** POST to the `:clear` endpoint (empty body). Google returns `{ spreadsheetId, clearedRange }`. Clears **values only** (formatting/notes preserved) — the natural, narrowest "clear" semantics.

**Output schema (key fields):** `spreadsheet_id` (x-guaranteed), `cleared_range` (x-guaranteed), `cleared_at` (x-guaranteed).

**Confirmation/safety:** **REQUIRED.** Declare `rules.confirmations` (`confirm_clear`: `condition: "spreadsheet_id != null"`, `action: "confirm"`, message: "Clear all values in '{range}'? This removes the cell contents (formatting is kept)."). The executor clears exactly the requested A1 range — never the whole sheet.

### 3. `delete_rows` 🟢 (structural, NOT idempotent)

| Field | Value |
|---|---|
| **Google API** | `POST /v4/spreadsheets/{spreadsheetId}:batchUpdate` with one `deleteDimension` request → `{ range: { sheetId, dimension: "ROWS", startIndex, endIndex } }` |
| **domain** `table` · **capability** `delete` · input_entity `row` · output_entity `row` · cardinalities `collection`/`collection` |
| **idempotent** | `false` |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `spreadsheet_id` | string | ✅ | `x-dynamic-options: { source: "list_spreadsheets" }` + `x-context-binding`. |
| `sheet_name` | string | ❌ | Tab whose rows are deleted; resolved to `sheetId` via `resolveSheetId`. Defaults to the first sheet. `x-dynamic-options: { source: "list_sheet_names", depends_on: ["spreadsheet_id"] }`. |
| `start_row` | integer | ✅ | **1-based, inclusive** (user-facing, matches spreadsheet UI row numbers). Converted to 0-based `startIndex = start_row - 1`. |
| `end_row` | integer | ✅ | **1-based, inclusive.** Converted to half-open `endIndex = end_row` (so deleting rows 2–5 → `startIndex:1, endIndex:5`). Must be `>= start_row`; validated. |

**Method logic:** resolve `sheetId`; convert the 1-based inclusive `start_row`/`end_row` to Google's 0-based half-open `[startIndex, endIndex)`; POST a single `deleteDimension` request via `sheetsBatchUpdate`. Guard: reject `end_row < start_row` and `start_row < 1` with a clean validation error before the call, so a malformed range can never widen into a full-sheet delete.

**Output schema (key fields):** `spreadsheet_id` (x-guaranteed), `sheet_id`, `deleted_row_count` (= `end_row - start_row + 1`), `start_row`, `end_row`, `deleted_at` (x-guaranteed).

**Confirmation/safety:** **REQUIRED.** Declare `rules.confirmations` (`confirm_delete_rows`: `condition: "spreadsheet_id != null"`, `action: "confirm"`, message: "Delete rows {start_row}–{end_row} from '{sheet_name}'? This shifts the rows below up and cannot be undone by re-running."). **Safety-critical:** the `deleteDimension` range must be exactly the bounded index range — never an unbounded range that would clear the sheet. This is the one non-trivial safety property and gets a dedicated unit assertion (see Testing).

> **`usage_context` note (delete_rows):** explicitly state `idempotent: false` — because `deleteDimension` shifts indices, re-running with the same `start_row`/`end_row` deletes a different set of rows. Recurring workflows must recompute the range each run.

---

## Task List

**Definition JSON (`google-sheets-plugin-v2.json`)**
- [x] Add `format_cells` action (full top-level metadata block, `x-dynamic-options` on `spreadsheet_id`/`range`, output_schema, output_guidance + sample_output + common_errors) — CR-A/CR-C applied (typed `format_summary`, first-tab + sheet-level-freeze docs)
- [x] Add `clear_range` action **with `rules.confirmations`** (`condition: "spreadsheet_id != null"`)
- [x] Add `delete_rows` action **with `rules.confirmations`** + `idempotent: false` + non-idempotency `usage_context` note — CR-D confirmation message uses `{sheet_name}` fallback to resolved title in-executor

**Executor (`google-sheets-plugin-executor.ts`)**
- [x] Add 3 `case` branches to `executeSpecificAction` switch
- [x] Implement shared helpers: `sheetsBatchUpdate()`, `resolveSheetId()`, `a1RangeToGridRange()` (+ `columnLettersToIndex`, `hexToColor`)
- [x] Implement `formatCells()` (`repeatCell` + `updateSheetProperties` in one batchUpdate; precise `fields` masks — CR-C narrow mask, never broad `userEnteredFormat`)
- [x] Implement `clearRange()` (`values/{range}:clear`)
- [x] Implement `deleteRows()` (`deleteDimension`; 1-based→0-based half-open conversion + range guard before any fetch — **always finite endIndex**, CR-D)
- [x] Confirm all new methods use `this.logger` (Pino) — zero `console.*`
- [x] **Logging conversion:** converted the existing `console.error` at line 247 → `this.logger.error({ status, statusText, spreadsheet_id, range, err: errorData }, 'Google Sheets append_rows failed')` (user-approved; surrounding 403/404 parse+throw logic left byte-for-byte). File now has **zero** `console.*`.

**Wiring**
- [x] Confirmed NO registry/manager change needed (definition auto-loaded; `google-sheets` already in `plugin-executer-v2.ts`)
- [x] Add `PARAMETER_TEMPLATES` entries for the 3 actions in `app/test-plugins-v2/page.tsx` (CR-B: did NOT touch/convert the pre-existing client-side `console.log('DEBUG…')` calls per user decision; added no new ones)

**Tests** (see [Testing](#testing))
- [x] Unit: LEAN 3 per action — happy + auth-failure (401) + invalid-input (9 total)
- [x] Unit: **`delete_rows` safety assertion** — asserts the `deleteDimension` range is the exact bounded `[startIndex, endIndex)` (rows 2–5 → `startIndex:1, endIndex:5`), both bounds finite (CR-D), not unbounded/whole-sheet; invalid-input case asserts **no fetch issued**
- [x] Unit: 2 pure `a1RangeToGridRange` checks (header range + whole-column). Full suite: **36 passed / 36 total**.
- [x] Integration: credential-gated deeper coverage (create → seed → format → clear → delete lifecycle + inverted-range guard) — skips without a token

**Docs**
- [x] Update `docs/plugins/google-sheets-plugin.md`: added actions 8/9/10 (`format_cells`, `clear_range`, `delete_rows`) + back-filled 6/7 (`get_or_create_spreadsheet`, `get_or_create_sheet_tab`) per OQ4; version bump 1.1.0; Last Updated 2026-07-26
- [x] `x-semantic-type` check: new outputs are scalar/status + a typed `format_summary` boolean object — no object-typed entity array items, so no new `x-semantic-type` introduced (per SA V6 awareness section)

---

## Testing

Follows the existing `tests/plugins/unit-tests/google-sheets.test.ts` harness (`createTestExecutor`, `mockFetchSuccess`, `mockFetchSequence`, `mockFetchError`, `expectSuccessResult`, `expectErrorResult`, `expectFetchCalledWith`, `getAllFetchCalls`, `runStandardErrorScenarios`), with the `[smoke]` (happy) / `[full]` (failure + safety) split used today.

### LEAN test policy (binding — user directive)

**Exactly 3 unit tests per action: happy path + auth-failure (401) + invalid-input. No more.** The only permitted extra is the one **safety-critical** assertion below, where a genuine whole-sheet-wipe risk exists. Deeper coverage (A1-parser edge cases, multi-request format combos, frozen-row round-trips) goes into the **credential-gated integration test file**, which skips without a token and does not run in the fast unit pass.

| Action | Happy path (mock) | Auth failure | Invalid input |
|---|---|---|---|
| `format_cells` | batchUpdate 200 → `expectSuccessResult`, asserts `repeatCell` + `updateSheetProperties` present for bold+freeze; `expectFetchCalledWith(':batchUpdate','POST')` | 401 → `expectErrorResult` (fires on the `resolveSheetId` info fetch or the batchUpdate) | missing `range` → validation error |
| `clear_range` | `:clear` 200 → `cleared_range` returned; `expectFetchCalledWith(':clear','POST')` | 401 → `expectErrorResult` | missing `range` → validation error |
| `delete_rows` | batchUpdate 200 → `deleted_row_count` correct; `expectFetchCalledWith(':batchUpdate','POST')` | 401 → `expectErrorResult` | `end_row < start_row` (or `start_row < 1`) → validation error, **no fetch issued** |

**Safety-critical extra (the only permitted additional assertion):**

| Action | Assertion |
|---|---|
| `delete_rows` | **DELETE-INTENDED-RANGE-ONLY:** for `start_row:2, end_row:5`, the `deleteDimension.range` sent to Google is exactly `{ dimension:"ROWS", startIndex:1, endIndex:5 }` — bounded, not unbounded, not the whole sheet. Verified by inspecting the request body via `getAllFetchCalls()`. |

**Scoped fast command (from workplan directive):**

```bash
npx jest tests/plugins/unit-tests/google-sheets.test.ts
```

Expected: existing suite (baseline) stays green; +10 new unit tests (9 LEAN + 1 safety) added.

**Integration tests:** add a credential-gated block to `google-sheets.integration.test.ts` mirroring the file's existing skip-without-token pattern — a create→format→clear→delete lifecycle plus A1-parser and frozen-row round-trip checks that need a live spreadsheet.

---

## Standards & Risks

- **Logging (Mandatory Rule 3) — action required.** `lib/server/google-sheets-plugin-executor.ts` contains **exactly 1 `console.*` call**: `console.error('❌ Google Sheets append_rows failed:', {...})` at **line 247** (inside `appendRows`). This is server-side `lib/` code and this slice modifies the file, so the "non-compliant files you touch" rule applies. **Proposal:** convert that single call to structured Pino — `this.logger.error({ status, statusText, spreadsheet_id, range, err: errorData }, 'Google Sheets append_rows failed')` — leaving the surrounding error-message parsing / 403 / 404 branches untouched. This is a clean logging-only conversion. **Flagged for user approval before converting** (per CLAUDE.md § Logging: proceed with the conversion once the user approves, unless they explicitly decline). All new code uses `this.logger` only — never `console.*`.
- **OAuth scope:** ✅ **No new scope.** `format_cells`, `clear_range`, `delete_rows` all fit the already-granted `https://www.googleapis.com/auth/spreadsheets` scope declared in `google-sheets-plugin-v2.json` (`values.clear`, `spreadsheets.batchUpdate` are all covered). Zero re-consent, zero Google app re-verification.
- **Destructive-action safety:** `clear_range` and `delete_rows` declare `rules.confirmations` with explicit `condition: "spreadsheet_id != null"` AND are scoped-in-code (exact A1 range / exact bounded row-index range — never whole-sheet). Confirmations are advisory in the executor, so safety is enforced by the method, not the rule. `format_cells` is non-destructive (no confirmation).
- **Idempotency:** reasoned from Sheets API semantics per action — `format_cells`/`clear_range` idempotent, `delete_rows` explicitly NOT (index shift). No plugin-specific hacks, no compiler involvement.
- **No hardcoding:** no plugin-specific rules added to any system prompt or the compiler; the definition schema is the sole source of truth (Platform Design Principles).
- **Repository pattern / Supabase:** N/A — executors are stateless; no DB writes in this slice.
- **V6 pipeline:** no compiler changes; actions are standard-shaped and auto-discovered. No new `must_support` semantics. New outputs are scalar → no new `x-semantic-type` expected; `validatePluginTypeAnnotations` will confirm.
- **`batchUpdate`/`sheetId` risk:** the main novelty is that `batchUpdate` needs a numeric `sheetId` + `GridRange`, not an A1 sheet-name. Mitigated by the shared `resolveSheetId` (reuses `getSpreadsheetInfo`) and `a1RangeToGridRange` helpers — isolated, pure where possible, and unit-tested. `clear_range` sidesteps both by using the A1-based `values:clear` endpoint.
- **Plugin doc debt (closing a Drive-slice gap):** `docs/plugins/google-sheets-plugin.md` is stale (last updated 2025-11-30, documents only 5 actions and misses the existing `get_or_create_*` actions). This slice's DoD includes documenting the 3 new actions and bumping version history. (Back-filling the two already-shipped `get_or_create_*` actions is out of scope unless SA wants it folded in — see OQ4.)

---

## Open Questions for SA

1. **`format_cells` range interface — A1 vs. explicit indices.** I propose the action accept an **A1 `range`** (e.g. `Sheet1!A1:D1`) for consistency with every other Sheets action, with an in-executor `a1RangeToGridRange` parser producing the `GridRange` that `repeatCell` needs. The alternative is exposing explicit numeric `start_row`/`end_row`/`start_col`/`end_col` params (no parser, but a second param vocabulary the LLM must learn). Recommendation: **A1 range** (one consistent vocabulary; parser is deterministic + unit-tested). Confirm.
2. **`format_cells` capability scope for Phase 1.** The requirement's must-have is **bold + background + frozen header row**. I've scoped exactly those three. Font size/color, alignment, and conditional formatting are explicitly deferred (`add_conditional_format` is a separate Phase 2 action per the SA feasibility table). Confirm this minimal scope is right for the slice.
3. **`clear_range` — values-only clear vs. `updateCells` full clear.** I propose `values.clear` (clears values, preserves formatting) as the narrowest, most intuitive "clear" and the natural inverse of `write_range`. A `batchUpdate updateCells` full clear (values + formatting) is heavier and a different intent. Confirm values-only is the right default; if a format-clearing variant is wanted it should be a separate future action.
4. **Plugin-doc back-fill scope.** `google-sheets-plugin.md` currently documents only 5 of the 7 existing actions (missing `get_or_create_spreadsheet`, `get_or_create_sheet_tab`). This slice will document the 3 new actions and bump version history. Should I also back-fill the 2 missing existing actions while I'm in the file (small, improves accuracy), or keep the doc change strictly scoped to the 3 new actions?
5. **`delete_rows` param naming — 1-based inclusive vs. 0-based half-open.** I propose **1-based inclusive** `start_row`/`end_row` at the plugin boundary (matches the row numbers a user sees in the Sheets UI) and convert to Google's 0-based half-open internally. This is the least surprising for the LLM/user but differs from the raw API. Confirm the 1-based user-facing convention (vs. exposing the raw 0-based `startIndex`/`endIndex`).

---

## SA Review Notes

_(SA to populate during workplan review.)_

---

## SA Workplan Review

**Reviewed by SA — 2026-07-26**
**Status:** ✅ **Approved for implementation** — with 4 fold-in change requests (consistency + correctness guardrails). None are architectural; no re-review cycle required. SA verifies CR-A…CR-D, the delete-range safety property, and the OQ decisions at code review.

Ground-truthed against `google-sheets-plugin-v2.json` (7 existing actions), `google-sheets-plugin-executor.ts` (all value-level methods + the `getOrCreateSheetTab` `batchUpdate` precedent at line 396 + the `getSpreadsheetInfo` sheet-list shape at lines 555–580), `base-plugin-executor.ts` (confirmations advisory, lines 69–74), and `plugin-executer-v2.ts` (registry line 44). The plan honors every binding decision from the requirement's SA Architectural Review (keep `format_cells` as one action; `clear_range`/`delete_rows` split off as destructive; no new scope; standard-shaped auto-discovery) and matches the conventions set in the Drive-slice SA sections (full metadata block, `x-dynamic-options` on id inputs, `condition`-bearing confirmations). Grounding claims are accurate: the line-247 `console.error` is the file's only `console.*`; the registry and manager need no change; `batchUpdate`/`sheetId`/A1 handling is the sole real novelty and is correctly isolated into unit-testable helpers.

### Decisions on the 5 Open Questions

**OQ1 — `format_cells` range interface → A1 `range` + in-executor `a1RangeToGridRange`. APPROVED (reject numeric row/col params).**
Every existing Sheets action speaks A1 (`read_range`, `write_range`, `append_rows` all use a `range` string). A second numeric `start_row/col`/`end_row/col` vocabulary would fork the input language the LLM must learn and is exactly the kind of divergence semantic-determinism disfavours. The A1→GridRange parse is deterministic and belongs in one pure, unit-tested helper. Two implementation mandates fold into CR-C: (a) when the A1 string carries no sheet-name prefix, `resolveSheetId` defaults to the first tab (index 0) — this must be stated in `usage_context` so a header-format on the wrong tab is not a silent surprise; (b) `freeze_rows` maps to the sheet-level `gridProperties.frozenRowCount` and is independent of the row bounds in `range` — document that too.

**OQ2 — Phase 1 scope = bold + background + frozen header row. APPROVED (defer font/size/color/alignment + conditional-format to Phase 2).**
Matches the requirement's must-have ("bold + background + frozen header") and the feasibility table (font/alignment inside the same action later; `add_conditional_format` is a separate Phase 2 action — a different, rule-based mental model). Constraint: when font/alignment arrive in Phase 2 they extend **this same `format_cells` action** with new optional params (consistent with the ratified OQ4 granularity), not a new action. The "no format field set → no-op success" path is the right shape.

**OQ3 — `clear_range` = values-only `values.clear`. APPROVED (reject `updateCells` full clear).**
Narrowest, most intuitive "clear," the natural inverse of `write_range`, and it preserves formatting/notes. It is also the lower-risk path: `values:clear` is A1-based and sidesteps `resolveSheetId`/GridRange entirely. A formatting-clearing variant is a distinct intent → a separate future action if real demand appears, not a hidden mode of this one.

**OQ4 — Plugin-doc back-fill = YES, document the 2 undocumented existing `get_or_create_*` actions while in the file. APPROVED.**
The doc is already stale (5 of 7 actions), and the missed-plugin-MD lesson from the Drive slice is precisely why doc accuracy is in-scope. Back-filling `get_or_create_spreadsheet` and `get_or_create_sheet_tab` is doc-only, zero code risk, and prevents the LLM/users being misled about the catalog. Fold it in; bump version history to reflect all 10 documented actions (7 existing + 3 new).

**OQ5 — `delete_rows` params = 1-based inclusive `start_row`/`end_row`, converted internally. APPROVED (reject raw 0-based half-open).**
1-based inclusive matches the row numbers a user sees in the Sheets UI and is the least-surprising boundary for the LLM. The conversion (`startIndex = start_row − 1`, `endIndex = end_row`) is deterministic and unit-tested. Mandate (safety-critical, see CR-D): the `start_row < 1` / `end_row < start_row` guard runs **before** any fetch, and the emitted `deleteDimension.range` must **always carry a finite `endIndex`** — an omitted `endIndex` is interpreted by Google as "delete to the end of the sheet," which is the exact whole-sheet-wipe this action must never produce.

### Per-action validation verdict

| Action | Schema/convention | Safety | Idempotency | Verdict |
|---|---|---|---|---|
| `format_cells` | domain `table`/cap `update`/entity `row`; A1 `range` (OQ1); scope bold+bg+freeze (OQ2) | non-destructive → no confirmation (correct) | `true` (correct) | ✅ approved (apply CR-A, CR-C) |
| `clear_range` | domain `table`/cap `delete`; A1 `range` via `values:clear` (OQ3) | destructive → `rules.confirmations` w/ `condition` present ✅; scoped to exact A1 range | `true` (clearing empty = no-op) (correct) | ✅ approved (apply CR-A) |
| `delete_rows` | domain `table`/cap `delete`; 1-based inclusive (OQ5); `sheet_name`→`resolveSheetId` | destructive+structural → confirmation ✅; **bounded `deleteDimension` mandatory** | `false` (index shift) — correctly stated + `usage_context` note | ✅ approved (apply CR-A, CR-D) |

### Change requests to fold in during implementation (no re-review needed)

1. **CR-A (Medium) — replicate the FULL top-level metadata block + artifact-binding attributes per action.** Every existing Sheets action carries, as **top-level** fields (not only inside `parameters`/`output_schema`): `description`, `usage_context`, `idempotent`, `domain`, `capability`, `input_entity`, `output_entity`, `input_cardinality`, `output_cardinality`, `output_fields`, `required_params`, `optional_params`, and `must_support` (where a genuine capability constraint exists). All 3 new actions must emit the complete block so CapabilityBinder discovery/metadata stays uniform. Also match the id-input binding convention: `spreadsheet_id` carries `x-dynamic-options {source:"list_spreadsheets"}` **+** `x-context-binding {source:"workflow_config",key:"spreadsheet_id"}` **+** `x-from-artifact:true`; the A1 `range` carries `x-dynamic-options {source:"list_sheet_names", depends_on:["spreadsheet_id"]}` **+** `x-from-artifact:true` **+** `x-artifact-field:"tab_name"`; `delete_rows.sheet_name` carries `x-dynamic-options {source:"list_sheet_names", depends_on:["spreadsheet_id"]}`. `must_support` is optional — only add it where a real constraint exists; do not invent (matches the CR1 guidance applied to the Drive slice). The workplan names only a subset of these per action; emit the full set.

2. **CR-B (Low, previously-omitted) — surface the SECOND touched file that logs via `console.*`.** This slice also modifies `app/test-plugins-v2/page.tsx` (adding `PARAMETER_TEMPLATES`). That file still contains pre-existing `console.log('DEBUG: …')` calls (the same ones flagged in the Drive-slice SA/QA review). Per CLAUDE.md § Logging "non-compliant files you touch," the Dev must **flag them to the user** — with the caveat that this is a **client component** where Pino (`createLogger`) is server-only, so it is **not** a straight conversion (gate behind a debug flag / remove is the realistic option). The workplan's Standards section currently flags only the executor's line-247 `console.error`; add the `test-plugins-v2/page.tsx` note so the touched-file rule is honored consistently and the user can decide. Do **not** silently leave it unaddressed.

3. **CR-C (Medium, correctness) — `format_cells` guardrails.** (a) The `repeatCell` `fields` mask must be scoped to **exactly** the provided subfields (`userEnteredFormat.textFormat.bold` and/or `userEnteredFormat.backgroundColor`, comma-joined) — **never** a broad `userEnteredFormat`, which would clobber the user's unrelated existing cell formatting (a silent data-loss bug). (b) Define the `formatted_cells` summary as an **explicit typed object** in `output_schema` with named boolean/int sub-fields (`bold_applied`, `background_applied`, `frozen_rows`), not a loose bag — keeps the output deterministic for downstream steps. (Naming nit only, non-blocking: `formatted_cells` reads like a count/array; consider `format_summary`.) (c) Document the two OQ1 behaviours in `usage_context`: no-sheet-prefix ⇒ first tab, and `freeze_rows` is sheet-level (ignores `range` row bounds).

4. **CR-D (Low, correctness) — `delete_rows` finalisation.** The emitted `deleteDimension.range` must **always** include both a finite `startIndex` **and** `endIndex` (never an open-ended range). Keep the pre-fetch guard (`start_row ≥ 1`, `end_row ≥ start_row`). When `sheet_name` is omitted (defaults to first tab), the confirmation message must fall back to the resolved sheet title rather than rendering an empty `'{sheet_name}'`.

### Safety / correctness confirmation

- **Confirmations are advisory — CONFIRMED.** `base-plugin-executor.ts` lines 69–74 only log "would be handled via UI" and do not block. The plan's position — safety is enforced **in the executor method** (exact A1 range for `clear_range`; bounded index range for `delete_rows`), not by the rule — is correct and mandatory. The `delete_rows` DELETE-INTENDED-RANGE-ONLY unit assertion (`{dimension:"ROWS", startIndex:1, endIndex:5}` for rows 2–5, inspected via `getAllFetchCalls()`) is the right gate; CR-D strengthens it to also guarantee `endIndex` is never omitted.
- **Idempotency — CONFIRMED correct per API semantics.** `format_cells`/`clear_range` idempotent; `delete_rows` not (index shift), with the non-idempotency `usage_context` note. No executor-side dedupe (correct — that would be plugin-specific logic).
- **`batchUpdate` combining `repeatCell` + `updateSheetProperties` in one POST — CONFIRMED viable.** `batchUpdate` accepts a heterogeneous `requests[]`; both target the same resolved `sheetId`. `resolveSheetId` reusing `getSpreadsheetInfo` (which always returns `sheet_id`+`title` even with `include_sheet_data:false`, lines 555–565) mirrors the existing `getOrCreateSheetTab` case-insensitive title match (lines 377–380). Sound and DRY.
- **No new OAuth scope — CONFIRMED.** `required_scopes` includes `https://www.googleapis.com/auth/spreadsheets` (line 23); `values.clear` and `spreadsheets.batchUpdate` are covered. Purely additive, zero re-consent.
- **Registry/manager — CONFIRMED no change.** `google-sheets` is at `plugin-executer-v2.ts` line 44; definition auto-loads; actions auto-discovered by CapabilityBinder.
- **Logging (Mandatory Rule 3) — CONFIRMED.** Exactly one `console.*` in the executor: `console.error('❌ Google Sheets append_rows failed:', …)` at line 247 (inside `appendRows`). The proposed logging-only conversion to `this.logger.error({ status, statusText, spreadsheet_id, range, err: errorData }, 'Google Sheets append_rows failed')` — leaving the surrounding 403/404 message-parsing branches untouched — is clean and correct. **SA endorses the conversion**; it proceeds on user approval per CLAUDE.md § Logging (the retry/error-message logic must be left byte-for-byte otherwise). All new methods must use `this.logger` only. (See CR-B for the second touched file.)
- **Repository/Supabase — N/A.** Executors are stateless; no DB writes.

### V6 / CapabilityBinder awareness — type-clean CONFIRMED

The 3 actions emit scalar/status outputs only (`spreadsheet_id`, `sheet_id`, `range`, `cleared_range`, `deleted_row_count`, a `format_summary` object of booleans, `*_at` timestamps). `x-semantic-type` convention applies to **object-typed array items** representing plugin entities (e.g. `file_attachment`/`folder`); none of these outputs qualify, and `domain:"table"`/`entity:"row"` are already registered. **No `input-type-compat.ts` change and no capability-binder change required.** Contrast the Phase 2 items that DO need type work: `list_available_slots` (new `time_slot`/`availability_slot` semantic type + `input-type-compat.ts`), `add_conditional_format`/`sort_range`. Run `validatePluginTypeAnnotations` as planned to confirm no unknown `x-semantic-type` slipped in.

### LEAN test policy — CONFIRMED meets the standard

Exactly 3 unit tests/action (happy + 401 auth-failure + invalid-input) + the single `delete_rows` bounded-range safety assertion = **10 unit tests**, with deeper coverage (A1-parser edge cases, multi-request format combos, frozen-row round-trips, hex-color normalisation) in the credential-gated integration file that skips without a token. This satisfies the project's per-action **happy + auth-failure + invalid-input** gate (the same bar the Drive slice ultimately met). Two correctness expectations for QA to hold the Dev to: (i) the `delete_rows` invalid-input case (`end_row < start_row` or `start_row < 1`) must assert **no fetch is issued** (guard precedes the network call); (ii) the safety assertion must confirm both `startIndex` and `endIndex` are finite (CR-D), not merely that the values are 1 and 5.

### Verdict

✅ **Approved for implementation.** Fold CR-A…CR-D into the definition JSON, executor, and Standards section while coding — they are consistency and correctness guardrails, not architectural changes, and do not require another workplan-review pass. SA will verify CR-A…CR-D, the delete-range safety property (bounded, finite `endIndex`), the `repeatCell` narrow-`fields`-mask, and the OQ decisions at code review.

---

## QA Testing Report

**QA — 2026-07-26**
**Test mode:** full (all acceptance criteria + the two safety guards + edge sanity checks)
**Strategy used:** A (Jest unit) — the LEAN unit suite is the primary gate; integration file is credential-gated and skips without a live token, so not exercised here. Code inspection (Strategy A + manual read) used to confirm the two safety guards at source level.
**Focus:** api / security (destructive-action safety) / schema
**Skipped:** Integration test (credential-gated, no token in this environment — by design); E2E (N/A, no UI in this slice).
**Input source:** prompt keywords + workplan Testing section (LEAN policy).

### Actual test run (on record)

Command: `npx jest tests/plugins/unit-tests/google-sheets.test.ts`

```
Test Suites: 1 passed, 1 total
Tests:       36 passed, 36 total
Snapshots:   0 total
Time:        3.581 s
```

This is an **actual observed green run** (not inferred). All 12 Phase 1 tests are present and pass:
- `format_cells`: happy (bold+bg+freeze single batchUpdate) · 401 auth · missing-range invalid — ✅ 3/3
- `clear_range`: happy (`:clear`) · 401 auth · missing-range invalid — ✅ 3/3
- `delete_rows`: happy (bounded deleteDimension) · 401 auth · inverted-range invalid (zero fetch) · SAFETY bounded-finite-endIndex — ✅ 4/4
- `a1RangeToGridRange` pure: header range · whole-column — ✅ 2/2

The trailing `Jest did not exit one second after the test run` message is a benign open-handles warning (Pino/async timers), **not** a test failure — all 36 assertions passed before it printed.

### Test Coverage
| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| `format_cells` applies bold + background + frozen header via one batchUpdate | ✅ | Pass | Asserts both `repeatCell` + `updateSheetProperties` present; `format_summary` typed object correct |
| `format_cells` never clobbers unrelated formatting (narrow `fields` mask — CR-C) | ✅ | Pass | See safety-guard verdict below |
| `clear_range` clears values via `values:clear` (values-only, formatting preserved) | ✅ | Pass | `cleared_range` returned; POST to `:clear` |
| `delete_rows` deletes 1-based inclusive range, bounded, non-idempotent | ✅ | Pass | rows 2–5 → `deleted_row_count:4`; exact `{startIndex:1,endIndex:5}` |
| `delete_rows` never widens to whole-sheet wipe (finite endIndex — CR-D) | ✅ | Pass | See safety-guard verdict below |
| Destructive-safety guard precedes network (no fetch on invalid range) | ✅ | Pass | Inverted range issues **zero** fetches |
| Auth failure (401) surfaces as error on all 3 actions | ✅ | Pass | Each action asserts `expectErrorResult` |
| Invalid input rejected on all 3 actions | ✅ | Pass | Missing range / inverted range |
| Zero `console.*` in executor (Mandatory Rule 3) | ✅ | Pass | Grep-confirmed; line-247 Pino conversion intact |

### Two safety-guard verdicts

- **CR-C (`format_cells` narrow `fields` mask): HOLDS.** `formatCells` (executor lines 788–808) builds `fieldMasks[]` from only the supplied subfields (`userEnteredFormat.textFormat.bold` and/or `userEnteredFormat.backgroundColor`) and joins them; there is no code path that emits a bare `userEnteredFormat`, and `repeatCell` is only pushed when at least one subfield is set. The unit test inspects the real request body and asserts both narrow paths present plus `.not.toContain('userEnteredFormat')` — **and this assertion actually ran and passed** in the recorded run. Silent-formatting-destruction risk is closed.
- **CR-D (`delete_rows` finite `endIndex` + guard-before-network): HOLDS.** The bounds guard (integer check, `start_row ≥ 1`, `end_row ≥ start_row`) runs at executor lines 902–913 **before** `resolveSheetId` (line 915, the first network call). The emitted range is `{ sheetId, dimension:'ROWS', startIndex: start_row-1, endIndex: end_row }` — `endIndex` is unconditionally finite. Tests assert the exact `{startIndex:1, endIndex:5}` for rows 2–5, that both bounds are `Number.isFinite`, and that an inverted range issues **zero** fetches — **all ran and passed**. Whole-sheet-wipe risk is closed.

### Sanity check on SA non-blocking notes
- **(a) `delete_rows` confirmation `{sheet_name}` empty-quotes:** Confirmed **cosmetic/advisory only — does NOT affect delete safety.** Confirmations are UI-templated from raw input params and are non-blocking (base executor logs "would be handled via UI"). Executor safety is enforced in-code by the bounded, finite range — independent of the confirmation string. The executor also returns the resolved tab `title` in its `sheet_name` output field regardless of the placeholder. No defect masked.
- **(b) Quoted-tab apostrophe edge:** Confirmed **genuinely rare and not hit by the happy path.** The prefix strip (`formatCells`, line 778) unquotes `'My Sheet'` but does not collapse Sheets' doubled-apostrophe escaping (`''`→`'`); this only affects tab names literally containing an apostrophe. Happy-path unit tests use `Sheet1` / `Sheet1!A1:D1` (no apostrophe), so the edge is never exercised and does not affect the green run. Correctly deferred to a future hardening pass.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. `format_cells` / `delete_rows` each make at most 2 sequential calls (resolveSheetId info fetch + one batchUpdate); `clear_range` is a single call. No redundant round-trips.

#### Edge Cases (nice to fix)
1. Quoted-tab doubled-apostrophe normalization in `a1RangeToGridRange` prefix strip (SA note b) — out of unit scope, deferred. Low.
2. `delete_rows` confirmation-message `{sheet_name}` placeholder can render empty quotes when the tab defaults to the first sheet (SA note a) — cosmetic UI-string only. Low.

Both are already recorded as SA non-blocking notes; neither is a functional defect.

### Test Outputs / Logs
```
Phase 1 formatting / structural actions
  format_cells
    √ applies bold + background + freeze via a single batchUpdate (10 ms)
    √ returns an error on 401 auth failure (2 ms)
    √ rejects missing range (invalid input) (1 ms)
  clear_range
    √ clears a range via the values :clear endpoint (3 ms)
    √ returns an error on 401 auth failure (2 ms)
    √ rejects missing range (invalid input) (3 ms)
  delete_rows
    √ deletes a bounded row range via batchUpdate deleteDimension (3 ms)
    √ returns an error on 401 auth failure (3 ms)
    √ rejects end_row < start_row and issues NO fetch (invalid input) (3 ms)
    √ SAFETY: sends a bounded deleteDimension range with a finite endIndex (never whole-sheet) (2 ms)
  a1RangeToGridRange (pure)
    √ parses a header range into a 0-based half-open GridRange (2 ms)
    √ omits row bounds for a whole-column range (A:D) (3 ms)

Test Suites: 1 passed, 1 total
Tests:       36 passed, 36 total
```

### Final Status
- [x] All acceptance criteria pass — **ready for commit** (36/36 unit tests observed green; both safety guards verified at source and by passing assertions; no bugs found)
- [ ] Issues found — Dev must address before commit

**QA sign-off: ✅ PASS.** No new tests added — the LEAN suite (3/action + delete_rows safety assertion + 2 pure-fn checks) is complete and adequate; no coverage gap uncovered that hides a real risk.

---

## Commit Info

| Field | Value |
|-------|-------|
| Branch | `feature/google-suite-phase1-actions` |
| Commit | `88fa2e8` — `feat(plugins): add Phase 1 Google Sheets formatting & structural actions` |
| Date | 2026-07-26 |
| Files | 8 (definition JSON, executor, unit + integration tests, plugin doc, test-page, this workplan, Drive-workplan Commit-Info backfill) |
| Tests | 36/36 unit tests passing |
| Pushed | No — local commit only, pending PR |
| Gates | SA workplan-review ✅ · SA code-review ✅ · QA PASS ✅ · user-approved ✅ |

---

## SA Code Review

**Code Review by SA — 2026-07-26**
**Status:** ✅ **Code Approved for QA** — no blocking items. Two low-severity, non-blocking notes below.

Reviewed the uncommitted diff on `feature/google-suite-phase1-actions` (executor, definition JSON, unit + integration tests, plugin doc, test page). Ground-truthed the two safety-critical guards (CR-C, CR-D) against both the executor code and the asserting tests, verified helper correctness by tracing edge cases, confirmed the line-247 Pino conversion and zero-`console.*` state, and checked CR-A metadata parity + the OQ1–OQ5 decisions. (`GOOGLE_DRIVE_PHASE1_ACTIONS_WORKPLAN.md` appears in the diff from an unrelated TL Commit-Info backfill — correctly ignored, not part of this slice.)

### Per-area verdict

| Area | Verdict | Notes |
|---|---|---|
| CR-C — `format_cells` narrow `fields` mask | ✅ **Airtight** | Mask built dynamically from only the supplied subfields; broad `userEnteredFormat` never emitted; test asserts the narrow paths present + `.not.toContain('userEnteredFormat')` |
| CR-D — `delete_rows` finite `endIndex` + pre-fetch guard | ✅ **Airtight** | `endIndex = end_row` always finite; bounds guard precedes the first network call (`resolveSheetId`); tests assert exact `{startIndex:1,endIndex:5}`, finite bounds, and **zero fetches** on inverted range |
| Logging (Mandatory Rule 3) | ✅ | Line-247 `console.error` → `this.logger.error({…, err: errorData}, …)` with 403/404 parse/throw intact; grep confirms **zero** `console.*` in executor; no new `console.*` added to `page.tsx` |
| SA decisions (OQ1–OQ5) | ✅ | A1 `range` + `a1RangeToGridRange` (no numeric params); scope = bold+bg+freeze; values-only `values:clear`; 1-based inclusive rows; plugin doc = 3 new + 2 back-filled, v1.1.0 |
| CR-A — full metadata + id bindings | ✅ | All 3 actions carry the complete top-level block; `spreadsheet_id` has `x-dynamic-options`+`x-context-binding`+`x-from-artifact`; A1 `range` has `x-from-artifact`+`x-artifact-field:"tab_name"`+cascading `list_sheet_names`; `sheet_name` cascades correctly |
| Helper correctness | ✅ | `columnLettersToIndex` (A→0, AA→26 ✅), `a1RangeToGridRange` (half-open, whole-col/row, single-cell, prefix strip ✅), `hexToColor` (3-/6-char, 0–255→0..1 ✅), `resolveSheetId` (reads `getSpreadsheetInfo` `sheet_id`/`title`, case-insensitive, default-first-tab, clean `sheet_not_found` ✅) |
| Convention parity | ✅ | snake_case (+`sheet_id`/`sheet_name`) returns, `x-guaranteed` `*_at` timestamps, `this.logger`, raw-fetch+manual-throw matching existing methods |
| Test adequacy (LEAN) | ✅ | Exactly happy+401+invalid per action + the `delete_rows` bounded-range safety assertion + 2 pure `a1RangeToGridRange` checks; integration lifecycle is credential-gated |
| Standards (TS strict / Supabase / hardcoding / V6) | ✅ | `any` on `connection`/`parameters` matches existing file convention (parity, not new drift); no DB access; no plugin-specific rules leaked to prompt/compiler; scalar/status outputs only → no new `x-semantic-type` |

### Must-fix (blocking)

None.

### Nice-to-have (non-blocking)

1. **`delete_rows` confirmation message `{sheet_name}` fallback (CR-D part b) — not actually implemented, and the task-list claim is slightly inaccurate.** The definition message is `"Delete rows {start_row}–{end_row} from '{sheet_name}'? …"`; when `sheet_name` is omitted it renders empty quotes `''`. The workplan task states this was handled "in-executor," but confirmations are **advisory and UI-templated from the raw input params** — the executor cannot inject its resolved `title` into that message. Impact is purely cosmetic (an advisory string; it does not block and executor safety is enforced in-code by the bounded range). Acceptable to ship as-is; if a cleaner UX is wanted, make `sheet_name` behaviour explicit in the message (e.g. "…from the selected tab…") rather than a `{sheet_name}` placeholder that can render blank. Correct the task-list wording so the record is accurate.
2. **`a1RangeToGridRange` quoted-tab edge (Low).** Sheet-prefix stripping in `formatCells` unquotes `'My Sheet'` but does not collapse Sheets' doubled-apostrophe escaping (`''`→`'`). Only affects tab names containing an apostrophe — a rare edge, already out of the unit scope and covered indirectly by the credential-gated integration path. Note for a future hardening pass; not worth a cycle now.

### Safety confirmation (explicit)

- **CR-C field-mask guard: airtight.** `formatCells` constructs `fieldMasks[]` by pushing only `userEnteredFormat.textFormat.bold` and/or `userEnteredFormat.backgroundColor` for the subfields actually supplied, then `fields: fieldMasks.join(',')`. There is no code path that emits a bare `userEnteredFormat`, and `repeatCell` is only pushed when at least one subfield is set. The unit test inspects the real request body and asserts both narrow paths present and `.not.toContain('userEnteredFormat')`. The silent-formatting-destruction risk is closed.
- **CR-D endIndex guard: airtight.** `deleteRows` validates `start_row`/`end_row` are integers, `start_row ≥ 1`, and `end_row ≥ start_row` **before** `resolveSheetId` (the first network call), then emits `{ sheetId, dimension:'ROWS', startIndex: start_row-1, endIndex: end_row }` — `endIndex` is unconditionally finite, so Google can never interpret it as "delete to end of sheet." Tests assert the exact bounded range for rows 2–5 (`startIndex:1, endIndex:5`), that both bounds are finite, and that an inverted range issues **zero fetches**. The whole-sheet-wipe risk is closed.

### Code Approved for QA: **Yes**

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-26 | QA test pass | QA ran the scoped unit suite (`npx jest tests/plugins/unit-tests/google-sheets.test.ts`) and recorded an **actual observed green run: 36 passed / 36 total, 1 suite passed, 3.581 s** (all 12 Phase 1 tests present and passing). Verified both safety guards hold — CR-C (`format_cells` narrow `repeatCell` `fields` mask, never bare `userEnteredFormat`; `.not.toContain('userEnteredFormat')` assertion ran + passed) and CR-D (`delete_rows` guard-before-network + always-finite `endIndex`; exact `{startIndex:1,endIndex:5}`, finite bounds, zero fetches on inverted range — all ran + passed). Sanity-checked SA non-blocking notes: (a) `{sheet_name}` empty-quotes is cosmetic/advisory and does NOT affect delete safety; (b) quoted-tab apostrophe edge is genuinely rare and not hit by the happy path. No bugs found; no tests added beyond LEAN policy. **✅ QA PASS — ready for commit.** |
| 2026-07-26 | SA code review | SA code-reviewed the uncommitted implementation. Verified CR-C (`format_cells` narrow `repeatCell` `fields` mask — airtight, never broad `userEnteredFormat`) and CR-D (`delete_rows` always-finite `endIndex` + pre-fetch bounds guard — airtight, zero fetch on invalid) against both executor code and asserting tests. Confirmed line-247 Pino conversion with zero `console.*` remaining (and none added to `page.tsx`), CR-A full-metadata/id-binding parity, OQ1–OQ5 decisions honored, helper correctness (`a1RangeToGridRange`/`columnLettersToIndex`/`hexToColor`/`resolveSheetId`), LEAN test adequacy, plugin-doc backfill (10 actions, v1.1.0), and standards (TS `any` = existing convention, no Supabase, no hardcoded rules, V6 type-clean). No blocking items; 2 non-blocking notes (CR-D confirmation `{sheet_name}` fallback is advisory/UI-only and unimplementable in-executor — task-list wording to be corrected; quoted-tab apostrophe edge deferred). **✅ Code Approved for QA.** |
| 2026-07-26 | Initial workplan | Dev drafted Phase 1 Sheets slice: 3 actions (`format_cells` bold/background/freeze, `clear_range`, `delete_rows`). Per-action schemas + Google API mappings + idempotency/confirmation semantics, shared batchUpdate/sheetId/A1 helpers, LEAN 3-per-action test plan + 1 delete-range safety assertion, standards flags (1 `console.error` at line 247 → Pino pending user approval; no new scope; plugin-doc update in DoD), 5 open questions for SA. Workplan only — no implementation code. |
| 2026-07-26 | SA workplan review | SA ground-truthed the plan against the Sheets definition/executor (`batchUpdate` precedent line 396, `getSpreadsheetInfo` sheet-list 555–580, line-247 `console.error`), base executor (confirmations advisory 69–74), and registry (line 44). Resolved the 5 open questions (OQ1 A1 range + parser; OQ2 bold+bg+freeze scope; OQ3 values-only `values:clear`; OQ4 back-fill the 2 undocumented existing actions; OQ5 1-based inclusive rows). Per-action verdicts ✅. Raised 4 fold-in change requests: CR-A (full top-level metadata block + `x-dynamic-options`/`x-context-binding`/`x-from-artifact` parity), CR-B (surface the 2nd touched file `test-plugins-v2/page.tsx` console.log — client component, not straight Pino), CR-C (`format_cells` narrow `repeatCell` `fields` mask + typed `format_summary` output + first-tab/sheet-level-freeze docs), CR-D (`delete_rows` always-finite `endIndex` + confirmation sheet-name fallback). Confirmed confirmations-advisory/safety-in-code, no new scope, no registry change, single console.* (endorsed the logging-only conversion pending user approval), type-clean V6 (no `input-type-compat.ts` change), LEAN test policy meets the happy+auth+invalid gate. **Approved for implementation.** |
