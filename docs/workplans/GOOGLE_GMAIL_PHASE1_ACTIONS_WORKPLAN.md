# Workplan: Google Gmail Plugin — Phase 1 Label & Send/Batch Actions

> **Last Updated**: 2026-07-26

**Developer:** Dev
**Requirement:** [GOOGLE_SUITE_PLUGIN_ROBUSTNESS_REQUIREMENT.md](/docs/requirements/GOOGLE_SUITE_PLUGIN_ROBUSTNESS_REQUIREMENT.md) (✅ Approved — Phase 1 Gmail slice)
**Branch:** `feature/google-suite-phase1-actions` — ✅ confirmed current branch (`git branch --show-current`). This document is workplan-only; **no implementation code** is written until SA workplan-review passes. RM owns branch creation and the eventual merge; Dev never commits to `main`.
**Status:** Code Complete (awaiting SA code review)

## Overview

This workplan covers the **Phase 1 Gmail slice** of the Google Suite robustness requirement — the largest Phase 1 slice: **6 new actions** on the existing `google-mail` V2 plugin. Per the SA Architectural Review feasibility table (Gmail rows, Phase 1) and OQ3/OQ4 rulings, these are the additive, **zero-new-scope** Gmail capabilities that fit the already-granted `gmail.modify` + `gmail.send` scopes:

1. `get_or_create_label` — idempotent label creation (list → match by name → create if absent). Follows the platform `find_or_create_X` idempotency principle. 🟢
2. `list_labels` — list all labels. 🟢
3. `delete_label` — delete a label by id. **Destructive** → confirmation rule. 🟢
4. `reply` (**see OQ1 — requirement names it `reply_to_email`**) — reply within an existing thread; sets `threadId` + `In-Reply-To`/`References` so it continues a thread rather than starting a new one. 🟢
5. `send_draft` — send an existing draft (`drafts.send`). 🟢
6. `batch_modify` (**see OQ1 — requirement names it `batch_modify_emails`**) — batch add/remove labels and/or archive across many messages (`messages.batchModify`). 🟢

