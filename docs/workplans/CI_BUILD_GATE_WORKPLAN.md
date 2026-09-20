# Workplan: CI Build Gate (`next build` in CI)

> **Last Updated**: 2026-09-20

**Developer:** Dev
**Branch:** `chore/ci-run-next-build` (worktree `../neuronforge-ci-build`, fast-forwarded to `origin/main` @ `6bb509df`)
**Requirement:** Open-items row 3 — CI does not run `next build`; a build-only break reached `main` once (PR #53, Layer 2 audit-trail work).
**Status:** QA Passed — defects D-1..D-6 fixed, D-7 recorded (uncommitted — user reviews before commit)

## Overview

`next.config.js` sets `typescript.ignoreBuildErrors` and `eslint.ignoreDuringBuilds`, and the repo carries ~2,038 pre-existing `tsc` errors, so a full type check can't be the gate. But `next build` still fails on module-scope crashes during *Collecting page data* / *Generating static pages* — the class of break that reached `main`. Nothing in CI ran it until now.

## Decision: separate workflow, not a step in `bos-llm-typecheck.yml`

| Reason | Detail |
|---|---|
| Independent required check | Branch protection requires *check names*. A separate workflow gives `Build (next build)` its own name, so the build and the attribution type check can be required (or un-required) independently. Bundled, one red step hides which gate failed. |
| Different env surface | The build needs 9 placeholder service env vars (below). The type check needs none. Bundling would hand env to a job that has no business with it. |
| Different runtime/caching | Build ≈ 3 min + needs a `.next/cache` restore; typecheck ≈ 1–2 min and has a committed-baseline mechanism. Separate `concurrency` groups let each cancel/rerun on its own. |
| Wall clock | Both run in parallel on a PR, so a separate workflow costs no extra elapsed time. Repo is public → Actions minutes are free. |

## Build-time env (placeholders only — no secrets)

`next build` evaluates route modules at build time, so module-scope client constructors run. Found by iterative bisection (each missing var fails the build):

| Var | Why the build needs it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabaseBrowserClient.ts` builds the browser client at module scope |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `supabaseServer` / admin client construct + assert at module scope (`/api/admin/*`) |
| `OPENAI_API_KEY` | `new OpenAI()` at module scope (`/api/business-os/chat-v2`) |
| `STRIPE_SECRET_KEY` | `new Stripe()` at module scope (`/api/stripe/*`) |
| `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | QStash receiver constructed at module scope (`/api/cron/process-queue`) |

All are **obviously-fake literals in the workflow file** (`ci.invalid.supabase.co`, `ci-not-a-real-key`). No network call is made at build time, so fakes suffice and CI never needs real credentials. Follow-on note: these module-scope constructors are themselves a latent hazard (any route importing one crashes the build if env is absent) — out of scope here.

## Files

| File | Action | Reason |
|---|---|---|
| `.github/workflows/build.yml` | create | The build gate |
| `.nvmrc` | create | Single source for the Node major (CI + local nvm); must match the Vercel project setting |
| `docs/workplans/CI_BUILD_GATE_WORKPLAN.md` | create | This note |

## Task List
- [x] Read `.github/workflows/`, `next.config.js`, `package.json`
- [x] Create worktree + branch off `origin/main`
- [x] Determine minimum build-time env by bisection (4 build runs)
- [x] Verify `npm run build` passes on current `main` in the worktree
- [x] Write `.github/workflows/build.yml` (PR + push to main + manual)
- [x] Confirm failure propagates (an unset env var gave exit 1 → job fails; no `|| true` / `continue-on-error`)
- [x] Report required-check status (below) and pre-existing red workflows (none)

## Findings to report

- **`typecheck:bos-llm` is NOT a required check on `main`.** `main` has branch protection (`enforce_admins: true`, no force-push, no deletions) but the protection object has **no `required_status_checks` section at all** — zero required checks. Making it (and the new build) required needs a GitHub admin. Tracked as OI-3; not changed here.
- **No existing workflow is red on `main`.** Latest runs at tip `1ee77c1d`: *Business OS LLM Type Check* ✅, *Plugin Tests* ✅ (last run `0d7544c0`, its path filter didn't match the tip commit). One `cancelled` run at `bb7a1865` is the `concurrency` group superseding it, not a failure. So any red after this change is new.

## QA Test Report

**QA — 2026-09-20**
**Test mode:** full
**Strategy used:** C (test script / direct execution) plus an adversarial static review. There is no Jest surface for a workflow file; the only meaningful proof is running `npm run build` under exactly the workflow's env and observing the exit code. Branch-protection and run-history claims were verified with `gh api` / `gh run list`.
**Focus:** ci / security / performance
**Skipped:** e2e (not set up in this repo). No GitHub Actions run of the workflow exists — it is uncommitted, so all build evidence is local.
**Input source:** prompt keywords
**Worktree:** `../neuronforge-ci-build` @ `1ee77c1d` (branch `chore/ci-run-next-build`), nothing committed.
**Env used for every build below:** the exact `env:` block of the `Build` step (9 placeholders + `NODE_OPTIONS` + `NEXT_TELEMETRY_DISABLED`), sourced from a script. All 9 were verified unset in the shell beforehand, and the worktree contains **no `.env*` file**, so nothing could mask a missing var.

### Check Results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Failing build actually fails the job — no `continue-on-error`, no `-or-true`, no swallowed exit code | PASS | `run: npm run build` is the final step; the workflow contains no `continue-on-error`, no `||`, no `set +e`, no shell wrapper. Confirmed empirically twice — see *Deliberate-break test*: exit 1 for both break classes. |
| 2 | Triggers correct (PRs to `main` at minimum) | PASS | `pull_request: branches: [main]`, `push: branches: [main]`, `workflow_dispatch`. No `paths:` filter — correct, since almost any file can break the build. |
| 3 | Concurrency group sane — cannot cancel a run that should have blocked a merge | PASS | `group: build-${{ github.ref }}`. For `pull_request`, `github.ref` is `refs/pull/N/merge` (one group per PR); for `push` it is `refs/heads/main`. A cancelled run reports **`cancelled`, not `success`**, so a required check can never be *satisfied* by cancellation — it can only delay a merge, never permit one. The group name is distinct from `bos-llm-typecheck-*`, so the two workflows never cancel each other. |
| 4 | Cache restore order / stale or poisoned `.next/cache` | PASS with defects | Restoring `.next/cache` cannot make a broken build pass: both deliberate breaks ran against a **warm 1.6 GB local `.next`** and still exited 1. Fork PRs cannot write into `main`'s cache scope (GitHub cache isolation), so poisoning `main`'s cache requires push access to `main` already. See defects D-2 (key churn) and D-3 (false rationale comment). |
| 5 | The 9 env values are obviously fake, no real secret, no route to leak one | PASS with defect | All 9 are inline literals (`ci-not-a-real-key`, `sk_test_ci-not-a-real-key`, `sig_ci_not_a_real_key`). The workflow references `secrets.` **zero times** (`grep -n "secrets\." .github/workflows/build.yml` → no match) and sets `permissions: contents: read`, so the job holds nothing to leak. Caveat D-4: the Supabase host is a subdomain of the *real* `supabase.co`, not the RFC-2606 `.invalid` TLD. |
| 6 | Runs on `pull_request` from forks — is that a risk here? | PASS | The trigger is `pull_request`, **not** `pull_request_target`: fork PR code runs with a read-only `GITHUB_TOKEN`, in the fork's own cache scope, with no secrets available. Since the job holds no secrets at all and publishes no artifact, a hostile PR gains only free compute. Acceptable. |
| 7 | Gate is not already red (unmodified worktree) | PASS | `npm run build` → **EXIT=0**, 295 pages emitted. Caveat D-6: measured at `1ee77c1d`; `origin/main` is now `6bb509df` (2 commits ahead). |
| 8 | The 9 env values are the **minimum** (each is necessary) | PASS (3 of 9 spot-checked) | Removing any one of the three tested vars turns the green build red. Tested: `STRIPE_SECRET_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `OPENAI_API_KEY` — see *Env minimality*. |
| 9 | The 9 env values are **sufficient** | PASS | Check 7: a full 295-page build completes with exactly these 9 and nothing else. |
| 10 | Any value that should have been a GitHub secret instead | PASS — none | Every value is a placeholder for a *presence assertion*; no build step authenticates anywhere. The workflow's own comment ("if the build ever starts needing a real value, that is a bug in the code being built") is the right policy and should stay. |
| 11 | No duplication/conflict with `bos-llm-typecheck.yml` / `plugin-tests.yml` | PASS | Same trigger set as the typecheck (`push`/`pull_request` on `main` + dispatch), but a different `name`, a different job name and a different concurrency group → two parallel checks, independently requireable, no mutual cancellation. `plugin-tests.yml` is path-filtered (`lib/server/**`, `lib/plugins/**`, `tests/plugins/**`) plus nightly, and runs Jest rather than a build — no overlap. The only duplication is the standard PR-run + merge-push-run pair (about 2 × 3 min); that is normal and worth keeping, because the push run is the only detection path for a direct push to `main`. |
| 12 | Workplan claim: `main` has branch protection but **no required status checks** | VERIFIED | `gh api repos/AgentsPilot/neuronforge/branches/main/protection` returns `enforce_admins.enabled: true`, `allow_force_pushes.enabled: false`, `allow_deletions.enabled: false`, and **no `required_status_checks` key at all** — and also no `required_pull_request_reviews`. The claim is accurate. See D-7 for the consequence. |
| 13 | Workplan claim: nothing is red on `main` today | VERIFIED | `gh run list --branch main --limit 15`: the 15 most recent runs are all `success` except one `cancelled` (Business OS LLM Type Check @ `bb7a1865`, superseded by the next push — exactly the workplan's explanation). Latest at the current tip: *Business OS LLM Type Check* green (run 35504764785, 2026-09-20) and *Plugin Tests* green (nightly, 2026-09-20). So any red after this change is new. |

### Deliberate-break test (verbatim)

Both break classes were injected into `app/api/contact/route.ts`, built with exactly the workflow's env, then reverted with `git checkout --`.

**Break B — module-scope crash (the PR #53 class, caught during *Collecting page data*):**

```diff
+// QA-DELIBERATE-BREAK-B: module-scope crash (the PR #53 class)
+throw new Error('QA deliberate module-scope break');
```

```text
EXIT=1  DURATION=151s
...
Error: QA deliberate module-scope break
    at 92286 (...\.next\server\app\api\contact\route.js:1:1610)
    ...
> Build error occurred
Error: Failed to collect page data for /api/contact
    at ...\node_modules\next\dist\build\utils.js:1269:15
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5) {
  type: 'Error'
}
```

**Break A — import of a missing module (caught at compile):**

```diff
+import { qaDeliberateBreak } from '@/lib/qa-module-that-does-not-exist';
+logger.debug({ qa: typeof qaDeliberateBreak }, 'QA-DELIBERATE-BREAK-A keeps the import live');
```

```text
EXIT=1 DURATION=76s
Failed to compile.

./app/api/contact/route.ts
Module not found: Can't resolve '@/lib/qa-module-that-does-not-exist'

https://nextjs.org/docs/messages/module-not-found

> Build failed because of webpack errors
```

> Note on Break A: the import is *used* on purpose. An **unused** import of a non-existent module is elided by the SWC TypeScript transform and would not fail the build. That is correct behaviour (such code also runs fine at runtime), but it means a bad import path is only caught once the symbol is actually referenced.

**Revert verified.** After `git checkout -- app/api/contact/route.ts`:

```text
$ git status --porcelain
?? .github/workflows/build.yml
?? docs/workplans/CI_BUILD_GATE_WORKPLAN.md

$ git diff --stat
(empty)
```

The tree is back to the branch's state: only the two intended new files, no tracked-file modification.

### Baseline (unmodified worktree, verbatim)

```text
$ npm run build            # with exactly the workflow's Build-step env
> neuronforge@0.1.0 build
> next build

  ▲ Next.js 14.2.35

   Creating an optimized production build ...
 ✓ Compiled successfully
   Skipping validation of types
   Skipping linting
   Collecting page data ...
...
ƒ  (Dynamic)  server-rendered on demand
EXIT=0
```

### Env minimality (spot-checks)

| Var removed | Build result | Failing route |
|---|---|---|
| `STRIPE_SECRET_KEY` | **EXIT=1** | `Failed to collect page data for /api/stripe/cancel-subscription` |
| `QSTASH_NEXT_SIGNING_KEY` | **EXIT=1** | `Failed to collect page data for /api/cron/process-queue` |
| `OPENAI_API_KEY` | **EXIT=1** | `Failed to collect page data for /api/business-os/chat-v2` |
| (none removed) | EXIT=0 | — |

`QSTASH_NEXT_SIGNING_KEY` was chosen adversarially as the value most likely to be padding (a receiver often needs only the *current* key); it is genuinely required. Not re-tested: the four Supabase vars and `QSTASH_TOKEN` / `QSTASH_CURRENT_SIGNING_KEY` — the workplan's bisection plus these three confirmations make the set credible.

### Issues Found

#### Bugs (must fix before commit)

None. No High-severity defect: the gate does what it claims.

#### Should fix

1. **D-1 — CI builds on Node 18, which is not what production builds on** — Severity: **Medium** — File: `.github/workflows/build.yml:39`
   - `NODE_VERSION: '18'`; the repo has **no `.nvmrc`** and `vercel.json` pins no Node version, so Vercel builds on its current default (20/22) and local dev here is Node 22.19.0. A gate that builds on a different major than production can be green while the deploy breaks, and vice versa. Node 18 is also past end-of-life.
   - Pin `.nvmrc` (or the Vercel Node setting) and this workflow to the same major — ideally by having the workflow read it: `node-version-file: .nvmrc`.
   - Copying `'18'` from the typecheck workflow is understandable, but it propagates that drift into the one gate that is meant to be authoritative about "does this build".

2. **D-2 — The cache key churns on every source change, so every run writes a fresh multi-hundred-MB entry** — Severity: **Medium** — File: `.github/workflows/build.yml:63`
   - The primary key hashes `app/**`, `components/**`, `lib/**`, `hooks/**`, `types/**`. A PR by definition changes one of those, so the primary key essentially **never hits**, the run falls through to `restore-keys`, and `actions/cache` therefore **saves a new entry on every single run**. A `.next/cache` for a 295-page app is large, and the repo-wide 10 GB cache budget is LRU-evicted — this will steadily evict the `npm` caches used by *both* other workflows and make all of CI slower.
   - Suggest `key: ${{ runner.os }}-nextjs-${{ hashFiles('package-lock.json') }}` with the existing `restore-keys`. The build stays correct either way (Next validates its own cache entries), and the churn stops.
   - Minor extra cost: hashing five recursive globs across a repo this size runs on every job.

#### Edge cases / nice to fix

3. **D-3 — The cache-ordering comment states a rationale that is not true** — Severity: **Low** — File: `.github/workflows/build.yml:56-58`
   - "Restored BEFORE npm ci on purpose: hashFiles would otherwise walk node_modules." `hashFiles('app/**', 'components/**', 'lib/**', 'hooks/**', 'types/**')` never matches `node_modules/**`, regardless of ordering. The ordering is harmless, but the comment will lead the next reader to preserve a constraint that does not exist. Either drop the justification or replace it with the real one (it simply does not matter here).

4. **D-4 — `https://ci.invalid.supabase.co` is a subdomain of the real `supabase.co`, not the RFC-2606 `.invalid` TLD** — Severity: **Low** — File: `.github/workflows/build.yml:83,85`
   - It *looks* guaranteed-unresolvable but is not: the registrable domain is `supabase.co`, and Supabase uses per-project subdomains there. Verified today that it is NXDOMAIN (`nslookup ci.invalid.supabase.co` → *Non-existent domain*; control `nonexistent-qa-check.supabase.co` → same), so there is no live exposure. But that only holds while Supabase publishes no wildcard record — and the build *does* make outbound requests (D-5), so the guarantee matters.
   - Use a host that can never resolve: `https://ci.invalid` or `https://supabase.invalid` (or `http://127.0.0.1:54321`). No behaviour change: the client constructors only assert presence.

5. **D-5 — Routes perform network I/O during *Generating static pages*, contradicting the workflow's comment** — Severity: **Low** — Files: `app/api/admin/onboarding-config/route.ts`, `app/api/admin/token-usage/stats/route.ts` (observed; likely others)
   - The comment says "no network call happens at build time". The baseline log shows real `TypeError: fetch failed` from both routes during page-data collection — the build *does* attempt to reach the (fake) Supabase host, and stays green only because those routes catch and log the failure.
   - Consequence for the gate: a future route that does build-time I/O **without** catching will turn CI red for a reason unrelated to the PR, and the failure will look like a real break. Worth widening the workplan's existing "module-scope constructors are a latent hazard" note to cover build-time `fetch`, and softening the workflow comment so nobody relies on the stronger claim.

6. **D-6 — The green baseline was proven at `1ee77c1d`, but `main` has since moved to `6bb509df`** — Severity: **Low**
   - The worktree is 2 commits behind `origin/main` (`31976f13` "refactor(auth): one sign-out, not three" plus its merge), touching `components/LogoutButton.tsx`, `lib/client/auth-actions.ts` and `app/business-os/settings/page.tsx`. Those are client-side edits and unlikely to break the build, but they are **unverified**: the first time anyone builds the current tip will be the gate's own first run.
   - Rebase onto `origin/main` before opening the PR, so the first CI run is not also the first build of the tip. The workplan's "verified green on `main`" should read "verified green at `1ee77c1d`".

7. **D-7 — The gate is bypassable today by more than just the missing required check** — Severity: **Low** (process, not code)
   - `main`'s protection has neither `required_status_checks` *nor* `required_pull_request_reviews`, so a direct push to `main` is allowed and skips the PR trigger entirely; the `push: [main]` trigger then reports the breakage only *after* it has landed. The workplan correctly flags the missing required check (OI-3) — worth recording the "no required reviews" half too, since both need the same admin action.
   - Not a reason to hold the change: post-hoc detection is strictly better than today's zero coverage.

### Test Outputs / Logs

Full build logs retained for this session in the QA scratchpad: `baseline-build.log` (EXIT=0), `breakB-build.log` (EXIT=1, collect-page-data crash), `breakA-build.log` (EXIT=1, webpack module-not-found), `no-stripe.log`, `no-qstash-next.log`, `no-openai.log` (all EXIT=1). Key excerpts are quoted verbatim above.

### Final Status

- [x] **All acceptance criteria pass — ready for commit**, with D-1 and D-2 recommended as small edits first (both are one-line changes to this same file, and neither requires re-testing the gate's core behaviour).
- [ ] Issues found — Dev must address before commit

**Ship recommendation: SHIP.** The gate provably turns both classes of build breakage into a non-zero exit, holds no secrets, cannot be satisfied by a cancelled run, and neither duplicates nor interferes with the existing two workflows. D-3 through D-7 are accuracy and hygiene items that do not affect whether a break is caught. The gate remains advisory until a GitHub admin marks `Build (next build)` as required on `main`.

---

## Dev Fixes After QA (2026-09-20)

| Defect | Fix |
|---|---|
| **D-1** Node major | Added **`.nvmrc` = `22`**; the workflow now reads `node-version-file: '.nvmrc'` instead of `NODE_VERSION: '18'`. Evidence: Vercel **dropped Node 18 on 2025-09-01**, so production cannot be on 18; `package.json` `engines` is `">=18.17.0"` — a floor, not a pin, and Vercel ignores open ranges and falls back to the **project default, 22.x**; `vercel.json` pins nothing and there was no `.nvmrc`; this machine runs **v22.19.0**. Vercel supports 20/22/24, so 22 is the only value consistent with all of the above. ⚠️ **User to confirm** Vercel → Project Settings → Node.js Version reads 22.x; if not, change `.nvmrc`. The other two workflows still say `'18'` — out of scope here, but they now drift from this one and should be moved to `.nvmrc` in a follow-up. |
| **D-2** cache churn | **Dropped the `.next/cache` step entirely; kept only `setup-node`'s npm cache.** Keying on the lockfile alone would hit but then never re-save (same key already exists), so the entry goes stale and stops being worth much; keying on source never hits and re-saves hundreds of MB every run against the repo-wide 10 GB LRU budget, evicting the npm caches of both other workflows. A cold ~3–7 min build is an acceptable price for a gate, and a cold build is the one least able to hide a break behind reused artifacts. |
| **D-3** false comment | Gone with the cache step. |
| **D-4** placeholder host | `https://ci.invalid.supabase.co` → **`https://ci.invalid`** (RFC-2606 reserved TLD, can never resolve). Re-verified green with the new value. |
| **D-5** build-time fetch | Workflow comment corrected: the build **does** make outbound requests during page-data collection (`TypeError: fetch failed` from `/api/admin/onboarding-config` and `/api/admin/token-usage/stats`), which is also *why* the placeholder host must be unresolvable. **Consequence for the gate:** a future route that fetches at build time **without** catching the failure will turn this workflow red for a reason unrelated to the PR, and it will look like a real break. Same family as the module-scope-constructor hazard noted above. Neither is fixed here. |
| **D-6** stale baseline | Branch fast-forwarded `1ee77c1d` → **`6bb509df`** (picks up `31976f13` "refactor(auth): one sign-out, not three"). Re-proved green on the new tip — see Change History. |
| **D-7** bypassable gate | Recorded, not fixed — see below. |

### For a GitHub admin (one action, tracked with OI-3)

`main`'s branch protection has **neither `required_status_checks` nor `required_pull_request_reviews`**. So today a direct push to `main` skips the PR trigger entirely and the `push: [main]` trigger only reports a break *after* it has landed. All three parts need the same admin:

1. Require **`Build (next build)`** on `main`.
2. Require **`Type check (Business OS LLM attribution)`** on `main` (OI-3).
3. Require a pull request before merging.

Post-hoc detection is still strictly better than today's zero coverage, so this is not a reason to hold the change.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-20 | Created | Build gate added as its own workflow; env set derived by bisection; verified green at `1ee77c1d`. |
| 2026-09-20 | QA tested | Full QA on the uncommitted workflow: 13 checks, all PASS (2 with defects). Deliberate-break test proves exit 1 for both a module-scope crash and a missing-module import; baseline green (EXIT=0); 3 of 9 env vars spot-checked as necessary. 7 defects (2 Medium: Node 18 vs production Node, cache-key churn; 5 Low). Ship recommendation: SHIP. |
| 2026-09-20 | Dev fixes after QA | D-1 Node pinned to 22 via new `.nvmrc` + `node-version-file`; D-2 `.next/cache` step dropped (npm cache kept); D-3 false comment removed with it; D-4 placeholder host → `https://ci.invalid`; D-5 build-time-fetch comment corrected + consequence recorded; D-6 branch fast-forwarded `1ee77c1d` → `6bb509df` and re-proved green there (clean `.next`, exact workflow env, `BUILD_EXIT=0`, `✓ Generating static pages (295/295)`, 0 error lines, 7m09s); D-7 recorded for a GitHub admin. |
