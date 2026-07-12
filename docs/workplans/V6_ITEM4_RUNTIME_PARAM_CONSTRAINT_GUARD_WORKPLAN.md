# Workplan: Item 4 — Runtime Param-Constraint Guard (clamp-and-warn)

**Developer:** Dev
**Requirement:** [V6_AI_DECLARED_TRANSFORM_SCHEMA_RECONCILIATION_REQUIREMENT.md](/docs/requirements/V6_AI_DECLARED_TRANSFORM_SCHEMA_RECONCILIATION_REQUIREMENT.md) — **Item 4** + **SA Review Round 2, Refinement 1**
**Date:** 2026-07-11
**Branch:** `agent-failure-troubleshooting`
**Status:** Code Complete

## Analysis Summary

This is **Phase 2** of the requirement (per the authoritative Implementation Order) — the plugin guard — and is fully self-contained. It does **not** touch the calibration batch (Phase 1, already committed) nor the generation-side items (Phase 3).

Item 4 origin: agent `0ee53785` had `max_results: 500` baked into a Gmail `search_emails` step, but the plugin declares `minimum:1, maximum:100, default:10` (`lib/plugins/definitions/google-mail-plugin-v2.json` L305-310). Nothing validated the outgoing value against the plugin's own declared constraints. Per SA Round 2 (Refinement 1), an out-of-range value the connector tolerates is **not** execution-breaking, so this is a **generic, self-healing runtime guard** — never a build gate, never a throw, never a block.

**Chokepoint found:** `BasePluginExecutor.executeAction()` in `lib/server/base-plugin-executor.ts` is the single template method every plugin action flows through before `executeSpecificAction()` (the concrete external call). Its Step 0 already fetches `actionDef.parameters.properties` — the exact schema shape carrying `minimum` / `maximum` / `enum` / `default` (typed as `ActionParameterSchema` / `ActionParameterProperty` in `lib/types/plugin-types.ts`). Placing the guard here covers **all** plugins/actions with zero per-plugin logic, and no matter how the bad value arrived (AI generation, manual edit, cached workflow).

## Implementation Approach