**Gmail filters (`create_filter`/`list_filters`/`delete_filter`) are explicitly NOT in this slice** — they require the new `gmail.settings.basic` scope and belong to Phase 2 (per the SA sequencing and the user's ratified ops decision on the sensitive-scope consent-screen resubmission).

All 6 actions fit the **already-granted scopes** declared in `google-mail-plugin-v2.json` (`gmail.readonly`, `gmail.send`, `gmail.modify`) — confirmed against the definition. **No new OAuth scope, no re-consent, no Google app re-verification.** Purely additive.

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
| Plugin definition | `lib/plugins/definitions/google-mail-plugin-v2.json` | Add 6 entries to `actions{}`; bump `plugin.version` (see version-drift note below) |
| Executor | `lib/server/gmail-plugin-executor.ts` | Add 6 `switch` cases + 6 private methods + reuse of existing helpers (`createLabel`, `resolveLabelNames`, `buildEmailMessage`, `mimeEncodeHeader`); one small additive extension to `buildEmailMessage` for reply headers. **No logging conversion needed — file is already zero-`console.*`** |
| Registry | `lib/server/plugin-executer-v2.ts` | **No change** — `google-mail` already registered (line 42) |
| Plugin manager | `lib/server/plugin-manager-v2.ts` | **No change** — definition auto-loaded; actions auto-discovered by CapabilityBinder |
| Test page | `app/test-plugins-v2/page.tsx` | Add 6 `PARAMETER_TEMPLATES` entries under `"google-mail"` (smoke-check UX) |
| Unit tests | `tests/plugins/unit-tests/google-mail.test.ts` | Add LEAN 3-per-action unit coverage (18) + 4 safety assertions |
| Integration tests | `tests/plugins/integration-tests/google-mail.integration.test.ts` | Add credential-gated deeper coverage (skips without `GOOGLE_MAIL_TEST_TOKEN`) |
| Plugin doc | `docs/plugins/google-mail-plugin.md` | Document all 6 new actions + version-history bump; Last Updated 2026-07-26 |

**Confirmed from code grounding:**

- **Executor contract (`base-plugin-executor.ts`):** the base `executeAction` template (lines 24–120) handles param normalisation (string→array, lines 33–40), the runtime param-constraint guard (48–56), schema validation, confirmation surfacing (**advisory only** — lines 69–74 log "Confirmations required (would be handled via UI)" and do **not** block), connection retrieval, success formatting, and error mapping. Each new action = one `case` in `executeSpecificAction` + one private method that makes the Google call and returns a schema-shaped object.
- **Auth:** `connection.access_token` bearer, exactly as the existing 5 Gmail actions do. Never log the token.
- **HTTP style:** the Gmail executor uses **raw `fetch` + manual `!response.ok` throw** for its action methods (send/search/draft/attachment/modify). New action methods follow the same raw-fetch style. (Note the two `handleApiResponse`-based methods — `performConnectionTest`, `list_labels` dropdown fetcher — are the exception, not the action pattern.)
- **Return shape:** existing actions return snake_case objects with an `x-guaranteed` `*_at` timestamp. New actions follow suit. (Gmail actions do **not** carry legacy camelCase mirrors the way Docs/Sheets do — `search_emails` attachments carry both, but the top-level action returns are snake_case only. New actions match the Gmail top-level convention: **snake_case only**.)
- **Reusable label helpers already in the file:**
  - `createLabel(connection, labelName)` (line 501) — POSTs `users.labels`, and is **already 409-safe** (re-fetches + resolves on "label exists" conflict). `get_or_create_label` reuses this directly.
  - `resolveLabelNames(connection, labelNames[])` (line 442) — resolves system + custom label names → IDs (creating missing custom labels). `batch_modify` reuses this to accept label **names** (consistent with `modify_email`) rather than forcing raw IDs.
  - `SYSTEM_LABELS` set (line 11) — used to guard `delete_label` against deleting a built-in label.
- **Reusable MIME helpers already in the file:** `buildEmailMessage(parameters)` (line 577) builds the full RFC822 message (recipient normalisation, `mimeEncodeHeader` for non-ASCII, `multipart/alternative` when HTML present) and base64url-encodes it (lines 668–673). **`reply` reuses this** via a minimal additive extension (an optional extra-headers argument for `In-Reply-To`/`References`) — no re-implementation of MIME/base64url.
- **⚠️ Naming collision — `list_labels`:** the executor **already has a public method named `list_labels(connection, options)`** (line 884) that is the **dynamic-options dropdown fetcher** (called via `PluginExecuterV2.fetchDynamicOptions` → `executor[source]`), returning `{ value, label, group }[]`. The new **action** `list_labels` dispatches through `executeSpecificAction`'s switch (on the actionName string) to a **distinctly-named private method** (proposed `listAllLabels`) — it must **not** reuse/rename the public `list_labels` fetcher (different signature, different return shape). See [OQ2](#open-questions-for-sa). The dropdown fetcher stays as-is; the label-id inputs (`delete_label.label_id`) wire `x-dynamic-options: { source: "list_labels" }` to it.
- **Logging:** the executor uses `this.logger` (Pino) throughout (debug/info/warn/error with structured context + `{ err }`). **Grep-confirmed: 0 `console.*` calls in `gmail-plugin-executor.ts`.** No Mandatory-Rule-3 conversion is required for this file (positive finding — reported in [Standards & Risks](#standards--risks)). Contrast the Sheets slice, which had 1 `console.error` at line 247.
- **Registry/manager:** `google-mail` is present in `plugin-executer-v2.ts` (line 42); the definition JSON is auto-loaded and actions auto-discovered. **No wiring changes.**
- **id-input binding convention:** Gmail's existing actions do **not** use the Sheets-style `x-context-binding`/`x-from-artifact` attributes. `get_email_attachment` wires ids via `x-variable-mapping` (extracting from an upstream attachment reference); `modify_email` takes a bare `message_id` string. New label-id/message-id inputs follow the **Gmail convention** — bare params, with `x-dynamic-options { source: "list_labels" }` on label-id inputs (Gmail's only dropdown source) and `x-variable-mapping` where an id flows from an upstream email/label entity. **Do not import the Sheets `x-context-binding`/`x-from-artifact` convention** (CR-A parity is per-plugin).
- **Version drift (flag):** `google-mail-plugin-v2.json` `plugin.version` is `1.0.0`, but `docs/plugins/google-mail-plugin.md` header already reads `1.1.0`. This slice will reconcile — see [OQ5](#open-questions-for-sa).

---

## Implementation Approach

**One executor method per action, each a thin typed wrapper over the relevant Gmail REST call**, returning a snake_case object matching the action's `output_schema`, reusing the existing label + MIME helpers wherever possible.

**Root-cause phase (per CLAUDE.md V6 protocol):** This is **plugin-layer work only**. No V6 pipeline/compiler changes — the actions are standard-shaped and auto-discovered by CapabilityBinder. Per Platform Design Principles, **no plugin-specific rules are added to any system prompt or the compiler**; the definition schema (`domain`/`capability`/`input_entity`/`output_entity`/cardinality/`x-semantic-type`/`output_dependencies`) is the sole source of truth.

### Helper reuse and the one small additive change

- **No new label helper needed.** `get_or_create_label`, `batch_modify`, and `delete_label` all build on the existing `createLabel` (409-safe), `resolveLabelNames`, and `SYSTEM_LABELS` — plus a single `GET /users/me/labels` fetch (the same call `resolveLabelNames`/`list_labels` already make).
- **One minimal additive extension to `buildEmailMessage`** (an existing method): accept an optional map of extra RFC822 headers (`In-Reply-To`, `References`) inserted before the `MIME-Version` line, defaulting to none so **all existing callers (`sendEmail`, `createDraft`) are byte-for-byte unaffected**. This keeps the MIME/base64url logic in one place instead of forking it for `reply`. Flagged explicitly for SA because it touches a heavily-commented, bug-hardened method (WP-8/WP-42/D12). See [OQ3](#open-questions-for-sa).

### Empty-body responses (204) — correctness note

Three of the six calls return **`204 No Content` with an empty body**: `messages.batchModify`, `labels.delete`, and (for `delete_label`) the 404-absent path. The existing action methods call `await response.json()` unconditionally — that would throw on an empty 204 body. The new methods must **not** call `.json()` when the status is 204 (or when the body is empty); they construct the success object from the request inputs + status. This is called out per-action below and is a required correctness point for SA/QA to verify.

### Idempotency (reasoned from Gmail API semantics — no hacks)

| Action | Idempotent? | Reasoning |
|---|---|---|
| `get_or_create_label` | **`true`** | Find-or-create: re-running returns the same label (list-match path; no duplicate created). Mirrors `get_or_create_folder`/`get_or_create_spreadsheet`. |
| `list_labels` | **`true`** | Read-only. |
| `delete_label` | **`true` (idempotent-ish)** | First delete removes the label; a re-run 404s → treated as **already-absent success** (mirrors the Drive `revoke_access` 404-absent pattern). Net effect ("label does not exist") is stable. |
| `reply` | **`false`** | Each call sends a new message into the thread. Re-running **double-sends**. Documented in `usage_context` — no executor-side dedupe (that would be plugin-specific state the executor cannot own). See risk note. |
| `send_draft` | **`false`** | Sends once and **consumes** the draft; a re-run 404s (draft no longer exists). Not safely re-runnable. Double-send risk if the caller retries with a fresh draft. Documented. |
| `batch_modify` | **`true`** | Applying an already-applied label / removing an already-absent label is a Gmail no-op; re-running converges to the same label state. (Note: this is label-state idempotency, not "processed each id once" — acceptable and standard.) |

### Destructive / send-safety (Security Rule + SA flags)

- **`delete_label`** is destructive → declares `rules.confirmations` with an explicit `condition` (`"label_id != null"`, mirroring the Drive/Sheets slices) + an in-executor guard that **refuses to delete a `SYSTEM_LABELS` id/name** (Gmail rejects it anyway, but we fail fast with a clean error). Confirmations are advisory in the executor, so the real safety is the scoped single-id delete + the system-label guard.
- **`reply` / `send_draft` SEND email** — they are the platform's send-class actions. They reuse the **existing send convention**: `send_email` declares confirmations for large groups / external domains / no-subject, and a hard `max_recipients` limit. `reply`/`send_draft` reuse the applicable subset (see per-action specs) so the send-safety posture is consistent with `send_email`. The double-send (non-idempotency) risk is documented in `usage_context`. See [OQ4](#open-questions-for-sa) for the exact confirmation posture.
- **`batch_modify`** operates on **many** messages → **bounded input**: a `rules.limits` block + an in-executor guard cap the `message_ids` count (proposed cap = **1000**, Gmail's own `batchModify` per-call maximum). A malformed/over-long id list fails fast before the call rather than silently issuing an unbounded mutation. See [OQ6](#open-questions-for-sa) for the cap value.

---

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/plugins/definitions/google-mail-plugin-v2.json` | modify | Add 6 action definitions (full top-level metadata block, `x-dynamic-options` on label-id inputs, output_schema, output_guidance/common_errors, `rules.confirmations` on `delete_label` + send-class actions, `rules.limits` on `batch_modify`); bump `plugin.version` (OQ5) |
| `lib/server/gmail-plugin-executor.ts` | modify | Add 6 `switch` cases + 6 private methods (`getOrCreateLabel`, `listAllLabels`, `deleteLabel`, `replyToThread`, `sendDraft`, `batchModifyMessages`); minimal additive `buildEmailMessage` extra-headers arg; reuse `createLabel`/`resolveLabelNames`/`SYSTEM_LABELS`. No logging conversion (already zero `console.*`) |
| `app/test-plugins-v2/page.tsx` | modify | Add 6 `PARAMETER_TEMPLATES` entries under `"google-mail"` |
| `tests/plugins/unit-tests/google-mail.test.ts` | modify | Add LEAN 3-per-action unit tests (18) + 4 safety assertions |
| `tests/plugins/integration-tests/google-mail.integration.test.ts` | modify | Add credential-gated lifecycle coverage (skips without `GOOGLE_MAIL_TEST_TOKEN`) |
| `docs/plugins/google-mail-plugin.md` | modify | Document all 6 new actions + version-history bump; Last Updated 2026-07-26 |

**Not touched / not needed:**
- `lib/server/plugin-executer-v2.ts`, `lib/server/plugin-manager-v2.ts` — no registry/manager change (auto-discovery).
- The existing public `list_labels` dropdown fetcher (line 884) — **left as-is**; the new action uses a distinct method name.

---

## Per-Action Specifications

Notation: `→` = maps to. Base host constant in executor is `this.gmailApisUrl` (= `https://gmail.googleapis.com/gmail/v1`). All actions: `domain: "email"` (labels: `"email"` domain, `capability` as noted).

### 1. `get_or_create_label` 🟢

| Field | Value |
|---|---|
| **Google API** | `GET /users/me/labels` (list → case-insensitive name match) → if absent `POST /users/me/labels` (reuses `createLabel`, 409-safe) |
| **domain** `email` · **capability** `create` (upsert) · input_entity `null` · output_entity `label` · cardinalities `null`/`single` |
| **idempotent** | `true` |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `label_name` | string | ✅ | Name of the label to find-or-create. Non-empty (validated). Case-insensitive match against existing labels. |
| `label_list_visibility` | string (enum) | ❌ (default `labelShow`) | Passed through to `createLabel` when creating. |
| `message_list_visibility` | string (enum) | ❌ (default `show`) | Passed through to `createLabel` when creating. |

**Method logic:** `GET /users/me/labels`; case-insensitive match on `label_name`. If found → return `{ label_id, label_name, created: false }`. If absent → `this.createLabel(connection, label_name)` → return `{ label_id, label_name, created: true }`. (`createLabel` already handles the 409 race by re-fetching.)

**Output schema (key fields):** `label_id` (x-guaranteed), `label_name` (x-guaranteed), `created` (boolean, x-guaranteed), `created_at` (x-guaranteed timestamp).

**Confirmation/safety:** none (non-destructive, idempotent). `common_errors`: `auth_failed`, `label_conflict`, `api_rate_limit`, `insufficient_permissions`.

### 2. `list_labels` 🟢

| Field | Value |
|---|---|
| **Google API** | `GET /users/me/labels` |
| **domain** `email` · **capability** `list` · input_entity `null` · output_entity `label` · cardinalities `null`/`collection` |
| **idempotent** | `true` |
| **executor method** | `listAllLabels` (⚠️ **not** `list_labels` — that name is the dropdown fetcher; see OQ2) |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `label_type` | string (enum `system`/`user`/`all`) | ❌ (default `all`) | Optional filter over the returned labels (executor-side filter on `label.type`). |

**Method logic:** `GET /users/me/labels`; map each to `{ id, name, type }`; optionally filter by `label_type`. Return `{ labels: [...], total_found, listed_at }`.

**Output schema (key fields):** `labels` (array of `{ id, name, type }` objects — `x-semantic-type: "gmail_label"` on the item, see V6 note in [Standards & Risks]), `total_found` (integer), `listed_at` (x-guaranteed timestamp).

**Confirmation/safety:** none (read-only). `common_errors`: `auth_failed`, `api_rate_limit`, `insufficient_permissions`.

### 3. `delete_label` 🟢 (destructive)

| Field | Value |
|---|---|
| **Google API** | `DELETE /users/me/labels/{id}` (returns **204 No Content**) |
| **domain** `email` · **capability** `delete` · input_entity `label` · output_entity `label` · cardinalities `single`/`single` |
| **idempotent** | `true` (idempotent-ish — 404 → already-absent success) |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `label_id` | string | ✅ | Gmail label id to delete. `x-dynamic-options: { source: "list_labels" }` (the existing dropdown fetcher). |

**Method logic:** guard: reject a `SYSTEM_LABELS` id/name before the call (clean `cannot_delete_system_label` error). `DELETE /users/me/labels/{label_id}`. **Do not call `.json()`** — success is `204`. On `404` treat as **already-absent success** (`deleted: true, already_absent: true`) mirroring the Drive `revoke_access` pattern. Return `{ label_id, deleted: true, deleted_at }`.

**Output schema (key fields):** `label_id` (x-guaranteed), `deleted` (boolean, x-guaranteed), `already_absent` (boolean), `deleted_at` (x-guaranteed timestamp).

**Confirmation/safety:** **REQUIRED.** `rules.confirmations` (`confirm_delete_label`: `condition: "label_id != null"`, `action: "confirm"`, message: "Delete the label '{label_id}'? Messages keep their content but lose this label."). Plus the in-executor system-label guard. `common_errors`: `auth_failed`, `label_not_found`, `cannot_delete_system_label`, `insufficient_permissions`.

### 4. `reply` 🟢 (send-class, NOT idempotent) — **name pending OQ1 (`reply_to_email`)**

| Field | Value |
|---|---|
| **Google API** | `GET /users/me/messages/{id}?format=metadata` (fetch `Message-ID`/`References`/`Subject`/`From` headers + `threadId`) → `POST /users/me/messages/send` with `{ raw, threadId }` where `raw` carries `In-Reply-To`/`References` |
| **domain** `email` · **capability** `send_message` · input_entity `email` · output_entity `email` · cardinalities `single`/`single` |
| **idempotent** | `false` (each call sends a message into the thread — double-send on re-run) |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `message_id` | string | ✅ | The message being replied to. Used to resolve `threadId`, the original `Message-ID` header (→ `In-Reply-To`/`References`), and the `Subject` (→ `Re: …`). `x-variable-mapping` from an upstream email entity's `id`. |
| `content` | object (`{ body?, html_body? }`) | ✅ | Reply body (reuses `buildEmailMessage` content handling — plain + `multipart/alternative`). At least one of `body`/`html_body` required. |
| `recipients` | object (`{ to?, cc?, bcc? }`) | ❌ | Override recipients. **Default: reply to the original sender** (`Reply-To` ?? `From` of the fetched message). |
| `reply_all` | boolean | ❌ (default `false`) | When true and no explicit `recipients`, include the original `To`/`Cc` set (minus self). |

**Method logic:** (1) `GET` the original message metadata → extract `threadId`, `Message-ID`, `References`, `Subject`, `From`/`Reply-To`/`To`/`Cc`. (2) Compute recipients (explicit override → else sender; `reply_all` widens). (3) Build subject `Re: <original>` (no double-`Re:`). (4) Call `buildEmailMessage` with the reply content + the **extra headers** `In-Reply-To: <Message-ID>` and `References: <existing References> <Message-ID>`. (5) `POST …/messages/send` with `{ raw, threadId }`. Return `{ message_id, thread_id, in_reply_to, sent_at, recipient_count, subject }`.

**Safety-critical property (tested):** the send body MUST include `threadId` AND the raw MIME MUST include an `In-Reply-To` header referencing the original — i.e. it **continues the thread**, never starts a new one.

**Confirmation/safety:** reuse the `send_email` send-class subset — `external_domains` + `no_subject`-analogue don't apply cleanly (subject is derived), so propose `external_domains` confirmation + the `max_recipients` hard limit (OQ4). `common_errors`: `auth_failed`, `message_not_found`, `invalid_recipient`, `api_rate_limit`, `insufficient_permissions`.

### 5. `send_draft` 🟢 (send-class, NOT idempotent)

| Field | Value |
|---|---|
| **Google API** | `POST /users/me/drafts/send` with body `{ id: <draft_id> }` |
| **domain** `email` · **capability** `send_message` · input_entity `draft` · output_entity `email` · cardinalities `single`/`single` |
| **idempotent** | `false` (sends once and **consumes** the draft; re-run 404s) |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `draft_id` | string | ✅ | Gmail draft id (as returned by `create_draft`). No dropdown source exists for drafts today → bare string input; `x-variable-mapping` from an upstream `create_draft` result's `draft_id`. |

**Method logic:** `POST …/drafts/send` with `{ id: draft_id }`. Gmail returns the sent message `{ id, threadId, labelIds }`. Return `{ message_id, thread_id, draft_id, sent_at }`.

**Confirmation/safety:** send-class. The draft's recipient set is not known to the action pre-send (it lives in the draft), so recipient-count confirmations don't apply cleanly. Propose a single always-informational send confirmation OR none, per `create_draft` precedent (OQ4). `common_errors`: `auth_failed`, `draft_not_found`, `api_rate_limit`, `insufficient_permissions`.

### 6. `batch_modify` 🟢 (bounded, idempotent) — **name pending OQ1 (`batch_modify_emails`)**

| Field | Value |
|---|---|
| **Google API** | `POST /users/me/messages/batchModify` with `{ ids, addLabelIds, removeLabelIds }` (returns **204 No Content**) |
| **domain** `email` · **capability** `modify` · input_entity `email` · output_entity `email` · cardinalities `collection`/`collection` |
| **idempotent** | `true` (applying an already-applied label / removing an absent one is a no-op) |

**Input schema**

| Param | Type | Required | Notes |
|---|---|---|---|
| `message_ids` | string[] | ✅ | The messages to modify. **Bounded** — max 1000 (OQ6). Empty array rejected. |
| `add_labels` | string[] | ❌ | Label **names** (system or custom) to add — resolved to ids via `resolveLabelNames` (consistent with `modify_email`). |
| `remove_labels` | string[] | ❌ | Label names to remove — resolved to ids. |
| `archive` | boolean | ❌ (default `false`) | Shorthand: adds `INBOX` to `removeLabelIds` (archiving = removing the `INBOX` label, consistent with `modify_email`). |

**Method logic:** guard: reject empty `message_ids` and `message_ids.length > cap` **before** the call. Require at least one of `add_labels`/`remove_labels`/`archive`. Resolve label names → ids via `resolveLabelNames`; apply `archive` → push `INBOX` to removeLabelIds. `POST …/messages/batchModify` with `{ ids: message_ids, addLabelIds, removeLabelIds }`. **Do not call `.json()`** — success is `204`. Return `{ modified_count: message_ids.length, message_ids, labels_added, labels_removed, modified_at }`.

**Safety-critical property (tested):** the request body `ids` array equals exactly the (bounded) input `message_ids` — never widened, never empty-through-to-a-no-op-that-looks-like-success on a malformed input.

**Confirmation/safety:** operates on many messages. `rules.limits` (`max_ids`: `condition: "message_ids_count > 1000"`, `action: "block"`) + in-executor guard. Propose a `rules.confirmations` on large batches (`message_ids_count > 50`, analogous to `search_emails` large-search confirm) — OQ4. `common_errors`: `auth_failed`, `too_many_ids`, `label_not_found`, `api_rate_limit`, `insufficient_permissions`.

> **`${param}_count` rule-context caveat (same platform gap as the Docs/Sheets slices):** the `message_ids_count` / `total_recipients` style conditions are declared for convention parity, but whether `extractRuleContext` (`plugin-manager-v2.ts`) derives a generic `${param}_count` is **unverified** — `send_email` already relies on `total_recipients`, so there is precedent, but the batch cap's real enforcement is the **in-executor guard**, not the advisory rule. I will verify `extractRuleContext` coverage during implementation and note any inert rule (do not delete it — keep the definition uniform). Flagged in [Standards & Risks].

---

## Task List

**Definition JSON (`google-mail-plugin-v2.json`)**
- [x] Add `get_or_create_label` (full top-level metadata block, `idempotent: true`, output_schema with `label_id`/`label_name`/`created`/`created_at` x-guaranteed, common_errors)
- [x] Add `list_labels` (full block, `idempotent: true`, `labels[]` output with `x-semantic-type: "gmail_label"` item, common_errors)
- [x] Add `delete_label` **with `rules.confirmations`** (`condition: "label_id != null"`), `x-dynamic-options { source: "list_labels" }` on `label_id`, `idempotent: true` + already-absent semantics in `usage_context`
- [x] Add `reply` (name per OQ1) — send-class metadata, `content`/`recipients`/`reply_all`, confirmation posture per OQ4, `idempotent: false` + double-send caveat in `usage_context`
- [x] Add `send_draft` — `draft_id`, confirmation posture per OQ4, `idempotent: false` + consume-once caveat in `usage_context`
- [x] Add `batch_modify` (name per OQ1) — `message_ids`/`add_labels`/`remove_labels`/`archive`, `rules.limits` (`message_ids_count > cap`), confirmation per OQ4, `idempotent: true`
- [x] Bump `plugin.version` (OQ5 — reconcile with the 1.1.0 already in the plugin doc)

**Executor (`gmail-plugin-executor.ts`)**
- [x] Add 6 `case` branches to the `executeSpecificAction` switch (`get_or_create_label`, `list_labels`, `delete_label`, `reply`/`reply_to_email`, `send_draft`, `batch_modify`/`batch_modify_emails`)
- [x] `getOrCreateLabel()` — GET labels → case-insensitive match → reuse `createLabel` on miss; return `created` flag
- [x] `listAllLabels()` — **distinct method name** (not the `list_labels` dropdown fetcher, OQ2); GET labels → `{id,name,type}[]` + optional `label_type` filter
- [x] `deleteLabel()` — system-label guard → `DELETE`; **no `.json()` on 204**; 404 → already-absent success
- [x] `replyToThread()` — GET original metadata → resolve threadId/Message-ID/Subject/recipients → `buildEmailMessage` with reply headers → `POST send` with `{ raw, threadId }`
- [x] `sendDraft()` — `POST drafts/send { id }`; return sent message ids
- [x] `batchModifyMessages()` — empty/over-cap guard **before** fetch → `resolveLabelNames` + `archive` INBOX shorthand → `POST batchModify`; **no `.json()` on 204**
- [x] Minimal additive extension to `buildEmailMessage` (optional extra-headers arg for `In-Reply-To`/`References`); confirm existing callers unaffected (OQ3)
- [x] Confirm all new methods use `this.logger` only (file remains **zero** `console.*` — no conversion)
- [x] Verify `extractRuleContext` covers `message_ids_count` (else note the rule as inert-but-retained; guard enforces the cap regardless)

**Wiring**
- [x] Confirm NO registry/manager change needed (definition auto-loaded; `google-mail` already in `plugin-executer-v2.ts` line 42)
- [x] Add 6 `PARAMETER_TEMPLATES` entries under `"google-mail"` in `app/test-plugins-v2/page.tsx`

**Tests** (see [Testing](#testing))
- [x] Unit: LEAN 3 per action — happy + auth-failure (401) + invalid-input (18 total)
- [x] Unit: 4 safety assertions — (a) `get_or_create_label` no-create-on-existing (GET only, no POST); (b) `reply` sends with `threadId` + `In-Reply-To` (thread-continuation); (c) `delete_label` 404 → already-absent success (not thrown); (d) `batch_modify` sends the exact bounded id set
- [x] Integration: credential-gated lifecycle (skips without `GOOGLE_MAIL_TEST_TOKEN`) — create-label → list → (draft →) send_draft / reply / batch_modify → delete-label cleanup
- [x] `x-semantic-type` check: `list_labels` item `gmail_label` — verify against `input-type-compat.ts`; run `validatePluginTypeAnnotations` (OQ7)

**Docs**
- [x] Update `docs/plugins/google-mail-plugin.md`: add all 6 new actions + version-history bump; Last Updated 2026-07-26. Back-fill any undocumented existing actions if SA agrees (OQ5).

---

## Testing

Follows the existing `tests/plugins/unit-tests/google-mail.test.ts` harness (`createTestExecutor`, `expectSuccessResult`, `expectErrorResult`, `expectFetchCalledWith`, `expectAllFetchCallsAuthorized` from `../common/test-helpers`; `mockFetchSuccess`, `mockFetchError`, `mockFetchSequence`, `restoreFetch`, `getAllFetchCalls` from `../common/mock-fetch`), matching the `[smoke]` (happy) / `[full]` (failure + safety) split used today.

### LEAN test policy (binding — user directive)

**Exactly 3 unit tests per action: happy path + auth-failure (401) + invalid-input. 18 total.** Plus **4 safety-critical assertions ONLY** where genuine risk exists (one minimal assertion each). No more. Deeper coverage → the credential-gated integration file.

| Action | Happy path (mock) | Auth failure | Invalid input |
|---|---|---|---|
| `get_or_create_label` | GET labels (match) → `created:false` returned; or GET (miss)+POST → `created:true` | 401 on the GET → `expectErrorResult` | empty `label_name` → validation error, no fetch |
| `list_labels` | GET labels → `labels[]` + `total_found` | 401 → `expectErrorResult` | invalid `label_type` enum → clamped/validation (per guard) |
| `delete_label` | `DELETE` 204 → `deleted:true`; `expectFetchCalledWith('/labels/…','DELETE')` | 401 → `expectErrorResult` | system-label id (e.g. `INBOX`) → `cannot_delete_system_label`, no DELETE issued |
| `reply` | GET meta + POST send → `thread_id` echoed; `expectFetchCalledWith('/messages/send','POST')` | 401 → `expectErrorResult` | missing `content` (no body/html_body) → validation error |
| `send_draft` | `POST drafts/send` → `message_id`/`thread_id`; `expectFetchCalledWith('/drafts/send','POST')` | 401 → `expectErrorResult` | missing `draft_id` → validation error, no fetch |
| `batch_modify` | `POST batchModify` 204 → `modified_count`; `expectFetchCalledWith('/messages/batchModify','POST')` | 401 → `expectErrorResult` | empty `message_ids` (or > cap) → validation error, no fetch |

**Safety-critical assertions (the only permitted extras — 4 total, minimal):**

| # | Action | Assertion |
|---|---|---|
| S1 | `get_or_create_label` | On a **matching** existing label, **only the GET** `/users/me/labels` is issued — **no POST** (`getAllFetchCalls()` contains no create call). Proves the find path doesn't create. |
| S2 | `reply` | The send request body includes `threadId`, AND the decoded `raw` MIME contains an `In-Reply-To` header referencing the original `Message-ID` — i.e. **continues the thread, not a new one.** |
| S3 | `delete_label` | A `404` from `DELETE` resolves to an **already-absent success** (`expectSuccessResult`, `already_absent:true`) — **not** an error/throw. |
| S4 | `batch_modify` | The `batchModify` request body `ids` array equals **exactly** the input `message_ids` (bounded set), verified via `getAllFetchCalls()`. |

### Scoped fast command (from workplan directive)

```bash
npx jest tests/plugins/unit-tests/google-mail.test.ts
```

Expected: existing Gmail suite stays green; +18 LEAN unit tests + 4 safety assertions for the 6 new actions.

### Integration tests

Extend `tests/plugins/integration-tests/google-mail.integration.test.ts` (skips without `GOOGLE_MAIL_TEST_TOKEN`) with a self-cleaning lifecycle: `get_or_create_label` → `list_labels` (asserts presence) → `create_draft` → `send_draft` → `reply` to the sent message → `batch_modify` (archive) → `delete_label` cleanup. (Note: the existing integration file's `afterAll` already references a `delete_email` cleanup action that does not yet exist — out of scope here, but flagged so QA isn't surprised by that skip.)

---

## Standards & Risks

- **Logging (Mandatory Rule 3) — no action needed for the executor.** `lib/server/gmail-plugin-executor.ts` contains **exactly 0 `console.*` calls** (grep-confirmed) — it already uses `this.logger` (Pino) throughout, with structured context and `{ err }` on errors. All 6 new methods will use `this.logger` only. **No conversion required.** (Contrast the Sheets slice, which had 1 `console.error` at line 247.)
- **Touched-file logging flag:** this slice also modifies `app/test-plugins-v2/page.tsx` (adding `PARAMETER_TEMPLATES`). That file contains **pre-existing client-side `console.*` `DEBUG` logs** (the same ones the user chose to LEAVE in the Drive/Sheets/Docs slices — it is a `'use client'` component where Pino/`createLogger` is server-only, so it is not a straight conversion). Surfaced per CLAUDE.md § Logging "non-compliant files you touch"; **no new `console.*` added**, and no conversion unless the user decides otherwise.
- **OAuth scope:** ✅ **No new scope.** All 6 actions fit the already-granted `gmail.send` (`reply`, `send_draft`) and `gmail.modify` (`get_or_create_label`, `list_labels`, `delete_label`, `batch_modify` — labels + batchModify are covered by `gmail.modify`; `list_labels` also covered by `gmail.readonly`). Confirmed against `required_scopes` in `google-mail-plugin-v2.json`. Zero re-consent, zero Google app re-verification. **Filters (Phase 2) are the only Gmail actions needing `gmail.settings.basic` — explicitly excluded here.**
- **Idempotency:** reasoned per action from Gmail API semantics (table above). `get_or_create_label`/`list_labels`/`batch_modify`/`delete_label` idempotent (delete = 404-absent success); `reply`/`send_draft` NOT (send once — **double-send risk documented in `usage_context`; no executor-side dedupe**, which would be plugin-specific state the stateless executor cannot own).
- **Destructive/send safety:** `delete_label` → confirmation rule + in-executor system-label guard + 404-absent handling. `reply`/`send_draft` reuse the `send_email` send-safety convention (OQ4). `batch_modify` → bounded id count (`rules.limits` + in-executor cap) with the S4 exact-id-set assertion. Confirmations are **advisory** in the executor (base lines 69–74), so real safety is the scoped executor behavior, not the rule.
- **204 empty-body correctness:** `batch_modify`, `delete_label`, and the 404-absent path must **not** call `response.json()` on an empty body (the existing action methods do call `.json()` unconditionally — the new methods branch on status). Called out for SA/QA verification.
- **`buildEmailMessage` extension risk:** `reply` requires an additive optional-extra-headers argument on a **bug-hardened** existing method (WP-8 non-ASCII, WP-42 recipient coercion, D12 multipart). The change defaults to no extra headers so `sendEmail`/`createDraft` are unaffected. Flagged for SA (OQ3) — the alternative (a separate `buildReplyMessage`) would duplicate the MIME/base64url logic and is rejected as a divergence.
- **`list_labels` naming collision:** the new action's executor method is `listAllLabels` (or SA's preferred name), NOT the existing public `list_labels` dropdown fetcher. Flagged (OQ2).
- **No hardcoding:** no plugin-specific rules added to any system prompt or the compiler; the definition schema is the sole source of truth (Platform Design Principles).
- **Repository pattern / Supabase:** N/A — executors are stateless; no DB writes in this slice.
- **V6 pipeline:** no compiler changes; actions are standard-shaped and auto-discovered. No new `must_support` semantics without SA sign-off. **New `x-semantic-type: "gmail_label"`** on the `list_labels` item is the one potential type-registry touch — verify against `lib/agentkit/v6/capability-binding/input-type-compat.ts` and run `validatePluginTypeAnnotations` (OQ7). All other new outputs are scalar/status.
- **`extractRuleContext` `${param}_count` coverage:** the `batch_modify` `message_ids_count` limit condition relies on the same generic rule-context derivation the Docs/Sheets slices flagged as a platform gap. `send_email`'s `total_recipients` precedent suggests count-derivation exists for at least some shapes; I will verify and, if `message_ids_count` is inert, keep the declarative rule (uniformity) and rely on the **in-executor cap guard** for real enforcement. Not a blocker for this slice.

---

## Open Questions for SA

1. **Action naming — align with the requirement or the task brief?** The requirement's SA feasibility table names these `reply_to_email` and `batch_modify_emails`; the Dev task brief abbreviates to `reply` and `batch_modify`. `get_or_create_label`, `list_labels`, `delete_label`, `send_draft` are unambiguous. **Recommendation: use the requirement's names (`reply_to_email`, `batch_modify_emails`)** since the requirement is the ratified source of truth and the longer forms are more self-describing for the LLM catalog. Confirm the final 6 action keys.
2. **`list_labels` method naming (collision).** The executor already has a public `list_labels(connection, options)` **dropdown fetcher** (line 884, returns `{value,label}[]`). The new **action** must dispatch to a distinctly-named private method. **Recommendation: `listAllLabels`.** Confirm the name (and that the dropdown fetcher stays untouched, with `delete_label.label_id` wiring `x-dynamic-options { source: "list_labels" }` to it).
3. **`buildEmailMessage` extension for `reply`.** I propose a minimal additive optional extra-headers arg (`In-Reply-To`/`References`) on the existing bug-hardened `buildEmailMessage`, defaulting to none so `sendEmail`/`createDraft` are byte-for-byte unaffected — versus a separate `buildReplyMessage` that would duplicate the MIME/base64url logic. **Recommendation: extend `buildEmailMessage`.** Confirm.
4. **Send-class confirmation posture** for `reply` / `send_draft` / `batch_modify`. `send_email` declares `large_group`/`external_domains`/`no_subject` confirmations + a `max_recipients` limit; `create_draft` declares only a `large_draft` confirmation. Proposed: `reply` → `external_domains` confirm + `max_recipients` limit; `send_draft` → follow `create_draft` (minimal, since recipients live in the draft and aren't visible pre-send); `batch_modify` → a `message_ids_count > 50` confirm + the `> 1000` hard limit. Confirm this posture (given confirmations are advisory in the executor regardless).
5. **Plugin-doc back-fill + version reconciliation.** `google-mail-plugin-v2.json` `plugin.version` is `1.0.0` but `docs/plugins/google-mail-plugin.md` already reads `1.1.0` (drift). Should I (a) bump the JSON to `1.2.0` and the doc to match (6 new actions), and (b) while in the doc, back-fill any existing action whose doc is stale (as the Sheets slice did for its 2 undocumented `get_or_create_*`)? **Recommendation: reconcile JSON→`1.2.0`, doc→`1.2.0`, document all 11 actions (5 existing + 6 new), back-fill any gaps.** Confirm the target version number.
6. **`batch_modify` id cap.** Gmail's `messages.batchModify` accepts up to **1000 ids** per call. Proposed cap = **1000** (`rules.limits` block + in-executor guard, fail-fast before the call). Confirm 1000 (vs a more conservative platform cap, e.g. 100/500, for LLM-generated batches).
7. **`gmail_label` semantic type.** `list_labels` returns object-typed items (`{id,name,type}`). Proposed `x-semantic-type: "gmail_label"` on the item. Does SA want this new type registered in `input-type-compat.ts` (like the Phase 2 `time_slot`), or is a label a terminal/leaf output that needs no input-compat entry? **Recommendation: add the item annotation, run `validatePluginTypeAnnotations`, and only extend `input-type-compat.ts` if the validator flags it** (labels are unlikely to be a downstream *input entity*). Confirm.

---

## SA Review Notes

_(SA to populate during workplan review.)_

---

## SA Workplan Review

**Reviewed by SA — 2026-07-26**
**Status:** ✅ **Approved for implementation** — with the minor change-requests in CR-1…CR-5 folded in during coding (they are unambiguous and do not require a workplan re-review). No user decision is required before Dev starts.

The workplan is architecturally sound, correctly scoped to plugin-layer-only work, and its code-grounding claims were all verified against the live executor and definition JSON (public `list_labels` fetcher @884, `createLabel` 409-safe @501, `resolveLabelNames` @442, `SYSTEM_LABELS` @11, `buildEmailMessage` @577 with base64url @668–673, **0 `console.*` confirmed by full-file read**, and existing methods calling `.json()` unconditionally @102/@427 — so the 204 concern is real). One genuine correctness gap was found (CR-1). Decisions on all 7 open questions follow.

### Decisions on the 7 open questions

**OQ1 — Action naming → USE THE REQUIREMENT'S NAMES: `reply_to_email` and `batch_modify_emails`.**
The requirement is the ratified source of truth (§ SA Architectural Review feasibility table names them explicitly), and the longer forms are more self-describing for the LLM action catalog. Final 6 keys: `get_or_create_label`, `list_labels`, `delete_label`, `reply_to_email`, `send_draft`, `batch_modify_emails`. Update the switch cases + definition keys to the long forms (drop the abbreviated aliases — do not register two keys per action; one canonical key each).

**OQ2 — `list_labels` method collision → APPROVED: dispatch the action to a private `listAllLabels`; leave the public `list_labels` dropdown fetcher (@884) untouched.**
Verified the two live on separate paths: actions dispatch through the `executeSpecificAction` **switch** (explicit `case 'list_labels' → this.listAllLabels(...)`), while the dropdown path calls `executor['list_labels']` via `fetchDynamicOptions`. No collision as long as the switch names the private method explicitly. `listAllLabels` is a good name. **Guardrail:** confirm during impl that the base has no `executor[actionName]` dynamic-dispatch fallback for actions (the switch is the only action path — if a fallback exists it would shadow to the fetcher). One-line verification, not a blocker.

**OQ3 — `buildEmailMessage` extension for reply headers → APPROVED: extend the existing method with a single additive optional `extraHeaders` argument; reject the duplicate `buildReplyMessage`.**
Duplicating the MIME/base64url logic would fork a method with three prior bug-fixes (WP-8 non-ASCII, WP-42 recipient coercion, D12 multipart) — that divergence is the larger long-term risk. The additive arg, defaulting to none, is the correct call. **Mandatory guardrails:**
- The new parameter must default such that **`sendEmail` and `createDraft` call sites remain byte-for-byte unchanged** (no new arg passed there).
- The extra headers (`In-Reply-To`, `References`) must be injected **before the `MIME-Version: 1.0` line** and must run through `mimeEncodeHeader` for safety (message-ids are ASCII, but keep the single code path uniform).
- **Required regression assertion (add to the LEAN suite, does not count against the 4 safety slots — it protects an existing path):** one test asserting that `sendEmail`'s produced `raw` is unchanged for a representative payload (i.e. no `In-Reply-To`/`References` leak into the non-reply path). If the existing suite already snapshots a send `raw`, extend that; otherwise this is a 1-assertion guard on the bug-hardened method and is justified.

**OQ4 — Send/confirmation posture → APPROVED as proposed, with the advisory caveat made explicit.**
- `reply_to_email` → `external_domains` confirm + `max_recipients` hard limit (mirror send_email's subset). **Caveat:** when recipients are *derived* (no explicit `recipients` override), `has_external_recipients`/`total_recipients` are not visible to `extractRuleContext` pre-execution, so these rules are **inert for the derived-recipient path** — acceptable, because confirmations are advisory platform-wide (base @69–74 logs "would be handled via UI" and does not block). Do not represent them as a hard gate.
- `send_draft` → **minimal, mirror `create_draft`** (no recipient-based confirm — recipients live inside the draft and are not visible pre-send). Correct call.
- `batch_modify_emails` → `message_ids_count > 50` confirm (advisory) + the `> 1000` **hard** limit (see OQ6).
Because confirmations are inert in the executor (and `extractRuleContext` `${param}_count` coverage is the open gap tracked as **task_2ea2e007**), **real safety for all three is the in-executor behavior**, not the declarative rule. Keep the rules for catalog uniformity; never rely on them for enforcement.

**OQ5 — Plugin-doc back-fill + version → APPROVED: reconcile JSON `1.0.0` → `1.2.0`, doc `1.1.0` → `1.2.0`, document all 11 actions (5 existing + 6 new).**
Confirmed the drift (JSON @ line 4 = `1.0.0`; doc header = `1.1.0`). Target `1.2.0` for both is the right reconciliation (the doc's `1.1.0` already implies undocumented drift, so a single minor bump past it that covers 6 new actions is correct). Back-fill any stale existing-action rows while in the doc (parity with the Sheets slice's `get_or_create_*` back-fill). Plugin-doc DoD (full action table row + version-history entry + Last Updated 2026-07-26) carries over from the sibling slices.

**OQ6 — `batch_modify_emails` id cap → DECISION: hard cap = 1000, enforced in-executor (fail-fast).**
1000 is Gmail's own `batchModify` per-call maximum and the natural boundary. I explicitly reject a tighter platform sub-cap (e.g. 100/500): the requirement's Goal 2 explicitly wants retroactive application to an existing backlog ("also apply this to the 200 emails already in my inbox"), which a 100-cap would break; the `> 50` advisory confirmation already supplies the "large batch — are you sure" signal. **Enforcement mandate (because `rules.limits` is inert per task_2ea2e007):** the in-executor guard must **hard-reject** `message_ids.length > 1000` (and empty `message_ids`) with a clean `too_many_ids` error **before** the fetch — it must not rely on the advisory `rules.limits` block. Keep the declarative `rules.limits` entry for catalog uniformity but treat it as documentation, not a gate.

**OQ7 — `gmail_label` semantic type → APPROVED: annotate the item `x-semantic-type: "gmail_label"`, run `validatePluginTypeAnnotations`, and only register in `input-type-compat.ts` if the validator demands it — and then only as an output/leaf type, never as a bindable input entity.**
A label id is consumed downstream as a plain string param (`delete_label.label_id`) or by name (`batch_modify_emails.add_labels`), so there is no real input-binding need — keep V6 type-clean. **Firm fallback:** if `validatePluginTypeAnnotations` fails on an unregistered type, do **not** drop the annotation to dodge the validator — register `gmail_label` minimally as an output-leaf with no input-compat edges. Either outcome is deterministic; a half-registered type is not acceptable.

### Change-requests to fold in (no re-review needed)

**CR-1 (Correctness — must fix). `get_or_create_label` visibility params contradict the `createLabel` signature.**
The spec (§ Per-Action 1) lists optional `label_list_visibility` / `message_list_visibility` params "passed through to `createLabel` when creating" — but `createLabel(connection, labelName)` is a 2-arg method that **hardcodes** `labelListVisibility: 'labelShow'` / `messageListVisibility: 'show'` (@512–513). As written, those params would be silently ignored (a real correctness/expectation bug), and honoring them would require a **second** change to a bug-hardened shared helper (the D-B10b 409 path), contradicting the workplan's "reuse `createLabel` directly / no new helper" claim.
**Ruling:** for this LEAN v1, **drop both visibility params** from `get_or_create_label`. It keeps `createLabel` byte-for-byte untouched, matches the existing hardcoded behavior, and avoids scope creep. If a real need for label visibility surfaces later, extend `createLabel` with optional args in a separate, tested change. (Update the input-schema table + the JSON accordingly.)

**CR-2 (Naming — must apply). Lock action keys to the OQ1 long forms** (`reply_to_email`, `batch_modify_emails`) in the definition keys, the switch cases, the test tables, and the docs. Remove the abbreviated-alias hedging from the task list — one canonical key per action.

**CR-3 (Regression guard — must add). Add the `sendEmail`-unaffected assertion for the `buildEmailMessage` change** (per OQ3). This protects the existing send path and is the price of touching the bug-hardened method; it does not consume one of the 4 safety slots.

**CR-4 (Enforcement — must implement). In-executor hard guards are the real enforcement for both bounded/destructive paths** (per OQ6 + OQ4): `batch_modify_emails` hard-rejects empty and `> 1000` before the fetch; `delete_label` hard-rejects `SYSTEM_LABELS` ids/names before the DELETE. Do not rely on `rules.*` (inert per task_2ea2e007). These are already reflected in safety assertions S3/S4 and the invalid-input rows — keep them.

**CR-5 (Verify — must confirm, don't assume). Two impl-time verifications** already noted by Dev, promoted to explicit gate items: (a) confirm the definition attribute that binds `delete_label.label_id` to the dropdown source — grep an existing plugin definition that already wires a dynamic-options source and match its exact attribute name/shape rather than assuming `x-dynamic-options`; (b) verify `extractRuleContext` coverage of `message_ids_count` — if inert, keep the rule and rely on the CR-4 guard (do not delete the rule).

### Per-item validation verdict

| Area | Verdict | Note |
|---|---|---|
| Schema/convention parity (full metadata block) | ✅ | Matches the live block shape (domain/capability/entity/cardinality/output_fields/required_params/must_support/output_schema/output_guidance). |
| id-input binding parity (Gmail convention) | ✅ | Correct to use `x-variable-mapping` + bare params and **not** import Sheets `x-context-binding`/`x-from-artifact` — CR-A parity is per-plugin. |
| snake_case + legacy mirrors | ✅ | Gmail top-level returns are snake_case-only (verified); new actions match. |
| output `x-guaranteed` fields | ✅ | id/timestamp fields flagged per action, consistent with existing actions. |
| confirmation `condition` on `delete_label` | ✅ | `label_id != null` = always-confirm-on-delete (label_id is required). Matches sibling-slice pattern; advisory only. |
| `get_or_create_label` find-or-create + 409-safe | ⚠️ | Core logic ✅ (reuses 409-safe `createLabel`); **CR-1** on the visibility params. |
| `reply_to_email` thread continuation | ✅ | threadId + In-Reply-To/References + Re: dedupe + derived-recipient default is correct; S2 asserts it. |
| `send_draft` consumes draft | ✅ | `drafts.send { id }`; non-idempotency documented. |
| `batch_modify_emails` bounded batchModify | ✅ | Exact-id-set (S4) + `archive`→remove INBOX parity with modify_email. CR-4 makes the cap real. |
| 204 No-Content handling | ✅ | Correctly flagged that existing methods `.json()` unconditionally (verified) and new methods must branch on status. Required for delete_label/batch_modify + 404 path. |
| `delete_label` system-label guard + 404-absent | ✅ | SYSTEM_LABELS guard (CR-4) + 404→already-absent (S3). |
| Idempotency semantics | ✅ | Per-action table is correct (get_or_create/list/batch_modify/delete idempotent; reply/send_draft not — double-send documented, no silent dedupe). |
| Standards: 0 `console.*`, no hardcoding, no direct Supabase, V6 type-clean | ✅ | Executor is `console.*`-free (full-read confirmed) — no conversion. No prompt/compiler hardcoding; stateless executor; gmail_label handled per OQ7. |
| Touched-file logging flag (`app/test-plugins-v2/page.tsx`) | ✅ | Pre-existing client-side `console.*` DEBUG logs; `'use client'` (Pino is server-only). Precedent-covered (user chose to leave them in prior Drive/Sheets/Docs slices); **no new `console.*` added**. Surfaced, not a blocker, no new user decision. |
| LEAN tests (18 = 3/action + 4 safety) | ✅ | Meets happy + auth(401) + invalid per action; S1–S4 are the right minimal safety slots. **Plus** the CR-3 `sendEmail`-unaffected regression assertion (justified extra on an existing path). |
| Root-cause phase (plugin-layer only) | ✅ | No V6 compiler/IR changes; standard-shaped, auto-discovered. Correct phase. |

### Optimisation suggestions (non-blocking, do not gate)

- **`batch_modify_emails` `remove_labels` via `resolveLabelNames`:** `resolveLabelNames` *creates* a missing custom label (@489), so removing a non-existent label name would pointlessly create-then-remove it. This exactly mirrors existing `modify_email` behavior (@402), so it is acceptable parity — but Dev may optionally resolve **removes** without the create side-effect (resolve-or-skip). Low priority; parity is a fine default.
- Consider noting in `reply_to_email` `usage_context` that recipient-based confirmations are advisory and inert on the derived-recipient path, so downstream reviewers don't over-trust them.

### Approval

- [x] **Workplan approved — proceed to implementation** with CR-1…CR-5 folded in. No workplan re-review required for these CRs; they will be checked at code-review. **No user decision is required before Dev starts** — the executor is already logging-clean, no new scope, and the only `console.*` in the touched set is the precedent-covered client-side test page.

---

## QA Testing Report

**QA — 2026-07-27**
**Test mode:** full (all 6 actions: 3-per-action LEAN + 4 safety + CR-3 regression)
**Strategy used:** A (Jest unit) — executed the scoped suite for a real green run; plus code inspection of `gmail-plugin-executor.ts` to confirm each safety-critical behavior at the source, not just via assertions.
**Focus:** api / security (send-safety, destructive-guard, bounded-batch)
**Skipped:** Integration suite (credential-gated — no `GOOGLE_MAIL_TEST_TOKEN` in env; skips by design, out of scope for this pass). E2E N/A (no UI surface).
**Input source:** prompt keywords + workplan Testing section (LEAN policy)

### Actual test run (on record)

Command: `npx jest tests/plugins/unit-tests/google-mail.test.ts --runInBand --no-coverage`

```
Test Suites: 1 passed, 1 total
Tests:       48 passed, 48 total
Snapshots:   0 total
Time:        3.666 s
```

**All 48 tests passed** (25 pre-existing + 23 new = 18 LEAN + 4 safety S1–S4 + 1 CR-3 regression). The actual test execution took **3.666s**. The wrapping shell command hit its wall-clock limit purely because **Jest did not exit after the run completed** — "Jest did not exit one second after the test run has completed … asynchronous operations that weren't stopped" (open handles, likely a batched-audit/timer). This is a **post-completion process-hang, not a test failure**: the summary line is emitted only after every test resolves, and it reports 48/48 passed with 0 failures. The nonzero background exit code is attributable to that open-handle hang + the process being killed, not to any assertion. (Recommend `--forceExit` / `--detectOpenHandles` as a future harness nicety — not a bug in this slice.)

### Test Coverage

| Acceptance Criterion (per-action) | Tested? | Result | Notes |
|---|---|---|---|
| `get_or_create_label` — happy / 401 / invalid(empty name) | ✅ | Pass | Empty `'   '` rejected before any fetch (0 calls). |
| `list_labels` — happy / 401 / invalid(enum) | ✅ | Pass | Out-of-enum `label_type` clamped to `all` by base-class param guard; still succeeds. |
| `delete_label` — happy(204) / 401 / invalid(system id) | ✅ | Pass | 204 handled without `.json()`; system id rejected pre-fetch. |
| `reply_to_email` — happy / 401 / invalid(no body) | ✅ | Pass | `Re:` dedupe verified (`subject === 'Re: Project Update'`). |
| `send_draft` — happy / 401 / invalid(no draft_id) | ✅ | Pass | `drafts/send { id }`; missing id rejected pre-fetch. |
| `batch_modify_emails` — happy(204) / 401 / invalid(empty) | ✅ | Pass | 204 handled without `.json()`; empty array rejected pre-fetch. |
| S1 get_or_create no-create-on-match | ✅ | Pass | 1 GET only, method GET, `created:false`, no POST. |
| S2 reply threads (`threadId` + `In-Reply-To`/`References`) | ✅ | Pass | Decoded raw MIME carries both headers referencing `<orig@mail.gmail.com>`. |
| S3 delete_label 404→already_absent (not thrown) | ✅ | Pass | Success result, `already_absent:true`; + system id 0-fetch reject. |
| S4 batch exact bounded id set + >1000 reject | ✅ | Pass | `ids` === `['m1','m2','m3']` unwidened; 1001 ids → error, 0 fetches. |
| CR-3 send_email raw unaffected by extraHeaders | ✅ | Pass | Non-reply raw contains no `In-Reply-To`/`References`; `To:`/`Subject:` intact. |

### Safety-critical verdicts (code-inspected + assertion-confirmed)

- **batch_modify_emails (bounded batch) — PASS.** `batchModifyMessages` (executor @867–872) runs the empty-array and `> 1000` guards as its **first two statements**, before `resolveLabelNames` and before any `fetch`. Empty → throws `message_ids must be a non-empty array`; 1001 → throws `too_many_ids`. Both the `[invalid]` (empty) and S4(b) (1001) tests assert an error result **with `getAllFetchCalls().length === 0`** — zero network calls confirmed. The forwarded body is `ids: messageIds` (@903) — the exact input array, never widened; S4(a) asserts `['m1','m2','m3']` byte-equal. **VERDICT: PASS.**
- **delete_label (destructive guard + 204 + 404) — PASS.** `SYSTEM_LABELS.has(labelId.toUpperCase())` guard (@668–670) throws before the DELETE; `[invalid]` (INBOX) and S3(b) (SENT) assert 0 fetches. Success path (@699–705) builds the result from inputs and **never calls `.json()`** (204). 404 (@683–691) returns `deleted:true, already_absent:true` — not thrown; S3(a) asserts success. **VERDICT: PASS.**
- **reply_to_email (threads, not new message) — PASS.** POST body is `{ raw, threadId }` (@797); `In-Reply-To`/`References` injected via the `buildEmailMessage` `extraHeaders` arg before the `MIME-Version` line (@782–788, @1010–1016). S2 decodes the sent raw and asserts `threadId === 'thread-1'` plus both threading headers. The **CR-3 regression** proves `send_email`'s raw has **no** threading headers (single-arg call site @99 unchanged; `extraHeaders` gated behind `if (extraHeaders)`), so the bug-hardened send path did not regress. **VERDICT: PASS.**
- **get_or_create_label (no create when exists) — PASS.** On a case-insensitive name match `getOrCreateLabel` returns early (@606–614) with `created:false` and never reaches `createLabel`. S1 asserts exactly 1 fetch, method GET, no POST. **VERDICT: PASS.**

### 204-No-Content verification — PASS

`delete_label` (@699–705) and `batch_modify_emails` (@915–922) construct their success payloads from request inputs and status and **do not call `response.json()`** on the 204 path (confirmed by full-method read). The JSON-bodied actions (`reply_to_email` @806, `send_draft` @845) correctly still call `.json()`. The `[happy]` tests for both 204 actions use `mockFetchSuccess({}, 204)` and pass — a `.json()` on an empty body would have thrown.

### Issues Found

#### Bugs (must fix before commit)
**None.**

#### Performance Issues
**None** relevant to this slice. (Test-harness open-handle hang noted above is a harness nicety, not a product issue.)

#### Edge Cases (nice to fix — already logged by SA, not re-reported as new)
- NTH-1 (Low) — `reply_to_email` explicit-empty `recipients: { to: [] }` skips the sender fallback (empty array is truthy). Known/documented v1 gap; unlikely from the LLM. Not tested (out of LEAN scope), not blocking.
- NTH-2 (Low) — 2 pre-existing `console.*` DEBUG lines in `app/test-plugins-v2/page.tsx` (dev-only client harness). Known, precedent-covered, not a condition of this slice.
- task_2ea2e007 — `rules.limits`/`rules.confirmations` inert (advisory); real enforcement is the in-executor guards, which are tested (S3/S4). Known-deferred, not re-flagged.

### LEAN policy adherence
No tests added beyond policy. Coverage is exactly 18 LEAN (3/action) + 4 safety (S1–S4) + 1 CR-3 regression = 23 new, matching the workplan and SA rulings. No genuine coverage gap uncovered that would justify additions.

### Final Status
- [x] **All acceptance criteria pass — ready for commit.** 48/48 unit tests green (actual run on record); all four safety-critical behaviors confirmed at source and by assertion; 204 handling correct; no bugs found. **QA sign-off: PASS.**
- Integration suite remains credential-gated (skipped, by design) — recommend a live lifecycle run with `GOOGLE_MAIL_TEST_TOKEN` before/at production rollout, but it is not a commit gate for this slice.

---

## Commit Info

| Field | Value |
|-------|-------|
| Branch | `feature/google-suite-phase1-actions` |
| Commit | `50cb848` — `feat(plugins): add Phase 1 Gmail label & messaging actions` |
| Date | 2026-07-27 |
| Files | 10 (definition JSON, executor, V6 input-type-compat, unit + integration tests, plugin doc, test-page, this workplan, + Sheets/Docs workplan Commit-Info bookkeeping) |
| Tests | 48/48 unit tests passing |
| Pushed | No — local commit only, pending PR |
| Gates | SA workplan-review ✅ · SA code-review ✅ · QA PASS ✅ · user-approved ✅ |
| Follow-up | batch/confirm rules advisory (inert `extractRuleContext` gap, task_2ea2e007); enforcement is in-executor |

---

## SA Code Review

**Code Review by SA — 2026-07-27**
**Status:** ✅ **Code Approved** — no blocking (must-fix) items. Two nice-to-haves noted below for Dev's discretion / Phase 2. Cleared for QA.

Reviewed the Gmail slice only (`git diff` scoped): `lib/plugins/definitions/google-mail-plugin-v2.json`, `lib/server/gmail-plugin-executor.ts`, `lib/agentkit/v6/capability-binding/input-type-compat.ts`, both Gmail test files, `docs/plugins/google-mail-plugin.md`, `app/test-plugins-v2/page.tsx`. Pre-existing unrelated working-tree edits (`GOOGLE_DOCS_*`, `GOOGLE_SHEETS_*` workplans, `.claude/settings*`) were ignored per scope.

### Three load-bearing confirmations (explicitly verified)

**(a) `buildEmailMessage` change did NOT regress the existing send path — CONFIRMED.**
The new signature is `buildEmailMessage(parameters: any, extraHeaders?: Record<string, string>)`. `extraHeaders` is optional and applied only inside an `if (extraHeaders)` block, each value additionally gated on `typeof value === 'string' && value.length > 0`. Both existing call sites are byte-for-byte single-arg (`sendEmail` @99, `createDraft` @257 — grep-confirmed). The extra headers are emitted **before** the `MIME-Version` line, alongside the other top-level headers. Critically, values pass through `mimeEncodeHeader`, which **returns pure-ASCII values unchanged** (`if (!/[^\x00-\x7F]/.test(value)) return value;` @935) — so ASCII Message-IDs are not corrupted into `=?UTF-8?B?…?=`. CR-3 regression test decodes `send_email`'s `raw` and asserts it contains neither `In-Reply-To` nor `References` while retaining `To:`/`Subject:`. The send path is intact.

**(b) `batch_modify_emails` >1000 / empty guard is airtight pre-fetch — CONFIRMED.**
`batchModifyMessages` runs both guards as its **first statements**, before `resolveLabelNames` and before any `fetch`: `!Array.isArray(messageIds) || messageIds.length === 0` throws `message_ids must be a non-empty array`; `messageIds.length > 1000` throws `too_many_ids`. No network call precedes them. S4 test asserts (a) the exact bounded id set `['m1','m2','m3']` is forwarded unwidened and (b) 1001 ids → error result with `getAllFetchCalls()` length 0; the `[invalid]` empty-array test likewise asserts zero fetches. The in-executor guard is the real enforcement (rules.limits is inert per task_2ea2e007 — the `max_ids` rule remains present but documentary, correct per CR-5b).

**(c) `reply_to_email` actually threads — CONFIRMED.**
`replyToThread` fetches the original via `?format=metadata`, resolves `threadId` + `Message-ID`/`References`/`Subject`, builds the reply with `In-Reply-To: <origId>` and `References: <existingRefs> <origId>` (correct concatenation; falls back to just origId when no prior References), dedupes `Re:` via `/^re:/i`, and POSTs `{ raw, threadId }` to `/messages/send` — so the reply **continues** the thread rather than starting a new one. S2 test decodes the sent `raw` and asserts both `threadId === 'thread-1'` and the presence of `In-Reply-To`/`References` pointing at the original. Threading is correct.

### Per-area verdict

| Area | Verdict | Notes |
|------|---------|-------|
| `buildEmailMessage` extension (WP-8/WP-42/D12 history) | ✅ | Additive, default-safe, ASCII-safe via `mimeEncodeHeader`; CR-3 guard present and correct. No regression. |
| `reply_to_email` threading | ✅ | In-Reply-To/References before MIME-Version; `{raw, threadId}` posted; References concat + Re: dedupe reasonable. reply_all self-exclusion is a **documented v1 gap** (noted in schema + JSDoc) — acceptable, not a blocker. |
| `batch_modify_emails` cap (safety) | ✅ | Empty + >1000 hard-rejected pre-fetch (CR-4); archive→remove INBOX (parity with modify_email); bounded id set forwarded. S4 asserts pre-fetch reject (0 fetches) + bounded set. |
| `delete_label` (safety) | ✅ | `SYSTEM_LABELS` rejected pre-fetch (CR-4, uppercased .has check); 204 handled without `.json()`; 404→already_absent success. S3 covers both branches. |
| `get_or_create_label` (CR-1) | ✅ | **No** label_list_visibility/message_list_visibility params; `createLabel` left 2-arg/untouched; reuses 409-safe path. S1 asserts no POST on the find path. |
| 204-No-Content handling | ✅ | `delete_label` + `batch_modify_emails` never call `.json()` on success; `reply_to_email`/`send_draft` (JSON bodies) do. Correct. |
| CR-2 long-form keys | ✅ | `reply_to_email` / `batch_modify_emails` canonical everywhere — definition keys, switch cases, test tables, sample templates, docs. No abbreviated aliases remain. |
| CR-5 dropdown + rule inertness | ✅ | `delete_label.label_id` uses `x-dynamic-options { source: 'list_labels', description }` — exact shape/attribute matches the established convention (9 definitions; e.g. google-drive `list_files`). `message_ids_count` rule left present but documentary; guard is the enforcement. |
| Schema / standards | ✅ | Full metadata block per action (domain/capability/entities/cardinality/output_fields/must_support); `x-guaranteed` on deterministic output leaves; `output_guidance` + `common_errors`; version → `1.2.0`. TS strict — `any` on `parameters`/`connection` matches the existing `executeSpecificAction` signature (no new implicit any). No hardcoded plugin-specific rules added to prompts/compiler. |
| V6 `input-type-compat.ts` | ✅ | `gmail_label` added to `TO_TYPE_EXTRAS` only (output-leaf). No `TYPE_COMPAT` edges, no `FROM_TYPE` change — zero new input-binding surface, no perturbation of existing type behavior. Minimal and correct per OQ7. Consistent with the `x-semantic-type: gmail_label` tag on `list_labels` output items. |
| LEAN tests | ✅ | 18 unit (3/action: happy + 401 + invalid) + S1–S4 safety + CR-3 regression = matches policy. Integration adds a self-cleaning label lifecycle + send_draft + archive-restore. Meets happy + auth + invalid per action. The `list_labels [invalid]` test relies on the base-class `applyParamConstraintGuard` enum-clamp (verified to exist in `base-plugin-executor.ts`) — grounded, not assumed. |
| `console.*` compliance | ✅ (with note) | 0 `console.*` in the executor and V6 file (grep-confirmed); none added. The only `console.*` in the touched set is 2 pre-existing DEBUG lines in `app/test-plugins-v2/page.tsx` @1046/@1048 — **outside** the Dev's diff hunk (which only adds `PARAMETER_TEMPLATES` entries) and already dispositioned in the workplan review as the precedent-covered dev-only client test page. See NTH-2. |

### Must-fix (blocking)
**None.**

### Nice-to-have (non-blocking — Dev discretion / Phase 2)
1. **NTH-1 — `reply_to_email` explicit-empty recipients edge case (Low).** The fallback trigger is `!recipients || (!recipients.to && !recipients.cc && !recipients.bcc)`. Because a non-empty check isn't used, an explicit `recipients: { to: [] }` (empty array is truthy) skips the "reply to original sender" fallback and would build an empty `To` → Gmail 400. Unlikely from the LLM (it omits `recipients` to get the default), but a `.length`-aware guard would be more robust. Also worth flagging: `batch_modify_emails`/`resolveLabelNames` will **create** a non-existent custom name passed in `remove_labels` just to remove it — a pre-existing `resolveLabelNames` wart shared with `modify_email`, so consistent, but wasteful. Neither blocks.
2. **NTH-2 — pre-existing `console.*` in the touched test page (Low).** Per CLAUDE.md §Logging, touching `app/test-plugins-v2/page.tsx` technically brings its 2 pre-existing `console.log` DEBUG lines into scope. They sit far outside the Dev's diff hunk, the file is a dev-only client test harness (where server-side Pino `createLogger` isn't the pattern), and the workplan review already dispositioned this. Recorded for eventual cleanup; not a condition of approval and not to be bundled into this slice.

### Optimisation Suggestions
- `fetchLabels` is now a shared helper (get_or_create + list_labels); `resolveLabelNames` @475 still has its own inline `GET /labels` fetch. A future refactor could route it through `fetchLabels` for a single label-fetch code path. Purely cosmetic — out of scope here.

### Verification note (honest)
Static review is conclusive on all checklist items and the three load-bearing claims. I attempted to run the Gmail Jest suite for a green confirmation, but Jest is prohibitively slow in this environment (runs exceeded the tool timeout / were killed before emitting a summary). Test **assertions** were read and verified correct by inspection; **QA must execute** the unit + integration suites and confirm green before sign-off.

### Code Approved for QA: **Yes**

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-27 | QA test pass | QA appended `## QA Testing Report`: **PASS — ready for commit.** Executed the scoped unit suite for a real green run: **48 passed / 48 total, 1 suite passed** (actual test time 3.666s). The shell wall-clock limit was a **post-run Jest open-handle hang** ("Jest did not exit after the test run has completed"), not a test failure — the summary reports 0 failures. All 4 safety-critical behaviors confirmed at source + by assertion: (S4) `batch_modify_emails` empty/>1000 rejected as the first statements pre-fetch (0 network calls), bounded `ids` forwarded unwidened; (S3) `delete_label` SYSTEM_LABELS rejected pre-fetch, 204 handled without `.json()`, 404→already_absent success not thrown; (S2) `reply_to_email` posts `{raw, threadId}` with In-Reply-To/References (threads, not new), CR-3 proves send_email raw carries no threading headers; (S1) `get_or_create_label` no POST on match (GET-only). 204-No-Content verified for both delete_label + batch_modify_emails. **No bugs found.** NTH-1/NTH-2 + inert rules.limits (task_2ea2e007) acknowledged as known/non-blocking, not re-reported. Integration suite credential-gated (skipped by design). |
| 2026-07-27 | SA code review | SA appended `## SA Code Review`: **Code Approved — no must-fix**, cleared for QA. Verified the three load-bearing claims: (a) `buildEmailMessage` `extraHeaders` is additive/ASCII-safe (`mimeEncodeHeader` passes ASCII through) — existing `send_email`/`create_draft` paths unchanged, CR-3 guard present; (b) `batch_modify_emails` empty/>1000 guards are airtight pre-fetch (0 network calls, S4); (c) `reply_to_email` posts `{raw, threadId}` with In-Reply-To/References so it continues the thread (S2). CR-1…CR-5 all satisfied (no visibility params, long-form keys, CR-3 regression, in-executor hard guards, `x-dynamic-options` matches convention). V6 `gmail_label` is ToType-only with no TYPE_COMPAT edges. 0 `console.*` added. Two Low nice-to-haves (explicit-empty recipients edge; pre-existing test-page `console.*`) — non-blocking. Could not get a green Jest run (env too slow) — QA to execute suites. |
| 2026-07-26 | SA workplan review | SA appended `## SA Workplan Review`: **Approved for implementation** with CR-1…CR-5 folded in (no re-review). Resolved all 7 OQs — action names to requirement's `reply_to_email`/`batch_modify_emails` (OQ1); `listAllLabels` private method, fetcher untouched (OQ2); **extend `buildEmailMessage` with additive `extraHeaders` arg + mandatory sendEmail-unaffected regression assertion** (OQ3); confirmation posture ratified as advisory (OQ4); reconcile JSON+doc to `1.2.0`, document all 11 actions (OQ5); **batch cap = 1000, hard in-executor reject** since rules.limits inert per task_2ea2e007 (OQ6); annotate `gmail_label`, register only if validator demands, output-leaf only (OQ7). **CR-1 (correctness): drop `get_or_create_label` visibility params — they contradict the 2-arg hardcoded `createLabel` signature.** Confirmed 0 `console.*` in executor and 204/.json() gap. No user decision needed before Dev starts. |
| 2026-07-26 | Initial workplan | Dev drafted Phase 1 Gmail slice: 6 actions (`get_or_create_label`, `list_labels`, `delete_label`, `reply`/`reply_to_email`, `send_draft`, `batch_modify`/`batch_modify_emails`). Per-action schemas + Google API mappings + idempotency/confirmation/204-body semantics, helper reuse (`createLabel`/`resolveLabelNames`/`buildEmailMessage`), LEAN 3-per-action test plan (18) + 4 safety assertions, standards flags (**0 `console.*` in the executor — no conversion needed**; no new scope; `list_labels` method-name collision; `buildEmailMessage` extension; plugin-doc + version reconciliation), 7 open questions for SA. Workplan only — no implementation code. |
