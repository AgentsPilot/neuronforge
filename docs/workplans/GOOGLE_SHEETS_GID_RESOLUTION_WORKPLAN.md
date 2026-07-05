# Google Sheets gid Resolution — Workplan

> **Last Updated**: 2026-07-02
> **Owner**: Dev · **Status**: ⏸ **OPTIONAL / DEFERRED (2026-07-02).** SA-approved (with amendments A1–A8) and ready for Phase 1, but **demoted** after the Phase-2 pacing carve-out + Phase-3 backstop reached ~90% clean in smoke tests (see [EP_PRODUCTION_SHEETS_RANGE_FIX_WORKPLAN.md](./EP_PRODUCTION_SHEETS_RANGE_FIX_WORKPLAN.md)). This is the **deterministic** enhancement — build it only if the prompt mitigation + Option A safety net prove insufficient in production, or when arbitrary **non-zero gids** become a real need. Design remains valid; not started.
> **Requirement**: [GOOGLE_SHEETS_GID_RESOLUTION_REQUIREMENT.md](../requirements/GOOGLE_SHEETS_GID_RESOLUTION_REQUIREMENT.md)
> **Skills to load**: `agent-creation-flow` (Phase 3 EP), `v6-pipeline` (carry), `new-plugin` (plugin/executor). RCA context: `agent-creation-rca`.

## Overview

Carry the `gid` a user's spreadsheet URL already contains, end-to-end, and resolve it to the real tab **in the executor** (where the Sheets API exists) — eliminating the "guess the first tab / fabricate a name" behavior for URL-provided sheets. Four thin changes across the layers the value flows through, plus a shared metadata helper reused with Option A.

**Value path:** URL (Phase 2 answer) → **EP extracts gid** (v16 Phase 3) → **V6 carries gid** onto the step config → **plugin accepts `sheet_gid`** → **executor resolves gid→title** and reads the exact tab.

## Table of Contents

