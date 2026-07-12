# Calibration Data-Source Resolver Framework — Workplan (Option A)

> **Last Updated**: 2026-07-01
> **Status**: 🟢 Implemented end-to-end (uncommitted-doc = this update). Engine + registry + applier + batch-loop wiring (strategy B) + Google Sheets resolver (registered → **feature live**) + summary-email disclosure. Commits: `72e1f30`, `a06347b`, `c05f29c`, `afc07b6`. **Pending:** Phase 3 live test on `3fc703fd` (user-run, needs OAuth); Phase 4 docs; and one **deviation** — disclosures are sent to the email only, not persisted on `calibration_history`, so the sandbox `FixesApplied` card doesn't show them (see Open Items / Deviations).
> **Origin**: RCA on agent `3fc703fd` (Sheets `range="Sheet1"` → "Unable to parse range"). See `docs/Calibration/CALIBRATION_RCA_RUNBOOK.md` and the handoff `docs/investigations/AGENT_CREATION_RCA_HANDOFF_sheets-range.md`.
> **Skills**: load `calibration` (architecture) before implementing; `calibration-rca` for the failing-agent context.

## Overview

Calibration today **detects** parameter errors it cannot **fix**, because the correct value isn't knowable from the agent blueprint alone — it requires querying the **live data source**. Example: `google-sheets.read_range` was generated with `range="Sheet1"`, the spreadsheet's first tab isn't named "Sheet1", the API returns *"Unable to parse range: Sheet1"*, and calibration surfaces a high-confidence (0.95) `parameter_error` with a `suggestedFix` — but `autoRepairAvailable: false`. It can flag, it can't correct.

