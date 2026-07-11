# Workplan: V6 Field-Fidelity & Calibration Hardening — Phase 0 + Phase 1

**Developer:** Dev
**Requirement:** [/docs/requirements/V6_AI_DECLARED_TRANSFORM_SCHEMA_RECONCILIATION_REQUIREMENT.md](/docs/requirements/V6_AI_DECLARED_TRANSFORM_SCHEMA_RECONCILIATION_REQUIREMENT.md)
**RCA background:** [/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md)
**Date:** 2026-07-10
**Branch:** agent-failure-troubleshooting (current working tree — RM owns branch/commit)
**Status:** Code Complete (pending SA review)

> **SCOPE OF THIS TASK: Phase 0 (shared reconciliation core) + Phase 1 (calibration items 5, 6, 7 + calibration-side of 3) ONLY.**
> Phase 2 (plugin runtime clamp guard / Item 4) and Phase 3 (agent-creation items 1, 2, compiler-side of 3) are later, separately-reviewed phases and are **NOT** touched here.

## Analysis Summary

The RCA root cause: a generated `flatten` transform declares snake_case item fields (`mime_type`) while the producing Gmail action emits camelCase (`mimeType`). Nothing reconciles the declared field names against the plugin's real output schema, so the downstream filter matches nothing and the report is empty. Calibration failed for the wrong reason (a cosmetic hardcode nag + a false-positive broken-variable warning on the scatter `itemVariable`) while never naming the real defect.

This task builds:
- **Phase 0** — one deterministic, standalone reconciliation core (normaliser + producer-schema field extractor + reconciler), no call sites wired. Consumed by Phase 1 (Items 5b, 7, calibration-side of 3) and later phases.
- **Phase 1** — calibration items that consume the core: fix the false-positive loop-variable detector (5a), add a plugin-truth field-mismatch detector as a blocking issue (5b + calibration-side of 3), change the verdict model to key on issue CLASS with a coverage floor and new states (6), and add an in-place corrector that repairs stored workflows during calibration (7).

Touches: `lib/schema-reconciliation/` (new core), `lib/pilot/shadow/` (detectors, verdict, corrector, StructuralRepairEngine 5a fix), `app/api/v2/calibrate/batch/route.ts` (wiring), `lib/audit/events.ts` (new audit event).

## Cross-Cutting Constraints (restated per requirement §Cross-Cutting Constraints)

1. Schema-driven and generic only — ZERO plugin-name branches anywhere.
2. Deterministic fixes, not prompt nudges.
3. Derived-field survival — only fuzzy-overlapping fields are reconciled; no-counterpart fields left untouched.
4. Correct, don't merely warn (Item 7 rewrites; Item 3/5b flags as blocking).
5. One reconciliation core, four call sites — Phase 0 builds it once; Phase 1 wires two calibration call sites (detect + correct) into it. No duplicate copy.

## G1 (Anti-False-Success) obligations honoured here
- G1a — plugin-field-fidelity mismatch is a blocking-class issue (cannot be waved).
- G1b — verdict relaxation applies ONLY to non-blocking + user-confirm-only issues; blocking always prevents a pass.
- G1c — a run that never exercised the real path resolves to `inconclusive`, never a clean pass; Item 7's post-correction verdict caps at `corrected_not_verified` when the re-run still doesn't exercise the path.

## Implementation Approach