1. [Architecture & the value path](#1-architecture--the-value-path)
2. [Phased tracklist](#2-phased-tracklist)
3. [Layer detail + code anchors](#3-layer-detail--code-anchors)
4. [Shared helper (dedupe with Option A)](#4-shared-helper-dedupe-with-option-a)
5. [Test plan](#5-test-plan)
6. [Open questions for SA](#6-open-questions-for-sa)
7. [Risks](#7-risks)
8. [Rollout / flags](#8-rollout--flags)
9. [Change History](#change-history)

---

## 1. Architecture & the value path

```
Phase 2 answer: https://…/spreadsheets/d/<FILEID>/edit?gid=0#gid=0
        │
        ▼  (v16 Phase 3 — EP production)
resolved_user_inputs += { key: "google-sheets__table/get__sheet_gid", value: "0" }   ← FR1 (NEW)
        │
        ▼  (V6 — EnhancedPromptTransformer + DataSourceResolver)
step.config = { spreadsheet_id: "<FILEID>", range: "A:ZZ", sheet_gid: "0" }           ← FR2 (NEW field carried)
        │
        ▼  (plugin definition — read_range params)
optional param: sheet_gid (string, numeric tab id)                                    ← FR3 (NEW)
        │
        ▼  (executor readRange)
gid "0" → spreadsheets.get → title "Leads" → read "Leads!A:ZZ"                          ← FR4 (NEW)
```

Absence of a gid at any layer = today's behavior (clean no-op). No gid anywhere in the pipeline today (verified) — this adds one optional field per layer.

## 2. Phased tracklist

**Phase 0 — Design sign-off**
- [x] SA resolved §6 (2026-07-02): Q1 `sheet_gid`; Q2 first-class field (no generic map); Q3 separate param (not URL-passthrough); Q4 gid-wins + mandatory override warn; Q5 helper in Sheets/executor layer.
- [x] **A1 (blocking) — user approved reversing the 2026-07-01 "drop executor guard" decision** (2026-07-02, via "scope it properly"). RCA fix #3 reconciled accordingly.
- [ ] Decide branch (own `feature/sheets-gid-resolution` vs continue current). *(defer to implementation start)*

**Phase 1 — Executor + plugin (deepest layer first, independently testable)**
- [ ] Add optional `sheet_gid` to `read_range` params in `lib/plugins/definitions/google-sheets-plugin-v2.json` (numeric-string; document precedence over a name in `range`).
- [ ] **(A2)** Build the shared helper — `readSheetTabs(spreadsheetId, userId): { sheetId, title, index }[]` + `resolveSheetTab(tabs, { gid?, name? })` — in the **Sheets/executor layer** (e.g. `lib/server/googleSheets/sheetTabs.ts`), reusing `UserPluginConnections` + token refresh. The returned shape **MUST include `sheetId`** (Option A's `defaultReadSheetTabs` currently drops it at [googleSheetsRange.ts:142](../../lib/pilot/shadow/parameterResolvers/googleSheetsRange.ts#L142)). Refactor `defaultReadSheetTabs` into a thin adapter over this helper → one `spreadsheets.get` implementation. **Dependency invariant:** executor + Option A resolver import the helper; the plugin-agnostic engine NEVER does.
- [ ] In `readRange` ([google-sheets-plugin-executor.ts:60](../../lib/server/google-sheets-plugin-executor.ts#L60)): when `sheet_gid` present → resolve to title, prefix/replace the range's sheet part (preserve any A1 cell suffix via Option A's `rebuildRange` logic); gid-not-found → first visible sheet + `logger.warn`; no gid → unchanged.
- [ ] **(A3)** Guard: branch on `sheet_gid !== undefined && sheet_gid !== ''` — **never truthiness** (`gid=0` is the primary RCA case and must not be dropped). Make `gid=0` the **first** unit test.
- [ ] **(A4 / R1)** `readRange` has **no** metadata fetch today — this adds a new `spreadsheets.get` call site. Add: (a) 5–8s timeout on the metadata call; (b) per-run cache keyed by `spreadsheet_id`; (c) on metadata failure → first-visible + `logger.warn` and **still attempt the read** (never hard-fail on a metadata hiccup, AC5).
- [ ] Unit tests (mock metadata): **gid=0 → first-created tab (A3, first test)**; non-zero gid → correct tab; renamed tab (gid stable) → correct; invalid gid → first-visible + warn; metadata-call fails → first-visible + warn + read still attempted; no gid → passthrough.
- [ ] **(A8)** Executor `console.error` at [L247](../../lib/server/google-sheets-plugin-executor.ts#L247) is in `appendRows` (not edited here) — name it in the logging flag; convert only if user okays.

**Phase 2 — V6 carry**
- [ ] Add optional first-class `sheet_gid` field (Q2 — **not** a generic `extra_identifiers` map) to the data-source model + `DataSourceResolver` config output ([DataSourceResolver.ts:99](../../lib/agentkit/v6/compiler/resolvers/DataSourceResolver.ts#L99)). Add a one-line comment: "future URL-borne sub-ids (e.g. Docs tab) follow this same optional-field pattern."
- [ ] Thread it in `EnhancedPromptTransformer` ([L296](../../lib/agentkit/v6/utils/EnhancedPromptTransformer.ts#L296)) where `spreadsheet_id` is read from inputs — read `sheet_gid` alongside and write to config.
- [ ] **(A6 / R2)** Carry the gid as a **compile-time literal** in `config.sheet_gid` (the value is fully known at generation) — **do NOT** emit `"{{input.sheet_gid}}"` and rely on `reconcileInputsToDsl` stem-matching (`sheet_gid` has no `_id`/`_url` suffix, so it won't route). This sidesteps the WP-57 reconcile risk entirely. *(Only if path (b) — a user-editable gid input — is deliberately chosen, add a dedicated routing unit test.)*
- [ ] **(A6)** The field must be a **pure passthrough** in config — never a condition/branch in IR-conversion or the compiler (enforced by the A5 grep gate).
- [ ] **(A8)** Logging: `DataSourceResolver.ts` (**12** `console.*`) and `EnhancedPromptTransformer.ts` (**4** `console.*`) are non-compliant. Flag counts to the user; convert the edited files to Pino (`createLogger`) once approved; add no new `console.*`.
- [ ] Unit tests: gid present → carried to config as a literal; absent → config byte-identical to today (no-regression).

**Phase 3 — EP production (v16 prompt)**
- [ ] Update v16 Phase 3 URL-handling: when a Sheets URL has `gid`, emit `…__sheet_gid` in `resolved_user_inputs`; keep the name-less `range` (`A:Z`/`A:ZZ`) as the cell selector. Reuse the anti-fabrication rule already added (Part 1 of the sheets-range fix) — this gives the gid a real home so the model stops needing to guess a name.
- [ ] Faithful-replay smoke test (the `3fc703fd` harness): confirm the EP now emits `sheet_gid=0` + a name-less range, not `"Sheet1"`. Non-deterministic → 5+ runs.

**Phase 4 — Verify end-to-end**
- [ ] `npx tsc --noEmit` clean on touched files; `npx jest lib/pilot lib/agentkit/v6 lib/server` green for touched areas.
- [ ] **(A5) Plugin-agnostic grep gate:** a grep for `gid|sheet_gid` in the generic V6 IR-converter/compiler *branching* files and in `ParameterResolverEngine.ts` / `parameterResolvers/{types,index}.ts` must return **zero** hits (the field may pass through config as data, never as a condition, never in the engine). Mirrors the Option A gate.
- [ ] Live: re-create the `3fc703fd` agent from the gid URL → calibration passes, step 1 reads the right tab, **Option A best-effort guess does NOT fire** (AC6). Capture via `dump-calibration.ts` + `dump-agent-thread.ts`.

**Phase 5 — Docs**
- [ ] Update `docs/plugins`/Sheets plugin doc for the new `sheet_gid` param.
- [ ] Note in the Option A workplan that gid-carry is now the primary path; its first-tab fallback is the gid-less safety net.
- [ ] Update this workplan's Change History + the requirement status.

## 3. Layer detail + code anchors

| Layer | File(s) | Change |
|---|---|---|
| Plugin schema | `lib/plugins/definitions/google-sheets-plugin-v2.json` (read_range params [L57–106](../../lib/plugins/definitions/google-sheets-plugin-v2.json#L57-L106); actual optional param is `include_formula_values` at L92 — **not** `value_render_option`, A7) | Add optional `sheet_gid`. |
| Executor | `lib/server/google-sheets-plugin-executor.ts` (`readRange` [L60](../../lib/server/google-sheets-plugin-executor.ts#L60); metadata fetch [L722](../../lib/server/google-sheets-plugin-executor.ts#L722); `sheetId↔title` [L501–505](../../lib/server/google-sheets-plugin-executor.ts#L501-L505)) | Resolve gid→title; shared helper. |
| V6 carry | `lib/agentkit/v6/compiler/resolvers/DataSourceResolver.ts` [L99](../../lib/agentkit/v6/compiler/resolvers/DataSourceResolver.ts#L99); `lib/agentkit/v6/utils/EnhancedPromptTransformer.ts` [L296](../../lib/agentkit/v6/utils/EnhancedPromptTransformer.ts#L296); data-source model types | Carry `sheet_gid`. |
| EP production | `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt` (Phase 3) | Emit `sheet_gid` from URL. |

## 4. Shared helper (dedupe with Option A)

Option A's resolver already reads the same metadata: [googleSheetsRange.ts `defaultReadSheetTabs`](../../lib/pilot/shadow/parameterResolvers/googleSheetsRange.ts#L123) fetches `sheets(properties(sheetId,title,index))` — **but it drops `sheetId` when mapping to its `SheetsTab` type at [L142](../../lib/pilot/shadow/parameterResolvers/googleSheetsRange.ts#L142) (A2).** To avoid two implementations of the same `spreadsheets.get`:
- Extract a single `readSheetTabs(spreadsheetId, userId): { sheetId, title, index }[]` helper — the returned shape **MUST carry `sheetId`** (needed for gid matching). Reuse the plugin connection/auth path Option A already uses (`UserPluginConnections` with token refresh).
- **Home (Q5, SA-decided):** the **Sheets/executor layer** (e.g. `lib/server/googleSheets/sheetTabs.ts` or a module-level helper on the executor) — **never** under `lib/pilot/shadow/parameterResolvers/` (that would invert the dependency: executor → calibration).
- The **executor** imports it and uses it proactively (match by `sheetId === Number(sheet_gid)`).
- **Option A's `googleSheetsRange.ts`** imports it and uses it reactively (match by name / first-tab fallback); `defaultReadSheetTabs` becomes a thin adapter over it.
- **Invariant:** executor + resolver import the helper; the plugin-agnostic `ParameterResolverEngine`/registry/types NEVER do. One `spreadsheets.get`, two callers.

## 5. Test plan

- **Executor unit** (mock metadata reader): the five cases in Phase 1.
- **V6 unit**: gid carried to config when present; byte-identical config when absent (no-regression).
- **EP replay smoke**: `3fc703fd` harness, 5+ runs → `sheet_gid` emitted, no `"Sheet1"`.
- **Live E2E**: re-created `3fc703fd` agent → calibration clean, Option A guess not fired (AC6).
- **Regression**: name-based inputs unchanged; existing Sheets executor tests + `lib/pilot/shadow` green.

## 6. Open questions for SA

1. **Param name** — `sheet_gid` (recommended) vs `tab_gid` / alias `sheet_id`.
2. **V6 carry shape** — first-class `sheet_gid` field vs generic `extra_identifiers: Record<string,string>` (more reusable for future Docs tabs; larger surface). Recommend first-class now, note the generic seam.
3. **Separate param vs URL-passthrough** — new `sheet_gid` param (needs the V6 field) vs executor parsing the full URL from `spreadsheet_id` (no V6 field, but overloads `spreadsheet_id`). Recommend the explicit param; cleaner semantics.
4. **Precedence** — gid vs a conflicting sheet-name in `range`: gid wins; do we log/disclose the override?
5. **Shared-helper home** — where `readSheetTabs` lives so both the executor and Option A import one copy (avoid the plugin-agnostic engine importing Sheets code — keep it in the plugin/executor layer, Option A's resolver imports it, not the engine).

## 7. Risks

- **Extra live API call in the executor** — `spreadsheets.get` per read when a gid is present. Cap/cache per `spreadsheet_id` within a run; non-blocking fallback to first-visible on failure. (Mirrors Option A's Q6 timeout discipline.)
- **V6 surface creep** — adding a field to the data-source model touches intent→IR→compiler; keep it strictly optional and no-op when absent to avoid regressions. Strong no-regression tests.
- **Double-resolution with Option A** — once gid-carry lands, Option A shouldn't also fire for the same step. It won't: with a valid gid the read succeeds, so no `parameter_error` is raised → Option A never triggers. Confirm in the E2E.
- **Plugin-agnostic drift** — gid logic must stay in the Sheets plugin/executor + a clean optional carry in V6; **no `gid` string in the generic V6 compiler branches or the Option A engine.** Review gate: grep.

## 8. Rollout / flags

- No new feature flag (consistent with the agent-creation-flow FR10 posture): the param is optional and inert when absent, so the change is safe-by-default and rolls back via `git revert`. If SA prefers a guard for the V6 carry, gate only that behind an existing config — do not add a public `NEXT_PUBLIC_` flag.

## SA Review (2026-07-02)

**Reviewed by SA — 2026-07-02**
**Verdict: 🔄 Revision Required — approved-to-implement with the decisions + amendments below baked into the tracklist.** The 4-layer carry is the architecturally correct design (over URL-passthrough), it is plugin-agnostic, and it composes cleanly with Option A. It is **not** ready as-is: one policy conflict with the RCA must be reconciled up front, the V6 carry has a real reconciliation-mechanic gap the workplan only gestures at, and two files the implementation touches are `console.*`-non-compliant. With the five decisions and the tracklist amendments below, proceed to Phase 1. No fundamental redesign required. Bring it back for **code review** after implementation — no second design pass needed.

> **Reconcile with the RCA first (blocking pre-condition, not a redesign).** The originating RCA — [EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md](../investigations/EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md) fix #3 — states: *"A separate executor `gid→title` guard was **considered and dropped as redundant (user-approved, 2026-07-01)** — grow-on-demand: no distinct failure justifies a third implementation."* This workplan proposes exactly that executor guard plus three more layers. That is a legitimate evolution (the RCA dropped it as a *runtime-only* fix because Option A already covers the runtime; this workplan reframes it as the *deterministic-carry* fix that removes the guessing at the source, which the RCA's prompt-only #1/#2 admits is only "~4/6 correct"), **but the earlier decision carried explicit user approval.** Do not treat this workplan's existence as superseding that approval. **TL/BA must get the user's explicit go-ahead to reverse the 2026-07-01 "drop the executor guard" decision before Phase 1 opens.** I am not blocking on architecture here — I'm blocking on authority: a user-approved scope decision can only be reversed by the user. This is the single hardest gate in this review.

### Code verification (claims checked against the tree, not the workplan's prose)

| Claim | Verdict | Evidence |
|---|---|---|
| `read_range` has no gid/tab-id param (only `spreadsheet_id`+`range`+options) | ✅ **Confirmed** | [google-sheets-plugin-v2.json L57–106](../../lib/plugins/definitions/google-sheets-plugin-v2.json#L57-L106): properties are `spreadsheet_id`, `range`, `include_formula_values`, `major_dimension`. **Doc-drift note:** the workplan/table say `optional_params: ["value_render_option"]` and anchor L57–104, but the actual optional param is `include_formula_values` (L92) and there is no `value_render_option`. Fix the anchors + param name in §3 before Phase 1 so the Dev edits the right field. |
| `range` example leads with `Sheet1!` (the RCA's Pressure 2) | ✅ **Confirmed** | L81 `"e.g., 'Sheet1!A1:D10', 'Data!A:C', or 'B2:E5'"`. |
| Executor already fetches `sheetId+title` metadata so gid→title is cheap | ⚠️ **Confirmed elsewhere, NOT in `readRange`** | `list_sheet_names` [L711–755](../../lib/server/google-sheets-plugin-executor.ts#L711-L755) reads `sheets(properties(sheetId,title,index,…))`; `getSpreadsheetInfo` [L520–537](../../lib/server/google-sheets-plugin-executor.ts#L520-L537) and `createSpreadsheet` [L500–506](../../lib/server/google-sheets-plugin-executor.ts#L500-L506) also map `sheetId↔title`. **But `readRange` [L60–111](../../lib/server/google-sheets-plugin-executor.ts#L60-L111) does NOT** — it goes straight to `values/{range}`. So FR4 adds a *new* `spreadsheets.get` round-trip to the read path (see Risk R1). The mapping *shape* is proven; the *call site* is new. |
| `DataSourceResolver` L99 has no gid concept (`range: dataSource.tab ? … : 'A:Z'`) | ✅ **Confirmed** | [L99](../../lib/agentkit/v6/compiler/resolvers/DataSourceResolver.ts#L99). No `gid`/`sheetId` anywhere in `resolveTabularDataSource`. |
| `EnhancedPromptTransformer` L296 reads `spreadsheet_id` with no gid | ✅ **Confirmed** | [L296](../../lib/agentkit/v6/utils/EnhancedPromptTransformer.ts#L296) inside `extractSpreadsheetConfig`; sets `spreadsheet_id` and (L302–305) `range` from `sheet_tab_name`/`tab_name`/`worksheet`. Clean seam to add a `sheet_gid` read. |
| Option A already reads the same `spreadsheets.get` metadata (`defaultReadSheetTabs`) | ✅ **Confirmed, with a gap** | [googleSheetsRange.ts L123–144](../../lib/pilot/shadow/parameterResolvers/googleSheetsRange.ts#L123-L144) fetches `sheets(properties(sheetId,title,index))` — **but the mapped `SheetsTab` type (L24–27) only carries `title`+`index`; it DROPS `sheetId` at L142.** The shared helper MUST re-add `sheetId` to the returned shape for gid matching (see Amendment A2). |
| The generic engine stays plugin-agnostic; Sheets code only in the resolver | ✅ **Confirmed sound** | `ParameterResolver`/`ResolverContext` ([types.ts](../../lib/pilot/shadow/parameterResolvers/types.ts)) name no plugin; the registry ([index.ts](../../lib/pilot/shadow/parameterResolvers/index.ts)) keys by `plugin.action.parameter`. All Sheets specifics live in `googleSheetsRange.ts`. The shared-helper plan does not violate this **provided** the helper lives in the Sheets/executor layer and the resolver imports it (never the reverse). |
| §5 "Sheets is the only build-now case" | ✅ **Confirmed** | Docs `read_document` takes `document_id` only, no `tab` param (whole-doc read → soft, no hard failure). Drive/Calendar have no opaque URL sub-id gap. §5's table is accurate; grow-on-demand holds. |

### Architectural assessment — 4-layer carry vs URL-passthrough

**The 4-layer carry is the right design. Reject URL-passthrough.** This is the workplan's biggest fork (§6 Q3) and it is genuinely load-bearing, so the reasoning:

- **URL-passthrough overloads `spreadsheet_id` semantics at every layer that reads it.** `spreadsheet_id` is consumed as a bare id in at least four places I verified — `readRange` builds `${sheetsApisUrl}/${spreadsheet_id}/values/…` ([L67](../../lib/server/google-sheets-plugin-executor.ts#L67)), Option A's `pickSpreadsheetId` ([googleSheetsRange.ts L33–42](../../lib/pilot/shadow/parameterResolvers/googleSheetsRange.ts#L33-L42)) trims it as an id, `DataSourceResolver` writes `spreadsheet_id: dataSource.location` ([L98](../../lib/agentkit/v6/compiler/resolvers/DataSourceResolver.ts#L98)), and the plugin schema declares it `x-context-binding` key `spreadsheet_id`. Making it *sometimes a full URL* means every one of those must learn to strip `/d/<id>/…?gid=`. That is a larger, more fragile blast radius than adding one optional field, and it silently breaks any current agent that already stores a bare id next to a URL. The "avoids a V6 field" saving is illusory — you trade one clean optional field for URL-parsing scattered across the read path, the resolver, and the compiler.
- **The explicit `sheet_gid` param keeps each layer's contract honest** — `spreadsheet_id` stays a bare id, `range` stays A1, `sheet_gid` is the tab selector. It also generalizes: a future Docs-tab or any "URL carries a secondary id" case slots into the same "extract every id → carry as a structured param" pattern the requirement §5 identifies.
- **The carry is genuinely thin.** Verified: DataSourceResolver adds one optional config key; EnhancedPromptTransformer adds one `inputs.get('sheet_gid')` read; the plugin adds one optional property; the executor adds one resolve branch. The "V6 surface creep" risk (workplan Risk 2) is real only if the field leaks into IR-conversion/compiler *branching logic* — it must be a pure passthrough field, never a condition. Enforce with the grep gate (Amendment A5).

**One caveat that lowers the stakes of the whole design:** with a valid `gid` carried, the read succeeds on the first try, so `"Unable to parse range"` never fires and **Option A never triggers for that step** — the workplan's Risk "double-resolution" reasoning (line 116) is **correct and I verified the mechanism**: Option A's `appliesTo` is gated on `/Unable to parse range/i` ([googleSheetsRange.ts L62–64](../../lib/pilot/shadow/parameterResolvers/googleSheetsRange.ts#L62-L64)); a successful read raises no such error. gid-carry and Option A compose without contention. Option A correctly degrades to the gid-less safety net.

### Decisions on the 5 open questions (§6)

**Q1 — Param name → `sheet_gid`. APPROVED.** Unambiguous, matches the URL vocabulary the user pastes (`?gid=`), and won't collide with the existing `sheet_id`/`sheetId` fields the executor already emits in metadata responses ([L501/L558](../../lib/server/google-sheets-plugin-executor.ts#L501)) — reusing/aliasing `sheet_id` would be actively confusing because `sheet_id` in this codebase already means the *numeric sheetId in a metadata result*, and the executor's own output objects use `sheet_id` for exactly that. Reject `tab_gid` (invents a synonym for a term Google fixes as `gid`). Type: string (numeric-string, e.g. `"0"`) — `gid=0` is falsy-adjacent, so the executor must branch on `sheet_gid !== undefined && sheet_gid !== ''`, **never** on truthiness (a truthiness check would drop the single most common case, `gid=0` — the exact RCA scenario). Call this out in the Phase 1 acceptance.

**Q2 — V6 carry shape → first-class `sheet_gid` field NOW; no `extra_identifiers` map. APPROVED (as the workplan recommends).** A generic `extra_identifiers: Record<string,string>` is speculative generality for a one-tenant feature (§5 confirms Docs-tabs is latent, unproven). The requirement itself asks only for the "generalization seam," not the generic container. Deliver the seam as a **shape convention** (the executor's gid→title resolver is a reusable helper — Q5), not a generic map that every layer must now understand. Add a one-line code comment at the DataSourceResolver/EnhancedPromptTransformer carry point noting "future URL-borne sub-ids (e.g. Docs tab) follow this same optional-field pattern." Revisit the generic map only when a second real tenant appears.

**Q3 — Separate `sheet_gid` param vs URL-passthrough → separate param. APPROVED.** Full rationale in the Architectural assessment above. The explicit param is cleaner-semantics *and* smaller-blast-radius here; passthrough's only advantage (no V6 field) is outweighed by URL-parsing scattered across the read path, resolver, and compiler.

**Q4 — Precedence (gid vs conflicting name in `range`) → gid wins, and it MUST be logged/disclosed. APPROVED with a mandatory disclosure.** Faithfulness rule: the gid is what the user literally pointed at (requirement §3); a name in `range` is at best a stale second-hand label. So gid authoritatively selects the tab (FR5). **But a silent override is unacceptable** — when `sheet_gid` resolves to a tab whose title differs from the sheet-name already present in `range`, the executor must `logger.warn({ requestedName, resolvedTitle, gid }, 'sheet_gid overrode the range sheet-name')`. This is the same honesty discipline Option A applies to its best-effort path. Two sub-rules: (a) if the gid resolves to a title that **equals** the name in `range`, no warning (no conflict); (b) preserve any A1 cell suffix from `range` (`Foo!A1:D10` + gid→`Leads` = `Leads!A1:D10`) — reuse Option A's `rebuildRange` logic ([googleSheetsRange.ts L44–49](../../lib/pilot/shadow/parameterResolvers/googleSheetsRange.ts#L44-L49)); do not discard the cell range.

**Q5 — Shared-helper home → a new module in the Sheets plugin/executor layer; Option A's resolver imports it. APPROVED.** Put `readSheetTabs(spreadsheetId, userId): { sheetId, title, index }[]` and `resolveSheetTab(tabs, { gid?, name? })` in the **plugin/executor layer** (e.g. `lib/server/googleSheets/sheetTabs.ts` or a static method on the executor's module — Dev's call, but it must be server-side and Sheets-owned). Direction of dependency is the invariant: **the executor and Option A's `googleSheetsRange.ts` both import the helper; the plugin-agnostic engine/registry/types NEVER import it.** This preserves the exact layering the Option A SA review locked in ("the engine never hardcodes any plugin knowledge"). Do **not** place it under `lib/pilot/shadow/parameterResolvers/` — that folder is the calibration toolbox and importing it from the executor would invert the dependency (executor → calibration). The reader must reuse `UserPluginConnections` + token refresh exactly as `defaultReadSheetTabs` does today ([L123–144](../../lib/pilot/shadow/parameterResolvers/googleSheetsRange.ts#L123-L144)) — one auth path, one `spreadsheets.get`. After the helper lands, `defaultReadSheetTabs` becomes a thin adapter over it (mapping to the resolver's `SheetsTab` shape), so there is exactly one `spreadsheets.get` implementation.

### Added risks / gaps the workplan should absorb

**R1 — `readRange` gains a live `spreadsheets.get` on every gid read (new call site).** Verified: `readRange` has no metadata fetch today ([L60–111](../../lib/server/google-sheets-plugin-executor.ts#L60-L111)). Adding gid→title means one extra Google API round-trip per read *when a gid is present* (zero when absent — clean no-op, good). Mirror Option A's SA-Q6 discipline: (a) an explicit timeout (5–8s) on the metadata call; (b) cache the result by `spreadsheet_id` within the execution so a multi-read run pays once; (c) on metadata failure, fall back to first-visible sheet + `logger.warn` and **still attempt the read** — never hard-fail the step on a metadata hiccup (AC5). Add these three to Phase 1's tracklist explicitly.

**R2 — The V6 reconciliation mechanic is under-specified and is the riskiest carry step.** The workplan (line 63) says "confirm `sheet_gid` stem maps" but the mechanic is load-bearing and I verified it does **not** trivially work. `reconcileInputsToDsl` ([lib/pilot/reconcileInputsToDsl.ts](../../lib/pilot/reconcileInputsToDsl.ts)) routes a namespaced input key onto a step only where the step's config contains a matching `{{input.X}}` reference, disambiguated by `stemOf` which strips `_id`/`_link`/`_url` ([L47–50](../../lib/pilot/reconcileInputsToDsl.ts#L47-L50)). `sheet_gid` strips to `sheet_gid` (no suffix match) — so it will only route if the compiled step config actually emits `sheet_gid: "{{input.sheet_gid}}"`. **Decision the Dev must make explicit before Phase 2:** either (a) DataSourceResolver/EnhancedPromptTransformer write the gid as a **literal** into `config.sheet_gid` at compile time (simplest — the value is known at generation; no runtime reconciliation needed), or (b) they emit `config.sheet_gid = "{{input.sheet_gid}}"` and rely on `reconcileInputsToDsl` to route the namespaced input. **SA recommends (a) — write the literal.** The gid is fully known at generation time (it came from the URL in Phase 3), so there is no reason to defer it to a runtime input reference and take on the stem-matching risk. Path (b) only makes sense if the gid must remain a user-editable input; it need not be. Add "carry gid as a compile-time literal in config, not a `{{input}}` ref" to Phase 2, and drop the WP-57 reconcile dependency from the tracklist (line 63) unless the Dev deliberately chooses path (b) — in which case it needs its own unit test proving the route.

**R3 — Logging non-compliance in touched files (mandatory per CLAUDE.md §Logging).** The two V6 files this workplan edits are `console.*`-non-compliant: `EnhancedPromptTransformer.ts` has **4** `console.*` calls, `DataSourceResolver.ts` has **12** (e.g. [L74, L85, L89, L113, L119](../../lib/agentkit/v6/compiler/resolvers/DataSourceResolver.ts#L74)). The executor has **1** (`console.error` at [L247](../../lib/server/google-sheets-plugin-executor.ts#L247)) inside `appendRows`, which this workplan does not touch. Per the standing rule: **flag these to the user and propose converting the edited files to Pino (`createLogger`), proceeding once approved unless they decline.** At minimum, the lines the Dev edits must not add new `console.*`, and the Dev must surface the count. Do not silently leave a touched file non-compliant. (The executor's L247 is out-of-scope for edits but should be named in the flag for completeness; convert only if the user okays.)

**R4 — `write_range`/`append_rows` share the identical `range`-only gap but are explicitly out of scope (requirement §8).** Correct call (no proven failure, grow-on-demand). The only requirement on this workplan: design `resolveSheetTab` so wiring a write action later is a param-schema add + one executor branch, **not** a rewrite. The helper already naturally supports this. Do not register write actions now.

**R5 — Anti-fabrication prompt rule (Part 1 of the sheets-range fix) must stay.** The workplan's Phase 3 reuses it (line 67). Confirm the EP still emits a **name-less** `range` (`A:Z`/`A:ZZ`) alongside `sheet_gid` — never a fabricated `"Sheet1"`. If both `sheet_gid` and a real name coexist, Q4 precedence handles it; but the EP must not regress into authoring `"Sheet1"` because a gid is now "handled elsewhere." The FR12 6-run replay is the guard — keep the ≥5-run non-determinism check (Phase 3 tracklist).

### Tracklist amendments required before Phase 1

- **A1 (blocking, non-technical):** TL/BA obtain the **user's explicit approval to reverse the 2026-07-01 "drop the executor gid→title guard" decision** (RCA fix #3). Phase 0 must not close without it. *(New Phase 0 checkbox.)*
- **A2:** Shared helper (§4 / Q5) must return `sheetId` in its tab shape; extend `SheetsTab` (or the helper's own type) to `{ sheetId, title, index }` and refactor `defaultReadSheetTabs` (which currently drops `sheetId` at [L142](../../lib/pilot/shadow/parameterResolvers/googleSheetsRange.ts#L142)) to a thin adapter over the one helper. *(Amend Phase 1 helper task + §4.)*
- **A3:** Executor gid branch must test `sheet_gid !== undefined && sheet_gid !== ''` (never truthiness) so `gid=0` is honored; add the `gid=0` case as the first Phase 1 unit test. *(Amend Phase 1 tests — it's already listed, make the falsy-guard explicit.)*
- **A4:** Add R1's three safeguards (timeout, per-run cache, metadata-failure → first-visible + warn + still-read) to Phase 1. *(Amend Phase 1.)*
- **A5:** Add the plugin-agnostic **grep gate** to Phase 4: a grep for `gid|sheet_gid` in the generic V6 IR-converter/compiler *branching* files and in `ParameterResolverEngine`/`types.ts`/`index.ts` must return **zero** hits (the field may pass through config as data, but must never appear as a condition or in the engine). Mirror the Option A gate. *(New Phase 4 checkbox.)*
- **A6:** Phase 2 — carry the gid as a **compile-time literal** in `config.sheet_gid` (R2 path a); drop the WP-57 `reconcileInputsToDsl` stem-mapping dependency (line 63) unless path (b) is deliberately chosen (then add its own routing test). *(Amend Phase 2.)*
- **A7:** Fix the §3 doc-drift — `read_range` optional param is `include_formula_values`, not `value_render_option`; correct the anchor to L57–106. *(Amend §3 table.)*
- **A8:** Logging — flag the `console.*` counts (EnhancedPromptTransformer ×4, DataSourceResolver ×12, executor ×1) to the user and propose Pino conversion of the edited files. *(New Phase 1/2 checkbox.)*

### Verdict

**🔄 Revision Required → approved-to-implement once A1–A8 are absorbed.** The design is sound: the 4-layer carry beats URL-passthrough on both cleanliness and blast radius, it stays plugin-agnostic, and it composes with Option A (gid-carry pre-empts the parse error, so Option A never double-fires — verified). The five §6 decisions are: **Q1** `sheet_gid`; **Q2** first-class field now (no generic map); **Q3** separate param (not URL-passthrough); **Q4** gid wins + mandatory override warning; **Q5** helper in the Sheets/executor layer, resolver imports it (never the engine). The one genuine gate is **A1** — the RCA dropped this exact executor guard with *user approval* on 2026-07-01, so reversing it needs the user, not this workplan. Secondary must-fixes: the V6 carry should be a compile-time literal (A6, sidesteps the stem-matching risk), the shared helper must surface `sheetId` (A2), and the touched V6 files' `console.*` must be flagged (A8). No second SA design pass needed — bring it back for **code review** after implementation.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-02 | SA design review | Verified all 6 code claims (2 with caveats: `readRange` has no existing metadata fetch; `defaultReadSheetTabs` drops `sheetId`); ruled on all 5 §6 open questions (sheet_gid / first-class field / separate param / gid-wins+warn / helper in executor layer); flagged the RCA fix-#3 user-approval conflict as a blocking Phase-0 gate; added R1–R5 risks and A1–A8 tracklist amendments. Verdict: Revision Required → approved once A1–A8 absorbed. |
| 2026-07-02 | Amendments A1–A8 absorbed | User approved reversing the "drop executor guard" decision (A1); baked SA's 5 decisions + A2–A8 into the tracklist (sheetId in helper, gid=0 falsy-guard, metadata-call safeguards, compile-time-literal carry, grep gate, §3 doc-drift fix, logging flag). Status → Ready for Phase 1, HELD pending user go-ahead to code. |
| 2026-07-02 | Created | Phased workplan for end-to-end Sheets gid resolution (plugin → executor → V6 → EP), shared helper with Option A, SA open questions. Awaiting §6 sign-off. |