1. Build a standalone, pure, generic guard module `lib/server/param-constraint-guard.ts` (`applyParamConstraintGuard`). It reads each present param's declared constraints from the action's own parameter schema and:
   - **Numeric over-max / under-min** → clamp to the declared bound, warn, continue. Preserves the input's JS type (number stays number, numeric-string stays string).
   - **Invalid enum** → use the plugin's declared `default` if present; else warn-and-pass-through unchanged (never drop, never invent).
   - **Non-clampable numeric** (declared numeric constraint but value isn't a finite number) → declared `default` if present, else warn-and-pass-through unchanged.
   - **Valid in-range / valid enum** → untouched, no warning.
   - Params with no declared schema entry (e.g. internal `_calibration`) → untouched.
   - The whole body is wrapped so it **never throws** — on any internal error it returns the original params unchanged.
2. Emit structured **Pino warn** for every clamp/fallback carrying: param name, offending value, corrected value, constraint, correction type, and plugin/action context.
3. Wire it into `executeAction()` as "Step 0b", right after the existing array-normalization and **before** validation + the external call, so the clamped value is what both validation and the plugin see (a self-heal, not a block).

**Root-cause placement note:** SA Round 2 explicitly designated the **shared plugin-execution layer at runtime** as the authoritative home (it is the last line before the external API). This workplan implements only that runtime slice. The compile/creation-time advisory is out of scope (deferred to the generation batch, per the requirement).

## Files to Create / Modify
| File | Action | Reason |
|------|--------|--------|
| `lib/server/param-constraint-guard.ts` | create | Generic, schema-driven, never-throws clamp/fallback guard + Pino warn |
| `lib/server/base-plugin-executor.ts` | modify | Call the guard in `executeAction()` (Step 0b), the all-plugin chokepoint |
| `lib/server/__tests__/param-constraint-guard.test.ts` | create | Unit tests: over-max clamp (500→100), under-min clamp, invalid-enum→default, invalid-enum-no-default→passthrough, in-range untouched, non-clampable, never-throws, no plugin-name branches |

## Task List
- [x] Step 1: Read requirement Item 4 + SA Round 2 ruling, CLAUDE.md, executor layer, plugin definition shape
- [x] Step 2: Write this workplan
- [x] Step 3: Create `param-constraint-guard.ts` (pure, generic, never-throws)
- [x] Step 4: Wire guard into `executeAction()` as Step 0b
- [x] Step 5: Write Jest unit tests
- [x] Step 6: Run tests + typecheck, confirm green

## SA Review Notes

## SA Code Review

**Code Review by SA — 2026-07-11**
**Status:** ✅ Code Approved — **MUST-FIX list is EMPTY.** Approve for user review.

### Overall verdict
Approve. Item 4 is a clean, correct, fully generic runtime clamp-and-warn guard that matches the SA Round-2 contract exactly (runtime, schema-driven, non-blocking, never-throws; compile-time advisory correctly out of scope). It is placed at the single true chokepoint, covers all plugins with zero per-plugin logic, and cannot break a live run. All 12 unit tests pass on an independent run.

### Verification (severity-ranked)
1. **Genericity / no plugin-hardcoding (highest) — CLEAN.** The guard reads constraints purely from `schema.properties[key]` (`.minimum`/`.maximum`/`.enum`/`.default`) and iterates `Object.keys(safeParams)`. Grep confirms ZERO plugin-name/field-name branches in executable code (the only `gmail`/`max_results` mention is the header comment explaining origin). Test "is generic — same schema drives corrections regardless of plugin/action name" proves plugin-agnosticism.
2. **Chokepoint correctness — CONFIRMED, no bypass.** `executeSpecificAction` is `protected` in all 20 concrete executors and is called from exactly ONE place — `base-plugin-executor.ts:110`, inside `executeAction()`. The guard runs at Step 0b (after the existing array-normalization Step 0, before `validateActionParameters` and the external call). Callers (`plugin-executer-v2.ts:106`, and the pilot path) invoke `executeAction`. So every plugin action is covered and there is no route that reaches the external API skipping the guard.
3. **Non-blocking / never-throws + clamp-before-validation — CORRECT.** The whole body is wrapped in try/catch that returns `safeParams` untouched on any internal error (test: never throws on undefined schema / null params). Clamping precedes `validateActionParameters` (L59), so a plugin's own out-of-range block rule (e.g. `max_results > 100`) sees the already-clamped value and no longer fires. Valid in-range params are untouched with no warning and no mutation of the caller's object (tests: in-range untouched, valid enum untouched, does-not-mutate-caller). Returns a shallow clone (`{...params}`), so the guard itself never mutates the caller.
4. **Constraint logic — CORRECT for the contract.** Over-max/under-min clamp to the declared bound; JS type preserved, incl. numeric-string `'500'→'100'` — this is **safe**, not a coercion risk: the guard is deliberately type-neutral (it only changes magnitude, never introduces a new type), and the string-vs-number question predates the guard and belongs to validation; the guard strictly *removes* the range-violation block condition and never adds one. Invalid enum → declared default, else passthrough unchanged (never drops, never invents). Non-schema'd keys (e.g. `_calibration`) untouched.
5. **Logging / standards — CLEAN.** Structured Pino `warn` carrying plugin, action, param, constraint, correction type, offending value, corrected value (L206-217). The guard's warn includes plugin context independently of the executor's constructor logger. TS strict (typed interfaces, `unknown`, no implicit `any`). Zero `console.*`.

### Findings & dispositions (decisive)

| # | Finding | Ruling | One-line reason |
|---|---------|--------|-----------------|
| 1 | Genericity / plugin-hardcoding | **WON'T-FIX** (clean) | 100% schema-driven off `actionDef.parameters`; grep-confirmed zero plugin/field branches. |
| 2 | Chokepoint / bypass | **WON'T-FIX** (correct) | `executeSpecificAction` is `protected`, called only inside `executeAction()`; guard sits before it — universal coverage. |
| 3 | Non-blocking / never-throws / clamp-before-validate | **WON'T-FIX** (correct) | Whole-body try/catch returns params untouched on error; in-range params untouched, caller object not mutated. |
| 4 | Numeric-string type preservation (`'500'→'100'`) | **WON'T-FIX** (safe by design) | Type-neutral; only removes the range-violation block, never adds a new type mismatch; validation still owns type. |
| 5 | Constraint edge gaps: `exclusiveMinimum`/`exclusiveMaximum` not handled; nested/object-param sub-constraints not recursed; `default` trusted blindly; array/boolean on a numeric param → default | **FOLLOW-UP** | None occur in the RCA case or the contract (top-level `minimum`/`maximum`/`enum`); trusting the plugin's declared `default` is exactly what the requirement mandates; recursion + exclusive bounds are genuine later hardening, not a hedge. |
| 6 | Logging / TS strict / console | **WON'T-FIX** (clean) | Pino warn with full context; typed; no console. |
| 7 | Pre-existing `TS2353` at `base-plugin-executor.ts:20` (`createLogger({ module, plugin: pluginName })` — `plugin` not in `LoggerOptions`) | **FOLLOW-UP** | Pre-existing (git-stash verified), on the constructor line unrelated to the Item 4 Step 0b wiring, runtime-harmless (Pino tolerates the extra key) and build-ignored; the guard's own logging is unaffected. Expanding Item 4 to fix unrelated pre-existing typing debt contradicts "minimize must-fix," and Item 4 is correct/shippable with it present. Recommended trivial fix (attach via `.child({ plugin: pluginName })`, or drop `plugin` from the options, or widen `LoggerOptions`) tracked as a tiny logging-typing cleanup. |

### MUST-FIX list (hand to Dev)
**EMPTY.** Nothing must change before the user's review. Findings 1-4 and 6 are approved/withdrawn; Findings 5 and 7 are tracked FOLLOW-UPs (constraint-logic hardening for exclusive/nested bounds; a one-line logging-typing cleanup), neither a blocker.

### G1 / design-principle check
No violations. The guard is deterministic and schema-driven with zero plugin-name branches (Platform Design Principle — No Hardcoding), placed at the correct root (the shared plugin-execution layer, per SA Round 2), non-blocking and fail-loud (warns so the origin defect stays visible), and correctly limited to the runtime slice (compile-time advisory deferred to the generation batch, per the contract).

### Code Approved for QA: Yes — after the user's review. No re-review needed (MUST-FIX empty).

## QA Testing Report

**QA — 2026-07-12**
**Test mode:** full (all Item 4 acceptance criteria + edge/failure paths)
**Strategy used:** A (Jest unit) for the pure guard; B/code-trace for the `executeAction` Step 0b wiring (the guard is a pure function; the chokepoint is verified by inspection, matching SA's trace).
**Focus:** api (shared plugin-execution layer) / schema-driven genericity
**Skipped:** D/E — no UI, no live run needed (guard is deterministic + unit-covered).
**Input source:** coordinator prompt + workplan + SA Code Review + requirement Item 4 / SA Round-2 Refinement 1.

### What I ran
- `npx jest lib/server/__tests__/param-constraint-guard.test.ts lib/server/__tests__/base-plugin-executor.calibration.test.ts` → **2 suites, 23 tests, all passing** (12 Dev guard tests + 2 QA-added edge tests + 9 executor calibration regression tests).
- `npx tsc --noEmit` → the guard's own file `param-constraint-guard.ts` has **zero** errors; `base-plugin-executor.ts` shows exactly **one** error, `TS2353` at L20 (the constructor `createLogger({ module, plugin: pluginName })`). **Confirmed pre-existing** via `git show HEAD:` — the identical line existed at HEAD (line 19, before the Item 4 import shifted it to 20). Item 4 (import + Step 0b) introduced **zero new** errors. SA dispositioned this as a FOLLOW-UP (runtime-harmless, build-ignored).
- Scope check: `git status` shows **no** calibration (`app/api/v2/calibrate/*`) or generation-side (`lib/agentkit/v6/*`, capability-binding, intent) files touched — only `param-constraint-guard.ts` (new), `base-plugin-executor.ts` (Step 0b), and the test.
- Genericity: grep of `param-constraint-guard.ts` executable code for plugin names → **zero** matches (the only hits are the header comment naming the RCA origin). The guard reads constraints purely from `schema.properties[key]`.

### Test Coverage — Item 4 acceptance criteria
| Acceptance Criterion | Tested? | Result | Evidence |
|---|---|---|---|
| Numeric over-max → clamped to declared max, warns, CONTINUES (500→100) | ✅ | Pass | Test "clamps a numeric value above the declared maximum (500 → 100)…": `params.max_results=100`, one `clamp` correction, one warn; `query` untouched. |
| Numeric under-min → clamped to declared min | ✅ | Pass | Test "clamps … below the declared minimum (0 → 1)": `params.max_results=1`, `minimum`/`clamp`, warns. |
| Invalid enum → declared default | ✅ | Pass | Test "falls back an invalid enum to the declared default": `'everything'→'snippet'`, `enum`/`default`. |
| Invalid enum with NO default → warn + pass through unchanged (never dropped, never invented) | ✅ | Pass | Test "passes an invalid enum through unchanged when there is NO declared default": `'zzz'` unchanged, `enum`/`passthrough`, warns. |
| Valid in-range value → untouched, NO warning | ✅ | Pass | Tests "leaves a valid in-range numeric untouched" (25) + "leaves a valid enum value untouched" ('full') — 0 corrections, `warn` not called. |
| Guard never throws, never blocks; plugin's own out-of-range block rule no longer fires | ✅ | Pass | Test "never throws on undefined schema / null params / malformed input" (whole-body try/catch returns params untouched). Wiring: Step 0b runs **before** `validateActionParameters` (`base-plugin-executor.ts` L48-59), so validation + the plugin see the already-clamped value → the block rule (e.g. `max_results>100`) cannot fire. |
| Non-clampable numeric → default (else passthrough) | ✅ | Pass | Test "falls back a non-clampable (non-numeric) value … to the declared default": `'lots'→10`. |
| Fully generic — identical behavior across plugin names for the same schema | ✅ | Pass | Test "is generic — the SAME schema drives corrections regardless of plugin/action name": `plugin-x`/`plugin-y` both clamp 500→100. Zero plugin-name branches (grep-clean). |

### Edge probes
| Probe | Result | Evidence |
|---|---|---|
| Param present in params but ABSENT from schema → untouched | ✅ Pass | QA-added: `undeclared_param:999999` untouched, 0 corrections. Also the `_calibration` test. |
| `null`/`undefined` params or undefined action schema → no throw, returned untouched | ✅ Pass | "never throws …": `undefined` schema → `max_results:500` returned unchanged, 0 corrections. |
| Numeric value exactly equal to the bound → NOT clamped, no warning | ✅ Pass | QA-added boundary test: `max_results:100` (=max) and `:1` (=min) both unchanged, 0 corrections, no warn. (Logic uses strict `>`/`<`.) |
| Caller's params object not mutated (guard returns a clone) | ✅ Pass | Test "does not mutate the caller-supplied params object": original `{max_results:500}` intact; guard returns `{...params}` shallow clone. |
| JS type preserved on numeric-string clamp (`'500'→'100'`) | ✅ Pass | Test preserves string type; SA ruled type-neutral / safe. |

### Regression & standards
- `base-plugin-executor.calibration.test.ts` → **9 tests pass** — no regression from the Step 0b insertion.
- Chokepoint (SA-verified, re-confirmed): `executeAction` is the single template method; Step 0b sits after array-normalization (Step 0), before validation + the external call; `parameters` is reassigned to `guarded.params`. Universal coverage, no bypass.
- Zero plugin-name branches; structured Pino `warn` with full context; TS strict (typed interfaces, no implicit `any`); no `console.*`.

### Issues Found
#### Bugs
- **None.** No High/Medium/Low functional defect found.

#### Pre-existing / Follow-ups (not introduced by Item 4)
1. **`TS2353` at `base-plugin-executor.ts:20`** — the constructor `createLogger({ module, plugin: pluginName })` (`plugin` not in `LoggerOptions`). Confirmed pre-existing (present at HEAD), on the constructor line unrelated to the Step 0b wiring, runtime-harmless (Pino tolerates the extra key) and build-ignored. SA FOLLOW-UP (one-line logging-typing cleanup). Not a blocker.
2. **Constraint-logic hardening** (SA Finding 5): `exclusiveMinimum`/`exclusiveMaximum` and nested/object sub-constraints not handled; none occur in the RCA case or the contract (top-level `minimum`/`maximum`/`enum`). Genuine later hardening, deferred. Not a blocker.

### Test Outputs / Logs
```
Test Suites: 2 passed, 2 total
Tests:       23 passed, 23 total   (12 Dev + 2 QA-added edge + 9 executor regression)
# tsc --noEmit: 0 errors in param-constraint-guard.ts; 1 PRE-EXISTING TS2353 in base-plugin-executor.ts:20 (constructor logger, unrelated to Item 4); 0 new errors introduced.
```
QA added 2 edge tests (no product logic changed): exact-boundary-not-clamped; param-absent-from-schema-untouched.

### Final Status
- [x] All six Item 4 acceptance criteria pass (clamp over-max / under-min, enum→default, enum-no-default→passthrough, in-range untouched, never-throws/never-blocks, fully generic).
- [x] Edge cases covered (absent param, null/undefined, exact boundary, no caller mutation).
- [x] Scope clean — no calibration/generation code touched; chokepoint universal; zero plugin-name branches.
- [x] No new TS errors; the single error is pre-existing + SA-dispositioned follow-up.

**Overall QA verdict: PASS.** The guard exactly matches the SA Round-2 contract: generic, schema-driven, runtime, non-blocking, never-throws, clamp-before-validate. No blocking bugs.

**Clean to commit: YES** — no open High/blocking issues. The only tsc error is a pre-existing, runtime-harmless, build-ignored typing follow-up unrelated to this change.

## Commit Info
_(RM will populate)_