- **Phase 0 core** placed at a neutral, dependency-free home `lib/schema-reconciliation/` so both `lib/agentkit/v6/*` (later phases) and `lib/pilot/shadow/*` (this phase) consume the same module. Normaliser matches the existing O10a `normalizeForFuzzy` (lowercase + strip `_`/`-`). Reconciler classifies each declared field as `rename` / `keep` / `ambiguous` / `derived`; only `rename` (clearly-same-field, single unambiguous match) is actionable.
- **Verdict model** (Item 6): the DB `calibration_history.status` CHECK constraint only allows `success|failed|needs_review|verification_only` — I will NOT alter migrations. New verdict states (`inconclusive`, `corrected_not_verified`) map onto the DB `needs_review` status while the precise verdict is carried in `metadata.verdict` and the API response. Flagged as a decision for SA (verdict-state plumbing open question).
- **Route wiring** kept additive and non-blocking (own try/catch) to avoid destabilising the 4.8k-line calibration route; the single existing-logic change is the verdict decision (inverted-logic fix + class-based relaxation) and the success-branch coverage floor.

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/schema-reconciliation/field-name-normalizer.ts` | create | Shared fuzzy normaliser (Phase 0), replaces triplicated inline copies |
| `lib/schema-reconciliation/schema-field-extractor.ts` | create | Walk a plugin output_schema tree → normalized→canonical field map + ambiguity set |
| `lib/schema-reconciliation/reconciler.ts` | create | Deterministic reconciler (rename/keep/ambiguous/derived) |
| `lib/schema-reconciliation/index.ts` | create | Public surface + types |
| `lib/schema-reconciliation/__tests__/*.test.ts` | create | Phase 0 unit tests |
| `lib/pilot/shadow/PluginFieldFidelityValidator.ts` | create | Item 5b + calibration-side Item 3: transform-declared vs plugin-real, blocking |
| `lib/pilot/shadow/CalibrationVerdict.ts` | create | Item 6: class-based verdict + coverage floor + new states |
| `lib/pilot/shadow/FieldFidelityCorrector.ts` | create | Item 7: in-place deterministic corrector (reuses core) |
| `lib/pilot/shadow/__tests__/*.test.ts` | create | Phase 1 unit tests (+ RCA fixture for Item 7) |
| `lib/pilot/shadow/StructuralRepairEngine.ts` | modify | Item 5a: treat scatter/loop itemVariable as in-scope |
| `lib/audit/events.ts` | modify | New `AGENT_CALIBRATION_FIELD_CORRECTED` audit event (Item 7) |
| `app/api/v2/calibrate/batch/route.ts` | modify | Wire detector (blocking), corrector (+audit/snapshot), verdict + coverage floor |

## Task List
- [x] Step 1: Phase 0 — normaliser + extractor + reconciler + index + tests (20 tests green) ✅
- [x] Step 2: Item 5a — StructuralRepairEngine scatter itemVariable in-scope + test (3 tests) ✅ (also converted 6 console.* → Pino)
- [x] Step 3: Item 5b / cal-side Item 3 — PluginFieldFidelityValidator + tests (4 tests) ✅
- [x] Step 4: Item 6 — CalibrationVerdict module + tests (14 tests) ✅
- [x] Step 5: Item 7 — FieldFidelityCorrector + tests + RCA fixture proof (4 tests, proves 0ee53785 mime_type→mimeType in place) ✅
- [x] Step 6: audit event + route wiring (detector blocking, corrector+audit+snapshot, verdict+coverage floor) ✅
- [x] Step 7: full jest for touched areas — 13 suites / 112 tests green; `tsc --noEmit` clean on all touched files ✅

## Test Results (recorded)
- `lib/schema-reconciliation` (Phase 0): 20 passing.
- `lib/pilot/shadow` new + existing regressions: PluginFieldFidelityValidator (4), FieldFidelityCorrector (4), CalibrationVerdict (14), StructuralRepairEngine.scatterItemVar (3), plus WP-32 regression still green.
- Combined `lib/pilot/shadow` + `lib/schema-reconciliation` + `lib/audit`: **13 suites, 112 tests, all passing.**
- `npx tsc --noEmit`: exit 0, zero errors in any touched file.

## Decisions / Deviations (for SA)
1. **Verdict-state plumbing without a migration.** DB `calibration_history.status` CHECK allows only `success|failed|needs_review|verification_only`. New verdict states (`inconclusive`, `corrected_not_verified`) map onto `needs_review` at the DB layer; the precise verdict + reason live in `metadata.verdict` and the API response (`verdict`, `verdictLabel`). No migration touched (per "never modify migrations without SA approval"). This addresses the open "verdict-state plumbing" question conservatively — SA to confirm.
2. **Coverage-floor proxy (G1c).** `exercisedRealPath = !(items_processed > 0 && items_delivered === 0)` from `execution_summary`. Reuses the existing semantic-empty signal generically (no plugin/field names). Flag-only per the requirement's suggested resolution; representative-data synthesis is out of scope.
3. **Single-hop producer resolution.** The calibration detector/corrector resolve a transform's producing plugin action one hop up (input root var → producing step). This covers the RCA chain (flatten's input is the plugin action's output var). Multi-hop transform→transform chains are out of single-hop scope and left for the generation/compiler phases.
4. **WEAK_POINTS.md / V6_OPEN_ITEMS.md not yet updated.** The field-fidelity class (WP-56) is not fully closed until the Phase 3 generation/compiler fixes land; recording it ✅ Fixed now would misstate a multi-phase delivery. Proposing to update those tracking docs when Phase 3 closes the class (single-source-of-truth). SA to confirm.
5. **console.\* conversion.** `StructuralRepairEngine.ts` had 6 `console.log` calls in `scanWorkflow` (the only file I modified that was non-compliant); converted all 6 to the file's existing Pino `logger`. Flagged in workplan header.

## console.* remediation (mandatory per CLAUDE.md § Logging)
- `lib/pilot/shadow/StructuralRepairEngine.ts` — **6 `console.log` calls** (L134-150, all in `scanWorkflow`). I am touching this file for Item 5a. Flagged to the user; proposing conversion of all 6 to the existing module `logger` (the file already has `createLogger`). Will convert unless the user declines.

## SA Review Notes

## SA Code Review

**Code Review by SA — 2026-07-10**
**Status:** ✅ Code Approved (approve-with-minor-fixes — none block user review; the two Medium items are follow-ups, not rework)

### Overall verdict
The implementation is architecturally sound, deterministic, G1-compliant, and correctly reuses a single Phase 0 core across both the detector and the corrector. Scope is clean — only `app/api/v2/calibrate/batch/route.ts`, `lib/audit/events.ts`, and `lib/pilot/shadow/StructuralRepairEngine.ts` were modified; all Phase 0 + Phase 1 new modules are self-contained. **No Phase 2/3 files were touched** (verified: no `lib/agentkit/v6/*` or plugin-executor changes in the diff). All 44 new tests pass on an independent run; the Item 7 RCA fixture proves the `mime_type`→`mimeType` in-place correction across schema key + `condition.field` + scatter `{{attachment_item.*}}` ref. `console.*` remediation in StructuralRepairEngine is complete (0 remaining). Zero plugin-name/field branches in executable code (all `gmail`/`mimeType` mentions are comments/examples).

### Verification of the requirement contract
- **Phase 0 reconciler** — correct. `rename` only for a single unambiguous fuzzy match spelled differently; `keep`/`ambiguous`/`derived` never rewrite. Ambiguity is guarded three ways (producer-side collision, declared-side collision, target-already-declared). Derived-field survival holds (tested). Deterministic and generic. ✅
- **Item 5b / Item 3 (detector) → BLOCKING** — `PluginFieldFidelityValidator` emits `blocking: true` issues; route maps them to `type:'plugin_field_fidelity_mismatch'`, `severity:'critical'`, `blocking:true` and pushes into `allIssuesForUI` *before* the loop (route L1267-1268). ✅
- **Item 6 / G1** — `computeVerdict` is correct and the inverted `critical>0` logic is genuinely fixed. G1a: any blocking-class issue always returns non-passing (verified via control flow — a surviving blocking issue makes `allIssuesForUI.length>0`, so the zero-issue fast-path at route L4215 is skipped and the run routes through `computeVerdict` → `needs_review`). G1b: only the strict `WAVEABLE_ISSUE_TYPES` allow-list (`hardcode_detected`, `parameterization`), non-blocking, non-high/critical, user-confirm-only may be waved — nothing else. G1c: coverage floor prevents a clean pass on an unexercised path. ✅
- **Item 7 safety conditions** — (1) deterministic-only rewrites (corrector consumes `computeRenames` → core `renames`, which by construction excludes ambiguous/derived); (2) coverage cap → `corrected_not_verified` when re-run doesn't exercise the path; (3) audited (`AGENT_CALIBRATION_FIELD_CORRECTED`, severity warning) + pre-rewrite snapshot to `backup_pilot_steps` (reversible via the existing `/api/v2/calibrate/rollback` route) + surfaced in the API response (`fieldCorrections`). ✅
- **One core, four call sites** — confirmed no duplicated reconciliation/normalisation logic. Detector and corrector both funnel through `PluginFieldFidelityValidator.computeRenames` → `reconcileFields` (Phase 0). No copy-paste drift. ✅
- **Coverage-floor field dependency** — verified `execution_summary.items_processed`/`items_delivered` are populated by `ExecutionSummaryCollector` (L215-217; `items_delivered` is `undefined` when 0, correctly handled by `?? 0`). The RCA case (14 processed / 0 delivered) trips `exercisedRealPath=false` → `inconclusive`. The floor is not inert. ✅

### Findings (severity-ranked)

1. **[route.ts L4315, L4635 — coverage-floor proxy blind spot] — Priority: Medium (document, no code change required this phase).**
   `exercisedRealPath = !(processed > 0 && delivered === 0)` only trips on the "processed some, delivered none" signal. A run that processed **zero** items (e.g. the search returned nothing) evaluates to `exercised = true` and can reach a clean `passed`. That is defensible (a genuinely empty inbox is a valid clean run, not "untested"), and it correctly catches the RCA case — but it is narrower than G1c's wording ("real/happy path never exercised"). **Recommendation:** add one line to Decisions/Deviations #2 explicitly stating the proxy only covers `processed>0 && delivered===0`, that `processed===0` is intentionally treated as exercised, and that representative-data synthesis (the true G1c closure) remains deferred. No code change needed.

2. **[route.ts L1150-1153 (and L1120-1123 pre-existing) — direct `supabase.from('agents').update(...).eq('id', agentId)`] — Priority: Medium (defense-in-depth).**
   The Item 7 write mutates a stored workflow directly on the Supabase client, bypassing the repository layer and omitting `.eq('user_id', user.id)`. For the normal user path `supabase` is the RLS-respecting `authSupabase`, so cross-user writes are blocked; **but** on the admin path `identity.useServiceRole` sets `supabase = supabaseServer` (RLS bypass), and the write is then keyed only on `agentId`. `agentId` is pre-validated at load, and this matches the file's pre-existing convention (many identical calls), so risk is low — but since this is a *new mutating write*, add `.eq('user_id', user.id)` as defense-in-depth, or route it through the already-imported `AgentRepository`. Acceptable to defer given it matches existing code, but note it. Not a blocker.

3. **[route.ts L1158 — used generic `sessionRepo.update(sessionId, { backup_pilot_steps })` instead of the existing `sessionRepo.backupPilotSteps()`] — Priority: Low.**
   Functionally identical (same column, same repo). Prefer the named method for clarity/consistency with `apply-fixes/route.ts`. Cosmetic.

4. **[CalibrationVerdict.ts L44 — `broken_variable_reference` is globally blocking-class] — Priority: Low (QA regression watch).**
   Correct after the Item 5a fix (valid loop vars are no longer flagged). But any *other* unhandled false-positive source in that detector would now hold back a pass. This is the safe (fail-closed) direction and aligns with G1, so no change — flagging so QA watches for a previously-passing agent that now lands in `needs_review` on a stale `broken_variable_reference`.

5. **[FieldFidelityCorrector.ts L149 — downstream `renameSchemaKeys` on any closure consumer with a matching `from` key] — Priority: Low (acceptable).**
   In a pathological case a downstream transform that re-declares a coincidentally-named `from` property could be over-renamed. Blast radius is bounded by the consumer-closure gating and the requirement's "shape-preserving propagation" intent. Acceptable; no change.

### Optimisation suggestions
- Consider extracting the `pluginTruthResolver` closure once and passing it to both the corrector and the detector (currently the same closure is defined once at L1139 and reused — already good; no change needed).
- `VERDICT_LABELS` is imported in three route blocks via dynamic `import()`; a single top-of-handler import would avoid the repetition, but the current lazy pattern matches the file's style — leave as-is.

### Rulings on the Dev's 4 flagged decisions
1. **Verdict states → `needs_review` at DB, precise verdict in `metadata.verdict` + API `verdict`/`verdictLabel`, no migration — APPROVED.** This is the correct conservative choice. The `calibration_history.status` CHECK only permits `success|failed|needs_review|verification_only`; mapping `inconclusive`/`corrected_not_verified` onto `needs_review` keeps existing consumers safe while the plain-language state is surfaced to the user. No migration is warranted for this phase. (Optional future follow-up: a status-enum widening if analytics later need to distinguish the states at the DB level — not now.)
2. **Coverage-floor proxy via `items_processed`/`items_delivered` — APPROVED, with the documentation caveat in Finding 1.** Sound and generic; I verified the fields are populated by `ExecutionSummaryCollector`. Add the `processed===0` limitation note.
3. **Single-hop producer resolution — APPROVED for this phase.** The RCA chain is single-hop (flatten input = plugin action output var). The validator correctly returns null (no false positive) when the producer is itself a transform (tested). Multi-hop transform→transform chains are correctly left to the Phase 3 generation/compiler call sites.
4. **Deferring WEAK_POINTS.md / V6_OPEN_ITEMS.md updates until Phase 3 — AGREED, with one lightweight ask.** Marking WP-56 ✅ Fixed now would misstate a multi-phase delivery and violate single-source-of-truth, so do not mark it fixed. **However**, add a one-line *in-progress* breadcrumb to `V6_OPEN_ITEMS.md` (pointing at this WP: "Phase 0 core + Phase 1 calibration items landed; Phase 3 generation/compiler pending") so the partial delivery is not invisible between now and Phase 3. Do not edit WEAK_POINTS status until Phase 3 closes the class.

### G1 / design-principle violations
None. No plugin-name hardcoding, deterministic (not prompt-based), no hide-the-failure anti-pattern (blocking issues can never be waved; unexercised paths never pass; corrections are audited + surfaced + reversible), and each fix is in the correct phase (all calibration-layer; no compiler/generation logic added).

### Code Approved for QA: Yes — after the user's review, once the single MUST-FIX below lands.

---

## SA Code Review — Dispositions

**SA — 2026-07-11.** Binding rulings. I am converting the five findings into dispositions rather than leaving them for adjudication. Exactly one MUST-FIX.

| # | Finding | Ruling | One-line reason |
|---|---------|--------|-----------------|
| 1 | Coverage-floor proxy treats `processed===0` as "exercised" | **FOLLOW-UP** | Proxy is correct for this phase and catches the RCA case (14/0); the true G1c closure (representative-data synthesis) is already a deferred requirement open question — no false-green for the defect class, so nothing to change now. |
| 2 | Item 7 `agents` write bypasses repo + omits `.eq('user_id', …)` | **MUST-FIX-NOW** | CLAUDE.md Security Rule + Mandatory Rule #4 (`.eq('user_id', userId)`) is non-negotiable, and this is a *new mutating write* that runs under a service-role (RLS-bypass) client on the admin path — "matches existing convention" does not exempt new code from the security bar. |
| 3 | Use `sessionRepo.backupPilotSteps()` instead of generic `.update()` | **WON'T-FIX** | Cosmetic — both paths hit the same repo method and column; withdrawn as noise. |
| 4 | `broken_variable_reference` is globally blocking-class | **WON'T-FIX** | This is correct fail-closed behaviour aligned with G1, not a defect; withdrawn as a code finding (QA exercises the path regardless). |
| 5 | Corrector `renameSchemaKeys` could over-rename a coincidentally-named downstream key | **WON'T-FIX** | Bounded by the consumer-closure gating and matches the requirement's shape-preserving-propagation intent; acceptable by design, withdrawn. |

### MUST-FIX list (hand directly to Dev)

**1. `app/api/v2/calibrate/batch/route.ts` L1150-1153 — add the owner filter to the Item 7 corrected-steps write.**

Change:
```ts
await supabase
  .from('agents')
  .update({ pilot_steps: correctedSteps, updated_at: new Date().toISOString() })
  .eq('id', agentId)
  .eq('user_id', user.id);   // ← add this line
```
Verified safe by SA: `user.id === identity.userId` is the **agent owner** on both the non-admin path and the admin/service-role path (route L154-181 — admin runs act "on behalf of the owner"), so this filter targets the owner on every path and will **not** break admin-initiated calibration. It closes the RLS-bypass gap on a new mutating write.

That is the complete MUST-FIX set — **one line, one file.** Findings 3-5 are withdrawn; Finding 1 is a genuinely separate deferred item (representative-data synthesis) already tracked in the requirement's Open Questions. Decision-4's `V6_OPEN_ITEMS.md` in-progress breadcrumb remains a recommended (non-blocking) housekeeping note, not a MUST-FIX.

**Re-review after MUST-FIX:** trivial — a one-line owner-filter addition needs no second SA pass; it goes straight to user review → QA.

## QA Testing Report

**QA — 2026-07-11**
**Test mode:** full (acceptance criteria + edge/failure paths)
**Strategy used:** A (Jest unit) + B (integration reasoning over the route wiring) + code inspection. No live calibration run — the calibration route is a 4.8k-line serverless handler requiring Supabase + plugin-manager + a real broken agent; the deterministic core, detectors, verdict, and corrector are fully exercised by Jest with the RCA fixture, and the route wiring is validated by inspection against the same modules.
**Focus:** api / schema / security (calibration side)
**Skipped:** D (Playwright) — no UI in scope this phase; E (log-analysis) — not needed, tests run green.
**Input source:** prompt keywords + workplan scope (Phase 0 + Phase 1 only; Phases 2/3 out of scope, confirmed no `lib/agentkit/v6/*` or plugin-executor files touched).

### What I ran
- `npx jest lib/schema-reconciliation lib/pilot/shadow lib/audit` → **13 suites, 114 tests, all passing** (112 Dev tests + 2 QA-added corrector edge probes).
- `npx jest StructuralRepairEngine.wp32.test.ts lib/schema-reconciliation` → WP-32 StructuralRepairEngine regression **still green** after the Item 5a edit (31 tests).
- `npx tsc --noEmit` → repo has 1676 pre-existing unrelated errors; **zero** in any touched file (`lib/schema-reconciliation/*`, `PluginFieldFidelityValidator`, `CalibrationVerdict`, `FieldFidelityCorrector`, `StructuralRepairEngine`, `rcaGmailExpenseAgent`, `calibrate/batch/route.ts`, `audit/events.ts`). Confirmed by grepping the tsc output for each touched filename — no matches.
- Verified the production resolver wiring: `pluginManager.getActionDefinition(plugin, action)?.output_schema` — `getActionDefinition` exists (`plugin-manager-v2.ts` L685), `ActionDefinition.output_schema` is a real typed field (`lib/types/plugin-types.ts` L198), and the identical resolver pattern is already in use at route L1107 for `ScatterItemFieldValidator`. The detector/corrector are wired to real plugin truth in production, not only to the test fixture.

### Test Coverage
| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Item 5a — valid scatter `{{attachment_item.field}}` no longer flagged as broken | ✅ | Pass | `StructuralRepairEngine.scatterItemVar.test.ts`: happy path (loop var not flagged) + itemVariable-only-on-scatter + failure path (genuinely nonexistent var STILL flagged). Root cause fixed at `StructuralRepairEngine.ts` L192-203 by registering the itemVariable as an in-scope variable. |
| Item 5b / Item 3 — real declared-vs-plugin mismatch is BLOCKING | ✅ | Pass | `PluginFieldFidelityValidator.test.ts`: RCA `mime_type→mimeType` surfaced with `blocking:true`; route maps to `type:'plugin_field_fidelity_mismatch'`, `severity:'critical'`, `blocking:true` and pushes into `allIssuesForUI` (route L1264-1272). |
| Item 6 / G1a — blocking issue can NEVER pass | ✅ | Pass | `CalibrationVerdict.test.ts` + control-flow inspection: a blocking issue lands in `allIssuesForUI` → the zero-issue fast-path at route L4216 is skipped → `computeVerdict` returns `needs_review`, `isPassing:false`. |
| Item 6 / G1b — only non-blocking user-confirm-only issues waveable | ✅ | Pass | `WAVEABLE_ISSUE_TYPES` allow-list only; `isWaveable` refuses anything blocking / high / critical / non-allow-listed. Test: parameterization-only run passes; `semantic_failure` high does not. |
| Item 6 / G1c — coverage floor caps unexercised path at inconclusive (not passed) | ✅ | Pass | `exercisedRealPath = !(processed>0 && delivered===0)`; applied in BOTH the zero-issue block (route L4302+) and inside `computeVerdict`. Unexercised → `inconclusive`; never `passed`. |
| Item 6 — previously-inverted verdict logic corrected | ✅ | Pass | Old `hasCriticalIssues ? 'needs_review' : 'failed'` (which failed a clean run carrying only a medium nag) replaced by class-based `computeVerdict`. Verified the failure direction is now correct. |
| Item 7 — deterministic in-place `mime_type→mimeType`; ambiguous/derived untouched | ✅ | Pass | `FieldFidelityCorrector.test.ts` RCA fixture rewrites schema key + `condition.field` + `{{attachment_item.mime_type}}` ref; leaves `attachment_id` untouched. Two QA-added probes confirm derived-survival + ambiguity leave-untouched through the full corrector. |
| Item 7 — snapshot + audit written BEFORE mutation | ✅ | Pass | Route L1137-1174: on `changed`, pre-rewrite snapshot cloned, `agents` updated, `backup_pilot_steps` persisted to session, `AGENT_CALIBRATION_FIELD_CORRECTED` audit logged. Corrector never mutates the input array (test: original retains `mime_type`). Ordering note below. |
| Item 7 — coverage cap → `corrected_not_verified` when re-run doesn't exercise path | ✅ | Pass | `computeVerdict({corrected:true, coverage:{exercisedRealPath:false}})` → `corrected_not_verified`, `isPassing:false`; corrected-then-verified → legitimate `passed`. |
| Security fix — Item 7 `agents` write includes `.eq('user_id', user.id)` | ✅ | Pass | Route L1150-1153 carries `.eq('id', agentId).eq('user_id', user.id)`. MUST-FIX applied correctly. See Bug 1 for a sibling write in the same changeset that did NOT get the filter. |
| Edge — producer is another transform → single-hop no-op | ✅ | Pass | Validator test + `resolvePluginAction` returns null for a transform producer → `computeRenames` returns null. No false positive. |
| Edge — derived field (no producer counterpart) never renamed | ✅ | Pass | Reconciler test + QA-added corrector probe. |
| Edge — ambiguous multi-match never renamed | ✅ | Pass | Reconciler tests (producer-side collision, declared-side collision, target-already-declared) + QA-added corrector probe with a two-spelling producer. |
| WP-32 StructuralRepairEngine regression intact | ✅ | Pass | 31 tests green after the Item 5a edit. |

### Issues Found

#### Bugs (must fix before commit)

1. **New `production_ready` write in the Item 6a relaxation branch omits the owner filter** — Severity: **Medium** (security / defense-in-depth).
   - File: `app/api/v2/calibrate/batch/route.ts` ~L4711-4719 (the `if (verdictResult.isPassing)` block added in this changeset).
   - The block runs a **new mutating write** that sets `is_calibrated: true, production_ready: true` on `agents` with only `.eq('id', agentId)` — no `.eq('user_id', user.id)`. This is the exact write-class the SA elevated to MUST-FIX-NOW for the Item 7 write (L1151), and the same service-role (RLS-bypass) admin path applies (`supabase = supabaseServer` when `identity.useServiceRole`, route L180). The Item 7 write got the fix; this sibling write, introduced in the same diff, did not.
   - Expected: a new mutating write under a possibly-service-role client is scoped by owner (`.eq('user_id', user.id)`), per CLAUDE.md Security Rule + Mandatory Rule #4 and SA's own stated standard ("'matches existing convention' does not exempt new code from the security bar").
   - Actual: keyed on `agentId` only.
   - Practical risk is **low** (agentId is pre-validated as loaded/owned; `user.id === identity.userId === owner` on all paths, including admin-on-behalf), which matches SA's original severity assessment of the identical Item 7 concern before they elevated it on principle. But because this is a new write that flips an agent to `production_ready`, it should carry the same filter for consistency with the applied MUST-FIX.
   - Fix: add `.eq('user_id', user.id)` to the write (one line), mirroring L1153.

#### Performance Issues (should fix)
- None observed. The detector/corrector run once per calibration over the step tree (linear); the corrector's consumer-closure BFS is bounded by step count. Verdict computation is pure and O(issues).

#### Edge Cases (nice to fix / documented)
1. **Coverage-floor `processed===0` blind spot** — already dispositioned as FOLLOW-UP (SA Finding 1). A run that processes zero items (e.g. empty inbox) evaluates `exercisedRealPath=true` and can reach `passed`. Correct for this phase (catches the RCA 14/0 case); the true G1c closure (representative-data synthesis) is a deferred requirement Open Question. No action this phase.
2. **Pre-existing sibling `production_ready` write at route L4539-4547** (the zero-issue success fast-path) also omits `.eq('user_id', user.id)`. NOT touched by this change, so out of scope — flagged only as housekeeping so it is not forgotten if the security convention is tightened repo-wide.

### Test Outputs / Logs
```
# touched-area suites
Test Suites: 13 passed, 13 total
Tests:       114 passed, 114 total   (112 Dev + 2 QA-added corrector edge probes)

# WP-32 regression + Phase 0
Test Suites: 4 passed, 4 total
Tests:       31 passed, 31 total

# tsc --noEmit: 1676 pre-existing unrelated errors repo-wide; 0 in any touched file
```
QA added two edge probes to `lib/pilot/shadow/__tests__/FieldFidelityCorrector.test.ts` (derived-survival + producer-ambiguity through the full corrector). No product logic was altered.

### Final Status
- [x] All Phase 0 + Phase 1 acceptance criteria pass (happy path + failure/edge paths tested for each changed behavior).
- [ ] One Medium security finding (Bug 1) open — a new `production_ready` write omits `.eq('user_id', user.id)`. Not a High-severity blocker (owner-scoped on all paths), but recommend Dev add the one-line owner filter for consistency with the applied Item 7 MUST-FIX before commit.

**Overall QA verdict: PASS-WITH-NOTES.** Functionally correct, deterministic, G1-compliant, regression-clean. Recommend closing Bug 1 (one line) before RM commit.

> **Bug 1 resolved by Dev:** the `production_ready` write now carries `.eq('user_id', user.id)` (same owner-filter fix as the Item 7 MUST-FIX). Applied 2026-07-11.

---

# Phase 1.5 — Live-test remediation (runtime + calibration slices)

**Status:** Code Complete (pending SA review)
**Driver:** 2026-07-11 live re-run of `0ee53785` (post Phase 0/1). The field-name fix cleared the filter (13 PDFs kept), but the run produced 13 **all-blank** rows and calibration never saw the 100%-failing extraction. Four findings (requirement Items 8, 9, 10 + Item 6/Finding 4) stand between us and the North-Star (populated report AND honest passing verdict).

## Scope of Phase 1.5 (per coordinator + SA Round 3)
**Runtime + calibration slices ONLY** — the slices that repair the existing agent `0ee53785` in place and make the verdict honest. **NOT** the generation-side durable bindings of Items 8/9 (those are Phase 3, new-agents-only).

| Finding / Item | Slice implemented here | Slice deferred to Phase 3 |
|---|---|---|
| Finding 2 / Item 8 | Runtime param resolver: pure whole-object placeholder → pass raw object through un-stringified when the consumer param declares object-acceptance | Generation binding of specific fields (`file_content ← .data`, etc.) |
| Finding 3 / Item 9 | Runtime `transformFlatten`: carry parent fields (incl. `date`) forward with child-precedence | Generation reference-shape (reference the carried names) |
| Finding 4 / Item 6 ext | Quality-aware coverage floor in `CalibrationVerdict` (all-blank delivered set can't pass) | — |
| Finding 5 / Item 10 | Calibration all-failed/all-empty step detector → blocking issue | — |

## Cross-cutting constraints (restated)
Schema-driven & generic, ZERO plugin-name branches; deterministic (no prompt nudges); Pino logging; TS strict. Item 8 guardrails honoured: pure-placeholder-only (an object only reaches the coercion point from a pure whole-object placeholder — concatenations are pre-stringified by `resolveAllVariables`), only when the consumer param's declared type accepts an object (via generic `x-input-mapping.accepts` object form OR object `type`), never changes normal scalar interpolation. Item 9 child-precedence: child fields always win, additive only, never clobbers a child field.

## Files created / modified (Phase 1.5)
| File | Action | Purpose |
|------|--------|---------|
| `lib/pilot/StepExecutor.ts` | modify | Item 9: `transformFlatten` parent-field carry-forward (incl. `date`, child-precedence). Item 8: `paramAcceptsObject` helper + object-passthrough guard in the string-coercion path |
| `lib/pilot/shadow/dataQuality.ts` | create | Shared generic "meaningful data?" signal used by BOTH Item 6/Finding 4 and Item 10 (one definition) |
| `lib/pilot/shadow/CalibrationVerdict.ts` | modify | Finding 4 data-quality coverage floor (`deliveredAllBlank`); +2 blocking types for Item 10 |
| `lib/pilot/shadow/AllFailedStepDetector.ts` | create | Item 10: detect all-failed/all-empty step/scatter → blocking issue |
| `app/api/v2/calibrate/batch/route.ts` | modify | Wire Item 10 detector (blocking issues) + Finding 4 `deliveredAllBlank` into both verdict sites |
| `lib/pilot/__tests__/transformFlatten.parentCarry.test.ts` | create | Item 9 unit tests (happy + child-precedence + edge) |
| `lib/pilot/__tests__/transformParametersForPlugin.objectPassthrough.test.ts` | create | Item 8 unit tests (passthrough + `paramAcceptsObject` + no-regression) |
| `lib/pilot/shadow/__tests__/dataQuality.test.ts` | create | data-quality signal tests |
| `lib/pilot/shadow/__tests__/AllFailedStepDetector.test.ts` | create | Item 10 detector tests |
| `lib/pilot/shadow/__tests__/CalibrationVerdict.test.ts` | modify | +Finding 4 all-blank-can't-pass tests + Item 10 blocking-type tests |

## Task List (Phase 1.5)
- [x] Item 9 — `transformFlatten` parent carry-forward (child-precedence, carries `date`) + tests ✅
- [x] Item 8 — object-passthrough runtime slice + `paramAcceptsObject` + tests ✅
- [x] Finding 4 — data-quality coverage floor in `CalibrationVerdict` + shared `dataQuality` util + tests ✅
- [x] Item 10 — `AllFailedStepDetector` + route wiring (blocking) + tests ✅
- [x] Route wiring: detector issues + `deliveredAllBlank` threaded into both verdict sites ✅
- [x] Full jest for touched areas + typecheck ✅

## Test Results (Phase 1.5)
- `lib/pilot/shadow` + `lib/schema-reconciliation` + `lib/audit`: **15 suites, 134 tests, all passing** (includes new dataQuality, AllFailedStepDetector, extended CalibrationVerdict).
- StepExecutor runtime slices: `transformFlatten.parentCarry` + `transformParametersForPlugin.objectPassthrough` = **2 suites, 10 tests, passing** (uuid mocked to sidestep an ESM-in-jest transform issue; benign worker-teardown warning only).
- End-to-end intent demonstrated: Item 9 test asserts each flattened child carries real `from`/`subject`/`date` AND its own `filename`/`mimeType` (populated rows); Item 8 test asserts the attachment object reaches the extractor un-stringified (extraction can succeed); Finding 4 test asserts a 13-row all-blank report can never be `passed`; Item 10 test asserts an all-empty scatter raises a blocking issue.
- `tsc --noEmit`: clean on all touched files.

## Deviations / notes (Phase 1.5)
1. **Item 8 "accepts an object" signal.** `file_content` is declared `type:"string"` but carries `x-input-mapping.accepts:["file_object"]`. That generic `x-input-mapping` object-form marker is the schema-driven signal used for "accepts an object" (plus explicit object `type`/union). Zero plugin-name branches. This is the generic reading of SA Round 3's "consumer param's declared type accepts an object".
2. **console.\* in `StepExecutor.ts` (FLAG).** This file has **30 `console.*` calls** (pre-existing, scattered). Per the CLAUDE.md logging standard I am flagging it. I did NOT convert them in this task: (a) the coordinator explicitly scoped "do not change anything else"; (b) it is a ~6k-line critical hot-path execution file and a 30-call sweep across unrelated regions is high-risk and review-noisy for a narrowly-scoped runtime fix. My new lines use Pino `logger`. Proposing a dedicated, separately-reviewed conversion of the whole file — awaiting user approval before touching the pre-existing calls.
3. **Generation slices NOT implemented** (Items 8/9 Phase 3) — confirmed out of scope for this phase.
4. **WEAK_POINTS.md / V6_OPEN_ITEMS.md** — same deferral as Phase 0/1: the field-fidelity class isn't fully closed until Phase 3; will record when the class closes.

## SA Code Review — Phase 1.5

**Code Review by SA — 2026-07-11**
**Status:** ✅ Code Approved — **MUST-FIX list is EMPTY.** Approve for user review + live re-test of `0ee53785`.

### Overall verdict
Approve. The four runtime/calibration slices are correct, generic, deterministic, and G1-compliant, and they reuse the shared data-quality signal (no duplicated logic). Scope is clean (StepExecutor + three shadow files + route wiring; no generation-side/Phase-3 files touched). All 43 Phase 1.5 tests pass on an independent run; zero plugin-name branches across all new code (grep-verified). The Phase 1 MUST-FIX (`.eq('user_id', user.id)` on the Item 7 write) has been applied. This also constitutes my **SA Round 3** ruling: the runtime slices of Items 8 and 9 land here (in place, to repair `0ee53785`); the generation slices (bind specific fields; reference the carried shape) remain Phase 3 for new agents — confirmed correct split.

### Verification of the riskiest change (Item 8 object-passthrough) — SOUND
- `paramAcceptsObject` is a sound, generic "accepts object" signal: object `type`, union type array including `object`, or an `x-input-mapping.accepts` object-form entry via the precise regex `/(^|_)object$/i` (correctly matches `file_object`/`object`, correctly REJECTS `url_string` — tested). No plugin-name branches.
- **No-regression is provable, not assumed.** I traced `ExecutionContext.resolveAllVariables`: a *pure* `^{{…}}$` placeholder returns the raw resolved value (object preserved, L472-474); any *inline/concatenated* placeholder JSON-stringifies objects/arrays (L483-487). Therefore an object value only ever reaches the `def.type === 'string'` coercion point from a pure whole-object placeholder (e.g. `file_content:"{{attachment_content}}"`). The guard changes behaviour ONLY for object-accepting params receiving such a value; every normal scalar interpolation and every non-object-accepting string param is byte-for-byte unchanged (the else-branch still stringifies). Tests cover happy passthrough + non-accepting-param-still-stringifies + scalar-untouched. Verified sound.

### Verification of the other three slices
- **Item 9 flatten parent-carry — correct.** Child-precedence is enforced by spread order (`...parentCarry, ...child, ...parentMeta`) so a child field is never clobbered; `date` is carried (both as a flat field and in `_parentData`); additive-only; `buildParentCarry` is generic and excludes the flattened `field` key. No regression to the existing `_parentData`/`_parentId` metadata (retained, `date` added).
- **Finding 4 / G1c data-quality floor — closes the false-green hole.** `effectivelyExercised = exercisedRealPath && deliveredAllBlank !== true`; an all-blank/all-fallback delivered set resolves to `inconclusive` (or `corrected_not_verified`), never `passed`. Threaded into BOTH verdict sites. The "meaningful data" signal is generic — declared-field fill via `isMeaningfulItem`, ignores `_`-prefixed meta keys (so flatten's `_parentData` doesn't falsely rescue a blank row), generic `FALLBACK_MARKERS`. Tested: a 13-row all-blank report can never pass.
- **Item 10 all-failed detector — correct and reuses `dataQuality.ts`.** Detects `all_failed` (100% `success:false`/`error`/`status` markers) and `all_empty` (100% not-meaningful via the shared signal) for a plain step AND a scatter (per-step output map); raises blocking; no false-positive on a legitimately-empty step (empty array / scalar output is skipped). No duplicate logic — imports `assessItemsDataQuality`/`isMeaningfulItem`. Both the detector issue and `deliveredAllBlank` are wired *before* the zero-issue fast-path, so a surviving degraded step routes through `computeVerdict` → `needs_review` (G1a control flow holds, same as Phase 1).

### Findings & dispositions (decisive)

| # | Finding | Ruling | One-line reason |
|---|---------|--------|-----------------|
| 1 | Item 8 object-passthrough safety / generic signal | **WON'T-FIX** (approved as-is) | Verified sound: precise generic signal + provable no-regression via `resolveAllVariables` pure-vs-inline behaviour; nothing to change. |
| 2 | Item 9 carries ALL parent fields onto each child (minor bloat; extra keys visible to a hypothetical "dump-every-key" consumer) | **WON'T-FIX** | Intended by the AC (parent fields must be promoted); child-precedence prevents any data corruption; the extra-key surface is additive and harmless. |
| 3 | `deliveredAllBlank` only assessable when `finalOutput` is an array or under a standard container key (items/rows/data/results/records) — a report under a bespoke key is un-assessed by this path | **WON'T-FIX** | No residual gap: the all-empty scatter is independently caught by `AllFailedStepDetector` on per-step outputs, so the false-green hole is closed at the detector layer regardless; `deliveredAllBlank` is defense-in-depth. |
| 4 | Item 10 detector relies on `finalResult.output` per-step map + generic failure markers | **WON'T-FIX** | Correct and generic; the "skip non-array / empty" guards prevent false-positives; a plugin that uses `success:false` as a legitimate domain field is a self-contradictory shape, out of scope. |
| 5 | Standards (DB owner-scoping, Pino, TS strict, hardcoding) | **WON'T-FIX** (clean) | No new DB writes in Phase 1.5; Phase 1 write now owner-scoped; new lines use Pino; new modules typed with `unknown`/interfaces; zero plugin-name branches (grep-clean). |
| 6 | `StepExecutor.ts` has 30 PRE-EXISTING `console.*` calls (Dev's new lines use Pino; Dev did not sweep them) | **FOLLOW-UP** | Deferring the sweep is the correct call — StepExecutor is a ~6k-line critical execution hot-path and a 30-call conversion across regions unrelated to Items 8/9 belongs in its own focused, separately-tested change ("don't reformat regions you aren't otherwise working on"), not bundled into a surgical runtime slice. Track it as a dedicated logging-conversion item. |

### MUST-FIX list (hand to Dev)
**EMPTY.** Nothing must change before the user's code review and the live re-test of `0ee53785`. Findings 1-5 are approved/withdrawn; Finding 6 is a tracked FOLLOW-UP (dedicated StepExecutor `console.*`→Pino conversion), not a blocker for this phase.

### G1 / design-principle check
No violations. Deterministic (no prompt nudges), schema-driven (no plugin-name branches), no hide-the-failure (all-blank + all-failed/all-empty now block; verdict floor cannot be waved by cosmetic issues), and the fixes are in the correct layer (runtime slices repair the existing agent; generation slices correctly deferred to Phase 3).

### Code Approved for QA: Yes — after the user's review + live re-test. No re-review needed (MUST-FIX empty).

## QA Testing Report — Phase 1.5

**QA — 2026-07-11**
**Test mode:** full (acceptance criteria + edge/failure paths)
**Strategy used:** A (Jest unit) for the runtime slices, detectors, verdict, data-quality signal, and repo methods; B/code-inspection for the route wiring (4.9k-line serverless handler — not executed live; the coordinator confirms the live end-to-end proof on `0ee53785` is the user's re-test after QA).
**Focus:** api / pipeline (runtime) / schema / security (repo-pattern)
**Skipped:** D (Playwright — no UI); E (log-analysis — not needed, suites green). Live e2e on `0ee53785` = user's job post-QA (per coordinator).
**Input source:** coordinator prompt + workplan "# Phase 1.5" + "## SA Code Review — Phase 1.5".

### What I ran
- `npx jest lib/pilot/shadow lib/schema-reconciliation lib/audit lib/repositories/__tests__ lib/pilot/__tests__/transformFlatten.parentCarry lib/pilot/__tests__/transformParametersForPlugin.objectPassthrough` → **22 suites, 173 tests, all passing** (166 Dev + 5 QA-added repo tests + 2 QA-added detector edge tests).
- `npx tsc --noEmit` → repo-wide pre-existing errors only; **zero** in any Phase 1.5 touched file (`StepExecutor.ts`, `AgentRepository.ts`, `dataQuality.ts`, `AllFailedStepDetector.ts`, `CalibrationVerdict.ts`, `calibrate/batch/route.ts`, both new StepExecutor test files) — confirmed by grepping the tsc output for each filename (no matches).
- Verified the repo-fix wiring: route imports `AgentRepository` (L23); both mutating writes go through it — `updatePilotSteps(agentId, user.id, correctedSteps)` (Item 7) and `setProductionReady(agentId, user.id, {...})` (Item 6a pass). Both repo methods are owner-scoped `.eq('id').eq('user_id')` (AgentRepository L363-423). This fully closes Phase 1 Bug 1 (the direct `production_ready` write that omitted `user_id`) AND routes it through the mandatory repository layer.
- Grep-confirmed **zero plugin-name / field-name branches** in the new executable code of `dataQuality.ts` / `AllFailedStepDetector.ts`; `StepExecutor` slices are schema-driven (`paramAcceptsObject(def)`) and generic (`buildParentCarry` iterates all parent keys); the only literal field names (`from/subject/date` in `_parentData`) are the pre-existing backwards-compat metadata object, not a branch.

### Test Coverage
| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Item 8 — whole-object placeholder into an object-accepting param passes through un-stringified | ✅ | Pass | `objectPassthrough.test.ts`: `file_content:{obj}` on a param with `x-input-mapping.accepts:['file_object']` → extractor receives a real object (`.mimeType`/`.data` intact). |
| Item 8 — normal scalar param unaffected (no regression) | ✅ | Pass | scalar string on an object-accepting param passes untouched; `paramAcceptsObject` returns false for `type:'string'` and for `accepts:['url_string']` (precise `/(^|_)object$/i`). SA-verified no-regression via `resolveAllVariables` pure-vs-inline behaviour (object only reaches coercion from a pure placeholder). |
| Item 8 — non-accepting param still stringifies | ✅ | Pass | `note:{a:1}` (plain string param) → JSON string `"a": 1`. |
| Item 9 — children carry parent `from`/`subject`/`date` under flat names, child-precedence | ✅ | Pass | `transformFlatten.parentCarry.test.ts`: each child gets `from`/`subject`/`date`; a child's own `subject`/`date` win over parent (spread order `...parentCarry, ...child, ...parentMeta`). |
| Item 9 — `date` specifically carried (was dropped) | ✅ | Pass | `child.date` and `_parentData.date` both populated; flattened array key (`attachments`) not re-carried. |
| Finding 4 / G1c — all-blank delivered set can NEVER pass | ✅ | Pass | `CalibrationVerdict` `effectivelyExercised = exercisedRealPath && deliveredAllBlank !== true`; 13-row all-blank → `inconclusive` (or `corrected_not_verified` when corrected). Threaded into BOTH verdict sites (zero-issue block + main-path `computeVerdict`), both pass `deliveredAllBlank`. |
| Item 10 — all-failed AND all-empty step/scatter raise a BLOCKING issue | ✅ | Pass | `AllFailedStepDetector.test.ts`: 100% `success:false` → `all_failed`; 13-row 100% blank/fallback scatter → `all_empty`; both `blocking:true`; route maps to `degraded_step_all_failed/empty` critical+blocking, pushed to `allIssuesForUI` before the fast-path (route L4206-4235). Blocking types added to `BLOCKING_ISSUE_TYPES`. |
| Item 10 — no false-positive on a legitimately-empty / valid step | ✅ | Pass | empty array / scalar / single-object outputs skipped; a step with ≥1 meaningful item not flagged. |
| Repo fix — both writes owner-scoped via `AgentRepository`; methods covered by tests; behaviour preserved | ⚠️→✅ | Pass (after QA added tests) | Writes correctly routed + owner-scoped. **The new methods shipped with NO test** (see Finding 1) — QA added `AgentRepository.pilotSteps.test.ts` (payload, `.eq('id')+.eq('user_id')`, omit-when-undefined, error propagation). Behaviour preserved (same columns/values; non-blocking `.catch`/error-check flow). |
| Edge — partially-blank delivered set NOT treated as all-blank | ✅ | Pass | `dataQuality` "does not flag a populated report" (1 meaningful of 2) + detector "≥1 meaningful item not flagged". |
| Edge — mixed success/failure scatter NOT flagged all-failed | ✅ | Pass | QA-added: `[{success:false},{success:true,amount:'42'...}]` → 0 issues. |
| Edge — child field sharing a name with a parent keeps the child value | ✅ | Pass | child-precedence test (`ChildSubject`/`child-date` win). |
| Regression — WP-32 StructuralRepairEngine + Phase 0/1 (114/134) intact | ✅ | Pass | All included in the 22-suite / 173-test green run; no Phase-1 behaviour changed. |

### Issues Found

#### Bugs (must fix before commit)
- **None blocking.** No High-severity defect. The North-Star live re-test of `0ee53785` is not blocked by any code-level issue found here.

#### Coverage / Process (should fix — addressed by QA)
1. **New `AgentRepository` methods shipped with zero test coverage** — Severity: **Medium** (test-coverage standard).
   - Files: `lib/repositories/AgentRepository.ts` L353-423 (`updatePilotSteps`, `setProductionReady`).
   - CLAUDE.md mandates "New repositories: unit test for each method"; the coordinator's brief stated these were "covered by tests," but no test referenced either method (grep-confirmed across all `*.test.ts`). The pre-existing `AgentRepository.calibration.test.ts` covers only `recordCalibrationPromptDecision` / `setCalibrationStatus`.
   - **Resolution:** QA added `lib/repositories/__tests__/AgentRepository.pilotSteps.test.ts` (5 tests: payload + mandatory owner-scoping + omit-when-undefined columns + error propagation for both methods). Gap closed in QA — flagging so RM/Dev know the coverage originated in QA, not Dev. No product code changed.

#### Edge Cases (nice to fix / documented)
1. **`success:true` marker masks the `all_empty` branch** — Severity: **Low**.
   - File: `lib/pilot/shadow/dataQuality.ts` L43 (`isMeaningfulValue` treats any boolean as meaningful) → `AllFailedStepDetector` `all_empty` (L78-80).
   - A row shaped `{success:true, <all report fields blank>}` is judged "meaningful" (because `success:true` is a boolean), so a 100%-blank set carrying a truthy status flag escapes the `all_empty` branch. In practice the real RCA shapes ARE caught (extraction items carry `success:false` → `all_failed`; delivered report rows carry no `success` field → `all_empty`), and the `deliveredAllBlank` coverage floor is defense-in-depth. This mirrors SA Finding 4's disposition (a self-contradictory status-vs-data shape is out of scope). Documented via a QA test asserting the actual behaviour so a future change to the meaningfulness signal is a conscious decision. Optional: exclude a `success`/`status` key (or boolean status markers) from the meaningfulness judgment if this shape is seen in the wild.

#### Performance
- None. Detector/data-quality run once per calibration over per-step outputs (linear); verdict is pure.

### console.* remediation note
`StepExecutor.ts` carries **30 pre-existing `console.*` calls** (unrelated to Items 8/9). Dev's new lines use Pino; Dev flagged it and SA dispositioned the sweep as a **FOLLOW-UP** (a ~6k-line hot-path file; a 30-call conversion belongs in its own reviewed change). QA concurs — correctly deferred, not a Phase 1.5 blocker. Tracked for a dedicated logging-conversion item.

### Test Outputs / Logs
```
# Phase 1.5 touched-area suites (incl. QA-added repo + detector tests)
Test Suites: 22 passed, 22 total
Tests:       173 passed, 173 total

# tsc --noEmit: pre-existing repo-wide errors only; 0 in any Phase 1.5 touched file
```
QA-added tests (no product logic altered): `lib/repositories/__tests__/AgentRepository.pilotSteps.test.ts` (5), and 2 edge tests in `lib/pilot/shadow/__tests__/AllFailedStepDetector.test.ts` (mixed success/failure not-flagged; documented `success:true` limitation).

### Final Status
- [x] All Phase 1.5 acceptance criteria (Items 8, 9, 10, Finding 4/G1c) pass — happy + failure/edge paths tested.
- [x] Repo-pattern fix verified: both writes owner-scoped through `AgentRepository`; Phase 1 Bug 1 fully closed.
- [x] Coverage gap on the new repo methods closed by QA (Finding 1).
- [ ] One Low-severity documented edge limitation (Finding: `success:true` masks `all_empty`) — no action required this phase.

**Overall QA verdict: PASS-WITH-NOTES.** Correct, generic, deterministic, G1-compliant, regression-clean; no blocking bug. Nothing blocks the user's live re-test of `0ee53785`. Notes: QA supplied the missing repo-method tests, and documented one low-severity detector edge case.

---

# Phase 1.6 — Coverage-floor two-way fix (send/notify-terminating agents)

**Status:** Code Complete (pending SA review)
**Driver:** Live re-run #2 of `0ee53785` (RCA "## Live Re-run #2 RCA (2026-07-11)"). Extraction now works (13 rows, real vendor/amount/date) and the report email actually sent (`suppressSend:false`, real `message_id`) — but `send_email` returns a scalar confirmation with no counted item array, so `items_delivered` stayed 0 → `exercisedRealPath=false` → wrongly capped to `inconclusive`. Any send/notify-terminating agent is structurally capped and can essentially never reach `passed`. Same floor, opposite direction from Phase 1.5/Finding 4.

## Scope: Q2 ONLY (calibration coverage floor)
Implemented the calibration-side coverage-floor redesign. **Q1 (the step7 AI-inside-scatter input-wiring gap that leaves source_email/filename columns blank) is a Phase 3 generation fix and was NOT touched here.**

## Unified design (per RCA — one signal fixes both directions)
- Base `exercisedRealPath` on whether the **last pre-delivery collection carries MEANINGFUL field values** (via the shared `dataQuality` signal), not on a delivery/row COUNT.
- Treat a **terminal send/notify that actually executed** (returned a confirmation, e.g. `message_id`/`sent_at`) as delivery-exercised, so a scalar send is no longer wrongly capped.
- **False-green guard preserved:** an all-blank / all-fallback set still fails (`deliveredAllBlank`), so Re-run #1's 13 blank rows can never pass.
- **Per-column fill-rate check:** a partially-blank report (real amount/vendor/date but blank source_email/filename columns) is surfaced as a non-blocking, non-waveable `partial_report_data` issue → resolves to `needs_review` (not `passed`), naming the blank columns.

## Files created / modified (Phase 1.6)
| File | Action | Purpose |
|------|--------|---------|
| `lib/pilot/shadow/dataQuality.ts` | modify | Added `assessColumnFillRates` (per-column fill / partially-blank), `looksLikeExecutedSend` + `SEND_CONFIRMATION_MARKERS` (generic executed-send predicate), and `deriveCoverageSignal` (the single pure unified-coverage derivation) |
| `app/api/v2/calibrate/batch/route.ts` | modify | Replaced the row-count `exercisedRealPath`/`deliveredAllBlank` computation with `deriveCoverageSignal`; hoisted the signal above both verdict sites; push a `partial_report_data` issue when columns are blank in every row |
| `lib/pilot/shadow/__tests__/deriveCoverageSignal.test.ts` | create | The three-case triad + per-column + executed-send tests |

## Task List (Phase 1.6)
- [x] Extend `dataQuality.ts`: per-column fill-rate + executed-send predicate + unified `deriveCoverageSignal` ✅
- [x] Rewire the route's coverage computation to the unified signal; hoist above both verdict sites ✅
- [x] Partial-report → non-blocking/non-waveable `partial_report_data` issue → `needs_review` ✅
- [x] Three-case triad tests + typecheck ✅

## Test Results (Phase 1.6) — the required triad
1. **All-blank/all-fallback delivered set → still FAILS** (`deliveredAllBlank=true`, `exercisedRealPath=false` → `inconclusive`, never `passed`). ✅
2. **Genuinely-populated report whose terminal send returns only a scalar confirmation (or is suppressed) → CAN reach `passed`** (`exercisedRealPath=true` from meaningful pre-delivery rows). ✅
3. **Partially-populated report (real amount/vendor/date, blank source_email/filename) → `needs_review`, NOT `passed`**, with the blank columns named. ✅
- Full run: `lib/pilot/shadow` + `lib/schema-reconciliation` + `lib/audit` = **16 suites / 147 tests, all passing**.
- `tsc --noEmit`: clean on `dataQuality.ts` and the route.

## Deviations / notes (Phase 1.6)
1. **`looksLikeExecutedSend` markers** are generic delivery-confirmation field names (`message_id`/`sent_at`/`thread_id`/`recipient_count`/`recipients` + camelCase), NOT plugin names — zero plugin-name branches.
2. **`ExecutionSummaryCollector` unchanged.** The redesign moves off the `items_delivered` count for the primary signal (kept only as a fallback when there is no inspectable pre-delivery collection AND no executed send), so no change to the collector was needed.
3. **Q1 NOT implemented** (step7 AI-input-wiring generation fix) — confirmed out of scope (Phase 3).
4. **Reused `dataQuality.ts`** for all meaningful-data judgments (no duplicate logic); the coverage decision is a pure, unit-tested function.

## SA Code Review — Phase 1.6

**Code Review by SA — 2026-07-11**
**Status:** ✅ Code Approved — **MUST-FIX list is EMPTY.** Approve for user review + live re-test of `0ee53785`.

### Overall verdict
Approve. The two-way coverage-floor redesign fixes the over-strict direction (send/notify-terminating agents) **without reopening the false-green hole** — I proved this by code trace and by the triad's CASE 1 test. The change is generic, deterministic, reuses the shared `dataQuality` signal (no divergent "empty" definition), consumes one hoisted signal at both verdict sites, and adds no DB writes. All 46 relevant tests pass on an independent run; zero plugin-name branches (grep-clean).

### G1 / false-green — the priority scrutiny (VERIFIED SOUND)
The exact trap is: an internally all-blank report whose terminal send executed must NOT pass. It doesn't, and the reason is structural, not incidental:
- In `deriveCoverageSignal`, when a pre-delivery collection is inspectable (`quality.assessed === true`), the result is computed **purely from meaningful field values** — `exercisedRealPath = quality.meaningfulItemCount > 0`, `deliveredAllBlank = quality.allBlank` — and the `sendExecuted` flag is **never referenced in that branch** (it is computed at L254 but only consulted in the no-collection fallback at L271). So an executed send can never override the meaningful-data requirement whenever there is data to inspect.
- `computeVerdict`'s `effectivelyExercised = coverage.exercisedRealPath && coverage.deliveredAllBlank !== true` (Phase 1.5) remains dominant, so `deliveredAllBlank` forces `inconclusive`/`corrected_not_verified`, never `passed`.
- **Proof:** triad CASE 1 — 13 all-blank rows (`vendor:'Unknown'`, others `''`) + an executed `send_report` with `message_id`/`sent_at` → `deliveredAllBlank=true`, `exercisedRealPath=false`, verdict `inconclusive`. Re-run #1's blank report can never pass.
- Defense-in-depth: even if the coverage signal ever mis-picked a collection, `AllFailedStepDetector` (Item 10) independently raises a BLOCKING `degraded_step_all_empty` on any all-empty step, so an all-blank report is caught at two layers.

### Verification of the other slices
- **Both verdict sites (consistent, no bypass).** The signal is hoisted to L4243, above the zero-issue clean site (L4407) and the main site (L4732); both consume `exercisedRealPath`/`deliveredAllBlank`/`coverageReason`. The `try/catch` falls back to the old row-count signal on error (non-blocking) — safe.
- **`partial_report_data` routing.** Non-blocking, `medium`, and NOT in `WAVEABLE_ISSUE_TYPES` → `isWaveable` returns false → the class-based verdict resolves a partially-blank populated report to `needs_review` (not passed, not hard-fail), and pushing it to `allIssuesForUI` diverts off the clean fast-path. CASE 3 proves it, with the blank columns named. Correct.
- **`assessColumnFillRates`.** Correct: a column blank in every row → ratio 0 → named; a column with any data → not flagged; `partiallyBlank` requires ≥1 blank AND ≥1 populated (a fully-blank set is excluded — that is the `deliveredAllBlank` case). Reuses `isMeaningfulValue` (no divergent empty-definition). Meta (`_`-prefixed) keys ignored.
- **Regression holds.** `deliveredAllBlank` preserved; Item 10 detector unchanged and still shares `dataQuality`; non-send agents with a populated collection still pass via the data branch; the no-collection `delivered>0` path is unchanged. CASE 2/2b confirm populated-report-with-scalar-send and suppressed-send both still pass.
- **Standards.** No new DB writes (confirmed in the diff region), Pino logging, TS strict (`unknown`/typed interfaces), zero plugin-name branches.

### Findings & dispositions (decisive)

| # | Finding | Ruling | One-line reason |
|---|---------|--------|-----------------|
| 1 | G1 / false-green: executed-send could override the meaningful-data guard | **WON'T-FIX** (verified sound) | It cannot — `sendExecuted` is ignored whenever a collection is inspectable; `deliveredAllBlank` stays dominant; proven by CASE 1 + code trace. |
| 2 | Both verdict sites + `partial_report_data` routing | **WON'T-FIX** (correct) | Signal hoisted above both sites; the partial issue is non-blocking/non-waveable → `needs_review`, not passed/failed. |
| 3 | `looksLikeExecutedSend` breadth (`recipients`/`recipient_count` are broad, could match a non-send object) | **WON'T-FIX** | Generic (no plugin branches); `sendExecuted` is consulted ONLY in the no-inspectable-collection fallback and never overrides the data-quality guard, so a false-positive is bounded to un-inspectable-data runs — low risk, no false-green. |
| 4 | `assessColumnFillRates` per-column correctness / shared logic | **WON'T-FIX** (correct) | Blank-in-every-row detection correct, reuses `isMeaningfulValue`, tested. |
| 5 | Regression (Finding-4 all-blank + Item 10) | **WON'T-FIX** (no regression) | Both preserved and share the signal; non-send passers unaffected. |
| 6 | Standards (DB/Pino/TS/hardcoding) | **WON'T-FIX** (clean) | No new DB writes, Pino, TS strict, zero plugin branches. |
| 7 | `preDelivery` picks the LAST assessable array by `Object.values` order (assumes insertion=execution order); and the no-collection branch can pass genuinely-blank-but-**un-inspectable** delivered data on an executed send (shared `toItemArray` container-key limit) | **FOLLOW-UP** | Not a false-green for any inspectable set (Re-run #1/#2 + AC triad all handled) and Item 10 independently blocks all-empty steps; hardening (execution-order-explicit pre-delivery pick; wider `toItemArray` key coverage / more conservative un-inspectable+send handling) is genuine separate scope, not a hedge. |

### MUST-FIX list (hand to Dev)
**EMPTY.** Nothing must change before the user's code review and the live re-test of `0ee53785`. Findings 1-6 are approved/withdrawn; Finding 7 is a tracked FOLLOW-UP (coverage-signal hardening for un-inspectable delivered shapes + execution-order-explicit pre-delivery selection), not a blocker.

### G1 / design-principle check
No violations. The false-green guarantee is preserved (all-blank inspectable sets can never pass; the executed-send relaxation is strictly scoped to the no-inspectable-data fallback), the fix is deterministic and schema-driven with zero plugin-name branches, and it is in the correct layer (calibration coverage signal). Note: Q1 (the step7 AI-input-wiring generation gap) is correctly out of scope here (Phase 3), so `0ee53785` will still resolve to `needs_review` (partial report — blank source columns named) rather than `passed` until Q1 lands — which is the correct honest verdict for its current state.

### Code Approved for QA: Yes — after the user's review + live re-test. No re-review needed (MUST-FIX empty).

## QA Testing Report — Phase 1.6

**QA — 2026-07-11**
**Test mode:** full (the three guard-rail criteria + edge/regression)
**Strategy used:** A (Jest unit) for `deriveCoverageSignal` / `assessColumnFillRates` / `looksLikeExecutedSend` / verdict; B/code-trace for the route wiring (4.9k-line handler — not run live; the live e2e on `0ee53785` is the user's post-QA test).
**Focus:** api / pipeline (calibration coverage floor) / security(none new)
**Skipped:** D (Playwright — no UI); E (log-analysis — suites green).
**Input source:** coordinator prompt + workplan "# Phase 1.6" + "## SA Code Review — Phase 1.6" + requirement Item 6 (both-direction floor) / G1c.

### What I ran
- `npx jest lib/pilot/shadow lib/schema-reconciliation lib/audit` → **16 suites, 149 tests, all passing** (147 Dev + 2 QA-added edge tests in `deriveCoverageSignal.test.ts`).
- `npx tsc --noEmit` → repo-wide pre-existing errors only; **zero** in `dataQuality.ts`, `CalibrationVerdict.ts`, `calibrate/batch/route.ts`, or the new test (grep-confirmed no matches).
- Traced the route: coverage signal hoisted once at L4243 (above both verdict sites); `partial_report_data` pushed to `allIssuesForUI` at L4273 *before* the zero-issue fast-path check at L4306; both the zero-issue site (L4402-4411) and the main site (L4726-4736) consume the same hoisted `exercisedRealPath` / `deliveredAllBlank` / `coverageReason`.
- Grep-confirmed **zero plugin-name branches** in the new code; `SEND_CONFIRMATION_MARKERS` are generic confirmation field names (`message_id`/`sent_at`/`thread_id`/`recipients`…), keys in `assessColumnFillRates` are discovered from the items themselves.

### Guard-rail acceptance criteria (the priority — the false-green guarantee)
| Case | Tested? | Result | Evidence |
|---|---|---|---|
| **CASE 1** — all-blank/all-fallback set can NEVER be `passed`, EVEN WITH an executed terminal send present | ✅ | **Pass** | `deriveCoverageSignal.test.ts` CASE 1: 13 all-blank rows + `send_report{message_id,sent_at}` → `deliveredAllBlank=true`, `exercisedRealPath=false` → `inconclusive`. Structurally sound: when a collection is inspectable, `sendExecuted` is **never referenced** (dataQuality.ts L256-265) — the executed send cannot override the meaningful-data guard. Defense-in-depth: `AllFailedStepDetector` independently raises blocking `degraded_step_all_empty`. |
| **CASE 2** — populated report whose terminal send returns only a scalar confirmation (or is suppressed) → CAN reach `passed` | ⚠️ | **Partial — passes at unit level, DEFEATED at the route for the clean case** | Unit: CASE 2 / 2b → `exercisedRealPath=true`, verdict `passed`. **BUT** at the route a clean send-terminating agent that processed items is intercepted by a stale count-based gate before the Phase 1.6 floor runs — see **Bug 1**. Does not affect `0ee53785` (partial report → needs_review). |
| **CASE 3** — partially-populated report (real amount/vendor/date, blank source columns in every row) → `needs_review`, blank columns named | ✅ | **Pass** | CASE 3 test: `partialBlankColumns=['attachment_filename','source_email_from','source_email_subject']`; route pushes non-blocking, non-waveable `partial_report_data` (naming the columns) → `computeVerdict` → `needs_review`. `isWaveable(partial_report_data)===false` confirmed. |

### Edge probes
| Probe | Result | Evidence |
|---|---|---|
| A column blank in SOME rows but present in others is NOT flagged partially-blank | ✅ Pass | QA-added: `note` populated in 1 of 2 rows → ratio 0.5, `allBlankColumns=[]`, `partiallyBlank=false`. |
| `looksLikeExecutedSend` must not false-positive on a non-send step returning an id | ✅ Pass | QA-added: `{id,status}`, `{id,name}`, `{document_id}` → all `false` (`id`/`document_id` are not confirmation markers). |
| Signal consistent across BOTH verdict sites (no bypass) | ⚠️ Pass-with-exception | Both verdict sites read the single hoisted signal (verified). HOWEVER a *third*, pre-existing route gate (the semantic-failure block) sits ahead of them and bypasses the signal — Bug 1. |

### Regression
| Check | Result | Evidence |
|---|---|---|
| Finding-4 all-blank still fails | ✅ Pass | `CalibrationVerdict` `deliveredAllBlank` unchanged; CASE 1 green. |
| Item 10 all-failed/all-empty detector intact (shared `dataQuality`) | ✅ Pass | `AllFailedStepDetector.test.ts` green; still imports the shared signal. |
| Non-send-terminating agents that previously passed still pass | ✅ Pass | Data branch: a populated collection → `exercisedRealPath=true`; CASE 2b (suppressed send / no send output) passes. |
| Zero plugin-name branches in new code | ✅ Pass | Grep-clean. |

### Issues Found

#### Bugs (should fix before CASE 2 is considered closed)
1. **A clean send/notify-terminating agent is still capped to `needs_review` at the route — the Phase 1.6 CASE 2 fix is masked by a pre-existing count-based gate** — Severity: **High** (defeats acceptance criterion CASE 2 at integration level; NOT a false-green, does NOT block the `0ee53785` live re-test).
   - File: `app/api/v2/calibrate/batch/route.ts` L4306-4392 (the "SEMANTIC VALIDATION" block), which sits *before* the Phase 1.6 G1c coverage floor (L4395+) inside the `if (allIssuesForUI.length === 0)` zero-issue branch.
   - Repro (CASE 2, clean send agent): a genuinely-populated report, terminal `send_email` returns a scalar confirmation so `items_delivered` stays 0, `items_processed > 0`, and no other issues → `allIssuesForUI.length === 0` → enters L4306 → L4313 `items_processed > 0` true → L4317 `itemsDelivered === 0` true → pushes a `semantic_failure` (high) issue and **`return`s `needs_review`** at L4363 — **before** the Phase 1.6 floor (which would honour `exercisedRealPath=true` and pass it) is ever reached.
   - Expected (Phase 1.6 CASE 2 / requirement Item 6 AC #2): a populated report whose terminal send is an uncounted scalar CAN reach `passed`.
   - Actual: `needs_review` with a misleading "Workflow processed N items but delivered 0 items … produced no output" message — the exact "send-terminating agents can essentially never reach `passed`" complaint Phase 1.6 set out to fix, still present for the clean case.
   - Why unit tests missed it: the triad exercises `deriveCoverageSignal` + `computeVerdict` directly; this stale gate is a separate, earlier route branch that short-circuits with its own `return`, so it is invisible to the unit tests. SA's trace (correctly) verified the signal → verdict path but did not account for this preempting block.
   - Recommended fix (one line, using already-hoisted vars): guard the `items_delivered === 0` return with the Phase 1.6 signal — e.g. only fire when `!exercisedRealPath || deliveredAllBlank` (i.e. skip it when the pre-delivery collection carried meaningful data or an executed send is present), so the run falls through to the unified coverage floor. `exercisedRealPath` / `deliveredAllBlank` are already in scope at L4253.
   - Scope note: does **not** affect `0ee53785` (its report is partially-blank → `partial_report_data` is pushed → `allIssuesForUI` non-empty → the whole zero-issue branch, including this gate, is skipped → main path → `needs_review` with columns named, the correct expected outcome). Does **not** reopen the false-green hole (CASE 1 still fails; an all-blank set would also trip this gate anyway). It purely leaves the too-strict direction only half-fixed for clean send agents.

#### Performance / Edge Cases
- Finding 7 (SA-tracked FOLLOW-UP): `preDelivery` picks the last assessable array by `Object.values` order (assumes insertion≈execution order), and the no-collection branch can treat un-inspectable delivered data on an executed send as exercised. Confirmed as documented; not a false-green for any inspectable set; Item 10 independently blocks all-empty steps. No action this phase.

### Test Outputs / Logs
```
Test Suites: 16 passed, 16 total
Tests:       149 passed, 149 total   (147 Dev + 2 QA-added edge tests)
# tsc --noEmit: pre-existing repo-wide errors only; 0 in any Phase 1.6 touched file
```
QA-added edge tests (no product logic altered) in `lib/pilot/shadow/__tests__/deriveCoverageSignal.test.ts`: partial-in-some-rows-not-flagged; `looksLikeExecutedSend` no-false-positive on bare id/status.

### Final Status
- [x] CASE 1 (false-green guard) — fully passes end-to-end; an executed send cannot override the all-blank guard. G1 intact.
- [x] CASE 3 (partial → needs_review, columns named) — fully passes end-to-end.
- [x] The `0ee53785` live re-test is NOT blocked — it correctly lands on `needs_review` (partial report, blank source columns named), the honest verdict pending Q1 (Phase 3).
- [ ] CASE 2 (clean send agent CAN pass) — correct at the unit level but **defeated at the route by Bug 1**; NOT a false-green, but the Phase 1.6 "too-strict" objective is only half-delivered until the stale semantic-failure gate is guarded.
- [ ] Not marked ready-for-commit: one High-severity integration bug (Bug 1) open.

**Overall QA verdict (initial): PASS-WITH-NOTES.** The false-green guarantee (the priority) is fully intact, CASE 1 and CASE 3 pass end-to-end, and nothing blocks the `0ee53785` live re-test (expected `needs_review`). However CASE 2 is not fully closed at the route — a clean, populated send/notify-terminating agent is still capped to `needs_review` by the pre-existing `items_delivered === 0` semantic-failure gate that preempts the new coverage floor (Bug 1, High). Recommend the one-line guard before CASE 2 is signed off / before commit.

### Re-verify — Bug 1 fix (QA, 2026-07-11)

Dev guarded the legacy semantic-validation gate with the unified coverage signal. Re-verified:

- **Fix in place.** `route.ts` L4316-4328: the gate is now `if (itemsDelivered === 0 && coverageSaysNoOutput)` where `coverageSaysNoOutput = !exercisedRealPath || deliveredAllBlank` (computed from the already-hoisted `deriveCoverageSignal` scalars). New single-source predicate `coverageConfirmsNoMeaningfulOutput(coverage)` in `dataQuality.ts` L291-293 is byte-identical to the inline boolean (`!coverage.exercisedRealPath || coverage.deliveredAllBlank`) and both trace to the same signal — no divergent emptiness definition.
- **CASE 2 now end-to-end (route logic + new regression test).** Clean send agent (meaningful `expense_rows` + scalar `send_report`, `items_delivered=0`): `exercisedRealPath=true`, `deliveredAllBlank=false` → `coverageSaysNoOutput=false` → gate does **not** fire → control falls through to the Phase 1.6 coverage floor / `computeVerdict` → `passed`. Proven by `semanticGate.coverageGuard.test.ts` "CLEAN send-terminating agent … NOT intercepted → can reach passed" (asserts the gate replica returns `false`). ✅ **Bug 1 resolved.**
- **CASE 1 / false-green re-confirmed (the critical one).** All-blank rows + executed send: `deliveredAllBlank=true` → `coverageSaysNoOutput=true` → gate **still fires** → `needs_review`; and even if it fell through, `computeVerdict`'s `deliveredAllBlank` dominance yields `inconclusive`. Double-guarded — the fix opened **no** false-green path. Proven by the "ALL-BLANK report … still → gate fires" test. ✅
- **Genuinely-empty preserved.** Processed>0, no meaningful pre-delivery data, no executed send → `exercisedRealPath=false` → `coverageSaysNoOutput=true` → gate still fires → `needs_review`. Proven by the "GENUINELY-EMPTY run … gate fires" test. ✅
- **CASE 3 intact.** Partial report is not force-gated by this branch (`coverageSaysNoOutput=false`); the `partial_report_data` issue makes `allIssuesForUI` non-empty → the whole zero-issue branch is skipped → main path → `needs_review` with columns named. Proven by the "PARTIALLY-blank … not force-gated" test. ✅
- **Regression + standards.** `lib/pilot/shadow` + `lib/schema-reconciliation` + `lib/audit` = **17 suites / 156 tests, all passing** (149 → 156; +7 from `semanticGate.coverageGuard.test.ts`). `tsc --noEmit` clean on all touched files. `coverageConfirmsNoMeaningfulOutput` reuses the shared `CoverageDerivation` (no divergent check); zero plugin-name branches in new code.

Minor (Low, non-blocking): the route inlines `coverageSaysNoOutput` from the hoisted scalars rather than calling `coverageConfirmsNoMeaningfulOutput` directly. Provably identical and both derive from the one signal — a tiny DRY nicety only; optional to have the route call the predicate. Not a defect.

### FINAL VERDICT — Phase 1.6: **PASS.**
All three guard-rail acceptance criteria now hold end-to-end (CASE 1 false-green intact, CASE 2 clean send agent can reach `passed`, CASE 3 partial → `needs_review` with columns named). Bug 1 (High) is **resolved and re-verified**; no open High/blocking bugs. Regression-clean (156/156), tsc-clean, zero plugin-name branches.

**Clean to commit: YES** — no open High/blocking issues across Phase 1.6 (and Bug 1 from Phase 1 + the Phase 1.5 repo-test gap were already closed). The `0ee53785` live re-test is expected to land on `needs_review` (partial report, blank source columns named) — that is the CORRECT honest outcome pending Q1 (Phase 3), not a blocker.

## Commit Info
_(RM populates)_
