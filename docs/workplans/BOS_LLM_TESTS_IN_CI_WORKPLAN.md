# Workplan: Run the Business OS LLM test suite in CI

> **Last Updated**: 2026-10-04

## Overview

`lib/business-os/llm/__tests__` holds the proof behind the Business OS LLM standards. It includes the boundary snapshots (`callParams.boundary.*.test.ts`), which record the exact request each call site puts on the wire. No CI workflow runs these tests. PR #151 (b6efd992, 2026-09-29) moved the chat planner's system prompt by 10 characters through two deliberate catalog edits. `callParams.boundary.step3.test.ts` went red on `main` and stayed red until PR #185, because nothing was running it. The snapshot did its job, but nobody saw it.

This workplan adds that suite to CI as a blocking check, without lengthening the PR critical path. The user's standing rule is that new CI gates must finish inside the existing `next build` time, and SA rules on the runtime before anything is built. So **Slice 1 is a measurement on real CI, and the design choice (§5) is made from that number**, not from local timings, which turned out to be unusable (§3.3).

## Table of Contents

1. [Problem and evidence](#1-problem-and-evidence)
2. [Constraints](#2-constraints)
3. [Measurements](#3-measurements)
4. [Which tests (scope)](#4-which-tests-scope)
5. [Where they run (options)](#5-where-they-run-options)
6. [Recommendation](#6-recommendation)
7. [Slices](#7-slices)
8. [Acceptance criteria](#8-acceptance-criteria)
9. [Stale statements found on the way](#9-stale-statements-found-on-the-way)
10. [Out of scope](#10-out-of-scope)
11. [Questions for SA](#11-questions-for-sa)
12. [SA Review](#12-sa-review)
13. [QA Test Report](#qa-test-report)

---

## 1. Problem and evidence

| Fact | Source |
|---|---|
| `callParams.boundary.step3.test.ts` › `chat/planner` failed on `main` from #151 until #185 | Bisected: passes at `b6efd992^`, fails at `b6efd992` |
| The two catalog edits were deliberate. The guard was right; only its update was missed | #151 commit message; comment in `lib/business-os/catalog/catalog.ts` |
| #151's own CI was all green: build, lint:hooks, typecheck:bos-llm, check:bos-llm-literals, authz, entitlements, plugin tests | #151 commit message |
| No workflow runs `lib/business-os/llm/__tests__` | `grep jest .github/workflows/*.yml`: only `test:authz-guard`, `test:bos-entitlements`, `test:plugins:*` |

The gap is narrow. These tests are fast, deterministic, need no secrets or network (every provider and repository is mocked), and are green on `main` today.

---

## 2. Constraints

| Constraint | Consequence |
|---|---|
| **No added CI time.** A new gate must finish inside the existing critical path (`next build`), and SA rules on runtime before building | §3 measures, §6 is conditional on Slice 1's number |
| **Required checks on `main`** are exactly: `Admin authz surface guard`, `Type check (Business OS LLM attribution)`, `Build (next build)`, `React hooks rules guard` | Measured via `gh api …/branches/main/protection/required_status_checks` on 2026-10-04 |
| A check only **blocks** if its name is in that list. Adding a name is a GitHub admin action outside the repo | Option A needs no admin action; options B and C do |
| No `paths:` filters on required checks (a filtered check stays pending forever) | Reuse the existing in-job skip rule (`.github/ci/non-deploying-change.sh`) |
| No new patterns without SA review (CLAUDE.md rule 7) | Follow the precedent: a named `npm` script `jest <paths> --ci`, run as a step (`test:bos-entitlements`, `test:authz-guard`) |

---

## 3. Measurements

### 3.1 The job we would extend: `bos-llm-typecheck.yml` (required)

Step durations from four recent non-skipped runs (`gh run view`), in seconds:

| Run | checkout | setup-node | `npm ci` | type check | literal check | **steps total** |
|---|---|---|---|---|---|---|
| 37184648396 (PR) | 2 | 6 | 91 | 39 | 7 | **145** |
| 37184288069 (PR) | 5 | 7 | 93 | 40 | 7 | **152** |
| 37172283831 (PR) | 5 | 9 | 93 | 41 | 7 | **155** |
| 37182870225 (push) | 5 | 9 | 94 | 40 | 7 | **155** |

### 3.2 The critical path: `build.yml` › `Build (next build)` (required)

| Run | Job duration |
|---|---|
| 37184648443 (PR) | 214 s |
| 37184288060 (PR) | 207 s |
| 37172283864 (PR) | 167 s (job; the run's 245 s included a 77 s queue wait; corrected per SA §12.1) |

**Headroom is per commit, not one number.** The draft said ~50–55 s (≈207 − 155). SA measured 17 paired commits: the median gap between the type-check job and Build finishing is about 62 s, but about 1 run in 5 has a fast Build (119–170 s), where the gap fell to 8 s and once to −8 s. The bar is therefore C-2's paired per-commit test, not a single headroom figure.

### 3.3 The suite itself, and why local numbers are not used

| Run (local, 8 cores, machine shared with other sessions) | Wall |
|---|---|
| `--maxWorkers=4` (warm) | 100 s, then 131 s |
| `--maxWorkers=2` (warm) | 50 s |
| `--maxWorkers=4 --no-cache` | 87 s |
| `--maxWorkers=2 --no-cache` | 67 s |

The same command varied from 50 s to 131 s, and fewer workers was faster. The machine was contended, so **these numbers can bound nothing**. The per-file profile is still useful: 23 files, about 137 s summed, dominated by `modelSettings.off.chat.test.ts` (25–50 s, it loads the chat route's import graph), then `callParams.boundary.step2` (~25 s), `modelSettings.off.nonchat` (~22 s) and `adminSettingsView` (~15 s). The other 19 files take 1–4 s each. Wall time is roughly bounded below by that one heavy file's transform cost.

### 3.4 The CI precedent

`bos-entitlements.yml` runs `test:bos-entitlements`, **1,441 tests, in 12 s** on `ubuntu-latest` after a 58 s install. CI Jest is clearly much faster than this machine. That makes Option A plausible, but it does not prove it, because the heavy files here are heavy for a different reason (import-graph transform, not test count).

---

## 4. Which tests (scope)

| Set | Contents | Status on `main` (2026-10-04) |
|---|---|---|
| **S1** | `lib/business-os/llm/__tests__`: 23 suites, 602 tests, 23 snapshots, including all `callParams.boundary.*` snapshots | ✅ green with `--ci`, no obsolete snapshots |
| **S2** | S1 plus the 12 `*attribution*.test.ts` files elsewhere (bizql, briefing, insight, leads, services, onboarding and website routes) and `app/api/business-os/usage/__tests__/route.credits.test.ts`: 13 suites, 152 tests | ✅ green, about 83 s locally on the contended machine |

S2 is the full set the `bos-llm-call-standards` skill's Standard 7 calls "the proof". S1 is what actually failed in this incident. **Proposal: S1 now; S2 only if Slice 1 shows the S2 cost fits too.** The npm script is the single place the list lives, so widening later is a one-line change.

---

## 5. Where they run (options)

| | **A. Step in the existing required job** | **B. New job in the same workflow** | **C. Background process inside the existing job** |
|---|---|---|---|
| Shape | `npm run test:bos-llm` after the literal check, `if: ${{ !cancelled() && steps.scope.outputs.skip != 'true' }}` | Second job, own checkout and `npm ci`, same skip step | Start Jest with `&` before the type check; `wait` at the end |
| Extra time on that path | Suite only | `npm ci` (60–93 s) plus suite, but **parallel** to the type check and the build | Overlaps the 40 s type check |
| Headroom | **~50 s** | ~110 s (207 − 93 − setup) | ~90 s |
| Blocks a merge | **Immediately**: the job is already required | Only after an admin adds the new check name | Immediately |
| New pattern | No (same as the literal check step) | No (same as the other Jest workflows) | **Yes** (backgrounded steps, merged exit codes, interleaved logs) |
| Risk | Pushes the path if the suite exceeds headroom | Advisory until the admin action, which is exactly the "red but not blocking" state that just failed us | Memory contention: the type check runs at a 6 GB heap on a 16 GB runner |

**On a red step hiding another:** the `!cancelled()` condition already used for the literal check means all three verdicts appear in one run, and the job's step list names which one failed. The "one red step hides which gate failed" reason the build gate used for going separate (`CI_BUILD_GATE_WORKPLAN.md`) is answered by step names here, but the trade-off is noted for SA.

---

## 6. Recommendation

**Option A with scope S1, conditional on Slice 1:** the CI step's measured median over 3 runs must be **≤ 40 s**, leaving at least 10 s of the ~50 s headroom.

- If it measures **over 40 s**: try `--maxWorkers=2` (the ubuntu-latest public runner has 4 vCPUs, and the type check is already finished). If it still doesn't fit, fall back to **Option B**, and record that it blocks only once a GitHub admin adds the check name, tracked like the build gate's OI-3.
- **Option C is not proposed.** It saves time only by introducing a new pattern with a memory risk.
- **S2** joins in the same PR only if S1 plus S2 measures ≤ 40 s. Otherwise it waits for the test-tiering work (§10).

---

## 7. Slices

| # | Slice | Done when |
|---|---|---|
| 1 | **Measure on CI.** Add `"test:bos-llm": "jest lib/business-os/llm/__tests__ --ci"` to `package.json` and the Option A step to `bos-llm-typecheck.yml`. Open the PR and re-run the workflow 3 times. Record per-step times for this job and for `Build (next build)` in §3. Repeat with S2 (temporary script change) for the S2 number. | SA has the CI numbers and rules A, A-with-2-workers, or B |
| 2 | **Finalise** per SA's ruling. Fix the stale statements in §9 in the same PR (workflow header, skill). | Diff shows the step plus doc fixes only |
| 3 | **Prove it blocks.** On a throwaway branch, change one snapshot digest character and open a PR. The required check must go **red**, the merge button must be **blocked**, then close the throwaway PR. (Precedent: throwaway PR #90 for the literal gate.) | Screenshot or `gh pr view --json mergeStateStatus` shows BLOCKED. Throwaway closed, branch deleted |

Each slice is hours, not days. No production code changes, no data, no secrets.

---

## 8. Acceptance criteria

- **AC-1:** On a PR that touches anything outside `docs/`, `scripts/` or `.claude/`, `Type check (Business OS LLM attribution)` runs `test:bos-llm` with `--ci`, so a stale snapshot **fails**; it is never rewritten.
- **AC-2:** A failing BOS LLM test **blocks the merge** (Slice 3 proof).
- **AC-3:** Over the 5 measured runs, the median per-commit completion delta (Build job end − type-check job end) is ≥ 0, and the new step's median is ≤ 40 s. (Restated per SA C-3.)
- **AC-4:** A docs-only PR still skips the job's work and reports success (existing behaviour unchanged).
- **AC-5:** The type-check and literal verdicts are still reported when the tests fail, and the reverse (`!cancelled()` on every gate step after the first; the type check runs first and needs none). Known side effect, accepted: if `npm ci` fails, the later steps run without `node_modules` and also go red.
- **AC-6:** An obsolete snapshot entry, or an orphaned `.snap` file anywhere in the repo, fails the step under `--ci`. (Added per SA C-6; proven in §12.5.)

---

## 9. Stale statements found on the way

| Where | Says | Truth (2026-10-04) | Fix in |
|---|---|---|---|
| `.github/workflows/bos-llm-typecheck.yml` header | "It is NOT a required check today … a red run here does NOT block a merge" | It **is** required (one of 4 required checks) | Slice 2 |
| `.claude/skills/bos-llm-call-standards/SKILL.md`, Standard 8 | literal check "is also not a required status check today, so a red run does not block a merge" | Its job is required, so it blocks | Slice 2 |
| Same skill, Standard 7 | "The owner usage-route snapshot is unchanged: `app/api/business-os/usage/__tests__/__snapshots__/route.test.ts.snap`" | That file does not exist; the directory holds only `route.credits.test.ts` | Slice 2: point at the real test, or drop the line (SA to say which) |
| Skill, Standard 7 | Definition of done lists `typecheck:bos-llm` and the literal check, not the test suite | After this change, `test:bos-llm` is part of the gate | Slice 2 |

---

## 10. Out of scope

- **The full Jest suite in CI.** That is the test-tiering workplan (branch `chore/test-tiering`, not yet merged), which also covers the ~21 suites red on `main` for unrelated reasons. This change must not wait for it, and must not conflict with it: the tiering plan should absorb `test:bos-llm` as one tier. **Both edit the `package.json` scripts block (SA C-8):** whichever merges second rebases, and tiering takes `test:bos-llm` over as one of its tiers.
- **Chat eval (`eval:chat`) in CI.** It calls a real model on a real account and is non-deterministic by design.
- The six planner defects found by the 2026-10-04 cold eval (sent to the Business OS owner).

---

## 11. Questions for SA

1. **Placement:** do you accept Option A (a third step in the required job) given §5's trade-off, or do you want B's separate check name despite the admin dependency?
2. **Threshold:** is ≤ 40 s median (≥ 10 s margin) the right bar for "inside the critical path", or do you want it stated against `Build`'s run-to-run variance instead?
3. **Scope:** S1 only, or S2 if it fits?
4. **Skill Standard 7:** point at `route.credits.test.ts`, or drop the usage-snapshot line?
5. **Heap:** the type-check step sets `NODE_OPTIONS=--max-old-space-size=6144` on its own step only. Should the Jest step set a heap explicitly, or leave Node's default (no OOM seen locally)?

---

## 12. SA Review

**Reviewed by SA, 2026-10-04**
**Status:** APPROVED WITH CONDITIONS. Proceed to Slice 1 (measurement). The placement ruling at the end of Slice 1 is made against the bar in C-2, not the one in §6.

### 12.1 Verification of load-bearing claims

| Claim | Verified how | Result |
|---|---|---|
| Required checks on `main` are exactly the four in §2 | `gh api repos/AgentsPilot/neuronforge/branches/main/protection/required_status_checks --jq .contexts` | ✅ `Admin authz surface guard`, `Type check (Business OS LLM attribution)`, `Build (next build)`, `React hooks rules guard` |
| §3.1 step timings (4 runs) | `gh run view <id> --json jobs`, step start/end | ✅ Matches to the second (job totals 148 / 155 / 159 / 159 s incl. set-up and post steps) |
| §3.2 Build 214 s and 207 s | Same | ✅ |
| §3.2 run 37172283864 "~245 s" | Same | ❌ **Misleading.** 245 s is the whole run including a 77 s queue wait. The `Build` job itself took **167 s**. For that SHA (f843d4f1) the type-check job finished at 02:54:35 and Build at 02:54:43: **8 s of headroom**, not ~50 s |
| §3.2 "headroom ≈ 50–55 s" | Paired job durations, same SHA, last 25 successful runs of each workflow (17 non-skipped pairs) | ⚠️ **Too optimistic as a single number.** Build is bimodal: about 207–226 s normally, 119–170 s in roughly 1 run in 5. Paired gap (Build − type-check job): median ≈ 62 s, but 8 s on f843d4f1 and **−8 s** on 5b26c361 (the type-check job was already the longer one). See C-2 |
| Skip rule (§2, AC-4) | Read `.github/ci/non-deploying-change.sh` | ✅ Skips only when every changed file is under `docs/`, `scripts/`, `.claude/` or is root-level `*.md`. Gate sources and `scripts/**` tests are carved back in. Fails open |
| No S1 test reads a skippable path | `grep readFileSync` across `lib/business-os/llm/__tests__` | ✅ All read targets are under `lib/`, `app/` or `supabase/`. `snapshotsAreDateless` names a `docs/` file only in a message string. A docs-only PR cannot change an S1 outcome, so skipping is safe |
| §9 workflow header is stale | Read the workflow | ✅ Stale. It also says "`Admin authz surface guard` is the only one on `main`", which is wrong too |
| §9 Standard 8 "not a required status check today" | `SKILL.md` line 143 | ✅ Stale |
| §9 Standard 7 usage-route snapshot | `ls app/api/business-os/usage/__tests__/` and the header of `route.credits.test.ts` | ✅ The file is gone. Credit-deduction slice 6a (0e3815a2) retired `route.test.ts` and its snapshot (SA F-11). `route.credits.test.ts` has no snapshot assertions |
| `--ci` behaviour | Read Jest 30.2 source: `jest-config` (`updateSnapshot = ci && !-u ? 'none' : …`), `@jest/core` (`snapshot.failure = !updateAll && (unchecked \|\| unmatched \|\| filesRemoved)`), `jest-snapshot` `cleanup()` | ✅ Under `--ci`: a **new** snapshot is not written and fails, a **mismatch** fails, an **obsolete** entry (`unchecked`) fails the run, and an **orphaned `.snap` file** whose test file is gone also fails it. ⚠️ The orphan scan covers the **whole repo's** haste map, not only the paths given. So an orphaned `.snap` anywhere outside `.claude/` would turn this gate red. That is acceptable (it is true drift), but see C-6 |

### 12.2 Rulings on §11

1. **Placement: Option A accepted.** It is the only option that blocks on day one without an admin action. It reuses an existing pattern (a `!cancelled()` gate step in a required job). B's "advisory until an admin acts" is the exact state that let #151 through. The job's display name (`Type check …`) is now a misnomer, but it is the required-check identity and must not be renamed. Compensate with an explicit step name (C-4) and the header rewrite. Fallback to B only under C-2. Option C is rejected (new pattern, 3 Jest workers plus a 6 GB `tsc` on a 16 GB runner).
2. **Threshold: restate it against the paired distribution, not a single headroom number.** See C-2. The 40 s cap stays as the step's own budget, but the pass/fail test for "inside the critical path" is the paired completion delta per SHA.
3. **Scope: S1 only in this PR.** S1 is what failed, and it is the set the snapshot proof lives in. Measure S2 once in Slice 1 as an information point, recorded in §3, but do **not** ship it here even if it fits. Change one variable at a time: if S2 lands with S1 and the gate turns slow or flaky, we cannot tell which half did it. S2 goes to a follow-up slice or to the test-tiering work (§10).
4. **Skill Standard 7: point at the real test, do not just drop the line.** Replace it with: `app/api/business-os/usage/__tests__/route.credits.test.ts` passes. Say that it pins the owner usage payload, and that the token-era snapshot suite was retired by credit-deduction slice 6a (SA F-11). Add a separate bullet: **`npm run test:bos-llm` passes (CI-enforced)**. Until S2 lands, note that `route.credits.test.ts` and the `*attribution*` suites are **not** in CI and must be run by hand.
5. **Heap: set nothing.** `NODE_OPTIONS` on the type-check step is step-scoped, so it does not leak, and it must not be copied. Jest workers inherit `NODE_OPTIONS`, so 6 GB × 3 workers would over-commit a 16 GB runner. If Slice 1 shows memory pressure, the remedy is `--maxWorkers=2` or `--workerIdleMemoryLimit`, not a bigger heap.

### 12.3 Conditions

- **C-1 (flags).** Keep `--ci` in the npm script, even though `CI=true` on Actions already enables it, because it makes a local `npm run test:bos-llm` behave like CI. **Do not** add `--passWithNoTests`: the default (no tests found → exit 1) is what makes a renamed or moved test directory fail loudly instead of passing vacuously. **Do not** add `--silent`: failure messages still print without it, but captured console output is diagnostic on a red run, and log volume is not a problem worth hiding evidence for. Any `--maxWorkers` tuning goes on the **workflow step** (`npm run test:bos-llm -- --maxWorkers=2`), not the npm script, so local runs keep Jest's default.
- **C-2 (measurement and bar).** Slice 1 records **5** runs, not 3 (the PR run plus "Re-run all jobs" four times, which re-pairs Build too). For each run, record: the new step's duration, the type-check job duration, the `Build` job duration, and the **completion delta** (Build `completedAt` − type-check `completedAt`) for the same SHA. Use job times, not run times, because queue waits differ per workflow. Option A stands if **both** hold:
  - (a) the step's median is ≤ 40 s;
  - (b) the median completion delta is ≥ 0, i.e. the type-check job still finishes no later than Build in the typical run.
  
  Name the fast-Build tail (Build ≈ 120–170 s in about 1 run in 5) in §3 as a known exception: on those runs the type-check job is already level with Build, so **any** added step extends them. SA accepts that tail as within the rule. If (a) fails, retry with `--maxWorkers=2` (5 runs again). If it still fails, use Option B per §6.
- **C-3 (AC-3 restated).** Replace AC-3 with: "Over the 5 measured runs, the median per-SHA completion delta (Build − type-check job) is ≥ 0, and the new step's median is ≤ 40 s." "Median of one job below median of the other" compares two different distributions and can pass while most individual PRs got slower.
- **C-4 (step shape).** Name the step explicitly (for example `Run Business OS LLM test suite (snapshots + boundary)`). Use `if: ${{ !cancelled() && steps.scope.outputs.skip != 'true' }}`, identical to the literal-check step. Put it after the literal check. Add a comment that says why: the #151 → #185 incident, and that `--ci` makes a stale snapshot fail rather than rewrite. Update the job's `timeout-minutes` comment ("~1–2 minutes after install") to the measured figure. No `actions/cache` for the Jest cache: that would be a new pattern, and a cold run is what we are measuring.
- **C-5 (§9 fixes in Slice 2).** Rewrite the workflow header: the job **is** required, it carries three gates, and a red step blocks the merge. Remove the "only one on `main`" sentence. Fix Standard 8's last sentence and Standard 7 per ruling 4. Also correct §3.2's "~245 s" row to the job time (167 s) and replace the single "50–55 s" headroom line with the paired distribution from 12.1. Do not cite counts or "as of" dates in the skill or the workflow comment; the workplan holds them.
- **C-6 (new AC, obsolete snapshot).** Add **AC-6**: an obsolete snapshot entry, or an orphaned `.snap` file, fails the step under `--ci`. Prove it **locally** in Slice 2: delete one test that owns a snapshot, run `npm run test:bos-llm`, confirm exit 1 with "obsolete", then restore it. Record the result. Slice 3's throwaway PR stays a mismatch proof only. Document in the workflow comment that the orphan scan is repo-wide (Jest behaviour), so whoever meets a red run caused by a `.snap` outside `lib/business-os/llm/` knows why.
- **C-7 (Slice 3 evidence).** Record `gh pr view <n> --json mergeStateStatus,statusCheckRollup` showing `BLOCKED` with this check `FAILURE`, plus the step name in the failing log. That proves the **test step**, not the type check, turned it red. Close the throwaway PR and delete its branch.
- **C-8 (tiering hand-off).** Add one line to §10 naming the touch point with `chore/test-tiering`: the `package.json` `scripts` block. Whichever lands second rebases, and the tiering plan absorbs `test:bos-llm` as a tier rather than duplicating its paths.
- **C-9 (diff discipline).** Slice 2's diff contains only: one npm script, one workflow step plus comment edits, the skill edits, and this workplan. No production code, no snapshot re-records. If any S1 test needs a fix to pass on CI (Linux paths, line endings), stop and report it. Do not adjust the test in this PR.

### 12.4 Optimisation suggestions (non-blocking)

- Slice 1 already uses PR re-runs. If `--maxWorkers=2` and the default are both measured, do it on the same PR so the runner population is comparable.
- If the heavy file (`modelSettings.off.chat.test.ts`) dominates on CI as it does locally, list it at the top of the S1 profile in §3. It is the first candidate for the tiering work to split, not something to fix here.

### Approval

[x] Workplan approved with conditions C-1 to C-9. Proceed to Slice 1. Return to SA with the Slice 1 numbers (C-2 table) for the placement ruling before Slice 2.

### 12.5 Slice 1 log (Dev)

**Run 1 (PR #199, run 37189752967): red, for the environment, not the tests.** The new step took **11 s** and failed 3 files (`modelSettings.off.nonchat`, `callParams.boundary.step2`, `modelSettings.off.chat`) with `ReferenceError: crypto is not defined`. The code under test (for example `chat-v4/route.ts:392`) calls the global `crypto.randomUUID()`, which Node 18 does not expose. This job pinned `NODE_VERSION: '18'`; `.nvmrc`, `build.yml`, Vercel and local development are all on **22**. **Fix:** the job now reads `node-version-file: '.nvmrc'`, as `build.yml` does. No test was edited (C-9 respected). This also moves the type-check and literal steps to Node 22. Both are Node-version-agnostic, but **SA to confirm** this is acceptable inside this PR. The other guard workflows (`admin-authz-guard`, `bos-entitlements`, `plugin-tests`, `react-hooks-guard`) still pin 18; out of scope here, flagged as a follow-up.

**C-2 / R-5 result: all 5 attempts on commit 72a779e1** (type-check run 37190638636, build run 37190638602; re-derived by Dev, SA and QA from the GitHub API):

| Attempt | Test step | Type-check job | Build job | Gap (Build end − type-check end) |
|---|---|---|---|---|
| 1 | 7 s | 99 s | 134 s | +35 s |
| 2 | 9 s | 149 s | 212 s | +65 s |
| 3 | 10 s | 145 s | 208 s | +65 s |
| 4 | 10 s | 145 s | 209 s | +101 s (Build queued) |
| 5 | 10 s | 138 s | 132 s | **−4 s** (fast Build: the accepted tail in §12.6.3) |
| **Median** | **10 s** (≤ 40 s ✅) | | | **+65 s** (≥ 0 ✅) |

Every test step was green. Per §12.6, the placement ruling is now **firm: Option A, scope S1, default workers.** The one negative gap was a fast Build (132 s), the case SA accepted. On that commit the PR would have been ready 4 s later than without this change.

**C-6 / R-3 proofs (local, Node 22, `npm run test:bos-llm` or `jest <file> --ci`):**

| Case | Result | Exit |
|---|---|---|
| Stray entry appended to `callParams.boundary.step3.test.ts.snap` | "1 snapshot obsolete" | 1 |
| Test renamed (snapshot under the new name) | "New snapshot was not written" + 1 obsolete | 1 |
| Orphaned `.snap` inside `lib/business-os/llm/__tests__/__snapshots__/` | "1 snapshot file obsolete" | 1 |
| Orphaned `.snap` outside the folder (`lib/business-os/bizql/__tests__/__snapshots__/`) | "1 snapshot file obsolete": the orphan scan is repo-wide, so the step comment stays | 1 |
| All probes removed, files restored | 23 passed | 0 |

### 12.6 Slice 1 measurement + Slice 2 code review (SA)

**Reviewed by SA, 2026-10-04**
**Status:** APPROVED WITH CONDITIONS (provisional on attempts 4–5, see 12.6.3). Conditions R-1 to R-5 below.

#### 12.6.1 Commit 72a779e1: Node 18 → `.nvmrc` (22) inside this PR

**Ruling: accepted, in this PR.**

- **The failure was environmental, not a test defect.** The 3 red suites hit `crypto.randomUUID()` on the global, which production (Node 22 on Vercel) provides and Node 18 does not. Making the test pass on 18 would mean editing a test or route code, which C-9 forbids. Moving the runner to the production major is the correct fix, and it is the one C-9 implies ("stop and report", which Dev did in §12.5).
- **Precedent, not a new pattern.** `build.yml` already reads `node-version-file: '.nvmrc'`, and its comment states why a gate on a different major than production can be green while the deploy breaks. This job now follows the same rule (CLAUDE.md rule 7 satisfied).
- **Type-check and literal steps on 22.** `tsc` output depends on the `typescript` and `@types/node` versions in the lockfile, not on the runtime major. The literal check is a plain `tsx` script. Both stayed green on 22 in attempts 1–3 (verified below). The step-scoped `NODE_OPTIONS=--max-old-space-size=6144` behaves the same on 22.
- `NODE_VERSION` is no longer referenced anywhere in the workflow (grep: 0 hits), so no dangling `env.` read.
- The four other guard workflows still pinning 18 are a correct out-of-scope follow-up. They run no code that needs the `crypto` global today.

#### 12.6.2 C-2 measurement, re-derived by SA

Source: `gh api repos/AgentsPilot/neuronforge/actions/runs/{37190638636,37190638602}/attempts/<n>/jobs`, job and step `started_at`/`completed_at`.

| Attempt | `npm ci` | `tsc` step | Literal step | **Test step** | Type-check job | Build job | **Gap** (Build end − TC end) |
|---|---|---|---|---|---|---|---|
| 1 | 47 s | 25 s | 4 s | **7 s** | 99 s | 134 s | **+35 s** |
| 2 | 80 s | 38 s | 7 s | **9 s** | 149 s | 212 s | **+65 s** |
| 3 | 79 s | 39 s | 7 s | **10 s** | 145 s | 208 s | **+65 s** |
| 4 | 77 s | running at review time | | | | | |
| 5 | not started at review time | | | | | | |

All numbers match Dev's table. Readings:

- **Step budget (C-2a): passes with a wide margin.** 7–10 s against a 40 s cap. `--maxWorkers=2` is not needed and must not be added.
- **Completion gap (C-2b): passes so far.** Median +65 s over 3 attempts. Attempt 1 is a fast-Build run (134 s, inside the 120–170 s tail named in C-2) and the gap was still +35 s.
- **Do not credit Node 22 for the attempt-1 speed.** `npm ci` was 47 s in attempt 1 and 77–80 s in attempts 2–4, and `tsc` 25 s vs 38–39 s. That is runner variance, not a Node effect. The honest statement is: the job with the new step (145–149 s typical) is no longer than the job without it on Node 18 (148–159 s in §3.1). The step costs about 10 s, and that is inside the noise of `npm ci`.

#### 12.6.3 Provisional placement ruling

**Option A, scope S1, default workers, stands**, provided attempts 4 and 5 complete green and keep the five-run figures in line. Concretely, the ruling holds if, over all 5 attempts:

1. the test step's median is ≤ 40 s, **and**
2. the median per-attempt gap (Build end − type-check end) is ≥ 0, **and**
3. every attempt's test step is green. One red attempt with no code change is a **flake**, and it outranks the timing: a required gate that flakes blocks unrelated merges.

**What would change it:**

| Outcome in attempts 4–5 | Effect |
|---|---|
| A test step > 40 s in one attempt, median still ≤ 40 s | Ruling stands. Record the outlier in §3 |
| Median step > 40 s (needs both remaining attempts very slow) | Re-measure 5 runs with `npm run test:bos-llm -- --maxWorkers=2` on the step (C-1). Still over → Option B (§6) |
| Median gap < 0 | Option A is withdrawn. Go to Option B; the admin-adds-check dependency is tracked like the build gate's OI-3 |
| A negative gap in one attempt on a fast Build (< 170 s), median ≥ 0 | Accepted tail per C-2. Record it in §3 |
| Any red test step on an unchanged SHA | Stop. Report the failing test and its log; no placement ruling until the flake is understood. Do not add retries |
| Memory pressure (OOM, a killed worker) | `--maxWorkers=2` on the step, or `--workerIdleMemoryLimit`. Never a raised heap (ruling 5) |

Dev records attempts 4–5 in §12.5 (or §3) and the final ruling becomes **firm without another SA pass** if the three tests above hold. Any row of the "what would change it" table other than the two "ruling stands / accepted tail" rows returns to SA.

#### 12.6.4 Slice 2 code review (uncommitted diff)

Checked against C-4, C-5, C-6, C-9.

| # | Item | Finding | Result |
|---|---|---|---|
| 1 | Workflow header | Says the job is required, that a red run blocks for all three gates, and why the name must not change. "Only one on `main`" is gone. No counts, no dates | ✅ C-5 |
| 2 | Third-gate header paragraph | Names the suite and the reason for the placement | ✅ (see R-4 on wording) |
| 3 | Step comment | Names #151 → #185, `--ci` fail-not-write, the repo-wide orphan scan, no `--passWithNoTests`, `!cancelled()`, and "re-measure before widening". PR numbers are incident references, which C-4 asked for, not status | ✅ C-4, C-6 (documentation half) |
| 4 | Step name and `if:` | `Run Business OS LLM test suite`, identical `if:` to the literal step, after it | ✅ C-4. The "for example" name in C-4 was not mandatory; this one is clear in the job's step list |
| 5 | `timeout-minutes` comment | "about a minute after install" matches the measured `tsc` + literal + tests (36–58 s) | ✅ C-4 |
| 6 | Skill Standard 7 | New `test:bos-llm` bullet: `--ci` fails a moved snapshot, update only that snapshot with `-t … -u` and give the reason in the commit. By-hand bullet names the `*attribution*` suites outside `llm/` (the glob also matches the hyphenated `*-attribution.test.ts` files) and `route.credits.test.ts`. The dead `route.test.ts.snap` line is removed and its retirement noted | ✅ ruling 4, with a gap: R-2 |
| 7 | Skill Standard 8 | "Not required" replaced: required, a red run blocks, a green one still proves only what the check sees, and the boundary tests are now in CI | ✅ C-5 |
| 8 | Skill checklist line | Adds `test:bos-llm`, deliberate snapshot moves, by-hand suites; drops "usage snapshot unchanged" | ✅ |
| 9 | Counts and dates in skill/workflow | None found | ✅ C-5, C-9 |
| 10 | Diff scope | `package.json` script (Slice 1), workflow step and comments, Node source (12.6.1), skill, workplan. No production code, no `.snap` change, no test edit | ✅ C-9 |
| 11 | Workplan §3.2 | 245 s row corrected to 167 s job time; single headroom line replaced with the paired distribution and the fast-Build tail | ✅ C-5, C-2 (tail named) |
| 12 | Workplan §10 | `package.json` scripts block named as the touch point with tiering | ✅ C-8 |
| 13 | Workplan §8 AC-3 | Still the old "median of one job below the median of the other" text | ❌ C-3 not done: R-1 |
| 14 | Workplan §8 AC-6 | Not added | ❌ C-6 not done: R-1 |
| 15 | C-6 local proof | Stray obsolete entry → "1 snapshot obsolete", exit 1. Renamed test → "New snapshot was not written" + obsolete, exit 1. Both restored, exit 0. Not yet run: orphaned `.snap` | ⚠️ R-3 |
| 16 | Logging (`console.*`) | No `lib/`, `app/` or `components/` file in the diff | n/a |
| 17 | Entitlements imports | None in the diff | n/a |

#### 12.6.5 Conditions for Slice 2 to be code-approved

- **R-1 (§8).** Replace AC-3 with the C-3 wording and add AC-6 per C-6. Both were conditions of the workplan approval, and the acceptance criteria are what QA tests against.
- **R-2 (Standard 7: say what `route.credits.test.ts` covers).** Ruling 4 asked for the reason it is on the by-hand list: it pins the owner usage payload. As written, a reader sees a file name without knowing what breaking it would mean. Half a sentence, no counts or dates.
- **R-3 (orphan proof).** Run the orphaned-`.snap` case locally and record it in §12.5: copy any snapshot to a `__snapshots__/` path whose test file does not exist (inside `lib/business-os/llm/__tests__/`, then once **outside** it, to prove the repo-wide claim in the step comment). Expect `1 snapshot file obsolete` and exit 1 under `npm run test:bos-llm`. Delete the copies and confirm exit 0. If the outside-the-folder copy does **not** fail, remove "the orphan scan is repo-wide" from the step comment rather than leave a claim that is false. Also record the two proofs already run (stray entry, renamed test) with their exit codes in §12.5.
- **R-4 (header wording, Low).** "it was measured to finish inside `next build`'s time" is true for the typical run but not for the fast-Build tail C-2 accepts. Prefer "measured against `next build`'s time; see the workplan", which the step comment already says. Not blocking on its own, but fix it with R-1/R-2.
- **R-5 (attempts 4–5).** Record both attempts in the C-2 table. The placement in 12.6.3 becomes firm if the three tests there hold; otherwise return to SA.

Slice 3 (C-7, the throwaway blocking proof) stays as planned after Slice 2 is committed.

#### 12.6.6 Code approved for QA

**Not yet.** Yes once R-1 to R-3 and R-5 are done and the five-run tests in 12.6.3 hold. R-4 is low priority. No further SA pass is needed for R-1, R-2, R-4 (text edits that match the wording above); R-3 returns to SA only if the out-of-folder orphan does not fail.

---

## QA Test Report

**QA — 2026-10-04**
**Test mode:** full
**Strategy used:** C (script: local `npm run test:bos-llm`, snapshot probes, the skip script against synthetic commits in a throwaway worktree) + E (CI job/step timings from the GitHub API) + static read of the workflow YAML. No Jest test was added: the change is CI configuration.
**Focus:** CI gate (pipeline of checks), schema of the workflow
**Skipped:** AC-2 (merge actually blocked): Slice 3, only testable after merge. No CI re-run, no commit, no push (instructed).
**Input source:** prompt keywords (TL brief) + §8 AC-1..AC-6 (AC-3/AC-6 as restated in §12.6)
**Tested against:** HEAD 72a779e1 + the uncommitted Slice 2 diff (workflow comments, skill, workplan). Local Node v22.19.0 (`.nvmrc` = 22).

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| AC-1 `test:bos-llm` runs with `--ci` in the required job | ✅ | Pass | `package.json`: `"test:bos-llm": "jest lib/business-os/llm/__tests__ --ci"`. Local run: 23 suites / 602 tests / 23 snapshots passed, exit 0 (14.6 s). Workflow step `Run Business OS LLM test suite` is step 6 of 7, after the literal check, `if: ${{ !cancelled() && steps.scope.outputs.skip != 'true' }}`, `run: npm run test:bos-llm`. Green on CI in all 5 attempts |
| AC-2 a failing test blocks the merge | ⬜ | NOT YET TESTABLE | Slice 3, after merge (throwaway PR) |
| AC-3 5 runs: median gap ≥ 0, median step ≤ 40 s | ✅ | Pass | Re-derived from the API, all 5 attempts (table below). Step median **10 s**; gap median **+65 s**; every test step green. Attempt 5 gap is **−4 s** on a fast Build (132 s < 170 s): the "accepted tail" row of §12.6.3 — must be recorded in §3 (see Edge Case 1) |
| AC-4 docs-only change still skips and reports success | ✅ | Pass | Synthetic commits in a throwaway `git worktree add --detach` of HEAD, `bash .github/ci/non-deploying-change.sh HEAD^ HEAD`: `docs/` only → SKIP exit 0; `.claude/` + root `README.md` → SKIP exit 0; `lib/…/callCatalog.ts` → BUILD exit 1; the workflow file → BUILD exit 1; `package.json` → BUILD exit 1; a `.snap` under `lib/` → BUILD exit 1. On SKIP every gate step is skipped and only the summary step runs, so the job concludes success. Script unchanged by this PR |
| AC-5 verdicts still reported when another gate fails | ✅ | Pass (see Edge Case 2) | Order: type check → literal → tests. Type check red → literal and tests still run (`!cancelled()`). Literal red → tests still run. Tests red → the two earlier verdicts already exist. Job fails if any step fails. The type-check step itself has no `!cancelled()`; harmless because it is the first gate (only checkout/setup/install precede it) |
| AC-6 obsolete entry / orphaned `.snap` fails under `--ci` | ✅ | Pass | Re-verified locally (probes below), all restored. Also checked the AC-1 claim that a moved snapshot fails and is **not** rewritten |

**AC-3 measurement** (`gh api repos/AgentsPilot/neuronforge/actions/runs/{37190638636,37190638602}/attempts/<n>/jobs`):

| Attempt | Test step | Type-check job (start → end) | Build job (start → end) | Gap (Build end − TC end) | Test step result |
|---|---|---|---|---|---|
| 1 | 7 s | 08:58:26 → 09:00:05 (99 s) | 08:58:26 → 09:00:40 (134 s) | +35 s | success |
| 2 | 9 s | 09:02:35 → 09:05:04 (149 s) | 09:02:37 → 09:06:09 (212 s) | +65 s | success |
| 3 | 10 s | 09:13:18 → 09:15:43 (145 s) | 09:13:20 → 09:16:48 (208 s) | +65 s | success |
| 4 | 10 s | 09:18:46 → 09:21:11 (145 s) | 09:19:23 → 09:22:52 (209 s) | +101 s | success |
| 5 | 10 s | 09:23:50 → 09:26:08 (138 s) | 09:23:52 → 09:26:04 (132 s) | **−4 s** | success |

Attempts 1–4 match Dev's and SA's numbers. Attempt 4's +101 s is partly start skew (Build started 37 s after the type check). Median step 10 s ≤ 40 s; median gap +65 s ≥ 0; no red step, so the three tests in §12.6.3 hold.

**Other checks**

| Check | Result |
|---|---|
| Workflow YAML parses (`js-yaml`) | ✅ Workflow name and job name unchanged (`Type check (Business OS LLM attribution)`); Setup Node uses `node-version-file: '.nvmrc'`; no `NODE_VERSION` reference left |
| SA C-5: no counts or dates in added workflow/skill lines | ✅ Scan of every `+` line for dates, "N suites/tests/…" and seconds: 0 hits. PR numbers (#151, #185) are incident references, accepted by SA (§12.6.4 #3) |
| SA C-9: diff scope | ✅ Committed vs `origin/main`: workflow, `package.json` (1 line), workplan. Uncommitted: workflow, skill, workplan. No test, `.snap` or production file |
| R-2 / R-4 text | ✅ Skill names `route.credits.test.ts` "which pins the owner usage payload"; header now says runtime "was measured against `next build`'s time" |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. The step costs 7–10 s; in attempt 5 it is the reason the type-check job ended after Build (≈ 6 s ahead of Build without it), which is the accepted fast-Build tail.

#### Edge Cases (nice to fix)

1. **R-5 not yet written into the workplan** — Attempts 4 and 5 are not in the §12.6.2 table or §12.5, and attempt 5's −4 s gap on a fast Build must be recorded in §3 per the §12.6.3 "accepted tail" row. §12.6.6 still reads "Not yet". Dev records them (this report's table can be copied); no SA pass is needed for this outcome per §12.6.3. — File: `docs/workplans/BOS_LLM_TESTS_IN_CI_WORKPLAN.md` — Severity: Low (documentation; the data passes).
2. **AC-5 wording vs YAML** — AC-5 says "`!cancelled()` on every gate step", but `Run scoped type check` keeps the plain `steps.scope.outputs.skip != 'true'`. Behaviour is correct (it is the first gate). Side effect worth knowing: if `npm ci` fails, the literal and test steps still run with no `node_modules` and add two red steps whose cause is the install, not the code. Either tighten the AC wording to "every gate step after the first" or accept. — File: `.github/workflows/bos-llm-typecheck.yml` / §8 — Severity: Low.

### Test Outputs / Logs

```text
npm run test:bos-llm (clean tree)
Test Suites: 23 passed, 23 total
Tests:       602 passed, 602 total
Snapshots:   23 passed, 23 total            EXIT=0

Probe 1 - stray entry appended to callParams.boundary.step3.test.ts.snap
 > 1 snapshot obsolete from 1 test suite.
Snapshots:   1 obsolete, 23 passed, 23 total   EXIT=1   (restored with git checkout)

Probe 2 - orphaned .snap in lib/business-os/bizql/__tests__/__snapshots__/ (outside the folder)
 > 1 snapshot file obsolete from 1 test suite.
Snapshots:   1 file obsolete, 23 passed, 23 total   EXIT=1   (file and new dir removed)

Probe 3 - value in callParams.snapshot.test.ts.snap changed (0.3 -> 0.31), jest <file> --ci
 > 1 snapshot failed from 1 test suite.
Tests: 1 failed, 7 passed, 8 total             EXIT=1   (.snap still carried the probe edit: not rewritten; restored)

non-deploying-change.sh HEAD^ HEAD (throwaway worktree, synthetic commits)
docs/ only                 -> SKIP  exit 0
.claude/ + README.md       -> SKIP  exit 0
lib/.../callCatalog.ts     -> BUILD exit 1
.github/workflows/*.yml    -> BUILD exit 1
package.json               -> BUILD exit 1
lib/.../*.snap             -> BUILD exit 1
```

Cleanup: the throwaway worktree (no `node_modules` junction) was removed without `--force` and pruned; all probe files restored or deleted; `git status` shows only the three pre-existing modifications.

### Final Status

- [x] All testable acceptance criteria pass (AC-1, AC-3, AC-4, AC-5, AC-6) — ready for commit once Dev records attempts 4–5 (Edge Case 1)
- [ ] Issues found — Dev must address before commit
- AC-2 is NOT YET TESTABLE (Slice 3, after merge)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-04 | Created | Dev workplan after #151 / #185: measurements, options A/B/C, scope S1/S2, 3 slices, questions for SA |
| 2026-10-04 | SA review | APPROVED WITH CONDITIONS (C-1 to C-9). Option A accepted, scope S1 only, bar restated as a paired per-SHA completion delta over 5 runs; §3.2 headroom corrected (run 37172283864's Build job was 167 s, headroom 8 s); `--ci` obsolete/orphan snapshot behaviour verified in Jest 30.2 source; Standard 7 points at `route.credits.test.ts` |
| 2026-10-04 | Slice 1 run 1 | Red on Node 18 (`crypto` global). Job switched to `.nvmrc` (22); see §12.5 |
| 2026-10-04 | SA Slice 1 measurement + Slice 2 code review | §12.6. Node 22 switch accepted in this PR (`build.yml` precedent). Attempts 1–3 re-derived: test step 7–10 s, gap +35/+65/+65 s. Provisional ruling: Option A, S1, default workers, firm if all 5 attempts give step median ≤ 40 s, median gap ≥ 0 and no red step. Slice 2 diff passes C-4/C-5/C-9; R-1 to R-5 open (AC-3/AC-6 in §8, `route.credits.test.ts` purpose, orphaned-`.snap` proof, header wording, attempts 4–5) |
| 2026-10-04 | QA test report | AC-1, AC-3, AC-4, AC-5, AC-6 PASS; AC-2 not yet testable (Slice 3). All 5 attempts re-derived: step median 10 s, gap median +65 s (attempt 5 −4 s on a 132 s Build = accepted tail), all green. No bugs; 2 low edge cases (attempts 4–5 not yet recorded in §12.5/§3; AC-5 wording vs the first gate step) |
| 2026-10-04 | Slice 1 complete (R-5) | Attempts 4–5 recorded (§12.5); median step 10 s, median gap +65 s, one −4 s fast-Build tail; placement firm (Option A, S1). AC-5 wording aligned with the YAML (QA edge case 2) |
