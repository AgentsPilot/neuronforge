# Workplan: Google Docs Plugin — Phase 1 `replace_text` Action

> **Last Updated**: 2026-07-26

**Developer:** Dev
**Requirement:** [GOOGLE_SUITE_PLUGIN_ROBUSTNESS_REQUIREMENT.md](/docs/requirements/GOOGLE_SUITE_PLUGIN_ROBUSTNESS_REQUIREMENT.md) (✅ Approved — Phase 1 Docs slice)
**Branch:** `feature/google-suite-phase1-actions` — ✅ confirmed current branch (`git branch --show-current`). This document is workplan-only; **no implementation code** is written until SA workplan-review passes. RM owns branch creation and the eventual merge; Dev never commits to `main`.
**Status:** Planning (awaiting SA workplan review)

## Overview

This workplan covers the **Phase 1 Google Docs slice** of the Google Suite robustness requirement: a single new action, `replace_text`, on the existing `google-docs` V2 plugin. Per the requirement's SA Architectural Review (OQ5, feasibility table row "Docs `replace_text`"), this is the **natural Phase 1 entry point for Docs** because `replaceAllText` requires **no index math** — unlike the Phase 2 Docs actions (`format_document_text`, `insert_table`) which must read live document structure to resolve character indices. It is therefore the safest Docs mutation to ship first.

`replace_text` performs a find-and-replace across **all** matching occurrences in a document via `documents.batchUpdate` with a single `replaceAllText` request, and returns the count of replacements made (`occurrences_changed`). It unlocks template-fill workflows ("Dear {name}" → "Dear Alice") — a very common SMB document-generation pattern.