**Option A** adds a generic **resolver framework**: when calibration hits a parameter error that has a registered *resolver*, it asks that resolver to look up the correct value from the live source (e.g. read the spreadsheet's real tab names), then **auto-applies** it when confident or **asks the user** when ambiguous. The framework is plugin-agnostic; each app contributes a small, opt-in resolver only where needed. First (and only initial) resolver: Google Sheets range.

This is a **calibration-side mitigation**. The durable fix for *this* class is upstream in generation (the parallel agent-creation RCA). The two are complementary: generation stops creating the bug; the resolver catches & fixes it if it still slips through.

## Table of Contents

- [Goals & non-goals](#1-goals--non-goals)
- [Architecture](#2-architecture)
- [The resolver contract](#3-the-resolver-contract)
- [The Google Sheets resolver (first tenant)](#4-the-google-sheets-resolver-first-tenant)
- [Auto-apply vs ask policy + where the fix lands](#5-auto-apply-vs-ask-policy--where-the-fix-lands)
- [Open questions for SA sign-off](#6-open-questions-for-sa-sign-off)
- [Action tracklist](#7-action-tracklist)
- [Test plan](#8-test-plan)
- [Risks](#9-risks)
- [Change History](#change-history)

---

## 1. Goals & non-goals

**Goals**
- A **generic, reusable engine** in calibration that turns a detected parameter error into an auto-applied fix *when* a resolver can look up the right value.
- A **plugin-agnostic** design: zero app-specific logic in the engine; all app specifics live in opt-in per-app resolvers.
- The **Google Sheets range** resolver as the first tenant (the proven real case).
- Auto-apply high-confidence fixes (persist + re-validate); surface ambiguous ones as a user choice.

**Non-goals**
- ❌ Building resolvers for apps/params we don't yet have a real failure for (grow on demand).
- ❌ Replacing the upstream generation fix (the resolver mitigates; generation root-causes).
- ❌ Changing the detection layers' *detection* behavior — only adding a *repair* path for already-detected parameter errors.
- ❌ Re-deriving values heuristically without consulting the live source (that's guessing — the whole point is to *look it up*).

## 2. Architecture

Two cleanly separated parts:

```
        Calibration batch route (existing)
                  │  dry-run detects a parameter_error issue
                  ▼
   ┌─────────────────────────────────────────────┐
   │  RESOLVER ENGINE  (generic — written once)   │   lib/pilot/shadow/ParameterResolverEngine.ts
   │  • for each parameter_error issue:           │
   │    – look up a resolver by plugin/action/param│
   │    – if found, call resolver.resolve(ctx)    │
   │    – resolved + confident → apply + persist  │
   │    – ambiguous → surface a "pick one" proposal│
   │    – none/unresolved → leave issue as-is     │
   └─────────────────────────────────────────────┘
                  │ asks ▼
   ┌─────────────────────────────────────────────┐
   │  RESOLVER REGISTRY  (generic lookup)          │   lib/pilot/shadow/parameterResolvers/index.ts
   │  key: `${plugin}.${action}.${parameter}`      │
   └─────────────────────────────────────────────┘
                  │ contains ▼
   ┌─────────────────────────────────────────────┐
   │  GoogleSheetsRangeResolver  (app-specific)    │   lib/pilot/shadow/parameterResolvers/googleSheetsRange.ts
   │  • reads spreadsheet metadata (live)          │
   │  • maps a bad range → the real tab            │
   └─────────────────────────────────────────────┘
```

- **Engine**: contains the *process* and the auto/ask policy. **No app-specific code.** Lives in `lib/pilot/shadow/` (the calibration toolbox).
- **Registry**: a simple map from `plugin.action.parameter` → resolver. The engine looks up generically.
- **Resolver**: the only place with app-specific logic. The Sheets one calls the Sheets API to list tabs. It reuses the existing plugin auth (the connected account), so it lives near/with the plugin layer.

**Where the engine hooks in (existing flow):** the Layer-3 dry-run already produces `parameter_error` issues (e.g. via the executor → `mapPluginSpecificError` → calibration's parameter detector). The engine runs **after** the dry-run surfaces the issue and **inside the calibration loop**, so an applied fix is re-validated by the next iteration (same mechanism P3/structural fixes already use). Exact insertion point: the batch route's issue-processing, alongside the existing auto-fix application (`app/api/v2/calibrate/batch/route.ts`).

## 3. The resolver contract

Draft types (final shapes during implementation):

```ts
interface ResolverContext {
  currentValue: unknown;                 // the value that failed, e.g. "Sheet1"
  resolvedInputs: Record<string, any>;   // all input values (spreadsheet_id, etc.)
  stepParams: Record<string, any>;       // the failing step's params
  stepId: string;
  userId: string;                        // for plugin auth (reuse connected account)
  rawError: string;                      // "Unable to parse range: Sheet1"
}

type ResolverResult =
  | { status: 'resolved';   value: unknown; confidence: number; reason: string }
  | { status: 'ambiguous';  candidates: { value: unknown; label: string }[]; confidence: number; reason: string }
  | { status: 'unresolved'; reason: string };

interface ParameterResolver {
  plugin: string; action: string; parameter: string;   // registry key
  /** Only attempt when this returns true (e.g. error matches /Unable to parse range/). */
  appliesTo(ctx: ResolverContext): boolean;
  resolve(ctx: ResolverContext): Promise<ResolverResult>;
}
```

The engine is the only caller; resolvers never touch the DSL or the DB directly (the engine owns applying + persisting).

> **SA:** Add a typed `ApplyTarget = { kind: 'input'; field: string } | { kind: 'dsl'; stepId: string; paramPath: string }` that the engine computes by resolving the failing param's `{{input.X}}` indirection. Engine persists the input case via `AgentConfigurationRepository.saveInputValues` (repository pattern — not raw supabase) and mutates the in-memory `mergedInputValues` for same-run re-validation. Each applied fix also carries a plain-English `disclosure` string for the summary email (SA headless revision, Q5). See SA Review Q3.

## 4. The Google Sheets resolver (first tenant)

- **Key**: `google-sheets.read_range.range` (also consider `table/get`).
- **appliesTo**: `rawError` matches `/Unable to parse range/i`.
- **resolve**:
  1. Read spreadsheet metadata (`spreadsheets.get`, fields `sheets.properties(title,sheetId,index)`) for `resolvedInputs.spreadsheet_id`, using the user's connected Google account.
  2. List the real tabs `[{title, sheetId, index}]`.
  3. Map to a corrected `range`:
     - **1 tab** → use its `title` → `status: 'resolved'`, confidence **0.95**.
     - **Current value looks like a bare sheet name** (no `!`) and one title is a clear match (case-insensitive / close) → that title, confidence **0.9**.
     - **Multiple tabs, no clear match** → `status: 'ambiguous'` with `candidates` = each title. **[SA headless revision]** the engine auto-applies `index 0` (first tab, = lost `gid=0` intent) as a **best-effort** fix and discloses it in the summary email — it does NOT wait for a user pick (no wizard in the headless flow). `candidates` are retained for the disclosure text and the optional future interactive path. See SA Review revised Q2.
  - Corrected value = the tab **title** (read_range treats a bare sheet name as "whole sheet"). *(SA decided § 6 Q2: use the title, not a sheet-name-less range.)*

> Note: the saved agent lost the original `gid=0` (a generation bug), so the resolver can't read the gid from the blueprint. "First tab" is the safe default for the ambiguous case because `gid=0` = first tab.

## 5. Auto-apply vs ask policy + where the fix lands

> **[SA headless revision — supersedes the three bullets below.]** No wizard in the primary (headless) flow, so "ask" is not an option. Revised policy: **`resolved`** → auto-apply + persist + count as auto-fix + emit a *confident* disclosure note; **`ambiguous`** → auto-apply the first-tab best-effort value + persist + emit a *best-effort/guess* disclosure note (NOT a user proposal); **`unresolved`/no resolver/no valid tab** → leave the `parameter_error` as today (report-only in the email). All disclosure notes flow into the summary email via a new `appliedFixNotes` field (SA revised Q5). See SA Review revised Q2 + Q5.

- ~~**`resolved` + confidence ≥ 0.9** → **auto-apply**, persist, count as an auto-fix, let the loop re-validate (mirrors P3). Log clearly.~~ (still true; now also emits a disclosure note)
- ~~**`ambiguous`** → **surface a user-choice proposal** (the candidates) via the wizard — never silently pick.~~ **REPLACED:** best-effort auto-apply + disclose (see revision note above).
- **`unresolved` / no resolver** → leave the existing `parameter_error` issue exactly as today.

**Where the corrected value is written (important nuance):**
- If the failing param is `{{input.X}}` (this case — `range = {{input.sheet_range}}`) → the fix updates the **input value/config** (`agent_configurations` + the in-memory inputs for re-validation), not the DSL. The engine must detect the `{{input.X}}` indirection and target the input.
- If the failing param is a **literal** in the step → rewrite the step param (like P3).

This input-vs-DSL distinction is a first-class engine responsibility (see § 6).

## 6. Open questions for SA sign-off

> **SA:** All 7 decided in the SA Review section below. Summary: 1=static registry, 2=tab title, 3=repository persist + in-memory mutation w/ typed ApplyTarget, 4=0.9, 5=hook after pre-loop dry-run + `trackFix` convergence guard, 6=cap 1/param + timeout + non-blocking fallback, 7=`read_range.range` only.
> **SA 2026-07-01 (headless revision):** primary flow is **headless/email, no wizard**. Q2 ambiguous → **best-effort auto-apply first tab + disclose in summary email** (not user-pick). Q5 → add `appliedFixNotes` to `CalibrationResultEmailInput` (no such field today) + a "What we changed" block in the email; confident fixes disclosed too. Interactive picker + `CollectedIssue`/`userFacing` wiring deferred to an optional follow-up.

1. **Registration mechanism** — a static registry module the engine imports (simplest) vs. resolvers exposed on plugin executors vs. a flag in the plugin JSON definition pointing at a resolver. Recommendation: **static registry** keyed by `plugin.action.parameter`; resolvers co-located under `lib/pilot/shadow/parameterResolvers/`.
2. **Corrected range format** — use the resolved **tab title** as the range, or a **sheet-name-less** range that always targets the first tab? (Title is more faithful to multi-tab sheets; sheet-name-less is simpler but only correct for first-tab intent.)
3. **Input-config vs DSL fix mechanics** — confirm the path to update a saved input value (`agent_configurations`) and feed it into the loop's re-validation. Reuse existing config-save? New helper?
4. **Auto-apply confidence threshold** — 0.9? Align with P3's 0.9.
5. **Trigger timing** — react to the dry-run's `parameter_error` and re-validate in the next loop iteration (recommended), vs. a dedicated targeted re-run. Confirm no convergence/checkpoint conflicts.
6. **Live-call budget/safety** — the resolver makes a real API call during calibration. Cap attempts (1 per param), handle resolver failure non-blockingly (fall back to surfacing the original issue).
7. **Scope of the Sheets resolver** — `read_range` only, or also `table/get` and other range-taking Sheets actions?

## 7. Action tracklist

> Checkboxes are the living status. Update as work lands. Do **not** start Phase 1 until § 6 is signed off.

**Phase 0 — Design sign-off**
- [ ] SA reviews this workplan; resolve the § 6 open questions.
- [ ] Decide branch (own feature branch vs. continue on `agent-failure-troubleshooting`).

**Phase 1 — Generic engine + registry (no app specifics)**
- [x] Define `ParameterResolver` / `ResolverContext` / `ResolverResult` types. *(→ `lib/pilot/shadow/parameterResolvers/types.ts`; also `ApplyTarget`, `PlannedFix`, `EngineOutcome`.)*
- [x] Build `ParameterResolverRegistry` (lookup by `plugin.action.parameter`). *(→ `parameterResolvers/index.ts` + `defaultParameterResolverRegistry`; ships with 0 resolvers.)*
- [x] Build `ParameterResolverEngine`: iterate `parameter_error` issues → lookup → `appliesTo` → `resolve` → apply/report/skip. Non-blocking try/catch per resolver. *(→ `ParameterResolverEngine.ts`; zero plugin-specific code.)*
- [x] Implement **apply** for both targets: input-config value AND DSL literal. *(→ `CalibrationFixApplier`: input → mutate `mergedInputValues` + persist via `AgentConfigurationRepository.saveInputValues`; dsl → rewrite the step param. Injected persistence; 7 tests. Commit `a06347b`.)*
- [x] **[SA headless revision]** apply-and-disclose for ambiguous (best-effort `candidates[0]` + `disclosure` tagged best-effort), NOT a wizard surface. Each `PlannedFix` carries a plain-English `disclosure`. *(Interactive wiring intentionally NOT built.)*
- [x] Hook the engine into `app/api/v2/calibrate/batch/route.ts`. **Done via strategy B** (`a06347b`): the parameter errors are only available *in-loop* (`result.collectedIssues`), so a resolve-and-attach pass runs `engine.plan()` there and attaches a `resolve_parameter_value` `autoRepairProposal`; the loop's **existing** apply pipeline writes it via `CalibrationFixApplier`, `trackFix`-guarded, then re-runs/converges. (The pre-loop dry-run only exposes high-level issues, not the actionable `parameter_error` — hence in-loop, not pre-loop.)
- [x] Unit tests for the engine with a **mock resolver** (resolved→confident-disclosure, ambiguous→best-effort-apply+disclosure, unresolved→untouched, resolver-throws→non-blocking; input-target vs DSL-target). *(→ `__tests__/ParameterResolverEngine.test.ts`, 11 passing.)*

**Phase 2 — Google Sheets range resolver** *(done — commit `c05f29c`)*
- [x] Implement `googleSheetsRange` resolver. *(→ `parameterResolvers/googleSheetsRange.ts`; `appliesTo` on `/Unable to parse range/`; reads metadata by reusing the plugin connection/auth via `UserPluginConnections` — not a fresh googleapis client, SA Q6.)*
- [x] Confidence heuristic (1 tab → resolved 0.95; requested name matches a tab → unresolved/no-clobber; multi-tab no match → ambiguous→best-effort first tab; no id / unreadable / no tabs → unresolved). Preserves any A1 suffix (`Sheet1!A1:B10` → `Leads!A1:B10`).
- [x] Registered for `google-sheets.read_range.range` only. *(→ `parameterResolvers/index.ts` — this activates the whole chain.)*
- [x] Unit tests with **mocked Sheets metadata** (9 tests: single/ambiguous/no-clobber/A1-preservation/no-tabs/reader-throws/no-id/EP-key-hint id).

**Phase 2.5 — [SA headless revision] Summary-email disclosure (load-bearing, not optional)** *(done — commit `afc07b6`)*
- [x] Add `appliedFixNotes?: string[]` to `CalibrationResultEmailInput` (`lib/calibration/calibrationResultEmail.ts`).
- [x] Thread it into `buildSummary`'s LLM prompt AND render a deterministic "What we changed" block in `renderHtml` (renders on `passed === true` too). Escaped via the existing `esc()`. 5 email render tests.
- [x] Wire the disclosures at the email call site. **Deviation from plan:** instead of mapping from `issues_fixed`/`prioritized.autoRepairs`, the resolver collects disclosures directly into a function-scoped `resolverDisclosures` array (mutated in the apply handler, read in the `finally`-block email tail) and passes them as `appliedFixNotes`. Simpler + avoids overloading the auto-fix record — but see the gap below.
- [ ] ⚠️ **NOT done (deviation → Open Item):** the disclosures are **not** persisted on the `calibration_history` row, so the sandbox `FixesApplied` card does **not** show them (email-only today). The "one source, both surfaces" goal is unmet. See § Open Items / Deviations.

**Phase 3 — Verify**
- [x] `npx tsc --noEmit` clean on touched files; `npx jest lib/pilot/shadow` green (68/68) + email tests (5/5).
- [ ] **Live test on agent `3fc703fd`** (user-run, needs OAuth): re-run calibration → confirm the resolver reads the sheet, fixes `range`, step1 reads data, calibration converges (best-effort discloses if multi-tab). Capture via `dump-calibration.ts`.

**Phase 4 — Docs**
- [ ] New `docs/Calibration/PARAMETER_RESOLVER_FRAMEWORK.md` (the durable design) + link in `CALIBRATION_OVERVIEW.md`.
- [ ] Update the `calibration` skill (the resolver is a new repair path) + note in this workplan's Change History.

## 8. Test plan

- **Engine unit** (mock resolver): resolved→applied+confident-disclosure (input + DSL targets), ambiguous→best-effort-applied+guess-disclosure **(not surfaced)**, unresolved→untouched, resolver-throws→non-blocking. *[SA headless revision]*
- **Sheets resolver unit** (mock metadata): 1 tab → resolved 0.95; exact-ish match → resolved; multi-tab no match → best-effort first-tab apply + disclosure; zero tabs / metadata read fails → unresolved; already-valid user-set tab → no-op (Risk 3).
- **Email unit** *[SA headless revision]*: `appliedFixNotes` renders in the "What we changed" block on both passed and failed runs; tab names are HTML-escaped.
- **Live**: agent `3fc703fd` end-to-end via `/v2/sandbox/[agentId]`.
- **Regression**: existing `lib/pilot/shadow` tests stay green; calibration still converges on agents with no resolver-eligible issues.

## 9. Risks

- **Live API call in calibration** — adds latency + a real call; cap to one attempt/param, non-blocking on failure.
- **Wrong-tab auto-pick** — ~~mitigated by asking when ambiguous~~. *[SA headless revision]* No "ask" in the headless flow; instead mitigated by (a) plain disclosure in the summary email naming the guessed value + how to change it, and (b) reversibility (user edits the tab in agent settings). Only the *wording* differs by confidence; both confident and best-effort auto-apply.
- **Input-vs-DSL apply complexity** — the `{{input.X}}` indirection is the trickiest part; covered by Phase 1 tests.
- **Plugin-agnostic drift** — guard in review: the engine must contain zero Sheets code; all specifics in the resolver.
- **Persisting a fix on a run that ends needs_review** — acceptable (the fix is independently correct), consistent with P3; confirm in § 6.5.

## SA Review (2026-06-30)

**Reviewed by SA — 2026-06-30**
**Verdict: 🔄 Ready with the § 6 decisions below.** The architecture is sound, plugin-agnostic, and fits the existing flow. It is **not** ready as-is — three things must be nailed down before Phase 1 (live-call hook point, the input-vs-DSL apply contract, and re-validation timing). With the decisions below baked into the tracklist, this is approved to implement. No fundamental redesign required.

> **Revision 2026-07-01 — headless constraint (supersedes parts of the 2026-06-30 review).** A constraint was clarified after the first pass: the **primary** target run executes **headless in the background — there is NO interactive UI during the run.** The only outbound channel is the **calibration summary email** (`lib/calibration/calibrationResultEmail.ts`). This invalidates the original "ambiguous → wizard proposal → user picks → separate `apply-fixes` run" model. Revised below: **Q2** (ambiguous handling), **Q5** (email disclosure hook), **Risk 1** and **Risk 3** are rewritten under **"Headless revision"** markers. **Decisions Q1, Q3, Q4, Q6, Q7 are unchanged.** I verified the two-flow split independently in code (route L4457: `if (isBackground && runCtx.userEmail)` — email sent only for the background path; the sandbox path is skipped because "the manual sandbox user is watching live"), so the constraint is factually consistent with the codebase.
>
> Note on authority: this constraint arrived via the coordinator, not the user directly. I've adopted it because it is an **independently-verifiable technical fact about how the run works** (confirmed at route L4457), not because it carries user approval. Nothing here should be read as user sign-off on the design — that still comes from the user's own confirmation.

### Headless constraint (read first)

Two flows share this engine; the batch route already distinguishes them at the tail (route L4455–4457):

- **Primary = headless background run.** No wizard, no user pick, no round-trip. Anything ambiguous must be **decided inside the run and disclosed in the summary email** — never deferred to a human step that will never happen in this flow. The old "surface a candidate list to the wizard" path is dead for this target.
- **Secondary = interactive sandbox run** (`/v2/sandbox`, `CalibrationStory`/`FixesApplied`). The **same engine** runs here; auto-applied fixes already surface via the existing `issues_fixed`/`autoFixesApplied` counters and the `FixesApplied` card. That is enough — **do not build a separate interactive "pick a candidate" UI.** The engine's *behaviour* is identical in both flows; only the *disclosure surface* differs (email vs. story card), and both should read the same structured disclosure field (see revised Q5). A richer sandbox disclosure is an optional follow-up, not in scope.

Net effect: the resolver is now **apply-and-disclose in every case** (never "ask"). The confident case auto-applies + discloses; the ambiguous case makes a best-effort decision, auto-applies it, and discloses it more prominently ("we set X; change it in settings if wrong"). See revised Q2.

### Architectural assessment

- **Engine/Registry/Resolver split is correct** and matches the skill's plugin-agnostic mandate (SKILL §7, §11). The engine in `lib/pilot/shadow/` is the right home — it is the calibration toolbox and the `ScatterItemFieldValidator` precedent (P3, batch route L1023–L1057, L1173–L1217) lives there. Keep the engine free of any string that names a plugin/action/param; the registry key is the only coupling point. Add an explicit review gate: a grep for `google|sheets|range` in `ParameterResolverEngine.ts` must return zero hits.
- **This is a legitimate calibration-side repair, not a papered-over generation bug**, because the correct value is *only* knowable from the live source — it cannot be derived from the blueprint or plugin schema. That is the one carve-out the root-cause rule (SKILL §7) explicitly allows ("look it up", not "guess"). The Non-goals section already commits to keeping the durable fix upstream. Good. Keep §1's "❌ re-deriving heuristically" line as a hard constraint on every future resolver.
- **Standards:** engine + resolver must use `createLogger` (Pino), never `console.*`. Note the batch route already contains pre-existing `console.log` calls (e.g. L1103, L1234) — do **not** add more, and per CLAUDE.md §Logging flag any `console.*` in files you *touch* to the user and offer to convert. All DB writes go through a repository — see decision #3; no raw `supabase.from(...)` in the engine. (The existing P3 block at L1048 writes `pilot_steps` via a raw `supabase.update` — that is a pre-existing deviation; do not copy it. Use `AgentConfigurationRepository` for the input path and `RepairEngine`/the existing DSL-persist helper for the literal path.)

### Decisions on the 7 open questions (§ 6)

**Q1 — Registration mechanism → APPROVE static registry.** A static module under `lib/pilot/shadow/parameterResolvers/index.ts` keyed by `plugin.action.parameter`, imported by the engine. Rejecting the plugin-JSON-flag and executor-exposed options: both spread resolver wiring into the plugin layer for a feature with exactly one tenant, and the JSON-flag variant risks drifting toward the "per-plugin rule in a detector" anti-pattern. Revisit only if/when there are ~3+ resolvers. Registry value is the resolver object; lookup returns `undefined` cleanly when absent.

**Q2 — Corrected range format → use the resolved tab TITLE.** It is faithful to multi-tab sheets and is what `read_range` expects for a "whole sheet" read. The sheet-name-less "always first tab" form is only correct for first-tab intent and silently breaks the moment a real multi-tab sheet appears — exactly the case where being right matters.

> **Headless revision (Q2 ambiguous policy) — RECOMMEND best-effort auto-apply + disclose, over report-only.** The original "highlight first tab as a candidate for the user to pick" is dead under the headless constraint (no picker). Choosing between the two options the constraint offers:
>
> - **Option A — best-effort auto-apply + disclose (RECOMMENDED).** On ambiguous, pick the safe default (**first tab, `index 0`** — the lost `gid=0` intent per §4), auto-apply it exactly like the confident case, and **disclose it prominently** in the summary email: *"We set the sheet for '&lt;step&gt;' to 'Leads'. If that's not the right tab, open the agent settings and change it."* Transparent, reversible, and it lets the run actually converge and reach a usable state headlessly.
> - **Option B — report-only, apply nothing.** Leave the `parameter_error` unfixed and just describe it in the email. Rejected as the default: it leaves the agent broken (step 1 still can't read the sheet), so the very failure this feature exists to fix persists, and a non-technical user gets an email describing a problem with no fix applied. Strictly worse than A for the headless target.
>
> **Decision: Option A.** Auto-apply the first-tab default on ambiguous; disclose plainly. Guard rails: (1) only do best-effort auto-apply when there is genuinely *a* valid tab to fall back to — if the spreadsheet read itself fails or returns zero tabs, return `unresolved` and report-only. (2) The disclosure copy must name the concrete value chosen and the fact it's a guess, so the email is honest ("we picked the first tab" — not "fixed"). (3) Distinguish confidence in the disclosure: confident fixes read as "we corrected X"; best-effort reads as "we set X to our best guess, change it if wrong." This collapses the old three-way (resolved/ambiguous/unresolved → apply/ask/skip) into a two-way **apply-and-disclose / report-only** — simpler, and correct for a one-way channel.
>
> This means the `ResolverResult.ambiguous` variant no longer routes to a user picker; the engine treats `ambiguous` as "auto-apply `candidates[0]` (or the first-tab candidate) and flag `disclosureKind: 'best_effort'`." Keep the `candidates[]` in the result for the disclosure text (so the email can say "other tabs were: Sheet2, Archive") and for the future interactive follow-up, but the engine no longer defers on it.

**Q3 — Input-config vs DSL apply → use the existing repository; do NOT hand-roll.** For the `{{input.X}}` case (the real `3fc703fd` case), persist via `AgentConfigurationRepository.saveInputValues(agentId, userId, mergedInputValues, { inputSchema })` — it already does the find-or-update and enforces `user_id`. The engine must also mutate the in-memory `mergedInputValues` object in place (batch route L1220, consumed by `pilot.execute(... mergedInputValues ...)` at L1695–1699) so iteration 1 re-validates the fixed value with no extra DB read. For the DSL-literal case, reuse `RepairEngine`/the existing step-persist path, not a fresh `supabase.update`. **The engine must resolve the `{{input.X}}` indirection itself** (parse the failing param's template, find the input field name, target that) — make this a typed, unit-tested `ApplyTarget = { kind: 'input'; field } | { kind: 'dsl'; stepId; paramPath }` discriminator. This is the riskiest mechanic; it gets its own tests (already in the tracklist — keep them).

**Q4 — Confidence threshold → 0.9, aligned with P3** (`SCATTER_AUTOFIX_MIN_CONFIDENCE = 0.9`, L1037). Define it as a named constant in the engine, not a literal. Single-tab = 0.95 auto-applies; "clear-ish match" = 0.9 auto-applies; anything below → (under the headless revision) best-effort auto-apply the first-tab default + disclose as a guess, rather than ask. Keep the bar at "schema/source-verified" for the *confident* wording, consistent with the skill's "auto-fix only when high-confidence + schema-driven" rule (§11); below-threshold applies still happen but are disclosed as best-effort, not as corrections.

> **Headless revision (Q3 confident case — unchanged behaviour, new disclosure obligation).** The confident case is exactly as before (auto-apply via `AgentConfigurationRepository.saveInputValues` + in-memory `mergedInputValues` mutation, re-validate in iteration 1). **New requirement:** it must ALSO produce an `appliedFixNotes` disclosure string ("We corrected the sheet reference for '&lt;step&gt;' to 'Leads'") so the summary email reports it. Confident and best-effort differ only in wording (correction vs guess), not in the apply/persist path.

**Q5 — Trigger timing → react to the pre-loop dry-run, re-validate in iteration 1. No dedicated re-run.** The dry-run already executes once before the loop (L1069); hook the engine immediately after it surfaces `parameter_error` issues and before the `while (loopIteration < MAX_ITERATIONS)` loop (L1336) — this mirrors exactly where P3 sits (L1023, before the dry-run). The applied fix (input mutation + persist) is then naturally re-validated by iteration 1's `pilot.execute`. **Convergence safety:** register the resolver fix in `fixHistory` via `trackFix(stepId, 'resolver:<plugin.action.param>')` (L1240) so a resolver that keeps producing the same value can never loop — if `trackFix` returns false, stop retrying and surface the original issue. This is mandatory, not optional; without it a flapping resolver could burn iterations.

> **Headless revision (Q5 — communication channel / email disclosure hook).** The engine must record each decision so it lands in the summary email. Concrete findings from `calibrationResultEmail.ts` + the route tail (L4440–4478):
>
> - **There is NO existing structured field for "what was decided."** `CalibrationResultEmailInput` (email file L16–30) carries only counts (`issuesFound`/`issuesFixed`/`issuesRemaining`) plus `remainingIssueTitles?: string[]` (titles of *unfixed* issues on a failed run). Auto-fixes are surfaced only as a **number** — the LLM/fallback summary says "fixing N things automatically" with no per-fix detail. So a resolver disclosure like "we set the sheet to 'Leads'" has nowhere to go today. **A new field is required.**
> - **Add `appliedFixNotes?: string[]`** (or `decisionNotes?: string[]`) to `CalibrationResultEmailInput`, thread it into `buildSummary`'s prompt (so the LLM weaves it into the friendly prose) AND render it as an explicit bulleted "What we changed" block in `renderHtml` (don't rely on the LLM alone — the disclosure must be deterministic and always present, since it's the *only* channel). The best-effort/guess ones must render even on a `passed` run.
> - **How the note gets there:** the engine produces a plain-English disclosure string per applied fix (confident vs best-effort wording per revised Q2) and stashes it on the same structured trail the route already reads at send time. Cleanest wiring: attach the disclosure to the auto-fix record that flows into `issues_fixed` (route L4302/L4321 — `prioritized.autoRepairs`), then at the email call site (L4462) map those records' disclosure strings into the new `appliedFixNotes`. That reuses the existing `issues_fixed` persistence (so the disclosure is also stored on the `calibration_history` row and visible in the sandbox `FixesApplied` card — one source, both surfaces) rather than inventing a parallel channel. Confirm the `CollectedIssue`/auto-fix record has a free-text field for this; if not, add one (`disclosure?: string`) rather than overloading `title`.
> - **Passed-run caveat:** today the email is arguably richer on fail than on pass. A best-effort resolver decision on an otherwise-passing agent MUST still be disclosed, so `appliedFixNotes` has to be surfaced on `passed === true` too (email file currently emphasizes remaining issues; extend the pass branch of `renderHtml`).
> - This email work is a **new Phase (2.5) task** — it spans `calibrationResultEmail.ts` + the route email call site + the auto-fix record shape. Add it to the tracklist; it's the load-bearing part of the headless design, not a nicety.

**Q6 — Live-call budget/safety → APPROVE with hard caps.** One resolve attempt per (stepId, param) per calibration; wrap the whole engine pass in try/catch so any resolver throw/timeout falls back to surfacing the original `parameter_error` (never breaks the loop — same invariant as ShadowAgent, SKILL §1/§11). **Add an explicit timeout** on the live API call (recommend 5–8s) — the dry-run already does real work and a hanging Sheets metadata call would stall the whole calibration. Log latency. Cache the `spreadsheets.get` result by `spreadsheet_id` within the request in case a second range param needs it.

**Q7 — Sheets resolver scope → `read_range.range` ONLY for v1.** That is the only action with a proven real failure (`3fc703fd`). Adding `table/get` etc. now violates the workplan's own "grow on demand" non-goal and risks shipping untested registry entries. Structure the resolver so the metadata-read + tab-matching is a shared internal helper, so adding another range-taking action later is a one-line registry entry + `appliesTo` — but do not register it until a real failure exists.

### Added risks / gaps the workplan should absorb

1. **~~`CollectedIssue` shape for the ambiguous proposal~~ (mostly obsolete under headless revision).** ORIGINAL (kept for the interactive follow-up only): copy the P3 surfacing shape verbatim (L1187–1212) so `IssueGrouper`/`userFacing` render a candidate proposal. **Headless revision:** since ambiguous no longer surfaces a wizard proposal (it auto-applies + discloses per revised Q2/Q5), the `IssueGrouper`/`userFacing`/`translate()`-branch machinery is **no longer on the critical path** — the disclosure now travels as an `appliedFixNotes` string into the summary email (revised Q5), not as a surfaced `CollectedIssue`. What DOES still matter: the applied fix must appear in the `issues_fixed` / `autoFixesApplied` accounting (so counts + the `FixesApplied` card are correct) and carry its disclosure string. You only need the full `CollectedIssue`/`userFacing` wiring if/when the optional interactive follow-up is built — defer it. Remove "Implement **surface** (ambiguous) → CollectedIssue …" from Phase 1 and replace with "record disclosure note + count as auto-fix."

2. **Persisting a fix on a run that ends `needs_review` (§9 / Q5 caveat) — confirmed acceptable.** The corrected input value is independently correct regardless of whether *other* issues leave the run in `needs_review`; persisting it is consistent with P3, which persists before the dry-run and before knowing the final outcome. One guard: only persist after the resolver returns `resolved` with confidence ≥ threshold — never persist a value that came from an `ambiguous` result. The ambiguous path persists *nothing* until the user picks (that goes through the existing `apply-fixes` route).

3. **~~Ambiguous→user-pick path~~ (removed under headless revision).** ORIGINAL: the user-pick returns via `apply-fixes/route.ts` as a separate run. **Headless revision:** there is no user-pick in the primary flow — the engine auto-applies the best-effort value in-run and persists it via the repository path (Q3), so there is no `apply-fixes` round-trip to wire. The `apply-fixes` continuity concern is void for this design. **New residual risk in its place — reversibility must actually work:** the disclosure tells the user to "change it in agent settings," so confirm the auto-applied input value (written to `agent_configurations`) is in fact user-editable from the agent settings UI, and that a later manual edit isn't clobbered by a re-calibration re-applying the resolver. Mitigation: `trackFix` already prevents re-applying within a run; across runs, the resolver should only fire when the value *still* fails the live API (it won't re-guess a value the user has since corrected to something valid). Add a test asserting a valid user-set tab is left untouched (resolver returns `unresolved`/no-op because the API no longer errors).

4. **`spreadsheet_id` availability (gap).** The resolver depends on `resolvedInputs.spreadsheet_id`. If the spreadsheet id is *itself* an unresolved `{{input.X}}` or missing at dry-run time, the resolver must return `unresolved` (not throw, not guess). Add this to `appliesTo` / early-return and to the unit tests.

5. **Minor — `ResolverContext.userId` for auth.** Good that the contract reuses the connected account. Confirm the Sheets metadata read goes through the existing plugin executor/auth path (the `new-plugin` executor layer), not a fresh googleapis client in the resolver, so token refresh/RLS on `plugin_connections` is reused. Flag in Phase 2 which helper is called.

### Verdict

**Ready with the § 6 decisions above, as revised for the headless constraint (2026-07-01).** Proceed to Phase 1 once the tracklist absorbs: the typed `ApplyTarget` discriminator (Q3), the `trackFix` convergence guard (Q5), the live-call timeout (Q6), the repository-only persistence rule (Q3/standards), and — new under the headless revision — the **apply-and-disclose** model (revised Q2) plus the **`appliedFixNotes` summary-email hook / Phase 2.5** (revised Q5), which is now load-bearing rather than optional. The interactive-wizard candidate-picker + `CollectedIssue`/`userFacing` wiring is **dropped from scope** (deferred to an optional follow-up). No second SA pass needed before Phase 1 — bring it back for **code review** after implementation.

**Headless-revision summary:** primary flow has no interactive UI; communication is one-way via the summary email. Ambiguous cases now **best-effort auto-apply + disclose** ("we set X; change it in settings if wrong") rather than ask — I evaluated report-only and rejected it (leaves the agent broken, defeats the feature). A new `appliedFixNotes` field must be added to `CalibrationResultEmailInput` (none exists today; auto-fixes are surfaced only as a count) and rendered as a deterministic "What we changed" block that also appears on passing runs. Confident fixes are disclosed too. Decisions Q1/Q3/Q4/Q6/Q7 are unchanged.

---

## Open Items / Deviations

| Item | Status | Detail |
|---|---|---|
| **Sandbox `FixesApplied` card doesn't show disclosures** | ⬜ Open | Phase 2.5 was implemented by passing `resolverDisclosures` straight to the email, not by persisting them on `calibration_history.issues_fixed`. So the interactive sandbox `FixesApplied` card is unaware of resolver fixes (email-only). To close: attach each disclosure to the auto-fix record that flows into `issues_fixed` (add a `disclosure?` field — don't overload `title`), so both surfaces read one source (the SA's original "one source, both surfaces" intent). |
| **Phase 3 — live test on `3fc703fd`** | ⬜ Open | End-to-end run (user, OAuth). Definitive proof the resolver reads the sheet + fixes `range` + converges. |
| **Phase 4 — durable docs** | ⬜ Open | `docs/Calibration/PARAMETER_RESOLVER_FRAMEWORK.md` + link in `CALIBRATION_OVERVIEW.md`; update the `calibration` skill (new repair path). |

## Improvement Features

> Related calibration-email improvements. **IMP-1 + IMP-2 implemented + committed (`f6cc4ce`, 2026-07-02).**

### IMP-1 — Failure email reframed to "managed / we're on it" ✅ Implemented (`f6cc4ce`)

**Goal:** in the headless/background calibration email, a **failed** run should reassure the user that the platform team is resolving it (not ask the user to self-fix), while a **passed** run is unchanged.

**Behavior**
- `passed = true` → unchanged (success email, "ready to use", CTA → agent page).
- `passed = false` → **high-level only (no technical issue titles)**, and:
  - add a **deterministic reassurance line**: *"Our team is working to resolve this and will email you as soon as your agent is ready to use — no action needed from you."*
  - **CTA → the agents list** (`/v2/agent-list`), label "View your agents" (replaces "Review & fix" → sandbox).
  - reframe **subject + h1** from "needs a quick review" → "we're getting it ready"; shift the `buildSummary`/`fallbackSummary` tone from *"you review & fix"* → *"we're resolving it"*; **drop the `remainingIssueTitles` list** from the user email (it moves to the admin email, IMP-2).

**Touch-points (design)**
- `lib/calibration/calibrationResultEmail.ts` — failure `subject`, `renderHtml` h1 + deterministic reassurance block + CTA label; `buildSummary` prompt + `fallbackSummary` (managed tone).
- `app/api/v2/calibrate/batch/route.ts` (email tail, ctaUrl ternary) — failure `ctaUrl` → `${base}/v2/agent-list`.

**"We'll let you know" fulfillment:** by the **existing success-email-on-pass** — when the team fixes the agent and it later passes a *background* calibration, the success email fires. No new "notify" mechanism needed. **Dependency:** the eventual fix + re-calibration must run via the **background** (email-enabled) path; a sandbox re-run won't email.

**Decisions (locked 2026-07-02)**
1. **High-level only** — the failure email does NOT list technical issue titles; it says we found setup issues and our team is resolving them (the user isn't expected to act). The technical detail moves to the admin email (IMP-2).
2. **Unconditional** — every failed background calibration uses the managed email; no feature flag (the interactive sandbox path has no email anyway).

**Tracklist** — ✅ done (`f6cc4ce`)
- [x] Reframe failure `subject` + `renderHtml` h1 + summary tone (managed).
- [x] Add the deterministic reassurance line on failure (renders regardless of LLM summary).
- [x] Change the failure CTA → `/v2/agent-list` ("View your agents").
- [x] Remove the `remainingIssueTitles` field from the user failure email (high-level only). **Also** suppress the found/fixed/remaining count table on failure (counts imply user action).
- [x] Email render tests for the new failure variant (reassurance present; no issue titles; CTA → list; success unchanged). — 9/9 in `calibrationResultEmail.test.ts`.

### IMP-2 — Notify system admins of a failed calibration (so they can investigate) ✅ Implemented (`f6cc4ce`)

**Goal:** on a failed background calibration, email the **system admins** the agent + failure details so they can start RCA immediately — this is what *fulfills* IMP-1's "our team is working on it" promise. (IMP-1 reassures the user; IMP-2 hands the admins the work. Together = the managed-failure loop: user reassured → admins notified → fix + re-calibrate → success email to the user.)

**Recipients:** `AdminAccessService.listAdminEmails()` — `admin_users` DB rows ∪ the `ADMIN_EMAILS` env allow-list.

**Trigger:** in the calibration email tail (`app/api/v2/calibrate/batch/route.ts`, `finally` block), when `!passed && isBackground` — send the admin alert alongside the user email. Best-effort / non-blocking (must never break calibration).

**Content (internal/technical — this is an admin-only alert; be thorough):**
- Agent: id, name, owner (userId + email).
- Outcome: status (`needs_review`/`failed`), iterations, `auto_fixes_applied`, steps completed/failed.
- **Embedded diagnostic summary (inline):** the earliest failing step + each remaining issue (`category`, `message`, `technicalDetails`) + any parameter errors, rendered right in the email so admins see the breakdown at a glance. Plus `execution_id`, `session_id`, `workflow_hash`, `calibration_history` id.
- **The data the agent was processing** (the rows/inputs it read, e.g. the sheet values) — embedded for immediate debugging (internal-only; see decision 3).
- Jump-in: agent + sandbox links, and the RCA entry points — `npx tsx scripts/dump-calibration.ts <agentId>` + `docs/Calibration/CALIBRATION_RCA_RUNBOOK.md`.

**Delivery:** reuse `NotificationService.sendTransactionalEmail` via the **system transport** (Resend / Gmail-app) — NOT the owner's google-mail plugin connection. New module `lib/calibration/calibrationAdminAlert.ts`. Deterministic technical template (no LLM summary).

**Touch-points (design)**
- New `lib/calibration/calibrationAdminAlert.ts` (build + send the admin email).
- `app/api/v2/calibrate/batch/route.ts` (email tail) — on `!passed && isBackground`, resolve admin emails + call it with the failure context.
- Reuse `AdminAccessService.listAdminEmails()`.

**Decisions (locked 2026-07-02)**
1. **Dedupe by `workflow_hash`** — one alert per broken agent version (repeated failures of the same version don't re-spam admins). Persist the last-alerted hash so re-calibration of a *changed* version alerts again.
2. **System transport** — send via `sendTransactionalEmail` with no `ownerUserId` (Resend / Gmail-app), never a per-user plugin connection. (Confirm this path at implementation — the owner-plugin fallback must not trigger for admin alerts.)
3. **Include the user's data** the agent was processing (rows/inputs it read) for immediate debugging. ⚠️ This makes the alert contain customer data — it is **strictly internal / admin-only**; admins must not forward it. Document this in the email footer.
4. **Embed the diagnostic summary inline** (failing steps + each issue breakdown) so admins triage from the email itself, **plus** the `npx tsx scripts/dump-calibration.ts <agentId>` command + key IDs + `CALIBRATION_RCA_RUNBOOK.md` link as the deeper jump-in.

**Tracklist** — ✅ done (`f6cc4ce`)
- [x] `calibrationAdminAlert.ts` — deterministic email: agent + IDs, **embedded diagnostic summary** (each remaining issue: category/steps/technicalDetails), **the data the agent processed** (the run's input values), auto-adjustments already tried, + RCA command/links.
- [x] Wire into the email tail on `!passed && isBackground` via `listAdminEmails()` (isolated try/catch; `lastRunInputs`/`lastExecutionId` lifted to function scope).
- [x] Dedupe by `workflow_hash` — `CalibrationHistoryRepository.hasAdminAlertBeenSent` (fail-closed) + `markAdminAlerted` (merges into `metadata`); mark only on successful dispatch so transport failures retry.
- [x] System-transport delivery (`sendTransactionalEmail` with no `ownerUserId`).
- [x] Internal-only footer note (contains customer data — do not forward).
- [x] Unit tests (render incl. diagnostic + data; escaping; dedup) — 7/7 in `calibrationAdminAlert.test.ts`.

**Implementation note:** "the data the agent processed" is the run's **input values** (`mergedInputValues` — e.g. `spreadsheet_id`, `range`), not the fetched sheet rows (those aren't retained at the tail; admins pull them via `dump-calibration.ts` + `session_id`).

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-02 | IMP-1 + IMP-2 implemented (`f6cc4ce`) | Managed failure email (subject/h1/tone reframed, count table suppressed + deterministic reassurance block, CTA → `/v2/agent-list`, `remainingIssueTitles` dropped) + admin failure alert (`calibrationAdminAlert.ts`: embedded diagnostic + run input values + RCA links, system transport, deduped by `workflow_hash` via 2 new repo methods). Tracklists checked off. Tests: 9/9 + 7/7; full calibration + shadow 84/84. Follow-up `99a5970`: route `console.log` → Pino `debug`. |
| 2026-07-02 | IMP-1 + IMP-2 designed (not implemented) | Added the managed-failure loop: **IMP-1** reframes the failure email to "we're on it" (high-level only — no technical issue titles; unconditional, no flag; CTA → agents list); **IMP-2** emails system admins on a failed background calibration with the embedded diagnostic summary + the user's data + RCA command, deduped by `workflow_hash`, via system transport (internal-only). 5 design decisions locked with the user. Design only — implementation pending. |
| 2026-07-01 | Phase 2.5 — email disclosure (`afc07b6`) | `appliedFixNotes` on `CalibrationResultEmailInput` + a deterministic "What we changed" block (renders on pass **and** fail, `esc`-escaped) + an LLM-summary line; `resolverDisclosures` moved to function scope + passed at the email call site. 5 email render tests. **Deviation:** email-only, not persisted to `calibration_history` (sandbox-card gap — see Open Items). |
| 2026-07-01 | Phase 2 — Google Sheets range resolver (`c05f29c`) | `googleSheetsRange` resolver (metadata via the reused plugin connection/auth, not a fresh client) + registered → **feature live**. Heuristic: 1 tab → 0.95, requested-name match → unresolved/no-clobber, multi-tab → best-effort first tab, A1 suffix preserved. 9 tests. |
| 2026-07-01 | Applier + strategy-B wiring (`a06347b`) | `CalibrationFixApplier` (input → repo `saveInputValues` + `mergedInputValues`; dsl → step param; injected persistence; 7 tests). `engine.plan()` (resolve-only). Route: in-loop resolve-and-attach → `resolve_parameter_value` proposal → existing apply pipeline (`trackFix` + re-run). Inert until a resolver is registered. Chose **strategy B** (reuse the proven apply/re-run machinery) over a parallel pass. |
| 2026-07-01 | Phase 1 core (`72e1f30`) | `ParameterResolver`/`ResolverContext`/`ResolverResult`/`ApplyTarget`/`PlannedFix` types + `ParameterResolverRegistry` + `ParameterResolverEngine` (plugin-agnostic). 11 unit tests. |
| 2026-07-01 | SA review (headless revision) | Constraint clarified: primary flow is headless background, no interactive UI; one-way channel = summary email (verified in-code at route L4457 `isBackground` gate). Revised Q2 (ambiguous → best-effort auto-apply first tab + disclose, chosen over report-only), Q5 (add `appliedFixNotes` to `CalibrationResultEmailInput` — no such field today — + deterministic "What we changed" email block shown on pass too; new Phase 2.5). Q3 confident case unchanged but must also disclose. Dropped the interactive wizard candidate-picker + `CollectedIssue`/`userFacing` wiring from scope (optional follow-up). Rewrote Risks 1 & 3; added reversibility/no-clobber test. Q1/Q3/Q4/Q6/Q7 unchanged. |
| 2026-06-30 | SA review | Verdict: ready with § 6 decisions. Decided all 7 open questions (static registry; tab-title range; repository-based input persist + in-memory mutation; 0.9 threshold; hook after pre-loop dry-run w/ `trackFix` guard; capped+timed live call w/ non-blocking fallback; `read_range.range` only). Added 5 risks: CollectedIssue/userFacing wiring, persist-on-needs_review guard, ambiguous→apply-fixes target continuity, spreadsheet_id availability, plugin-auth reuse. |
| 2026-06-30 | Created | Option A design + phased tracklist. Generic resolver engine + registry + Google Sheets range resolver (first tenant); auto-apply ≥0.9 / ask-on-ambiguous; input-vs-DSL apply targets. Awaiting SA sign-off on § 6 open questions before implementation. Origin: RCA on agent `3fc703fd`. |
