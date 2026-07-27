# Workplan: Google Drive Plugin — Phase 1 File-Management Actions

> **Last Updated**: 2026-07-26

**Developer:** Dev
**Requirement:** [GOOGLE_SUITE_PLUGIN_ROBUSTNESS_REQUIREMENT.md](/docs/requirements/GOOGLE_SUITE_PLUGIN_ROBUSTNESS_REQUIREMENT.md) (✅ Approved — Phase 1 Drive slice)
**Branch:** `feature/google-drive-phase1-actions` — ⚠️ **not yet created.** RM creates the branch at cycle kickoff; I am currently on `main` and have authored the workplan doc only (no implementation code). Implementation must NOT start until the branch exists. See [Standards & Risks](#standards--risks).
**Status:** Code Complete (awaiting SA code review)

## Overview

This workplan covers the **Phase 1 Google Drive slice** of the Google Suite robustness requirement: five new file-management actions on the existing `google-drive` V2 plugin. Per the SA's amended action-granularity call (OQ4), these are **narrow verb-named actions**, NOT a composite `update_file_metadata`:

1. `move_file` — move a file to a different folder
2. `rename_file` — rename a file
3. `copy_file` — duplicate a file
4. `delete_file` — **trash-by-default** with a confirmation rule (no hard delete — user-ratified)
5. `revoke_access` — remove a sharing permission (the inverse of the existing `share_file`)

All five fit the **already-granted `drive` scope** — confirmed against `google-drive-plugin-v2.json` (`required_scopes` includes `https://www.googleapis.com/auth/drive`). **No new OAuth scope, no re-consent, no Google app re-verification.** This slice is purely additive.

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
| Plugin definition | `lib/plugins/definitions/google-drive-plugin-v2.json` | Add 5 entries to `actions{}` |
| Executor | `lib/server/google-drive-plugin-executor.ts` | Add 5 `switch` cases + 5 private methods |
| Registry | `lib/server/plugin-executer-v2.ts` | **No change** — `google-drive` already registered |
| Plugin manager | `lib/server/plugin-manager-v2.ts` | **No change** — definition auto-loaded; actions auto-discovered |
| Test page | `app/test-plugins-v2/page.tsx` | Add `PARAMETER_TEMPLATES` entries for 5 actions (smoke-check UX) |
| Unit tests | `tests/plugins/unit-tests/google-drive.test.ts` | Add happy + failure + trash-assertion cases |
| Integration tests | `tests/plugins/integration-tests/google-drive.integration.test.ts` | Add coverage matching existing pattern |
| Plugin doc | `docs/plugins/google-drive-plugin.md` | Version-history + action table update (on delivery) |

**Confirmed from code grounding:**

- **Executor contract (`base-plugin-executor.ts`):** every action = one `case` in `executeSpecificAction` + one private method. The base `executeAction` template already handles param normalisation, the runtime param-constraint guard, schema validation, confirmation surfacing (advisory only), connection retrieval, success formatting, and error mapping. New methods only make the Google call and return a schema-shaped object.
- **Auth:** `connection.access_token` bearer, exactly as the existing 10 Drive actions do. Never log the token.
- **204 handling:** `base.handleApiResponse` already returns `{}` for `204 No Content` — relevant for `revoke_access` (`permissions.delete` returns 204).
- **URL→ID normalisation:** `normalizeDriveIdParams()` already rewrites `folder_id` / `file_id` / `parent_folder_id` from pasted URLs to bare IDs before dispatch. New actions reusing those param names inherit this for free; any NEW id-shaped param (e.g. `target_folder_id`, `permission_id`) must be added to that normaliser's key list where it makes sense (folder/file params only — not `permission_id`).
- **Logging:** the Drive executor already uses `this.logger` (Pino) exclusively — **zero `console.*` calls found.** New code will follow suit.
- **Registry/manager:** `google-drive` is present in `executorRegistry`; the definition JSON is auto-loaded and actions are auto-discovered by CapabilityBinder. No wiring changes needed — only the definition + executor.

---

## Implementation Approach

**One executor method per action, each a thin typed wrapper over one Google Drive REST call**, returning a snake_case object that matches the action's `output_schema` exactly (mirroring the existing dual snake/camel return shape used across this executor for backward compatibility).

**Root-cause phase:** This is plugin-layer work only. No V6 pipeline/compiler changes — actions are standard-shaped and auto-discovered. Per Platform Design Principles, **no plugin-specific rules are added to any system prompt or the compiler**; the definition schema (`domain`/`capability`/`input_entity`/`output_entity`/cardinality/`x-semantic-type`/`output_dependencies`) is the sole source of truth.

**Idempotency (reason from the schema, no hacks):**

- `move_file` — **idempotent.** Adding a parent the file already has is a no-op to Google; safe to re-run. `idempotent: true`.
- `rename_file` — **idempotent.** Setting `name` to its current value succeeds as a no-op. `idempotent: true`.
- `copy_file` — **NOT idempotent** (always creates a new file). `idempotent: false`. Documented for recurring workflows; no dedupe magic in the executor (a `get_or_create`-style variant is out of scope for this slice).
- `delete_file` — **idempotent.** Trashing an already-trashed file is a no-op. `idempotent: true`.
- `revoke_access` — **idempotent in effect.** Revoking an already-removed permission returns 404; the method maps that to a clean, non-fatal "already revoked / not found" result rather than a hard error.

**Destructive-action safety (Security Rule):** `delete_file` and `revoke_access` both declare `rules.confirmations`. Because confirmations are **advisory** in the executor (the base only logs "would be handled via UI" — confirmed in `base-plugin-executor.ts`), the executor itself must **default to the non-destructive behavior**: `delete_file` sets `trashed: true` (never `files.delete` hard-delete); `revoke_access` removes a single named permission only (never a blanket unshare).

---

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/plugins/definitions/google-drive-plugin-v2.json` | modify | Add 5 action definitions (schemas, guidance, confirmations) |
| `lib/server/google-drive-plugin-executor.ts` | modify | Add 5 `switch` cases + 5 private methods; extend `normalizeDriveIdParams` key list for `target_folder_id` |
| `app/test-plugins-v2/page.tsx` | modify | Add `PARAMETER_TEMPLATES` entries for the 5 new actions |
| `tests/plugins/unit-tests/google-drive.test.ts` | modify | Add per-action happy + failure + trash-not-delete assertions |
| `tests/plugins/integration-tests/google-drive.integration.test.ts` | modify | Add integration coverage matching existing pattern |
| `docs/plugins/google-drive-plugin.md` | modify | Version-history + action table (on delivery, before RM commit) |

---

## Per-Action Specifications

Notation: `→` = maps to. `{fileId}` etc. are path params. Base host constant in executor is `this.googleApisUrl` (= `https://www.googleapis.com`).

### 1. `move_file`

| Field | Value |
|---|---|
| **Google API** | `PATCH /drive/v3/files/{fileId}?addParents={target}&removeParents={current}&fields=id,name,parents,webViewLink` |
| **capability** | `update` · **domain** `storage` · input_entity `file` · output_entity `file` · cardinalities `single`/`single` |
| **idempotent** | `true` |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `file_id` | string | ✅ | File to move. URL→ID normalised. |
| `target_folder_id` | string | ✅ | Destination folder. URL→ID normalised (add to normaliser key list). |
| `remove_from_current_parents` | boolean | ❌ (default `true`) | When false, adds the file to the target folder while keeping existing parents (Drive multi-parent = "add to" rather than "move"). |

**Method logic:** fetch current `parents` via a lightweight `GET .../files/{fileId}?fields=parents` (needed to compute `removeParents`), then PATCH with `addParents=target` and (if `remove_from_current_parents`) `removeParents=<joined current parents excluding target>`. If the file is already solely in the target, the PATCH is a no-op → return success with `moved: false`.

**Output schema (key fields):** `file_id` (x-guaranteed), `file_name`, `parents` (array), `previous_parents` (array), `moved` (boolean — false if already there), `web_view_link`, `moved_at` (x-guaranteed).

**Confirmation/safety:** none required (non-destructive).

### 2. `rename_file`

| Field | Value |
|---|---|
| **Google API** | `PATCH /drive/v3/files/{fileId}` body `{ "name": "<new_name>" }`, `fields=id,name,webViewLink` |
| **capability** | `update` · input/output entity `file` · `single`/`single` |
| **idempotent** | `true` |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `file_id` | string | ✅ | URL→ID normalised. |
| `new_name` | string | ✅ | New file name. |

**Output schema (key fields):** `file_id` (x-guaranteed), `file_name` (new name), `previous_name`, `web_view_link`, `renamed_at` (x-guaranteed).

**Confirmation/safety:** none (non-destructive). `previous_name` requires a pre-PATCH `GET fields=name`.

### 3. `copy_file`

| Field | Value |
|---|---|
| **Google API** | `POST /drive/v3/files/{fileId}/copy` body `{ "name"?: "<new_name>", "parents"?: ["<target>"] }`, `fields=id,name,parents,webViewLink,mimeType` |
| **capability** | `create` (produces a NEW file) · input/output entity `file` · `single`/`single` |
| **idempotent** | `false` |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `file_id` | string | ✅ | Source file. URL→ID normalised. |
| `new_name` | string | ❌ | Name for the copy. Defaults to Google's "Copy of …". |
| `target_folder_id` | string | ❌ | Destination folder for the copy. URL→ID normalised. Defaults to same parents as source. |

**Output schema (key fields):** `file_id` (x-guaranteed — the NEW copy's id), `file_name`, `source_file_id`, `mime_type`, `parents`, `web_view_link`, `copied_at` (x-guaranteed).

**Confirmation/safety:** none (additive). Note `idempotent: false` in `usage_context` — recurring workflows re-running this create duplicates by design.

### 4. `delete_file` (trash-by-default)

| Field | Value |
|---|---|
| **Google API** | `PATCH /drive/v3/files/{fileId}` body `{ "trashed": true }`, `fields=id,name,trashed` — **NEVER** `DELETE /drive/v3/files/{fileId}` (hard delete is out of scope, user-ratified) |
| **capability** | `delete` · input/output entity `file` · `single`/`single` |
| **idempotent** | `true` |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `file_id` | string | ✅ | URL→ID normalised. |

**Output schema (key fields):** `file_id` (x-guaranteed), `file_name`, `trashed` (boolean — always `true` on success), `restorable` (boolean, always `true` — signals it went to trash, not permanent), `trashed_at` (x-guaranteed).

**Confirmation/safety:** **REQUIRED.** Declare `rules.confirmations` (e.g. `confirm_trash`: unconditional `action: "confirm"`, message: "Move '{file_name}' to Trash? It can be restored from Google Drive Trash within 30 days."). Executor **always** sets `trashed: true` — it does not and cannot hard-block on the advisory confirmation, so non-destructive-by-default is enforced in code, not by the rule.

### 5. `revoke_access`

| Field | Value |
|---|---|
| **Google API** | `DELETE /drive/v3/files/{fileId}/permissions/{permissionId}` → `204 No Content` |
| **capability** | `update` (revokes a share) · input entity `file` · output entity `file` · `single`/`single` |
| **idempotent** | `true` (in effect — 404 on already-removed treated as success) |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `file_id` | string | ✅ | URL→ID normalised. |
| `permission_id` | string | ✅ | The permission to remove (from `share_file` output `permission_id`, or `get_file_metadata` with `include_permissions`). **NOT** URL-normalised. |

**Method logic:** `DELETE`; `handleApiResponse` returns `{}` on 204. A 404 (permission already gone) is caught and returned as `{ revoked: true, already_absent: true }` rather than thrown, preserving idempotency.

**Output schema (key fields):** `file_id` (x-guaranteed), `permission_id` (x-guaranteed), `revoked` (boolean, always `true` on success), `already_absent` (boolean), `revoked_at` (x-guaranteed).

**Confirmation/safety:** **REQUIRED.** Declare `rules.confirmations` (`confirm_revoke`: unconditional `action: "confirm"`, message: "Remove this person's access to '{file_id}'? They will no longer be able to open the file."). Narrow by design — removes exactly one named permission, never a blanket unshare.

> **Common errors (all 5 actions)** reuse the established `output_guidance.common_errors` vocabulary from the existing Drive actions: `auth_failed`, `file_not_found`, `permission_denied`, `api_rate_limit`, `insufficient_permissions`, plus action-specific keys (e.g. `folder_not_found` for move, `permission_not_found` for revoke).

---

## Task List

**Definition JSON (`google-drive-plugin-v2.json`)**
- ✅ Add `move_file` action (full top-level metadata block CR1, `x-dynamic-options` CR2, output_guidance, sample_output, common_errors)
- ✅ Add `rename_file` action (full metadata block, `x-dynamic-options` on `file_id`)
- ✅ Add `copy_file` action (`idempotent: false`, non-idempotency note in `usage_context`, `x-dynamic-options` on `file_id`/`target_folder_id`)
- ✅ Add `delete_file` action **with `rules.confirmations`** (`condition: "file_id != null"` CR3, `trashed`+`restorable` booleans OQ3)
- ✅ Add `revoke_access` action **with `rules.confirmations`** (`condition: "file_id != null"` CR3, `permission_id` plain — no `x-dynamic-options`)

**Executor (`google-drive-plugin-executor.ts`)**
- ✅ Add 5 `case` branches to `executeSpecificAction` switch
- ✅ Implement `moveFile()` (GET live parents → PATCH addParents/removeParents; `moved` no-op detection)
- ✅ Implement `renameFile()` (GET name → PATCH name)
- ✅ Implement `copyFile()` (POST /copy)
- ✅ Implement `deleteFile()` (PATCH trashed:true — **never** hard delete)
- ✅ Implement `revokeAccess()` (DELETE permission; 404→already_absent)
- ✅ Extend `normalizeDriveIdParams` key list to include `target_folder_id`
- ✅ Confirm all new methods use `this.logger` (Pino) — zero `console.*`

**Wiring**
- ✅ Confirm NO registry/manager change needed (definition auto-loaded — verified: PluginManager loads `google-drive-plugin-v2.json` and reports 15 actions at test time)
- ✅ Add `PARAMETER_TEMPLATES` entries for the 5 actions in `app/test-plugins-v2/page.tsx`

**Tests** (see [Testing](#testing))
- ✅ Unit: happy path per action (5)
- ✅ Unit: failure path per action (auth/404/invalid)
- ✅ Unit: **`delete_file` asserts PATCH `trashed:true` and that no hard `DELETE files/{id}` is issued**
- ✅ Unit: `move_file` no-op idempotency assertion; `revoke_access` 404→already_absent assertion
- ✅ Integration: mirror existing integration-test pattern (upload→rename→copy→move→trash lifecycle + share→revoke, credential-gated)

**Docs**
- ⬜ Update `docs/plugins/google-drive-plugin.md` action table + version history (pre-commit — deferred to delivery per workplan)
- ⬜ Run `validatePluginTypeAnnotations` to confirm no unknown `x-semantic-type` introduced (no new `x-semantic-type` introduced — new outputs are scalar; SA confirmed type-clean)

---

## Testing

Follows the existing `tests/plugins/unit-tests/google-drive.test.ts` harness (`createTestExecutor`, `mockFetchSuccess`, `mockFetchSequence`, `mockFetchError`, `expectSuccessResult`, `expectErrorResult`, `expectFetchCalledWith`, `getAllFetchCalls`, `runStandardErrorScenarios`). Split `[smoke]` (happy) / `[full]` (failure + edge), consistent with the file today.

**Per project testing policy — each action ships happy path + at least one failure path.** Specific tests QA will verify:

| Action | Happy path | Failure path | Special assertion |
|---|---|---|---|
| `move_file` | Mock GET parents + PATCH → `expectSuccessResult`, asserts `addParents`/`removeParents` on the PATCH URL | 404 file-not-found → `expectErrorResult` | **Idempotency:** file already in target → `moved: false`, no `removeParents` churn |
| `rename_file` | Mock GET name + PATCH → new `file_name`, `previous_name` present | 403 permission_denied → `expectErrorResult` | Invalid input: missing `new_name` → validation error |
| `copy_file` | Mock POST /copy → new `file_id` ≠ `source_file_id`, `expectFetchCalledWith('files/<id>/copy','POST')` | 404 source-not-found → `expectErrorResult` | `idempotent:false` — new id each call |
| `delete_file` | Mock PATCH → `trashed:true`, `restorable:true` | 404 → `expectErrorResult` | **TRASH-NOT-DELETE:** assert the fetch is `PATCH` with body `{trashed:true}` and that **no `DELETE /drive/v3/files/{id}` call is made** (`getAllFetchCalls()` contains no hard-delete) |
| `revoke_access` | Mock DELETE 204 → `revoked:true` | 401 auth_failed → `expectErrorResult` | **Idempotency:** DELETE returns 404 → `revoked:true, already_absent:true` (not thrown) |

**Auth-failure coverage:** the shared `runStandardErrorScenarios(...)` already exercises auth/401 paths for a representative action; extend or add per-action 401 cases so each new action has an auth failure test (project standard: happy + auth failure + invalid input).

**Integration tests:** add matching cases to `google-drive.integration.test.ts` following its existing structure.

---

## Standards & Risks

- **Logging (Mandatory Rule 3):** ✅ **No `console.*` found in `google-drive-plugin-executor.ts`** — it uses `this.logger` (Pino, from `BasePluginExecutor`) throughout. No conversion task needed for the Drive slice. (Note: the SA flag about `console.error` at `google-sheets-plugin-executor.ts:247` and the `PLUGIN_GENERATION_WORKFLOW.md` `console.log` template belongs to the **Sheets** slice, not this one — out of scope here. All new Drive code will use `this.logger`.)
- **OAuth scope:** ✅ **No new scope.** All 5 actions (`files.update`, `files.copy`, `permissions.delete`) fit the already-granted `https://www.googleapis.com/auth/drive` scope declared in `google-drive-plugin-v2.json`. Zero re-consent, zero Google app re-verification.
- **Destructive-action safety:** `delete_file` and `revoke_access` declare `rules.confirmations` AND default to non-destructive in code (trash, single-permission removal). Confirmations are advisory in the executor — safety is enforced by the method, not the rule. No hard delete anywhere (user-ratified).
- **Idempotency:** reasoned from Drive API semantics per action (see [Implementation Approach](#implementation-approach)) — no plugin-specific hacks, no compiler involvement.
- **Repository pattern / Supabase:** N/A — executors are stateless; no DB writes in this slice.
- **V6 pipeline:** no compiler changes; actions are standard-shaped and auto-discovered. No new `must_support` semantics added. `x-semantic-type` reuses existing `file_attachment` / `folder` vocabulary — no `input-type-compat.ts` change expected (to be confirmed by `validatePluginTypeAnnotations`).
- **Branch risk:** ⚠️ currently on `main`. This workplan is documentation only — no implementation code has been or will be written until RM creates `feature/google-drive-phase1-actions`. Escalating branch creation to TL/RM before Step 3 begins.

---

## Open Questions for SA

1. **`revoke_access` input ergonomics.** The narrow, safe design requires a `permission_id` (from `share_file` output or `get_file_metadata` with `include_permissions`). Real users more often know the *email* they shared with. Options: (a) keep `permission_id`-only for this slice (simplest, safest, requires an upstream metadata step); (b) accept an optional `email` and resolve it to a permission via `permissions.list` inside the executor. Recommendation: (a) for Phase 1 to keep the action narrow; add (b) as a follow-up. **SA to confirm.**
2. **`move_file` multi-parent semantics.** Drive files can have multiple parents. I've modeled `remove_from_current_parents` (default `true`) so the default behaves like a true "move." Confirm this default matches the intended UX vs. an "add to folder" default.
3. **`delete_file` output field naming.** Proposing `restorable: true` + `trashed: true` to make the trash-not-permanent contract explicit to the LLM/UI. Confirm naming, or prefer a single `status: "trashed"` string.
4. **`copy_file` non-idempotency surfacing.** Confirm it's sufficient to state `idempotent: false` + a `usage_context` note, with no `get_or_create`-style variant in this slice (consistent with `upload_file`/`create_folder` which are also non-idempotent and pair with separate `get_or_create_*` actions).

---

## SA Review Notes

_(SA to populate during workplan review.)_

---

## QA Testing Report

**QA — 2026-07-26**
**Test mode:** full (per-action happy + failure + edge, focused on the 5 new actions)
**Strategy used:** Option A/B — Jest unit tests against the executor with fetch-level mocking (the established `tests/plugins/unit-tests/google-drive.test.ts` harness). This is the correct strategy: the actions are thin typed wrappers over Google REST calls, fully exercised via `mockFetchSuccess` / `mockFetchSequence` / `mockFetchError` without live credentials. Integration tests remain credential-gated (not run in this session — no live Google connection).
**Focus:** api (plugin executor) + security (trash-safety guarantee)
**Skipped:** live integration (`google-drive.integration.test.ts`) — credential-gated, no test connection in this session; E2E — N/A (no UI in this slice).
**Input source:** prompt keywords + SA Code Review nit #3 (uneven auth/invalid-input coverage)

### Test run results

| Run | Command | Result |
|---|---|---|
| Baseline (before additions) | `npx jest tests/plugins/unit-tests/google-drive.test.ts` | **46 passed / 46 total** — 1 suite passed, 3.4s |
| After QA additions | same | **51 passed / 51 total** — 1 suite passed, 5.1s |

Net **+5 tests**, all green. (Note: first cold run is slow due to `ts-jest` whole-project type-check; warm runs are ~3–5s. The trailing "Jest did not exit one second after the test run" line is a pre-existing open-handles warning in this harness, not a test failure — all specs pass.)

### Trash-safety verdict

**HOLDS — airtight.** `deleteFile()` (executor lines 1211–1254) issues exactly one HTTP call: `PATCH /drive/v3/files/{id}` with body `{ "trashed": true }`. There is **no `DELETE` verb path anywhere in the method** — hard delete is structurally impossible, not merely gated by the advisory confirmation. The `TRASH-NOT-DELETE` unit test asserts all three properties: (a) the file mutation call's method is `PATCH`, (b) its body contains `"trashed":true`, and (c) `getAllFetchCalls()` contains **no** call whose method is `DELETE`. Verified and passing. (The `DELETE` verb used by `revoke_access` targets the `permissions/{id}` sub-resource — a share, not the file — and does not weaken this guarantee.)

### Test Coverage

| Acceptance Criterion (per-action) | Tested? | Result | Notes |
|---|---|---|---|
| `move_file` happy: GET live parents → PATCH addParents/removeParents | ✅ | Pass | Asserts `moved:true`, `previous_parents`, add/remove parents on PATCH URL |
| `move_file` idempotent no-op (already in target → `moved:false`, GET-only, no PATCH) | ✅ | Pass | Already present (line ~438); not duplicated |
| `move_file` failure paths: 404 + **401 (added)** + missing `target_folder_id` | ✅ | Pass | 401 added by QA (fires on the live-parents GET) |
| `rename_file` happy: GET name → PATCH name, reports `previous_name` | ✅ | Pass | Asserts PATCH body carries new name |
| `rename_file` failure paths: 403 + **401 (added)** + missing `new_name` | ✅ | Pass | 401 added by QA |
| `copy_file` happy: POST /copy → new id ≠ source id | ✅ | Pass | Asserts `expectFetchCalledWith('files/source-id/copy','POST')` |
| `copy_file` failure paths: 404 + **401 (added)** + **missing `file_id` (added)** | ✅ | Pass | Both added by QA (was 404-only) |
| `delete_file` happy: `trashed:true` + `restorable:true` | ✅ | Pass | — |
| `delete_file` TRASH-NOT-DELETE safety property | ✅ | Pass | Critical guarantee — see verdict above |
| `delete_file` failure paths: 404 + **401 (added)** | ✅ | Pass | 401 added by QA |
| `revoke_access` happy: 204 → `revoked:true, already_absent:false` | ✅ | Pass | — |
| `revoke_access` idempotency: 404 → `revoked:true, already_absent:true` (not thrown) | ✅ | Pass | Already present (line ~621); not duplicated |
| `revoke_access` failure paths: 401 + missing `permission_id` | ✅ | Pass | Already present; used as the coverage model |

### Tests added

| # | Action | Test | Type |
|---|---|---|---|
| 1 | `copy_file` | `handles 401 auth_failed` | auth-failure |
| 2 | `copy_file` | `rejects missing file_id (invalid input)` | invalid-input |
| 3 | `delete_file` | `handles 401 auth_failed` | auth-failure |
| 4 | `move_file` | `handles 401 auth_failed (on the live-parents fetch)` | auth-failure |
| 5 | `rename_file` | `handles 401 auth_failed` | auth-failure |

After these additions every one of the 5 new actions now carries the project-standard trio: happy path + auth-failure (401) + invalid-input. SA Code Review nit #3 is fully resolved. Task-4 edge assertions (`move_file` no-op GET-only; `revoke_access` 404→`already_absent`) were **already present** in the suite — verified and not duplicated.

### Issues Found

#### Bugs (must fix before commit)
**None.** No test revealed any behavioural bug. Executor logic and definitions were not modified.

#### Performance Issues (should fix)
**None** relevant to this slice. (General note: `ts-jest` cold type-check makes the first `jest` invocation slow — an existing harness characteristic, out of scope here.)

#### Edge Cases (nice to fix)
1. **[Low, pre-existing — SA nit #1] `output_fields` naming drift** in the 5 new definition entries (mix of snake_case and camelCase vs. the existing raw-Google-name convention). No functional impact — `output_fields` is fallback-only (all 5 ship a full `output_schema`). Cosmetic; align when the file is next touched. Not a QA blocker.
2. **[Low, pre-existing — SA nit #2] Two `console.log('DEBUG: …')` calls** in `app/test-plugins-v2/page.tsx` (client-side dev harness, outside the Dev's edit region). Client component — Pino is server-only, so not a straight conversion. Flagged for the user to decide; not a QA blocker.

### Test Outputs / Logs

```
Baseline:
  Test Suites: 1 passed, 1 total
  Tests:       46 passed, 46 total
  Time:        3.391 s

After QA additions:
  Test Suites: 1 passed, 1 total
  Tests:       51 passed, 51 total
  Time:        5.128 s
```

### Final Status
- [x] **All acceptance criteria pass — ready for commit.** All 51 unit tests green; trash-safety guarantee verified airtight; per-action happy + auth + invalid-input coverage complete; no bugs found. Two low-severity pre-existing cosmetic nits (SA #1/#2) left for follow-up — non-blocking.
- **QA sign-off: PASS.**

---

## Commit Info

| Field | Value |
|-------|-------|
| Branch | `feature/google-drive-phase1-actions` |
| Commit | `bc2ea49` — `feat(plugins): add Phase 1 Google Drive file-management actions` |
| Date | 2026-07-26 |
| Files | 7 (definition JSON, executor, unit + integration tests, test-page, requirement + workplan docs) |
| Tests | 51/51 unit tests passing |
| Pushed | No — local commit only, pending PR |
| Gates | SA req-review ✅ · SA workplan-review ✅ · SA code-review ✅ · QA PASS ✅ · user-approved ✅ |

---

## SA Workplan Review

**Reviewed by SA — 2026-07-26**
**Status:** ✅ **Approved for implementation** — with 3 minor consistency change-requests to fold in during coding (no re-review cycle required; QA will verify at code review).

Ground-truthed against `google-drive-plugin-v2.json`, `google-drive-plugin-executor.ts`, `base-plugin-executor.ts`, `google-base-plugin-executor.ts`, `plugin-executer-v2.ts`, and `lib/agentkit/v6/capability-binding/input-type-compat.ts`. The plan aligns with the binding requirement's SA review (narrow verb-named actions, trash-by-default, no hard delete, no new scope). Analysis of the executor contract, 204-handling, confirmation-advisory behavior, and normaliser reuse is accurate.

### Decisions on the 4 Open Questions

**OQ1 — `revoke_access` ergonomics → Option (a): `permission_id`-only for Phase 1. APPROVED.**
Keep the action narrow. Resolving `email → permission` via `permissions.list` inside the executor introduces exactly the ambiguity the semantic-determinism rule rejects (one email can map to multiple permissions — user vs. domain vs. group; which to remove?) plus a hidden extra call with its own failure modes. `permission_id` is a clean symbolic ref already emitted by `share_file` (output `permission_id`) and `get_file_metadata` (`include_permissions`). Add optional `email` resolution as a documented Phase-2 follow-up only if real demand surfaces. Do **not** URL-normalise `permission_id` (correct in the plan).

**OQ2 — `move_file` default `remove_from_current_parents: true` (true move) → APPROVED.**
A non-technical user who says "move X to Y" expects it to leave the old location; Drive's multi-parent model is an implementation detail, not the user's mental model. Keep the `false` (add-to-folder) escape hatch. Mandatory implementation constraint: compute `removeParents` from the **live** `parents` fetched at execution time (the plan's `GET fields=parents` step) — never assume a single parent, and exclude the target from the remove-set (the plan does this). The `moved:false` no-op path is the correct idempotency shape.

**OQ3 — `delete_file` output naming → `trashed:true` + `restorable:true` boolean pair. APPROVED (reject `status:"trashed"` string).**
Two machine-checkable booleans are compiler/LLM-resolvable without interpreting a free-form string enum — this is the semantic-determinism-preferred shape. A single `status:"trashed"` string is a stringly-typed field a downstream step would have to parse. Keep `trashed_at` as the `x-guaranteed` timestamp, consistent with every other action's `*_at` guaranteed field.

**OQ4 — `copy_file` non-idempotency: `idempotent:false` + `usage_context` note, no `get_or_create` variant → APPROVED as sufficient.**
Consistent with `upload_file` (`idempotent:false`, ships without inline dedupe). A dedupe/`get_or_create_copy` would be speculative scope and any executor- or compiler-side dedupe would violate the no-plugin-specific-logic rule. Document the "recurring runs duplicate by design" note in `usage_context`. Follow-up only if a concrete need appears.

### Per-action validation verdict

| Action | Schema/convention | Safety | Verdict |
|---|---|---|---|
| `move_file` | domain/capability/entity/cardinality sound; `idempotent:true` correct | non-destructive | ✅ approved (apply CR1/CR2) |
| `rename_file` | `idempotent:true`; `previous_name` via pre-PATCH GET is fine | non-destructive | ✅ approved (apply CR1/CR2) |
| `copy_file` | `create` capability, `idempotent:false` correct; new-id output shape sound | additive | ✅ approved (apply CR1/CR2) |
| `delete_file` | trash-by-default (`PATCH trashed:true`), never `files.delete`; boolean output pair (OQ3) | ✅ default non-destructive in code | ✅ approved (apply CR1/CR3) |
| `revoke_access` | `permissions.delete` → 204; 404→`already_absent` idempotency | ✅ narrow single-permission removal | ✅ approved (apply CR1/CR3) |

### Change requests to fold in during implementation (no re-review needed)

1. **CR1 (Medium) — replicate the FULL top-level metadata block per action.** Every existing Drive action carries `description`, `usage_context`, `idempotent`, `domain`, `capability`, `input_entity`, `output_entity`, `input_cardinality`, `output_cardinality`, `output_fields`, `required_params`, `optional_params`, and `must_support` (where applicable) as **top-level** fields — not only inside `parameters`/`output_schema`. The per-action specs currently name only a subset. Each of the 5 actions must emit the complete block so CapabilityBinder discovery and metadata stay consistent with the existing 10 actions. (`must_support` is optional — only add it where a genuine capability constraint exists; do not invent ones.)

2. **CR2 (Medium) — carry `x-dynamic-options` on id-shaped input params.** Every existing Drive action's `file_id` uses `x-dynamic-options: { source: "list_files" }` and folder params use `{ source: "list_folders" }` (powers the UI dropdowns). The new `file_id` (all 5) and `target_folder_id` (`move_file`, `copy_file`) must match this. `permission_id` correctly stays plain (no source) — consistent with the narrow design. The workplan does not currently mention `x-dynamic-options`; add it.

3. **CR3 (Low) — confirmation rules use an explicit `condition`.** The established shape (`delete_event`) is `{ condition: "event_id != null", action: "confirm", message: "..." }`, not a literally-unconditional rule. Use `condition: "file_id != null"` for both `delete_file` and `revoke_access` confirmations to match convention; keep `action:"confirm"` + message as planned.

### Safety / correctness confirmation

- **Confirmations are advisory — CONFIRMED.** `base-plugin-executor.ts` (lines 69–74) only logs "would be handled via UI" and does **not** block. The plan's requirement that `delete_file` enforces trash-by-default **in code** (never a hard `DELETE files/{id}`) is therefore mandatory and correctly stated. QA's trash-not-delete assertion (`getAllFetchCalls()` contains no hard-delete) is the right gate.
- **`revoke_access` 404→already_absent — CONFIRMED viable.** `handleApiResponse` returns `{}` on 204 and throws `"... failed: 404 - ..."` on 404; the method must catch that and return `{ revoked:true, already_absent:true }`. Implementation note: the existing Drive methods use raw `fetch` + manual error throws rather than `handleApiResponse` — if `revoke_access` uses raw `fetch`, it must replicate 204→`{}` and the 404 detection itself. Either path is acceptable; be consistent.
- **Error vocabulary — `file_not_found` is the correct Drive convention** (4 existing usages), so reusing it is consistent. Awareness note for QA: the shared Google base mapper keys the 404 branch on `commonErrors.not_found` (not `file_not_found`), so a 404 falls back to the generic "Resource not found." unless overridden — assert on the actual returned message, not on the assumption that `file_not_found` text is surfaced. This is a pre-existing, out-of-scope inconsistency; do not "fix" it in this slice.
- **`x-semantic-type` on outputs — "where applicable" is correct.** The convention places `x-semantic-type` (`file_attachment`/`folder`) on object-typed array items only; the new single-entity outputs are scalar (`file_id`, `file_name`) and need none.
- **No new OAuth scope — CONFIRMED.** `required_scopes` includes `https://www.googleapis.com/auth/drive`. Purely additive.
- **Registry/manager — CONFIRMED no change.** `google-drive` is present in `plugin-executer-v2.ts`; definition auto-loads; actions auto-discovered.
- **Logging — CONFIRMED zero `console.*`** in `google-drive-plugin-executor.ts` (whole file uses `this.logger`). New methods must continue. No touched-file conversion debt in this slice. (The `google-sheets-plugin-executor.ts:247` `console.error` belongs to the Sheets slice — correctly scoped out here.)
- **Repository/Supabase — N/A.** Executors are stateless; no DB writes. No repository-pattern or RLS surface in this slice.

### V6 / CapabilityBinder awareness — type-clean CONFIRMED

`file_attachment` and `folder` are already registered in `lib/agentkit/v6/capability-binding/input-type-compat.ts`; no new semantic type is introduced. Contrast with `list_available_slots` (Phase 2), which needs a new `time_slot`/`availability_slot` type + `input-type-compat.ts` change — that is **not** in this slice, so no compiler/binding change is required. Run `validatePluginTypeAnnotations` as planned to confirm.

### Branch / process

Acknowledged: `feature/google-drive-phase1-actions` is not yet created; RM creates it at kickoff and implementation must not start on `main`. Process-only — no objection.

### Verdict

✅ **Approved for implementation.** Fold CR1–CR3 into the definition JSON while coding; they are consistency requirements, not architectural changes, and do not require another workplan-review pass. SA will verify CR1–CR3, the trash-not-delete guarantee, and the OQ3 output shape at code review.

---

## SA Code Review

**Reviewed by SA — 2026-07-26**
**Status:** ✅ **Code Approved for QA** — no blocking items. A short list of non-blocking coverage/consistency nits is recorded for QA to fold in; none require a re-review cycle.

Ground-truthed against the actual diff (`git diff` on `feature/google-drive-phase1-actions`): `google-drive-plugin-v2.json` (5 actions), `google-drive-plugin-executor.ts` (5 methods + switch + `normalizeDriveIdParams`), `google-drive.test.ts`, `google-drive.integration.test.ts`, `app/test-plugins-v2/page.tsx`, plus the test harness (`tests/plugins/common/mock-fetch.ts`) and the `output_fields` consumers (`DataSchemaBuilder.ts` — fallback-only).

### Per-area verdict

| Area | Verdict | Notes |
|---|---|---|
| **delete_file trash-safety (critical)** | ✅ **Airtight** | `deleteFile()` has exactly one HTTP call: `PATCH /files/{id}` with body `{ trashed: true }`. There is **no `DELETE` branch anywhere in the method** — hard delete is structurally impossible, not merely gated by the advisory confirmation. Unit test `TRASH-NOT-DELETE` asserts all three of: method is `PATCH`, body contains `"trashed":true`, and `getAllFetchCalls()` contains **no** call with method `DELETE`. Guarantee confirmed. |
| **SA binding decisions (OQ1–OQ4)** | ✅ Honored | revoke_access is `permission_id`-only, 404→`already_absent:true` returned (not thrown); move_file computes `removeParents` from **live** `GET fields=parents`, no-op path returns `moved:false` with no PATCH, `remove_from_current_parents:false` escape hatch present; delete_file returns `trashed`+`restorable` booleans; copy_file `idempotent:false`. |
| **CR1 full metadata block** | ✅ Applied | All 5 actions carry the full top-level block (`description`, `usage_context`, `idempotent`, `domain`, `capability`, `input_entity`, `output_entity`, `input_cardinality`, `output_cardinality`, `output_fields`, `required_params`, `optional_params`). `must_support` correctly omitted (no genuine capability constraint — per CR1 guidance). |
| **CR2 x-dynamic-options** | ✅ Applied | `file_id`→`list_files` on all 5; `target_folder_id`→`list_folders` on move_file & copy_file; `permission_id` plain (no source). Matches the narrow design. |
| **CR3 confirmation condition** | ✅ Applied | `delete_file.confirm_trash` and `revoke_access.confirm_revoke` both use `condition: "file_id != null"`, `action:"confirm"`, with messages. Matches the `delete_event` shape. |
| **Convention parity** | ✅ Good (one cosmetic nit) | Dual snake_case + legacy camelCase returns, error vocabulary, and `this.logger.debug('DEBUG: …')` prefix all match the existing 10 Drive actions. Nit below. |
| **Correctness risks (Dev-flagged)** | ✅ Cleared | See analysis below. |
| **Standards (console/any/Supabase/hardcoding)** | ✅ Pass (one flag) | Zero `console.*` in executor/tests. No Supabase, no plugin-specific rules leaked to prompts/compiler. `any` on method signatures matches existing convention. One pre-existing `console.*` in a touched file — flagged below. |
| **Test adequacy** | ✅ Meets the minimum gate | Every action has happy + ≥1 failure path; trash-not-delete and both idempotency guarantees are asserted. Uniform "auth + invalid-input per action" not fully met — QA nits below. |

### Correctness analysis (the three Dev-flagged risks)

1. **move_file — `PATCH` with empty body `{}` + `addParents`/`removeParents` as query params → CORRECT.** This is the documented `files.update` contract: parent mutations are query parameters, and the request body carries only metadata (empty here). Verified the multi-parent logic across edge cases: file solely in target (no-op `moved:false`), file in target + others (removes others, net-solely-in-target), no parents (adds only), `remove_from_current_parents:false` (add-to-folder, no-op if already present). The target is always excluded from the remove-set. Sound.
2. **revoke_access — raw-fetch 204/404 → CORRECT.** `DELETE permissions/{id}` returns 204 (`ok`, body untouched) → `revoked:true, already_absent:false`. `status === 404` short-circuits to `already_absent:true` without throwing; any other non-ok status throws. Contract replicated correctly with raw `fetch`. Note: the HTTP `DELETE` verb here is legitimate — it targets the `permissions/{id}` sub-resource, not the file; it does not conflict with the trash-not-delete guarantee (which concerns `DELETE /files/{id}`).
3. **`normalizeDriveIdParams` extension → SAFE.** Adding `target_folder_id` to the key list only affects the two new actions that use that param name; no existing action references `target_folder_id`, so there is zero regression surface. `extractDriveId` is a URL→bare-ID extractor that is a no-op on already-bare IDs.

### Non-blocking items (nice-to-have — QA / follow-up, do NOT block this cycle)

1. **[Low] `output_fields` naming drift.** The new actions list a mix of snake_case (`file_id`, `parents`) and camelCase (`webViewLink`, `mimeType`) in `output_fields`, whereas the existing actions list the raw Google API field names (`id`, `name`, `webViewLink`). **No functional impact** — `output_fields` is consumed only as a *fallback* when `output_schema` is absent (`DataSchemaBuilder.ts:267`), and all 5 actions ship a full `output_schema`. Cosmetic consistency only; align to the existing raw-name convention (or to the snake_case output keys) whenever the file is next touched.
2. **[Low] `console.*` in a touched file — `app/test-plugins-v2/page.tsx:997,999`.** Two pre-existing `console.log('DEBUG: …')` calls remain in this file (outside the Dev's `PARAMETER_TEMPLATES` edit region ~170–196). Per CLAUDE.md § Logging, touching a file that still logs via `console.*` should be surfaced. Caveat: this is a **client component** dev-only test harness where Pino (`createLogger`) is server-only and not directly applicable, so this is not a straight Pino conversion. Not blocking; flagging so the user can decide whether to convert (e.g., gate behind a debug flag / remove) — the Dev should have surfaced it rather than leaving it silent.
3. **[Low] Uneven failure-path coverage vs. the project "happy + auth-failure + invalid-input per action" standard.** Each action has happy + ≥1 failure path (the minimum QA gate is met), but for full parity QA should add: `copy_file` — an invalid-input (missing `file_id`) case **and** an auth-failure (401) case (currently only a 404); `delete_file` — a 401 auth case and a missing-`file_id` case; `move_file` / `rename_file` — an explicit 401 auth case (they currently cover 404 / 403 respectively). `revoke_access` coverage (happy + 404-idempotent + 401 + missing-input) is the model to match.

### Must-fix (blocking)

**None.** No RLS/Zod/security violations, no hard-delete path, no plugin-specific logic leaked into prompts or the compiler, no new pattern introduced. The implementation faithfully applies CR1–CR3 and all four OQ decisions.

### Verdict

✅ **Code Approved — proceed to QA.** The delete_file trash-by-default guarantee is enforced structurally in code and asserted in tests; it is airtight. The three non-blocking nits are recorded for QA/follow-up and do not require another SA pass.

### Code Approved for QA: **Yes**

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-26 | QA test pass | QA ran the unit suite: **46/46 baseline → 51/51 after +5 QA-added tests** (all green). Verified the trash-safety guarantee is **airtight** — `deleteFile()` is `PATCH {trashed:true}`-only with no `DELETE /files/{id}` path, asserted by the `TRASH-NOT-DELETE` test (PATCH method + `"trashed":true` body + zero `DELETE`-verb calls). Topped up SA nit #3: added `copy_file` 401 + missing-`file_id`, and 401 auth-failure cases for `delete_file` / `move_file` / `rename_file`; every new action now has happy + auth + invalid-input. Task-4 edge assertions (move no-op GET-only; revoke 404→already_absent) already present — not duplicated. **No bugs found. Executor/definitions unchanged. QA sign-off: PASS.** |
| 2026-07-26 | SA code review | SA reviewed the implemented diff (definition JSON, executor, unit + integration tests, test page). Confirmed delete_file trash-safety is airtight (PATCH `{trashed:true}` only, no `DELETE /files/{id}` branch, asserted by the `TRASH-NOT-DELETE` test). Verified all four OQ decisions and CR1–CR3 applied; move_file empty-body + query-param usage, revoke_access 204/404 handling, and `normalizeDriveIdParams` extension all correct/safe. Three non-blocking nits recorded (output_fields naming drift; pre-existing `console.*` in touched `test-plugins-v2/page.tsx`; uneven auth/invalid-input coverage for copy_file/delete_file). **No must-fix items. Code Approved for QA.** |
| 2026-07-26 | SA workplan review | SA ground-truthed the plan against Drive definition/executor, base executor, Google base error mapper, registry, and V6 input-type-compat. Resolved the 4 open questions (revoke: permission_id-only; move: true-move default; delete: `trashed`+`restorable` booleans; copy: `idempotent:false` sufficient). Per-action verdicts ✅. Raised 3 fold-in change requests (CR1 full top-level metadata block, CR2 `x-dynamic-options` on id params, CR3 confirmation `condition` shape). Confirmed confirmations-advisory / trash-in-code, no new scope, no registry change, zero `console.*`, type-clean V6. **Approved for implementation.** |
| 2026-07-26 | Initial workplan | Dev drafted Phase 1 Drive slice: 5 verb-named actions (`move_file`, `rename_file`, `copy_file`, `delete_file` trash-by-default, `revoke_access`). Per-action schemas + API mappings + idempotency/confirmation semantics, task list, testing plan, standards flags (no console.*, no new scope), 4 open questions for SA. Workplan only — no implementation code. |
