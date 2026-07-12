# Workplan: Item 11 (Batch 3, sub-phase 3A) — AI/processing step inside a scatter must receive the loop variable it references

**Developer:** Dev
**Requirement:** [V6_AI_DECLARED_TRANSFORM_SCHEMA_RECONCILIATION_REQUIREMENT.md](/docs/requirements/V6_AI_DECLARED_TRANSFORM_SCHEMA_RECONCILIATION_REQUIREMENT.md) → **Item 11** + **SA Batch 3 Design § sub-phase 3A**
**RCA source of truth:** [AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md) → "Live Re-run #2 RCA"
**Branch:** `agent-failure-troubleshooting` (RM-provided; confirmed via `git branch --show-current`)
**Date:** 2026-07-12
**Status:** Code Complete — awaiting SA review

## Scope

**3A / Item 11 ONLY.** Explicitly NOT implementing 3B (Items 1/2), 3C (Items 8/9 generation), or 3D (Item 4 advisory). Folds in and closes **WP-58** (multi-input AI wiring), whose fix mechanism is exactly what Item 11 needs.

## Analysis Summary

**The bug (Re-run #2, agent `0ee53785`):** step7 is an `ai_processing`/`generate` row-builder inside a scatter (`itemVariable: attachment_item`). Its instruction prose references `attachment_item.subject/.from/.filename`, but its declared input is `{{extracted_fields}}` only. An AI step only receives its declared `input` payload as data — the prose mention of `attachment_item` is just text the model can't read as a value — so the From/Subject/Filename columns come out blank while amount/vendor/date (which ARE in `extracted_fields`) populate.

**Root-cause phase (P7).** The active compile path is Declarative IR → DSL in `ExecutionGraphCompiler.compileAIOperation` (L924). When `ai.input` is set, it is used verbatim and the node's other in-scope variables are ignored — the loop variable never enters the step's data context. The IR converter (`IntentToIRConverter`) is the earliest phase that can declare the union of referenced inputs, and `AIConfig` (declarative-ir-types-v4) lacks the `additional_inputs` field that `TransformConfig` already has. This is precisely the deferred **WP-58** shape: *add `additional_inputs` to `AIConfig`, populate in the converter, inject each as a labelled `{{var}}` block in the resolver.*

**Precedent confirming the mechanism:** `compileTransformOperation` already injects the enclosing loop `itemVariable` into a transform's config (ExecutionGraphCompiler L801-827) and already injects `transform.additional_inputs` (L790-796). The runtime already exposes an **object-valued** `input` as labelled blocks in the LLM prompt's "Data for Analysis" section (StepExecutor `buildLLMPrompt` L5449-5459; the existing multi-input branch at compileAIOperation L939-947 already produces object inputs). So promoting an AI step's input to a labelled object is a runtime-supported, already-exercised shape.

**Detection is deterministic + reference-driven (no hardcoding, P6).** Referenced variables are found structurally by matching the instruction text against the concrete set of **in-scope variable names** that actually exist in the workflow (the scatter loop `itemVariable`, from the loop context; plus the step's other declared inputs). Zero plugin names, zero field-name lists. A loop var is only a candidate inside its scatter, giving correct scoping.

## Implementation Approach

One **shared detector** reused by all three call sites (no divergent copy — mandated):

`lib/agentkit/v6/compiler/ai-input-context.ts`
- `extractBaseVarName(ref)` — strip `{{ }}` and dotted/indexed path to the base variable name.
- `detectReferencedInScopeVariables(instruction, candidateVariables, boundVariables)` — return the candidate vars whose base name is referenced in the instruction (word-boundary match) and not already bound. Deterministic, pure, no logging.

**Call site 1 — root cause (IR converter):** add a `loopItemVarStack` to `ConversionContext`, push/pop the scatter `item_ref` around loop-body conversion, and in `convertGenerate` populate `ai.additional_inputs` from the detector (candidates = enclosing loop item vars). phase4 now stores the canonical shape.

**Call site 2 — resolver (compiler):** `compileAIOperation` consumes `ai.additional_inputs`; as a defense net for IR that predates the converter fix (Principle 4), it also runs the **same** detector against `ctx.loopContextStack` item vars. It then promotes the step `input` to a labelled object (`{ <primary>: "{{primary}}", <loopVar>: "{{loopVar}}" }`) — but ONLY when at least one extra referenced var is found, so top-level and non-referencing AI steps are byte-for-byte unchanged.

**Call site 3 — in-place script (existing agent `0ee53785`):** `scripts/fix-ai-scatter-loopvar-input.ts` walks stored `pilot_steps`, finds `ai_processing` steps inside a `scatter_gather`, and uses the **same** detector (candidates = scatter `itemVariable`) to decide whether to promote the step's `input` to include the loop var. Read-only dry-run preview by default; only writes with an explicit `--apply`, via `AgentRepository.findById` + `updatePilotSteps` (owner-scoped, reusing batch-1 machinery).

**IR grammar:** add `additional_inputs?: string[]` to `AIConfig` in `declarative-ir-types-v4.ts`, mirroring `TransformConfig`.

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/agentkit/v6/compiler/ai-input-context.ts` | create | Shared deterministic detector (single source, 3 call sites) |
| `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` | modify | Add `additional_inputs?: string[]` to `AIConfig` (WP-58 grammar) |
| `lib/agentkit/v6/compiler/IntentToIRConverter.ts` | modify | Loop-item-var stack; populate `ai.additional_inputs` in `convertGenerate` (root cause) |
| `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | modify | `compileAIOperation` consumes/detects + promotes input to labelled object |
| `scripts/fix-ai-scatter-loopvar-input.ts` | create | In-place DSL edit for `0ee53785` (dry-run default; reuses shared detector + repo) |
| `lib/agentkit/v6/compiler/__tests__/ai-input-context.test.ts` | create | Detector unit + compiler-integration content assertion + scoping + negative + genericity |

## Task List

- [x] Step 1: Read V6 protocol docs + WP-58 + RCA + active generation code ✅
- [x] Step 2: Create shared detector `ai-input-context.ts` ✅
- [x] Step 3: Add `additional_inputs` to `AIConfig` ✅
- [x] Step 4: Converter — loop-item-var stack + populate `ai.additional_inputs` ✅
- [x] Step 5: Compiler — `compileAIOperation` consume/detect + labelled-object promotion ✅
- [x] Step 6: In-place script (dry-run default, `--apply` gated) ✅
- [x] Step 7: Tests (content-asserting, scoping, negative, genericity) — 13/13 pass ✅
- [x] Step 8: Run tests; typecheck touched files (0 errors); confirmed the 20 pre-existing compiler failures are NOT introduced by this change (baseline diff) ✅
- [x] Step 9: Updated WEAK_POINTS (WP-58 ✅ Fixed + Change History), removed WP-58 from OPEN_ITEMS, extended DESIGN_PRINCIPLES P11 ✅

## How to run the in-place script (dry-run FIRST)

```bash
# 1. DRY RUN (read-only; prints before/after diff, writes NOTHING):
npx tsx scripts/fix-ai-scatter-loopvar-input.ts --agent 0ee53785-44d0-4b46-85dd-367551a657ba --user <USER_ID>

# 2. Only after reviewing the diff, apply (owner-scoped write via AgentRepository):
npx tsx scripts/fix-ai-scatter-loopvar-input.ts --agent 0ee53785-44d0-4b46-85dd-367551a657ba --user <USER_ID> --apply
```

Dev does NOT run `--apply` against the real agent. The user applies it (with approval) before the final recalibration.

## SA Review Notes

## SA Code Review — Item 11 (3A)

**Code Review by SA — 2026-07-12**
**Status:** ✅ Code Approved — **MUST-FIX list is EMPTY.** Approve for user review.

### Overall verdict
Approve. This is a model V6 generation-pipeline change: the fix lands at the **root-cause phase** (IR converter) plus the **active** resolver, both driving one shared deterministic detector, with zero plugin/field hardcoding, a content-asserting test (not shape-only), correct scatter scoping, a structural no-regression property, and complete V6 Work Protocol bookkeeping. I independently confirmed the two load-bearing claims (active-path, pre-existing-20). 13/13 Item 11 tests pass.

### The two decisive confirmations (explicit)
- **Finding 1 — active path (the single most important check): CONFIRMED.** The live declarative-IR compile path is `IntentToIRConverter.convert` → `ExecutionGraphCompiler.compile` → `compileAIOperation`. Proof: `V6PipelineOrchestrator.ts:545-546` (`new ExecutionGraphCompiler(...); compiler.compile(ir, ...)`) and both `app/api/v6/generate-ir-intent-contract` and `generate-ir-semantic` routes instantiate `ExecutionGraphCompiler`; `IntentToIRConverter` feeds it. The `AIOperationResolver`/`LogicalIRCompiler` (rules) compiler is legacy — instantiated only by the rules classes and invoked only by the separate `app/api/v6/compile-workflow` route (ExecutionGraphCompiler even carries a "migration from DeclarativeCompiler to ExecutionGraph" note). **Dev correctly recognised the SA Batch-3 design doc's `AIOperationResolver` naming as off-path and fixed the live `compileAIOperation` + the root-cause converter — avoiding the dead-path trap that recurred through this saga.** P7-correct.
- **Finding 6 — pre-existing 20 failures: INDEPENDENTLY CONFIRMED.** Stash-baseline diff of the two flagged suites (`DeclarativeCompiler-regression`, `LogicalIRCompiler`): **without** Item 11 = 20 failed / 2 passed / 22 total; **with** Item 11 = identical 20 failed / 2 passed / 22 total. The 20 are pre-existing (they live in the legacy rules-compiler suites) and are **not** introduced by this change. No masked regression.

### Verification of the rest
- **Deterministic + generic (P4/P6):** the detector matches on word boundaries (`\b${escaped}\b`) against the concrete in-scope variable set; the "no partial-substring" test proves `attachment_items_count` does not false-match `attachment_item`. Grep-confirmed zero plugin/field-name branches in the detector and the script. It wires *data*, not a prompt nudge.
- **Scoping:** converter brackets the loop body with `loopItemVarStack.push(itemVar)`/`.pop()` (L747-750); the compiler reads `ctx.loopContextStack` item vars; a top-level AI step yields empty candidates and is left unchanged (scoping test). Nested scatters accumulate the stack correctly (script recursion `[...itemVarStack, childItemVar]`; converter push/pop nests). No leak on the success path.
- **No-regression (content-blind-suite risk):** input is promoted to a labelled object **only when `extraVars.length > 0`**, so a non-referencing / top-level / already-bound AI step keeps its scalar `input` byte-for-byte (negative + "already bound" tests verify). Object-valued AI input is an already-exercised runtime shape (the existing multi-input branch + StepExecutor labelled "Data for Analysis" blocks). The **content** test resolves the injected var against a representative item and asserts the previously-blank columns are POPULATED (P8/WP-43 lesson — semantics, not shape).
- **In-place script:** reuses the SAME shared detector (no divergent copy); DB access via `AgentRepository.findById` + `updatePilotSteps`, both owner-scoped (`.eq('id').eq('user_id')`); dry-run is the default and operates on a deep clone (writes nothing); writes only on explicit `--apply`. Safe/reversible to hand to the user.
- **Standards + WP-58:** new files have zero `console.*` (Pino via `createLogger` in the script), TS strict, `additional_inputs?: string[]` mirrors the `TransformConfig` precedent. WP-58 marked ✅ Fixed in WEAK_POINTS with a Change History entry, removed from the OPEN_ITEMS backlog body, and P11 evidence extended (tied to the WP-43 lesson). Full protocol compliance.

### Findings & dispositions (decisive)

| # | Finding | Ruling | One-line reason |
|---|---------|--------|-----------------|
| 1 | Root-cause / active-path placement | **WON'T-FIX** (verified correct) | Live path is `compileAIOperation` + `IntentToIRConverter`; `AIOperationResolver` is legacy/off-path — Dev fixed the right place. |
| 2 | Deterministic / generic (P4/P6) | **WON'T-FIX** (clean) | Structural word-boundary detection; zero plugin/field branches; wires data, not a nudge. |
| 3 | Scatter scoping (push/pop, nesting) | **WON'T-FIX** (correct) | Balanced push/pop brackets the loop body; top-level steps unaffected; nesting accumulates correctly. |
| 4 | No-regression on existing AI steps | **WON'T-FIX** (controlled) | Object-promotion is gated on `extraVars.length > 0`; non-referencing steps byte-identical; object input is an established runtime shape; real content test. |
| 5 | Compiler trusts `ai.additional_inputs` without re-checking the instruction (converter over-declaration would inject extra blocks) | **FOLLOW-UP** | Additive/noisy at worst, never corrupting; the converter only populates from the same detector, so it cannot currently over-declare — pure hardening. |
| 6 | Pre-existing 20 failures | **WON'T-FIX** (confirmed pre-existing) | Stash-baseline identical (20/2/22) with and without the change; legacy-suite debt, out of scope. |
| 7 | 3 pre-existing `console.*` in the off-path `AIOperationResolver` | **FOLLOW-UP** | On a legacy file Dev did not (and should not) touch here; converting a file you aren't otherwise working on violates "don't reformat untouched files" — fold into the eventual legacy-path cleanup/removal. |

### MUST-FIX list (hand to Dev)
**EMPTY.** Nothing must change before the user's review. Findings 1-4 and 6 are approved/withdrawn; Findings 5 and 7 are tracked FOLLOW-UPs (compiler additional_inputs re-validation hardening; legacy `AIOperationResolver` console.* cleanup), neither a blocker.

### One operational note for the user (not a code finding)
The in-place script's `--apply` writes to the stored agent. It is dry-run-by-default and owner-scoped, and the workplan attests Dev did not run `--apply` against the real agent — I cannot verify DB history from here, so please confirm the dry-run diff before running `--apply` on `0ee53785`.

### G1 / V6 design-principle check
No violations. P4 (deterministic — no prompt nudge), P6 (no plugin/field hardcoding — schema/reference-driven), P7 (fixed at the root-cause phase, on the active path), P11 (doesn't hide the failure — it makes the referenced variable actually reach the model, and the evidence is recorded). One shared detector across all three call sites (constraint #5).

### Code Approved for QA: Yes — after the user's review. No re-review needed (MUST-FIX empty).

## QA Testing Report — Item 11 (3A)

**QA — 2026-07-12**
**Test mode:** full (content-asserting acceptance criteria + scoping + negative + genericity + pre-existing-20 baseline + script static review)
**Strategy used:** A (Jest unit + compiler-integration content assertion) for the detector/converter/compiler; static code review for the in-place script (NOT executed — dry-run/`--apply` left to the user per instruction); stash-baseline diff for the pre-existing-20 confirmation.
**Focus:** pipeline (V6 generation — IR converter + active compiler) / genericity / security(script owner-scoping)
**Skipped:** live execution of the in-place script (`--apply` and even dry-run against a real agent — out of scope; the user runs the live proof). D/E n/a.
**Input source:** coordinator prompt + workplan + SA Code Review (3A) + requirement Item 11 / SA Batch 3 Design.

### What I ran
- `npx jest ai-input-context.test.ts` → **13/13 pass**.
- `npx jest IntentToIRConverter.p32 + IntentToIRConverter.wp33 + ExecutionGraphCompiler.wp60 + ai-input-context` → **4 suites / 41 tests pass** (the 28/28 converter/compiler suites Dev cited + the 13 detector/integration tests).
- **Pre-existing-20 INDEPENDENTLY CONFIRMED (QA's own stash-baseline).** `DeclarativeCompiler-regression` + `LogicalIRCompiler` **WITH** Item 11 = **20 failed / 2 passed / 22 total**; after `git stash push` of the three Item 11 source edits (`ExecutionGraphCompiler.ts`, `IntentToIRConverter.ts`, `declarative-ir-types-v4.ts`), the **baseline WITHOUT** Item 11 = **identical 20 failed / 2 passed / 22 total**. Stash popped and files restored (verified). → Item 11 introduces **ZERO** new failures; the 20 are pre-existing legacy rules-compiler debt.
- `npx tsc --noEmit` → **zero** errors in any touched file (`ai-input-context.ts`, `IntentToIRConverter.ts`, `ExecutionGraphCompiler.ts`, `declarative-ir-types-v4.ts`, `fix-ai-scatter-loopvar-input.ts`).
- Grep: **zero** plugin/field-name branches in `ai-input-context.ts` and the script.

### Item 11 acceptance criteria (content-asserting)
| Criterion | Tested? | Result | Evidence |
|---|---|---|---|
| AI-in-scatter step referencing the loop var RECEIVES it; columns POPULATE with real values (not just "ran") | ✅ | Pass | `compileAIOperation — CONTENT` test: input promoted to `{ extracted_fields:'{{extracted_fields}}', attachment_item:'{{attachment_item}}' }`; resolving against a representative item yields `attachment_item.subject='Your Wolt receipt'`, `.from`, `.filename` populated (P8/WP-43 semantics, not shape). Root cause: converter declares `additional_inputs`; compiler injects labelled object. |
| Consumes IR-declared `additional_inputs` (root-cause converter output) even when prose doesn't mention it | ✅ | Pass | "consumes IR-declared additional_inputs" test. |
| Scoping — loop var injected ONLY inside its scatter; top-level AI step unaffected | ✅ | Pass | "SCOPING: a top-level AI step is unaffected" (empty `loopContextStack` → input stays the plain string). Converter brackets loop body with balanced `loopItemVarStack.push/pop` (L744-750). Nested scatters accumulate the stack (script `[...itemVarStack, childItemVar]`). |
| No-regression — AI step referencing no extra var is byte-for-byte unchanged (no spurious inputs) | ✅ | Pass | "NEGATIVE / no-regression" + "does not re-inject a variable already bound" — promotion gated on `extraVars.length > 0`; scalar input preserved. |
| Genericity — arbitrary non-plugin var/field names; word-boundary rejects partial substrings | ✅ | Pass | "GENERIC: gizmo_item" + detector "matches on word boundaries only" (`attachment_items_count` does NOT false-match `attachment_item`). Zero plugin/field hardcoding. |

### In-place script — STATIC validation only (NOT executed)
| Safety property | Result | Evidence |
|---|---|---|
| Dry-run by default; writes only on `--apply` | ✅ | `apply = argv.includes('--apply')` (L61); `if (!args.apply) { …return }` (L207) precedes the only write (`updatePilotSteps`, L215). |
| Operates on a deep clone (dry-run mutates nothing persistent) | ✅ | `JSON.parse(JSON.stringify(pilotSteps))` (L182); `repairSteps` mutates only the clone. |
| Owner-scoped through `AgentRepository` (`.eq('user_id')`) | ✅ | `repo.findById(agentId, userId)` + `repo.updatePilotSteps(agentId, userId, …)` — both carry `.eq('id').eq('user_id')` (batch-1 machinery). |
| Reuses the SAME shared detector (no divergent copy) | ✅ | Imports `detectReferencedInScopeVariables` / `extractBaseVarName` from `ai-input-context`. |
| **`new AgentRepository()` no-arg constructor (coordinator's specific check)** | ✅ **Not a bug** | `constructor(supabaseClient?)` defaults to `supabaseServer` (service-role) when no client is passed (`AgentRepository.ts` L34-35). It does **not** throw and does **not** require a client — the dry-run will not fail on construction. Service-role is correct for a standalone CLI (no request auth context); owner-scoping is still enforced by the explicit `.eq('user_id', userId)` in both repo methods, so RLS bypass does not weaken isolation. |

Operational note (not a code finding): the script relies on `supabaseServer`, which needs `SUPABASE_SERVICE_ROLE_KEY` in the environment; run it in a configured shell. The dry-run diff should be reviewed before `--apply` (as the workplan and SA both instruct).

### Scope & standards
- **Only 3A/Item 11 files touched** — the 3 modified (`ExecutionGraphCompiler.ts`, `IntentToIRConverter.ts`, `declarative-ir-types-v4.ts`) + 3 new (`ai-input-context.ts`, its test, `fix-ai-scatter-loopvar-input.ts`). No 3B (Items 1/2), 3C (Items 8/9 generation), or 3D (Item 4 advisory) files. (Other uncommitted working-tree entries — `.claude/*`, prompt-templates, phase2-loop-controller, google-token, GoogleDrivePicker — are pre-existing session-start noise, not Item 11.)
- Shared detector across all 3 call sites (constraint #5); zero plugin-name branches; Pino logging in the script; TS strict; `additional_inputs?: string[]` mirrors `TransformConfig`.

### Issues Found
#### Bugs
- **None.** The specifically-flagged `new AgentRepository()` constructor is safe (defaults to the service-role client, never throws). No functional defect found.

#### Follow-ups (SA-tracked, not blockers)
1. Compiler trusts `ai.additional_inputs` without re-checking the instruction (SA Finding 5) — additive-at-worst hardening; the converter only populates from the same detector so it cannot currently over-declare.
2. 3 pre-existing `console.*` in the off-path legacy `AIOperationResolver` (SA Finding 7) — untouched legacy file; fold into eventual legacy-path cleanup.

### Test Outputs / Logs
```
ai-input-context.test.ts .......................... 13/13
converter/compiler (p32 + wp33 + wp60) + detector .. 4 suites / 41 tests pass

Pre-existing-20 (QA stash-baseline):
  WITH Item 11    : 20 failed / 2 passed / 22 total
  WITHOUT (stashed): 20 failed / 2 passed / 22 total   ← identical → 0 new failures
  (stash popped; 3 source files restored to modified)

tsc --noEmit: 0 errors on all touched files
```

### Final Status
- [x] All Item 11 acceptance criteria pass, content-asserting (columns populate, not just "ran").
- [x] Scoping / negative / genericity all verified; word-boundary rejects partial substrings.
- [x] Pre-existing 20 failures independently confirmed via QA's own stash baseline (identical 20/2/22).
- [x] In-place script statically validated (dry-run default, deep clone, owner-scoped, shared detector); `new AgentRepository()` confirmed safe.
- [x] Scope clean (only 3A/Item 11); zero plugin-name branches; zero new TS errors.

**Overall QA verdict: PASS.** Root-cause + active-path fix, deterministic, generic, correctly scoped, content-proven; no blocking bugs. The true end-to-end proof (dry-run the script → review diff → `--apply` → recalibrate → populated From/Subject/Filename columns) is the user's live re-test — nothing at the code level blocks it.

**Clean to commit: YES** — no open High/blocking issues.

## Commit Info
_(RM to populate)_
