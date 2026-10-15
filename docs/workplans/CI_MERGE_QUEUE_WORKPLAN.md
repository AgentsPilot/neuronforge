# Workplan: CI Merge Queue Support

> **Last Updated**: 2026-10-15
> **Status**: 🟡 Code complete, uncommitted on `chore/merge-queue`. SA approved the workplan with C-1..C-7 on 2026-10-15; all seven are applied (see the Implementation Record). Awaiting SA code review.
> **Developer:** Dev
> **Branch**: `chore/merge-queue`, cut from `origin/main` @ `e668a7a6`
> **Related**: [TEST_STRATEGY_AND_CI_TIERING_WORKPLAN.md](/docs/workplans/TEST_STRATEGY_AND_CI_TIERING_WORKPLAN.md) §0 (house CI conventions, fail-open scope rule, G3 ratchet)

## Overview

The user will turn on GitHub's **Require merge queue** for `main`, with merge method **Merge commit**. If it were turned on today, the queue would hang. All 6 required checks run only on `pull_request` and `push: main`, so nothing reports on the queue's temporary `gh-readonly-queue/main/pr-<n>-<sha>` branches, and every queued PR would time out. This slice adds a `merge_group` trigger to the 6 workflows that own a required check. It also teaches their scope steps and the Jest G3 ratchet which base to use on a queue run, and stops Vercel from deploying queue branches. It changes CI files only. No check is renamed and no app code is touched.

---

## 1. Trigger changes (per workflow)

Each of these gets the same addition under `on:`. Job `name:` values stay exactly as they are, so the 6 required check names report identically on queue runs.

```yaml
  merge_group:
    types: [checks_requested]
```

| Workflow | Required check (job `name:`, unchanged) | Change |
|---|---|---|
| `admin-authz-guard.yml` | Admin authz surface guard | trigger + BASE (§2) |
| `bos-llm-typecheck.yml` | Type check (Business OS LLM attribution) | trigger + BASE |
| `build.yml` | Build (next build) | trigger + BASE |
| `react-hooks-guard.yml` | React hooks rules guard | trigger + BASE |
| `bos-entitlements.yml` | Business OS entitlements invariants | trigger + BASE |
| `tests.yml` | Gate tests (jest) (+ 3 `Gate tests shard N`) | trigger + BASE in both jobs + G3 `--base` |
| `plugin-tests.yml` | none required | **No change.** It is not a required check, so the queue never waits on it. It also uses `paths:` filters, which `merge_group` does not support. Its signal stays on the PR run and the nightly schedule. |

No `branches:` filter is needed on `merge_group`, because `main` is the only branch with a queue. The `push: branches: [main]` triggers already ignore the `push` event GitHub also sends when it creates a queue branch, so there are no duplicate runs.

## 2. Skip logic on `merge_group`

**Today:** every scope step passes `BASE: ${{ github.event_name == 'push' && github.event.before || '' }}`. On `merge_group` this resolves to `''`, so the scripts fall back to `HEAD^`. That happens to be right for a single-PR queue commit, but only by accident. The fix is to name the base explicitly, as the task asked.

**New expression (7 sites: 5 workflows plus both jobs of `tests.yml`):**

```yaml
BASE: ${{ github.event_name == 'push' && github.event.before || github.event_name == 'merge_group' && github.event.merge_group.base_sha || '' }}
```

**The base must be in the clone.** Checkout stays at `fetch-depth: 2`; on `merge_group`, `actions/checkout` checks out `merge_group.head_sha`, the queue's merge commit. Per SA (SA-Q2), `base_sha` is the queue commit's first parent: main's tip for the head of the queue, the entry ahead's queue commit for a stacked entry. With merge commits and max group size 1 it equals `HEAD^1`, so the fetch is a no-op. It is kept as insurance for a group size above 1, where it is what stops G3 failing closed (§7 case 8). On `merge_group` only, all 7 scope steps (shard matrix included) get:

