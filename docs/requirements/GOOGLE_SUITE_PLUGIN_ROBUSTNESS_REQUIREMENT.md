# Requirement: Google Suite Plugin Robustness & Capability Expansion

> **Last Updated**: 2026-07-22

**Created by:** BA
**Date:** 2026-07-22
**Status:** ✅ Approved (BA drafted · SA reviewed · user ratified all decisions 2026-07-26) — Phase 1 ready for Dev workplan

## Overview

AgentPilot's five Google Suite plugins (Calendar, Gmail, Drive, Sheets, Docs) currently cover the common "read / create / append" primitives an agent needs, but they stop short of the richer, stateful operations that an **AI Business OS** promises its users — e.g. "let people book time with me," "auto-sort my inbox," or "produce a formatted report, not a wall of plain text." This requirement inventories what the plugins expose today, grounds a gap analysis in what the underlying Google APIs actually support, and recommends a prioritized set of new plugin actions to close three concrete capability goals plus a shortlist of high-value additions. It stays at the capability/requirement level — implementation architecture is deferred to the System Architect (SA).

## Table of Contents

1. [Goals](#goals)
2. [Current-State Inventory](#current-state-inventory)
3. [Google API Capability Findings](#google-api-capability-findings)
4. [Gap Analysis — The Three Goals](#gap-analysis--the-three-goals)
5. [Additional Recommended Capabilities for the AI Business OS](#additional-recommended-capabilities-for-the-ai-business-os)
6. [Non-Functional Requirements](#non-functional-requirements)
7. [Acceptance Criteria](#acceptance-criteria)
8. [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
9. [Open Questions / Decisions for SA](#open-questions--decisions-for-sa)
10. [Notes on Integration Points](#notes-on-integration-points)
11. [Change History](#change-history)

---

## Goals

1. **Calendar-as-Calendly** — use Google Calendar to manage availability: define availability windows, expose bookable slots, and auto-create events on booking.
2. **Gmail rules/automation** — let an agent set standing automation rules on email (filter → label / archive / forward / mark).
3. **Drive / Sheets / Docs richer capabilities** — the structural and formatting operations a user expects from an office suite (e.g. bold header rows, frozen headers, tables, headings, move/rename/delete files).

**User stories**

- As an SMB owner, I want people to book time on my calendar without back-and-forth email, so that scheduling runs itself.
- As a busy professional, I want an agent to auto-file and label incoming email by rules I describe once, so that my inbox stays organized without manual triage.
- As a report author, I want agent-generated spreadsheets and docs to look presentable (formatted headers, tables, headings), so that I can share them without hand-cleanup.
- As an operations user, I want an agent to move, rename, and archive Drive files, so that document workflows complete end-to-end instead of leaving orphaned files.

---

## Current-State Inventory

Source of truth: the V2 definition JSON files under `lib/plugins/definitions/` and their executors under `lib/server/`. Every action listed below is **both defined and implemented** (executor switch statements were confirmed for Sheets; others match their definitions 1:1).

### Google Calendar — `google-calendar-plugin-v2.json` (5 actions)

| Action | Capability | Notes / notable params |
|--------|-----------|------------------------|
| `list_events` | list | time range, `single_events` expansion, `order_by`, max 2,500 |
| `create_event` | create | attendees, reminders, `send_notifications`, `conference_solution` (Google Meet link) |
| `update_event` | update | partial update, attendee management, notification control |
| `delete_event` | delete | notification control |
| `get_event_details` | get | full attendee + organizer + conference detail |

**Scopes:** `calendar`, `calendar.events`. No freebusy, no availability/slot concept, no secondary-calendar management, no recurring-rule editing surfaced as a first-class param.

### Gmail — `google-mail-plugin-v2.json` (5 actions)

| Action | Capability | Notes / notable params |
|--------|-----------|------------------------|
| `send_email` | send_message | to/cc/bcc, html body, read receipt, ≤50 recipients |
| `search_emails` | search | Gmail operators, `content_level` (metadata/snippet/full), folder scope, attachment metadata |
| `create_draft` | create_draft | to/cc/bcc, html body |
| `get_email_attachment` | download | base64 + text extraction, ≤25 MB |
| `modify_email` | modify | add/remove labels, mark important/read (single message) |

**Scopes:** `gmail.readonly`, `gmail.send`, `gmail.modify`. **No** filters/rules, **no** label CRUD (only apply/remove existing), **no** reply-in-thread send, **no** send-existing-draft, **no** trash/delete, **no** batch modify.

### Google Drive — `google-drive-plugin-v2.json` (10 actions)

| Action | Capability | Notes / notable params |
|--------|-----------|------------------------|
| `list_files` | list | folder scope, type filter, order_by |
| `search_files` | search | Drive query syntax, scope, type filter |
| `get_file_metadata` | get | optional permissions + export links |
| `read_file_content` | fetch_content | text export of Workspace files |
| `download_file` | fetch_content | raw bytes base64 (for extraction) |
| `get_folder_contents` | list | recursive listing |
| `upload_file` | upload | to folder, mime type |
| `create_folder` | create | nested |
| `get_or_create_folder` | upsert | idempotent |
| `share_file` | update | permission type/role, email sharing |

**Scopes:** `drive`, `drive.file`. **No** move, **no** rename/update-metadata, **no** copy, **no** delete/trash, **no** revoke-share.

### Google Sheets — `google-sheets-plugin-v2.json` (7 actions)

| Action | Capability | Notes / notable params |
|--------|-----------|------------------------|
| `read_range` | get | A1 range, formula values, major dimension |
| `write_range` | update | overwrite, RAW/USER_ENTERED |
| `append_rows` | append | insert vs overwrite |
| `create_spreadsheet` | create | multi-sheet, initial data |
| `get_or_create_spreadsheet` | upsert | idempotent |
| `get_spreadsheet_info` | get | sheet list + metadata |
| `get_or_create_sheet_tab` | upsert | idempotent tab |

**Scopes:** `spreadsheets`, `drive`. **All value-level only** — confirmed in `google-sheets-plugin-executor.ts`, there is **no** `batchUpdate` / formatting / frozen rows / conditional formatting / charts / clear / delete-rows / sort-filter path.

### Google Docs — `google-docs-plugin-v2.json` (5 actions)

| Action | Capability | Notes / notable params |
|--------|-----------|------------------------|
| `read_document` | fetch_content | plain text or structured, formatting flag |
| `insert_text` | update | insert at index (plain text) |
| `append_text` | append | plain text, optional line break |
| `create_document` | create | title + initial plain content |
| `get_document_info` | get | char/paragraph count, end index |

**Scopes:** `documents`, `drive`. **Plain-text only** — no styled text, headings/named styles, tables, images, or find-and-replace.

---

## Google API Capability Findings

Grounding the gap analysis in what each Google API actually supports so recommendations are feasible.

| Google API surface | What it supports | Feasibility signal for us |
|--------------------|------------------|---------------------------|
| **Calendar `freebusy.query`** | POST returns **busy intervals only** (start/end), up to 50 calendars, privacy-safe. Does **not** return ready-made free slots — the app must compute the complement and rank candidate windows. | Buildable. New read action + slot-computation logic (deterministic transform). |
| **Calendar Appointment Schedules** ("booking pages" in the Calendar UI) | This is a **Google Calendar UI feature, not a public REST resource** — there is no supported API to create/read appointment schedules. | Not directly addressable. Calendly-style must be assembled from `freebusy` + `create_event` on top of our own booking surface. Flag to SA. |
| **Gmail `settings.filters`** | Create/list/get/delete filters. Criteria: from, to, subject, size, has-words, query (full Gmail search syntax). Actions: add/remove labels, mark read/important/star, **archive** (remove INBOX label), **forward to a verified address**, delete. | Buildable. Forwarding requires the target already be a verified forwarding address (else creation fails). |
| **Gmail `labels`** | Full CRUD on user labels (create/list/update/delete), colors, visibility. | Buildable. Fills the "create the label a filter/modify targets" gap. |
| **Gmail `messages.batchModify` / threads / drafts.send** | Batch label changes across many messages; reply within a thread; send a previously created draft. | Buildable; low complexity. |
| **Sheets `spreadsheets.batchUpdate`** | `repeatCell` (bold/background/font/alignment on a range), `updateSheetProperties` (frozen rows/cols), `AddConditionalFormatRuleRequest`, banding, column auto-resize, sort, basic filter, `deleteDimension`, `DeleteRangeRequest` (clear). One batched call. | Buildable. A single new "format" action can cover the high-value 80% (header styling + freeze). |
| **Docs `documents.batchUpdate`** | `insertTable`, `updateParagraphStyle` (`namedStyleType` = HEADING_1/TITLE…), `updateTextStyle` (bold/italic/font/size/color), `replaceAllText`, insert images/page breaks. Structural rules constrain valid edits. | Buildable. Requires index math already partly handled (`get_document_info` returns `end_index`). |
| **Drive `files.update`** | Move (`addParents`/`removeParents`), rename (name), trash/delete, copy. `permissions.delete` revokes sharing. | Buildable; low complexity — same executor/scopes already in place. |

**Sources:** [Freebusy: query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) · [Nylas: Google Calendar free/busy](https://cli.nylas.com/guides/google-calendar-api-free-busy) · [Manage Gmail filters](https://developers.google.com/workspace/gmail/api/guides/filter_settings) · [Gmail auto-labels tutorial 2026](https://itsourcecode.com/blogs/how-to-create-filters-and-auto-labels-in-gmail-2026/) · [Sheets basic formatting](https://developers.google.com/workspace/sheets/api/samples/formatting) · [Sheets conditional formatting](https://developers.google.com/workspace/sheets/api/samples/conditional-formatting) · [Docs format text](https://developers.google.com/workspace/docs/api/how-tos/format-text) · [Docs structural edit rules](https://developers.google.com/workspace/docs/api/concepts/rules-behavior)

---

## Gap Analysis — The Three Goals

Complexity legend: 🟢 low (single new action, existing scopes/executor) · 🟡 medium (new action + non-trivial logic or new scope) · 🔴 high (multi-action + stateful surface beyond the plugin).

### Goal 1 — Calendar-as-Calendly

| Capability | Google API | Proposed plugin action(s) | Business value | Complexity |
|-----------|------------|---------------------------|----------------|-----------|
| Query when a user is busy/free | `freebusy.query` | `get_free_busy` (read: return busy intervals for one or more calendars over a window) | Foundation for any scheduling agent; privacy-safe availability lookup | 🟢 |
| Compute bookable slots from availability windows + busy blocks | freebusy + deterministic slot math (working hours, slot length, buffer) | `list_available_slots` (input: window, working hours, duration, buffer → output: ranked open slots) | The actual "here are times you can book" answer; core Calendly value | 🟡 |
| Create the event when a slot is chosen | `events.insert` (already `create_event`) | Reuse `create_event` (optionally add `guests_can_modify`/booking metadata) | Completes book → confirmed-event loop with Meet link | 🟢 (exists) |
| Prevent double-booking on concurrent bookings | conditional insert / recheck freebusy at write time | Idempotency/guard note — **SA to decide** whether handled in action or workflow | Avoids the classic race that breaks naive booking | 🟡 |

**Key limitation (must communicate):** Google's native **Appointment Schedules booking page has no public API**. AgentPilot cannot "turn on Google's Calendly." What we *can* deliver is a functionally equivalent capability assembled from `get_free_busy` + `list_available_slots` + `create_event`. The public-facing booking surface (a shareable link/page where an external person picks a slot) is a **product-level component outside the plugin layer** — flagged as an open question for SA, because it may belong to the app, not the Google plugin.

### Goal 2 — Gmail rules / automation

| Capability | Google API | Proposed plugin action(s) | Business value | Complexity |
|-----------|------------|---------------------------|----------------|-----------|
| Create a standing rule (criteria → action) | `settings.filters.create` | `create_filter` (criteria: from/to/subject/query/hasWords; actions: addLabel/removeLabel/markRead/star/important/archive/forward/delete) | The literal "set automation rules on my email" ask; runs server-side in Gmail even when AgentPilot isn't running | 🟡 |
| List / delete existing rules | `settings.filters.list` / `.delete` | `list_filters`, `delete_filter` | Let an agent review and clean up rules it created (idempotency + user trust) | 🟢 |
| Create/manage the label a rule targets | `labels.create` / `.list` / `.delete` | `manage_labels` (or `create_label` + `list_labels`) | Filters and `modify_email` both need labels to exist first; today we can only apply existing labels | 🟢 |
| Apply a rule's action to the existing backlog | `messages.batchModify` | `batch_modify_emails` (apply label/read/archive across many message IDs) | "Also apply this to the 200 emails already in my inbox," not just future mail | 🟡 |

**Note:** `forward` action in a filter only works if the destination is already a **verified forwarding address** in the account; the action must surface a clear error (mirrors existing `common_errors` style) when it isn't. Archiving = removing the `INBOX` label (already how `modify_email` models labels — consistent).

### Goal 3 — Drive / Sheets / Docs richer capabilities

| Capability | Google API | Proposed plugin action(s) | Business value | Complexity |
|-----------|------------|---------------------------|----------------|-----------|
| **Sheets:** format a header row (bold, background, freeze) | `spreadsheets.batchUpdate` (`repeatCell` + `updateSheetProperties`) | `format_cells` (range → bold/background/font/alignment; freeze rows/cols) | Reports look presentable; the #1 "make it not look like raw data" ask | 🟡 |
| **Sheets:** conditional formatting / banding | `AddConditionalFormatRuleRequest`, banding | Fold into `format_cells` or `add_conditional_format` | Highlights (overdue, over-budget) auto-applied — high perceived intelligence | 🟡 |
| **Sheets:** clear a range / delete rows | `DeleteRangeRequest` / `deleteDimension` | `clear_range`, `delete_rows` | Enables true "refresh this report" and dedupe workflows | 🟢 |
| **Sheets:** sort / basic filter | `SortRangeRequest` / `SetBasicFilterRequest` | `sort_range` (nice-to-have) | Ordered outputs without a downstream transform | 🟡 |
| **Docs:** apply headings / styled text | `documents.batchUpdate` (`updateParagraphStyle`, `updateTextStyle`) | `format_document_text` (range/paragraph → named style, bold/italic/size/color) | Structured reports (headings, emphasis) instead of a plain-text blob | 🟡 |
| **Docs:** insert a table | `insertTable` | `insert_table` | Tabular summaries in generated docs (agendas, comparisons) | 🟡 |
| **Docs:** find-and-replace | `replaceAllText` | `replace_text` | Template-fill workflows ("Dear {name}") — a very common SMB pattern | 🟢 |
| **Drive:** move / rename file | `files.update` (`addParents`/`removeParents`, name) | `move_file`, `rename_file` (or one `update_file_metadata`) | Completes filing workflows end-to-end (today files land but can't be organized) | 🟢 |
| **Drive:** copy file | `files.copy` | `copy_file` | Template duplication ("new client folder from template") | 🟢 |
| **Drive:** delete / trash file | `files.update` (trashed) / `files.delete` | `delete_file` (trash-by-default, guarded confirmation) | Cleanup workflows; currently impossible to remove anything | 🟢 |
| **Drive:** revoke sharing | `permissions.delete` | `revoke_access` | Security hygiene — the inverse of `share_file` we already ship | 🟢 |

---

## Additional Recommended Capabilities for the AI Business OS

Beyond the three goals, prioritized. Each is grounded in an existing Google API surface.

### Must-have

| Capability | Plugin | Justification (one line) |
|-----------|--------|--------------------------|
| `manage_labels` (label CRUD) | Gmail | Every labeling/filtering workflow silently depends on labels existing first. |
| `move_file` / `rename_file` | Drive | "Filing" is the most common office task and today ends with an orphaned upload. |
| `format_cells` (header + freeze) | Sheets | Turns raw data dumps into shareable reports — direct differentiator for "AI Business OS." |
| `replace_text` | Docs | Unlocks template-driven document generation (contracts, letters, proposals). |
| `get_free_busy` | Calendar | Foundational availability primitive reused by scheduling, meeting-finder, and reminder agents. |

### Nice-to-have

| Capability | Plugin | Justification (one line) |
|-----------|--------|--------------------------|
| `reply_to_email` (send in-thread) | Gmail | Agents can maintain a conversation thread, not just fire standalone emails. |
| `send_draft` | Gmail | Human-in-the-loop: agent drafts, user reviews, agent sends the approved draft. |
| `batch_modify_emails` | Gmail | Apply organization retroactively to an existing inbox, not just new mail. |
| `insert_table` / `format_document_text` | Docs | Richer generated documents (agendas, structured reports). |
| `add_conditional_format` | Sheets | Auto-highlighting (overdue/over-budget) reads as "intelligent" output. |
| `copy_file` | Drive | Template duplication for repeatable client/project setups. |
| `list_calendars` surfaced as an action | Calendar | Multi-calendar users (work/personal/team) can target the right calendar. |

### Lower priority / watch

| Capability | Plugin | Justification |
|-----------|--------|---------------|
| Push notifications / watch channels | Gmail, Calendar, Drive | Event-driven triggers ("when an email arrives…") — powerful but needs a webhook/trigger architecture that spans beyond the plugin layer. **SA to decide** if in scope for the OS trigger roadmap. |
| Slides plugin | (new) | Rounds out the office suite; no current plugin. Separate requirement. |

---

## Non-Functional Requirements

- **Security:** New write/destructive actions (delete file, delete filter, revoke access) must honor the existing confirmation-rule pattern (`rules.confirmations`) and never bypass user consent. No scope expansion beyond what each action needs — **SA to confirm** whether Gmail `settings.filters` requires an additional scope (`gmail.settings.basic`) and Drive delete requires full `drive` scope (already granted).
- **Platform principle:** No plugin-specific hardcoding leaks into V6 system prompts or the compiler — new actions are described via schema/`usage_context` only (per CLAUDE.md Platform Design Principles).
- **Idempotency:** Prefer `find_or_create` / upsert shapes where a recurring workflow could otherwise duplicate (e.g. `create_filter` should be safe to re-run — check-before-create). Consistent with existing `get_or_create_*` actions.
- **Consistency:** New actions reuse the established definition shape (`output_schema`, `output_guidance.common_errors`, `x-guaranteed` fields, `output_dependencies`).
- **Accessibility / UX:** N/A at the plugin layer; any booking-page product surface (Goal 1) carries standard app a11y requirements — out of scope here.

## Acceptance Criteria

- [ ] Current-state inventory reviewed and confirmed accurate against the definition JSON by SA/Dev.
- [ ] Goal 1: an agent can return a user's busy intervals and a list of bookable slots, and create an event on a chosen slot.
- [ ] Goal 2: an agent can create a Gmail filter (criteria → label/archive/forward) and create the target label if missing.
- [ ] Goal 3: an agent can produce a Sheet with a bold, frozen header row and a Doc with headings/replaced template text; and can move/rename/delete a Drive file.
- [ ] Each new action ships with the standard `output_schema` + `common_errors` + at least happy-path and one failure-path test (per project testing policy).
- [ ] No new plugin-specific rules added to V6 prompts/compiler.

## Out of Scope / Future Roadmap

- A public-facing booking page/link (the external-visitor side of Calendly). Belongs to the product/app layer, not the Google plugin — separate requirement.
- Event-driven triggers / push notifications (Gmail/Calendar/Drive watch channels).
- A new Google Slides plugin.
- Advanced Sheets objects (pivot tables, charts as images, data validation rules) beyond formatting.

## Open Questions / Decisions for SA

- [ ] **Booking surface ownership** (Goal 1): does the external-visitor booking page belong to the app product layer or should the plugin expose only the availability + create primitives? (raised by: BA | suggested resolution: plugin ships `get_free_busy` + `list_available_slots` + reuses `create_event`; the shareable booking page is a separate product component. | status: pending SA)
- [ ] **Double-booking guard** (Goal 1): handle the concurrent-booking race inside `create_event`/a booking action, or at the workflow layer? (raised by: BA | suggested resolution: re-check freebusy immediately before insert within the booking action; SA to confirm placement. | status: pending SA)
- [ ] **Scope changes**: Gmail filters likely need `gmail.settings.basic`; confirm no re-consent friction and whether to bundle into the existing Gmail connection or a capability-gated re-auth. (raised by: BA | suggested resolution: add scope, prompt incremental re-auth only when a filter action is first used. | status: pending SA)
- [ ] **Action granularity**: one composite `format_cells` / `update_file_metadata` action vs. several narrow actions (`freeze_rows`, `move_file`, `rename_file`). (raised by: BA | suggested resolution: prefer one composite action per capability cluster to keep the action catalog small for the LLM, unless SA sees a grounding/selection risk. | status: pending SA)
- [ ] **Docs index math**: `insert_text`/formatting rely on character indices; confirm the executor reliably resolves current end index to avoid off-by-one structural errors. (raised by: BA | status: pending SA/Dev)

## Notes on Integration Points

- **Definitions:** `lib/plugins/definitions/google-{calendar,mail,drive,sheets,docs}-plugin-v2.json`
- **Executors:** `lib/server/google-{calendar,mail,drive,sheets,docs}-plugin-executor.ts` (all extend `google-base-plugin-executor.ts`)
- **Registry / manager:** `lib/server/plugin-executer-v2.ts`, `lib/server/plugin-manager-v2.ts`
- **UI metadata:** `lib/plugins/pluginList.tsx`
- **Connections:** `plugin_connections` table (per-user OAuth); any new scope requires re-consent flow via `oauth/callback/google-*`.
- **V6 pipeline:** new actions are auto-discovered by CapabilityBinder from the definition JSON — no compiler changes expected if actions follow the standard shape. Confirm with SA before adding any new `must_support` semantics.
- **Docs to update on delivery:** `docs/plugins/google-*-plugin.md` version-history + action tables.

---

## SA Architectural Review

**Reviewed by SA — 2026-07-26**
**Status:** ✅ Approved to proceed (Phase 1 unblocked; Phase 2 has one ops decision for the user; Phase 3 is a separate requirement)

This is a requirement review, not a workplan review. The requirement is architecturally sound and the API grounding is accurate. The single most important finding is that the requirement **overstates OAuth scope risk**: only ONE new scope is required across all proposed actions. That de-risks the bulk of the work to zero-re-consent, additive changes. Details below.

### Grounding — how new actions wire into the platform (confirmed against code)

| Concern | Confirmed mechanism | Implication for these actions |
|---|---|---|
| Executor contract | `BasePluginExecutor.executeSpecificAction(connection, actionName, parameters)` switch; auth via `connection.access_token`; `handleApiResponse` for HTTP; Pino `this.logger` provided by base | Every new action = one `case` + one private method + one definition entry. No architecture change needed for any proposed action. |
| Scope declaration | `auth_config.required_scopes[]` in each `*-plugin-v2.json`. Google connections are **per-service** (each Google plugin = its own `plugin_connections` row + token + stored `scope`). | Adding a scope to Gmail affects only the Gmail connection — never Drive/Calendar/etc. Scope drift is detectable: `scope` is persisted on the connection (`user-plugin-connections.ts`). |
| Confirmation gating | `rules.confirmations` is **declarative/advisory** — the base executor logs "would be handled via UI" and does **not** hard-block. | Destructive actions must BOTH declare a confirmation rule AND default to non-destructive behavior (trash, not hard-delete) — the executor will not stop a destructive call on its own. |
| Idempotency convention | `get_or_create_*` naming + `idempotent` flag + `idempotent_alternative` already used (Drive/Sheets). | New "ensure exists" actions must follow this naming, not a composite mutate action. |
| V6 discovery | CapabilityBinder auto-discovers actions from the definition JSON; no compiler change if the standard shape is followed. | Requires `domain`/`capability`/`input_entity`/`output_entity`/cardinality + `x-semantic-type` on typed output items + `output_dependencies` where a param gates output richness. |

### Resolutions to the 5 Open Questions

**OQ1 — Booking surface ownership → RATIFIED with one amendment.**
- Availability **primitives belong in the plugin layer**: `get_free_busy` (thin `freebusy.query` wrapper) and `list_available_slots`.
- **Amendment:** `list_available_slots` is NOT "freebusy + a downstream `transform` step." Make it **one self-contained plugin action** that internally calls freebusy and performs deterministic slot math (working-hours, slot length, buffer) in the executor (TypeScript, fully unit-testable). Rationale: exposing raw freebusy and asking the V6 compiler/LLM to assemble slot math in a generic `transform` step is exactly the semantic-determinism anti-pattern we reject — it forces the compiler to interpret NL. A single typed capability ("give me bookable slots") binds deterministically. `get_free_busy` stays separately exposed as the lower primitive.
- The **public booking page/endpoint** (external visitor picks a slot) belongs in **neither the plugin layer nor the Pilot engine** — it is a **new app surface** (unauthenticated public route + public API), with its own auth model (visitor is anonymous; owner's stored OAuth used server-side), rate-limiting, abuse protection, and DB state. It must **reuse** the plugin actions server-side, not reimplement Google calls. Confirmed **out of scope for this requirement → Phase 3, separate BA/SA cycle.**

**OQ2 — Double-booking guard → AMENDED.**
- Google Calendar has **no conditional-insert / compare-and-swap**. A re-check-freebusy-immediately-before-`events.insert` inside the booking action **narrows but cannot eliminate** the TOCTOU race.
- Decision: implement the in-action recheck as **best-effort defense-in-depth** (ratify BA's placement) and surface a clean `slot_taken` error so the caller can offer the next slot — but state explicitly that **`create_event` alone does not solve double-booking.**
- The **authoritative** guarantee requires a short-lived reservation record with a **DB unique constraint** on `(owner, slot_start)` + TTL, which is stateful and belongs to the **booking-surface app layer (Phase 3)**, via a repository (`lib/repositories/`) with `user_id` scoping. Do not let Dev claim the race is closed in the plugin. For agent-only (no public page) low-concurrency flows, the in-action recheck is an acceptable pragmatic guard.

**OQ3 — Scope changes / re-consent → RATIFIED, and requirement corrected.**
- **Only `https://www.googleapis.com/auth/gmail.settings.basic` (Gmail filters cluster) is a genuinely new scope.** Everything else fits already-granted scopes (see feasibility table). The requirement's NFR/OQ3 over-scoped this.
- Strategy: declare the new scope in `google-mail-plugin-v2.json`; new users get it on first connect. For already-connected Gmail users, detect scope drift lazily — when a filter action runs and `connection.scope` lacks `gmail.settings.basic`, return an actionable `scope_upgrade_required` error the UI renders as "Reconnect Gmail to enable email rules." The re-auth **must** use `include_granted_scopes=true` (+ `access_type=offline&prompt=consent`) so incremental auth merges the new scope and the user does not lose existing Gmail grants. **No blanket up-front re-consent.**
- ⚠️ **Ops/compliance dependency for the user (not a code decision):** `gmail.settings.basic` is a **sensitive** scope. The OAuth app is already verified for **restricted** Gmail scopes (`gmail.readonly`/`modify`), but adding a new sensitive scope to a verified app typically triggers a **Google consent-screen re-review**, which is calendar-time before Phase 2 can ship to real users. See "Decisions the user must make" below.

**OQ4 — Action granularity → PARTIALLY AMENDED (semantic-determinism driven).**
- Governing principle: **granularity follows semantic-intent + confirmation-posture boundaries, not API-call boundaries.** Merge only when it is genuinely one intent + one confirmation posture + one `batchUpdate`.
- **Sheets:** `format_cells` (bold/bg/font/align **+ freeze**) as ONE action = ✅ ratify (one intent, one batchUpdate). But keep **`add_conditional_format` SEPARATE** (rule-based, persistent, value-driven — a different mental model), and keep **`clear_range` / `delete_rows` SEPARATE** (destructive, need confirmation rules).
- **Drive:** **AMEND** — reject the composite `update_file_metadata`. Use narrow verb-named actions: `move_file`, `rename_file`, `copy_file`, `delete_file`, `revoke_access`. A grab-bag metadata mutator is the "vague op + description" anti-pattern; distinct intents also carry distinct confirmation semantics (delete confirms; rename does not).
- **Gmail labels:** **AMEND** — reject the composite `manage_labels`. Use `get_or_create_label` (matches the platform `find_or_create_X` convention and Gmail's 409-on-duplicate behavior), `list_labels`, `delete_label`.
- **Docs:** keep `format_document_text`, `insert_table`, `replace_text` separate (distinct structural ops + index math). ✅ ratify.

**OQ5 — Docs index math → RATIFIED, downgraded to a Dev/QA implementation constraint (not an architectural blocker).**
- `replace_text` (`replaceAllText`) needs **no index math** → it is the safest Docs action; sequence it in Phase 1.
- `format_document_text` / `insert_table` need index math. Mandate: (a) the executor **reads the live document structure at execution time** to resolve indices — never trust a stale `end_index` passed as a param; (b) prefer text-anchored operations over raw absolute indices where the API allows; (c) integration tests **must** cover the end-of-body boundary (the classic off-by-one: insert at `end_index - 1`) and an empty-document case.

### Feasibility table (action → new OAuth scope? → fits V2 contract? → phase → notes)

Existing granted scopes: **Calendar** `calendar`, `calendar.events` · **Gmail** `gmail.readonly/send/modify` · **Drive** `drive`, `drive.file` · **Sheets** `spreadsheets`, `drive` · **Docs** `documents`, `drive`.

| Plugin | Proposed action | New scope? | Fits contract? | Phase | Notes |
|---|---|---|---|---|---|
| Calendar | `get_free_busy` | No (`calendar` covers freebusy) | Yes | 1 | Thin `freebusy.query` wrapper. Add `output_dependencies` if multi-calendar param gates output. |
| Calendar | `list_calendars` | No | Yes | 1 | `calendarList.list`. |
| Calendar | `list_available_slots` | No | Yes | 2 | Deterministic slot math in executor (see OQ1). New semantic type `time_slot`/`availability_slot` → **must** be added to `input-type-compat.ts` + run `validatePluginTypeAnnotations`. |
| Calendar | `create_event` (booking reuse) | No | Exists | 1/3 | Reuse. Booking-time recheck + `slot_taken` error is Phase 3 concern (OQ2). Consider idempotency via client-supplied `iCalUID` to survive retries. |
| Gmail | `get_or_create_label` | No (`gmail.modify` covers labels) | Yes | 1 | Idempotent: list → match → return existing, else create (409-safe). |
| Gmail | `list_labels` / `delete_label` | No | Yes | 1 | `delete_label` needs a confirmation rule. |
| Gmail | `reply_to_email` (in-thread) | No (`gmail.send`) | Yes | 1 | Set `threadId` + `In-Reply-To`/`References`. |
| Gmail | `send_draft` | No (`gmail.send`) | Yes | 1 | `drafts.send`. |
| Gmail | `batch_modify_emails` | No (`gmail.modify`) | Yes | 1 | `messages.batchModify`. |
| Gmail | `create_filter` | **YES — `gmail.settings.basic`** | Yes | 2 | Idempotent: list → compare criteria+action → skip duplicate. Forward-to-**verified**-address only (adding a NEW forwarding address would need `gmail.settings.sharing` — keep out of scope). |
| Gmail | `list_filters` / `delete_filter` | **YES — `gmail.settings.basic`** | Yes | 2 | `delete_filter` needs a confirmation rule. |
| Drive | `move_file` | No (`drive`) | Yes | 1 | `files.update` add/remove parents; naturally idempotent. |
| Drive | `rename_file` | No | Yes | 1 | `files.update` name. |
| Drive | `copy_file` | No | Yes | 1 | Not naturally idempotent — note for recurring workflows. |
| Drive | `delete_file` | No | Yes | 1 | **Trash-by-default** + confirmation rule (executor does not hard-block confirms). |
| Drive | `revoke_access` | No | Yes | 1 | `permissions.delete`; confirmation rule. |
| Sheets | `format_cells` (+freeze) | No (`spreadsheets`) | Yes | 1 | One `batchUpdate` (`repeatCell` + `updateSheetProperties`). |
| Sheets | `clear_range` / `delete_rows` | No | Yes | 1 | Destructive/structural → confirmation rules. |
| Sheets | `add_conditional_format` | No | Yes | 2 | Separate action (see OQ4). |
| Sheets | `sort_range` | No | Yes | 2 | Nice-to-have. |
| Docs | `replace_text` | No (`documents`) | Yes | 1 | No index math — safest Docs action. |
| Docs | `format_document_text` | No | Yes | 2 | Index math — read-live-structure + boundary tests (OQ5). |
| Docs | `insert_table` | No | Yes | 2 | Index math — same constraints as above. |

**New-scope summary (grouped by plugin):**
- **Gmail:** `https://www.googleapis.com/auth/gmail.settings.basic` — required for `create_filter`, `list_filters`, `delete_filter` ONLY.
- **Calendar / Drive / Sheets / Docs:** **no new scopes for any proposed action.**

### Cross-cutting architectural concerns

1. **OAuth scope strategy** — Declared per-plugin in `auth_config.required_scopes`. Per-service connections mean the blast radius of the one new scope is the Gmail connection only. Use lazy scope-drift detection (compare `connection.scope`) + incremental auth (`include_granted_scopes=true`) rather than a superset re-consent. (OQ3.)
2. **Booking surface** — Availability computation is a plugin action; the public booking page/endpoint and its authoritative double-booking reservation state are a **new app surface (Phase 3)**, reusing plugin actions server-side. (OQ1/OQ2.)
3. **Idempotency (`find_or_create_X`)** — `get_or_create_label` (409-safe), `create_filter` (list→match→skip), `move_file` (no-op if already in parent). `copy_file` and booking `create_event` are the non-idempotent cases — handle via name-check / `iCalUID` respectively. Generic patterns only — **no plugin-specific rules in system prompts or the compiler** (Mandatory Rule + Platform Design Principles). This is a plugin/executor concern, not a compiler concern.
4. **V6 pipeline implications** — Standard-shaped actions need no compiler change. Required per action: entity/cardinality fields, `x-semantic-type` on typed output items, `output_dependencies` where a param gates output richness. `list_available_slots` introduces a **new entity type** → Dev must extend `lib/agentkit/v6/capability-binding/input-type-compat.ts` and run `validatePluginTypeAnnotations`. **No new `must_support` semantics without SA sign-off** (ratify BA's note).

### Standards / Mandatory-Rule flags for the future workplans

- **Logging (Mandatory Rule 3):** New executors must use the base-class Pino `this.logger`. ⚠️ The `PLUGIN_GENERATION_WORKFLOW.md` template shows `if (this.debug) console.log(...)` — **do not copy it.** Also, `lib/server/google-sheets-plugin-executor.ts:247` has an existing `console.error`; when the Phase 1 Sheets work **touches that file**, Dev must flag it and propose converting it to Pino (per the "non-compliant files you touch" rule).
- **Security:** All destructive actions (`delete_file`, `delete_filter`, `delete_label`, `revoke_access`, `clear_range`, `delete_rows`) must declare `rules.confirmations` AND default to non-destructive (trash) because confirmations are advisory in the executor. Never log `access_token`. The Phase 3 public booking endpoint is the real security surface (anonymous caller, owner creds server-side, rate-limit + abuse protection; freebusy is privacy-safe busy/free only — keep it that way).
- **Repository pattern:** Plugin executors stay stateless (DB only via `UserPluginConnections`). The Phase 3 booking `holds` state must go through `lib/repositories/` with `user_id` scoping + a unique constraint.
- **Testing:** Each new action ships happy-path + one failure-path (unit) per project policy; index-math Docs actions additionally require the end-of-body boundary + empty-doc integration tests.

### Minor corrections to the requirement (non-blocking)

- NFR/OQ3 imply broad scope changes; corrected — only `gmail.settings.basic` is new. `manage_labels`, reply/send-draft/batch-modify, and all Drive/Sheets/Docs/Calendar actions need **no** new scope.
- "Integration Points" lists executors as `google-{...,mail,...}-plugin-executor.ts`; the Gmail executor file is `gmail-plugin-executor.ts` (registered as `google-mail`, extends `GoogleBasePluginExecutor`).

### Proposed phased sequencing (each phase = discrete, independently shippable workplans)

- **Phase 1 — 🟢 Additive, zero new scopes, zero re-consent.** Split into per-plugin workplans:
  - Drive: `move_file`, `rename_file`, `copy_file`, `delete_file` (trash+confirm), `revoke_access`
  - Sheets: `format_cells` (+freeze), `clear_range`, `delete_rows`
  - Docs: `replace_text`
  - Gmail: `get_or_create_label`, `list_labels`, `delete_label`, `reply_to_email`, `send_draft`, `batch_modify_emails`
  - Calendar: `get_free_busy`, `list_calendars`
  Delivers the majority of the "AI Business OS" value with no OAuth impact. Can start immediately.
- **Phase 2 — 🟡 New scope + higher-risk implementation.**
  - Gmail filters: `create_filter`, `list_filters`, `delete_filter` (**needs `gmail.settings.basic` + lazy re-consent + possible Google app re-verification — gated on the user decision below**).
  - Docs index-math: `format_document_text`, `insert_table` (read-live-structure + boundary tests).
  - Sheets: `add_conditional_format`, `sort_range`.
  - Calendar: `list_available_slots` (deterministic slot math + new semantic type).
- **Phase 3 — 🔴 Booking surface (separate requirement).** Public `/book/[handle]` app route + public booking API, reservation `holds` DB state (repository + unique constraint) for authoritative double-booking prevention, reusing `get_free_busy` / `list_available_slots` / `create_event` server-side.
- **Deferred / watch:** push-notification watch channels (needs webhook/trigger architecture), Google Slides plugin — both separate requirements.

### Decisions the user must make before the affected work starts — ✅ RESOLVED 2026-07-26

1. **Gmail `gmail.settings.basic` sensitive scope (Phase 2 only).** ✅ **APPROVED by user** — additional consent-screen items are acceptable. **Ops task added to Phase 2:** the OAuth app is already verified for *restricted* Gmail scopes (`gmail.modify`/`gmail.send`), so adding a *sensitive* scope is incremental and should NOT require a fresh CASA security assessment — but it will require **resubmitting the OAuth consent screen for Google review** (possible short calendar-time turnaround). Existing users receive the new scope via incremental auth. **Phase 1 unaffected.**
2. **Phase 3 (public booking page) deferred.** ✅ **CONFIRMED by user** — this requirement delivers only the availability primitives (`get_free_busy`, `list_available_slots`) and reuses `create_event`; the booking surface is a separate BA/SA requirement.
3. **Destructive-action default posture.** ✅ **CONFIRMED by user — no hard delete.** `delete_file` = trash + confirmation. (Item 4/action-granularity: user ratified the SA's call — keep composite `format_cells`, split `manage_labels`/file-metadata into narrow actions.)

### Approval

- [x] Requirement approved for architecture. **Phase 1 workplans may begin immediately.** Phase 2 begins once decision #1 is made. Phase 3 requires a new BA/SA requirement cycle.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-22 | Initial draft | BA inventory of 5 Google plugins (37 actions), gap analysis against 3 capability goals + AI Business OS shortlist, grounded in Google API research. |
| 2026-07-26 | SA architectural review | Added `## SA Architectural Review`: resolved 5 open questions, per-action feasibility table, scope analysis (only `gmail.settings.basic` is new), booking-surface verdict (plugin primitives vs new app surface), double-booking guidance, idempotency/V6/standards flags, and 3-phase sequencing. Amended action granularity (reject composite `manage_labels` / `update_file_metadata`). Flagged 3 user decisions; Phase 1 unblocked. |
| 2026-07-26 | User ratification | User approved Gmail sensitive-scope addition (ops note: OAuth consent-screen resubmission required, no fresh CASA), confirmed Phase 3 deferral, confirmed no hard-delete, and ratified SA's action-granularity call. Status → Approved. Phase 1 cleared for Dev workplan. |
