# Workplan: Google Calendar Plugin — `list_available_slots` (Phase 2 slice)

> **Last Updated**: 2026-07-27

**Developer:** Dev
**Requirement:** [GOOGLE_SUITE_PLUGIN_ROBUSTNESS_REQUIREMENT.md](/docs/requirements/GOOGLE_SUITE_PLUGIN_ROBUSTNESS_REQUIREMENT.md) (✅ Approved — see `## SA Architectural Review`, OQ1 amendment on `list_available_slots`)
**Builds on:** [GOOGLE_CALENDAR_PHASE1_ACTIONS_WORKPLAN.md](/docs/workplans/GOOGLE_CALENDAR_PHASE1_ACTIONS_WORKPLAN.md) (committed `16e9a40` — `get_free_busy` is the foundation for this slice)
**Branch:** `feature/calendar-list-available-slots` — ✅ confirmed current branch (`git branch --show-current`). Workplan-only; **no implementation code** until SA workplan-review passes. RM owns branch creation + the eventual merge; Dev never commits to `main`.
**Status:** Code Complete (CR-1…CR-5 folded in; scoped tests green — awaiting SA code review)

## Overview

This workplan covers the **Phase 2 Google Calendar slice**: **one new read-only computation action**, `list_available_slots`, on the existing `google-calendar` V2 plugin. It computes bookable/open time slots by querying busy intervals (reusing the Phase 1 `freebusy.query` logic) and subtracting them — plus buffers and a minimum-notice floor — from user-defined working-hours windows, then slicing the remaining free time into fixed-length slots. This is the "here are the times you can book" primitive that completes the Calendar-as-Calendly availability layer (`get_free_busy` → `list_available_slots` → reuse `create_event`).

Two things make this slice materially more complex than the Phase 1 read wrappers, and both are **binding SA constraints** (requirement `## SA Architectural Review`, OQ1):

1. **The slot math runs entirely in the executor (TypeScript), NOT as a `freebusy` + generic `transform` step.** Exposing raw freebusy and asking the V6 compiler/LLM to assemble slot arithmetic in a natural-language `transform` step is the semantic-determinism anti-pattern the platform rejects. `list_available_slots` is **one self-contained, deterministic, fully unit-testable action**. `get_free_busy` stays separately exposed as the lower primitive.
2. **It introduces the new `time_slot` V6 semantic type** — the requirement flagged this explicitly as the Phase 2 type addition. The output slot items are annotated `x-semantic-type: "time_slot"`, and `time_slot` is registered in `lib/agentkit/v6/capability-binding/input-type-compat.ts`.