```yaml
MQ_BASE: ${{ github.event_name == 'merge_group' && github.event.merge_group.base_sha || '' }}
```

and, first in the same `run:` block, before the scope script (C-1):

```bash
if [ -n "$MQ_BASE" ]; then git fetch --no-tags --depth=1 origin "$MQ_BASE" || true; fi
```

`git diff A B` needs only the two trees, not their shared history, so after this the diff resolves whichever commit `base_sha` turns out to be. `MQ_BASE` is set only on `merge_group`, so PR and push runs do not change.

**Correctness of the range:** the queue commit `M` has parents (`base_sha`, PR head). Therefore `git diff base_sha M` is exactly the PR's net change on top of what `main` will be, the same set of files the PR run's `HEAD^1..HEAD` diff sees.

| Case | Queue run outcome |
|---|---|
| Docs-only PR (`docs/**`, root `*.md`, `.claude/**`) | Both scripts print SKIP, `skip=true`, every job goes green in seconds |
| Code PR | `non-deploying-change.sh` exits 1, so the job runs in full |
| `base_sha` unresolvable (fetch failed, all-zero SHA) | `git rev-parse` fails, so the scripts BUILD/RUN. **Fail-open is preserved.** |

**G3 ratchet (`jest-gate-check.mjs`):** it takes `--base`, which defaults to `HEAD^1`. `tests.yml` never passes it today. In the `gate` job, the "Check the gate ran in full (G1-G7)" step gets `--base "$G3_BASE"` with `G3_BASE: ${{ github.event_name == 'merge_group' && github.event.merge_group.base_sha || 'HEAD^1' }}`. The fetch has already run in that job's scope step (C-2). PR and push behaviour stays byte-identical (`HEAD^1`). On the queue, the quarantine is ratcheted against the real base. G3 still **fails closed** if the base cannot resolve. That is deliberate and unchanged: a failed ratchet removes the PR from the queue, and the author re-queues it.

The two scripts' logic is unchanged: they already accept `[BASE]`. Only the header comment of `non-deploying-change.sh` is refreshed (C-3).

## 3. Concurrency

Groups are `<wf>-${{ github.ref }}` with `cancel-in-progress: true`. On `merge_group`, `github.ref` is `refs/heads/gh-readonly-queue/main/pr-<n>-<sha>`, which is unique per queue entry. A PR run uses `refs/pull/<n>/merge` and a main push uses `refs/heads/main`. The result:
- a queue run can't cancel, or be cancelled by, its own PR run or another queue entry;
- a rebuilt entry (after the one ahead fails) gets a new SHA and a new group. GitHub disregards the stale run, so it costs minutes only in that failure case.

**No change to the concurrency keys.** One thing is already true today: back-to-back merges to `main` cancel each other's `push: main` run. The queue does not change that, and those commits were already validated in the queue.

## 4. Vercel

Vercel would otherwise deploy a preview for every `gh-readonly-queue/*` branch push. Per SA-Q1 / C-3, `vercel.json` gets:

```json
"git": {
  "deploymentEnabled": {
    "gh-readonly-queue/**": false
  }
}
```

Vercel matches these keys as minimatch globs. `**` crosses `/`, so it covers `gh-readonly-queue/main/pr-<n>-<sha>`. No build container starts, and there is no Canceled deployment per entry. `ignoreCommand`, `crons` (17) and `rewrites` are untouched. `non-deploying-change.sh` logic is unchanged, so the shared skip rule has no Vercel-only branch. If the glob ever failed to match, the only cost is a wasted preview. Vercel is not a required check. Production still deploys from the push to main.

## 5. Other `pull_request`-only context

Grep of `.github/` and the repo for `github.event.pull_request.*`, `github.head_ref`, `github.base_ref`, `GITHUB_BASE_REF/HEAD_REF/EVENT_PATH`: **no uses.** The only event-specific expression is `github.event.before`, in the 7 BASE lines covered in §2. `jest-gate-check.mjs` uses only `git` and `GITHUB_STEP_SUMMARY`. The guard suites scan files on disk. Nothing else breaks.

