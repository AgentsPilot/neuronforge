# Workplan: CI Guards — Mocked Repository Methods (G-1) and Services/API Type Check (G-2)

> **Last Updated**: 2026-10-15

**Developer:** Dev
**Requirement:** SA conditions for the F-13 follow-up guards (F-13 = `findTimezone` crash, fixed in PR #387; background in [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md))
**Branch:** `chore/ci-guards-mock-methods-and-tsc` (from `origin/main` b20da2cc)
**Date:** 2026-10-15
**Status:** G-1 Code Complete (uncommitted, awaiting SA code review); G-2 not started (separate PR, C-7)

## Overview

F-13 shipped because four safety nets all missed it. A merge (f66cae67) deleted
`UserPreferencesRepository.findTimezone`, but `ProposalAcceptanceService` still called it.
`next.config.js` ignores type errors and Jest only transpiles. The one `tsc` gate
(`scripts/typecheck-bos-llm.ts`) does not cover `lib/services/`. And
`packageAcceptance.test.ts` mocked the whole repository with its own `findTimezone`, so the
test passed. This workplan adds two guards, as two numbered slices that reuse CI jobs we
already have:

- **G-1**: a Jest guard. Every repository method a test mocks must exist on the real class.
- **G-2**: a second scope (`lib/services/**` + `app/api/**`) for the existing baseline `tsc`
  gate. It runs in the same required job. G-2a only measures and reports; G-2b makes it blocking.

No product code changes. No new workflow, job or required-check name.

## Table of Contents

- [Measurements (taken 2026-10-15)](#measurements-taken-2026-10-15)
- [Slice G-1 — Mocked repository methods must exist](#slice-g-1--mocked-repository-methods-must-exist)
- [Slice G-2 — Services/API scope for the baseline tsc gate](#slice-g-2--servicesapi-scope-for-the-baseline-tsc-gate)
- [Logging-rule check](#logging-rule-check)
- [Open Questions for SA](#open-questions-for-sa)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Measurements (taken 2026-10-15)

The local box was heavily loaded during these runs. The existing gate took **270 s locally
against about 42 s in CI** (ratio ≈ 6.4). So the CI figures below are estimates scaled by
that ratio, and the real figures come from the CI runs planned in each slice.

### CI medians (`gh run list` / `gh run view`, last 25 successful runs, skipped runs excluded)

| Job | Median (last 10 that ran) | Range |
|---|---|---|
| `Build (next build)` — the critical path | **≈ 201 s** | 130–265 s |
| `Type check (Business OS LLM attribution)` | **≈ 149 s** | 96–159 s |
| ↳ step `Run scoped type check` | ≈ 42 s | 28–47 s |
| ↳ step `Install dependencies` | ≈ 74 s | 46–79 s |
| `Gate tests shard N` (3 shards) | ≈ 160 s | 102–196 s |
| `Gate tests (jest)` verdict (after the shards) | ≈ 12 s | 5–16 s |

### G-1 prototype (read-only scratch script in `%TEMP%`, TypeScript compiler API on both sides)

| Figure | Value |
|---|---|
| `jest.mock` / `jest.doMock` sites resolving into `lib/repositories/` | **328** in **162** test files |
| Barrel mocks (`@/lib/repositories`) | 1 (`lib/effort-estimator/__tests__/modelResolver.test.ts`) |
| Relative-path mocks resolving into `lib/repositories/` | 0 today (still supported) |
| Literal keys checked | 413 |
| Skipped: block-bodied factory | 22 |
| Skipped: instance value not an object literal (variable, getter, call) | 33 |
| **Mismatches today (= baseline size)** | **0** |
| Fixture check: an added fake method and a fake export | both reported |
| Repository classes that `extends` anything | none (only `Error` subclasses) |
| Local time, whole-repo walk (4,506 TS files) | 8.4–9.5 s |
| Local time, test-files-only walk (1,383 files) + regex prefilter (176) + parse | ≈ 0.6 + 0.7 + 3.3–7.5 s |

CI estimate for the test-files-only design: **≈ 1–1.5 s**. The budget is under 3 s.

### G-2 prototype (same program as the existing gate; diagnostics for the extra files)

| Figure | Value |
|---|---|
| Existing scope today | 532 files, 28 errors, 0 new. It also reports **one stale baseline entry**, which is fixed on main: `app/api/onboarding/build/route.ts \| TS18047` |
| `lib/services/**` + `app/api/**`, non-test | **226 errors in 79 files** (top codes: TS2339 ×74, TS2322 ×63, TS2345 ×19, TS7006 ×18) |
| Same, test files | **4 errors in 2 files** |
| **Expected new baseline** | **≈ 230 diagnostics.** They collapse to ≤ 230 keys, and the exact count comes from `--update-baseline` |
| Extra local wall time | ≈ 127 s (non-test) + 23 s (tests) = **≈ 150 s locally → ≈ 23 s CI (est.)** |
| Projected job time | 149 + 23 ≈ **172 s against Build's 201 s** (≈ 29 s headroom) |
| Repo-wide error count | Not re-measured. The script header says "~2,000" and is left unchanged |

---

## Slice G-1 — Mocked repository methods must exist

### Analysis

The guard reads each test's `jest.mock('<spec>', () => ({ instance: { method: … } }))` factory
with the TypeScript compiler API, and then the repository source the spec resolves to. It does
not call `requireActual`, so no `supabaseServer`/env loading. It checks only literal keys.
Anything it cannot read is counted as SKIPPED and never fails the test.

### Implementation approach

**Location:** `lib/repositories/__tests__/mockedRepositoryMethods.guard.test.ts`. This follows the
existing self-contained guards that read source with the TS API and `fs`
(`app/api/stripe/webhook/__tests__/pinoLogging.guard.test.ts`, `lib/repositories/__tests__/anon-default-repositories.guard.test.ts`).
The analyser lives **inside the test file**. A helper module under `__tests__/` would be collected
as an empty suite (`testMatch: **/__tests__/**/*.ts`), and one under `scripts/` would hit the
non-deploying-change carve-out.

**Test side:**
1. Walk only the files Jest would collect: `*.test.ts(x)`, `*.spec.ts(x)`, and anything under `__tests__/`.
   Skip `node_modules`, `.next`, `.git`, `.claude`, `coverage`, `out`, `docs`.
2. A regex prefilter keeps files that contain `jest.(mock|doMock)('@/lib/repositories…'` or a relative spec. Only those are parsed.
3. For each `jest.mock` / `jest.doMock` call with a string-literal spec, resolve `@/…` and relative specs
   (`.ts`, `.tsx`, `/index.ts`). Ignore the call unless the target is under `lib/repositories/`
   (barrel included) and is not a test file.
4. The factory must be an arrow or function expression whose body is an object literal, after
   unwrapping parentheses and `as`. Otherwise it is SKIPPED (`block-bodied-factory`, `factory-not-object-literal`, `no-factory`).
5. Top-level keys:
   - A `...jest.requireActual(…)` spread is exempt.
   - Any other spread is SKIPPED.
   - Computed keys are SKIPPED.
   - `__esModule` is ignored.
   - A key the module does not export fails as **unknown-export**. If the module has `export *`, it is SKIPPED instead.
6. When the key is an exported **instance** (`export const x = new C()`, a local `export { x }`, or a re-export
   through a barrel), its value must be an object literal (otherwise SKIPPED). Each literal key
   inside it must be a member of `C`, or it fails as **missing-method**. A `...jest.requireActual(…).x`
   spread inside the object is exempt, and the keys listed beside it are still checked.

**Repository side (members of `C`):**
- Members that count: methods, property declarations (arrow-function properties), get and set accessors, and
  constructor parameter properties. Private and protected members count too, because visibility is not this guard's concern.
- Static members are not instance members.
- **Inheritance**: the guard follows `extends Identifier` to a class in the same file, or through an import to a
  project file (max depth 5). For built-in `Error` it adds `message`/`name`/`stack`/`cause`. If the base cannot
  be resolved, the instance's keys are SKIPPED (`class-unresolvable`), never failed.
- Exported class keys (e.g. `FooRepository: jest.fn()`) are checked for existence only. Their mocked
  static or prototype shapes are SKIPPED.

**Skip reporting without `console.*`:** the scan runs once at collection time. Its counts go in a test
title, e.g. `checked 413 keys in 328 mock sites; skipped 55 (block-bodied-factory 22, …)`, so they show up in
`--verbose` and in the shard `--json` artifact.

**Baseline:** `lib/repositories/__tests__/mockedRepositoryMethods.baseline.json`, a sorted JSON array of
`"<test file> | <module spec> | <export>.<method>"` (for unknown-export: `"<test file> | <spec> | <export>"`).
It ships as `[]` because there are 0 mismatches today. It works as a ratchet, as the S-13 allow-list in
`anon-default-repositories.guard.test.ts` does: a baseline entry that no longer matches **fails**, so the list only shrinks.
It sits under `lib/` rather than `scripts/` so that editing it always triggers the Jest gate.

**Failure message (exact form):**

```text
Mocked repository member does not exist on the real class (CI guard G-1):
  lib/services/__tests__/packageAcceptance.test.ts mocks userPreferencesRepository.findTimezone
  from '@/lib/repositories/UserPreferencesRepository', but class UserPreferencesRepository
  (lib/repositories/UserPreferencesRepository.ts) has no member 'findTimezone'.
Fix ONE of:
  - the code under test needs it  -> add the method to the repository class;
  - the mock is stale or misspelt -> rename or remove the key so the mock matches the real class.
Do not add it to mockedRepositoryMethods.baseline.json: the baseline only shrinks.
```

### Files

| File | Action | Reason |
|---|---|---|
| `lib/repositories/__tests__/mockedRepositoryMethods.guard.test.ts` | create | Guard, analyser and self-tests |
| `lib/repositories/__tests__/mockedRepositoryMethods.baseline.json` | create | `[]` ratchet baseline |
| `docs/workplans/TEST_STRATEGY_AND_CI_TIERING_WORKPLAN.md` | modify (one row) | Record the new gate and its measured runtime |

No workflow change: the existing `Tests` job collects the new suite. `jest-gate-check.mjs` lists it automatically, and the quarantine is untouched.

### Task list

- [x] ✅ G-1.1 Analyser (pure functions: `scanTestSource(src, file, index)`, `RepositoryIndex.classMembers`/`resolveExport`), with inline-string fixtures via an in-memory source host. C-1: non-`new C()` exports mocked with an object literal are SKIPPED as `export-not-class-instance`.
- [x] ✅ G-1.2 Self-tests: cases 1–9 inline, case 4 includes the C-1 `rateLimitRepository = { … }` shape; case 10 pins the live resolution.
- [x] ✅ G-1.3 Real-repo test: floors ≥ 300 sites **and ≥ 350 checked keys (C-2)**, 0 mismatches beyond the baseline. Counts and phase timings go in the title. First run: 328 sites, 705 checked keys (top-level exports + instance members), 177/1,384 test files parsed, 58 skipped (block-bodied-factory 22, instance-not-object-literal 33, export-not-class-instance 3), 0 findings.
- [x] ✅ G-1.4 Baseline `[]` shipped (SA ruling 1); sorted/unique/no-stale test plus ratchet self-test (case 9).
- [ ] G-1.5 (after RM pushes) Push. Read `perfStats.runtime` for the suite from the shard `--json` artifact over **3 CI runs**, and accept only if every run is under 3 s.
- [ ] G-1.6 If the runtime is over 3 s, parse only each `jest.mock(…)` call's text span (sliced with `ts.createScanner`) rather than the whole file. Re-measure.

**G-1 implementation notes (Dev, 2026-10-15):**
- Local runtime is not a usable CI proxy today (box heavily loaded): the scan took 5.8 / 7.6 / 11.9 / 23.9 s across four runs (parse ≈ 70 %, prefilter ≈ 20 %, walk ≈ 10 %). At the ≈ 6.4 local/CI ratio measured above that is ≈ 1–2 s in CI. G-1.5 (3 CI runs, `perfStats.runtime` < 3 s) is the acceptance test; G-1.6 is the fallback. C-6's TEST_STRATEGY row is written once those CI numbers exist.
- Failure path proven on a real file: a temporary `findTimezoneGhost: jest.fn()` key in `lib/services/__tests__/packageAcceptance.test.ts` failed the guard with the exact message (file, `userPreferencesRepository.findTimezoneGhost`, `@/lib/repositories/UserPreferencesRepository`, class and file); reverted with `git checkout`, tree clean.
- Gate pickup: `npx jest --config jest.gate.config.js --listTests` lists the suite (1,385 suites); no workflow or quarantine change. `lib/repositories` + `lib/services/__tests__`: 137 suites / 2,879 tests green.
- No `console.*` in the guard.

### Test plan (G-1)

All fixtures are inline strings, never files under `__tests__/`, which Jest would collect.

| # | Case | Expected |
|---|---|---|
| 1 | **F-13 replica**: mock `userPreferencesRepository.findTimezone` against a class without it | **fails** with the message above (failure path) |
| 2 | Same mock against a class that has it | passes (happy path) |
| 3 | `...jest.requireActual(…)` top-level spread, plus a listed key that is missing | spread exempt; the missing listed key is still reported |
| 4 | Block-bodied factory, variable value, computed key | SKIPPED with the right reason, no failure |
| 5 | Method inherited via `extends` (same file and imported base) | found. An unresolvable base is SKIPPED |
| 6 | Getter, arrow-function property, constructor parameter property | counted as members |
| 7 | Top-level key that the module does not export | **unknown-export** failure |
| 8 | Relative spec resolving into `lib/repositories/`, barrel `@/lib/repositories`, `jest.doMock` | checked. A non-repository spec is ignored |
| 9 | Baseline: a matching entry suppresses; a stale entry fails; an unlisted mismatch fails | as stated |
| 10 | Real repository (live scan) | ≥ 300 sites, 0 unbaselined mismatches |

`npm test -- lib/repositories/__tests__/mockedRepositoryMethods.guard.test.ts` locally, then the CI shard.

### Rollback (G-1)

Revert the PR: two new files and one doc row. Nothing else depends on them.

### Later widening (not in scope)

- `lib/services/**` mocks. Services mix singletons, `getInstance()` and static classes, so the instance mapping is not trivial. That would be its own slice.
- Resolving same-file `const mockRepo = { … }` values (33 skips).
- Single-`return` block factories (22 skips).

---

## Slice G-2 — Services/API scope for the baseline tsc gate

### Analysis

`scripts/typecheck-bos-llm.ts` already builds the full `tsc -p` program, which is the dominant cost,
then asks for diagnostics of in-scope files only and diffs them against a keyed baseline.
A second scope reuses that program in the same process. The only extra cost is the
checker's time on the extra files.

### Implementation approach

- **Scopes table** in the script:
  - `bos-llm`: the existing import-graph scope plus `scripts/typecheck-bos-llm.baseline.json`, unchanged.
  - `services-api`: every project file whose path starts with `lib/services/` or `app/api/`, **tests included**,
    generated output excluded, with its own `scripts/typecheck-services-api.baseline.json`.
  - The two scopes are **independent**. A file in both appears in both baselines, so neither verdict changes
    when the import graph moves a file in or out of `bos-llm` (open question Q4).
- **Same baseline format.** Both scopes go through the existing `keyOf()`/`stableMessage()`, so the format
  is identical: `Record<string, number>`, keyed `"<file> | TS<code> | <stable headline>"`, with counts and no line numbers.
- **CLI:** `--scope=bos-llm|services-api|all` (default `all`). `--update-baseline` writes only the selected scopes' files,
  and `--list` lists them per scope.
- **Report-only switch (G-2a only):** `--report-only=services-api`. New errors in that scope go out as
  `::warning file=…::` annotations and a `$GITHUB_STEP_SUMMARY` block, and do not change the exit code. `bos-llm`
  stays blocking throughout.
- **Timing in the log line:** the script prints program build, per-scope diagnostics, and peak RSS
  (`process.memoryUsage().rss`). The job has `NODE_OPTIONS=--max-old-space-size=6144`, and checking more
  files raises memory, so peak RSS is worth watching.
- **Naming:**
  - Keep the file name `scripts/typecheck-bos-llm.ts`. A rename touches the
    `non-deploying-change.sh` carve-out (shared with Vercel's `ignoreCommand`), the workflow header, `bos-llm-scope.ts`
    and `lib/platformAccount.ts` comments, and docs, all without changing behaviour.
  - Add npm scripts:
    - `typecheck:services-api` = `tsx scripts/typecheck-bos-llm.ts --scope=services-api`, for local use.
    - `typecheck:scoped` = `… --scope=all`, which **CI calls**, so the program is built once.
  - `typecheck:bos-llm` gains `--scope=bos-llm` so its meaning does not change.
  - Workflow, job and required-check names are untouched.
- **Carve-out:** add `scripts/typecheck-services-api.baseline.json` to the "CI's own gate definition" case in
  `.github/ci/non-deploying-change.sh`. As with the existing baseline, a baseline-only change then builds on Vercel as well.

### Files

| File | Action | Reason |
|---|---|---|
| `scripts/typecheck-bos-llm.ts` | modify | Scopes table, `--scope`, `--report-only`, per-scope baselines, timing + RSS; header documents both scopes |
| `scripts/typecheck-services-api.baseline.json` | create | ≈ 230 existing diagnostics |
| `package.json` | modify | `typecheck:bos-llm` adds `--scope=bos-llm`; add `typecheck:services-api`, `typecheck:scoped` |
| `.github/workflows/bos-llm-typecheck.yml` | modify | Step command → `npm run typecheck:scoped -- --report-only=services-api` (G-2a), then without the flag (G-2b); header comment |
| `.github/ci/non-deploying-change.sh` | modify | Carve the new baseline back in |
| `docs/workplans/TEST_STRATEGY_AND_CI_TIERING_WORKPLAN.md` | modify (one row) | Record the measured runtime |

The stale `bos-llm` entry (`app/api/onboarding/build/route.ts | TS18047`) is **not** pruned here. SA can say whether this slice should carry it (Q7).

### Task list

**G-2a (build + measure, services-api non-blocking)**
- [ ] G-2a.1 Scopes table, `--scope`, per-scope baseline paths, shared `keyOf`.
- [ ] G-2a.2 `--report-only`, warnings and step-summary output.
- [ ] G-2a.3 Timing + RSS in the summary line.
- [ ] G-2a.4 Generate `typecheck-services-api.baseline.json` and record its key count here.
- [ ] G-2a.5 npm scripts, workflow step, carve-out.
- [ ] G-2a.6 Measure:
  - Run `gh workflow run bos-llm-typecheck.yml --ref chore/ci-guards-mock-methods-and-tsc` **3 times** in sequence. The concurrency group cancels overlapping runs.
  - Record the job duration and the per-scope seconds from the log.
  - Re-take the Build median of the last 10 runs that ran, the same day.
  - The **accept criterion** is a job median under Build's median.
- [ ] G-2a.7 Hand the numbers to SA. **Stop.**

**G-2b (blocking, only after SA rules on the G-2a numbers)**
- [ ] G-2b.1 Drop `--report-only=services-api` from the workflow step.
- [ ] G-2b.2 Re-run once and confirm the step fails on a deliberate new error in a scratch commit (failure path), then drop that commit.

### Test plan (G-2)

| # | Case | Expected |
|---|---|---|
| 1 | Clean branch, `npm run typecheck:scoped` | both scopes `0 new`, exit 0 (happy path) |
| 2 | Re-create F-13: call a non-existent repository method from a `lib/services/` file (local scratch edit, never committed) | `services-api` reports it. Exit 1 without `--report-only`; with it, a warning and exit 0 |
| 3 | A new error in a `bos-llm` file, with `--report-only=services-api` | still exit 1 (the report-only switch never weakens `bos-llm`) |
| 4 | A file in both scopes gains an error | reported in both, and both verdicts fail |
| 5 | `--update-baseline --scope=services-api` | writes only the services-api baseline; the bos-llm baseline is byte-identical |
| 6 | Same diagnostics, unions printed in a different order | same key (existing `stableMessage`) |
| 7 | CI workflow_dispatch ×3 | timings recorded in G-2a.6 |

### Rollback (G-2)

- G-2b: re-add `--report-only=services-api` (a one-line workflow change), which returns the gate to report-only.
- G-2a: revert the PR. The `bos-llm` behaviour is unchanged by construction, and test 3 proves it.

---

## Logging-rule check

| File touched | `console.*` | Proposal |
|---|---|---|
| `scripts/typecheck-bos-llm.ts` | 10 | Leave as is. CLAUDE.md's Pino rule covers `lib/`, `app/` and `components/`. This is a CLI whose stdout is its interface, and its siblings (`check-bos-llm-literals.ts`: 14, `lib/bos-llm-scope.ts`: 1) do the same. New output follows the existing style |
| `mockedRepositoryMethods.guard.test.ts` (new, under `lib/`) | 0 | Skip counts go through the test title, not `console` |

---

## Open Questions for SA

1. **G-1 baseline is empty (0 mismatches).** Ship the `[]` ratchet file as the condition requires (recommended), or omit it until there is a need?
2. **Unknown-export check.** It fails a top-level mock key that the repository module does not export. This goes beyond the condition, but it uses the same parse, finds 0 today, and is the same class of bug. Include it? (Recommended.)
3. **Skip ceiling.** Skips are reported, never failed, as ruled. Do you also want a cap on the skip count (55 today) so skips cannot grow unnoticed? Default: no cap.
4. **Scope overlap in G-2.** Independent scopes (recommended: stable when the import graph moves), or `services-api` minus `bos-llm` files (no double reporting, but a file leaving `bos-llm` would surface its old errors as new)?
5. **Tests in `services-api`.** The plan includes them (4 errors, ≈ 4 s CI est.). Confirm.
6. **Jest critical path for G-1.** The Jest gate is max shard (≈ 196 s at worst) plus verdict (≈ 12 s), already close to Build's 201 s median. G-1 adds ≈ 1–1.5 s to one shard. Is "< 3 s suite runtime" the full acceptance test, or do you also want the shard-vs-Build comparison?
7. Prune the stale `bos-llm` baseline entry (`app/api/onboarding/build/route.ts | TS18047`) in G-2a, or leave it for a separate change?

---

## SA Review Notes

**Reviewed by SA — 2026-10-15**
**Status:** ✅ Approved with changes (C-1..C-8 below are binding; no re-review needed for them, they are checked at code review)

The plan meets every earlier condition: TS compiler API both sides with no `requireActual`, literal keys only, skips counted and never failed, `...jest.requireActual` spreads exempt, the existing Jest job, a `< 3 s` budget, a ratchet baseline, and a second scope in the same required job with no new check name, report-only until SA rules. The slices are small, and the plan reuses existing infra (the guard-test pattern, the existing tsc program and `keyOf`, and the existing job and carve-out).

### Rulings on the open questions
1. **Ship the `[]` G-1 baseline.** Yes. The ratchet tests (case 9) need the file to exist.
2. **Unknown-export check.** Include it. It is the same class of bug, uses the same parse and finds 0 today.
3. **Skip cap.** No cap on skips. Add **C-2** instead.
4. **G-2 overlap.** Keep the scopes **independent**. Stability when the import graph moves matters more than double reporting.
5. **Tests in `services-api`.** Include them. F-13 lived in a test file.
6. **G-1 acceptance.** `< 3 s` suite runtime over 3 CI runs is the full acceptance test. The Jest shard already running close to Build is a separate, pre-existing issue and does not block G-1. Record the before/after max-shard median in the doc row (**C-6**).
7. **Stale `bos-llm` entry.** Prune it in G-2a with `--update-baseline --scope=bos-llm`. The diff must be exactly that one key and nothing else (that also confirms test 5).

### Changes required
- **C-1 (G-1)** Exports that are not `new C()` must be SKIPPED with their own reason (`export-not-class-instance`), not failed. One example is `rateLimitRepository = { … }` in `lib/repositories/RateLimitRepository.ts`. Add this to self-test case 4.
- **C-2 (G-1)** Alongside the ≥ 300-sites floor, add a **checked-keys floor (≥ 350)**. Without it, a parser regression that turns every key into a skip would pass green.
- **C-3 (G-2)** Build `services-api` from `parsed.fileNames`, `.ts`/`.tsx` only. That way the existing "in scope but not in program → exit 2" path cannot fire on a stray file, and it stays loud for `bos-llm`.
- **C-4 (G-2)** Update the scope-rule comment block in `non-deploying-change.sh` and the workflow header (lines 24–30, and the step comment "attribution scope"), not just the `case` line.
- **C-5 (G-2a)** `::warning` annotations are capped per step. Emit at most 10 warnings plus a count, and put the full list in `$GITHUB_STEP_SUMMARY`.
- **C-6** Record in the TEST_STRATEGY row: the G-1 suite runtime, the job median before and after, the per-scope seconds, and the **peak RSS**. RSS above 5 GB, or a job median at or above Build's median, means stop and return to SA.
- **C-7** G-1 and G-2a ship as **separate PRs**. G-2b is a third, one-line PR.
- **C-8** The step name "Run scoped type check" and the job name stay unchanged.

### Other checks
- **`console.*` in `scripts/typecheck-bos-llm.ts`:** Accepted as is. The script is a CLI outside `lib/`, `app/` and `components/`, and stdout is its interface. New output follows the existing style.
- **Carve-out:** Correct and needed. Without it, a baseline-only PR would skip its own gate.
- **Timeout and memory:** The 15-minute timeout has ample headroom (≈ 3 min projected). `6144` MB should be enough, and C-6 makes that observable.

### Approval
[x] Workplan approved. Proceed with G-1 and G-2a under C-1..C-8. G-2b waits for the SA ruling on the G-2a numbers.

### G-1 Code Review (SA, 2026-10-15)

> ⚠️ **Document truncation found by SA (2026-10-15).** This file ends after the G-1 implementation
> notes, but its ToC still lists *Slice G-2*, *Logging-rule check*, *Open Questions for SA*,
> *SA Review Notes* (with the workplan-review rulings C-1..C-7 and ruling 1), *QA Testing Report*,
> *Commit Info* and *Change History*. None of those sections exist any more, and the file is
> untracked, so git cannot restore them. TL/Dev must restore them (from the session that wrote
> them) before RM commits. This section is appended and does not replace them.

**Code Review by SA — 2026-10-15**
**Status:** ✅ Code Approved (with nits) — the guard itself; the workplan MD must be restored before commit (above)

Checked against the workplan rulings: C-1 (`export-not-class-instance` skip) ✅; C-2 floors ✅;
baseline ships `[]` with sorted/unique/no-stale ratchet ✅; unknown-export check ✅; no skip cap ✅;
TS compiler API on both sides, no `requireActual` ✅; literal keys only, unreadable shapes counted
by reason in the test title ✅; `...jest.requireActual(…)` spreads exempt at both levels ✅.
No `console.*`. Listed by `jest.gate.config.js`.

SA re-ran the scan independently (scratch copy, not committed): 328 sites, 705 checked keys =
**333 top-level + 372 instance members**, skips 22/33/3, 0 findings. Matches Dev's report.

Specific assessments:
- **Members / inheritance:** methods, property declarations (arrow fields), get/set, constructor
  parameter properties, all visibilities, multi-level `extends` across imports, `Error` base;
  statics excluded; mixin/package bases skip as `class-unresolvable`. Correct. `this.x =` in a
  constructor without a declaration is a TS error in `.ts`, so declared properties cover it.
- **False-positive risk:** low. Residual shapes that would *fail* instead of skip (none occur today):
  a class with an index signature (`[k: string]: …`), a destructured export
  (`export const { a } = …`), `export =` / `import x = require()` modules. Acceptable; fix if one appears.
- **Timeout:** the scan runs at module top level (collection), not in a test body, so the 5 s
  per-test timeout cannot fire. Its cost still counts in `perfStats.runtime`, which G-1.5 measures. ✅
- **Message quality:** names test file, `export.method`, spec, class and class file, and gives both
  fixes plus "do not baseline". Good.

### Code Review Comments
1. `mockedRepositoryMethods.guard.test.ts:517` — C-2 floor counts top-level and member keys together. If every instance member regressed to a skip, 333 top-level keys would still be 17 short of 350, so it holds today but only by that margin. Track members separately and floor them (e.g. `checkedMembers >= 300`). Priority: Medium (non-blocking).
2. `:472` — `ROOT = process.cwd()`. Prefer `path.resolve(__dirname, '../../..')`. The `> 1000` floor already catches a wrong cwd, so this is robustness only. Priority: Low.

### Optimisation Suggestions (apply only if G-1.5 is over 3 s, before G-1.6)
- Walked test files are read through `fsHost`, so all 1,384 texts stay cached, with `existsSync`+`statSync` per file. Read them with a plain `readFileSync`, and use the cache only for repository-side resolution.
- Tighten the prefilter. A file needs parsing only if its text contains `repositories`, or it lives under `lib/repositories/` (where `'../X'` specs are used). Today, any relative `jest.mock('./…')` qualifies, which is why 177 files get parsed.
- Nice-to-have: add `file:line` to the message (`getLineAndCharacterOfPosition`).

### Code Approved for QA: Yes (once the truncated workplan sections are restored)

> **Nits applied 2026-10-15 (TL):** nit 1 — separate floor `checkedMethods >= 300` (first run 372 instance members of 705 keys), counted in `ScanResult` and shown in the test title; nit 2 — `ROOT` is now `path.resolve(__dirname, '../../..')`. Guard re-run 13/13. Nit 3 (speed) waits for G-1.5.
>
> **Resolved 2026-10-15 (TL):** the truncation was caused by Dev's edit script (`s[:j+1] + notes` dropped the remainder). The full document was recovered from the workplan-creation and SA-review edits and the Dev edit replayed correctly; every section above is restored.

## QA Testing Report

### G-1 (QA, 2026-10-15)

**QA — 2026-10-15**
**Test mode:** full · **Strategy:** A (Jest guard + temporary probes, all reverted) · **Focus:** schema/CI guard · **Skipped:** none · **Input source:** prompt

#### Test Coverage
| Check | Result | Notes |
|---|---|---|
| Happy path on the real repo | ✅ Pass | 13/13; 705 keys, 328 sites, 177/1,384 files parsed, 58 skips (block-bodied 22, export-not-class-instance 3, instance-not-object-literal 33). Baseline `[]` |
| (a) Nonexistent method in object-literal mock (`packageAcceptance.test.ts`) | ✅ Pass | Fails with test file, `export.method`, spec, class, class file, fix hint |
| (b) Nonexistent top-level export | ✅ Pass | `unknown-export` message names module + export |
| (c) Barrel mock (`modelResolver.test.ts`, `@/lib/repositories`) | ✅ Pass | Resolved through barrel to `SystemConfigRepository` |
| (c) Relative-path mock | ✅ Pass | No real one exists; probe `../../repositories/UserPreferencesRepository` added to a real test file, caught |
| F-13 non-regression (`findTimezone` renamed away) | ✅ Pass | Fails on `packageAcceptance.test.ts mocks userPreferencesRepository.findTimezone` |
| False positives: `...jest.requireActual` (top-level and instance), base-class method (imported base, incl. protected), getter | ✅ Pass | No real repository extends a base or has a getter, so temp fixture repo + test file were used; zero findings, zero skips, +8 keys checked. Positive control (ghost key beside the spread) still failed |
| Included in gate | ✅ Pass | Listed by `jest --config jest.gate.config.js --listTests` |
| `npx jest lib/repositories lib/services` | ✅ Pass | 137 suites / 2,879 tests |

#### Issues Found
**Bugs:** none.
**Performance (open, already tracked as G-1.5/G-1.6):** local scan 9.1 / 13.7 / 7.6 / 8.8 s (parse ≈ 60–70 %) against the < 3 s CI budget; whole-suite wall time 13–24 s locally. Not verifiable locally (loaded box); G-1.5 CI measurement remains the acceptance gate. SA optimisations (plain `readFileSync` for test files, `repositories`-substring prefilter) are the first lever.
**Edge cases:** none new beyond SA comments 1–2.

#### Final Status
- [x] All acceptance criteria pass — ready for commit, conditional on G-1.5 CI runtime < 3 s
- Tree clean after every probe: only the 3 expected untracked files remain.

## Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Workplan restored | Dev edit script had truncated everything after the G-1 notes; recovered and SA + QA G-1 notes merged in place (TL) |
| 2026-10-15 | G-1 implemented | Guard + `[]` baseline under `lib/repositories/__tests__/`; C-1, C-2 applied; CI runtime (G-1.5, C-6) pending push |
| 2026-10-15 | Workplan created | G-1 and G-2 planned against SA's binding conditions; local prototypes and CI medians recorded |