**Explicitly out of scope (Phase 3, separate BA/SA cycle):** the public booking page/endpoint and any authoritative reservation/`holds` state (DB unique constraint on `(owner, slot_start)`) that would *guarantee* no double-booking. This action is a **pure read/computation over freebusy** — it books nothing, holds nothing, and writes no state. Availability computation is a plugin action; the booking surface is a new app layer.

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [Binding SA Constraints (carried from the requirement)](#binding-sa-constraints-carried-from-the-requirement)
4. [Files to Create / Modify](#files-to-create--modify)
5. [Action Specification — input / output schema](#action-specification--input--output-schema)
6. [The Slot-Math Algorithm](#the-slot-math-algorithm)
7. [Pure-Function Factoring](#pure-function-factoring)
8. [V6 `time_slot` Type Registration Plan](#v6-time_slot-type-registration-plan)
9. [Task List](#task-list)
10. [Testing](#testing)
11. [Standards & Risks](#standards--risks)
12. [Open Questions for SA](#open-questions-for-sa)
13. [SA Review Notes](#sa-review-notes)
14. [QA Testing Report](#qa-testing-report)
15. [Commit Info](#commit-info)
16. [Change History](#change-history)

---

## Analysis Summary

**What this touches:**

| Layer | File | Change |
|---|---|---|
| Slot-math (pure) | `lib/server/calendar-slot-math.ts` | **Create** — pure, network-free, deterministic slot-computation module (the testable core). |
| Slot-math tests | `lib/server/calendar-slot-math.test.ts` | **Create** — co-located pure-function unit tests (6, per LEAN policy exception). |
| Executor | `lib/server/google-calendar-plugin-executor.ts` | Add 1 `switch` case + 1 private method (`listAvailableSlots`) + 1 shared private freebusy helper (`fetchBusyIntervals`) that `getFreeBusy` is refactored to reuse (OQ4). Stays **0 `console.*`**. |
| Plugin definition | `lib/plugins/definitions/google-calendar-plugin-v2.json` | Add 1 action entry (`list_available_slots`); annotate output slot items `x-semantic-type: "time_slot"`; bump `plugin.version` `1.1.0` → `1.2.0`. |
| V6 type registry | `lib/agentkit/v6/capability-binding/input-type-compat.ts` | Add `'time_slot'` to `TO_TYPE_EXTRAS` (output-leaf, no `TYPE_COMPAT` edges) + JSDoc note. |
| Test page | `app/test-plugins-v2/page.tsx` | Add 1 `PARAMETER_TEMPLATES` entry under `"google-calendar"` (smoke-check UX). No new `console.*`. |
| Executor unit tests | `tests/plugins/unit-tests/google-calendar.test.ts` | Add LEAN 3 (happy + 401 + invalid-input) for the new action. |
| Integration tests | `tests/plugins/integration-tests/google-calendar.integration.test.ts` | Add a credential-gated `list_available_slots` case (skips without `GOOGLE_CALENDAR_TEST_TOKEN`). |
| Plugin doc | `docs/plugins/google-calendar-plugin.md` | Document `list_available_slots`; version-history bump; version `1.1.0` → `1.2.0`; Last Updated 2026-07-27. |

**Confirmed from code grounding:**

- **Executor contract:** `GoogleBasePluginExecutor` → `executeSpecificAction(connection, actionName, parameters)` switch; auth via `connection.access_token`; Pino `this.logger`; base handles normalization, schema validation, and **advisory-only** confirmation surfacing (does not hard-block). Each new action = one `case` + one private method returning a schema-shaped object. Raw-`fetch` + manual `!response.ok` throw is this file's HTTP style (it does not use the base `handleApiResponse`).
- **Phase 1 foundation (`getFreeBusy`, executor lines 466–560):** already does pre-fetch guards (`time_min`/`time_max` present + RFC3339 + `time_min < time_max`; ≤ 50 calendars), `POST /calendar/v3/freeBusy` with `{ timeMin, timeMax, timeZone, items:[{id}] }`, maps `data.calendars` → `{ calendar_id, busy:[{start,end}], errors? }` **copying only `start`/`end`** (privacy invariant), surfaces per-calendar `errors` as partial success (only top-level `!response.ok` throws). This slice **factors the fetch+privacy-map into a shared `fetchBusyIntervals` helper** so `list_available_slots` reuses the exact same freebusy path and the privacy invariant is enforced in one place (OQ4).
- **RFC3339 vocabulary:** the plugin already standardizes on RFC3339 strings (`time_min`/`time_max` on `list_events`/`get_free_busy`). This action uses `range_start`/`range_end` (RFC3339) for the overall search window — distinct names to avoid confusion with the per-day working-hours wall-clock strings.
- **Return shape:** existing actions return dual snake_case + legacy camelCase with an `x-guaranteed` `*_at` timestamp. `list_available_slots` follows suit (`computed_at`).
- **`console.*` count:** `lib/server/google-calendar-plugin-executor.ts` = **0** (grep-confirmed). Keep it 0 (Phase 1 left it at 0).
- **Date/tz libraries available:** `date-fns@^4.1.0` is present; **`date-fns-tz` and `@date-fns/tz` are ABSENT** (package.json checked). So the timezone-aware wall-clock→UTC conversion is either (a) hand-rolled via built-in `Intl.DateTimeFormat` (zero new dependency, DST-safe if written carefully) or (b) `@date-fns/tz` (the official date-fns v4 companion — a small, well-tested addition, not a heavy dependency, but still a new dependency needing SA sign-off). See [OQ2](#open-questions-for-sa) — this is the single highest-risk decision in the slice.
- **Pure-fn precedent:** `a1RangeToGridRange` (Sheets executor line 699) is a **private, network-free, deterministic** method unit-tested via `(executor as any).a1RangeToGridRange(...)`. Our slot math is larger and genuinely warrants isolation, so it goes in a **standalone exported module** (`calendar-slot-math.ts`) rather than a private method — same "pure and unit-testable without network" spirit, cleaner test surface (see [OQ5](#open-questions-for-sa)).
- **Integration harness:** `tests/plugins/integration-tests/integration-config.ts` **already has** a `google-calendar` `CREDENTIAL_MAP` entry (added in Phase 1) — no new registration needed; just add a case to the existing integration file.
- **No new OAuth scope:** `list_available_slots` only calls `freebusy.query`, already covered by the granted `https://www.googleapis.com/auth/calendar` scope. Zero re-consent, zero re-verification (confirmed against `required_scopes`).
- **V6 open items:** `V6_OPEN_ITEMS.md` has **no** existing item relating to semantic types / input-type-compat / `time_slot` — this is genuinely new type work, not a known-open bug.

---

## Implementation Approach

**One executor action that orchestrates: validate inputs → fetch busy intervals (shared freebusy helper) → run the pure slot-math → shape the output.** The action is read-only and idempotent (pure computation over freebusy; no state mutated, nothing booked).

**Root-cause phase (per CLAUDE.md V6 protocol):** This is **plugin-layer work** for the action itself, plus **one V6 capability-binding registration** for the `time_slot` type. No V6 compiler / IR-converter / prompt changes — the action is standard-shaped and auto-discovered by `CapabilityBinder`; the only V6 file touched is `input-type-compat.ts` (the single source of truth for semantic types). Per Platform Design Principles and V6 Design Principle 6, **no plugin-specific rules are added to any system prompt or the compiler** — the definition schema is the sole source of truth, and the slot math lives in the executor, not in any generic component.

**Why in-executor, not `transform` (binding — restated because it's the crux):** the slot arithmetic (tz-aware window expansion, DST, interval subtraction, buffer padding, boundary-safe slicing) is deterministic math. Placing it in the executor makes it a single typed capability the compiler binds deterministically. Expressing it as a generic `transform` step would force the compiler/LLM to reconstruct the algorithm from natural language — non-deterministic, untestable, and exactly the anti-pattern OQ1 rejects.

### Idempotency / safety posture

| Property | Value | Reasoning |
|---|---|---|
| `idempotent` | `true` | Pure read + deterministic computation. Re-running over the same inputs returns the same slots (barring underlying calendar changes). Nothing is written or reserved. |
| `rules.confirmations` | none | Read-only computation — no destructive posture, nothing to gate. |
| Privacy | busy intervals used internally are `start`/`end` only (via the shared `fetchBusyIntervals` helper) and are **never** surfaced in the output — the output is only computed free `{ start, end }` slots. |
| Double-booking | **NOT solved here** (out of scope). This action reports availability; it does not reserve. The authoritative guard is the Phase 3 reservation state. Documented in `usage_context` so no caller assumes a returned slot is held. |

---

## Binding SA Constraints (carried from the requirement)

These are non-negotiable and pre-decided in the requirement's `## SA Architectural Review` (OQ1) + the requirement body:

1. **In-executor slot math** — one self-contained action wrapping freebusy + doing the math in TypeScript. NOT `freebusy` + a generic `transform` step. ✅ Honored (see Implementation Approach).
2. **New `time_slot` semantic type** — added to `input-type-compat.ts`; run `validatePluginTypeAnnotations`. ✅ Honored (see [V6 registration plan](#v6-time_slot-type-registration-plan)).
3. **Booking/reservation state is Phase 3, separate** — this slice ships availability computation only. ✅ Honored (read-only, no state).
4. **No new OAuth scope** — `freebusy.query` fits the granted `calendar` scope. ✅ Confirmed.
5. **No plugin-specific hardcoding** in prompts/compiler. ✅ Honored.

---

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/server/calendar-slot-math.ts` | **create** | Pure, deterministic, network-free slot-computation module (the testable algorithm core). Exports `computeAvailableSlots(...)` + pure helpers. |
| `lib/server/calendar-slot-math.test.ts` | **create** | Co-located pure-function unit tests (6 focused cases — LEAN exception for the slot math). |
| `lib/server/google-calendar-plugin-executor.ts` | modify | Add `list_available_slots` switch case + `listAvailableSlots` private method; extract a shared `fetchBusyIntervals` freebusy helper and refactor `getFreeBusy` to reuse it (OQ4). No `console.*`. |
| `lib/plugins/definitions/google-calendar-plugin-v2.json` | modify | Add `list_available_slots` action block (input schema incl. `working_hours` object, `x-dynamic-options` on `calendar_ids`, output_schema with slot items annotated `x-semantic-type: "time_slot"`, common_errors, `idempotent:true`); bump `plugin.version` → `1.2.0`. |
| `lib/agentkit/v6/capability-binding/input-type-compat.ts` | modify | Add `'time_slot'` to `TO_TYPE_EXTRAS` (output-leaf) + JSDoc note. No `TYPE_COMPAT` edges. |
| `app/test-plugins-v2/page.tsx` | modify | Add 1 `PARAMETER_TEMPLATES` entry (smoke-check). No new `console.*`. |
| `tests/plugins/unit-tests/google-calendar.test.ts` | modify | Add LEAN 3 executor tests (happy + 401 + invalid-input). |
| `tests/plugins/integration-tests/google-calendar.integration.test.ts` | modify | Add credential-gated `list_available_slots` live case. |
| `docs/plugins/google-calendar-plugin.md` | modify | Document the action; version-history bump; version → `1.2.0`; Last Updated 2026-07-27. |

**Not touched:** `plugin-executer-v2.ts`, `plugin-manager-v2.ts` (auto-discovery); `integration-config.ts` (`google-calendar` already registered); the public `list_calendars` dropdown fetcher; the `getFreeBusy` output shape/contract (only its internals refactor to call the shared helper — OQ4).

---

## Action Specification — input / output schema

Base host is `this.googleApisUrl` (= `https://www.googleapis.com`). Only Google call: `POST /calendar/v3/freeBusy`.

**Metadata:** domain `calendar` · capability `list` (produces a collection of typed slot entities) · input_entity `null` · output_entity `time_slot` · input_cardinality `null` · output_cardinality `collection` · `idempotent: true`. (Capability `list` vs `get` — see [OQ6](#open-questions-for-sa).)

### Input schema

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `range_start` | string (RFC3339) | ✅ | — | Overall search-window start (e.g. `2026-08-01T00:00:00Z`). |
| `range_end` | string (RFC3339) | ✅ | — | Overall search-window end. Must be strictly after `range_start`. |
| `slot_duration_minutes` | integer | ✅ | — | Length of each bookable slot (e.g. `30`). Positive integer. |
| `working_hours` | object | ✅ | — | Per-day availability windows + IANA `time_zone`. Shape below. |
| `calendar_ids` | string[] | ❌ | `["primary"]` | Calendars whose busy blocks make a slot unavailable. ≤ 50. `x-dynamic-options: { source: "list_calendars" }`. |
| `buffer_minutes` | integer | ❌ | `0` | Minimum gap required between a bookable slot and any busy block (padding around meetings). ≥ 0. |
| `min_notice_minutes` | integer | ❌ | `0` | Earliest bookable time relative to "now" (e.g. `120` = no slots within the next 2h). ≥ 0. |
| `max_slots` | integer | ❌ | `500` (soft cap) | Maximum number of slots to return (chronological). Guards against pathological output. |

**`working_hours` shape (LLM-friendly — proposed; see [OQ1](#open-questions-for-sa)):**

```json
{
  "time_zone": "America/New_York",
  "windows": [
    { "days": ["monday", "tuesday", "wednesday", "thursday", "friday"], "start": "09:00", "end": "17:00" }
  ]
}
```

- `time_zone` — IANA zone (e.g. `America/New_York`, `Europe/London`). Interprets every `start`/`end` wall-clock and the day boundaries. **Required** (no silent UTC default — a wrong tz silently produces wrong slots; fail loud per V6 Principle 2).
- `windows[]` — each rule: `days` (lowercase weekday names) + `start`/`end` as `"HH:MM"` **wall-clock in `time_zone`**. A weekday not covered by any window is unavailable. **Multiple windows may share a day** to express splits (e.g. a lunch break: one `09:00–12:00` window + one `13:00–17:00` window for the same day). This shape covers "Mon–Fri 9–5" in a single rule yet scales to per-day variation and intra-day breaks.

Rationale for array-of-rules over a weekday-keyed object (`{ monday: [...], ... }`): the array form is more compact for the dominant "same hours across several days" case (one rule lists all the days) and avoids duplicate-key ambiguity, while still supporting per-day and intra-day variation. Flagged as OQ1 for SA (keyed-object is the main alternative).

### Output schema

| Field | Type | Notes |
|---|---|---|
| `slots` | array of `{ start, end }` | Free bookable slots, RFC3339 UTC (`...Z`) instants, chronological. **Item annotated `x-semantic-type: "time_slot"`.** |
| `slot_count` | integer | `slots.length`. |
| `range_start` / `range_end` | string | Echoed. |
| `time_zone` | string | Echoed from `working_hours.time_zone`. |
| `slot_duration_minutes` | integer | Echoed. |
| `computed_at` | string | `x-guaranteed` ISO timestamp. |

Slots are emitted as **UTC `Z` instants** for cross-boundary unambiguity (consistent with the plugin's UTC convention; the tz is echoed so a caller can render locally). See [OQ3](#open-questions-for-sa) if SA prefers offset-preserving output.

**`common_errors`:** `auth_failed`, `calendar_not_found`, `invalid_time_range`, `invalid_working_hours`, `invalid_input`, `permission_denied`, `api_rate_limit`, `insufficient_permissions`.

### Pre-fetch validation guards (in-executor, fail fast before any network call)

- `range_start` / `range_end` present, valid RFC3339, `range_start < range_end` → else `invalid_time_range`.
- Bound the range span (proposed: reject > 92 days) → else `invalid_input`, to prevent pathological window expansion. (Reasoning, not a hard requirement — flag in OQ.)
- `slot_duration_minutes` present, positive integer → else `invalid_input`.
- `working_hours` present; `time_zone` a resolvable IANA zone (validated by attempting `Intl.DateTimeFormat(undefined, { timeZone })` in a try/catch); ≥ 1 window; each window `start`/`end` a valid `"HH:MM"` with `start < end`; `days` non-empty valid weekday names → else `invalid_working_hours`.
- `calendar_ids.length ≤ 50` → else `invalid_input`.
- `buffer_minutes` / `min_notice_minutes` / `max_slots` ≥ 0 when supplied → else `invalid_input`.

---

## The Slot-Math Algorithm

The correctness core. Described step-by-step; implemented in the pure module and unit-tested without network.

**Given (all resolved before the pure fn — the pure fn reads no clock and no network):**
`rangeStartMs`, `rangeEndMs` (epoch ms from RFC3339); `busyIntervals: {startMs,endMs}[]` (already fetched + merged across calendars, start/end only); `workingHours = { timeZone, windows:[{days, start, end}] }`; `slotDurationMs`; `bufferMs`; `earliestBookableMs` (= `nowMs + minNoticeMs`, computed in the executor and passed in — keeps the fn deterministic/testable); `maxSlots`.

1. **Expand working-hours into concrete dated windows across `[rangeStartMs, rangeEndMs]` in `timeZone`.**
   - Walk each calendar date `D` that overlaps the range, evaluated in `timeZone`.
   - Determine `D`'s weekday name in `timeZone`.
   - For each matching `windows[]` rule, convert (`D` + `"HH:MM"` wall-clock, interpreted in `timeZone`) → absolute UTC epoch for both `start` and `end`. **This wall-clock→UTC conversion is the only DST-sensitive step** (offset resolved per-instant → DST-correct). See [Timezone/DST handling](#timezonedst-handling).
   - Clip every produced window to `[rangeStartMs, rangeEndMs]`; drop empties.
2. **Merge + pad busy.** Sort `busyIntervals` by start, coalesce overlaps, then expand each merged block by `bufferMs` on **both** sides → "blocked" intervals. (Buffer semantic = padding around meetings; see [OQ7](#open-questions-for-sa).)
3. **Subtract blocked from each working window** (interval subtraction) → free sub-windows.
4. **Apply the earliest-bookable floor.** Drop any free sub-window ending `≤ earliestBookableMs`; trim the start of a straddling sub-window up to `earliestBookableMs`.
5. **Slice each free sub-window into fixed `slotDurationMs` chunks from the window start.** Emit a slot only if `slotStart + slotDurationMs ≤ subWindowEnd` — **no partial slot at the boundary** (the classic off-by-one). Advance by `slotDurationMs`. (Slots within a free window are contiguous/back-to-back; buffer is applied at busy boundaries in step 2, not between adjacent free slots — OQ7.)
6. **Collect chronologically; stop at `maxSlots`.** Format each as `{ start, end }` RFC3339 UTC.

**Correctness hotspots (where bugs live — each gets a targeted test):** window-boundary off-by-one (partial slot dropped, step 5); busy-block subtraction splitting a window into two (step 3); buffer padding removing adjacent slots (step 2); min-notice trimming (step 4); fully-busy → empty (steps 3/5); tz/DST wall-clock resolution (step 1).

### Timezone/DST handling

`date-fns` v4 is present but its **tz companion is not** (`date-fns-tz` / `@date-fns/tz` both absent). The only tz-sensitive operation is the wall-clock→UTC conversion in step 1. Two viable strategies — **this is the key OQ2 decision for SA:**

- **(A) Built-in `Intl.DateTimeFormat` (zero new dependency, recommended-with-caveat).** Resolve the UTC offset for a given instant in `timeZone` by formatting a candidate UTC time back through `Intl` with `timeZone` set and reading the parts, then adjusting — a standard "guess-and-correct" offset computation. DST-correct because the offset is queried per-instant. Caveat: the offset math is itself the single most bug-prone part of the slice, and DST-transition edge cases (a nonexistent spring-forward wall time; an ambiguous fall-back wall time) need an explicit policy (proposed: nonexistent → shift forward to the next valid instant; ambiguous → pick the earlier offset). Working windows (09:00–17:00) rarely touch the 02:00–03:00 transition, so this is a low-frequency but real edge.
- **(B) Add `@date-fns/tz` (small, official date-fns-v4 companion; needs SA sign-off).** `TZDate` gives a well-tested `zoned wall-clock ↔ UTC` conversion, eliminating the hand-rolled offset math (the highest-risk code). Not a "heavy" dependency — it is the sanctioned tz layer for the date-fns version already in the repo. The cost is one new dependency line.

**Dev recommendation:** given the task's heavy emphasis on slot-math correctness and that hand-rolled Intl offset math is the most error-prone code in the slice, **(B) `@date-fns/tz` is the lower-risk path** — but per the "no new dependency without SA sign-off" directive I am **not** adding it unilaterally. If SA prefers zero new dependencies, **(A) Intl** is fully workable with the DST-policy above and extra pure-fn test coverage. **Decision requested in OQ2.**

---

## Pure-Function Factoring

Per the requirement, the slot math is isolated into a **standalone, exported, network-free module** so it is unit-testable in isolation (same spirit as Sheets' `a1RangeToGridRange`, but a standalone module rather than a private method because it is substantially larger — [OQ5](#open-questions-for-sa)).

**`lib/server/calendar-slot-math.ts` (proposed exports):**

| Export | Purity | Responsibility |
|---|---|---|
| `computeAvailableSlots(input): {start,end}[]` | pure | Orchestrates steps 1–6. Reads no clock/network; `earliestBookableMs` + `nowMs` are passed in. |
| `wallClockToUtcEpoch(dateInZone, hhmm, timeZone): number` | pure | The DST-sensitive conversion (step 1). The one place tz strategy A-vs-B (OQ2) is implemented. |
| `expandWorkingWindows(...)` | pure | Step 1 — concrete dated windows across the range. |
| `mergeIntervals(intervals)` / `padIntervals(intervals, bufferMs)` | pure | Step 2. |
| `subtractIntervals(free, blocked)` | pure | Step 3. |
| `sliceIntoSlots(window, slotDurationMs)` | pure | Step 5 — boundary-safe slicing. |

The executor's `listAvailableSlots` method does only the impure edges: validate params → `fetchBusyIntervals` (shared freebusy helper) → compute `earliestBookableMs = Date.now() + minNoticeMs` → call `computeAvailableSlots` → shape the dual snake/camel output. All arithmetic lives in the pure module.

---

## V6 `time_slot` Type Registration Plan

Grounded in how `gmail_label` was registered (Phase 1 Gmail slice, commit `50cb848`; documented in `input-type-compat.ts` `TO_TYPE_EXTRAS` JSDoc + OQ7).

**Determination — is `time_slot` a bindable input type, an output-leaf, or both?**

A `time_slot` is **produced** by `list_available_slots` (the `slots[]` items). Downstream, a chosen slot's `start`/`end` would feed into `create_event.start_time` / `end_time` — which are **plain RFC3339 string params with no `from_type` constraint**. So a `time_slot` is consumed downstream only as plain strings, **never as a bindable input entity**. This is exactly the `gmail_label` situation (produced as a typed object, consumed as a plain string id/name).

**Plan (keep it type-clean — only what a real binding need requires):**

1. Add `'time_slot'` to **`TO_TYPE_EXTRAS`** (the producer/output-only list) in `input-type-compat.ts` — **NOT** to `FROM_TYPE_VALUES`.
2. Add **no `TYPE_COMPAT` edges** — there is no `from_type` requirement that `time_slot` must satisfy (no consumer declares a `time_slot` input). Adding edges would create input-binding surface with no consumer (over-registration).
3. Annotate the `list_available_slots` output slot items with `x-semantic-type: "time_slot"` in the definition JSON, so the type is grounded in a real producer (and so the validator recognizes it).
4. Extend the `TO_TYPE_EXTRAS` JSDoc with a `time_slot` note mirroring the `gmail_label` explanation (output-leaf; consumed downstream only as plain start/end strings; no edges).
5. Run **`validatePluginTypeAnnotations`** to confirm the new annotation resolves against `KNOWN_SEMANTIC_TYPES` and nothing unknown slipped in. `KNOWN_SEMANTIC_TYPES` derives from `TO_TYPE_EXTRAS` automatically, so step 1 makes the validator pass.

This is the minimal, type-clean registration: a real producer annotation + a single output-leaf registry entry, no speculative input-binding edges. If SA sees a genuine near-term binding need (e.g., a Phase 3 booking action that will declare a `time_slot` input `from_type`), the `TYPE_COMPAT` edges can be added then, driven by that real consumer — [OQ8](#open-questions-for-sa).

---

## Task List

**Pure slot-math module (`lib/server/calendar-slot-math.ts`)**
- [x] Create the module with the exports in [Pure-Function Factoring](#pure-function-factoring); reads no clock/network.
- [x] Implement `wallClockToUtcEpoch` per the SA-chosen tz strategy (OQ2 → rule A, built-in `Intl`), with the guess-and-correct structure + DST-transition policy (CR-1).
- [x] Implement steps 1–6 (`expandWorkingWindows` with same-day union CR-2, `mergeIntervals`/`padIntervals` with re-merge CR-3, `subtractIntervals` overlap-tolerant, `sliceIntoSlots` boundary-safe, orchestrator with `maxSlots` cap). Pure fn takes `earliestBookableMs` only — no `nowMs` (CR-5).

**Executor (`google-calendar-plugin-executor.ts`)**
- [x] Extract a shared `private async fetchBusyIntervals(connection, { calendarIds, timeMin, timeMax, timeZone })` helper (POST `/freeBusy`, start/end-only privacy map, per-calendar errors surfaced, only top-level `!response.ok` throws); refactored `getFreeBusy` to call it (OQ4). `getFreeBusy` output contract preserved exactly (CR-4 regression test added).
- [x] Add `list_available_slots` switch case → `this.listAvailableSlots`.
- [x] `listAvailableSlots()` — pre-fetch guards → `fetchBusyIntervals` → flatten busy across calendars → `computeAvailableSlots` → dual snake/camel output (`computed_at`).
- [x] Confirmed file remains **0 `console.*`** (grep = 0).

**Definition JSON**
- [x] Added `list_available_slots` block (input schema incl. `working_hours` object shape, `x-dynamic-options` on `calendar_ids`, output_schema, `common_errors`, `idempotent:true`, `usage_context` incl. the "reports availability, does not reserve" + buffer-semantic notes).
- [x] Annotated output slot items with `x-semantic-type: "time_slot"`.
- [x] Bumped `plugin.version` `1.1.0` → `1.2.0`.

**V6 type registration**
- [x] Added `'time_slot'` to `TO_TYPE_EXTRAS` + JSDoc note (no `FROM_TYPE_VALUES`, no `TYPE_COMPAT` edges).
- [x] Ran `validatePluginTypeAnnotations` — 0 warnings for `google-calendar`.

**Wiring / UI**
- [x] Confirmed NO registry/manager change (auto-discovery).
- [x] Added 1 `PARAMETER_TEMPLATES` entry under `"google-calendar"` in `app/test-plugins-v2/page.tsx` (no new `console.*`).

**Tests** (see [Testing](#testing))
- [x] Pure-fn: 7 focused `calendar-slot-math.test.ts` cases (6 + dedicated DST-transition case per CR-1).
- [x] Executor LEAN 3: happy + 401 + invalid-input in `google-calendar.test.ts` (+ CR-4 getFreeBusy regression assertion).
- [x] Integration: credential-gated `list_available_slots` case (skips without token).

**Docs**
- [x] Documented `list_available_slots` in `docs/plugins/google-calendar-plugin.md`; version-history row; version → `1.2.0`; Last Updated 2026-07-27.

---

## Testing

Follows the existing `tests/plugins/unit-tests/google-calendar.test.ts` harness + a new co-located pure-fn suite. **LEAN test policy (binding — user directive):** exactly 3 executor-level unit tests for the action, PLUS a focused pure-function slot-math set (the sanctioned exception, because the slot math genuinely needs coverage).

### Executor-level unit tests (exactly 3)

| Action | Happy path (fetch-mocked) | Auth failure | Invalid input |
|---|---|---|---|
| `list_available_slots` | `POST /freeBusy` 200 → busy subtracted from a working window → `slots[]` returned; `expectFetchCalledWith('/freeBusy','POST')` | 401 → `expectErrorResult` | missing `range_end` (or invalid `working_hours`) → validation error, **no network call** |

### Pure-function slot-math tests (`calendar-slot-math.test.ts`) — 6 focused cases

The exception to "minimal", justified because the algorithm is where the bugs live (tz/DST, off-by-one, subtraction, buffer). Kept tight:

| # | Case | Asserts |
|---|---|---|
| P1 | Fully-free working window, no busy | Slices into the exact expected count; the trailing partial slot is **dropped** (boundary off-by-one). Also asserts a **non-UTC `time_zone`** resolves to the correct UTC instants (tz correctness). |
| P2 | A busy block in the middle of the window | Free time **splits** into two runs; slots appear on both sides, none overlapping the busy block. |
| P3 | `buffer_minutes` around a busy block | Slots immediately adjacent to the busy block are removed (padding applied on both sides). |
| P4 | `min_notice_minutes` floor | Slots starting before `earliestBookableMs` are dropped; a straddling window is trimmed. |
| P5 | Fully-busy window | Empty result (`[]`), no throw. |
| P6 | `max_slots` cap | Returns exactly `max_slots`, chronological (earliest first). |

DST-transition edge coverage: a spring-forward/fall-back assertion is folded into P1's tz check for the recommended strategy; if SA selects the tz library path (OQ2-B), one dedicated DST-transition case is added (the expected UTC values depend on the chosen strategy, so it is finalized post-OQ2). Kept at 6 to honor the "tight (~5–6)" directive.

### Scoped-runnable commands

```bash
# Pure slot-math (fast, no network, no mocks):
npx jest lib/server/calendar-slot-math.test.ts

# Executor LEAN 3 (+ existing Calendar suite stays green):
npx jest tests/plugins/unit-tests/google-calendar.test.ts
```

### Integration (credential-gated)

Add a `list_available_slots` case to the existing `tests/plugins/integration-tests/google-calendar.integration.test.ts` (skips without `GOOGLE_CALENDAR_TEST_TOKEN`; `google-calendar` already in `CREDENTIAL_MAP`). Assert the live call returns `{ start, end }` RFC3339 slots that fall inside the requested working-hours windows and do not overlap the primary calendar's busy blocks.

---

## Standards & Risks

- **Logging (Mandatory Rule 3):** `lib/server/google-calendar-plugin-executor.ts` is **0 `console.*`** (grep-confirmed) and stays 0 — new methods use `this.logger` only. The new `calendar-slot-math.ts` module is pure math with **no logging** (no `console.*` introduced). The touched `app/test-plugins-v2/page.tsx` has **pre-existing client-side `console.*` DEBUG logs** — the user's standing "leave as-is" call (it is a `'use client'` component where `createLogger` is server-only); **no new `console.*` added**. Only awareness item; no conversion unless the user decides otherwise.
- **OAuth scope:** ✅ **No new scope.** `freebusy.query` fits the granted `https://www.googleapis.com/auth/calendar`. Zero re-consent, zero re-verification.
- **Timezone/DST (top correctness risk):** isolated to `wallClockToUtcEpoch` in the pure module. Strategy A (Intl, zero-dep) vs B (`@date-fns/tz`, one small dependency) is [OQ2](#open-questions-for-sa) for SA — I do **not** add a dependency without sign-off. DST-transition policy (nonexistent→forward, ambiguous→earlier) documented; covered by pure-fn tests.
- **Correctness (off-by-one / subtraction / buffer):** the whole reason for the pure-fn factoring — each hotspot has a targeted test (P1–P6).
- **Idempotency / safety:** read-only computation → `idempotent:true`, no `rules.confirmations`. Reports availability, does **not** reserve; double-booking is Phase 3 (stated in `usage_context` so no caller treats a slot as held).
- **Privacy:** busy intervals are `start`/`end` only via the shared `fetchBusyIntervals` helper and are never surfaced in the output (only computed free slots are).
- **No hardcoding (V6 Principle 6):** slot math lives in the executor + pure module; no plugin-specific rules in any prompt or the compiler; the definition schema is the source of truth.
- **V6 type-cleanliness:** `time_slot` registered as an **output-leaf only** (`TO_TYPE_EXTRAS`, no edges), mirroring `gmail_label` — the minimum a real producer annotation requires. `validatePluginTypeAnnotations` run to confirm.
- **Repository/Supabase:** N/A — executor is stateless; no DB writes (Phase 3's `holds` state is the DB surface, out of scope).
- **Modifying shipped Phase-1 code:** extracting `fetchBusyIntervals` and refactoring `getFreeBusy` to use it touches committed Phase-1 code — [OQ4](#open-questions-for-sa). The alternative (a separate helper used only by the new action, leaving `getFreeBusy` untouched) duplicates the freebusy fetch + privacy map. Recommend the shared helper (single privacy-invariant enforcement point) but defer to SA given it re-touches shipped code.
- **Version reconcile:** JSON `plugin.version` and doc header both at `1.1.0` (no drift). Set both to `1.2.0` in the same change.

---

## Open Questions for SA

1. **`working_hours` input shape (must-answer).** Proposed: `{ time_zone: IANA, windows: [{ days: [weekday names], start: "HH:MM", end: "HH:MM" }] }` (array-of-rules; multiple windows may share a day for lunch breaks; days not covered = unavailable). Main alternative: a weekday-keyed object `{ monday: [{start,end}], ... }`. **Recommendation: array-of-rules** (compact for the common "Mon–Fri same hours" case, no duplicate-key ambiguity, still supports per-day + intra-day variation). Confirm the shape.
2. **Timezone/DST strategy (highest-risk decision).** (A) built-in `Intl.DateTimeFormat` offset math (zero new dependency, but the offset/DST-transition code is the most bug-prone part), or (B) add `@date-fns/tz` (small official date-fns-v4 companion; eliminates the hand-rolled math; one new dependency). **Recommendation: (B)** for correctness, but **needs SA dependency sign-off**; (A) is fully workable with the documented DST policy + extra tests if SA wants zero new dependencies. Please decide.
3. **Output slot timezone representation.** Emit slots as **UTC `Z` instants** (recommended — unambiguous, matches the plugin's UTC convention, `time_zone` echoed for local rendering) vs. offset-preserving RFC3339 in the working-hours tz. Confirm UTC `Z`.
4. **Shared `fetchBusyIntervals` helper vs. leave `getFreeBusy` untouched.** Recommend extracting a shared freebusy helper that both `get_free_busy` and `list_available_slots` use (DRY; single privacy-invariant point) — but it re-touches shipped Phase-1 code. Confirm this is acceptable, or prefer a new-action-only helper that leaves `getFreeBusy` byte-for-byte unchanged.
5. **Pure-fn location: standalone module vs. private method.** Recommend a standalone exported `lib/server/calendar-slot-math.ts` (larger than `a1RangeToGridRange`; cleaner isolated test surface) vs. a private executor method tested via `(executor as any)` (closer to the `a1RangeToGridRange` precedent). Confirm the standalone module.
6. **Capability metadata.** Proposed `capability: "list"` (produces a collection of `time_slot` entities), `output_entity: "time_slot"`, `output_cardinality: "collection"`. `get_free_busy` used `capability: "get"`. Confirm `"list"` (or prefer `"get"`/a compute-style label).
7. **`buffer_minutes` semantic.** Defined as padding required **around busy blocks** (before/after meetings — the common Calendly meaning); slots within a free window remain contiguous/back-to-back. Alternative: also force a gap **between adjacent slots**. **Recommendation: busy-padding only** for v1; confirm (and whether inter-slot spacing is wanted).
8. **`time_slot` registration extent.** Recommend **output-leaf only** (`TO_TYPE_EXTRAS`, `x-semantic-type` on output items, **no `TYPE_COMPAT` edges**) — a slot is consumed downstream only as plain start/end strings, exactly like `gmail_label`. Confirm we should NOT add `FROM_TYPE_VALUES`/`TYPE_COMPAT` edges now (defer any input-binding edges to a real Phase-3 consumer).
9. **Range-span bound.** Propose rejecting a search window > 92 days (fail-fast against pathological expansion) with `invalid_input`. Confirm the cap (or drop it).

---

## SA Review Notes

_(SA to populate during workplan review.)_

---

## QA Testing Report

**QA — 2026-07-27**
**Test mode:** full (correctness-focused)
**Strategy used:** A (Jest unit — pure slot-math) + B (Jest executor unit with fetch-level mocking). Chosen because the slice is a pure deterministic algorithm (Option A) wrapped by an executor action with a mockable freebusy fetch (Option B). No E2E/DB surface (read-only, stateless). Integration case is credential-gated and skipped (no `GOOGLE_CALENDAR_TEST_TOKEN`).
**Focus:** api + schema (slot math, pre-fetch guards, getFreeBusy regression, determinism)
**Skipped:** live integration (credential-gated, no token in env — by design); E2E (no UI flow in this slice).
**Input source:** prompt keywords (QA task brief) + workplan QA scope.

### Actual test run (on record)

Command (exactly as specified, no `| tail`):

```
npx jest tests/plugins/unit-tests/calendar-slot-math.test.ts tests/plugins/unit-tests/google-calendar.test.ts --runInBand
```

Actual observed result (real numbers):

```
PASS tests/plugins/unit-tests/calendar-slot-math.test.ts
PASS tests/plugins/unit-tests/google-calendar.test.ts

Test Suites: 2 passed, 2 total
Tests:       40 passed, 40 total
Snapshots:   0 total
Time:        7.739 s
```

Green. The trailing `Jest did not exit one second after the test run has completed` line is a benign open-handle warning (async Pino/plugin-manager init), **not** a test failure — all 40 assertions passed. The `google-calendar.test.ts` suite carries the full 8-action Calendar coverage (Phase 1 actions + the 2 new `list_available_slots` cases + CR-4 regression + S1/S2); `calendar-slot-math.test.ts` carries the 7 pure-fn cases (P1–P7, P7 has 3 sub-assertions). Both new and pre-existing Calendar tests stay green.

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Fully-free window slices into exact count | ✅ | Pass | P1: Mon 09:00–11:00 EDT → exactly 4×30m slots; first/last instants exact; trailing partial dropped. |
| Non-UTC tz resolves to correct UTC instants | ✅ | Pass | P1 + P7 normal case: 09:00 EDT=13:00Z, 09:00 EST=14:00Z. |
| Mid-window busy block splits free windows | ✅ | Pass | P2: busy 14:00–14:30Z splits into 2 runs → 5 slots, none overlapping busy. |
| Buffer padding + re-merge (padded overlaps coalesce) | ✅ | Pass | P3: two blocks padded 20m overlap → re-merge to 13:40–15:50Z → 1 slot. Exercises CR-3. |
| min_notice floor trims straddling window | ✅ | Pass | P4: floor 13:45Z → 2 slots (13:45, 14:15); 14:45+30 dropped. |
| Fully-busy window → empty, no throw | ✅ | Pass | P5: `[]`. |
| Partial slot at boundary NOT emitted (off-by-one) | ✅ | Pass | P6: 110m window → 3 slots; 14:30–15:00Z asserted absent. |
| DST-transition day (US) correct instants | ✅ | Pass | P7: spring-forward gap 02:30→07:30Z (shift forward), fall-back 01:30→05:30Z (earlier offset), + normal offsets both seasons. |
| getFreeBusy regression preserved (CR-4) | ✅ | Pass | Privacy (`Object.keys===['start','end']` vs planted `summary:'LEAK'`), per-calendar `errors` passthrough, echoed wrapper + `queried_at`. S1/S2 stay green. |
| Pre-fetch guards reject before network | ✅ | Pass | Invalid-input (missing `range_end`) asserts `getAllFetchCalls()` = 0. Other guard branches (invalid range / end≤start / span>92d / slot_duration≤0 / missing time_zone) code-verified as throwing before `fetchBusyIntervals`. |
| Determinism (no clock/random in pure fn) | ✅ | Pass | grep of `calendar-slot-math.ts`: zero `Date.now`/`Math.random` (only a header comment mentions `Date.now()`). Executor computes `Date.now()+min_notice*60000` at the impure edge and passes `earliestBookableMs` in. |
| Happy path (fetch-mocked) returns UTC Z slots | ✅ | Pass | Executor happy case: `POST /freeBusy` → slots with `{start,end}` keys only, `.endsWith('Z')`, `slot_count===slots.length`, `time_zone` echoed. |
| 401 auth failure | ✅ | Pass | Executor 401 → `expectErrorResult`. |

### Verdicts (plain)

- **Slot math:** PASS. All six behavioral hotspots (slice, busy-split, buffer re-merge, min-notice, fully-busy-empty, boundary off-by-one) plus DST-transition instants assert correct values and run green. Hand-traced the P3 re-merge and P7 DST cases against the implementation — consistent.
- **getFreeBusy regression (CR-4):** PASS. The shared `fetchBusyIntervals` refactor preserves the contract exactly — busy-only privacy (planted `summary:'LEAK'` not leaked), per-calendar `errors` passthrough, echoed wrapper + `queried_at`. S1/S2 and the dedicated CR-4 assertion all green.
- **Pre-fetch guards:** PASS. The invalid-input test proves zero fetch on rejection (`getAllFetchCalls()` length 0). All documented guards are ordered before the `fetchBusyIntervals` call in `listAvailableSlots` (verified by reading lines 623–705).
- **Determinism:** PASS. Pure module reads no clock and does no I/O; `earliestBookableMs` is the only time input and is passed in.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. Pure in-memory math; single freebusy POST; 92-day span cap + `max_slots` bound pathological expansion.

#### Edge Cases (nice to fix)
None new. The SA Code Review's non-blocking nice-to-haves (eastern-hemisphere DST doc-comment nuance — zero functional impact, business-hours windows never land in the transition window; numeric-finiteness guards on buffer/min_notice/max_slots; `errors: any[]` typing; slot_duration number-vs-integer schema asymmetry) are acknowledged and **not** re-reported as new QA findings, per the task brief. None affects correctness of slot output.

### Test sizing (LEAN policy)
Within policy: 3 executor tests for the new action (happy + 401 + invalid-no-fetch) + 7 pure-fn cases (6 + dedicated DST-transition P7, the sanctioned CR-1 inflation) + CR-4 regression assertion + credential-gated integration. No tests added by QA — coverage is complete for the correctness-critical surface; no genuine gap found that would justify exceeding the policy.

### Final Status
- [x] All acceptance criteria pass — ready for commit (QA sign-off: **PASS**).
- [ ] Issues found — Dev must address before commit.

---

## Commit Info

_(RM to populate.)_

---

## SA Workplan Review

**Reviewed by SA — 2026-07-27**
**Status:** ✅ **Approved for implementation** (conditions folded in — see Required Changes; no second SA round-trip needed)

This is a strong, well-grounded workplan. The binding requirement constraints (in-executor slot math, new `time_slot` type, read-only/no-reservation, no new scope, no plugin-specific hardcoding) are all honored. The pure-function factoring and the deterministic `earliestBookableMs`-as-param design are exactly right. Approving with a small set of concrete, non-blocking changes the Dev folds in during implementation.

### Decisions on the 9 Open Questions

**OQ1 — `working_hours` shape → ✅ APPROVE array-of-rules (`{ time_zone, windows:[{days,start,end}] }`).**
More LLM-friendly than a weekday-keyed object: compact for the dominant "Mon–Fri same hours" case (one rule), no duplicate-key ambiguity, and it natively expresses intra-day splits (lunch break = two windows on the same day). `time_zone` **required** (no silent UTC default) is correct per V6 Principle 2 (fail loud). **Condition (CR-2):** overlapping/adjacent windows on the *same day* must be unioned before slicing, or slots get double-emitted where windows overlap — make `expandWorkingWindows` merge per-day windows (reuse `mergeIntervals`) before `sliceIntoSlots`.

**OQ2 — Timezone/DST strategy → ✅ RULE (A): built-in `Intl`, REJECT the `@date-fns/tz` dependency.**
Decisive reasons: (1) there is already a **house Intl idiom** for tz-aware date math — `lib/pilot/transforms/StructuredTransforms.ts:502` uses `Intl.DateTimeFormat(..).format()`/`formatToParts` for the WP-31 "today-in-tz" computation; adding `@date-fns/tz` would introduce a *new pattern* where a sanctioned one exists (Mandatory Rule 7). (2) A new dependency is a supply-chain touch; avoiding it means **no user sign-off gate and Dev can start immediately**. (3) The conversion is a bounded ~30-line helper that the pure-fn factoring makes fully unit-testable, including DST edges — so the "most bug-prone code" is also the most tested code. The dep would buy convenience, not safety we can't otherwise get. **Mandated structure for `wallClockToUtcEpoch(y,m,d,hh,mm,timeZone)`:**
  1. First guess `guess = Date.UTC(y, m-1, d, hh, mm)`.
  2. Resolve the tz offset at `guess` via `Intl.DateTimeFormat('en-US', { timeZone, hourCycle:'h23', year/month/day/hour/minute })` + `formatToParts`; reconstruct the wall-clock `guess` maps to in `timeZone`; the delta between desired and mapped wall-clock **is** the offset → `utc = guess - offset`.
  3. Re-derive the offset at `utc`; if it changed (a DST boundary was crossed), correct once more.
  4. **Explicit DST policy (documented in code):** nonexistent spring-forward wall time → shift forward to the next valid instant; ambiguous fall-back wall time → pick the **earlier** offset. Wrap the `timeZone` resolution in try/catch (invalid IANA zone → `invalid_working_hours`, consistent with the pre-fetch guard).
  **Condition (CR-1):** because this is the hand-rolled path, the pure-fn suite must include a **dedicated DST-transition test** (a spring-forward *gap* assertion **and** a fall-back *overlap* assertion) — not folded into P1. This raises the pure-fn set from 6 → **7 cases**. This is the single justified inflation; everything else stays LEAN.

**OQ3 — Output slot representation → ✅ APPROVE UTC `Z` instants.**
Unambiguous across boundaries, matches the plugin's existing UTC convention (`get_free_busy` echoes UTC), and `time_zone` is echoed so a caller can render locally. Offset-preserving output would re-introduce the ambiguity the `Z` form removes.

**OQ4 — Shared `fetchBusyIntervals` helper → ✅ APPROVE extraction (shared, single privacy-enforcement point).** DRY plus one enforcement point for the start/end-only privacy invariant outweighs the re-touch cost. **Condition (CR-4):** the helper must preserve `getFreeBusy`'s output contract **exactly** — the privacy map (copy `start`/`end` only), per-calendar `errors` surfaced as partial success, and only a top-level `!response.ok` throwing. The existing `get_free_busy` unit tests must stay green **and** add one explicit regression assertion that `get_free_busy`'s mapped output (incl. per-calendar `errors` passthrough) is unchanged. `list_available_slots` flattens + merges the per-calendar busy arrays itself (the helper returns the per-calendar privacy-mapped structure `getFreeBusy` shapes from).

**OQ5 — Pure-fn location → ✅ APPROVE standalone `lib/server/calendar-slot-math.ts` module.**
Substantially larger than `a1RangeToGridRange` and network-free; a standalone exported module gives a cleaner test surface than `(executor as any)` reflection. Same "pure + unit-testable without network" spirit.

**OQ6 — Capability metadata → ✅ APPROVE `capability:"list"`, `output_entity:"time_slot"`, `output_cardinality:"collection"`.**
The action produces a *collection* of typed slot entities, so `list` is the correct semantic (distinct from `get_free_busy`'s `get`, which returns a single busy structure). No amendment.

**OQ7 — `buffer_minutes` semantic → ✅ APPROVE busy-padding-only for v1.**
Padding around busy blocks (before/after meetings) is the standard Calendly meaning; slots within a free window stay contiguous. Inter-slot spacing is a separate concept — YAGNI for v1; do **not** add it. **Condition:** document the exact semantic in `usage_context` so the LLM/user isn't surprised.

**OQ8 — `time_slot` registration extent → ✅ APPROVE output-leaf only (confirmed NOT under-registering).**
Verified against `input-type-compat.ts`: `FROM_TYPE_VALUES` has **no** `time_slot`, and **no existing action declares a `time_slot` input `from_type`** (`create_event.start_time`/`end_time` are plain RFC3339 strings with no `from_type` constraint). So a `time_slot` is consumed downstream only as plain strings — exactly the `gmail_label` situation. Correct plan: add `'time_slot'` to `TO_TYPE_EXTRAS` only, `x-semantic-type` on the output slot items, **no** `FROM_TYPE_VALUES` entry, **no** `TYPE_COMPAT` edges, mirror the `gmail_label` JSDoc note, run `validatePluginTypeAnnotations`. Adding edges now would create input-binding surface with no consumer (over-registration). Defer any edges to a real Phase-3 booking consumer.

**OQ9 — Range-span bound → ✅ APPROVE reject > 92 days (`invalid_input`).**
A quarter is a sane ceiling; it bounds the date-walk expansion cost and complements `max_slots` (which bounds output, not expansion work). Make the error actionable and document the cap in the schema/`usage_context`.

### Plan Validation

| Area | Verdict | Note |
|---|---|---|
| Slot-math algorithm (steps 1–6) | ✅ | Sound. wall-clock→UTC correctly identified as the *only* DST-sensitive step. |
| Same-day window overlap | ⚠️ | **CR-2:** union same-day windows before slicing (else duplicate slots). |
| Buffer padding order | ⚠️ | **CR-3:** after expanding busy by `bufferMs`, padded blocks can newly overlap — re-merge after padding (or make `subtractIntervals` tolerate overlapping/unsorted blocked intervals). |
| Boundary-safe slicing (no partial slot) | ✅ | `slotStart + dur ≤ end` is the correct off-by-one guard. |
| min-notice floor | ✅ | Drop windows ending `≤ earliestBookableMs`, trim straddlers. Correct. |
| Pure-fn determinism | ✅ | `earliestBookableMs` passed in (no internal clock). **CR-5 (minor):** drop the unused `nowMs` param — the fn only needs `earliestBookableMs`; a second clock-input is misleading. |
| Privacy | ✅ | Busy = `start`/`end` only via shared helper; never surfaced in output. Preserved. |
| 0 `console.*` | ✅ | Executor confirmed 0; new pure module has no logging. `app/test-plugins-v2/page.tsx` pre-existing client-side `console.*` correctly left as-is per the user's standing `'use client'` exception (no new `console.*` added). |
| No hardcoding / V6 type-clean | ✅ | Slot math in executor+pure module; only V6 file touched is `input-type-compat.ts` (single source of truth). No prompt/compiler changes. |
| Version bump + no new scope | ✅ | JSON+doc `1.1.0 → 1.2.0`; `freebusy.query` fits granted `calendar` scope. |
| Test sizing | ✅ (amended) | 3 executor (happy/401/invalid) is right — don't inflate. Pure-fn set **6 → 7** (add the dedicated DST-transition case, CR-1). |

### Required Changes (fold in during implementation — no re-review needed)

- **CR-1** — Implement `wallClockToUtcEpoch` via the mandated Intl guess-and-correct structure + documented DST policy; add a **dedicated DST-transition pure-fn test** (spring-forward gap + fall-back overlap). Pure-fn set → 7.
- **CR-2** — Union overlapping/adjacent same-day working windows before slicing (no duplicate slots).
- **CR-3** — Re-merge blocked intervals after buffer padding (or make `subtractIntervals` overlap-tolerant).
- **CR-4** — Shared `fetchBusyIntervals` must preserve `getFreeBusy`'s contract exactly; keep existing `get_free_busy` tests green **and** add a regression assertion on its mapped output (incl. per-calendar `errors`).
- **CR-5** (minor) — Pure fn takes `earliestBookableMs` only; drop the unused `nowMs`.

### Dependency / User-Decision Note

**No new dependency is added** (OQ2 ruled to the zero-dep Intl path). Therefore **no user sign-off is required before Dev starts** — the only candidate user gate (approving `@date-fns/tz`) is eliminated by this ruling. The Phase-2 `gmail.settings.basic` user decision from the requirement is Gmail-only and does **not** apply to this Calendar slice (no new scope here). Dev is cleared to begin.

### Approval

- [x] Workplan approved — proceed to implementation with CR-1…CR-5 folded in.

---

## SA Code Review

**Code Review by SA — 2026-07-27**
**Status:** ✅ **Code Approved for QA** (no blocking must-fix; nice-to-haves listed below)

Diff scoped with `git diff` (ignoring pre-existing dirty `.claude/settings*`, `docs/architecture/`). Reviewed: `lib/server/calendar-slot-math.ts`, `lib/server/google-calendar-plugin-executor.ts`, `lib/plugins/definitions/google-calendar-plugin-v2.json`, `lib/agentkit/v6/capability-binding/input-type-compat.ts`, all four test/doc/page files. This is a clean, correctness-focused implementation. All five workplan-review conditions (CR-1…CR-5) are genuinely folded in and verified against the diff.

### Per-area verdict

| Area | Verdict | Note |
|---|---|---|
| **DST wall-clock→UTC (`wallClockToUtcEpoch`)** | ✅ (with a documented-policy caveat — see below) | Both asserted NY cases traced by hand and **confirmed**. Correct for every realistic (business-hours) input in **any** zone. |
| `getZoneOffsetMs` offset sign + midnight `%24` | ✅ | Offset sign verified (NY winter → −5h). `hourCycle:'h23'` never emits `"24"`; the `%24`/`Number.isFinite` guard is harmless defensive code (Dev flagged item 2 — acceptable as-is). |
| Slot math: expand / merge / pad+re-merge / subtract / slice / cap | ✅ | CR-2 same-day union (`mergeIntervals(dayWindows)`), CR-3 pad+re-merge (`mergeIntervals(padIntervals(...))`) + overlap-tolerant `subtractIntervals`, boundary-safe slice (`start+dur ≤ end`), min-notice floor, `maxSlots` early-return — all correct. No off-by-one found. |
| Determinism (CR-5) | ✅ | Pure fn takes `earliestBookableMs` only; no `Date.now()`/`Math.random()`/clock/IO in the module. Executor computes `Date.now() + min_notice*60000` at the impure edge and passes it in. `nowMs` correctly dropped. |
| `getFreeBusy` regression (CR-4) | ✅ | Shared `fetchBusyIntervals` preserves the contract exactly — privacy map copies **only** `start`/`end`, per-calendar `errors` surfaced as partial success, only top-level `!response.ok` throws, echoed wrapper + `queried_at` intact. The CR-4 regression assertion is real (asserts `Object.keys(busy[0]) === ['start','end']` against a planted `summary:'LEAK'`, plus `errors` passthrough and wrapper echo). Privacy invariant holds through the single shared enforcement point. |
| Pre-fetch guards | ✅ | Invalid RFC3339, `range_end ≤ range_start`, span > 92 days, `slot_duration ≤ 0` / non-integer, missing/invalid `working_hours.time_zone` (with `Intl` try/catch), window validation, ≤50 calendars, non-negative knobs — all reject **before** `fetchBusyIntervals`. The invalid-input unit test asserts `getAllFetchCalls()` is 0. |
| V6 `time_slot` registration | ✅ | Added to `TO_TYPE_EXTRAS` only; **not** in `FROM_TYPE_VALUES`; **no** `TYPE_COMPAT` edges; JSDoc mirrors `gmail_label`; `x-semantic-type:"time_slot"` grounded on a real producer. Not under-registering (no action declares a `time_slot` input from_type). No V6 anti-pattern introduced — the only V6 file touched is the single-source-of-truth registry. |
| Standards | ✅ | **0 `console.*`** in executor + new module (grep-confirmed). Pure module is strictly typed (no `any`). No hardcoded plugin rules leaked to prompts/compiler. Plugin JSON `1.2.0` + doc `1.2.0` + version-history row. No new OAuth scope (freebusy fits granted `calendar`). |
| Test sizing (LEAN) | ✅ | 3 executor (happy + 401 + invalid-no-fetch) + 7 pure-fn (incl. dedicated P7 spring-gap **and** fall-back cases) + CR-4 regression + credential-gated integration. Right-sized; each pure-fn assertion re-derived and confirmed (P1=4, P2=5, P3=1, P4=2, P5=0, P6=3 slots — all correct). |

### DST/timezone correctness — traced by hand

Both asserted cases **hold**:
- **Spring-forward gap, NY 2026-03-08 02:30 → 07:30Z:** `offset1(−5)` gives `utc1=07:30Z`; `offset2(−4)`; second guess `utc2=06:30Z` yields `offset3(−5)` — neither candidate self-consistent → gap → returns `utc1=07:30Z` (= 03:30 EDT, the forward-shifted instant). ✅
- **Fall-back overlap, NY 2026-11-01 01:30 → 05:30Z:** `offset1(−4)` gives `utc1=05:30Z`; `offset2` at 05:30Z is still `−4` → `offset1===offset2` → returns `05:30Z` (earlier/EDT occurrence). ✅

I also verified **valid times adjacent to a transition** (e.g. NY 05:00 on both transition days) are resolved correctly by the second-guess branch in **both** hemispheres — so no wrong instant is produced for any real slot boundary. Business-hours windows (09:00/17:00) never land in the 1-hour transition window, so the slot output is correct for every practical input in every zone.

**One concrete caveat (nice-to-have, NOT blocking):** the two *documented DST-transition policies* ("gap → shift forward", "ambiguous → earlier offset") only hold for **negative-UTC-offset (western)** zones. For **positive-offset (eastern hemisphere)** zones the guess-and-correct picks the opposite branch. Concretely:
- `wallClockToUtcEpoch(2026, 4, 5, 2, 30, 'Australia/Sydney')` (fall-back overlap) returns `2026-04-04T16:30Z` = the **later** (AEST +10) occurrence, whereas the "earlier offset" policy would give `15:30Z` (AEDT +11).
- `wallClockToUtcEpoch(2026, 10, 4, 2, 30, 'Australia/Sydney')` (spring gap) returns `2026-10-03T15:30Z` = 01:30 AEST, a **backward** shift, whereas the "shift forward" policy would give 03:30 AEDT.

Both returned values are still *valid* instants and, critically, this branch is only reachable for wall-clock inputs **inside the 1-hour transition window** — which business-hours `working_hours` never specify. So there is **no functional impact on slot output**; the defect is that the doc-comment overclaims universality. Recommend either (a) narrow the comment to "policy as-stated applies to western zones; eastern zones resolve to the opposite ambiguous instant, still valid", or (b) generalize the branch by comparing the two candidate offsets and explicitly selecting min/max per policy. Either is fine; I am **not** blocking on it.

### Must-fix (blocking)

**None.**

### Nice-to-have (non-blocking; Dev may fold in or defer)

1. **DST policy comment vs. eastern-hemisphere behavior** (above) — tighten the `wallClockToUtcEpoch` doc-comment, or generalize the branch. Optionally add one eastern-zone pure-fn assertion to pin the actual behavior.
2. **`buffer_minutes` / `min_notice_minutes` / `max_slots` finiteness** — guarded only by `< 0` + upstream schema typing, unlike `slot_duration_minutes` (which has an explicit `Number.isInteger`). A non-finite value would flow into the ms math. Low risk (schema validates `type:number`), but an explicit `Number.isFinite` guard would match the robustness of the slot-duration check.
3. **`PerCalendarBusy.errors?: any[]`** and the executor's `connection: any`/`parameters: any` — these continue the established file convention (explicit, not implicit, `any`), so not a strict-mode violation; a typed `errors` shape would be a small clarity win in the new helper only.
4. **Plugin JSON `slot_duration_minutes` is `type:"number"`** (input) while the output echo is `type:"integer"` (Dev flagged item 4). Runtime enforces integer via `Number.isInteger`. Harmless; aligning the input schema to `"integer"` would remove the input/output asymmetry. Non-blocking.

### Code Approved for QA: **Yes**

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-27 | QA test pass | Appended `## QA Testing Report`. Ran the scoped suite `npx jest tests/plugins/unit-tests/calendar-slot-math.test.ts tests/plugins/unit-tests/google-calendar.test.ts --runInBand` — **actual green run on record: 2 suites passed, 40 tests passed, 7.739 s** (the trailing "Jest did not exit" line is a benign async open-handle warning, not a failure). Verdicts all PASS: slot math (P1–P7: slice/split/buffer-re-merge/min-notice/fully-busy-empty/boundary-off-by-one + US DST-transition instants — hand-traced P3 re-merge and P7 gap/overlap), getFreeBusy CR-4 regression (privacy `['start','end']` vs planted `summary:'LEAK'`, per-calendar errors passthrough, echoed wrapper + queried_at, S1/S2 green), pre-fetch guards (invalid-input asserts zero fetch; all guards ordered before `fetchBusyIntervals`), determinism (no `Date.now`/`Math.random` in `calendar-slot-math.ts`; `earliestBookableMs` passed in at the impure edge). **No bugs found.** SA's non-blocking nice-to-haves (eastern-hemisphere DST doc nuance, numeric-finiteness guards, `errors: any[]` typing, slot_duration schema asymmetry) acknowledged and not re-reported. LEAN sizing honored; no tests added by QA. **QA sign-off: PASS — ready for commit.** |
| 2026-07-27 | SA code review | Appended `## SA Code Review`. Traced both DST cases by hand (NY spring-gap 02:30→07:30Z and fall-back 01:30→05:30Z — both confirmed). Verified CR-1…CR-5 in the diff, `getFreeBusy` CR-4 regression (privacy/errors/wrapper preserved via shared `fetchBusyIntervals`), determinism, pre-fetch guards (zero-fetch on invalid input), `time_slot` output-leaf registration (not under-registering, no V6 anti-pattern), 0 `console.*`, version 1.2.0, no new scope, LEAN test sizing (3 executor + 7 pure-fn + regression + gated integration). **No blocking must-fix.** One concrete nice-to-have: the documented DST-transition policies hold only for western (negative-offset) zones — for eastern zones (e.g. Australia/Sydney) the guess-and-correct selects the opposite ambiguous/gap instant; still a valid instant and unreachable by business-hours windows, so zero functional impact — recommend tightening the comment. **Code Approved for QA.** |
| 2026-07-27 | SA workplan review | Appended `## SA Workplan Review`. Resolved all 9 OQs: array-of-rules `working_hours` (✅, +union same-day windows); tz/DST → **rule (A) built-in `Intl`, reject `@date-fns/tz`** (house Intl idiom exists at `StructuredTransforms.ts:502`; avoids supply-chain touch + user gate) with mandated guess-and-correct structure, DST policy, and a dedicated DST-transition test (pure-fn set 6→7); UTC `Z` output (✅); shared `fetchBusyIntervals` (✅ + contract-preservation regression assertion); standalone `calendar-slot-math.ts` (✅); `capability:"list"` (✅); busy-padding-only buffer (✅); `time_slot` output-leaf only — verified no existing `time_slot` input consumer, not under-registering (✅); 92-day range cap (✅). 5 required changes (CR-1…CR-5) to fold in — no re-review. **Approved for implementation. No user decision needed before Dev starts** (zero new dependency; Gmail scope gate does not apply to this slice). |
| 2026-07-27 | Initial workplan | Dev drafted the Phase 2 Calendar slice: `list_available_slots` — one self-contained, read-only, in-executor slot-computation action over `freebusy.query` (per requirement OQ1: NOT freebusy + a generic `transform`). Proposed input/output schema incl. the `working_hours` array-of-rules shape (`{ time_zone, windows:[{days,start,end}] }`); the step-by-step slot-math algorithm (tz-aware working-window expansion → merge+pad busy → subtract → min-notice floor → boundary-safe slicing → max_slots cap); pure-function factoring into a standalone network-free `calendar-slot-math.ts` module; the `time_slot` V6 registration plan (output-leaf in `TO_TYPE_EXTRAS`, no `TYPE_COMPAT` edges, `x-semantic-type` on output items, run `validatePluginTypeAnnotations` — mirroring `gmail_label`). Standards: executor stays **0 `console.*`**; **no new OAuth scope** (`calendar` covers freebusy); JSON+doc version reconcile `1.1.0 → 1.2.0`. LEAN tests: exactly 3 executor unit tests (happy + 401 + invalid-input) + 6 focused pure-fn slot-math tests (boundary, busy-split, buffer, min-notice, fully-busy-empty, max_slots-cap, with tz correctness folded into the boundary case). 9 open questions for SA (working_hours shape, tz/DST strategy incl. possible `@date-fns/tz` addition, output tz representation, shared freebusy helper, pure-fn location, capability metadata, buffer semantic, time_slot registration extent, range-span bound). Workplan only — no implementation code. |
</content>
</invoke>