## 6. Runtime (honest)

- **Added:** one extra CI run per PR, on the queue commit. About **4–5 min wall-clock per code PR** (Build 165–250 s, with the verdict job about 162 s in parallel; SA C-4). **Seconds** for a docs-only PR. This is added to merge latency, not to anyone's PR wait.
- **Nobody waits on it.** Auto-merge only enqueues a PR after its PR run is green. The queue run happens after that, with no one watching, and then GitHub merges.
- **What it replaces:** with strict up-to-date protection today, a PR that falls behind needs Update branch and a full PR rerun before it can merge. The queue run takes the place of that rerun. In a busy period it replaces more than one rerun, because no one needs to update by hand any more.
- **Net:** total runner minutes go up for PRs that would have merged without an update. Merge latency goes up by one run, about 4–5 min. Human wait time and the manual update loop go away. No job on the PR critical path is slower. The repo is public, so Actions minutes are free (SA-Q3).

## 7. Test plan

**Local (C-7).** Bash and git only, so no `node_modules` is needed. Everything runs in a throwaway `--no-hardlinks` clone under the session scratchpad, so the worktree's object store and refs are never written and `git stash` is never used. Script: `scratchpad/mq-sim.sh <worktree> <simdir>`. It:
1. clones the worktree, copies in the working-copy `.github/ci/*` under test, and takes its tip as main `B`;
2. makes PR heads `PD` (`docs/sim-merge-queue.md`) and `PC` (`lib/sim-merge-queue.ts`) on `B`;
3. builds queue commits with `git merge-tree --write-tree` + `git commit-tree -p <base> -p <pr>`: single `MD=(B,PD)` and `MC=(B,PC)`, plus stacked `S2D=(MC,PD)` and `S2C=(MD,PC)`;
4. emulates `actions/checkout` with `git clone --depth=2 --branch <queue ref> file://…`, then runs the workflows' exact scope `run:` block (guarded fetch, then both scripts) and G3's base resolution (`git cat-file -e base^{commit}` plus `git show base:.github/ci/jest-quarantine.json`, as `jest-gate-check.mjs` does).

Results (2026-10-15, base `e668a7a6`):

| # | Case | non-deploying | jest-gate-scope | G3 base |
|---|---|---|---|---|
| 1 | single docs-only, base = main | SKIP | skip=true | resolves |
| 2 | single code, base = main | BUILD | skip=false | resolves |
| 3 | **stacked** docs behind code, base = M1 | SKIP | skip=true | resolves |
| 4 | **stacked** code behind docs, base = M1 | BUILD | skip=false | resolves |
| 5 | stacked docs, base = main (superset range) | BUILD | skip=false | resolves (fetched) |
| 6 | fail-open: all-zero base | BUILD | skip=false | fails closed |
| 7 | fail-open: SHA not on remote | BUILD | skip=false | fails closed |
| 8 | as 5 but **without** the fetch | BUILD | skip=false | **fails closed** |

Cases 3 and 4 show the decision is still per PR when entries are stacked. Case 5 shows a too-old base only widens the range, which is the safe direction. Case 8 is why the fetch stays in (SA-Q2). Cases 6 and 7 keep the fail-open and fail-closed semantics. The sim directory was deleted afterwards. The worktree shows no new refs, and HEAD is still `e668a7a6`.

Static checks:
- PyYAML parses all 7 workflows. The 6 changed ones have `merge_group: {types: [checks_requested]}`, and `plugin-tests.yml` has none.
- Job names are unchanged: `Admin authz surface guard`, `Business OS entitlements invariants`, `Type check (Business OS LLM attribution)`, `Build (next build)`, `React hooks rules guard`, `Gate tests shard ${{ matrix.shard }}`, `Gate tests (jest)`.
- `MQ_BASE` and the guarded fetch appear once in each of the 5 workflows and twice in `tests.yml`.
- `vercel.json` passes `json.load`. Its keys are `ignoreCommand, git, crons, rewrites`, with 17 crons (17 at HEAD) and 1 rewrite.
- `actionlint` is not installed and was not installed for this.

