# Deterministic Sheet-Tab (gid) Resolution for Google Sheets Reads — Requirement

> **Last Updated**: 2026-07-02
> **Author**: BA · **Status**: ⏸ **OPTIONAL / DEFERRED (2026-07-02).** Requirement is sound and SA-approved, but demoted after a Phase-2 pacing carve-out + Phase-3 backstop reached ~90% clean (see [EP_PRODUCTION_SHEETS_RANGE_FIX_WORKPLAN.md](../workplans/EP_PRODUCTION_SHEETS_RANGE_FIX_WORKPLAN.md)). Retained as the **deterministic** option; build only if the prompt mitigation + Option A prove insufficient in production, or when arbitrary non-zero gids become a real need.
> **Origin**: RCA on agent `3fc703fd` — the agent-creation flow turned a `gid=0` spreadsheet URL into the fabricated tab name `"Sheet1"`, which broke calibration (`Unable to parse range: Sheet1`). See [EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md](../investigations/EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md).

## Overview

When a user supplies a Google Sheet as a URL (e.g. `…/spreadsheets/d/<fileId>/edit?gid=0#gid=0`), the URL carries **two** identifiers: the spreadsheet **file id** and the **`gid`** (the tab's stable numeric id, `sheetId`). Today the platform extracts only the file id and **discards the gid**. Because the Sheets `read_range` action targets a tab only by **name** (inside the A1 `range` string) or by omission, and the chat flow has **no live Sheets API access**, the tab identity has to be *guessed* at every downstream layer ("first tab" / a fabricated `"Sheet1"`). The one piece of information that would make it **exact — the gid — is thrown away.**

This requirement adds **end-to-end gid support**: extract the gid from the URL, carry it as a structured parameter through generation, and resolve it deterministically to the real tab **in the executor** (which *does* have the Sheets API). Result: an agent built from a `gid` URL reads the correct tab on the first try, with **no guessing at any layer** — for `gid=0` and any non-zero gid, and even after the tab is renamed (the gid is stable across renames).

This is the **deterministic successor** to the two guess-based mitigations already in place (the agent-creation prompt fix, and the Option A calibration resolver's best-effort "first tab" fallback). It does not remove them; it makes them the safety net for agents that still lack a gid, rather than the primary mechanism.

## Table of Contents

1. [Problem statement](#1-problem-statement)
2. [Goals & non-goals](#2-goals--non-goals)
3. [Why gid (not name / not position)](#3-why-gid-not-name--not-position)
4. [Functional requirements](#4-functional-requirements)
5. [Wider applicability — other Google plugins](#5-wider-applicability--other-google-plugins)
6. [Relationship to existing mitigations](#6-relationship-to-existing-mitigations)
7. [Acceptance criteria](#7-acceptance-criteria)
8. [Out of scope](#8-out-of-scope)
9. [Open questions](#9-open-questions)
10. [Change History](#change-history)

---

## 1. Problem statement

- The Sheets `read_range` action's only tab selector is the `range` string (A1 notation): a tab **name** (`Leads!A1:D10`) or **omission** (`A:Z` → first visible sheet). There is **no** `gid` / `sheet_id` / numeric-tab parameter.
- A user-supplied spreadsheet URL contains the tab's `gid`. The flow parses the file id correctly but drops the gid.
- The chat/generation layers cannot resolve `gid → tab title` (no live API). So they either fabricate a name (`"Sheet1"` — the RCA failure) or approximate "first tab."
- "First tab" is *usually* right for `gid=0` but is a guess, and it is **wrong** for a non-zero gid, a multi-tab sheet where the first visible sheet isn't `gid=0`, or a reordered/hidden first sheet.

**The fix must preserve the gid the user already provided and resolve it where the API exists — the executor.**

## 2. Goals & non-goals

**Goals**
- Extract the `gid` from a Google Sheets URL during agent creation and carry it as structured data (not prose).
- Thread the gid through the V6 generation pipeline onto the compiled read step.
- Add an optional `gid` (numeric tab id) input to the Sheets read action(s).
- In the executor, deterministically resolve `gid → tab title` (via `spreadsheets.get`, which the executor already calls) and read that exact tab; graceful fallback when gid is absent/invalid.
- Zero guessing when a gid is present — correct for `gid=0`, non-zero gids, and renamed tabs.

**Non-goals**
- ❌ Removing the agent-creation prompt fix or the Option A calibration resolver (they remain the fallback for agents without a gid).
- ❌ Building gid/opaque-id support for plugins that have no proven failure (Docs/Drive/Calendar — see §5; grow-on-demand per CLAUDE.md).
- ❌ Changing how the Sheets **values** API works (it can't take a gid; we resolve gid→title first, then read by title).
- ❌ A UI tab-picker in the creation flow (the whole point is that the gid is already unambiguous).

## 3. Why gid (not name / not position)

The `gid` (== `sheetId`) is the **most reliable** tab identifier:
- **Stable** — it does not change when the tab is renamed or reordered (unlike the name or the visible position).
- **Unique & unambiguous** — one gid ↔ one tab, always present in the URL the user pastes.
- **Exactly what the user pointed at** — carrying it is *faithful*; deriving "first tab" from it is a lossy approximation that only coincidentally works for `gid=0`.

## 4. Functional requirements

**FR1 — URL identifier extraction (agent-creation, Phase 3 / EP production).** When a spreadsheet is provided as a URL, the EP must extract **both** the file id and the `gid`, and emit the gid as a structured `resolved_user_inputs` entry (e.g. `google-sheets__table/get__sheet_gid = "0"`) — never fold it into prose only. If no gid is present in the URL, emit none (fall back to existing behavior).

**FR2 — Pipeline carry (V6).** The V6 data-source model, `EnhancedPromptTransformer`, and `DataSourceResolver` must carry the gid onto the compiled read step's config (a new optional `sheet_gid` alongside `spreadsheet_id` / `range`). Absence of a gid must be a clean no-op (no regression to today's behavior).

**FR3 — Plugin parameter.** The Sheets read action(s) must accept an optional `sheet_gid` (numeric string) parameter, documented in the plugin definition. `range` remains for explicit A1/cell selection; when `sheet_gid` is present it authoritatively selects the tab.

**FR4 — Executor resolution.** In `readRange`, when `sheet_gid` is present, resolve it to the tab **title** via `spreadsheets.get` metadata (the executor already fetches `sheets.properties(sheetId,title,index)`), and build/prefix the A1 range with that title. Fallbacks: gid not found → first visible sheet + a logged warning; no gid → today's behavior (range as-is / name-less → first tab).

**FR5 — Precedence & compatibility.** `sheet_gid` (when present and resolvable) wins over a sheet-name prefix in `range`. A `range` that already carries a valid tab name and no gid behaves exactly as today. No change to `spreadsheet_id` handling.

**FR6 — No guessing when gid present.** With a valid gid, no layer may fall back to "first tab" heuristics — the gid resolves to a specific tab or (only if the gid genuinely doesn't exist) a clearly-logged fallback.

## 5. Wider applicability — other Google plugins

**Reviewed all Google plugin definitions.** The general pattern is *"a URL carries a sub-identifier the plugin's action can't accept directly."* Findings:

| Plugin | URL identifiers | Directly extractable? | gid-class gap? |
|---|---|---|---|
| **Sheets** | file id **+ `gid` (tab)** | file id ✅ / gid ❌ (no param, name-only) | **YES — proven (`3fc703fd`). Build now.** |
| **Docs** | `document_id` (+ new **tab** `?tab=t.…`) | document_id ✅ | **Latent only.** `read_document` reads the whole doc; a tab fragment is ignored (soft — no hard failure). Monitor; build only if a real "wrong Docs tab" failure appears. |
| **Drive** | `file_id` / `folder_id` | ✅ directly from URL | **No.** The inverse (name→id) is already served by `search_files` / `get_or_create_folder`. |
| **Calendar** | `calendar_id` (email-like) / `event_id` | user-provided / from `list_events`; safe default `'primary'` | **No.** No opaque URL-fragment sub-id; `'primary'` default covers "my calendar". |
| **Gmail / OneDrive** | message/thread/file ids (from search, not URLs) | n/a | **No.** |

**Conclusion:** **Sheets `gid` is the only build-now case.** The reusable, generalizable idea is *"during URL parsing, extract **every** identifier the URL carries (not just the primary id) and carry each as a structured param the plugin can consume."* The implementation should therefore expose the executor's `gid → title` resolution as a **small, reusable helper** so a future Docs-tabs tenant is a minimal add — but **no Docs/Drive/Calendar work is in scope now** (no proven failure; grow-on-demand). The requirement's design section must include a "generalization seam" note so the code doesn't hardcode Sheets assumptions where a reusable shape is cheap.

## 6. Relationship to existing mitigations

| Mechanism | Layer | Role after this lands |
|---|---|---|
| Agent-creation prompt #1/#2 | creation (v16) | Still stops *fabrication* for agents where a gid can't be carried (e.g. name-only inputs). Secondary. |
| Option A calibration resolver | calibration | Becomes the **safety net** for gid-less agents (reads tabs, best-effort first tab). Its guess path is no longer exercised when a gid is carried. |
| **gid resolution (this)** | creation → V6 → plugin → executor | **Primary, deterministic** path for URL-provided sheets. No guessing. |

These compose; none is removed. Single-source note: the executor's `gid→title` metadata read and Option A's tab-listing read should share one helper (both call `spreadsheets.get` for `sheetId+title`).

## 7. Acceptance criteria

- **AC1** — An agent created from a `gid=0` URL stores a structured gid and, at runtime, reads the tab whose `sheetId=0` — verified against a spreadsheet whose first tab is **not** named "Sheet1".
- **AC2** — A **non-zero** gid URL reads the correct (non-first) tab.
- **AC3** — Renaming the target tab after creation does not break the read (gid is stable).
- **AC4** — A name-based input (no URL/gid) behaves exactly as today (no regression).
- **AC5** — An invalid/stale gid falls back to the first visible sheet with a logged warning, never a hard crash.
- **AC6** — `3fc703fd` re-created end-to-end passes calibration with **no** parameter-error and **no** Option A best-effort guess fired.
- **AC7** — No hardcoded plugin/action names in the generic V6 pipeline; gid logic is confined to the Sheets plugin/executor + a clean carry-through in V6.

## 8. Out of scope

- Docs tabs, Drive, Calendar gid-analogs (§5 — no proven failure).
- Write-side Sheets actions (`write_range`, `append_rows`) — same `range` param, same latent gap, but no proven failure; design the helper to extend to them later, don't wire them now.
- Defect B (`extractInputSchema` dup fields) — separate RCA.
- Removing/altering Option A or the prompt fix.

## 9. Open questions

1. **Param name** — `sheet_gid` vs `tab_gid` vs reusing/aliasing `sheet_id`. (Recommend `sheet_gid` — unambiguous, matches URL vocabulary.)
2. **Carry granularity in V6** — new first-class `gid` field on the data-source model, vs a generic `extra_identifiers` map (more reusable for future Docs tabs). SA to weigh reuse vs footprint.
3. **URL-in-`spreadsheet_id` alternative** — instead of a separate gid param, let the executor accept the full URL and parse both ids. Simpler plumbing (no V6 gid field) but overloads `spreadsheet_id` semantics. SA to choose.
4. **Precedence disclosure** — when gid and a conflicting sheet-name in `range` disagree, do we log/surface the override?
5. **Shared helper location** — where the `gid→title` + tab-listing helper lives so both the executor and Option A's resolver use one implementation.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-02 | Created | BA requirement for end-to-end Sheets gid resolution. Includes wider-plugin review (Sheets = only build-now case; Docs-tabs latent; Drive/Calendar no gap). Origin: `3fc703fd` RCA. |