The action fits the **already-granted `https://www.googleapis.com/auth/documents` scope** — confirmed against `google-docs-plugin-v2.json` (`required_scopes` includes `documents` and `drive`). **No new OAuth scope, no re-consent, no Google app re-verification.** Purely additive.

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [Files to Create / Modify](#files-to-create--modify)
4. [`replace_text` Specification](#replace_text-specification)
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
| Plugin definition | `lib/plugins/definitions/google-docs-plugin-v2.json` | Add 1 entry to `actions{}`; bump `plugin.version` 1.0.0 → 1.1.0 |
| Executor | `lib/server/google-docs-plugin-executor.ts` | Add 1 `switch` case + 1 private method (`replaceText`). **No logging conversion needed — file is already zero-`console.*`** |
| Registry | `lib/server/plugin-executer-v2.ts` | **No change** — `google-docs` already registered (line 45) |
| Plugin manager | `lib/server/plugin-manager-v2.ts` | **No change** — definition auto-loaded; action auto-discovered by CapabilityBinder |
| Test page | `app/test-plugins-v2/page.tsx` | Add 1 `PARAMETER_TEMPLATES` entry under `"google-docs"` (smoke-check UX) |
| Unit tests | `tests/plugins/unit-tests/google-docs.test.ts` | Add LEAN 3 unit tests (happy + 401 auth + invalid-input) |
| Plugin doc | `docs/plugins/google-docs-plugin.md` | Document `replace_text` (action #6) + version-history bump; Last Updated 2026-07-26 |

**Confirmed from code grounding:**

- **Executor contract (`base-plugin-executor.ts`):** the base `executeAction` template handles param normalisation, the runtime param-constraint guard, schema validation, confirmation surfacing (**advisory only** — lines 69–73 log "Confirmations required (would be handled via UI)" and do **not** block), connection retrieval, success formatting, and error mapping. The new action = one `case` in `executeSpecificAction` + one private method that makes the Google call and returns a schema-shaped object.
- **Auth:** `connection.access_token` bearer, exactly as the existing 5 Docs actions do. Never log the token.
- **HTTP style:** the Docs executor uses **raw `fetch` + manual `!response.ok` throw** (it does NOT use the base `handleApiResponse`). The new method follows the same raw-fetch style for consistency.
- **`batchUpdate` precedent already exists in this file:** `insertText` (line ~167) and `appendText` (line ~239) already POST to `${this.docsApisUrl}/${document_id}:batchUpdate` with a `requests[]` body and read the JSON reply. The new `replaceText` method reuses this exact request/error shape — the only new piece is the `replaceAllText` request object and reading `replies[0].replaceAllText.occurrencesChanged` from the response.
- **No index math:** unlike `insertText`/`appendText` (which resolve `end_index`), `replaceAllText` is content-anchored — Google finds and replaces all matches server-side. There is **no** live-structure read, no off-by-one boundary. This is why it is sequenced first (OQ5).
- **Return shape:** existing actions return a **dual snake_case + legacy camelCase** object with an `x-guaranteed` `*_at` timestamp. The new action follows suit.
- **Logging:** the executor uses `this.logger` (Pino) throughout, including the existing `this.logger.debug(...)` traces and `this.logger.error({ err, status }, ...)` on failures. **Grep-confirmed: 0 `console.*` calls in `google-docs-plugin-executor.ts`.** No Mandatory-Rule-3 conversion is required for this file (positive finding — reported in [Standards & Risks](#standards--risks)).
- **Registry/manager:** `google-docs` is present in `plugin-executer-v2.ts` (line 45); the definition JSON is auto-loaded and actions auto-discovered. **No wiring changes.**
- **id-input binding convention (CR-A parity):** every existing Docs action wires `document_id` **only** as `x-dynamic-options { source: "list_documents", description: "Fetches available documents dynamically" }`. Docs does **not** use the Sheets-style `x-context-binding`/`x-from-artifact` attributes. The new action must match the **Docs plugin's own** convention exactly (not the Sheets convention) — this is the CR-A parity requirement applied to this plugin.

---

## Implementation Approach

**One executor method (`replaceText`), a thin typed wrapper over `documents.batchUpdate` with a single `replaceAllText` request**, returning a snake_case (+ legacy camelCase) object matching the action's `output_schema`.

**Root-cause phase (per CLAUDE.md V6 protocol):** This is **plugin-layer work only**. No V6 pipeline/compiler changes — the action is standard-shaped and auto-discovered by CapabilityBinder. Per Platform Design Principles, **no plugin-specific rules are added to any system prompt or the compiler**; the definition schema (`domain`/`capability`/`input_entity`/`output_entity`/cardinality/`output_fields`) is the sole source of truth.

### No new helpers needed

`replace_text` requires no A1/GridRange/sheetId resolution (that was the Sheets-slice novelty) and no `end_index` resolution (that is the Phase 2 Docs concern). It is a single `batchUpdate` POST reusing the exact fetch+error pattern already in `insertText`/`appendText`. The only new logic is:
1. Build the `replaceAllText` request object from `text_to_find`, `replace_text`, `match_case`.
2. Read `occurrences_changed` from `data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0` (Google **omits** the field when zero matches are found — default to `0`).

### Idempotency (reasoned from Docs API semantics — no hacks)

`replace_text` **is state-changing** (it mutates document content). Its idempotency is **conditional**, not guaranteed:

- **Converges to a no-op in the normal case:** when the replacement string does **not** contain `text_to_find`, re-running after the first pass finds 0 matches → `occurrences_changed: 0`, no further mutation. This is the "idempotent in the sense that re-running yields 0 further changes" property noted in the requirement.
- **Does NOT converge in the self-referential case:** if the replacement string **contains** `text_to_find` (e.g. find `"cat"` → replace `"cats"`), every re-run matches again and grows the text (`cats` → `catss` → …). So the action is **not universally idempotent.**

Recommendation: set **`idempotent: false`** in the definition (matching `insert_text`/`append_text`, which are also mutations marked `false`), and document the convergence semantics **and** the self-referential caveat in `usage_context`. No executor-side dedupe or convergence magic — that would be plugin-specific logic. See [OQ2](#open-questions-for-sa).

### Safety / confirmation posture (SA to decide — [OQ1](#open-questions-for-sa))

`replace_text` mutates content across **all** occurrences, so a poorly-scoped `text_to_find` could change more of the document than the user intended. However it is **not destructive/irreversible** in the way `delete_file` / `delete_rows` are — the change is a content edit the user can reverse (replace back, or Google Docs undo/version history). The existing Docs write actions (`insert_text`, `append_text`, `create_document`) declare `rules.confirmations` **only as a size-threshold guard** (`text_length > 5000`), not a blanket mutation confirm. Proposed default: **follow that precedent** — no blanket confirmation; optionally a mild threshold-style confirmation. Flagged for SA decision.

---

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/plugins/definitions/google-docs-plugin-v2.json` | modify | Add `replace_text` action (full top-level metadata block + `x-dynamic-options` on `document_id` matching Docs convention + output_schema + output_guidance/common_errors + `rules`); bump `plugin.version` → 1.1.0 |
| `lib/server/google-docs-plugin-executor.ts` | modify | Add `replace_text` `switch` case + `replaceText()` private method (reuses existing `:batchUpdate` fetch+error pattern). No logging conversion (already zero `console.*`) |
| `app/test-plugins-v2/page.tsx` | modify | Add a `replace_text` entry to the existing `"google-docs"` `PARAMETER_TEMPLATES` block |
| `tests/plugins/unit-tests/google-docs.test.ts` | modify | Add LEAN 3 unit tests for `replace_text` (happy + 401 auth + invalid-input) |
| `docs/plugins/google-docs-plugin.md` | modify | Document `replace_text` as action #6 + version-history bump; Last Updated 2026-07-26 |

**Not touched / not needed:**
- `lib/server/plugin-executer-v2.ts`, `lib/server/plugin-manager-v2.ts` — no registry/manager change (auto-discovery).
- No plugin-doc back-fill needed — unlike the Sheets slice, all 5 existing Docs actions are already documented in `google-docs-plugin.md`.
- No integration test file exists for Docs (`tests/plugins/integration-tests/` has no `google-docs.*`). Given `replace_text` has **no index math** and a minimal edge surface, scaffolding one is optional this slice — see [OQ3](#open-questions-for-sa).

---

## `replace_text` Specification

Base host constant in executor is `this.docsApisUrl` (= `https://docs.googleapis.com/v1/documents`).

| Field | Value |
|---|---|
| **Google API** | `POST /v1/documents/{documentId}:batchUpdate` with a single `replaceAllText` request |
| **domain** `document` · **capability** `update` · input_entity `document` · output_entity `document` · cardinalities `single`/`single` |
| **idempotent** | `false` (state-changing; conditionally convergent — see Idempotency above) |
| **complexity** | 🟢 (no index math) |

### Input schema

| Param | Type | Required | Notes |
|---|---|---|---|
| `document_id` | string | ✅ | `x-dynamic-options: { source: "list_documents", description: "Fetches available documents dynamically" }` — **exact** match to the existing Docs actions' `document_id` wiring (CR-A parity; Docs does not use `x-context-binding`/`x-from-artifact`). |
| `text_to_find` | string | ✅ | The text to search for. Non-empty (validated — empty/whitespace-only is rejected as invalid input; an empty `containsText.text` is meaningless and Google rejects it). Maps to `replaceAllText.containsText.text`. |
| `replace_text` | string | ✅ | The replacement text. May be an empty string (a valid "delete all occurrences of X" operation). Maps to `replaceAllText.replaceText`. |
| `match_case` | boolean | ❌ (default `false`) | Case-sensitive matching. Maps to `replaceAllText.containsText.matchCase`. |

> **Param-naming note:** the action is named `replace_text` and one of its params is also `replace_text` (the replacement string), per the requirement's explicit spec ("Support: `text_to_find`, `replace_text` (replacement), optional `match_case`"). This mirrors Google's own `replaceAllText.replaceText` field. Flagged as a minor naming consideration in [OQ4](#open-questions-for-sa) in case SA prefers a less-collisional name (e.g. `replacement_text`).

### Google API mapping

**Request body:**
```json
{
  "requests": [
    {
      "replaceAllText": {
        "containsText": { "text": "<text_to_find>", "matchCase": <match_case> },
        "replaceText": "<replace_text>"
      }
    }
  ]
}
```

**Response body (relevant path):**
```json
{
  "documentId": "1abc123xyz",
  "replies": [ { "replaceAllText": { "occurrencesChanged": 3 } } ]
}
```

> When **zero** matches are found, Google **omits** `occurrencesChanged` from the reply. The executor must default to `0`: `data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0`.

### Method logic

1. Destructure `{ document_id, text_to_find, replace_text, match_case }` from params.
2. Guard: reject empty/whitespace-only `text_to_find` with a clean validation error **before** the fetch (belt-and-suspenders on top of Zod `minLength`).
3. Build the single `replaceAllText` request (set `matchCase` from `match_case ?? false`).
4. POST once to `${this.docsApisUrl}/${document_id}:batchUpdate` (raw fetch + manual `!response.ok` throw + `this.logger.error({ err, status }, 'Docs replace_text failed')` — matching the existing methods).
5. Read `occurrences_changed` (default `0`), return the schema-shaped object.

### Output schema (key fields)

| Field | Type | Notes |
|---|---|---|
| `document_id` | string | `x-guaranteed` — echoed from `data.documentId` |
| `occurrences_changed` | integer | `x-guaranteed` — count of replacements made (`0` when no match) |
| `text_to_find` | string | echoed for downstream traceability |
| `replaced_at` | string (ISO 8601) | `x-guaranteed` timestamp |

Plus legacy camelCase mirrors (`documentId`, `occurrencesChanged`, `replacedAt`) consistent with the other Docs actions.

### `common_errors`

Reuse the established Docs vocabulary: `auth_failed`, `document_not_found`, `permission_denied`, `api_rate_limit`, `insufficient_permissions` (+ optionally `invalid_input` for empty `text_to_find`). The executor's existing `mapGoogleServiceSpecificError` already maps 404 → `document_not_found`.

---

## Task List

**Definition JSON (`google-docs-plugin-v2.json`)**
- [x] ✅ Add `replace_text` action with the **full top-level metadata block** (`description`, `usage_context`, `idempotent: false`, `domain`, `capability`, `input_entity`, `output_entity`, `input_cardinality`, `output_cardinality`, `output_fields`, `required_params`, `optional_params`, `must_support: ["find_and_replace"]`, `parameters`, `rules`, `output_schema`, `output_guidance` w/ `sample_output` + `common_errors`) — **CR-DOCS-A**
- [x] ✅ Wire `document_id` as **bare** `x-dynamic-options { source: "list_documents" }` — no `x-context-binding`/`x-from-artifact` (CR-DOCS-A)
- [x] ✅ Document the idempotency semantics (conditional convergence + self-referential caveat) in `usage_context`
- [x] ✅ Declare the confirmation posture for **convention parity** with `insert_text`/`append_text`: `rules.confirmations` on `replace_text_length > 5000` + `rules.limits` on `replace_text_length > 50000` — **CR-DOCS-C**. ⚠️ **These rules are declared for parity but are currently inert at runtime** — `extractRuleContext` (`plugin-manager-v2.ts`) has no generic `${param}_length` derivation, so the condition resolves `undefined > N → false` and neither the confirmation nor the limit fires. This is a **pre-existing platform gap affecting all four Docs write actions equally** (`insert_text`/`append_text`/`create_document`/`replace_text`), tracked as a separate platform follow-up — see [Follow-ups (tracked, out of scope)](#follow-ups-tracked-out-of-scope). The rules stay in the JSON (do not delete) so the definition remains uniform and lights up automatically once the platform fix lands.
- [x] ✅ `output_schema.required` = ONLY `properties`-present x-guaranteed fields `["document_id","occurrences_changed","replaced_at"]` — **CR-DOCS-B** (did NOT replicate the stale insert/append `required` bug)
- [x] ✅ Bump `plugin.version` 1.0.0 → 1.1.0

**Executor (`google-docs-plugin-executor.ts`)**
- [x] ✅ Add `case 'replace_text'` to the `executeSpecificAction` switch
- [x] ✅ Implement `replaceText()` — single `replaceAllText` batchUpdate; empty-`text_to_find` guard before fetch; `occurrencesChanged ?? 0` default; raw-fetch + manual throw + `this.logger.error` matching existing methods
- [x] ✅ Confirm the new method uses `this.logger` only (file remains **zero** `console.*` — no conversion)

**Wiring**
- [x] ✅ Confirm NO registry/manager change needed (definition auto-loaded; `google-docs` already in `plugin-executer-v2.ts`)
- [x] ✅ Add a `replace_text` `PARAMETER_TEMPLATES` entry under `"google-docs"` in `app/test-plugins-v2/page.tsx`

**Tests** (see [Testing](#testing))
- [x] ✅ Unit: LEAN 3 tests — happy (asserts `occurrences_changed` parsed + request body shape) + 401 auth-failure + invalid-input (empty `text_to_find`, asserts no fetch issued)
- [x] ✅ Scaffold credential-gated `tests/plugins/integration-tests/google-docs.integration.test.ts` (skips without `GOOGLE_DOCS_TEST_TOKEN`) with a create→replace→match_case→zero-match lifecycle + empty-guard — **OQ3**. Registered `google-docs` in `integration-config.ts`.

**Docs**
- [x] ✅ Update `docs/plugins/google-docs-plugin.md`: add `replace_text` as action #6 (params + response table + Google API mapping + idempotency note), version-history bump to 1.1.0, Last Updated 2026-07-26
- [x] ✅ `x-semantic-type` check: new outputs are scalar/status (`document_id`, `occurrences_changed`, `text_to_find`, `replaced_at`) — no object-typed entity array items, so no new `x-semantic-type` and no `input-type-compat.ts` change

---

## Testing

Follows the existing `tests/plugins/unit-tests/google-docs.test.ts` harness (`createTestExecutor`, `expectSuccessResult`, `expectErrorResult`, `expectFetchCalledWith` from `../common/test-helpers`; `mockFetchSuccess`, `mockFetchError`, `restoreFetch` from `../common/mock-fetch`), matching the `[smoke]` (happy) / `[full]` (failure) split used today.

### LEAN test policy (binding — user directive)

**Exactly 3 unit tests: happy path + auth-failure (401) + invalid-input. No more.** Deeper coverage (match_case round-trips, zero-match `occurrences_changed:0` default, empty-replacement "delete all X", multi-occurrence counts) belongs in a credential-gated integration test file if one is scaffolded ([OQ3]).

| # | Test | Mock | Assertion |
|---|---|---|---|
| 1 | Happy path | `mockFetchSuccess({ documentId: 'doc-1', replies: [{ replaceAllText: { occurrencesChanged: 3 } }] })` | `expectSuccessResult`; `result.data.occurrences_changed === 3`; `expectFetchCalledWith('docs.googleapis.com/v1/documents/doc-1:batchUpdate', 'POST')`; request body contains a `replaceAllText` request with `containsText.text` = the search string |
| 2 | Auth failure (401) | `mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } })` | `expectErrorResult(result)` |
| 3 | Invalid input | (no fetch expected) call with empty `text_to_find: ''` | `expectErrorResult(result)`; **no fetch issued** (guard precedes network) |

### Safety-critical assertion — assessment

The Sheets slice added one safety assertion because `delete_rows` carried a genuine **whole-sheet-wipe** risk (an unbounded `deleteDimension` range). **`replace_text` carries no comparable catastrophic-widening risk** — it is a content edit scoped to literal-string matches, fully reversible, with no unbounded-range failure mode. Per the LEAN policy ("keep only a safety-critical assertion if a genuine risk exists — likely none here"), **no extra safety assertion is added.** The empty-`text_to_find` guard is covered by test #3.

### Scoped fast command (from workplan directive)

```bash
npx jest tests/plugins/unit-tests/google-docs.test.ts
```

Expected: existing suite stays green; +3 new unit tests for `replace_text`.

---

## Standards & Risks

- **Logging (Mandatory Rule 3) — no action needed for the executor.** `lib/server/google-docs-plugin-executor.ts` contains **exactly 0 `console.*` calls** (grep-confirmed) — it already uses `this.logger` (Pino) throughout. The new `replaceText` method will use `this.logger` only. **No conversion required.** (Contrast the Sheets slice, which had 1 `console.error` at line 247.)
- **Touched-file logging flag (CR-B parity):** this slice also modifies `app/test-plugins-v2/page.tsx` (adding one `PARAMETER_TEMPLATES` entry). That file contains **2 pre-existing `console.*` calls** (the same client-side `DEBUG` logs flagged in the Drive- and Sheets-slice reviews). Per CLAUDE.md § Logging "non-compliant files you touch," this is surfaced here — **with the caveat that it is a `'use client'` component where Pino (`createLogger`) is server-only**, so it is **not** a straight conversion (the realistic options are gate-behind-a-debug-flag or remove). Flagged for the user to decide; not silently left unaddressed. No new `console.*` will be added.
- **OAuth scope:** ✅ **No new scope.** `replace_text` fits the already-granted `https://www.googleapis.com/auth/documents` scope declared in `google-docs-plugin-v2.json` (`documents.batchUpdate` is covered — the same scope `insert_text`/`append_text` already use). Zero re-consent, zero Google app re-verification.
- **Idempotency:** reasoned from Docs API semantics — `idempotent: false` (state-changing; converges to a no-op only when the replacement does not contain the search text; the self-referential case grows the text). Documented in `usage_context`. No executor-side dedupe (that would be plugin-specific logic).
- **Safety / confirmation:** `replace_text` is a content mutation but **non-destructive/reversible** (unlike delete). Proposed to follow the existing Docs write-action precedent (size-threshold confirmation only, not a blanket mutation confirm). Final posture is [OQ1] for SA. Confirmations are advisory in the executor regardless — safety is the scoped, literal-match behavior of the method itself.
- **No hardcoding:** no plugin-specific rules added to any system prompt or the compiler; the definition schema is the sole source of truth (Platform Design Principles).
- **Repository pattern / Supabase:** N/A — executors are stateless; no DB writes in this slice.
- **V6 pipeline:** no compiler changes; the action is standard-shaped and auto-discovered. No new `must_support` semantics. New outputs are scalar → no new `x-semantic-type`; `validatePluginTypeAnnotations` will confirm.
- **`occurrences_changed` zero-match default:** Google omits `occurrencesChanged` when nothing matched. The executor defaults to `0` — a successful "found nothing to replace" result, not an error. Documented so downstream steps can branch on the count.

---

## Open Questions for SA

1. **Confirmation posture for `replace_text` (primary question).** The action mutates content across **all** occurrences but is **reversible** (not destructive like delete). Options: (a) **no blanket confirmation**, matching the existing Docs write actions which confirm only on size (`text_length > 5000`); (b) a mild always-on confirmation ("Replace all occurrences of '{text_to_find}'?") given find-and-replace can change more than a user expects; (c) a threshold confirmation on the replacement length. **Recommendation: (a)** — follow the established `insert_text`/`append_text` precedent; the operation is reversible and confirmations are advisory-only in the executor anyway. Confirm.
2. **`idempotent` value.** I propose `idempotent: false` (it is a mutation, and the self-referential replacement case is genuinely non-convergent), with the convergence-in-the-normal-case nuance documented in `usage_context`. The requirement notes it "is idempotent in the sense that re-running after all matches are replaced yields 0 further changes" — I read that as a runtime observation, not a reason to mark the action `idempotent: true`. Confirm `false` is the right definition value.
3. **Docs integration test file.** No `tests/plugins/integration-tests/google-docs.*` exists today. `replace_text` has no index math and a small edge surface, so the LEAN 3 unit tests cover the risk. Should I (a) skip an integration file this slice, or (b) scaffold a minimal credential-gated `google-docs.integration.test.ts` (skips without a token) covering a create→replace→read round-trip + `match_case` + zero-match, to seed the file for the Phase 2 index-math actions that will genuinely need it? **Recommendation: (b) minimal scaffold**, since Phase 2 (`format_document_text`/`insert_table`) will require boundary/empty-doc integration tests per the requirement's OQ5 — seeding the file now is cheap. Confirm preference.
4. **Param naming `replace_text` (minor).** The replacement-string param is named `replace_text`, colliding with the action name `replace_text` (per the requirement's explicit spec, and mirroring Google's `replaceAllText.replaceText`). Acceptable, or does SA prefer `replacement_text` for clarity? **Recommendation: keep `replace_text`** (matches the requirement wording and Google's field). Confirm.

---

## SA Review Notes

_(SA to populate during workplan review.)_

---

## SA Workplan Review

**Reviewed by SA — 2026-07-26**
**Status:** ✅ **Approved for implementation** — with 3 fold-in change requests (convention/correctness guardrails). None are architectural; no re-review cycle required. SA verifies CR-DOCS-A…C and the 4 decisions at code review.

Ground-truthed against `google-docs-plugin-v2.json` (5 existing actions), `google-docs-plugin-executor.ts` (all 5 methods + the `insertText`/`appendText` `:batchUpdate` precedent at lines 156–167 / 228–249 + `mapGoogleServiceSpecificError` 404→`document_not_found` at line 400), `base-plugin-executor.ts` (confirmations advisory, lines 69–74), `plugin-executer-v2.ts` (registry line 45), and `docs/plugins/google-docs-plugin.md` (5 actions documented). Every grounding claim in the workplan is accurate:

- **id-input binding — CONFIRMED, and the Dev is correctly NOT importing the Sheets pattern.** All 5 existing Docs actions wire `document_id` as **bare** `x-dynamic-options { source: "list_documents", description: "Fetches available documents dynamically" }` — **no** `x-context-binding`, **no** `x-from-artifact`. This is the opposite of the Sheets slice's CR-A (which mandated those attributes). CR-A "parity" is per-plugin: the new action must match the **Docs** convention exactly. A Dev copying the Sheets CR-A verbatim would be wrong; this Dev flagged the distinction correctly.
- **Executor is 0 `console.*` — CONFIRMED.** All logging is `this.logger` (Pino), including the `this.logger.warn` at line 311. No Mandatory-Rule-3 conversion for the executor. Contrast the Sheets slice (1 `console.error` at line 247).
- **`batchUpdate` precedent — CONFIRMED** in `insertText`/`appendText` (raw fetch + manual `!response.ok` throw + `this.logger.error({ err, status }, …)`). New method reuses this exact shape; only the `replaceAllText` request object + `occurrencesChanged` read are new.
- **Confirmation precedent — CONFIRMED.** `insert_text`/`append_text` both declare `rules.confirmations` on `text_length > 5000`; `create_document` on `initial_content_length > 5000`; all three also declare a `rules.limits` block at `> 50000`. The file's uniform convention for write actions is a **size-threshold confirm + a hard block limit**, not "no confirmation."
- **Registry/manager — CONFIRMED no change.** `google-docs` at `plugin-executer-v2.ts` line 45; auto-discovery.
- **Plugin doc — CONFIRMED.** `google-docs-plugin.md` documents all 5 existing actions (read/insert/append/create/get_info). No back-fill needed (unlike the Sheets slice's 2 missing `get_or_create_*`). Only `replace_text` (#6) + version bump 1.0.0→1.1.0.

### Decisions on the 4 Open Questions

**OQ1 — Confirmation posture → THRESHOLD (declare a `rules.confirmations` block), matching the file's write-action precedent. Reject "none" and reject "always-on".**
Dev's recommended (a) is right in spirit but slightly mislabelled as "no blanket confirmation": every existing Docs **write** action carries a size-threshold `rules.confirmations` **plus** a `rules.limits` hard block. To keep the definition uniform, `replace_text` must carry the same shape, not an empty `rules`. Pinned metric (fold into CR-DOCS-C): declare `rules.confirmations` on the **replacement-string length** — `condition: "replace_text_length > 5000"` (the direct analogue of insert/append's `text_length > 5000`) — and a `rules.limits` hard block at `replace_text_length > 50000`. Rationale for rejecting always-on: replace is **reversible** (Docs version history / undo), not destructive like `delete_rows`/`delete_file`, and no existing Docs write action blanket-confirms; an always-on confirm would break convention. Rationale for rejecting none: it would make `replace_text` the only write action in the file with an empty `rules` block. Note the breadth risk (a too-common `text_to_find` rewriting more than intended) **cannot** be pre-checked in an advisory confirmation (confirmations are templated from raw params before execution, and occurrence count is only known post-call), so the length threshold is the only precedent-consistent lever — acceptable because the operation is reversible.

**OQ2 — `idempotent: false` → CONFIRMED.**
Correct. `insert_text`/`append_text` are both `idempotent: false`; `replace_text` is a content mutation and the self-referential case (find `"cat"` → replace `"cats"`) is genuinely non-convergent. The requirement's "re-running after all matches are replaced yields 0 further changes" is a runtime observation, not grounds for `true`. Document the conditional-convergence + self-referential caveat in `usage_context` as planned. No executor-side dedupe (that would be plugin-specific logic).

**OQ3 — Scaffold a credential-gated Docs integration test file now → APPROVED (option b).**
Seed `tests/plugins/integration-tests/google-docs.integration.test.ts` (skips without a token, mirroring the Sheets file's skip-without-token pattern) with a create→replace→read round-trip + `match_case` + zero-match check. Phase 2 (`format_document_text`/`insert_table`) will **require** end-of-body boundary + empty-document integration tests per the requirement's OQ5; establishing the file and its skip harness now is cheap and gives Phase 2 a landing spot. **LEAN unit tests stay at exactly 3** — the integration file is not part of the fast unit pass and adds no unit-count pressure.

**OQ4 — Param naming → keep `replace_text`. CONFIRMED (reject `replacement_text`).**
The requirement's explicit spec names it `replace_text`, and it mirrors Google's own `replaceAllText.replaceText` field — the least-surprising mapping for anyone cross-referencing the API. The collision with the action name is cosmetic only: parameters are namespaced under the action, so there is **no** compiler/DSL symbolic ambiguity (this is not a semantic-determinism violation — that rule targets use-case-specific field names and vague ops, not action/param name overlap). Keeping the requirement's wording avoids a gratuitous divergence.

### Per-item validation verdict

| Check | Verdict | Note |
|---|---|---|
| Metadata block completeness (CR-A) | ⚠️ | Emit the FULL top-level block (see CR-DOCS-A); `must_support` optional — only if a genuine constraint, don't invent |
| id-input binding = **Docs** convention (bare `x-dynamic-options`) | ✅ | Confirmed against JSON; do NOT add Sheets' `x-context-binding`/`x-from-artifact` |
| output `x-guaranteed` fields | ✅ | `document_id`, `occurrences_changed`, `replaced_at` — correct |
| output_schema `required` array | ⚠️ | See CR-DOCS-B — list only fields present in `properties`; don't replicate the stale insert/append `required` bug |
| snake_case + legacy camelCase mirror | ✅ | `documentId`/`occurrencesChanged`/`replacedAt` mirrors — matches file |
| `replaceAllText` request shape | ✅ | `{ containsText:{ text, matchCase }, replaceText }` — correct |
| `occurrencesChanged` parse (omitted on zero) | ✅ | `data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0` — correct |
| empty `replace_text` = delete-all | ✅ | Intended/acceptable; Google honors empty `replaceText` as deletion |
| empty `text_to_find` rejected | ✅ | Pre-fetch guard + Zod `minLength`; Google rejects empty `containsText.text` anyway |
| Catastrophic-widening safety | ✅ | No `delete_rows`-analogue; literal-match scoped + reversible; **no extra safety assertion needed** (correct) |
| Confirmation posture | ⚠️ | Threshold + limits block per OQ1/CR-DOCS-C (workplan currently proposes an empty/none `rules`) |
| Logging — executor 0 `console.*` | ✅ | Confirmed; new method uses `this.logger` only |
| Logging — `test-plugins-v2/page.tsx` client `console.*` | ✅ | Same pre-existing client-side logs the user chose to LEAVE (Sheets CR-B); surface per touched-file rule, do NOT convert (client component, Pino is server-only) |
| V6 type-cleanliness | ✅ | Scalar count/echo outputs only → no new `x-semantic-type`, no `input-type-compat.ts`/capability-binder change; run `validatePluginTypeAnnotations` |
| LEAN test policy (3: happy + 401 + empty `text_to_find`) | ✅ | Meets happy + auth + invalid-input gate; no extra safety assertion |
| Plugin-doc DoD | ✅ | All 5 existing actions already documented; only add #6 + version bump — no back-fill |

### Change requests to fold in during implementation (no re-review needed)

1. **CR-DOCS-A (Medium) — full top-level metadata block, Docs-convention id binding.** Emit the complete top-level block matching the existing Docs actions: `description`, `usage_context`, `idempotent: false`, `domain: "document"`, `capability: "update"`, `input_entity: "document"`, `output_entity: "document"`, `input_cardinality: "single"`, `output_cardinality: "single"`, `output_fields`, `required_params`, `optional_params`, `parameters`, `rules`, `output_schema`, `output_guidance` (with `sample_output` + `common_errors`). Wire `document_id` as **bare** `x-dynamic-options { source: "list_documents", description: "Fetches available documents dynamically" }` — **do not** add `x-context-binding` or `x-from-artifact` (those are the Sheets convention; Docs does not use them). `must_support` is **optional** — every existing Docs action carries one, so a genuine constraint (e.g. `["find_and_replace"]` or a case-sensitivity capability) is fine, but do **not** invent a fake constraint just to fill the field.

2. **CR-DOCS-B (Low, correctness) — output_schema `required` array hygiene.** The existing `insert_text`/`append_text` `output_schema.required` arrays are stale — they list `title`/`updated_at`/`document_url` fields that are **not** in their own `properties`. Do **not** replicate that bug. The new action's `output_schema.required` must list only fields actually present in `properties` — i.e. the `x-guaranteed` set: `["document_id", "occurrences_changed", "replaced_at"]`.

3. **CR-DOCS-C (Low, correctness) — confirmation + limits parity (per OQ1).** Do not ship an empty/none `rules`. Declare `rules.confirmations` on the replacement-string length (`condition: "replace_text_length > 5000"`, `action: "confirm"`, message referencing `{text_to_find}`) — the direct analogue of insert/append's `text_length > 5000` — and a `rules.limits` hard block at `replace_text_length > 50000` (matching the other write actions' `> 50000` block). Keep the pre-fetch empty-`text_to_find` guard regardless; confirmations are advisory (base logs "would be handled via UI", lines 69–74), so real safety is the executor's literal-match scoping + the empty-text guard, not the rule.

### Safety / correctness confirmation

- **Confirmations advisory — CONFIRMED.** `base-plugin-executor.ts` lines 69–74 log only and do not block. Safety for `replace_text` is inherent (reversible literal-string edit; no unbounded-range failure mode) plus the empty-`text_to_find` guard (test #3). No `delete_rows`-style bounded-range assertion is applicable — correct call to omit it.
- **`occurrences_changed` zero-match default — CONFIRMED.** Google omits `occurrencesChanged` on zero matches; `?? 0` yields a successful "nothing to replace" result, not an error. Downstream steps can branch on the count.
- **No new OAuth scope — CONFIRMED.** `documents.batchUpdate` is covered by the already-granted `https://www.googleapis.com/auth/documents` (line 23). Purely additive, zero re-consent.
- **Registry/manager — CONFIRMED no change** (line 45; auto-discovery).
- **Repository/Supabase — N/A.** Executor is stateless; no DB writes.
- **V6 type-clean — CONFIRMED.** Scalar/status outputs only; no object-typed entity array items → no new `x-semantic-type`, no `input-type-compat.ts` or capability-binder change. Run `validatePluginTypeAnnotations` as planned.

### Verdict

✅ **Approved for implementation.** Fold CR-DOCS-A…C into the definition JSON while coding; apply the 4 decisions (threshold confirmation + limits; `idempotent:false`; scaffold the credential-gated integration file with LEAN unit tests held at 3; keep the `replace_text` param name). All are convention/correctness guardrails, not architectural changes — no second workplan-review pass. SA will verify CR-DOCS-A…C, the `replaceAllText` request shape, the `occurrencesChanged ?? 0` default, the empty-`text_to_find` guard (no fetch), 0 `console.*`, and the 4 decisions at code review.

---

## QA Testing Report

**QA — 2026-07-26**
**Test mode:** full (correctness-critical behaviors of the `replace_text` slice)
**Strategy used:** A (Jest unit) — on-record green run — + code inspection for the credential-gated zero-match path (Option E-style read for the path that can't run without a token)
**Focus:** api / plugin executor
**Skipped:** live integration test (`google-docs.integration.test.ts`) — credential-gated (`describe.skip` without `GOOGLE_DOCS_TEST_TOKEN`); not run, by design
**Input source:** direct QA task brief (prompt) + workplan QA scope

### Actual test run (on record)

Command: `npx jest tests/plugins/unit-tests/google-docs.test.ts` (re-run `--runInBand --verbose` to capture per-test output on this slow Windows box).

```
PASS tests/plugins/unit-tests/google-docs.test.ts
Test Suites: 1 passed, 1 total
Tests:       22 passed, 22 total
Time:        3.167 s
```

The 3 new `replace_text` tests all pass:
- `replace_text › should call batchUpdate with a replaceAllText request and parse occurrences_changed` ✅
- `replace_text › should handle 401 auth failure` ✅
- `replace_text › should reject empty text_to_find without issuing a fetch` ✅

> Run note: the very first invocation appeared to hang (>27 min with a `| tail` pipe buffering all output). Re-running with direct file redirection showed the actual suite executes in ~3.2 s once TypeScript compiles — the delay is cold-start/compile + process contention on this box, **not** a test failure or timeout in the executor. Numbers above are the real, observed result — not inferred.

### Test Coverage
| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Happy path: parses `occurrences_changed` from reply | ✅ | Pass | Unit #1 asserts `result.data.occurrences_changed === 3` |
| Happy path: posts correct `replaceAllText` body shape | ✅ | Pass | Unit #1 asserts `containsText.text === '{name}'`, `replaceText === 'Alice'`, POST to `…/doc-1:batchUpdate`. `matchCase` present in code (`match_case ?? false`) but **not** asserted in the unit test — value-level coverage boundary (populated on request body, unasserted) |
| Empty `text_to_find` rejected BEFORE any fetch | ✅ | Pass | Unit #3 asserts `expectErrorResult` + `getLastFetchCall()` is `undefined` (guard at executor L409 throws pre-network) |
| Auth failure (401) surfaces as error | ✅ | Pass | Unit #2 asserts `expectErrorResult` |
| `occurrences_changed` default-0 on zero matches | ⚠️ | Pass (by inspection) | Code L447 `data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0` is correct. **Not exercised in the fast unit pass** (LEAN caps at 3 unit tests); exercised only in the credential-gated integration file. See coverage boundary below |
| Empty `replace_text` = delete-all | ⚠️ | Pass (by inspection) | Code L421 `replace_text ?? ''` — honored as delete-all; integration-only |
| `match_case` default false | ✅ | Pass (by inspection) | Code L419 `match_case ?? false` |
| Executor 0 `console.*` | ✅ | Pass | `grep -c` = 0; no added `console.*` anywhere in the Docs diff |

### Correctness verdicts
- **Happy path — PASS.** Returns parsed `occurrences_changed` (asserted `=== 3`) and posts the correct `replaceAllText` body (`containsText.text`, `replaceText` asserted; `matchCase` set from `match_case ?? false` in code). Fetch target/method asserted.
- **Empty `text_to_find` → no fetch — PASS.** Pre-fetch guard (`typeof … !== 'string' || .trim().length === 0`, stricter than the JSON `minLength:1` — also rejects whitespace-only) throws before any network call; unit test confirms zero fetch calls.
- **`occurrences_changed` default-0 — PASS (by code inspection).** `?? 0` correctly defaults when Google omits `occurrencesChanged` on zero matches. Confirmed by reading executor L447. This path is **not** run in the fast unit pass (LEAN 3-test cap; the zero-match case lives in the credential-gated integration lifecycle). Per QA brief, no 4th unit test was added and no existing unit test was swapped — happy+auth+invalid must stay represented, and swapping the happy test would trade away the more valuable "populated value parses" assertion. Coverage boundary noted, not a defect (`?? 0` is a trivial nullish-coalesce with no branching).

### Coverage boundary (noted, not a bug)
The zero-match default-0 path and the empty-`replace_text` delete-all path are exercised only by `tests/plugins/integration-tests/google-docs.integration.test.ts`, which is `describe.skip` without `GOOGLE_DOCS_TEST_TOKEN` and was not run. Both are verified correct by code inspection. This is the intended LEAN-policy boundary, pre-authorized by SA code review item #2.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None (single `batchUpdate` POST; no index-read round-trip).

#### Edge Cases (nice to fix)
1. `match_case` is set correctly in the executor but is not asserted at the unit level (only `containsText.text`/`replaceText` are). Low value; the integration file's `match_case` step covers it. No action required under the LEAN policy.

> Not re-flagged: the inert `replace_text_length` confirmation/limit rule is the **known, consciously-deferred** platform gap in `extractRuleContext` (Option-B resolution, follow-up task_2ea2e007) — out of scope, not a new bug.

### Test Outputs / Logs
```
Tests:       22 passed, 22 total
Time:        3.167 s
√ replace_text › should call batchUpdate with a replaceAllText request and parse occurrences_changed (4 ms)
√ replace_text › should handle 401 auth failure (5 ms)
√ replace_text › should reject empty text_to_find without issuing a fetch (3 ms)
```
`grep -c "console\." lib/server/google-docs-plugin-executor.ts` → `0`
`git diff | grep '^+' | grep console.` → no added `console.*` in the Docs slice.

### Final Status
- [x] All acceptance criteria pass — ready for commit
- No High-severity bugs open. Docs `replace_text` slice is QA-signed **PASS**.

---

## Commit Info

_(RM to populate at commit time.)_

---

## SA Code Review

**Reviewed by SA — 2026-07-26**
**Status:** 🔄 **Changes required** — one blocking correctness finding (CR-DOCS-C rule threshold is dead config). Everything else is clean and approved. This is not an architectural problem and does not require a full re-implementation cycle; it is a scoped reconciliation (see must-fix #1).

Reviewed the Docs slice only (`git diff` scoped to the 7 files below; the committed Drive/Sheets slices were ignored):
`google-docs-plugin-v2.json`, `google-docs-plugin-executor.ts`, `google-docs.test.ts`, `google-docs.integration.test.ts`, `integration-config.ts`, `google-docs-plugin.md`, `test-plugins-v2/page.tsx`.

### Per-area verdict

| # | Area | Verdict |
|---|---|---|
| 1 | CR-DOCS-B — `output_schema.required` hygiene | ✅ Pass |
| 2 | `occurrencesChanged ?? 0` parse + test coverage | ✅ Pass (coverage boundary acceptable) |
| 3 | CR-DOCS-C — `replace_text_length` rule resolution | ❌ **Fail — dead config (blocking)** |
| 4 | CR-DOCS-A — full metadata + bare id binding + `must_support` | ✅ Pass (`must_support` inert-but-harmless — nice-to-have) |
| 5 | Correctness — request shape / guards / defaults / error handling / logger parity | ✅ Pass |
| 6 | Standards — 0 `console.*`, TS, snake+camel mirror, no hardcoding, V6 type-clean | ✅ Pass |
| 7 | LEAN test policy — exactly 3 unit tests | ✅ Pass |

### Item-by-item detail

**1. CR-DOCS-B (output `required` array) — ✅ CONFIRMED CORRECT.**
`output_schema.required = ["document_id","occurrences_changed","replaced_at"]`. All three exist in `properties` and each carries `x-guaranteed: true`. `text_to_find` is present in `properties` but correctly **excluded** from `required` (it is an echo, not guaranteed). The stale insert/append bug (listing `title`/`updated_at`/`document_url` absent from `properties`) is **not** replicated. Clean.

**2. `occurrencesChanged ?? 0` + test coverage — ✅ ACCEPTABLE.**
Executor reads `data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0` — the correct handling for Google omitting the field on zero matches. Unit test #1 asserts the **populated** value (`occurrences_changed === 3`) and the request body shape (`replaceAllText.containsText.text === '{name}'`, `replaceText === 'Alice'`) via `getLastFetchCall()`. The zero-match `?? 0` path is covered only in the credential-gated integration file (steps 3–4 of the lifecycle test).
*Judgment (recommend, not mandate):* the coverage boundary is **acceptable as-is**. `?? 0` is a trivial nullish-coalesce with no branching logic; the LEAN 3-test cap is a binding user directive; and the integration file exercises the real zero-match path against live Google. I do **not** require swapping a unit test for it. *Optional nicety:* if the team later wants unit-level proof without adding a 4th test, unit test #1's happy mock could be changed to omit `occurrencesChanged` and assert `=== 0` — but that trades away the "populated value parses" assertion, which is the more valuable one. Keep as-is.

**3. CR-DOCS-C — `replace_text_length` threshold — ❌ DEAD CONFIG (must-fix #1, blocking).**
The definition ships the requested `rules.confirmations` (`replace_text_length > 5000`) and `rules.limits` block (`replace_text_length > 50000`). **They never fire.** The runtime rule engine is `PluginManagerV2.validateRules()` → `extractRuleContext(parameters)` (`lib/server/plugin-manager-v2.ts:843–870`). That method builds the rule-context object by **hardcoded per-field extraction only** — it derives exactly two things: recipient counts (from `parameters.recipients`) and `subject_length` (from `parameters.content?.subject`). **There is no generic `<param>_length` naming-convention derivation anywhere.** `evaluateCondition()` (`:873`) then looks up `context["replace_text_length"]`, gets `undefined`, and evaluates `undefined > 50000` / `undefined > 5000` → both `false`. The limit never blocks; the confirmation never surfaces.
Crucially, the **same is true of the existing `insert_text` / `append_text` / `create_document` `text_length` rules** — `text_length` is never populated either, so those thresholds are *also* inert today. The Dev faithfully replicated the precedent that CR-DOCS-C (my own workplan review) mandated; the config is convention-correct. The defect is a **pre-existing platform gap in `extractRuleContext`**, not a regression introduced by this slice.
**Why it is still blocking:** the workplan asserts (Task List, CR-DOCS-C, and the SA workplan review) that a size confirmation/limit is *active*. It is not. Shipping config that presents as a safety control while being silently inert is the thing to correct. See must-fix #1 for the two acceptable resolutions — neither requires reworking the executor or the action.

**4. CR-DOCS-A — full metadata + id binding — ✅ CONFIRMED, with a nice-to-have.**
Full top-level block present (`description`, `usage_context`, `idempotent:false`, `domain:"document"`, `capability:"update"`, `input_entity`/`output_entity:"document"`, `input_cardinality`/`output_cardinality:"single"`, `output_fields`, `required_params`, `optional_params`, `parameters`, `rules`, `output_schema`, `output_guidance` with `sample_output` + `common_errors`). `document_id` is wired as **bare** `x-dynamic-options { source:"list_documents", description:"Fetches available documents dynamically" }` — **no** Sheets-only `x-context-binding` / `x-from-artifact`. Correct Docs-convention parity.
*`must_support: ["find_and_replace"]` judgment:* harmless but decorative. `must_support` on an action is consumed **only** by `CapabilityBinderV2.filterByMustSupport`/bonus-scoring, and per the code comment (`CapabilityBinderV2.ts:550`) it is now **bonus-scoring-only, not filtering**. The tag `"find_and_replace"` appears **nowhere else** in the codebase — no intent prompt or capabilityUse emits it — so it will never match an intent-side `must_support` request and yields **zero bonus and zero risk** (it cannot filter the action out). It is not a "fake constraint that breaks binding," but it is an orphan tag. *Nice-to-have:* either drop it, or (better) confirm/establish the capability-tag vocabulary so future find-and-replace-class actions across plugins share the token. Not blocking.

**5. Correctness — ✅ CONFIRMED.**
- `replaceAllText` request shape correct: `{ containsText:{ text, matchCase }, replaceText }`, single request in `requests[]`, POST to `${this.docsApisUrl}/${document_id}:batchUpdate`.
- Empty `text_to_find` rejected **before** the network via `typeof … !== 'string' || .trim().length === 0` — stricter than the definition's `minLength:1` (also rejects whitespace-only). Unit test #3 asserts `getLastFetchCall()` is `undefined` (no fetch issued). Good.
- Empty `replace_text` honored as delete-all via `replace_text ?? ''`. Correct.
- `match_case` defaults false via `match_case ?? false`. Correct.
- Raw-fetch + manual `!response.ok` throw + `this.logger.error({ err, status }, 'Docs replace_text failed')` — exact parity with `insertText`/`appendText`. Return object mirrors snake_case + legacy camelCase (`documentId`/`occurrencesChanged`/`replacedAt`), `document_id: data.documentId ?? document_id` echo fallback. Consistent.

**6. Standards — ✅ CONFIRMED.**
- Executor is **0 `console.*`** — new method uses `this.logger.debug('DEBUG: Replacing text in Google Docs')` / `this.logger.error(...)`, matching the exact `'DEBUG: …'` string style of all 5 existing methods. Diff grep across all Docs-slice code files returned **no** added `console.*`.
- `test-plugins-v2/page.tsx` touched-file client `console.*` — no new ones added; the 2 pre-existing client-side logs are the ones the user already chose to leave (client component, Pino is server-only). Correctly untouched.
- TS: `connection: any` / `parameters: any` on `replaceText` matches the file-wide existing signature convention for every private method (`readDocument`, `insertText`, …). *Nice-to-have (pre-existing, file-wide — do not fix in this slice):* these `any`s technically want a typed `GoogleConnection` / per-action param type, but that is an existing convention across the whole executor, not introduced here.
- No plugin-specific rules added to any prompt/compiler; definition schema is the source of truth. V6 type-clean: scalar/status outputs only → no new `x-semantic-type`, no `input-type-compat.ts` change.

**7. LEAN test policy — ✅ CONFIRMED.** Exactly 3 unit tests: happy (parse + body shape) + 401 auth + invalid-input (empty `text_to_find`, no-fetch assertion). No 4th. Integration scaffold is credential-gated (`describe.skip` without `GOOGLE_DOCS_TEST_TOKEN`) and `google-docs` is registered in `integration-config.ts` `CREDENTIAL_MAP`. Matches policy.

### Must-fix (blocking)

1. **Reconcile the dead `replace_text_length` rule (CR-DOCS-C).** The confirmation and the 50k hard-limit **do not fire** — `extractRuleContext` (`plugin-manager-v2.ts:843`) never derives `replace_text_length` (nor `text_length` for the existing write actions); the condition resolves `undefined > N` → `false`. Pick one, do **not** silently leave the workplan claiming the control is active:
   - **(A) Preferred — make the rules live at the root cause.** Add a **generic** derivation to `extractRuleContext`: for each top-level string param, populate `${param}_length = value.length`. This is the correct-phase fix (it is the runtime rule engine's job, not the plugin's), and it lights up `text_length` for insert/append/create at the same time. **This is a platform change with cross-plugin blast radius** (three existing rules that are currently inert would start blocking/confirming) — it needs its own small workplan + QA pass and must **not** be jammed into this Docs slice unreviewed. SA will not implement it here.
   - **(B) Acceptable interim — keep the config as documented parity, but correct the record.** If the team consciously accepts these thresholds as inert-until-(A), then (i) fix the workplan's Task-List/CR-DOCS-C wording to state the rules are **declared for parity but not yet enforced by the runtime** pending the `extractRuleContext` fix, and (ii) file a platform follow-up item so it is tracked, not believed-working. The Docs slice may then merge on its own merits.
   Either way, the executor's pre-fetch empty-`text_to_find` guard remains the only *actually-enforced* safety on this action — which is fine, because the operation is reversible (no `delete_rows`-class risk). No change to `replaceText()` or the action schema is required for this item.

### Nice-to-have (non-blocking)

- **`must_support: ["find_and_replace"]`** is an orphan tag (no consumer emits it; bonus-scoring-only, so zero risk). Drop it, or establish a shared find-and-replace capability-tag vocabulary for future plugins.
- **File-wide `connection: any` / `parameters: any`** — pre-existing convention across the whole executor; a typed connection/param shape would be an improvement but is out of scope for this slice (do not touch other methods).

### Code Approved for QA

**No — Changes required.** Resolve must-fix #1 (choose resolution A or B). Once the record is corrected (B) or the platform fix lands with its own QA (A), the Docs slice itself — action schema, executor, tests, docs — is **approved**; all other checks pass. Everything except the rule-enforcement reconciliation is clean and merge-ready.

### Resolution — must-fix #1 (2026-07-26)

**Resolved by user decision on 2026-07-26 → Option B (ship at parity + track fix).** The blocking finding (dead `replace_text_length` config) is resolved as a **documentation reconciliation, not a code change**: the `rules` block stays in `google-docs-plugin-v2.json` at parity with `insert_text`/`append_text`, but the workplan record is corrected to state plainly that the confirmation/limit are **declared for convention parity and currently inert at runtime** pending a generic `${param}_length` derivation in `extractRuleContext` (`plugin-manager-v2.ts`) — a pre-existing platform gap affecting all four Docs write actions equally. A platform follow-up task was filed on 2026-07-26 (see [Follow-ups (tracked, out of scope)](#follow-ups-tracked-out-of-scope)). SA pre-authorized either resolution (A or B), so **no SA re-review is required** — the Docs slice is now **unblocked** and merge-ready on its own merits (the executor's pre-fetch empty-`text_to_find` guard remains the only actually-enforced safety on this action, which is sufficient because the operation is reversible).

---

## Follow-ups (tracked, out of scope)

1. **Inert `${param}_length` rule derivation in the plugin rule engine (platform gap).** `PluginManagerV2.extractRuleContext` (`lib/server/plugin-manager-v2.ts`) builds the rule-evaluation context by **hardcoded per-field extraction only** (recipient counts + `subject_length`); it has **no generic `${param}_length` naming-convention derivation**. As a result, every `*_length` rule condition resolves `undefined > N → false`, so the declared confirmations/limits **never fire**.
   - **Affected actions (all four Docs write actions equally):** `insert_text` / `append_text` / `create_document` (`text_length` / `initial_content_length` rules — inert today, pre-existing) and the new `replace_text` (`replace_text_length` rules). This is a **pre-existing platform gap, not introduced by this slice** — the Docs slice faithfully replicated the CR-DOCS-C convention.
   - **Fix shape (root-cause phase):** add a **generic** derivation to `extractRuleContext` — for each top-level string param, populate `${param}_length = value.length` — so any `<param>_length` rule across any plugin lights up. This is the runtime rule engine's job, not the plugin's; no plugin-specific logic.
   - **Filed:** a platform follow-up task was filed on **2026-07-26** (background task chip: "Fix inert `${param}_length` rule derivation in plugin rule engine").
   - **Why it is out of scope here:** it is a **cross-plugin platform change** with blast radius across every plugin that declares a `*_length` rule (three existing Docs rules would begin confirming/blocking the moment it lands) — it needs its own workplan + SA review + QA pass and must **not** be jammed into this Docs slice unreviewed.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-26 | QA test pass | QA ran `npx jest tests/plugins/unit-tests/google-docs.test.ts` — **on-record green run: Test Suites 1 passed/1 total, Tests 22 passed/22 total, 3.2s** (the 3 new `replace_text` tests: happy parse+body-shape, 401 auth, empty-`text_to_find` no-fetch — all pass). Correctness verdicts: happy path (parsed `occurrences_changed` + correct `replaceAllText` body) ✅; empty `text_to_find` rejected before any fetch (`getLastFetchCall()` undefined) ✅; `occurrences_changed` default-0 (`?? 0`) confirmed correct by code inspection (integration-only path, LEAN 3-test cap — no 4th unit test added, no swap) ✅. Executor 0 `console.*` (grep) and no added `console.*` in the Docs diff ✅. No bugs found. Inert `replace_text_length` rule NOT re-flagged (known deferred platform gap, task_2ea2e007). **Sign-off: PASS — ready for commit.** |
| 2026-07-26 | Option B resolution: corrected inert-rule wording; filed platform follow-up | User chose Option B (ship at parity + track fix) for SA Code Review must-fix #1. Documentation-only reconciliation (no code/definition/test change — the `rules` block stays in the JSON at parity with insert/append). Corrected the Task-List wording that overclaimed the `replace_text_length` confirmation/limit as an active "hard block" → now states the rules are **declared for convention parity but currently inert at runtime** because `extractRuleContext` (`plugin-manager-v2.ts`) lacks a generic `${param}_length` derivation — a pre-existing platform gap affecting all four Docs write actions equally. Added a **Follow-ups (tracked, out of scope)** subsection documenting the `extractRuleContext` gap, the four affected Docs actions, the platform follow-up task filed 2026-07-26, and that fixing it is a cross-plugin change needing its own workplan + SA + QA. Recorded the resolution below the SA Code Review (must-fix #1 resolved by user decision = Option B; SA pre-authorized either resolution, so the slice is unblocked with no re-review). |
| 2026-07-26 | SA code review | SA reviewed the implemented Docs slice (7 files, `git diff`-scoped; committed Drive/Sheets ignored). **Status: Changes required** — one blocking finding. CR-DOCS-B (`required` array hygiene) ✅, `occurrencesChanged ?? 0` + tests ✅, CR-DOCS-A full metadata + bare id binding ✅, correctness (request shape/guards/defaults/error handling/logger parity) ✅, standards (0 `console.*`, snake+camel mirror, V6 type-clean) ✅, LEAN 3-test policy ✅. **Blocking (must-fix #1): CR-DOCS-C rule is dead config** — `extractRuleContext` (`plugin-manager-v2.ts:843`) has no generic `<param>_length` derivation, so `replace_text_length > 5000/50000` resolves `undefined > N → false` and neither confirmation nor limit fires (the existing insert/append `text_length` rules are equally inert — pre-existing platform gap, not a slice regression). Resolution A: add generic `${param}_length` derivation to `extractRuleContext` (separate platform WP + QA; not jammed into this slice). Resolution B: correct the workplan wording to "declared for parity, not yet enforced" + file a platform follow-up. Nice-to-haves: orphan `must_support:["find_and_replace"]` tag (bonus-scoring-only, harmless); file-wide `any` signatures (pre-existing convention). Docs slice itself is otherwise merge-ready. |
| 2026-07-26 | SA workplan review | SA ground-truthed the plan against the Docs definition (5 actions; bare `x-dynamic-options {source:list_documents}` id binding — NO `x-context-binding`/`x-from-artifact`, opposite of Sheets; write actions carry `text_length>5000` confirm + `>50000` limit), executor (`insert_text`/`append_text` `:batchUpdate` precedent, 404→`document_not_found` map, **0 `console.*`**), base executor (confirmations advisory 69–74), registry (line 45), and plugin doc (all 5 actions documented — no back-fill). Resolved the 4 open questions: OQ1 threshold confirmation on replacement-length + `>50000` limit block (reject none/always-on; reversible edit); OQ2 `idempotent:false` confirmed; OQ3 scaffold credential-gated integration file (LEAN unit stays 3); OQ4 keep `replace_text` param name (no symbolic ambiguity). Raised 3 fold-in change requests: CR-DOCS-A (full top-level metadata block + Docs-convention bare id binding, `must_support` optional/don't-invent), CR-DOCS-B (output `required` array = only `properties`-present x-guaranteed fields; don't replicate the stale insert/append `required` bug), CR-DOCS-C (declare `rules.confirmations` + `rules.limits`, don't ship empty `rules`). Confirmed `replaceAllText` shape, `occurrencesChanged ?? 0` default, empty-`text_to_find` guard, no catastrophic-widening risk (no extra safety assertion), touched-file client `console.*` left as the user chose, V6 type-clean, LEAN 3-test policy meets happy+auth+invalid. **Approved for implementation.** |
| 2026-07-26 | Initial workplan | Dev drafted Phase 1 Docs slice: 1 action (`replace_text` via `documents.batchUpdate` + `replaceAllText`). Input/output schema + Google API mapping + idempotency (conditional convergence, self-referential caveat → `idempotent: false`) + confirmation/safety analysis. Grounding: Docs executor has **0 `console.*`** (no conversion needed); `batchUpdate` precedent already in `insert_text`/`append_text`; no index math; no new scope (fits granted `documents`); no registry/manager change; all 5 existing actions already documented (no back-fill). LEAN 3-unit-test plan (happy + 401 + empty-`text_to_find` invalid), no extra safety assertion (no catastrophic-widening risk). Touched-file flag: `test-plugins-v2/page.tsx` has 2 pre-existing client-side `console.*` (not straight-convertible — client component). 4 open questions for SA (confirmation posture, `idempotent` value, integration-file scaffold, param naming). Workplan only — no implementation code. |