**After merge (user enables the queue):**
1. Throwaway PR A: docs-only (one line in a scratch doc), put on auto-merge with the exact command sessions use, `gh pr merge --auto --merge`. gh warns that the queue sets the merge method; that is expected, not a failure. Expect the 6 checks to report on the queue branch with skip summaries and the PR to merge via the queue. Also check **(a)** the Vercel dashboard shows **no** deployment for the `gh-readonly-queue/...` branch (C-6).
2. Throwaway PR B, a deliberately failing gate test, on auto-merge. Expect it to enter the queue, `Gate tests (jest)` to fail on the queue run, and the PR to be **removed from the queue** and never land. Close it.
3. The first real code PR afterwards proves the full green path on `merge_group`. QA records it.

**User's GitHub settings** (Settings → Branches → `main` rule). **Order matters (C-5): merge this PR to main first, then tick Require merge queue.** `merge_group` reads workflows from the queue commit, so once this is on main every open PR picks up the triggers automatically. Enabling the queue first would hang it.
- Tick **Require merge queue**. Merge method: **Merge commit**.
- **Build concurrency** 5 (default). **Min group size 1, max group size 1** (no batching, so a failure points at one PR and `base_sha` = `HEAD^1`). Wait time for min group size: 0–5 min, which is irrelevant at size 1.
- Merge strategy: **Only merge non-failing pull requests**.
- **Status check timeout:** 45 min (Build's job timeout is 30 min, plus runner queueing).
- Keep the 6 required checks, strict, and enforce_admins as they are.

## 8. Rollback

Untick **Require merge queue**. The `merge_group` triggers never fire without a queue, and the BASE/G3 expressions fall back to today's values on `push`/`pull_request`. The `vercel.json` glob only matches branches that no longer exist. A revert of the PR is optional.

## 9. Guardrails

- Only `.github/workflows/{admin-authz-guard,bos-llm-typecheck,build,react-hooks-guard,bos-entitlements,tests}.yml`, `vercel.json` (one added `git` key) and `.github/ci/non-deploying-change.sh` (comments only) change, plus this doc. No app code.
- No job `name:` is changed, and no check is added to or removed from the required set.
- Fail-open scope and fail-closed G3 semantics are both unchanged.
- No `paths:` filters are added. No new workflow and no new job are added.

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| 6 workflows above | modify | `merge_group` trigger; BASE + `MQ_BASE`; guarded fetch; refreshed BASE comments; G3 `--base` (tests.yml) |
| `vercel.json` | modify | `git.deploymentEnabled` `gh-readonly-queue/**: false` (C-3) |
| `.github/ci/non-deploying-change.sh` | modify | header comment only: merge_group path replaces the stale "merge queue batch" note (C-3) |
| `docs/workplans/CI_MERGE_QUEUE_WORKPLAN.md` | create | this workplan |

## Task List
- [x] ✅ T1 Add the `merge_group` trigger to the 6 workflows
- [x] ✅ T2 Add the merge_group BASE + `MQ_BASE` + guarded fetch in all 7 scope steps (C-1)
- [x] ✅ T3 Add `G3_BASE` / `--base` on the tests.yml "Check the gate ran in full" step (C-2)
- [x] ✅ T4 Add the `vercel.json` `git.deploymentEnabled` block, and refresh the BASE comments in the 5 workflows and the script header (C-3)
- [x] ✅ T5 Correct §6 runtime (C-4), the settings order (C-5) and the post-merge checks (C-6)
- [x] ✅ T6 Local test plan §7 (C-7), with results recorded above

### Implementation Record

| Condition | Applied |
|---|---|
| C-1 | `MQ_BASE` env on all 7 scope steps (5 workflows plus the tests.yml shard and gate jobs). The guarded fetch is the first line of the same `run:` block. tests.yml's two `run: bash …` one-liners became `run: \|` blocks. |
| C-2 | `G3_BASE` env on "Check the gate ran in full (G1-G7)", plus `--base "$G3_BASE"`. On PR and push it is `HEAD^1`, the script's existing default. |
| C-3 | `vercel.json` gains the `git` key only (+5 lines, 0 deleted). The script's logic is unchanged and its header and the 5 workflows' BASE comments now describe merge_group. `tests.yml`'s shard comment is updated too. |
| C-4 | §6 now says 4–5 min. |
| C-5 | §7 settings now say: merge first, then enable. |
| C-6 | §7 post-merge step 1 adds the Vercel check and the `gh pr merge --auto --merge` note. |
| C-7 | Stacked cases, fail-open cases and a JSON parse are run and recorded. No scratch commit or ref is left in the repo. |

Deviations: none.

## Open Questions for SA

- **SA-Q1 Vercel mechanism.** Use the env guard in the shared script (§4), or `"git": {"deploymentEnabled": {"gh-readonly-queue/**": false}}` in `vercel.json`? The second never starts a build container and keeps the shared skip rule free of a Vercel-only branch. The first is what TL specified. Dev leans towards `deploymentEnabled`.
- **SA-Q2 Explicit base fetch.** Accept the one-line `git fetch --depth=1 origin $base_sha` on `merge_group` (~1 s), or rely on max group size 1 making `base_sha == HEAD^1` at depth 2?
- **SA-Q3 (out of scope, a possible later saving).** Once the queue validates every merge commit, the `push: main` run duplicates the queue run. Dropping it would cancel out the added minutes, but it would also remove the post-merge health signal on `main`. Raise this as a separate slice?

## SA Review Notes

**Reviewed by SA — 2026-10-15**
**Status:** ✅ Approved with conditions (C-1..C-7). No revision round needed; Dev applies the conditions while implementing.

### Comments
1. §1 triggers and check names — **correct.** Read all 6 workflows at `e668a7a6`. None has a job-level `if:` except the `tests.yml` verdict job, which is `if: always()`, so every required job runs and reports on `merge_group`. No `merge_group` skip path exists, so the queue cannot wait on a check that never reports. Shards (`Gate tests shard N`) are not required and must stay that way. Job `name:` values are unchanged. The `push: branches: [main]` filter does ignore the queue-branch push. `plugin-tests.yml` correctly left alone. — SA: resolved
2. §2 range — **correct.** With merge method Merge commit, the queue commit `M` has parents (`base_sha`, PR head), so `base_sha..M` is the PR's net change on what main will be. If `base_sha` ever turned out to be an *older* commit than `HEAD^1` (batching), the diff is a superset of files, which can only turn SKIP into BUILD. That is the safe direction. — SA: resolved
3. §2 fail modes — scope scripts fail open (unchanged); G3 fails closed (unchanged, accepted: a G3 failure only ejects the PR from the queue, it never lands bad code and never stalls the queue). The verdict job's "no result files" fail-closed still covers a shard/verdict scope disagreement. — SA: resolved
4. §3 concurrency — **correct, no change.** `github.ref` on `merge_group` is the per-entry `gh-readonly-queue/main/pr-<n>-<sha>` ref, so a queue run can never cancel, or be cancelled by, a PR run, a main push, or another entry. — SA: resolved
5. §6 runtime — **figure is wrong.** A queue run is a normal CI run on one commit: about **4–5 min wall-clock** (Build 165–250 s; verdict ~162 s, in parallel), not ~9 min. Docs-only: seconds. — SA: corrected in C-4
6. §7 settings and §8 rollback — sound. One ordering rule is missing (C-5). — SA: resolved with C-5

### Rulings on Dev's questions
- **SA-Q1 Vercel — use `vercel.json` `"git": {"deploymentEnabled": {"gh-readonly-queue/**": false}}`; drop the env guard in `non-deploying-change.sh`.** Vercel matches `deploymentEnabled` keys with minimatch globs; `**` crosses `/`, so `gh-readonly-queue/**` covers `gh-readonly-queue/main/pr-<n>-<sha>` (a single `*` would not). No build container starts, no "Canceled" deployment per queue entry, and the shared skip rule stays free of a Vercel-only branch. Both options are fail-safe: if the glob ever failed to match, the only cost is a wasted preview build, never a blocked merge (Vercel's status is not a required check). Proof is post-merge step A (C-6). Production keeps building from the push to main.
- **SA-Q2 — `merge_group.base_sha` is the queue commit's first parent: main's tip for the head of the queue, the entry ahead's queue commit for a stacked entry** (that is also why the ref name carries a SHA). With merge commits and max group size 1 it always equals `HEAD^1`, so at depth 2 the fetch is a no-op. **Keep the fetch anyway:** it costs ~1 s, is `|| true`-guarded, and it is what keeps G3 from failing closed (ejecting good PRs) if anyone ever raises max group size above 1, where `base_sha` is no longer `HEAD^1`. Cheap insurance against a settings change nobody will connect to this code.
- **SA-Q3 — keep the `push: main` run; do not open a slice.** It is the only signal that the commit actually on main is healthy (e.g. if the queue is ever switched off or bypassed), and the repo is public, so the extra Actions minutes cost nothing. Revisit only if Actions minutes ever become billable.

### Conditions (must be met before code review)
- **C-1** Spell out the env var: `MQ_BASE: ${{ github.event_name == 'merge_group' && github.event.merge_group.base_sha || '' }}` on all 7 scope steps (5 workflows + both `tests.yml` jobs, including the shard matrix). The fetch runs **before** the scope script in the same `run:` block.
- **C-2** In the `tests.yml` gate job, `G3_BASE` goes on the "Check the gate ran in full" step, and the fetch must have run earlier in that job (the scope step), so G3 sees the base on stacked entries.
- **C-3** Per SA-Q1: change `vercel.json` (add the `git.deploymentEnabled` block, leave `ignoreCommand` as is) and **do not** touch the script's logic. Update §4, §9 and "Files to Create / Modify" to match. Refresh the stale "merge queue batch" wording in the BASE comments of the 5 workflows and the script header so they describe the `merge_group` path (comments only).
- **C-4** Correct §6 to "~4–5 min wall-clock per code PR, seconds for docs-only; added to merge latency, not to anyone's PR wait".
- **C-5** Add to §7 settings: **merge this PR to main first, then tick Require merge queue.** `merge_group` reads workflows from the queue commit, so every open PR picks up the triggers automatically once this is on main; enabling the queue first would hang it.
- **C-6** Post-merge step A also checks (a) the Vercel dashboard shows **no** deployment for the `gh-readonly-queue/...` branch, and (b) it is done with the exact command sessions use, `gh pr merge --auto --merge` (gh warns that the queue sets the method; that is expected, not a failure).
- **C-7** Local test plan: add a stacked case, a synthetic `M2` whose first parent is a synthetic `M1`, run with base `M1` to show SKIP/BUILD is still per-PR. Step 5 is replaced by a JSON parse of `vercel.json`. Run step 3's detached checkout without discarding the uncommitted workplan, and never `git stash`.

### Settings list (SA confirms)
Merge method Merge commit; build concurrency 5; min/max group size 1/1; wait time irrelevant; "Only merge non-failing pull requests" on; status check timeout 45 min; required checks, strict and enforce_admins unchanged.

### For the user (plain terms)
- Once this is on, no one clicks "Update branch" again. A PR set to auto-merge lands by itself.
- Each merge takes about **4–5 more minutes** from "green" to "on main", because GitHub re-checks it against the latest main first. Nobody sits and waits for that, and it replaces the update-and-rerun loop, which took longer.
- No extra cost: the repo is public, so GitHub Actions minutes are free.
- To undo it: untick one box in GitHub settings.

### Approval
[x] Workplan approved — proceed to implementation, applying C-1..C-7

**Code Review by SA — 2026-10-15**
**Status:** ✅ Code Approved

### Code Review Comments
Diff reviewed against `e668a7a6`: 8 files, +129/−34. `git diff --check` is clean, no CRLF was introduced, and all 7 workflows parse as YAML (UTF-8).
1. **C-1:** met. `MQ_BASE` is spelled exactly as ruled on all 7 scope steps (5 workflows plus the `tests.yml` shard and gate jobs). The fetch is the first line of the same `run:` block, wrapped in `if [ -n "$MQ_BASE" ]` and `|| true`. Under the runner's `bash -e`, a failed fetch cannot fail the step. — resolved
2. **C-2:** met. `G3_BASE` sits on "Check the gate ran in full (G1-G7)" and is passed as `--base "$G3_BASE"`. That job's scope step has already run the fetch. — resolved
3. **Expressions, per event:** `push` gives `event.before`, as before. `pull_request` and `workflow_dispatch` give `''`, the script's `HEAD^` default, as before. `merge_group` gives `base_sha`. `G3_BASE` is `HEAD^1` on every event except `merge_group`, which is the script's existing default, so PR and push behaviour is byte-identical. — resolved
4. **Job names and verdict:** every job `name:` is unchanged, `gate` keeps `if: always()`, and no job-level `if:` was added. All 6 required workflows declare `merge_group: types: [checks_requested]`. `plugin-tests.yml` is untouched. Nothing in the diff can hang the queue or turn a required check red on a normal PR. — resolved
5. **`vercel.json`:** valid JSON. Keys are `ignoreCommand`, `git`, `crons` (17, the same as before) and `rewrites` (1). Nothing was lost. — resolved
6. **`non-deploying-change.sh`:** only the header comment changed. The logic is identical. — resolved

### Optimisation Suggestions
- Low: in Change History, the "Implemented" row sits above the "SA workplan review" row. The rows are cosmetic and out of time order; reorder them when you next touch the file.
- Accepted caveats: G3 was not run end-to-end, because the PR-path arguments are unchanged and the merge_group path is proven by post-merge steps A and B. The Vercel glob is proven by C-6(a).

### Code Approved for QA: Yes

## QA Testing Report

## Commit Info

| Item | Value |
|---|---|
| PR | #396, merged 2026-10-15 as `f2a67d25` |
| Commits | `ddc61ca5` ci (6 workflows, scope script header, `vercel.json`) · `a593b903` docs (this workplan) · `a0487468` merge of origin/main |
| Queue enabled | 2026-10-15 by the user, classic branch protection on `main` → Require merge queue |
| Live configuration (read back via GraphQL `mergeQueue.configuration`) | merge method `MERGE`, strategy `ALLGREEN`, build concurrency 5, group size 1–5, min-group wait 300 s, check timeout 3600 s. The classic page exposes only the merge method; the rest are GitHub defaults, accepted by TL (group size up to 5 is the stacked case §2/C-7 already covers) |
| Post-merge proof A | this docs PR, merged through the queue (see the PR) |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Merged and enabled | #396 merged (`f2a67d25`); the user enabled Require merge queue; live configuration recorded in Commit Info; proof A = the PR that adds this row |
| 2026-10-15 | Created | Dev workplan for merge queue support, awaiting SA review |
| 2026-10-15 | Implemented | C-1..C-7 applied; 6 workflows, `vercel.json`, script header comment; local simulation (8 cases) and YAML/JSON parse recorded in §7; uncommitted, awaiting SA code review |
| 2026-10-15 | SA workplan review | Approved with conditions C-1..C-7. SA-Q1: `vercel.json` `deploymentEnabled` glob, not the env guard. SA-Q2: `base_sha` = the queue commit's first parent; keep the fetch. SA-Q3: keep `push: main`, no slice. Runtime corrected to ~4–5 min |
| 2026-10-15 | SA code review | Code approved for QA: C-1/C-2 met, expressions correct on all 4 events, job names and `if: always()` intact, `vercel.json` valid with no keys lost |
